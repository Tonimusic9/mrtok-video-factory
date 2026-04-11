/**
 * Agent Runner genérico (Tarefa 6 — Passo 1).
 *
 * Extrai o scaffolding de worker que hoje vive inline em `ceo-orchestrator.ts`:
 *   select FIFO → claim atômico → validar payload → process → done/failed
 *   → notificar tick summary no Telegram.
 *
 * Workers novos (a0–a7) devem consumir `runAgentTick()` passando apenas:
 *   - `agent`       : qual fila drenar
 *   - `payloadSchema`: Zod schema do payload específico do agente
 *   - `process`     : lógica de domínio (puro — sem select/claim/update)
 *   - `label`       : rótulo humano usado nas mensagens do Telegram
 *
 * Este arquivo é INTRODUZIDO EM PARALELO ao loop antigo do CEO — nada ainda o
 * chama. O refator do CEO para consumir este runner é o Passo 2 do plano mestre
 * `/Users/toninhoacunha/.claude/plans/sprightly-munching-sprout.md`.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { z } from "zod";
import { getSupabaseAdmin } from "@/lib/supabase";
import { chainNextTask } from "@/lib/taskChaining";
import { notifyAsync } from "@/lib/telegram";
import type { Database, Json, TaskAgent, TaskQueueRow } from "@/types/database";

const DEFAULT_MAX_TASKS = 5;
const HARD_MAX_TASKS = 20;

/**
 * Resultado da função `process()` de um agente.
 *
 * - `done`               → runner atualiza a row para `status='done'` com `result`.
 * - `failed`             → runner atualiza a row para `status='failed'` com `error`.
 * - `already_persisted`  → runner NÃO toca na row; apenas contabiliza o outcome.
 *   Usado pelo CEO quando o dispatch real já aconteceu e o update da row
 *   (done/failed) já foi tentado upstream — evita dupla escrita e preserva a
 *   regra de ouro (compliance_approved imutável em falha pós-dispatch).
 */
export type TaskProcessOutcome<TResult extends Json> =
  | { kind: "done"; result: TResult }
  | { kind: "failed"; error: string; result?: Json | null }
  | {
      kind: "already_persisted";
      status: "done" | "failed";
      error?: string;
      result?: Json | null;
    };

export interface AgentTickConfig<TPayload, TResult extends Json> {
  /** Fila a drenar (coluna `task_queue.agent`). */
  agent: TaskAgent;
  /** Rótulo humano usado nas mensagens do Telegram (ex.: "CEO", "Scriptwriter a3"). */
  label: string;
  /** Zod schema do payload específico do agente. */
  payloadSchema: z.ZodType<TPayload>;
  /**
   * Lógica de domínio do agente. Recebe payload JÁ validado.
   * Pode lançar — o runner captura e marca a task como `failed`.
   */
  process: (
    payload: TPayload,
    row: TaskQueueRow,
  ) => Promise<TaskProcessOutcome<TResult>>;
}

export interface AgentTickArgs {
  maxTasks?: number;
}

export type TaskOutcome =
  | { task_id: string; status: "done"; result: Json }
  | { task_id: string; status: "failed"; error: string }
  | { task_id: string; status: "skipped"; reason: string };

export interface AgentTickResult {
  agent: TaskAgent;
  processed: number;
  succeeded: number;
  failed: number;
  skipped: number;
  results: TaskOutcome[];
}

type SupabaseAdmin = SupabaseClient<Database>;

export async function runAgentTick<TPayload, TResult extends Json>(
  config: AgentTickConfig<TPayload, TResult>,
  args: AgentTickArgs = {},
): Promise<AgentTickResult> {
  const maxTasks = Math.min(
    Math.max(1, args.maxTasks ?? DEFAULT_MAX_TASKS),
    HARD_MAX_TASKS,
  );
  const supabase = getSupabaseAdmin();

  // 1. Selecionar candidatas (FIFO).
  const { data: candidates, error: selErr } = await supabase
    .from("task_queue")
    .select("*")
    .eq("agent", config.agent)
    .eq("status", "pending")
    .order("created_at", { ascending: true })
    .limit(maxTasks);

  if (selErr) {
    throw new Error(`[${config.agent}] falha ao ler task_queue: ${selErr.message}`);
  }

  const results: TaskOutcome[] = [];
  for (const candidate of candidates ?? []) {
    results.push(await processOne(supabase, config, candidate));
  }

  const succeeded = results.filter((r) => r.status === "done").length;
  const failed = results.filter((r) => r.status === "failed").length;
  const skipped = results.filter((r) => r.status === "skipped").length;

  if (results.length > 0) {
    notifyAsync(
      `🤖 *MrTok ${config.label} tick*\nprocessadas: ${results.length}\nok: ${succeeded} · falha: ${failed} · skip: ${skipped}`,
    );
  }

  return {
    agent: config.agent,
    processed: results.length,
    succeeded,
    failed,
    skipped,
    results,
  };
}

async function processOne<TPayload, TResult extends Json>(
  supabase: SupabaseAdmin,
  config: AgentTickConfig<TPayload, TResult>,
  row: TaskQueueRow,
): Promise<TaskOutcome> {
  // 2. Claim atômico — só pega se ainda estiver 'pending'.
  const { data: claimed, error: claimErr } = await supabase
    .from("task_queue")
    .update({ status: "in_progress" })
    .eq("id", row.id)
    .eq("status", "pending")
    .select("id")
    .maybeSingle();

  if (claimErr) {
    return {
      task_id: row.id,
      status: "skipped",
      reason: `claim_error: ${claimErr.message}`,
    };
  }
  if (!claimed) {
    return {
      task_id: row.id,
      status: "skipped",
      reason: "claimed_by_other_worker",
    };
  }

  // 3. Validar payload.
  const parsed = config.payloadSchema.safeParse(row.payload);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
    const errorMsg = `invalid_payload: ${detail}`;
    await markFailed(supabase, config.label, row.id, errorMsg, null);
    return { task_id: row.id, status: "failed", error: errorMsg };
  }

  // 4. Processar com a lógica de domínio do agente.
  let outcome: TaskProcessOutcome<TResult>;
  try {
    outcome = await config.process(parsed.data, row);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const errorMsg = `unexpected_error: ${msg}`;
    await markFailed(supabase, config.label, row.id, errorMsg, null);
    return { task_id: row.id, status: "failed", error: errorMsg };
  }

  // 5. Despachar conforme o tipo de outcome.
  if (outcome.kind === "done") {
    const resultJson = outcome.result as Json;
    const { error: doneErr } = await supabase
      .from("task_queue")
      .update({ status: "done", result: resultJson, error: null })
      .eq("id", row.id);

    if (doneErr) {
      notifyAsync(
        `⚠️ *MrTok ${config.label}* update da task falhou\ntask: \`${row.id}\`\nerro: \`${doneErr.message}\``,
      );
      return {
        task_id: row.id,
        status: "failed",
        error: `task_update_failed: ${doneErr.message}`,
      };
    }

    // 5a. Chaining autônomo: se houver handler registrado para este agente,
    //     enfileira a próxima task da esteira (ex.: a6 → a7). Nunca derruba
    //     o tick — o vídeo já está `done` no banco e delivery manual continua
    //     viável caso a injeção falhe.
    try {
      const chain = await chainNextTask(config.agent, row, resultJson, supabase);
      if (chain.injected) {
        console.log(
          `[runner:${config.agent}] 🔗 chaining → ${chain.nextAgent} task=${chain.nextTaskId} (parent=${row.id})`,
        );
      } else if (
        chain.reason !== "sem_handler_registrado" &&
        chain.reason !== "sem_delivery_context"
      ) {
        console.warn(
          `[runner:${config.agent}] ⚠️ chaining pulado: ${chain.reason} (parent=${row.id})`,
        );
        notifyAsync(
          `⚠️ *MrTok ${config.label}* chaining não injetado\ntask: \`${row.id}\`\nmotivo: \`${chain.reason}\``,
        );
      }
    } catch (chainErr) {
      const msg = chainErr instanceof Error ? chainErr.message : String(chainErr);
      console.error(`[runner:${config.agent}] ❌ chaining explodiu: ${msg}`);
    }

    return { task_id: row.id, status: "done", result: resultJson };
  }

  if (outcome.kind === "failed") {
    await markFailed(
      supabase,
      config.label,
      row.id,
      outcome.error,
      outcome.result ?? null,
    );
    return { task_id: row.id, status: "failed", error: outcome.error };
  }

  // already_persisted → nenhum UPDATE; apenas contabilizar.
  if (outcome.status === "done") {
    return {
      task_id: row.id,
      status: "done",
      result: (outcome.result ?? null) as Json,
    };
  }
  return {
    task_id: row.id,
    status: "failed",
    error: outcome.error ?? "already_persisted_failed",
  };
}

async function markFailed(
  supabase: SupabaseAdmin,
  label: string,
  taskId: string,
  errorMsg: string,
  result: Json | null,
): Promise<void> {
  const { error } = await supabase
    .from("task_queue")
    .update({ status: "failed", error: errorMsg, result })
    .eq("id", taskId);
  if (error) {
    notifyAsync(
      `⚠️ *MrTok ${label}* falha ao marcar task como failed\ntask: \`${taskId}\`\nerro: \`${error.message}\``,
    );
  }
}

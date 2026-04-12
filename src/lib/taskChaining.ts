/**
 * Task Chaining Registry — elo autônomo entre workers do MrTok.
 *
 * Objetivo: quando um worker marca uma task como `done`, este módulo
 * decide (a partir do `fromAgent`) se existe uma "próxima etapa" na
 * esteira e, em caso positivo, insere uma task `pending` no `task_queue`
 * para o próximo worker, linkando-a via `parent_task_id`.
 *
 * DESIGN:
 *  - Centralizado no runner (`agent-runner.processOne`), não nos workers.
 *    Mantém os workers puros/stateless e dá um ponto único de extensão.
 *  - Registry é um map `(fromAgent) => handler`. Adicionar chaining
 *    futuro (ex.: a7 → a8 analytics) exige apenas nova entrada aqui —
 *    ver TODO(v1.1) logo abaixo do `CHAIN_REGISTRY`.
 *  - Handlers NÃO lançam para derrubar o tick — devolvem
 *    `{ injected: false, reason }`. O runner loga e segue; o vídeo já
 *    está rendered, delivery manual permanece viável.
 *  - REGRA DE OURO: este módulo NUNCA escreve em `creative_matrix` e
 *    NUNCA altera `compliance_approved`. Só lê/escreve `task_queue`.
 *
 * Handlers atuais:
 *   - `a6` → enfileira task `a7` com o `output_video_url` do MontadorResult
 *     e o `delivery_context` que veio na task do a6.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  deliveryContextSchema,
  montadorResultSchema,
  montadorTaskPayloadSchema,
} from "@/lib/agents/renderManifest";
import { deliveryTaskPayloadSchema } from "@/workers/worker-a7";
import type { Database, Json, TaskAgent, TaskQueueRow } from "@/types/database";

type SupabaseAdmin = SupabaseClient<Database>;

export type ChainOutcome =
  | { injected: true; nextTaskId: string; nextAgent: TaskAgent }
  | { injected: false; reason: string };

type ChainHandler = (
  row: TaskQueueRow,
  result: Json,
  supabase: SupabaseAdmin,
) => Promise<ChainOutcome>;

// ---------------------------------------------------------------------------
// Handler: a6 (Montador Remotion) → a7 (Delivery Telegram)
// ---------------------------------------------------------------------------

const handleA6ToA7: ChainHandler = async (row, result, supabase) => {
  // 1. Recuperar o delivery_context do payload original do a6.
  //    Se ausente, não há chaining a fazer — comportamento backward-compat.
  const payloadParsed = montadorTaskPayloadSchema.safeParse(row.payload);
  if (!payloadParsed.success) {
    return {
      injected: false,
      reason: "a6_payload_invalido_no_chaining",
    };
  }
  const deliveryContext = payloadParsed.data.delivery_context;
  if (!deliveryContext) {
    return {
      injected: false,
      reason: "sem_delivery_context",
    };
  }

  // 2. Extrair o output_video_url do MontadorResult.
  const resultParsed = montadorResultSchema.safeParse(result);
  if (!resultParsed.success) {
    return {
      injected: false,
      reason: "montador_result_invalido",
    };
  }
  const { output_video_url } = resultParsed.data;

  // 3. Montar o payload do a7 e revalidar defensivamente.
  const a7Payload = {
    project_id: row.project_id,
    output_video_url,
    ...deliveryContextSchema.parse(deliveryContext),
  };
  const a7Check = deliveryTaskPayloadSchema.safeParse(a7Payload);
  if (!a7Check.success) {
    const issues = a7Check.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
    return {
      injected: false,
      reason: `a7_payload_invalido: ${issues}`,
    };
  }

  // 4. Inserir task a7 pending vinculada à task a6 via parent_task_id.
  const { data: inserted, error: insErr } = await supabase
    .from("task_queue")
    .insert({
      project_id: row.project_id,
      agent: "a7",
      status: "pending",
      payload: a7Check.data as unknown as Json,
      parent_task_id: row.id,
    })
    .select("id")
    .single();

  if (insErr || !inserted) {
    return {
      injected: false,
      reason: `insert_a7_failed: ${insErr?.message ?? "no_row_returned"}`,
    };
  }

  return {
    injected: true,
    nextTaskId: inserted.id,
    nextAgent: "a7",
  };
};

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

const CHAIN_REGISTRY: Partial<Record<TaskAgent, ChainHandler>> = {
  a6: handleA6ToA7,
  // TODO(v1.1): a7 → a8 (Analytics). Pré-requisito: ingestão real de KPIs
  // TikTok (views/likes/comments/shares) via `/analytics` ou Firecrawl. Sem
  // dados colhidos o a8 só produziria relatórios vazios — ativar o chain
  // aqui só quando a tabela `hook_performance` estiver sendo alimentada em
  // produção. Ver migration 0002 e knowledge/agents/agente-a8-analytics.md.
};

/**
 * Ponto de entrada chamado pelo `agent-runner` logo após uma task ser
 * marcada como `done`. Não lança — falhas viram `{ injected: false, reason }`.
 */
export async function chainNextTask(
  fromAgent: TaskAgent,
  row: TaskQueueRow,
  result: Json,
  supabase: SupabaseAdmin,
): Promise<ChainOutcome> {
  const handler = CHAIN_REGISTRY[fromAgent];
  if (!handler) {
    return { injected: false, reason: "sem_handler_registrado" };
  }
  try {
    return await handler(row, result, supabase);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { injected: false, reason: `handler_threw: ${msg}` };
  }
}

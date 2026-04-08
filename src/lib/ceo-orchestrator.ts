/**
 * Agente CEO (Tarefa 5) — orquestrador autônomo de dispatch.
 *
 * Drena `task_queue` (agent='ceo', status='pending') e aciona
 * `dispatchCreativeMatrix` para Matrizes Criativas já aprovadas.
 *
 * Regras críticas (CLAUDE.md §4 + plano humming-weaving-eich):
 *  - CEO só dispara se compliance_approved=true (defesa em profundidade,
 *    o gate canônico continua em dispatch-service.ts).
 *  - Falha de dispatch NUNCA reverte aprovação. Task vira 'failed',
 *    creative_matrix.compliance_approved permanece intocado.
 *  - Reuso obrigatório de dispatchCreativeMatrix. Sem duplicação de gate.
 *  - Claim atômico para evitar corrida entre ticks concorrentes.
 */
import { z } from "zod";
import { dispatchCreativeMatrix } from "@/lib/dispatch-service";
import { getSupabaseAdmin } from "@/lib/supabase";
import { notifyAsync } from "@/lib/telegram";
import {
  uploadPostPhotoSchema,
  uploadPostPlatformSchema,
} from "@/lib/upload-post-schema";
import type { Json, TaskQueueRow } from "@/types/database";

const ceoPayloadSchema = z.object({
  creative_matrix_id: z.string().uuid(),
  caption: z.string().min(1).max(2200),
  platforms: z.array(uploadPostPlatformSchema).min(1),
  photos: z.array(uploadPostPhotoSchema).min(1),
  schedule_iso: z.string().datetime().nullable().optional(),
});

export type CeoTaskOutcome =
  | {
      task_id: string;
      status: "done";
      request_id: string;
      hook_performance_id: string;
      unique_pixel_hash: string;
    }
  | {
      task_id: string;
      status: "failed";
      error: string;
    }
  | {
      task_id: string;
      status: "skipped";
      reason: string;
    };

export interface CeoTickResult {
  processed: number;
  succeeded: number;
  failed: number;
  skipped: number;
  results: CeoTaskOutcome[];
}

export interface RunCeoTickArgs {
  maxTasks?: number;
}

const DEFAULT_MAX_TASKS = 5;
const HARD_MAX_TASKS = 20;

export async function runCeoTick(
  args: RunCeoTickArgs = {},
): Promise<CeoTickResult> {
  const maxTasks = Math.min(
    Math.max(1, args.maxTasks ?? DEFAULT_MAX_TASKS),
    HARD_MAX_TASKS,
  );
  const supabase = getSupabaseAdmin();

  // 1. Selecionar candidatas (FIFO).
  const { data: candidates, error: selErr } = await supabase
    .from("task_queue")
    .select("*")
    .eq("agent", "ceo")
    .eq("status", "pending")
    .order("created_at", { ascending: true })
    .limit(maxTasks);

  if (selErr) {
    throw new Error(`[ceo] falha ao ler task_queue: ${selErr.message}`);
  }

  const results: CeoTaskOutcome[] = [];

  for (const candidate of candidates ?? []) {
    const outcome = await processCeoTask(candidate);
    results.push(outcome);
  }

  const succeeded = results.filter((r) => r.status === "done").length;
  const failed = results.filter((r) => r.status === "failed").length;
  const skipped = results.filter((r) => r.status === "skipped").length;

  if (results.length > 0) {
    notifyAsync(
      `🤖 *MrTok CEO tick*\nprocessadas: ${results.length}\nok: ${succeeded} · falha: ${failed} · skip: ${skipped}`,
    );
  }

  return {
    processed: results.length,
    succeeded,
    failed,
    skipped,
    results,
  };
}

async function processCeoTask(row: TaskQueueRow): Promise<CeoTaskOutcome> {
  const supabase = getSupabaseAdmin();

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
  const parsed = ceoPayloadSchema.safeParse(row.payload);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
    await markFailed(row.id, `invalid_payload: ${detail}`, null);
    return { task_id: row.id, status: "failed", error: `invalid_payload: ${detail}` };
  }

  // 4. Pré-check de compliance — sem tocar a row de creative_matrix.
  const { data: matrix, error: matrixErr } = await supabase
    .from("creative_matrix")
    .select("id, compliance_approved")
    .eq("id", parsed.data.creative_matrix_id)
    .maybeSingle();

  if (matrixErr) {
    await markFailed(row.id, `creative_matrix_lookup_failed: ${matrixErr.message}`, null);
    return {
      task_id: row.id,
      status: "failed",
      error: `creative_matrix_lookup_failed: ${matrixErr.message}`,
    };
  }
  if (!matrix) {
    await markFailed(row.id, "creative_matrix_not_found", null);
    return { task_id: row.id, status: "failed", error: "creative_matrix_not_found" };
  }
  if (!matrix.compliance_approved) {
    await markFailed(row.id, "compliance_not_approved", null);
    return { task_id: row.id, status: "failed", error: "compliance_not_approved" };
  }

  // 5. Dispatch (reuso puro). compliance_approved NUNCA é alterado pelo CEO.
  const dispatchResult = await dispatchCreativeMatrix({
    creative_matrix_id: parsed.data.creative_matrix_id,
    caption: parsed.data.caption,
    platforms: parsed.data.platforms,
    photos: parsed.data.photos,
    schedule_iso: parsed.data.schedule_iso ?? null,
  });

  if (!dispatchResult.ok) {
    const errorMsg = `${dispatchResult.code}: ${dispatchResult.detail}`;
    await markFailed(row.id, errorMsg, {
      code: dispatchResult.code,
      upstream_status: dispatchResult.upstream_status ?? null,
      upstream_body: dispatchResult.upstream_body ?? null,
      request_id: dispatchResult.request_id ?? null,
    });
    return { task_id: row.id, status: "failed", error: errorMsg };
  }

  const successResult: Json = {
    request_id: dispatchResult.request_id,
    hook_performance_id: dispatchResult.hook_performance_id,
    unique_pixel_hash: dispatchResult.unique_pixel_hash,
  };

  const { error: doneErr } = await supabase
    .from("task_queue")
    .update({ status: "done", result: successResult, error: null })
    .eq("id", row.id);

  if (doneErr) {
    // Dispatch já aconteceu — não dá pra reverter. Notifica e marca failed
    // só na task (creative_matrix continua aprovada e o request_id existe).
    notifyAsync(
      `⚠️ *MrTok CEO* dispatch ok mas update da task falhou\ntask: \`${row.id}\`\nrequest_id: \`${dispatchResult.request_id}\`\nerro: \`${doneErr.message}\``,
    );
    return {
      task_id: row.id,
      status: "failed",
      error: `task_update_failed_after_dispatch: ${doneErr.message}`,
    };
  }

  return {
    task_id: row.id,
    status: "done",
    request_id: dispatchResult.request_id,
    hook_performance_id: dispatchResult.hook_performance_id,
    unique_pixel_hash: dispatchResult.unique_pixel_hash,
  };
}

async function markFailed(
  taskId: string,
  errorMsg: string,
  result: Json | null,
): Promise<void> {
  const supabase = getSupabaseAdmin();
  const { error } = await supabase
    .from("task_queue")
    .update({ status: "failed", error: errorMsg, result })
    .eq("id", taskId);
  if (error) {
    notifyAsync(
      `⚠️ *MrTok CEO* falha ao marcar task como failed\ntask: \`${taskId}\`\nerro: \`${error.message}\``,
    );
  }
}

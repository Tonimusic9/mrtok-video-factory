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
 *  - Scaffolding de fila (select/claim/update/notify) é delegado ao runner
 *    genérico `runAgentTick` (src/lib/agent-runner.ts). Aqui ficam apenas
 *    o schema, a lógica de domínio e o wrapper de shape para /api/ceo/tick.
 */
import { z } from "zod";
import {
  runAgentTick,
  type TaskOutcome,
  type TaskProcessOutcome,
} from "@/lib/agent-runner";
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
type CeoPayload = z.infer<typeof ceoPayloadSchema>;

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

/** Payload de sucesso do dispatch — gravado em `task_queue.result`. */
type CeoDispatchSuccess = {
  request_id: string;
  hook_performance_id: string;
  unique_pixel_hash: string;
};

export async function runCeoTick(
  args: RunCeoTickArgs = {},
): Promise<CeoTickResult> {
  const tick = await runAgentTick(
    {
      agent: "ceo",
      label: "CEO",
      payloadSchema: ceoPayloadSchema,
      process: processCeoTaskInternal,
    },
    { maxTasks: args.maxTasks },
  );

  return {
    processed: tick.processed,
    succeeded: tick.succeeded,
    failed: tick.failed,
    skipped: tick.skipped,
    results: tick.results.map(toCeoOutcome),
  };
}

async function processCeoTaskInternal(
  payload: CeoPayload,
  row: TaskQueueRow,
): Promise<TaskProcessOutcome<CeoDispatchSuccess>> {
  const supabase = getSupabaseAdmin();

  // Pré-check de compliance — sem tocar a row de creative_matrix.
  const { data: matrix, error: matrixErr } = await supabase
    .from("creative_matrix")
    .select("id, compliance_approved")
    .eq("id", payload.creative_matrix_id)
    .maybeSingle();

  if (matrixErr) {
    return {
      kind: "failed",
      error: `creative_matrix_lookup_failed: ${matrixErr.message}`,
    };
  }
  if (!matrix) {
    return { kind: "failed", error: "creative_matrix_not_found" };
  }
  if (!matrix.compliance_approved) {
    return { kind: "failed", error: "compliance_not_approved" };
  }

  // Dispatch (reuso puro). compliance_approved NUNCA é alterado pelo CEO.
  const dispatchResult = await dispatchCreativeMatrix({
    creative_matrix_id: payload.creative_matrix_id,
    caption: payload.caption,
    platforms: payload.platforms,
    photos: payload.photos,
    schedule_iso: payload.schedule_iso ?? null,
  });

  if (!dispatchResult.ok) {
    return {
      kind: "failed",
      error: `${dispatchResult.code}: ${dispatchResult.detail}`,
      result: {
        code: dispatchResult.code,
        upstream_status: dispatchResult.upstream_status ?? null,
        upstream_body: dispatchResult.upstream_body ?? null,
        request_id: dispatchResult.request_id ?? null,
      },
    };
  }

  const successResult: CeoDispatchSuccess = {
    request_id: dispatchResult.request_id,
    hook_performance_id: dispatchResult.hook_performance_id,
    unique_pixel_hash: dispatchResult.unique_pixel_hash,
  };

  // O UPDATE pós-dispatch é responsabilidade EXCLUSIVA do CEO para preservar
  // o prefixo de erro `task_update_failed_after_dispatch:` (que sinaliza
  // "dispatch real aconteceu, não re-execute") e incluir o request_id no
  // warning do Telegram. O runner genérico não tem esse contexto.
  // `as unknown as Json`: CeoDispatchSuccess é objeto de strings, portanto
  // trivialmente serializável, mas o generic `TResult extends Json` exige
  // o cast explícito.
  const { error: doneErr } = await supabase
    .from("task_queue")
    .update({
      status: "done",
      result: successResult as unknown as Json,
      error: null,
    })
    .eq("id", row.id);

  if (doneErr) {
    notifyAsync(
      `⚠️ *MrTok CEO* dispatch ok mas update da task falhou\ntask: \`${row.id}\`\nrequest_id: \`${dispatchResult.request_id}\`\nerro: \`${doneErr.message}\``,
    );
    return {
      kind: "already_persisted",
      status: "failed",
      error: `task_update_failed_after_dispatch: ${doneErr.message}`,
    };
  }

  return {
    kind: "already_persisted",
    status: "done",
    result: successResult as unknown as Json,
  };
}

function toCeoOutcome(o: TaskOutcome): CeoTaskOutcome {
  if (o.status === "done") {
    const r = o.result as {
      request_id: string;
      hook_performance_id: string;
      unique_pixel_hash: string;
    };
    return {
      task_id: o.task_id,
      status: "done",
      request_id: r.request_id,
      hook_performance_id: r.hook_performance_id,
      unique_pixel_hash: r.unique_pixel_hash,
    };
  }
  if (o.status === "failed") {
    return { task_id: o.task_id, status: "failed", error: o.error };
  }
  return { task_id: o.task_id, status: "skipped", reason: o.reason };
}

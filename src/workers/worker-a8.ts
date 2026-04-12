/**
 * Worker a8 — Analytics / Estrategista de ROI (Objetivo 2).
 *
 * Glue fino entre o runner genérico (`runAgentTick`) e o agente músculo
 * `runAnalyticsAgent` (DeepSeek V3.1 via OpenRouter). Drena a fila
 * `task_queue` onde `agent='a8'`.
 *
 * Fluxo:
 *   1. Recebe payload com `window_days`, `min_samples`, `focus`.
 *   2. Lê linhas de `hook_performance` (colunas novas da migration 0002:
 *      views/likes/comments/shares/collection_date) joined com
 *      `creative_matrix` para extrair rótulo de hook / persona / format.
 *   3. Se a amostra for menor que `min_samples`, curto-circuita: devolve
 *      um relatório vazio (não chama DeepSeek — economia de tokens).
 *   4. Caso contrário, chama `runAnalyticsAgent` → JSON validado por
 *      `analyticsReportSchema`.
 *   5. Retorna o relatório; o runner persiste em `task_queue.result`.
 *
 * REGRA DE OURO: este worker NUNCA escreve em `creative_matrix` e NUNCA
 * toca em `compliance_approved` — apenas LÊ `hook_performance` e
 * `creative_matrix`. O runner cuida do update da própria task.
 *
 * Sem side-effects no top-level: importar este módulo não inicia loop —
 * o acionamento (cron, route handler, smoke) é externo.
 */
import { z } from "zod";
import {
  runAgentTick,
  type AgentTickArgs,
  type AgentTickResult,
} from "@/lib/agent-runner";
import { getSupabaseAdmin } from "@/lib/supabase";
import {
  runAnalyticsAgent,
  analyticsReportSchema,
  type AnalyticsReport,
  type AnalyticsSampleRow,
} from "@/lib/agents/analytics";

// ---------------------------------------------------------------------------
// Schemas Zod
// ---------------------------------------------------------------------------

export const analyticsTaskPayloadSchema = z.object({
  /** UUID ou slug do projeto (usado para filtrar ou apenas rotular o report). */
  project_id: z.string().min(1),
  /** Janela temporal em dias a olhar na `hook_performance`. Default 14. */
  window_days: z.number().int().min(1).max(90).default(14),
  /** Mínimo de linhas para chamar o modelo. Abaixo disso, reporte vazio. */
  min_samples: z.number().int().min(1).default(3),
  /** Onde focar a clusterização. */
  focus: z
    .enum(["hooks", "personas", "formats", "all"])
    .default("all"),
  /**
   * Se `true`, filtra apenas linhas cujo `creative_matrix.project_id` bate
   * com o `project_id` do payload. Default `false` — olha a fábrica inteira.
   */
  scoped_to_project: z.boolean().default(false),
});
export type AnalyticsTaskPayload = z.infer<typeof analyticsTaskPayloadSchema>;

// Re-exporta o schema da saída para consumidores externos (smokes, CEO).
export { analyticsReportSchema };
export type { AnalyticsReport };

// ---------------------------------------------------------------------------
// Linhas cruas retornadas pelo JOIN — supersubconjunto do que precisamos.
// Tipado explicitamente porque o `database.generated.ts` ainda não conhece
// as colunas da migration 0002 (regenerar é um passo manual separado).
// ---------------------------------------------------------------------------
interface RawJoinedRow {
  creative_matrix_id: string | null;
  collection_date: string | null;
  views: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  views_3s: number | null;
  creative_matrix: {
    id: string;
    project_id: string | null;
    persona_id: string | null;
    format_id: string | null;
    hooks_matrix: unknown;
  } | null;
}

/**
 * Extrai um rótulo humano do primeiro hook da `hooks_matrix` (se houver),
 * para o a8 agrupar por "tipo de hook" sem precisar abrir o JSON inteiro.
 */
function pickHookLabel(hooksMatrix: unknown): string | null {
  if (!Array.isArray(hooksMatrix) || hooksMatrix.length === 0) return null;
  const first = hooksMatrix[0] as Record<string, unknown> | undefined;
  if (!first || typeof first !== "object") return null;
  const label = first.label ?? first.name ?? first.type ?? first.hook_type;
  return typeof label === "string" && label.length > 0 ? label : null;
}

/**
 * Flatten do join `hook_performance + creative_matrix` no formato que o
 * prompt do agente espera. Ignora linhas órfãs (sem creative_matrix).
 */
function flattenRows(rows: RawJoinedRow[]): AnalyticsSampleRow[] {
  const out: AnalyticsSampleRow[] = [];
  for (const row of rows) {
    const cm = row.creative_matrix;
    if (!cm || !row.creative_matrix_id || !row.collection_date) continue;
    out.push({
      creative_matrix_id: row.creative_matrix_id,
      collection_date: row.collection_date,
      views: row.views ?? 0,
      likes: row.likes ?? 0,
      comments: row.comments ?? 0,
      shares: row.shares ?? 0,
      views_3s: row.views_3s ?? 0,
      hook_label: pickHookLabel(cm.hooks_matrix),
      persona_id: cm.persona_id,
      format_id: cm.format_id,
    });
  }
  return out;
}

/**
 * Cria um relatório vazio canônico quando não há amostras suficientes.
 * Evita chamar DeepSeek e queimar tokens sem dados.
 */
function emptyReport(
  payload: AnalyticsTaskPayload,
  sampleCount: number,
): AnalyticsReport {
  return {
    project_id: payload.project_id,
    generated_at: new Date().toISOString(),
    window_days: payload.window_days,
    sample_count: sampleCount,
    insights: [],
    fatigue_alerts: [],
  };
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

export function runWorkerA8Tick(
  args: AgentTickArgs = {},
): Promise<AgentTickResult> {
  return runAgentTick<AnalyticsTaskPayload, AnalyticsReport>(
    {
      agent: "a8",
      label: "Analytics a8",
      payloadSchema: analyticsTaskPayloadSchema,
      process: async (payload) => {
        const supabase = getSupabaseAdmin();

        // --- 1. Calcular a janela temporal ---------------------------------
        const fromDate = new Date();
        fromDate.setUTCDate(fromDate.getUTCDate() - payload.window_days);
        const fromIso = fromDate.toISOString().slice(0, 10); // YYYY-MM-DD

        // --- 2. Query com join em creative_matrix --------------------------
        // As colunas novas (views/likes/comments/shares/collection_date)
        // vêm da migration 0002 — ainda não refletidas em database.generated.
        // Coerção via `unknown` porque o tipo gerado ainda não conhece as
        // colunas novas; regenerar `database.generated.ts` depois que a
        // migration rodar elimina os casts. Ver CLAUDE.md §4.
        const selectClause = `
          creative_matrix_id,
          collection_date,
          views,
          likes,
          comments,
          shares,
          views_3s,
          creative_matrix:creative_matrix_id (
            id,
            project_id,
            persona_id,
            format_id,
            hooks_matrix
          )
        `;

        const { data: rawRows, error: selErr } = await (
          supabase.from("hook_performance") as unknown as {
            select: (s: string) => {
              gte: (
                col: string,
                val: string,
              ) => {
                order: (
                  col: string,
                  opts: { ascending: boolean },
                ) => {
                  limit: (
                    n: number,
                  ) => Promise<{ data: RawJoinedRow[] | null; error: { message: string } | null }>;
                };
              };
            };
          }
        )
          .select(selectClause)
          .gte("collection_date", fromIso)
          .order("collection_date", { ascending: false })
          .limit(500);
        if (selErr) {
          return {
            kind: "failed",
            error: `hook_performance_select: ${selErr.message}`,
          };
        }

        let joined: RawJoinedRow[] = rawRows ?? [];

        // --- 3. Filtro opcional por project_id -----------------------------
        if (payload.scoped_to_project) {
          joined = joined.filter(
            (r) => r.creative_matrix?.project_id === payload.project_id,
          );
        }

        const samples = flattenRows(joined);

        // --- 4. Curto-circuito: amostra insuficiente -----------------------
        if (samples.length < payload.min_samples) {
          return { kind: "done", result: emptyReport(payload, samples.length) };
        }

        // --- 5. Chamar DeepSeek V3.1 via agente músculo --------------------
        let report: AnalyticsReport;
        try {
          report = await runAnalyticsAgent({
            project_id: payload.project_id,
            window_days: payload.window_days,
            min_samples: payload.min_samples,
            focus: payload.focus,
            samples,
          });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          return { kind: "failed", error: `analytics_agent: ${msg}` };
        }

        // --- 6. Re-validação defensiva antes de persistir ------------------
        const check = analyticsReportSchema.safeParse(report);
        if (!check.success) {
          const issues = check.error.issues
            .map((i) => `${i.path.join(".")}: ${i.message}`)
            .join("; ");
          return {
            kind: "failed",
            error: `analytics_report_invalid: ${issues}`,
          };
        }

        return { kind: "done", result: check.data };
      },
    },
    args,
  );
}

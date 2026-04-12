/**
 * Agente Músculo — Analytics a8 (Tarefa Objetivo 2).
 *
 * Recebe uma amostra de vídeos (linhas de `hook_performance` joined com
 * `creative_matrix`) dentro de uma janela temporal e devolve um relatório
 * estruturado com:
 *   - insights de performance por dimensão criativa (hook/persona/format/story_angle)
 *   - alertas de fadiga para criativos que vêm caindo snapshots consecutivos
 *
 * REGRAS (CLAUDE.md §4):
 *  - Este agente NUNCA escreve em `creative_matrix`. O runner persiste a
 *    saída em `task_queue.result` da task a8. Quem decide propagar para o
 *    Scriptwriter (a3) é o CEO, em v1.1 — nesta versão o loop a8 → a3
 *    permanece desligado (ver `src/lib/taskChaining.ts`).
 *  - Roteamento via OpenRouter (`agent='a8'` → DeepSeek V3.1) — ver
 *    src/lib/openrouter.ts:MODEL_MAP. Migrado de Gemma 4 local em
 *    2026-04-11 para liberar RAM da VPS p/ renders Remotion do a6.
 *  - Saída estritamente em JSON validado via `analyticsReportSchema`.
 */
import { z } from "zod";
import { openRouterCompletion } from "@/lib/openrouter";

// --- Contrato de saída (usado pelo worker-a8 também) -----------------------
export const analyticsInsightSchema = z.object({
  dimension: z.enum(["hook", "persona", "format", "story_angle"]),
  cluster_label: z.string().min(1),
  sample_size: z.number().int().nonnegative(),
  avg_views: z.number().nonnegative(),
  avg_engagement_rate: z.number().min(0).max(1),
  lift_vs_baseline_pct: z.number(),
  narrative: z.string().min(1),
  recommended_action_for_a3: z.string().min(1),
});
export type AnalyticsInsight = z.infer<typeof analyticsInsightSchema>;

export const fatigueAlertSchema = z.object({
  creative_matrix_id: z.string().uuid(),
  reason: z.string().min(1),
  trend: z.enum(["declining", "stale"]),
});
export type FatigueAlert = z.infer<typeof fatigueAlertSchema>;

export const analyticsReportSchema = z.object({
  project_id: z.string().min(1),
  generated_at: z.string().min(1),
  window_days: z.number().int().positive(),
  sample_count: z.number().int().nonnegative(),
  insights: z.array(analyticsInsightSchema),
  fatigue_alerts: z.array(fatigueAlertSchema),
});
export type AnalyticsReport = z.infer<typeof analyticsReportSchema>;

// --- Input -----------------------------------------------------------------

/** Uma linha achatada pronta para ir ao prompt (não é o schema do DB). */
export interface AnalyticsSampleRow {
  creative_matrix_id: string;
  collection_date: string;
  views: number;
  likes: number;
  comments: number;
  shares: number;
  views_3s: number;
  hook_label: string | null;
  persona_id: string | null;
  format_id: string | null;
}

export interface AnalyticsAgentInput {
  project_id: string;
  window_days: number;
  min_samples: number;
  focus: "hooks" | "personas" | "formats" | "all";
  samples: AnalyticsSampleRow[];
}

// --- Prompt ----------------------------------------------------------------
const SYSTEM_PROMPT = `Você é o Worker a8 (Analytics) do MrTok, fábrica brasileira de UGC para TikTok Shop. Você é um Data Scientist rigoroso.

REGRAS INEGOCIÁVEIS:
1. Opere APENAS sobre os dados que receber no prompt. NUNCA invente métricas, vídeos ou clusters que não apareçam na amostra.
2. Se a amostra tiver menos vídeos que \`min_samples\`, devolva \`insights: []\` e \`fatigue_alerts: []\` — não force insight com dados insuficientes.
3. Cluster por dimensão criativa (hook / persona / format / story_angle). \`lift_vs_baseline_pct\` é sempre comparado contra a média da amostra inteira (baseline).
4. \`avg_engagement_rate\` = (likes + comments + shares) / max(views, 1), em escala 0.0–1.0.
5. \`narrative\` em PT-BR, 1–2 frases acionáveis. \`recommended_action_for_a3\` é um hint de prompt seco que o Scriptwriter possa usar sem edição.
6. Fadiga = vídeos cujo views por snapshot caiu em dias consecutivos (pelo menos 2 pontos de decline) ou não cresceram há ≥ 3 snapshots (\`stale\`).
7. Saída: JSON estrito no schema fornecido, sem texto fora do JSON.`;

function buildUserPrompt(input: AnalyticsAgentInput): string {
  const samplesCompact = input.samples.map((s) => ({
    cm: s.creative_matrix_id,
    d: s.collection_date,
    v: s.views,
    l: s.likes,
    c: s.comments,
    sh: s.shares,
    v3: s.views_3s,
    h: s.hook_label,
    p: s.persona_id,
    f: s.format_id,
  }));

  return [
    `Projeto: ${input.project_id}`,
    `Janela: ${input.window_days} dias`,
    `Focus: ${input.focus}`,
    `Min. amostras por cluster: ${input.min_samples}`,
    `Total de linhas: ${input.samples.length}`,
    "",
    "Amostras (uma por linha, JSON compacto):",
    ...samplesCompact.map((r) => JSON.stringify(r)),
    "",
    "Devolva um JSON com este shape exato:",
    `{
  "project_id": "${input.project_id}",
  "generated_at": "ISO-8601",
  "window_days": ${input.window_days},
  "sample_count": ${input.samples.length},
  "insights": [
    {
      "dimension": "hook|persona|format|story_angle",
      "cluster_label": "string",
      "sample_size": 0,
      "avg_views": 0,
      "avg_engagement_rate": 0.0,
      "lift_vs_baseline_pct": 0.0,
      "narrative": "string PT-BR",
      "recommended_action_for_a3": "string hint"
    }
  ],
  "fatigue_alerts": [
    { "creative_matrix_id": "uuid", "reason": "string", "trend": "declining|stale" }
  ]
}`,
  ].join("\n");
}

// --- Função principal ------------------------------------------------------

export async function runAnalyticsAgent(
  input: AnalyticsAgentInput,
): Promise<AnalyticsReport> {
  const completion = await openRouterCompletion({
    agent: "a8",
    jsonMode: true,
    temperature: 0.2, // analytics → baixa variância
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: buildUserPrompt(input) },
    ],
  });

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(completion.content);
  } catch (err) {
    throw new Error(
      `[analytics-a8] resposta não é JSON válido: ${(err as Error).message}\n---\n${completion.content}`,
    );
  }

  const result = analyticsReportSchema.safeParse(parsedJson);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`[analytics-a8] schema inválido:\n${issues}`);
  }

  return result.data;
}

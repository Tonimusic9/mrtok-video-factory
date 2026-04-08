/**
 * Agente Músculo — Scriptwriter (Tarefa 6).
 *
 * Recebe um tema (tipicamente derivado de uma row de `creative_matrix`)
 * e devolve um roteiro estruturado em três blocos canônicos:
 *   - hook  (gancho de ~3s, curiosidade ou ruptura visual)
 *   - body  (desenvolvimento ~15s, prova social / demonstração)
 *   - cta   (call-to-action ~3s, fricção mínima)
 *
 * REGRAS (CLAUDE.md §4):
 *  - Compliance total: NUNCA exagerar produto, prometer função irreal,
 *    inventar ingrediente, garantia ou resultado.
 *  - Fator humano: o hook deve sugerir uma imperfeição natural (gagueja,
 *    riso, hesitação) — campo `human_imperfection_hint`.
 *  - Roteamento via OpenRouter (`agent='a3'` → Qwen 3.6) — ver
 *    src/lib/openrouter.ts:22 para o mapping canônico.
 *
 * Esta é a versão "esqueleto" da Tarefa 6: estrutura + contrato Zod +
 * chamada ao OpenRouter em modo JSON. Fine-tuning de prompt e few-shots
 * vêm na próxima iteração.
 */
import { z } from "zod";
import { openRouterCompletion } from "@/lib/openrouter";

// --- Contrato de saída -----------------------------------------------------
export const scriptOutputSchema = z.object({
  hook: z.object({
    voiceover: z.string().min(1),
    visual_disruptor: z.string().min(1),
    human_imperfection_hint: z.string().min(1),
    duration_seconds: z.number().positive().max(5),
  }),
  body: z.object({
    voiceover: z.string().min(1),
    key_points: z.array(z.string()).min(1).max(5),
    duration_seconds: z.number().positive().max(20),
  }),
  cta: z.object({
    voiceover: z.string().min(1),
    action_verb: z.string().min(1),
    duration_seconds: z.number().positive().max(5),
  }),
});
export type ScriptOutput = z.infer<typeof scriptOutputSchema>;

// --- Input -----------------------------------------------------------------
export interface ScriptwriterInput {
  /** Tema central (ex.: "máscara facial de argila verde para acne"). */
  theme: string;
  /** Persona-alvo opcional (ex.: "mulher 25-34, pele oleosa"). */
  target_persona?: string;
  /** Restrições de compliance específicas do produto (ex.: "não citar ANVISA"). */
  compliance_constraints?: string[];
}

// --- Prompt ----------------------------------------------------------------
const SYSTEM_PROMPT = `Você é o Scriptwriter do MrTok, fábrica brasileira de UGC para TikTok Shop.

REGRAS INEGOCIÁVEIS:
1. NUNCA exagerar o produto, prometer função irreal, citar ingredientes que não conhece ou inventar resultados.
2. NUNCA usar termos médicos ou regulados (ANVISA, "cura", "trata", "elimina 100%").
3. O hook precisa ter um gatilho VISUAL claro e uma imperfeição humana natural (gagueja, riso, pausa).
4. Português BR coloquial. Sem hashtags no roteiro.
5. Saída: JSON estrito no schema fornecido. Sem texto fora do JSON.`;

function buildUserPrompt(input: ScriptwriterInput): string {
  const partes = [
    `Tema: ${input.theme}`,
    input.target_persona ? `Persona-alvo: ${input.target_persona}` : null,
    input.compliance_constraints?.length
      ? `Restrições de compliance:\n- ${input.compliance_constraints.join("\n- ")}`
      : null,
    "",
    "Devolva um JSON com este shape (durações em segundos):",
    `{
  "hook":  { "voiceover": "...", "visual_disruptor": "...", "human_imperfection_hint": "...", "duration_seconds": 3 },
  "body":  { "voiceover": "...", "key_points": ["...", "..."], "duration_seconds": 15 },
  "cta":   { "voiceover": "...", "action_verb": "...", "duration_seconds": 3 }
}`,
  ];
  return partes.filter(Boolean).join("\n");
}

// --- Função principal ------------------------------------------------------
export async function writeScript(
  input: ScriptwriterInput,
): Promise<ScriptOutput> {
  const completion = await openRouterCompletion({
    agent: "a3",
    jsonMode: true,
    temperature: 0.8,
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
      `[scriptwriter] resposta não é JSON válido: ${(err as Error).message}\n---\n${completion.content}`,
    );
  }

  const result = scriptOutputSchema.safeParse(parsedJson);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`[scriptwriter] schema inválido:\n${issues}`);
  }

  return result.data;
}

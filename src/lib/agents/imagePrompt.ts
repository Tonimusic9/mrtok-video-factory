/**
 * Agente Músculo — Diretor de Arte / Image Prompt Generator (Tarefa 8).
 *
 * Recebe um roteiro estruturado do a3 (`ScriptOutput`) e devolve um
 * storyboard de 3 shots (hook/body/cta) com prompts visuais prontos
 * para o gerador upstream (a5 / Stable Diffusion / Flux).
 *
 * REGRAS (CLAUDE.md §4):
 *  - Compliance visual: NUNCA mostrar antes/depois clínico, claims ANVISA,
 *    jaleco, "100%", embalagem com claims regulados, resultado milagroso.
 *  - Verossimilhança UGC: estética OBRIGATÓRIA de iPhone selfie / câmera
 *    frontal — nunca estilo publicitário/estúdio. Pequenas imperfeições
 *    de enquadramento são bem-vindas (refletem o `human_imperfection_hint`
 *    do hook do a3).
 *  - Roteamento via OpenRouter (`agent='a4'` → Qwen3 Max) — ver
 *    src/lib/openrouter.ts:33 para o mapping canônico.
 *
 * DECISÕES (Tarefa 8):
 *  - D1: Campos visuais em INGLÊS (melhor performance dos geradores upstream).
 *  - D2: `aspect_ratio` é `z.literal("9:16")` — TikTok Shop é vertical.
 *  - D3: Estética default `"UGC iPhone selfie, natural daylight, ..."`
 *    hardcoded no system prompt. Sem override pelo payload.
 */
import { z } from "zod";
import { openRouterCompletion } from "@/lib/openrouter";
import { scriptOutputSchema, type ScriptOutput } from "@/lib/agents/scriptwriter";

// --- Contrato de saída -----------------------------------------------------
const shotPromptSchema = z.object({
  block: z.enum(["hook", "body", "cta"]),
  duration_seconds: z.number().positive().max(20),
  subject: z.string().min(1),
  action: z.string().min(1),
  setting: z.string().min(1),
  camera: z.string().min(1),
  lighting: z.string().min(1),
  mood: z.string().min(1),
  negative_prompt: z.string().min(1),
});
export type ShotPrompt = z.infer<typeof shotPromptSchema>;

export const imagePromptOutputSchema = z.object({
  shots: z.array(shotPromptSchema).length(3),
  global_style: z.object({
    aesthetic: z.string().min(1),
    aspect_ratio: z.literal("9:16"),
    color_palette: z.string().min(1),
    forbidden_elements: z.array(z.string().min(1)).min(1),
  }),
});
export type ImagePromptOutput = z.infer<typeof imagePromptOutputSchema>;

// --- Input -----------------------------------------------------------------
export interface ImagePromptInput {
  /** Roteiro a3 completo (hook/body/cta) — fonte da verdade narrativa. */
  script: ScriptOutput;
  /** Tema do produto (ex.: "máscara facial de argila verde"). */
  product_theme: string;
  /** Persona-alvo opcional (mesma string usada no a3). */
  target_persona?: string;
  /** Restrições visuais de compliance (ex.: "não mostrar rótulo ANVISA"). */
  compliance_constraints?: string[];
}

// --- Prompt ----------------------------------------------------------------
const SYSTEM_PROMPT = `Você é o Diretor de Arte do MrTok, fábrica brasileira de UGC para TikTok Shop.

Sua tarefa: transformar um roteiro de 3 blocos (hook/body/cta) em um storyboard de 3 shots com prompts visuais prontos para um gerador de imagem (Stable Diffusion / Flux).

REGRAS INEGOCIÁVEIS DE COMPLIANCE (TikTok Shop BR):
1. PROIBIDO mostrar antes/depois clínico, jaleco, mãos médicas, microscópio, gráficos, "100%", "comprovado", rótulo ANVISA visível, embalagem com claims regulados.
2. PROIBIDO resultado milagroso, pele perfeita CGI, transformação dramática.
3. OBRIGATÓRIO estética UGC autêntica: "UGC iPhone selfie, natural daylight, subtle grain, shallow depth of field". NUNCA softbox, NUNCA estúdio profissional, NUNCA pose de modelo.
4. Pequenas imperfeições de enquadramento são BEM-VINDAS (mão tremida, foco hesitante, cabelo fora do lugar) — refletem criadores reais.
5. Cada \`shots[i].action\` deve ser plausível dado o \`voiceover\` do bloco correspondente.
6. \`negative_prompt\` SEMPRE inclui: "no text, no caption, no watermark, no logo, no extra hands, no clinical setting, no white coat".

REGRAS DE FORMATO:
- Saída: JSON estrito no schema fornecido. Sem texto fora do JSON.
- Os campos visuais (subject, action, setting, camera, lighting, mood, negative_prompt, aesthetic, color_palette, forbidden_elements) DEVEM ser em INGLÊS — eles alimentam um gerador treinado em inglês.
- \`aspect_ratio\` é SEMPRE a string literal "9:16".
- \`shots\` tem EXATAMENTE 3 elementos, na ordem: hook → body → cta.
- \`duration_seconds\` de cada shot espelha o do bloco correspondente do roteiro.`;

function buildUserPrompt(input: ImagePromptInput): string {
  const { script, product_theme, target_persona, compliance_constraints } = input;
  const partes = [
    `Produto: ${product_theme}`,
    target_persona ? `Persona-alvo: ${target_persona}` : null,
    compliance_constraints?.length
      ? `Restrições visuais extras:\n- ${compliance_constraints.join("\n- ")}`
      : null,
    "",
    "ROTEIRO (a3) — gere um shot por bloco, na mesma ordem:",
    `HOOK (${script.hook.duration_seconds}s)`,
    `  voiceover: ${script.hook.voiceover}`,
    `  visual_disruptor: ${script.hook.visual_disruptor}`,
    `  human_imperfection_hint: ${script.hook.human_imperfection_hint}`,
    `BODY (${script.body.duration_seconds}s)`,
    `  voiceover: ${script.body.voiceover}`,
    `  key_points: ${script.body.key_points.join(" | ")}`,
    `CTA  (${script.cta.duration_seconds}s)`,
    `  voiceover: ${script.cta.voiceover}`,
    `  action_verb: ${script.cta.action_verb}`,
    "",
    "Devolva um JSON com este shape (campos visuais em inglês):",
    `{
  "shots": [
    { "block": "hook", "duration_seconds": ${script.hook.duration_seconds}, "subject": "...", "action": "...", "setting": "...", "camera": "...", "lighting": "...", "mood": "...", "negative_prompt": "..." },
    { "block": "body", "duration_seconds": ${script.body.duration_seconds}, "subject": "...", "action": "...", "setting": "...", "camera": "...", "lighting": "...", "mood": "...", "negative_prompt": "..." },
    { "block": "cta",  "duration_seconds": ${script.cta.duration_seconds}, "subject": "...", "action": "...", "setting": "...", "camera": "...", "lighting": "...", "mood": "...", "negative_prompt": "..." }
  ],
  "global_style": {
    "aesthetic": "UGC iPhone selfie, natural daylight, subtle grain, shallow depth of field",
    "aspect_ratio": "9:16",
    "color_palette": "...",
    "forbidden_elements": ["clinical setting", "white coat", "before/after split", "..."]
  }
}`,
  ];
  return partes.filter(Boolean).join("\n");
}

// --- Função principal ------------------------------------------------------
export async function generateImagePrompts(
  input: ImagePromptInput,
): Promise<ImagePromptOutput> {
  // Validação defensiva do script de entrada — falhar cedo se o caller
  // passou um ScriptOutput inválido.
  const scriptCheck = scriptOutputSchema.safeParse(input.script);
  if (!scriptCheck.success) {
    throw new Error(
      `[image-prompt] script de entrada inválido: ${scriptCheck.error.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; ")}`,
    );
  }

  const completion = await openRouterCompletion({
    agent: "a4",
    jsonMode: true,
    temperature: 0.7,
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
      `[image-prompt] resposta não é JSON válido: ${(err as Error).message}\n---\n${completion.content}`,
    );
  }

  const result = imagePromptOutputSchema.safeParse(parsedJson);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`[image-prompt] schema inválido:\n${issues}`);
  }

  // Validação cruzada: ordem dos blocos.
  const order = result.data.shots.map((s) => s.block).join(",");
  if (order !== "hook,body,cta") {
    throw new Error(
      `[image-prompt] storyboard fora de ordem: esperado hook,body,cta — recebido ${order}`,
    );
  }

  return result.data;
}

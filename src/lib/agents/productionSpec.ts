/**
 * Agente Músculo — Produtor Visual/Voz (Tarefa 9).
 *
 * Recebe o roteiro estruturado do a3 (`ScriptOutput`) + o storyboard visual
 * do a4 (`ImagePromptOutput`) e devolve uma `ProductionSpec` textual com,
 * por shot (hook/body/cta):
 *   - `voice`            : voice_id, SSML PT-BR, pacing_wpm, emphasis, pauses
 *   - `video_generation` : provider (FAL.ai), fal_model_slug, duração,
 *                          aspect_ratio, motion_intensity, seed, prompts EN
 *
 * REGRAS (CLAUDE.md §4):
 *  - Compliance total: NUNCA voz corporativa / locução de estúdio / TTS de
 *    call-center. Sempre timbre de criador real, intimista.
 *  - Fator Humano Obrigatório: preservar o `human_imperfection_hint` do hook
 *    do a3, traduzindo-o para marcações SSML (<break>, <emphasis>, hesitação).
 *  - Verossimilhança UGC: estética herdada do a4 — iPhone selfie 9:16,
 *    sem softbox, sem estúdio.
 *  - Roteamento via OpenRouter (`agent='a5'` → Minimax M2.7) — ver
 *    src/lib/openrouter.ts:34 para o mapping canônico.
 *
 * REGRA DE OURO: este módulo é text-only. NUNCA chama FAL.ai, NUNCA gera
 * binário, NUNCA escreve em `creative_matrix`. A execução real das specs
 * (chamar FAL/KIE e renderizar) é responsabilidade do worker a6 (Montador).
 *
 * DECISÕES (Tarefa 9):
 *  - D1: Campos visuais em INGLÊS (reuso da D1 do a4 — downstream performa
 *    melhor em inglês). SSML e voice_id em PT-BR.
 *  - D2: `aspect_ratio` é `z.literal("9:16")` — TikTok Shop é vertical.
 *  - D3: Gateway único para vídeo = FAL.ai. `fal_model_slug` é cross-checkado
 *    fail-closed contra o mapa canônico `FAL_SLUG_BY_PROVIDER`.
 *  - D4: Se `preferred_video_provider` vier no input, o modelo DEVE respeitá-lo
 *    em `global.default_video_provider` — cross-checado aqui.
 */
import { z } from "zod";
import { openRouterCompletion } from "@/lib/openrouter";
import { scriptOutputSchema, type ScriptOutput } from "@/lib/agents/scriptwriter";
import {
  imagePromptOutputSchema,
  type ImagePromptOutput,
} from "@/lib/agents/imagePrompt";

// --- Catálogo de providers de vídeo (FAL.ai) -------------------------------
// IMPORTANTE: esta lista contém APENAS motores de VÍDEO. O `nano-banana-pro`
// foi removido em abr/2026 por ser um modelo de IMAGEM — sua presença na
// fallback chain causava falha em runtime no worker a6 ao tentar renderizar
// vídeo via endpoint de imagem.
export const VIDEO_PROVIDERS = [
  "kling",
  "seedance",
  "hailuo",
  "veo",
] as const;
export type VideoProvider = (typeof VIDEO_PROVIDERS)[number];

/**
 * Mapa canônico provider → slug FAL.ai. Fonte única da verdade — usado tanto
 * pelo prompt (para o LLM escolher coerentemente) quanto pelo cross-check
 * fail-closed em `generateProductionSpec()`.
 *
 * NOTA: o worker a6 prioriza o `fal_model_slug` que vem no payload do shot
 * (fonte da verdade do spec); este mapa é usado apenas como resolver de
 * slug para providers na cadeia de fallback.
 */
export const FAL_SLUG_BY_PROVIDER: Record<VideoProvider, string> = {
  kling: "fal-ai/kling-video/v2.1/standard",
  seedance: "fal-ai/seedance-video-lite",
  hailuo: "fal-ai/minimax-video",
  veo: "fal-ai/veo3-fast",
};

// --- Contrato de saída -----------------------------------------------------
const voiceSpecSchema = z.object({
  voice_id: z.string().min(1),
  ssml: z.string().min(1),
  pacing_wpm: z.number().int().min(90).max(220),
  emphasis: z.array(z.string().min(1)),
  pauses_ms: z.array(
    z.object({
      after_word_index: z.number().int().nonnegative(),
      duration_ms: z.number().int().min(80).max(1200),
    }),
  ),
  human_imperfection: z.string().min(1),
});
export type VoiceSpec = z.infer<typeof voiceSpecSchema>;

const videoGenerationSpecSchema = z.object({
  provider: z.enum(VIDEO_PROVIDERS),
  fal_model_slug: z.string().min(1),
  duration_seconds: z.number().positive().max(20),
  aspect_ratio: z.literal("9:16"),
  motion_intensity: z.enum(["low", "medium", "high"]),
  seed: z.number().int().nonnegative().max(2147483647),
  image_prompt: z.string().min(1),
  negative_prompt: z.string().min(1),
  motion_description: z.string().min(1),
});
export type VideoGenerationSpec = z.infer<typeof videoGenerationSpecSchema>;

const shotProductionSchema = z.object({
  block: z.enum(["hook", "body", "cta"]),
  voice: voiceSpecSchema,
  video_generation: videoGenerationSpecSchema,
});
export type ShotProduction = z.infer<typeof shotProductionSchema>;

export const productionSpecOutputSchema = z.object({
  shots: z.array(shotProductionSchema).length(3),
  global: z.object({
    voice_locale: z.literal("pt-BR"),
    default_video_provider: z.enum(VIDEO_PROVIDERS),
    fal_gateway: z.literal("fal.ai"),
    fallback_provider_chain: z.array(z.enum(VIDEO_PROVIDERS)).min(1),
  }),
});
export type ProductionSpecOutput = z.infer<typeof productionSpecOutputSchema>;

// --- Input -----------------------------------------------------------------
export interface ProductionSpecInput {
  script: ScriptOutput;
  storyboard: ImagePromptOutput;
  product_theme: string;
  target_persona?: string;
  voice_locale?: "pt-BR";
  preferred_video_provider?: VideoProvider;
  compliance_constraints?: string[];
}

// --- Prompt ----------------------------------------------------------------
const PROVIDER_CATALOG_FOR_PROMPT = VIDEO_PROVIDERS.map(
  (p) => `  - "${p}" → "${FAL_SLUG_BY_PROVIDER[p]}"`,
).join("\n");

const SYSTEM_PROMPT = `Você é o Produtor Visual/Voz do MrTok, fábrica brasileira de UGC para TikTok Shop.

Sua tarefa: dado um ROTEIRO (a3, 3 blocos) e um STORYBOARD visual (a4, 3 shots em inglês), produzir uma ProductionSpec com, para cada shot: (A) uma spec de VOZ em PT-BR com SSML e (B) uma spec de GERAÇÃO DE VÍDEO apontando para um provider do gateway FAL.ai.

REGRAS INEGOCIÁVEIS DE COMPLIANCE (TikTok Shop BR):
1. PROIBIDO voz corporativa, locução profissional de estúdio, TTS de call-center, timbre robótico. Sempre timbre de criador real falando ao celular.
2. PROIBIDO claim milagroso, "100%", "comprovado", termos médicos, ANVISA.
3. OBRIGATÓRIO preservar o \`human_imperfection_hint\` do hook do a3: traduza-o para marcações SSML reais (\`<break time="...ms"/>\`, \`<emphasis level="moderate">...</emphasis>\`, hesitação curta). Refletir no campo \`human_imperfection\` do shot de hook.
4. OBRIGATÓRIO estética UGC 9:16 (vertical TikTok). NUNCA 16:9, NUNCA 1:1.

REGRAS DE VOZ:
- \`voice_id\`: string PT-BR estilo "pt-BR-creator-female-01" ou "pt-BR-creator-male-02". Escolha 1 voice_id coerente e REUSE nos 3 shots (mesmo criador).
- \`ssml\`: SSML válido PT-BR cobrindo o \`voiceover\` do bloco correspondente. Sem prefixo \`<speak>\` opcional — o TTS provider embrulha.
- \`pacing_wpm\`: 90-220. Hook mais rápido (~160-190), body mediano (~140-170), CTA curto e direto (~150-180).
- \`emphasis\`: palavras/trechos com ênfase (2-4 itens típicos).
- \`pauses_ms\`: pausas pontuais com \`after_word_index\` (0-based no voiceover do bloco) e duração 80-1200ms.
- \`human_imperfection\`: descrição curta da imperfeição aplicada (PT-BR).

REGRAS DE VÍDEO (FAL.ai):
- Catálogo de providers permitidos e seus slugs FAL obrigatórios:
${PROVIDER_CATALOG_FOR_PROMPT}
- \`provider\` DEVE ser um dos 5 acima e \`fal_model_slug\` DEVE ser EXATAMENTE o slug canônico listado — qualquer divergência é falha fatal.
- Escolha por tipo de shot (heurística): hook com movimento/disruptor → \`kling\` ou \`seedance\`; body em close/demonstração estática → \`hailuo\` ou \`seedance\`; CTA curto → \`seedance\` ou \`kling\`; \`veo\` como opção premium/fallback.
- \`motion_intensity\`: \`low\` para close facial estático, \`medium\` default, \`high\` para hooks com ação forte.
- \`seed\`: inteiro positivo determinístico (0 a 2147483647).
- \`aspect_ratio\`: sempre a string literal "9:16".
- \`duration_seconds\`: deve bater EXATAMENTE com o \`duration_seconds\` do shot correspondente do storyboard a4.
- \`image_prompt\`: derive do \`subject\`+\`action\`+\`setting\`+\`camera\`+\`lighting\`+\`mood\` do shot a4 (EM INGLÊS).
- \`negative_prompt\`: herde o \`negative_prompt\` do shot a4 e reforce compliance (no text, no caption, no watermark, no clinical setting, no white coat, no before/after).
- \`motion_description\`: 1-2 frases EM INGLÊS descrevendo o movimento de câmera + ação do sujeito.

REGRAS DE \`global\`:
- \`voice_locale\`: literal "pt-BR".
- \`default_video_provider\`: o provider "padrão" do criativo (se o input trouxer \`preferred_video_provider\`, use-o; senão escolha o mais adequado ao conjunto).
- \`fal_gateway\`: literal "fal.ai".
- \`fallback_provider_chain\`: array não-vazio, começando pelo \`default_video_provider\` e listando 1-3 alternativas coerentes.

REGRAS DE FORMATO:
- Saída: JSON estrito no schema fornecido. Sem texto fora do JSON.
- \`shots\` tem EXATAMENTE 3 elementos, na ordem: hook → body → cta.
- Campos visuais (image_prompt, negative_prompt, motion_description) em INGLÊS. SSML e voice_id em PT-BR.`;

function buildUserPrompt(input: ProductionSpecInput): string {
  const {
    script,
    storyboard,
    product_theme,
    target_persona,
    preferred_video_provider,
    compliance_constraints,
  } = input;

  const storyboardBlocks = storyboard.shots
    .map(
      (s) =>
        `[${s.block.toUpperCase()}] ${s.duration_seconds}s
  subject: ${s.subject}
  action: ${s.action}
  setting: ${s.setting}
  camera: ${s.camera}
  lighting: ${s.lighting}
  mood: ${s.mood}
  negative_prompt: ${s.negative_prompt}`,
    )
    .join("\n");

  const partes = [
    `Produto: ${product_theme}`,
    target_persona ? `Persona-alvo: ${target_persona}` : null,
    preferred_video_provider
      ? `Provider de vídeo preferido (OBRIGATÓRIO respeitar em global.default_video_provider): ${preferred_video_provider}`
      : null,
    compliance_constraints?.length
      ? `Restrições extras:\n- ${compliance_constraints.join("\n- ")}`
      : null,
    "",
    "ROTEIRO (a3):",
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
    "STORYBOARD (a4):",
    storyboardBlocks,
    `  global_style.aesthetic: ${storyboard.global_style.aesthetic}`,
    `  global_style.color_palette: ${storyboard.global_style.color_palette}`,
    `  global_style.forbidden_elements: ${storyboard.global_style.forbidden_elements.join(" | ")}`,
    "",
    "Devolva um JSON com este shape (shots em ordem hook,body,cta):",
    `{
  "shots": [
    {
      "block": "hook",
      "voice": { "voice_id": "pt-BR-...", "ssml": "...", "pacing_wpm": 180, "emphasis": ["..."], "pauses_ms": [{"after_word_index": 2, "duration_ms": 220}], "human_imperfection": "..." },
      "video_generation": { "provider": "kling", "fal_model_slug": "fal-ai/kling-video/v2.1/standard", "duration_seconds": ${script.hook.duration_seconds}, "aspect_ratio": "9:16", "motion_intensity": "high", "seed": 123456, "image_prompt": "...", "negative_prompt": "...", "motion_description": "..." }
    },
    {
      "block": "body",
      "voice": { "voice_id": "pt-BR-...", "ssml": "...", "pacing_wpm": 155, "emphasis": ["..."], "pauses_ms": [], "human_imperfection": "..." },
      "video_generation": { "provider": "hailuo", "fal_model_slug": "fal-ai/minimax-video", "duration_seconds": ${script.body.duration_seconds}, "aspect_ratio": "9:16", "motion_intensity": "low", "seed": 789012, "image_prompt": "...", "negative_prompt": "...", "motion_description": "..." }
    },
    {
      "block": "cta",
      "voice": { "voice_id": "pt-BR-...", "ssml": "...", "pacing_wpm": 165, "emphasis": ["..."], "pauses_ms": [], "human_imperfection": "..." },
      "video_generation": { "provider": "seedance", "fal_model_slug": "fal-ai/seedance-video-lite", "duration_seconds": ${script.cta.duration_seconds}, "aspect_ratio": "9:16", "motion_intensity": "medium", "seed": 345678, "image_prompt": "...", "negative_prompt": "...", "motion_description": "..." }
    }
  ],
  "global": {
    "voice_locale": "pt-BR",
    "default_video_provider": "${preferred_video_provider ?? "kling"}",
    "fal_gateway": "fal.ai",
    "fallback_provider_chain": ["${preferred_video_provider ?? "kling"}", "seedance"]
  }
}`,
  ];
  return partes.filter(Boolean).join("\n");
}

// --- Função principal ------------------------------------------------------
export async function generateProductionSpec(
  input: ProductionSpecInput,
): Promise<ProductionSpecOutput> {
  // Validação defensiva do roteiro e storyboard de entrada.
  const scriptCheck = scriptOutputSchema.safeParse(input.script);
  if (!scriptCheck.success) {
    throw new Error(
      `[production-spec] script de entrada inválido: ${scriptCheck.error.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; ")}`,
    );
  }
  const storyboardCheck = imagePromptOutputSchema.safeParse(input.storyboard);
  if (!storyboardCheck.success) {
    throw new Error(
      `[production-spec] storyboard de entrada inválido: ${storyboardCheck.error.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; ")}`,
    );
  }

  const completion = await openRouterCompletion({
    agent: "a5",
    jsonMode: true,
    temperature: 0.7,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: buildUserPrompt(input) },
    ],
  });

  // Minimax M2.7 ocasionalmente ignora `response_format: json_object` e
  // embrulha a resposta em code-fence markdown (```json ... ```). Strip
  // tolerante antes do JSON.parse — preserva o path feliz e cobre o quirk.
  const rawContent = completion.content.trim();
  const fenceMatch = rawContent.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  const jsonText = fenceMatch ? fenceMatch[1] : rawContent;

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(jsonText);
  } catch (err) {
    throw new Error(
      `[production-spec] resposta não é JSON válido: ${(err as Error).message}\n---\n${completion.content}`,
    );
  }

  const result = productionSpecOutputSchema.safeParse(parsedJson);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`[production-spec] schema inválido:\n${issues}`);
  }
  const spec = result.data;

  // --- Cross-checks fail-closed --------------------------------------------
  // 1. Ordem dos shots.
  const order = spec.shots.map((s) => s.block).join(",");
  if (order !== "hook,body,cta") {
    throw new Error(
      `[production-spec] shots fora de ordem: esperado hook,body,cta — recebido ${order}`,
    );
  }

  // 2. fal_model_slug coerente com provider (por shot).
  for (const shot of spec.shots) {
    const expected = FAL_SLUG_BY_PROVIDER[shot.video_generation.provider];
    if (shot.video_generation.fal_model_slug !== expected) {
      throw new Error(
        `[production-spec] fal_model_slug inconsistente no shot ${shot.block}: provider=${shot.video_generation.provider} esperava "${expected}", recebeu "${shot.video_generation.fal_model_slug}"`,
      );
    }
  }

  // 3. Duração por shot bate com o storyboard a4.
  const storyboardByBlock = new Map(
    input.storyboard.shots.map((s) => [s.block, s.duration_seconds]),
  );
  for (const shot of spec.shots) {
    const expected = storyboardByBlock.get(shot.block);
    if (expected === undefined) {
      throw new Error(
        `[production-spec] bloco ${shot.block} ausente no storyboard a4`,
      );
    }
    if (shot.video_generation.duration_seconds !== expected) {
      throw new Error(
        `[production-spec] duração do shot ${shot.block} diverge do storyboard a4: esperado ${expected}s, recebido ${shot.video_generation.duration_seconds}s`,
      );
    }
  }

  // 4. aspect_ratio garantido pelo schema (z.literal), mas reforçamos a mensagem.
  //    (nenhuma ação extra necessária)

  // 5. default_video_provider aparece em fallback_provider_chain.
  if (!spec.global.fallback_provider_chain.includes(spec.global.default_video_provider)) {
    throw new Error(
      `[production-spec] default_video_provider="${spec.global.default_video_provider}" ausente de fallback_provider_chain=[${spec.global.fallback_provider_chain.join(",")}]`,
    );
  }

  // 6. preferred_video_provider foi respeitado.
  if (
    input.preferred_video_provider &&
    spec.global.default_video_provider !== input.preferred_video_provider
  ) {
    throw new Error(
      `[production-spec] preferred_video_provider="${input.preferred_video_provider}" ignorado: default_video_provider="${spec.global.default_video_provider}"`,
    );
  }

  return spec;
}

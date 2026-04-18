/**
 * Worker a3 — Script + Images (V23.1).
 *
 * Consolida responsabilidades que antes viviam divididas entre A2 (direção
 * criativa) e A3 (geração de keyframes). Consome leads com `structural_matrix`
 * (produzida pelo A1), gera a `creative_direction` via Gemini 2.5 Flash e
 * materializa cada `visual_prompt` em uma imagem real via Nano Banana 2
 * (FAL.ai). Upload no bucket `mrtok-images` e promoção do lead para o status
 * `images_generated`.
 *
 * Engine (direção): Gemini 2.5 Flash — reaproveita `generateWithGemini`.
 * Engine (imagem): Nano Banana Pro — `fal-ai/nano-banana-pro` (override via env).
 *
 * REGRA DE OURO (ROI): validamos `structural_matrix` antes de gastar Gemini,
 * e validamos `creative_direction` antes de gastar FAL. Zero chamada paga em
 * lead incompleto.
 * REGRA DE OURO (Dados): nunca escreve em `creative_matrix` — apenas em
 * `product_leads.metadata` e `task_queue.result` (via runner).
 */
import { z } from "zod";
import {
  runAgentTick,
  type AgentTickArgs,
  type AgentTickResult,
} from "@/lib/agent-runner";
import { submitAndPollImage } from "@/lib/fal-client";
import { generateWithGemini } from "@/lib/gemini-client";
import { getSupabaseAdmin } from "@/lib/supabase";
import { extractorResultSchema, type ExtractorResult } from "@/workers/worker-a1";
import type { Json } from "@/types/database";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const NANO_BANANA_SLUG =
  process.env.FAL_NANO_BANANA_SLUG?.trim() || "fal-ai/nano-banana-pro";

const STORAGE_BUCKET = "mrtok-images";
const IMAGE_CONCURRENCY = 2;
const MAX_RETRIES_PER_PROMPT = 2;

// ---------------------------------------------------------------------------
// Schemas — Payload
// ---------------------------------------------------------------------------

export const imageGenTaskPayloadSchema = z.object({
  lead_id: z.string().uuid(),
  parent_task_id: z.string().uuid().optional(),
});
export type ImageGenTaskPayload = z.infer<typeof imageGenTaskPayloadSchema>;

// ---------------------------------------------------------------------------
// Schemas — Creative Direction (absorvidos do ex-worker-a2)
// ---------------------------------------------------------------------------

const visualPromptSchema = z.object({
  scene_index: z.number().int(),
  phase: z.string(),
  nano_banana_prompt: z.string().min(1),
  negative_prompt: z.string().min(1),
  aspect_ratio: z.literal("9:16"),
});

const motionBucketSchema = z.object({
  scene_index: z.number().int(),
  phase: z.string(),
  provider: z.enum(["seedance_2_0", "kling_3_1", "veo_3_1_fast"]),
  motion_prompt: z.string().min(1),
  duration_seconds: z.number().positive().max(15),
  camera_movement: z.string().min(1),
  intensity: z.string().transform((v) => {
    const lower = v.toLowerCase();
    if (["low", "medium", "high"].includes(lower))
      return lower as "low" | "medium" | "high";
    return "medium" as const;
  }),
});

const voiceoverSegmentSchema = z.object({
  scene_index: z.number().int(),
  phase: z.string(),
  text_pt_br: z.string().min(1),
  tone_marker: z.string().min(1),
  duration_seconds: z.number().positive().max(15),
  human_imperfection_hint: z.string().min(1),
});

export const creativeDirectionSchema = z.object({
  lead_id: z.string(),
  lead_title: z.string(),
  visual_prompts: z.array(visualPromptSchema).min(2).max(5),
  motion_buckets: z.array(motionBucketSchema).min(2).max(5),
  voiceover_script: z.array(voiceoverSegmentSchema).min(2).max(5),
  global_style: z.object({
    aesthetic: z.string().min(1),
    color_palette: z.string().min(1),
    reference_device: z.literal("iPhone 17 Pro Max"),
    forbidden_elements: z.array(z.string()).min(1),
  }),
});
export type CreativeDirection = z.infer<typeof creativeDirectionSchema>;

// ---------------------------------------------------------------------------
// Schemas — Imagens geradas
// ---------------------------------------------------------------------------

const generatedImageSchema = z.object({
  scene_index: z.number().int(),
  phase: z.string(),
  storage_path: z.string(),
  public_url: z.string().url(),
  fal_request_id: z.string(),
  duration_ms: z.number().nonnegative(),
});
export type GeneratedImage = z.infer<typeof generatedImageSchema>;

export const imageGenResultSchema = z.object({
  lead_id: z.string(),
  lead_title: z.string(),
  creative_direction: creativeDirectionSchema,
  generated_images: z.array(generatedImageSchema),
  failures: z.array(
    z.object({
      scene_index: z.number().int(),
      phase: z.string(),
      error: z.string(),
    }),
  ),
});
export type ImageGenResult = z.infer<typeof imageGenResultSchema>;

// ---------------------------------------------------------------------------
// Prompt Gemini (migrado do ex-worker-a2)
// ---------------------------------------------------------------------------

function buildCreativeDirectorPrompt(
  title: string,
  matrix: ExtractorResult,
): string {
  const matrixJson = JSON.stringify(matrix, null, 2);

  return `Você é o Diretor de Arte e Roteirista de Performance do MrTok — fábrica brasileira de UGC para TikTok Shop.

Sua missão: converter a Structural Matrix abaixo em 3 artefatos de produção concretos.

PRODUTO: ${title}
STRUCTURAL MATRIX (gerada pelo Engenheiro de Retenção):
${matrixJson}

GERE EXCLUSIVAMENTE um JSON válido (sem markdown) com este formato:

{
  "lead_id": "(preencher com o id do lead)",
  "lead_title": "${title}",
  "visual_prompts": [
    {
      "scene_index": 1,
      "phase": "hook",
      "nano_banana_prompt": "Ultra-detailed photorealistic prompt for Nano Banana 2. MUST include: 'shot on iPhone 17 Pro Max, raw UGC style, casual framing, natural daylight, 9:16 vertical'. Describe the exact visual composition, subject position, expression, lighting, background. In ENGLISH.",
      "negative_prompt": "CGI, anime, studio lighting, perfect skin, stock photo, watermark, text overlay, logo",
      "aspect_ratio": "9:16"
    }
  ],
  "motion_buckets": [
    {
      "scene_index": 1,
      "phase": "hook",
      "provider": "seedance_2_0",
      "motion_prompt": "Describe the EXACT motion to animate from start frame to end frame. Camera movement, subject action, speed. Be specific about physics and continuity. In ENGLISH.",
      "duration_seconds": 2,
      "camera_movement": "quick zoom in / slow pan / static / handheld shake",
      "intensity": "high"
    }
  ],
  "voiceover_script": [
    {
      "scene_index": 1,
      "phase": "hook",
      "text_pt_br": "Texto em português BR coloquial. Máximo 2 frases. Deve provocar a emoção do psychological_trigger.",
      "tone_marker": "[sussurrando] / [animado] / [chocado] / [íntimo]",
      "duration_seconds": 2,
      "human_imperfection_hint": "Leve gaguejar no início / pausa de surpresa / riso nervoso"
    }
  ],
  "global_style": {
    "aesthetic": "Raw UGC, shot on iPhone 17 Pro Max, casual selfie framing, imperfect but authentic",
    "color_palette": "Warm natural tones, soft daylight, no filters",
    "reference_device": "iPhone 17 Pro Max",
    "forbidden_elements": ["CGI", "anime", "studio lighting", "perfect composition", "stock footage", "before/after clinical"]
  }
}

REGRAS OBRIGATÓRIAS:
1. Visual prompts em INGLÊS (performance dos geradores de imagem).
2. Voiceover em PORTUGUÊS BR coloquial. NUNCA exagerar produto ou fazer claims médicos.
3. Cada scene_index mapeia 1:1 com os steps da structural_matrix.
4. Motion buckets devem respeitar: Seedance 2.0 max 15s, Kling 3.0 Pro max 10s, Veo 3.1 Fast max 8s.
5. Hook (cena 1): SEMPRE "seedance_2_0" com intensity "high" e duration max 3s.
6. Resolução canônica: 720x1280 (720p vertical). PROIBIDO 1080p ou 4K.
7. TODA cena deve ter human_imperfection_hint no voiceover — fator anti-shadowban.
8. Negative prompts AGRESSIVOS contra CGI, anime, stock footage.`;
}

// ---------------------------------------------------------------------------
// Helpers — Imagem
// ---------------------------------------------------------------------------

async function downloadImage(
  url: string,
): Promise<{ buffer: Buffer; contentType: string }> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`download falhou (${res.status}) para ${url}`);
  }
  const contentType = res.headers.get("content-type") ?? "image/png";
  const arr = await res.arrayBuffer();
  return { buffer: Buffer.from(arr), contentType };
}

function extForContentType(ct: string): string {
  if (ct.includes("jpeg")) return "jpg";
  if (ct.includes("webp")) return "webp";
  return "png";
}

async function generateAndUploadOne(
  leadId: string,
  visualPrompt: z.infer<typeof visualPromptSchema>,
): Promise<GeneratedImage> {
  const supabase = getSupabaseAdmin();

  let lastErr: Error | null = null;
  for (let attempt = 1; attempt <= MAX_RETRIES_PER_PROMPT + 1; attempt++) {
    try {
      const job = await submitAndPollImage({
        slug: NANO_BANANA_SLUG,
        input: {
          prompt: visualPrompt.nano_banana_prompt,
          aspect_ratio: "9:16",
          resolution: "1K",
          num_images: 1,
        },
      });

      const { buffer, contentType } = await downloadImage(job.image_url);

      const ext = extForContentType(contentType);
      const storagePath = `leads/${leadId}/scene-${visualPrompt.scene_index}-${visualPrompt.phase}.${ext}`;

      const { error: upErr } = await supabase.storage
        .from(STORAGE_BUCKET)
        .upload(storagePath, buffer, { contentType, upsert: true });
      if (upErr) throw new Error(`storage.upload: ${upErr.message}`);

      const { data: pub } = supabase.storage
        .from(STORAGE_BUCKET)
        .getPublicUrl(storagePath);

      return {
        scene_index: visualPrompt.scene_index,
        phase: visualPrompt.phase,
        storage_path: storagePath,
        public_url: pub.publicUrl,
        fal_request_id: job.request_id,
        duration_ms: job.duration_ms,
      };
    } catch (err) {
      lastErr = err instanceof Error ? err : new Error(String(err));
      console.warn(
        `[a3] tentativa ${attempt}/${MAX_RETRIES_PER_PROMPT + 1} cena ${visualPrompt.scene_index} falhou: ${lastErr.message}`,
      );
      if (attempt <= MAX_RETRIES_PER_PROMPT) {
        await new Promise((r) => setTimeout(r, 1_500 * attempt));
      }
    }
  }
  throw lastErr ?? new Error("falha sem causa reportada");
}

async function runBounded<T, R>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<R>,
): Promise<Array<{ ok: true; value: R } | { ok: false; error: string; item: T }>> {
  const results: Array<
    { ok: true; value: R } | { ok: false; error: string; item: T }
  > = new Array(items.length);
  let cursor = 0;

  async function runSlot(): Promise<void> {
    while (true) {
      const idx = cursor++;
      if (idx >= items.length) return;
      try {
        results[idx] = { ok: true, value: await worker(items[idx]) };
      } catch (err) {
        results[idx] = {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
          item: items[idx],
        };
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, () => runSlot()),
  );
  return results;
}

// ---------------------------------------------------------------------------
// Processamento principal
// ---------------------------------------------------------------------------

async function generateCreativeDirection(
  leadId: string,
  title: string,
  matrix: ExtractorResult,
): Promise<CreativeDirection> {
  const prompt = buildCreativeDirectorPrompt(title, matrix);
  const raw = await generateWithGemini(prompt);

  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error("Gemini não retornou JSON válido na direção criativa");
  }

  const parsed = JSON.parse(jsonMatch[0]);
  parsed.lead_id = leadId;
  parsed.lead_title = title;

  return creativeDirectionSchema.parse(parsed);
}

async function processLead(leadId: string): Promise<ImageGenResult> {
  const supabase = getSupabaseAdmin();

  // 1. Carregar lead + structural_matrix (obrigatória — vem do A1).
  const { data: lead, error: leadErr } = await (supabase as any)
    .from("product_leads")
    .select("id, title, metadata, status")
    .eq("id", leadId)
    .single();

  if (leadErr || !lead) {
    throw new Error(`Lead não encontrado: ${leadErr?.message ?? "sem retorno"}`);
  }

  const meta = (lead.metadata ?? {}) as Record<string, unknown>;
  const structuralMatrix = meta.structural_matrix;
  if (!structuralMatrix) {
    throw new Error(`Lead ${leadId} sem structural_matrix — rode o A1 antes.`);
  }
  const matrix = extractorResultSchema.parse(structuralMatrix);

  // 2. Reutilizar creative_direction se já existir (economia de Gemini em
  //    reprocessamento). Caso contrário, gerar via Gemini.
  let direction: CreativeDirection;
  const existing = meta.creative_direction;
  if (existing) {
    const check = creativeDirectionSchema.safeParse(existing);
    direction = check.success
      ? check.data
      : await generateCreativeDirection(leadId, lead.title, matrix);
  } else {
    direction = await generateCreativeDirection(leadId, lead.title, matrix);
  }

  // 3. Persistir creative_direction no metadata ANTES das imagens.
  //    Se as imagens falharem todas, o artefato textual do Gemini não se perde.
  const metaWithDirection = { ...meta, creative_direction: direction };
  const { error: dirUpdErr } = await (supabase as any)
    .from("product_leads")
    .update({ metadata: metaWithDirection })
    .eq("id", leadId);
  if (dirUpdErr) {
    throw new Error(`Falha ao gravar creative_direction: ${dirUpdErr.message}`);
  }

  // 4. Gerar imagens (concorrência + retry).
  const outcomes = await runBounded(
    direction.visual_prompts,
    IMAGE_CONCURRENCY,
    (vp) => generateAndUploadOne(leadId, vp),
  );

  const generatedImages: GeneratedImage[] = [];
  const failures: ImageGenResult["failures"] = [];
  outcomes.forEach((o, idx) => {
    if (o.ok) {
      generatedImages.push(o.value);
    } else {
      failures.push({
        scene_index: direction.visual_prompts[idx].scene_index,
        phase: direction.visual_prompts[idx].phase,
        error: o.error,
      });
    }
  });

  if (generatedImages.length === 0) {
    throw new Error(
      `Lead ${leadId}: todas as ${direction.visual_prompts.length} cenas falharam — ` +
        `erros: ${failures.map((f) => f.error).join(" | ")}`,
    );
  }

  // 5. Finalizar: salvar generated_images + promover status.
  const finalMetadata = {
    ...metaWithDirection,
    generated_images: generatedImages,
    generated_images_failures: failures.length > 0 ? failures : undefined,
  };

  const { error: updateErr } = await (supabase as any)
    .from("product_leads")
    .update({ metadata: finalMetadata, status: "images_generated" })
    .eq("id", leadId);

  if (updateErr) {
    throw new Error(`Falha ao atualizar lead: ${updateErr.message}`);
  }

  return {
    lead_id: leadId,
    lead_title: lead.title,
    creative_direction: direction,
    generated_images: generatedImages,
    failures,
  };
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

interface A3RunnerResult {
  lead_id: string;
  lead_title: string;
  images_count: number;
  failures_count: number;
  generated_images: GeneratedImage[];
  [key: string]: Json | undefined;
}

export function runWorkerA3Tick(
  args: AgentTickArgs = {},
): Promise<AgentTickResult> {
  return runAgentTick<ImageGenTaskPayload, A3RunnerResult>(
    {
      agent: "a3",
      label: "Script+Images a3",
      payloadSchema: imageGenTaskPayloadSchema,
      process: async (payload) => {
        const result = await processLead(payload.lead_id);
        return {
          kind: "done",
          result: {
            lead_id: result.lead_id,
            lead_title: result.lead_title,
            images_count: result.generated_images.length,
            failures_count: result.failures.length,
            generated_images: result.generated_images,
          },
        };
      },
    },
    args,
  );
}

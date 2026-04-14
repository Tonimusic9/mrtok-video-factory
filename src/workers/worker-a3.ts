/**
 * Worker a3 — Gerador de Keyframes via Nano Banana 2 (FAL.ai).
 *
 * Consome leads com status `directed` (alimentados pelo Worker a2 via
 * chaining) e materializa cada `visual_prompt` em uma imagem real, fazendo
 * upload para o bucket `mrtok-images` do Supabase Storage e persistindo as
 * URLs no `metadata.generated_images` do lead. Ao final promove o status
 * para `images_generated` — gatilho para o Worker a4/a5 no pipeline.
 *
 * Engine: Nano Banana 2 (Google Gemini 3 Image) via FAL.ai.
 * Slug default: `fal-ai/nano-banana` (sobrescrevível via env FAL_NANO_BANANA_SLUG).
 *
 * REGRA DE OURO (ROI & Custos): esta é a primeira materialização paga do
 * pipeline. Antes de disparar chamadas FAL, validamos rigorosamente a
 * presença e integridade de `creative_direction.visual_prompts` no lead.
 * REGRA DE OURO (Dados): este worker NUNCA escreve em `creative_matrix`.
 * Limita-se a `task_queue.result` e `product_leads.metadata`.
 */
import { z } from "zod";
import {
  runAgentTick,
  type AgentTickArgs,
  type AgentTickResult,
} from "@/lib/agent-runner";
import { submitAndPollImage } from "@/lib/fal-client";
import { getSupabaseAdmin } from "@/lib/supabase";
import { creativeDirectorResultSchema } from "@/workers/worker-a2";
import type { Json } from "@/types/database";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const NANO_BANANA_SLUG =
  process.env.FAL_NANO_BANANA_SLUG?.trim() || "fal-ai/nano-banana";

const STORAGE_BUCKET = "mrtok-images";

/** Concorrência máxima simultânea por lead (FAL suporta, mas limitamos p/ ROI). */
const IMAGE_CONCURRENCY = 2;

/** Retries por prompt em caso de falha transitória na FAL. */
const MAX_RETRIES_PER_PROMPT = 2;

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

export const imageGenTaskPayloadSchema = z.object({
  lead_id: z.string().uuid(),
  parent_task_id: z.string().uuid().optional(),
});
export type ImageGenTaskPayload = z.infer<typeof imageGenTaskPayloadSchema>;

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
// Helpers
// ---------------------------------------------------------------------------

async function downloadImage(url: string): Promise<{ buffer: Buffer; contentType: string }> {
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
  visualPrompt: {
    scene_index: number;
    phase: string;
    nano_banana_prompt: string;
    negative_prompt: string;
  },
): Promise<GeneratedImage> {
  const supabase = getSupabaseAdmin();

  let lastErr: Error | null = null;
  for (let attempt = 1; attempt <= MAX_RETRIES_PER_PROMPT + 1; attempt++) {
    try {
      // 1. Disparar FAL.ai Nano Banana 2.
      const job = await submitAndPollImage({
        slug: NANO_BANANA_SLUG,
        input: {
          prompt: visualPrompt.nano_banana_prompt,
          negative_prompt: visualPrompt.negative_prompt,
          // Resolução canônica 720x1280 (9:16). Nano Banana aceita image_size
          // como preset ou objeto {width,height} dependendo da versão.
          image_size: { width: 720, height: 1280 },
          num_images: 1,
        },
      });

      // 2. Download do CDN da FAL.
      const { buffer, contentType } = await downloadImage(job.image_url);

      // 3. Upload no bucket `mrtok-images` do Supabase Storage.
      const ext = extForContentType(contentType);
      const storagePath = `leads/${leadId}/scene-${visualPrompt.scene_index}-${visualPrompt.phase}.${ext}`;

      const { error: upErr } = await supabase.storage
        .from(STORAGE_BUCKET)
        .upload(storagePath, buffer, {
          contentType,
          upsert: true,
        });
      if (upErr) {
        throw new Error(`storage.upload: ${upErr.message}`);
      }

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

/**
 * Executa promises em lotes com concorrência `limit`. Simples e sem
 * dependência externa — mantém o worker livre de `p-limit` etc.
 */
async function runBounded<T, R>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<R>,
): Promise<Array<{ ok: true; value: R } | { ok: false; error: string; item: T }>> {
  const results: Array<{ ok: true; value: R } | { ok: false; error: string; item: T }> =
    new Array(items.length);
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

async function processLead(leadId: string): Promise<ImageGenResult> {
  const supabase = getSupabaseAdmin();

  // 1. Buscar lead com creative_direction no metadata.
  const { data: lead, error: leadErr } = await (supabase as any)
    .from("product_leads")
    .select("id, title, metadata, status")
    .eq("id", leadId)
    .single();

  if (leadErr || !lead) {
    throw new Error(`Lead não encontrado: ${leadErr?.message ?? "sem retorno"}`);
  }

  const meta = (lead.metadata ?? {}) as Record<string, unknown>;
  const direction = meta.creative_direction;
  if (!direction) {
    throw new Error(
      `Lead ${leadId} não possui creative_direction. Rode o a2 antes.`,
    );
  }

  // Validar integridade antes de gastar chamadas FAL (REGRA DE OURO: ROI).
  const parsedDirection = creativeDirectorResultSchema.parse(direction);
  const visualPrompts = parsedDirection.visual_prompts;
  if (visualPrompts.length === 0) {
    throw new Error(`Lead ${leadId}: visual_prompts vazio — abortando`);
  }

  // 2. Gerar + upload com concorrência controlada.
  const outcomes = await runBounded(visualPrompts, IMAGE_CONCURRENCY, (vp) =>
    generateAndUploadOne(leadId, vp),
  );

  const generatedImages: GeneratedImage[] = [];
  const failures: ImageGenResult["failures"] = [];
  outcomes.forEach((o, idx) => {
    if (o.ok) {
      generatedImages.push(o.value);
    } else {
      failures.push({
        scene_index: visualPrompts[idx].scene_index,
        phase: visualPrompts[idx].phase,
        error: o.error,
      });
    }
  });

  if (generatedImages.length === 0) {
    throw new Error(
      `Lead ${leadId}: todas ${visualPrompts.length} cenas falharam — ` +
        `erros: ${failures.map((f) => f.error).join(" | ")}`,
    );
  }

  // 3. Atualizar metadata + status do lead.
  const updatedMetadata = {
    ...meta,
    generated_images: generatedImages,
    generated_images_failures: failures.length > 0 ? failures : undefined,
  };

  const { error: updateErr } = await (supabase as any)
    .from("product_leads")
    .update({
      metadata: updatedMetadata,
      status: "images_generated",
    })
    .eq("id", leadId);

  if (updateErr) {
    throw new Error(`Falha ao atualizar lead: ${updateErr.message}`);
  }

  return {
    lead_id: leadId,
    lead_title: lead.title,
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
      label: "Nano Banana a3",
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

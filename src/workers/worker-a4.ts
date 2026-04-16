/**
 * Worker a4 — Diretor de Arte / Gerador de Vídeo (V23.1-stabilize).
 *
 * Consome leads com status `images_generated` (keyframes PNG + creative_direction
 * gerados pelo A3) e converte cada imagem em um clipe MP4 via FAL.ai.
 *
 * MODO ESTABILIZAÇÃO: Kling 1.5 Pro como provider primário (validado).
 * Seedance 2.0 DESATIVADO temporariamente (slug correto mas timeouts crônicos).
 * Upgrade para Kling 3.1 agendado para próxima sessão.
 *
 * Prompting: motion_prompt derivado do `creative_direction.motion_buckets`
 * (produzido pelo A3) + estética UGC canônica (iPhone 17 Pro Max, luz natural).
 * Tokens de realismo atenuados para evitar Safety Filter.
 *
 * REGRA DE OURO (ROI): chamada paga à FAL só ocorre após validar rigorosamente
 * `generated_images` + `creative_direction.motion_buckets`. Nenhum byte é
 * desperdiçado em lead incompleto.
 * REGRA DE OURO (Dados): nunca escreve em `creative_matrix` — apenas em
 * `product_leads.metadata` e `task_queue.result` (via runner).
 */
import { z } from "zod";
import {
  runAgentTick,
  type AgentTickArgs,
  type AgentTickResult,
} from "@/lib/agent-runner";
import { submitAndPoll } from "@/lib/fal-client";
import { getSupabaseAdmin } from "@/lib/supabase";
import type { Json } from "@/types/database";
import {
  creativeDirectionSchema,
  type CreativeDirection,
} from "@/workers/worker-a3";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

// --- Seedance 2.0 DESATIVADO (timeouts crônicos na fila) ---
// const SEEDANCE_SLUG =
//   process.env.FAL_SEEDANCE_I2V_SLUG?.trim() ||
//   "bytedance/seedance-2.0/image-to-video";

/** Provider primário: Kling 1.5 Pro (estável, validado via Context7). */
const KLING_SLUG =
  process.env.FAL_KLING_I2V_SLUG?.trim() ||
  "fal-ai/kling-video/v1.5/pro/image-to-video";

const STORAGE_BUCKET = "mrtok-videos";
const VIDEO_CONCURRENCY = 2;
/** ZERO retries — One-Shot ou nada (modo estabilização). */
const MAX_RETRIES_PER_SCENE = 0;

/** Kling 1.5 Pro: duration é enum string "5" ou "10". */
const KLING_DURATION: "5" | "10" = "5";

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

export const videoGenTaskPayloadSchema = z.object({
  lead_id: z.string().uuid(),
  parent_task_id: z.string().uuid().optional(),
});
export type VideoGenTaskPayload = z.infer<typeof videoGenTaskPayloadSchema>;

const generatedImageRefSchema = z.object({
  scene_index: z.number().int(),
  phase: z.string(),
  public_url: z.string().url(),
  storage_path: z.string().optional(),
  fal_request_id: z.string().optional(),
  duration_ms: z.number().optional(),
});
type GeneratedImageRef = z.infer<typeof generatedImageRefSchema>;

const generatedVideoSchema = z.object({
  scene_index: z.number().int(),
  phase: z.string(),
  storage_path: z.string(),
  public_url: z.string().url(),
  provider: z.enum(["seedance_2_0", "kling_1_5_pro", "kling_3_1"]),
  fal_request_id: z.string(),
  duration_seconds: z.number().nonnegative(),
  duration_ms: z.number().nonnegative(),
});
export type GeneratedVideo = z.infer<typeof generatedVideoSchema>;

// ---------------------------------------------------------------------------
// Prompt builder (simplificação do skill video-prompt-builder para 1 clipe)
// ---------------------------------------------------------------------------

/** Estética UGC atenuada — sem menção a marcas específicas para evitar Safety Filter. */
const UGC_ESTETHICA =
  "Cinematic smartphone footage, natural daylight, casual framing, organic handheld feel, no post-processing.";

function buildMotionPrompt(
  motion: CreativeDirection["motion_buckets"][number],
): string {
  const intensityHint =
    motion.intensity === "high"
      ? "High energy: rapid, punchy motion with visible kinetic force."
      : motion.intensity === "low"
        ? "Low energy: slow, intimate motion, minimal camera travel."
        : "Medium energy: steady motion with deliberate pacing.";

  return [
    motion.motion_prompt,
    `Camera: ${motion.camera_movement}.`,
    intensityHint,
    UGC_ESTETHICA,
    "9:16 vertical, 720p.",
  ].join(" ");
}

// ---------------------------------------------------------------------------
// Helpers — Storage / FAL
// ---------------------------------------------------------------------------

async function downloadVideo(url: string): Promise<Buffer> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`download mp4 falhou (${res.status}) para ${url}`);
  }
  const arr = await res.arrayBuffer();
  return Buffer.from(arr);
}

async function uploadVideo(
  leadId: string,
  sceneIndex: number,
  phase: string,
  buffer: Buffer,
): Promise<{ storage_path: string; public_url: string }> {
  const supabase = getSupabaseAdmin();
  const storagePath = `leads/${leadId}/scene-${sceneIndex}-${phase}.mp4`;
  const { error: upErr } = await supabase.storage
    .from(STORAGE_BUCKET)
    .upload(storagePath, buffer, {
      contentType: "video/mp4",
      upsert: true,
    });
  if (upErr) throw new Error(`storage.upload video: ${upErr.message}`);
  const { data: pub } = supabase.storage
    .from(STORAGE_BUCKET)
    .getPublicUrl(storagePath);
  return { storage_path: storagePath, public_url: pub.publicUrl };
}

interface SceneJob {
  image: GeneratedImageRef;
  motion: CreativeDirection["motion_buckets"][number];
}

// ---------------------------------------------------------------------------
// Circuit Breaker — mata o processo em erros não-recuperáveis (400, safety)
// ---------------------------------------------------------------------------

const FATAL_PATTERNS = [
  "safety filter",
  "safety_filter",
  "content_policy",
  "validation error",
  "invalid_parameter",
  "not found",
] as const;

function isFatalError(msg: string): boolean {
  const lower = msg.toLowerCase();
  return FATAL_PATTERNS.some((p) => lower.includes(p)) || lower.includes("(400)");
}

async function runKling(
  scene: SceneJob,
): Promise<{ request_id: string; video_url: string; duration_ms: number }> {
  const motionPrompt = buildMotionPrompt(scene.motion);
  console.log(
    `[a4] Kling 1.5 Pro cena ${scene.image.scene_index} prompt: ${motionPrompt.slice(0, 200)}`,
  );
  console.log("[CUIDADO] Iniciando chamada paga - Motor: Kling 1.5 Pro");

  try {
    return await submitAndPoll({
      slug: KLING_SLUG,
      input: {
        prompt: motionPrompt,
        image_url: scene.image.public_url,
        duration: KLING_DURATION,
        aspect_ratio: "9:16",
        negative_prompt: "blur, distort, low quality, watermark, text overlay",
        cfg_scale: 0.5,
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (isFatalError(msg)) {
      console.error(`[CIRCUIT BREAKER] Erro fatal detectado — abortando processo: ${msg}`);
      process.exit(1);
    }
    throw err;
  }
}

async function generateOne(
  leadId: string,
  scene: SceneJob,
): Promise<GeneratedVideo> {
  // Kling 1.5 Pro com retries (provider primário — modo estabilização).
  let lastErr: Error | null = null;
  for (let attempt = 1; attempt <= MAX_RETRIES_PER_SCENE + 1; attempt++) {
    try {
      const job = await runKling(scene);
      const buffer = await downloadVideo(job.video_url);
      const upl = await uploadVideo(
        leadId,
        scene.image.scene_index,
        scene.image.phase,
        buffer,
      );
      return {
        scene_index: scene.image.scene_index,
        phase: scene.image.phase,
        storage_path: upl.storage_path,
        public_url: upl.public_url,
        provider: "kling_1_5_pro",
        fal_request_id: job.request_id,
        duration_seconds: Number(KLING_DURATION),
        duration_ms: job.duration_ms,
      };
    } catch (err) {
      lastErr = err instanceof Error ? err : new Error(String(err));
      console.warn(
        `[a4] kling 1.5 pro tentativa ${attempt}/${MAX_RETRIES_PER_SCENE + 1} cena ${scene.image.scene_index} falhou: ${lastErr.message}`,
      );
      if (attempt <= MAX_RETRIES_PER_SCENE) {
        await new Promise((r) => setTimeout(r, 3_000 * attempt));
      }
    }
  }

  throw new Error(
    `kling 1.5 pro esgotou ${MAX_RETRIES_PER_SCENE + 1} tentativas cena ${scene.image.scene_index}: ${lastErr?.message ?? "?"}`,
  );
}

async function runBounded<T, R>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<R>,
): Promise<
  Array<{ ok: true; value: R } | { ok: false; error: string; item: T }>
> {
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

async function processLead(leadId: string): Promise<{
  lead_id: string;
  lead_title: string;
  generated_videos: GeneratedVideo[];
  failures: Array<{ scene_index: number; phase: string; error: string }>;
}> {
  const supabase = getSupabaseAdmin();

  const { data: lead, error: leadErr } = await (supabase as any)
    .from("product_leads")
    .select("id, title, metadata")
    .eq("id", leadId)
    .single();

  if (leadErr || !lead) {
    throw new Error(`Lead não encontrado: ${leadErr?.message ?? "sem retorno"}`);
  }

  const meta = (lead.metadata ?? {}) as Record<string, unknown>;

  // Validar tudo ANTES de qualquer chamada FAL.
  const rawImages = meta.generated_images;
  if (!Array.isArray(rawImages) || rawImages.length === 0) {
    throw new Error(`Lead ${leadId} sem generated_images — rode o A3 antes.`);
  }
  const images = z.array(generatedImageRefSchema).parse(rawImages);

  const rawDirection = meta.creative_direction;
  if (!rawDirection) {
    throw new Error(
      `Lead ${leadId} sem creative_direction — inconsistência de estado.`,
    );
  }
  const direction = creativeDirectionSchema.parse(rawDirection);

  // Join por scene_index: só processa cenas com imagem E motion bucket.
  const allJobs: SceneJob[] = [];
  for (const img of images) {
    const motion = direction.motion_buckets.find(
      (m) => m.scene_index === img.scene_index,
    );
    if (motion) allJobs.push({ image: img, motion });
  }
  if (allJobs.length === 0) {
    throw new Error(
      `Lead ${leadId}: nenhuma cena com imagem+motion correspondentes`,
    );
  }

  // Stop-loss: limitar a 1 cena no modo estabilização.
  const MAX_SCENES = 1;
  const jobs = allJobs.slice(0, MAX_SCENES);
  console.log(`[a4] Processando ${jobs.length}/${allJobs.length} cenas (MAX_SCENES=${MAX_SCENES})`);

  const outcomes = await runBounded(jobs, VIDEO_CONCURRENCY, (job) =>
    generateOne(leadId, job),
  );

  const generatedVideos: GeneratedVideo[] = [];
  const failures: Array<{ scene_index: number; phase: string; error: string }> =
    [];
  outcomes.forEach((o, idx) => {
    if (o.ok) {
      generatedVideos.push(o.value);
    } else {
      failures.push({
        scene_index: jobs[idx].image.scene_index,
        phase: jobs[idx].image.phase,
        error: o.error,
      });
    }
  });

  if (generatedVideos.length === 0) {
    throw new Error(
      `Lead ${leadId}: todas ${jobs.length} cenas falharam — ` +
        `erros: ${failures.map((f) => f.error).join(" | ")}`,
    );
  }

  const updatedMetadata = {
    ...meta,
    generated_videos: generatedVideos,
    generated_videos_failures: failures.length > 0 ? failures : undefined,
  };

  const { error: updateErr } = await (supabase as any)
    .from("product_leads")
    .update({ metadata: updatedMetadata, status: "videos_generated" })
    .eq("id", leadId);

  if (updateErr) {
    throw new Error(`Falha ao atualizar lead: ${updateErr.message}`);
  }

  return {
    lead_id: leadId,
    lead_title: lead.title,
    generated_videos: generatedVideos,
    failures,
  };
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

interface A4RunnerResult {
  lead_id: string;
  lead_title: string;
  videos_count: number;
  failures_count: number;
  generated_videos: GeneratedVideo[];
  [key: string]: Json | undefined;
}

export function runWorkerA4Tick(
  args: AgentTickArgs = {},
): Promise<AgentTickResult> {
  return runAgentTick<VideoGenTaskPayload, A4RunnerResult>(
    {
      agent: "a4",
      label: "Diretor Arte a4",
      payloadSchema: videoGenTaskPayloadSchema,
      process: async (payload) => {
        const result = await processLead(payload.lead_id);
        return {
          kind: "done",
          result: {
            lead_id: result.lead_id,
            lead_title: result.lead_title,
            videos_count: result.generated_videos.length,
            failures_count: result.failures.length,
            generated_videos: result.generated_videos,
          },
        };
      },
    },
    args,
  );
}

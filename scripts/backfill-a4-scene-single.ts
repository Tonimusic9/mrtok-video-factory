/**
 * Backfill mínimo A4 — 1 cena Kling v3 Pro i2v por invocação.
 *
 * Propagação REAL controlada:
 * - chama fal-ai/kling-video/v3/pro/image-to-video 1 vez (cena definida por SCENE_INDEX)
 * - baixa, sobrescreve path produtivo `leads/<id>/scene-<N>-<phase>.mp4`
 * - substitui apenas a entrada scene_index=N em `metadata.generated_videos`
 * - mantém demais cenas/campos inalterados, mantém status do lead inalterado
 * - não toca `creative_matrix`, `task_queue`, `product_leads.status`
 *
 * Trava financeira: exige A4_AUTHORIZE=PAGAR no env.
 * Espelha contrato do worker-a4 (prompt builder + input FAL idênticos).
 */
import { config } from "dotenv";
config({ path: ".env.local" });
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { createClient } from "@supabase/supabase-js";
import { submitAndPoll } from "../src/lib/fal-client";

const LEAD_ID = process.env.LEAD_ID;
const SCENE_INDEX = Number(process.env.SCENE_INDEX ?? "1");
const STORAGE_BUCKET = "mrtok-videos";
const KLING_SLUG = "fal-ai/kling-video/v3/pro/image-to-video";
const KLING_DURATION = "5" as const;
const PRICE_PER_SECOND_NO_AUDIO = 0.112;
const UGC_ESTETHICA =
  "Cinematic smartphone footage, natural daylight, casual framing, organic handheld feel, no post-processing.";
const NEGATIVE_PROMPT = "blur, distort, low quality, watermark, text overlay";

interface GeneratedImage {
  scene_index: number;
  phase: string;
  storage_path: string;
  public_url: string;
}
interface MotionBucket {
  scene_index: number;
  phase: string;
  motion_prompt: string;
  camera_movement: string;
  intensity: "low" | "medium" | "high";
  duration_seconds?: number;
}
interface GeneratedVideo {
  scene_index: number;
  phase: string;
  storage_path: string;
  public_url: string;
  provider: "seedance_2_0" | "kling_1_5_pro" | "kling_3_1";
  fal_request_id: string;
  duration_seconds: number;
  duration_ms: number;
}

function buildMotionPrompt(m: MotionBucket): string {
  const intensityHint =
    m.intensity === "high"
      ? "High energy: rapid, punchy motion with visible kinetic force."
      : m.intensity === "low"
        ? "Low energy: slow, intimate motion, minimal camera travel."
        : "Medium energy: steady motion with deliberate pacing.";
  return [
    m.motion_prompt,
    `Camera: ${m.camera_movement}.`,
    intensityHint,
    UGC_ESTETHICA,
    "9:16 vertical, 720p.",
  ].join(" ");
}

function ffprobe(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn("ffprobe", [
      "-v",
      "error",
      "-show_entries",
      "stream=width,height,codec_name,r_frame_rate,duration",
      "-of",
      "json",
      filePath,
    ]);
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d) => (stdout += d));
    proc.stderr.on("data", (d) => (stderr += d));
    proc.on("close", (code) => {
      if (code !== 0) reject(new Error(`ffprobe exit=${code} ${stderr}`));
      else resolve(stdout);
    });
  });
}

async function main() {
  if (process.env.A4_AUTHORIZE !== "PAGAR") {
    console.error(
      `[backfill-a4-scene] ❌ A4_AUTHORIZE=PAGAR ausente — abort sem FAL.`,
    );
    process.exit(1);
  }
  if (!process.env.FAL_KEY) {
    console.error("[backfill-a4-scene] ❌ FAL_KEY ausente");
    process.exit(1);
  }
  if (!LEAD_ID) {
    console.error("[backfill-a4-scene] ❌ LEAD_ID ausente no env — abort sem FAL.");
    process.exit(1);
  }

  const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );

  const { data: lead, error: leadErr } = await supabase
    .from("product_leads")
    .select("id, title, status, metadata")
    .eq("id", LEAD_ID)
    .single();
  if (leadErr || !lead) {
    console.error(`[backfill-a4-scene] lead not found: ${leadErr?.message}`);
    process.exit(1);
  }
  const meta = ((lead as { metadata?: Record<string, unknown> }).metadata ??
    {}) as Record<string, unknown>;

  const imgs = (meta.generated_images as GeneratedImage[] | undefined) ?? [];
  const motionBuckets =
    (meta.creative_direction as { motion_buckets?: MotionBucket[] } | undefined)
      ?.motion_buckets ?? [];
  const img = imgs.find((i) => i.scene_index === SCENE_INDEX);
  const motion = motionBuckets.find((m) => m.scene_index === SCENE_INDEX);
  if (!img || !motion) {
    console.error(
      `[backfill-a4-scene] scene=${SCENE_INDEX} não tem generated_images OU motion_buckets — abort sem FAL.`,
    );
    process.exit(1);
  }

  const prompt = buildMotionPrompt(motion);
  const existingVideos =
    (meta.generated_videos as GeneratedVideo[] | undefined) ?? [];
  const storagePath = `leads/${LEAD_ID}/scene-${SCENE_INDEX}-${img.phase}.mp4`;
  const estUSD = (Number(KLING_DURATION) * PRICE_PER_SECOND_NO_AUDIO).toFixed(2);

  console.log(`=== BACKFILL A4 SCENE-${SCENE_INDEX} — Kling v3 Pro ===`);
  console.log(`lead=${LEAD_ID} status=${(lead as { status: string }).status}`);
  console.log(`slug=${KLING_SLUG} duration=${KLING_DURATION}s estUSD=$${estUSD}`);
  console.log(`start_image_url=${img.public_url}`);
  console.log(`upload_path=${STORAGE_BUCKET}/${storagePath}`);
  console.log(
    `writes planned: storage upsert + metadata.generated_videos[scene=${SCENE_INDEX}] replace`,
  );
  console.log(`creative_matrix=UNTOUCHED  status=UNTOUCHED  task_queue=UNTOUCHED\n`);

  console.log("[backfill-a4-scene] Disparando submitAndPoll...");
  const t0 = Date.now();
  const job = await submitAndPoll({
    slug: KLING_SLUG,
    input: {
      prompt,
      start_image_url: img.public_url,
      duration: KLING_DURATION,
      generate_audio: false,
      negative_prompt: NEGATIVE_PROMPT,
      cfg_scale: 0.5,
    },
  });
  console.log(
    `[backfill-a4-scene] FAL OK: request_id=${job.request_id} duration_ms=${job.duration_ms}`,
  );

  const res = await fetch(job.video_url);
  if (!res.ok) {
    console.error(`[backfill-a4-scene] ❌ download falhou: ${res.status}`);
    process.exit(2);
  }
  const buffer = Buffer.from(await res.arrayBuffer());
  const tmpPath = path.join(
    os.tmpdir(),
    `backfill-a4-scene${SCENE_INDEX}-${Date.now()}.mp4`,
  );
  await fs.writeFile(tmpPath, buffer);

  let probe: unknown = "(ffprobe indisponível)";
  try {
    probe = JSON.parse(await ffprobe(tmpPath));
  } catch (e) {
    probe = `ffprobe falhou: ${e instanceof Error ? e.message : String(e)}`;
  }

  const { error: upErr } = await supabase.storage
    .from(STORAGE_BUCKET)
    .upload(storagePath, buffer, {
      contentType: "video/mp4",
      upsert: true,
    });
  if (upErr) {
    console.error(`[backfill-a4-scene] ❌ upload falhou: ${upErr.message}`);
    process.exit(3);
  }
  const { data: pub } = supabase.storage
    .from(STORAGE_BUCKET)
    .getPublicUrl(storagePath);

  const newEntry: GeneratedVideo = {
    scene_index: SCENE_INDEX,
    phase: img.phase,
    storage_path: storagePath,
    public_url: pub.publicUrl,
    provider: "kling_3_1",
    fal_request_id: job.request_id,
    duration_seconds: Number(KLING_DURATION),
    duration_ms: job.duration_ms,
  };
  const nextVideos: GeneratedVideo[] = [
    newEntry,
    ...existingVideos.filter((v) => v.scene_index !== SCENE_INDEX),
  ].sort((a, b) => a.scene_index - b.scene_index);

  const nextMeta = { ...meta, generated_videos: nextVideos };
  const { error: updErr } = await supabase
    .from("product_leads")
    .update({ metadata: nextMeta })
    .eq("id", LEAD_ID);
  if (updErr) {
    console.error(`[backfill-a4-scene] ❌ update falhou: ${updErr.message}`);
    process.exit(4);
  }

  const totalMs = Date.now() - t0;
  console.log("\n=== RESULTADO ===");
  console.log(
    JSON.stringify(
      {
        ok: true,
        scene_index: SCENE_INDEX,
        request_id: job.request_id,
        fal_duration_ms: job.duration_ms,
        total_ms: totalMs,
        mp4_bytes: buffer.length,
        tmp_path: tmpPath,
        upload: {
          bucket: STORAGE_BUCKET,
          path: storagePath,
          public_url: pub.publicUrl,
        },
        ffprobe: probe,
        writes: {
          storage_upsert: true,
          metadata_generated_videos_scene_replaced: SCENE_INDEX,
          status_changed: false,
          creative_matrix_touched: false,
          task_queue_touched: false,
        },
      },
      null,
      2,
    ),
  );
}

main().catch((err) => {
  console.error("[backfill-a4-scene] FATAL:", err);
  process.exit(1);
});

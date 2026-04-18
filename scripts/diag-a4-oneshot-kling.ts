/**
 * Diag one-shot — 1 único vídeo Kling v3 Pro i2v (Via B isolada).
 *
 * Isolamento duro:
 * - ZERO escrita em `product_leads` (nem status, nem metadata.generated_videos)
 * - upload em caminho diagnóstico separado: leads/<id>/diag-scene-1.mp4
 * - sem chain, sem Remotion, sem worker-a6, sem fallback
 *
 * Contrato FAL homologado (espelha worker-a4.ts):
 *   slug = fal-ai/kling-video/v3/pro/image-to-video
 *   input = { prompt, start_image_url, duration:"5", generate_audio:false,
 *             negative_prompt, cfg_scale:0.5 }
 *
 * Trava de pagamento:
 *   - por padrão readline interativo pedindo "PAGAR"
 *   - para execução não-interativa, setar env A4_DIAG_AUTHORIZE=PAGAR
 */
import { config } from "dotenv";
config({ path: ".env.local" });
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import readline from "node:readline/promises";
import { spawn } from "node:child_process";
import { createClient } from "@supabase/supabase-js";
import { submitAndPoll } from "../src/lib/fal-client";

const LEAD_ID = process.env.LEAD_ID;
const STORAGE_BUCKET = "mrtok-videos";
const DIAG_PATH = `leads/${LEAD_ID}/diag-scene-1.mp4`;
const KLING_SLUG = "fal-ai/kling-video/v3/pro/image-to-video";
const KLING_DURATION = "5" as const;
const PRICE_PER_SECOND_NO_AUDIO = 0.112;
const UGC_ESTETHICA =
  "Cinematic smartphone footage, natural daylight, casual framing, organic handheld feel, no post-processing.";
const NEGATIVE_PROMPT =
  "blur, distort, low quality, watermark, text overlay";

interface GeneratedImageRef {
  scene_index: number;
  phase: string;
  public_url: string;
  storage_path?: string;
}
interface MotionBucket {
  scene_index: number;
  phase: string;
  motion_prompt: string;
  camera_movement: string;
  intensity: "low" | "medium" | "high";
  duration_seconds?: number;
}

function buildMotionPrompt(motion: MotionBucket): string {
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

async function confirmPayment(estUSD: string): Promise<void> {
  const envAuth = process.env.A4_DIAG_AUTHORIZE?.trim();
  if (envAuth === "PAGAR") {
    console.log(
      `[diag-a4] A4_DIAG_AUTHORIZE=PAGAR detectado — pulando readline (≈$${estUSD}).`,
    );
    return;
  }
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  const answer = await rl.question(
    `⚠️  DIAG 1-VIDEO Kling v3 Pro 5s (≈$${estUSD}). Digite "PAGAR" para continuar: `,
  );
  rl.close();
  if (answer !== "PAGAR") {
    console.log("[diag-a4] Abortado pelo usuário.");
    process.exit(1);
  }
}

function ffprobe(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn("ffprobe", [
      "-v",
      "error",
      "-show_entries",
      "stream=width,height,codec_name,r_frame_rate,duration:format=duration,size,format_name",
      "-of",
      "json",
      filePath,
    ]);
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d) => (stdout += d));
    proc.stderr.on("data", (d) => (stderr += d));
    proc.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`ffprobe exit=${code} stderr=${stderr}`));
        return;
      }
      resolve(stdout);
    });
  });
}

async function main() {
  if (!process.env.FAL_KEY) {
    console.error("[diag-a4] ❌ FAL_KEY ausente em .env.local");
    process.exit(1);
  }
  if (!LEAD_ID) {
    console.error("[diag-a4] ❌ LEAD_ID ausente no env — abort sem FAL.");
    process.exit(1);
  }

  const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );

  // 1. Carrega lead (READ-ONLY)
  const { data: lead, error: leadErr } = await supabase
    .from("product_leads")
    .select("id, title, status, metadata")
    .eq("id", LEAD_ID)
    .single();
  if (leadErr || !lead) {
    console.error(`[diag-a4] lead not found: ${leadErr?.message}`);
    process.exit(1);
  }
  const meta = ((lead as { metadata?: Record<string, unknown> }).metadata ??
    {}) as Record<string, unknown>;

  const images = meta.generated_images as GeneratedImageRef[] | undefined;
  const motionBuckets = (
    meta.creative_direction as { motion_buckets?: MotionBucket[] } | undefined
  )?.motion_buckets;
  if (!images || !motionBuckets) {
    console.error(
      `[diag-a4] lead sem generated_images ou motion_buckets — abort (sem FAL).`,
    );
    process.exit(1);
  }
  const cena1 = images.find((i) => i.scene_index === 1);
  const motion1 = motionBuckets.find((m) => m.scene_index === 1);
  if (!cena1 || !motion1) {
    console.error(`[diag-a4] cena_1 ausente em images ou motion_buckets.`);
    process.exit(1);
  }

  const prompt = buildMotionPrompt(motion1);
  const estUSD = (Number(KLING_DURATION) * PRICE_PER_SECOND_NO_AUDIO).toFixed(
    2,
  );

  console.log("=== DIAG A4 1-VIDEO — Kling v3 Pro ===");
  console.log(`lead=${LEAD_ID} status=${(lead as { status: string }).status}`);
  console.log(`slug=${KLING_SLUG}`);
  console.log(`start_image_url=${cena1.public_url}`);
  console.log(`duration=${KLING_DURATION}s estUSD=$${estUSD}`);
  console.log(`prompt="${prompt.slice(0, 240)}..."`);
  console.log(`upload_path=${STORAGE_BUCKET}/${DIAG_PATH}`);
  console.log(`DB_WRITE=OFF (product_leads NÃO será mutado)\n`);

  // 2. Trava financeira
  await confirmPayment(estUSD);

  // 3. Chamada FAL (one-shot, sem retry)
  console.log("[diag-a4] Disparando submitAndPoll...");
  const t0 = Date.now();
  const job = await submitAndPoll({
    slug: KLING_SLUG,
    input: {
      prompt,
      start_image_url: cena1.public_url,
      duration: KLING_DURATION,
      generate_audio: false,
      negative_prompt: NEGATIVE_PROMPT,
      cfg_scale: 0.5,
    },
  });
  console.log(
    `[diag-a4] FAL OK: request_id=${job.request_id} duration_ms=${job.duration_ms}`,
  );
  console.log(`[diag-a4] video_url=${job.video_url}`);

  // 4. Download MP4
  const res = await fetch(job.video_url);
  if (!res.ok) {
    console.error(`[diag-a4] ❌ download falhou: ${res.status}`);
    process.exit(2);
  }
  const arr = await res.arrayBuffer();
  const buffer = Buffer.from(arr);
  console.log(`[diag-a4] mp4 baixado: ${buffer.length} bytes`);

  // 5. ffprobe (local tmp)
  const tmpPath = path.join(os.tmpdir(), `diag-a4-${Date.now()}.mp4`);
  await fs.writeFile(tmpPath, buffer);
  let probe = "(ffprobe indisponível)";
  try {
    probe = await ffprobe(tmpPath);
  } catch (e) {
    probe = `ffprobe falhou: ${e instanceof Error ? e.message : String(e)}`;
  }

  // 6. Upload diagnóstico (bucket homologado, path separado)
  const { error: upErr } = await supabase.storage
    .from(STORAGE_BUCKET)
    .upload(DIAG_PATH, buffer, {
      contentType: "video/mp4",
      upsert: true,
    });
  if (upErr) {
    console.error(`[diag-a4] ❌ upload falhou: ${upErr.message}`);
    process.exit(3);
  }
  const { data: pub } = supabase.storage
    .from(STORAGE_BUCKET)
    .getPublicUrl(DIAG_PATH);

  const totalMs = Date.now() - t0;

  console.log("\n=== RESULTADO ===");
  console.log(JSON.stringify(
    {
      ok: true,
      request_id: job.request_id,
      fal_duration_ms: job.duration_ms,
      total_ms: totalMs,
      mp4_bytes: buffer.length,
      tmp_path: tmpPath,
      upload: {
        bucket: STORAGE_BUCKET,
        path: DIAG_PATH,
        public_url: pub.publicUrl,
      },
      ffprobe_json: (() => {
        try {
          return JSON.parse(probe);
        } catch {
          return probe;
        }
      })(),
      db_write: false,
    },
    null,
    2,
  ));
  console.log("\n[diag-a4] DB inalterado. product_leads NÃO tocado.");
}

main().catch((err) => {
  console.error("[diag-a4] FATAL:", err);
  process.exit(1);
});

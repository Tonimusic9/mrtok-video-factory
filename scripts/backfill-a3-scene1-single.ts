/**
 * Backfill mínimo — 1 única imagem (scene_index=1) no lead-alvo, 9:16 @ 1K.
 *
 * Propagação REAL controlada:
 * - chama Nano Banana Pro (fal-ai/nano-banana-pro) 1 vez
 * - sobrescreve path produtivo `leads/<id>/scene-1-<phase>.png`
 * - substitui apenas a entrada scene_index=1 em `metadata.generated_images`
 * - mantém cenas 2/3 inalteradas, mantém status do lead inalterado
 * - não toca `creative_matrix`
 *
 * Trava financeira: exige A3_AUTHORIZE=PAGAR no env.
 */
import { config } from "dotenv";
config({ path: ".env.local" });
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { createClient } from "@supabase/supabase-js";
import { submitAndPollImage } from "../src/lib/fal-client";

const LEAD_ID = process.env.LEAD_ID;
const SCENE_INDEX = Number(process.env.SCENE_INDEX ?? "1");
const STORAGE_BUCKET = "mrtok-images";
const NANO_SLUG = "fal-ai/nano-banana-pro";
const PRICE_USD = 0.15;

interface VisualPrompt {
  scene_index: number;
  phase: string;
  nano_banana_prompt: string;
  aspect_ratio?: string;
}
interface GeneratedImage {
  scene_index: number;
  phase: string;
  storage_path: string;
  public_url: string;
  fal_request_id: string;
  duration_ms: number;
}

function ffprobe(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn("ffprobe", [
      "-v",
      "error",
      "-show_entries",
      "stream=width,height,codec_name",
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
  if (process.env.A3_AUTHORIZE !== "PAGAR") {
    console.error(
      `[backfill-a3-scene1] ❌ A3_AUTHORIZE=PAGAR ausente — abort sem FAL.`,
    );
    process.exit(1);
  }
  if (!process.env.FAL_KEY) {
    console.error("[backfill-a3-scene1] ❌ FAL_KEY ausente em .env.local");
    process.exit(1);
  }
  if (!LEAD_ID) {
    console.error("[backfill-a3-scene1] ❌ LEAD_ID ausente no env — abort sem FAL.");
    process.exit(1);
  }

  const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );

  // 1) Lê lead
  const { data: lead, error: leadErr } = await supabase
    .from("product_leads")
    .select("id, title, status, metadata")
    .eq("id", LEAD_ID)
    .single();
  if (leadErr || !lead) {
    console.error(`[backfill-a3-scene1] lead not found: ${leadErr?.message}`);
    process.exit(1);
  }
  const meta = ((lead as { metadata?: Record<string, unknown> }).metadata ??
    {}) as Record<string, unknown>;
  const direction = meta.creative_direction as
    | { visual_prompts?: VisualPrompt[] }
    | undefined;
  const vp = direction?.visual_prompts?.find((v) => v.scene_index === SCENE_INDEX);
  if (!vp) {
    console.error(
      `[backfill-a3-scene1] visual_prompts[scene=${SCENE_INDEX}] ausente — abort sem FAL.`,
    );
    process.exit(1);
  }

  const existingImages = (meta.generated_images as GeneratedImage[] | undefined) ?? [];
  const storagePath = `leads/${LEAD_ID}/scene-${SCENE_INDEX}-${vp.phase}.png`;

  console.log("=== BACKFILL A3 SCENE-1 — Nano Banana Pro 9:16 @ 1K ===");
  console.log(`lead=${LEAD_ID} status=${(lead as { status: string }).status}`);
  console.log(`slug=${NANO_SLUG}  aspect_ratio=9:16  resolution=1K  num_images=1`);
  console.log(`upload_path=${STORAGE_BUCKET}/${storagePath}`);
  console.log(`estUSD=$${PRICE_USD}`);
  console.log(
    `writes planned: storage upsert + metadata.generated_images[scene=1] replace`,
  );
  console.log(`creative_matrix=UNTOUCHED  status=UNTOUCHED\n`);

  // 2) Chama FAL
  console.log("[backfill-a3-scene1] Disparando submitAndPollImage...");
  const t0 = Date.now();
  const job = await submitAndPollImage({
    slug: NANO_SLUG,
    input: {
      prompt: vp.nano_banana_prompt,
      aspect_ratio: "9:16",
      resolution: "1K",
      num_images: 1,
    },
  });
  console.log(
    `[backfill-a3-scene1] FAL OK: request_id=${job.request_id} duration_ms=${job.duration_ms}`,
  );

  // 3) Download + ffprobe
  const res = await fetch(job.image_url);
  if (!res.ok) {
    console.error(`[backfill-a3-scene1] ❌ download falhou: ${res.status}`);
    process.exit(2);
  }
  const contentType = res.headers.get("content-type") ?? "image/png";
  const buffer = Buffer.from(await res.arrayBuffer());
  const tmpPath = path.join(os.tmpdir(), `backfill-a3-scene1-${Date.now()}.png`);
  await fs.writeFile(tmpPath, buffer);
  let probe: unknown = "(ffprobe indisponível)";
  try {
    probe = JSON.parse(await ffprobe(tmpPath));
  } catch (e) {
    probe = `ffprobe falhou: ${e instanceof Error ? e.message : String(e)}`;
  }

  // 4) Upload no path produtivo (upsert)
  const { error: upErr } = await supabase.storage
    .from(STORAGE_BUCKET)
    .upload(storagePath, buffer, { contentType, upsert: true });
  if (upErr) {
    console.error(`[backfill-a3-scene1] ❌ upload falhou: ${upErr.message}`);
    process.exit(3);
  }
  const { data: pub } = supabase.storage
    .from(STORAGE_BUCKET)
    .getPublicUrl(storagePath);

  // 5) Substitui entrada scene=1 em metadata.generated_images
  const newEntry: GeneratedImage = {
    scene_index: SCENE_INDEX,
    phase: vp.phase,
    storage_path: storagePath,
    public_url: pub.publicUrl,
    fal_request_id: job.request_id,
    duration_ms: job.duration_ms,
  };
  const nextImages: GeneratedImage[] = [
    newEntry,
    ...existingImages.filter((g) => g.scene_index !== SCENE_INDEX),
  ].sort((a, b) => a.scene_index - b.scene_index);

  const nextMeta = { ...meta, generated_images: nextImages };

  const { error: updErr } = await supabase
    .from("product_leads")
    .update({ metadata: nextMeta })
    .eq("id", LEAD_ID);
  if (updErr) {
    console.error(`[backfill-a3-scene1] ❌ update falhou: ${updErr.message}`);
    process.exit(4);
  }

  const totalMs = Date.now() - t0;
  console.log("\n=== RESULTADO ===");
  console.log(
    JSON.stringify(
      {
        ok: true,
        request_id: job.request_id,
        fal_duration_ms: job.duration_ms,
        total_ms: totalMs,
        png_bytes: buffer.length,
        content_type: contentType,
        tmp_path: tmpPath,
        upload: {
          bucket: STORAGE_BUCKET,
          path: storagePath,
          public_url: pub.publicUrl,
        },
        ffprobe: probe,
        writes: {
          storage_upsert: true,
          metadata_generated_images_scene1_replaced: true,
          status_changed: false,
          creative_matrix_touched: false,
        },
      },
      null,
      2,
    ),
  );
}

main().catch((err) => {
  console.error("[backfill-a3-scene1] FATAL:", err);
  process.exit(1);
});

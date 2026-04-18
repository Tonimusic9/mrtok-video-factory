/**
 * Diag one-shot — 1 única imagem Nano Banana Pro 9:16 @ 1K (Via B isolada).
 *
 * Prova in-vivo que o patch em worker-a3.ts corrige a geometria upstream.
 *
 * Isolamento duro:
 * - ZERO escrita em `product_leads` (nem status, nem metadata)
 * - upload em caminho diagnóstico separado: leads/<id>/diag-scene-1-9x16.png
 * - sem chain, sem Kling, sem Remotion
 *
 * Contrato FAL (doc oficial Context7):
 *   slug = fal-ai/nano-banana-pro
 *   input = { prompt, aspect_ratio:"9:16", resolution:"1K", num_images:1 }
 *
 * Trava de pagamento:
 *   - por padrão readline interativo pedindo "PAGAR"
 *   - execução não-interativa: setar A3_DIAG_AUTHORIZE=PAGAR
 */
import { config } from "dotenv";
config({ path: ".env.local" });
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import readline from "node:readline/promises";
import { spawn } from "node:child_process";
import { createClient } from "@supabase/supabase-js";
import { submitAndPollImage } from "../src/lib/fal-client";

const LEAD_ID = "6705d973-90b6-4511-bc46-d5455c4aedff";
const STORAGE_BUCKET = "mrtok-images";
const DIAG_PATH = `leads/${LEAD_ID}/diag-scene-1-9x16.png`;
const NANO_SLUG = "fal-ai/nano-banana-pro";
const PRICE_USD = 0.15; // Nano Banana Pro 1K — $0.15/img (Context7)

interface VisualPrompt {
  scene_index: number;
  phase: string;
  nano_banana_prompt: string;
  aspect_ratio: string;
}

async function confirmPayment(): Promise<void> {
  const envAuth = process.env.A3_DIAG_AUTHORIZE?.trim();
  if (envAuth === "PAGAR") {
    console.log(
      `[diag-a3] A3_DIAG_AUTHORIZE=PAGAR detectado — pulando readline (≈$${PRICE_USD}).`,
    );
    return;
  }
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  const answer = await rl.question(
    `⚠️  DIAG 1-IMAGEM Nano Banana Pro 9:16 1K (≈$${PRICE_USD}). Digite "PAGAR" para continuar: `,
  );
  rl.close();
  if (answer !== "PAGAR") {
    console.log("[diag-a3] Abortado pelo usuário.");
    process.exit(1);
  }
}

function ffprobe(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn("ffprobe", [
      "-v",
      "error",
      "-show_entries",
      "stream=width,height,codec_name:format=size,format_name",
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
    console.error("[diag-a3] ❌ FAL_KEY ausente em .env.local");
    process.exit(1);
  }

  const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );

  // 1. Carrega lead (READ-ONLY) — pega o mesmo visual_prompt que o a3 usaria.
  const { data: lead, error: leadErr } = await supabase
    .from("product_leads")
    .select("id, title, status, metadata")
    .eq("id", LEAD_ID)
    .single();
  if (leadErr || !lead) {
    console.error(`[diag-a3] lead not found: ${leadErr?.message}`);
    process.exit(1);
  }
  const meta = ((lead as { metadata?: Record<string, unknown> }).metadata ??
    {}) as Record<string, unknown>;
  const direction = meta.creative_direction as
    | { visual_prompts?: VisualPrompt[] }
    | undefined;
  const vp1 = direction?.visual_prompts?.find((v) => v.scene_index === 1);
  if (!vp1) {
    console.error(
      `[diag-a3] creative_direction.visual_prompts[scene=1] ausente — abort sem FAL.`,
    );
    process.exit(1);
  }

  console.log("=== DIAG A3 1-IMAGEM — Nano Banana Pro 9:16 @ 1K ===");
  console.log(`lead=${LEAD_ID} status=${(lead as { status: string }).status}`);
  console.log(`slug=${NANO_SLUG}`);
  console.log(`aspect_ratio=9:16  resolution=1K  num_images=1`);
  console.log(`prompt="${vp1.nano_banana_prompt.slice(0, 200)}..."`);
  console.log(`upload_path=${STORAGE_BUCKET}/${DIAG_PATH}`);
  console.log(`estUSD=$${PRICE_USD}`);
  console.log(`DB_WRITE=OFF (product_leads NÃO será mutado)\n`);

  // 2. Trava financeira
  await confirmPayment();

  // 3. Chamada FAL (one-shot)
  console.log("[diag-a3] Disparando submitAndPollImage...");
  const t0 = Date.now();
  const job = await submitAndPollImage({
    slug: NANO_SLUG,
    input: {
      prompt: vp1.nano_banana_prompt,
      aspect_ratio: "9:16",
      resolution: "1K",
      num_images: 1,
    },
  });
  console.log(
    `[diag-a3] FAL OK: request_id=${job.request_id} duration_ms=${job.duration_ms}`,
  );
  console.log(`[diag-a3] image_url=${job.image_url}`);

  // 4. Download PNG
  const res = await fetch(job.image_url);
  if (!res.ok) {
    console.error(`[diag-a3] ❌ download falhou: ${res.status}`);
    process.exit(2);
  }
  const contentType = res.headers.get("content-type") ?? "image/png";
  const arr = await res.arrayBuffer();
  const buffer = Buffer.from(arr);
  console.log(
    `[diag-a3] PNG baixado: ${buffer.length} bytes (content-type=${contentType})`,
  );

  // 5. ffprobe (tmp local)
  const tmpPath = path.join(os.tmpdir(), `diag-a3-${Date.now()}.png`);
  await fs.writeFile(tmpPath, buffer);
  let probe: unknown = "(ffprobe indisponível)";
  try {
    probe = JSON.parse(await ffprobe(tmpPath));
  } catch (e) {
    probe = `ffprobe falhou: ${e instanceof Error ? e.message : String(e)}`;
  }

  // 6. Upload diagnóstico
  const { error: upErr } = await supabase.storage
    .from(STORAGE_BUCKET)
    .upload(DIAG_PATH, buffer, {
      contentType,
      upsert: true,
    });
  if (upErr) {
    console.error(`[diag-a3] ❌ upload falhou: ${upErr.message}`);
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
      png_bytes: buffer.length,
      content_type: contentType,
      tmp_path: tmpPath,
      upload: {
        bucket: STORAGE_BUCKET,
        path: DIAG_PATH,
        public_url: pub.publicUrl,
      },
      ffprobe: probe,
      db_write: false,
    },
    null,
    2,
  ));
  console.log("\n[diag-a3] DB inalterado. product_leads NÃO tocado.");
}

main().catch((err) => {
  console.error("[diag-a3] FATAL:", err);
  process.exit(1);
});

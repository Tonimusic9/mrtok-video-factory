/**
 * smoke-a6-vps.ts — valida a esteira de INFRA do Worker a6 (rsync/VPS/Remotion/
 * ffmpeg/rsync_down) sem tocar em FAL.ai nem GLM 5.1.
 *
 * Estratégia: hand-craft um RenderManifest válido com `video_url` apontando
 * para MP4s públicos estáveis (bucket Google commondatastorage — test videos
 * canônicos). Chama `runRemoteRender` direto, pulando todo o pipeline FAL.
 *
 * O que valida:
 *   1. Download dos MP4s "mock" para workspace/video-renderer/assets/
 *   2. Escrita do manifest.json com video_url reescrito para caminhos relativos
 *   3. Rsync UP (código Remotion + assets + manifest) para VPS 100.72.40.35
 *   4. Remote render via `npx remotion render` na VPS
 *   5. ffmpeg injetando metadata iPhone 17 Pro Max
 *   6. ffprobe cross-check (720×1280, bitrate 6-10 Mbps)
 *   7. Rsync DOWN do MP4 final para ./output/publish_ready/
 *
 * O que NÃO valida (fora do escopo):
 *   - Geração FAL.ai (Kling/Seedance/Veo) — bypassed
 *   - Geração GLM 5.1 do manifest — bypassed (manifest hand-crafted)
 *   - Regra de Ouro Supabase (creative_matrix) — não mexe em DB
 *
 * Uso: `npx tsx scripts/smoke-a6-vps.ts`
 *
 * Exit codes:
 *   0 = ok
 *   1 = env ausente / setup / erro inesperado
 *   2 = runRemoteRender falhou (rsync/VPS/render/ffmpeg)
 *   3 = manifest hand-crafted não bate com renderManifestSchema
 */
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";

function loadEnv(): void {
  const raw = readFileSync(".env.local", "utf-8");
  for (const line of raw.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq === -1) continue;
    const k = t.slice(0, eq).trim();
    const v = t.slice(eq + 1).trim();
    if (!(k in process.env)) process.env[k] = v;
  }
}

loadEnv();

// MP4s públicos estáveis (Google Cloud Storage bucket público de test videos).
// 720p, ~2.5MB cada, sem auth, TTL infinito. Canônicos para smoke tests.
const PUBLIC_MP4_SAMPLES = {
  hook: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4",
  body: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerEscapes.mp4",
  cta: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerFun.mp4",
};

async function main() {
  const t0 = Date.now();

  const { runRemoteRender } = await import("../src/lib/agents/remoteRender");
  const { renderManifestSchema } = await import("../src/lib/agents/renderManifest");
  type RenderManifestT = import("../src/lib/agents/renderManifest").RenderManifest;

  // --- 1. Hand-craft do RenderManifest --------------------------------------
  // Durações: hook=3s + body=5s + cta=3s = 11s total (330 frames @ 30fps).
  const manifest: RenderManifestT = {
    fps: 30,
    width: 720,
    height: 1280,
    clips: [
      {
        block: "hook",
        video_url: PUBLIC_MP4_SAMPLES.hook,
        start_frame: 0,
        duration_frames: 90, // 3s
        transition_in: "cut",
        text_overlay: null,
      },
      {
        block: "body",
        video_url: PUBLIC_MP4_SAMPLES.body,
        start_frame: 90,
        duration_frames: 150, // 5s
        transition_in: "fade",
        text_overlay: {
          text: "Smoke test VPS infra",
          position: "bottom",
          style: "ugc_caption",
        },
      },
      {
        block: "cta",
        video_url: PUBLIC_MP4_SAMPLES.cta,
        start_frame: 240,
        duration_frames: 90, // 3s
        transition_in: "slide_up",
        text_overlay: {
          text: "Entregue na VPS!",
          position: "bottom",
          style: "cta_bold",
        },
      },
    ],
    pixel_hash: {
      scale: 1.011,
      rotation_deg: -0.07,
    },
    total_duration_frames: 330,
  };

  // --- 2. Sanity check contra o schema real --------------------------------
  const parse = renderManifestSchema.safeParse(manifest);
  if (!parse.success) {
    console.error("[smoke-a6-vps] ❌ manifest hand-crafted inválido:");
    for (const i of parse.error.issues) {
      console.error(`  - ${i.path.join(".")}: ${i.message}`);
    }
    process.exit(3);
  }

  const runId = randomUUID();
  console.log(`[smoke-a6-vps] 🚀 runId=${runId}`);
  console.log(`[smoke-a6-vps] ⚠️  FAL.ai + GLM 5.1 BYPASSED — MP4s públicos`);
  console.log(`[smoke-a6-vps] 📋 manifest: 720×1280 @ 30fps, 330 frames (11s)`);
  console.log(`[smoke-a6-vps]    pixel_hash: scale=${manifest.pixel_hash.scale} rotation=${manifest.pixel_hash.rotation_deg}°`);
  console.log(`[smoke-a6-vps] ⏳ isso pode levar 1-4 minutos (rsync + VPS render)`);

  // --- 3. Disparo da infra via runRemoteRender -----------------------------
  try {
    const { localPath, telemetry } = await runRemoteRender({
      manifest: parse.data,
      runId,
    });

    console.log("\n[smoke-a6-vps] ✅ RENDER COMPLETO");
    console.log(`[smoke-a6-vps] 📁 arquivo final: ${localPath}`);
    console.log("\n[smoke-a6-vps] 📊 TELEMETRIA DE INFRA:");
    console.log(`   precheck:        ${telemetry.precheck_ms}ms`);
    console.log(`   rsync_up:        ${telemetry.rsync_up_ms}ms`);
    console.log(`   remote_render:   ${telemetry.remote_render_ms}ms`);
    console.log(`   ffmpeg_metadata: ${telemetry.ffmpeg_metadata_ms}ms`);
    console.log(`   rsync_down:      ${telemetry.rsync_down_ms}ms`);
    console.log(`   remote_log:      ${telemetry.remote_log_path}`);
    console.log(`   output_bytes:    ${telemetry.output_file_bytes}`);
    console.log(
      `   ffprobe:         ${telemetry.ffprobe_width}×${telemetry.ffprobe_height} @ ${telemetry.ffprobe_bitrate_bps} bps`,
    );

    const totalSec = ((Date.now() - t0) / 1000).toFixed(1);
    console.log(`\n[smoke-a6-vps] 🎉 PASSOU em ${totalSec}s — infra 100% validada`);
  } catch (err) {
    console.error("\n[smoke-a6-vps] ❌ FALHA NA INFRA:");
    console.error((err as Error).message);
    process.exit(2);
  }
}

main().catch((err) => {
  console.error("[smoke-a6-vps] ❌ erro inesperado:", err);
  process.exit(1);
});

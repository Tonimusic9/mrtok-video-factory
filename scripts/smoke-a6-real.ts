/**
 * Smoke test REAL do Worker a6 — fluxo ponta-a-ponta contra VPS 100.72.40.35.
 *
 * Valida que o Worker a6 em modo real:
 *   1. Chama FAL.ai de verdade (3 shots) — gastos reais de crédito.
 *   2. Gera o RenderManifest via GLM 5.1.
 *   3. Baixa os MP4s do FAL para workspace/video-renderer/assets/.
 *   4. Aciona scripts/deploy-render.sh que rsync+ssh contra 100.72.40.35.
 *   5. Remotion renderiza na VPS (720x1280, 8 Mbps, metadata iPhone 17 Pro Max).
 *   6. MP4 final é puxado de volta para output/publish_ready/mrtok_<uuid>.mp4.
 *   7. Valida localmente via ffprobe: 720×1280 e bitrate ∈ [6, 10] Mbps.
 *
 * ⚠️ CUSTO: ~$0.30–0.80 em créditos FAL.ai por execução. Gated por
 * `SMOKE_A6_REAL=1` para evitar disparos acidentais.
 *
 * Uso: `SMOKE_A6_REAL=1 npx tsx scripts/smoke-a6-real.ts`
 *
 * Exit codes:
 *   0 = ok (ou skipped por SMOKE_A6_REAL ≠ 1)
 *   1 = env ausente / setup
 *   2 = tick não processou com sucesso
 *   3 = result no DB não bate com montadorResultSchema / cross-checks
 *   4 = REGRA DE OURO violada (creative_matrix mudou)
 *   5 = falha no cleanup
 *   6 = ffprobe local do MP4 final fora da spec 720x1280 / bitrate
 */
import { readFileSync, statSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import type { ProductionSpecOutput } from "../src/lib/agents/productionSpec";

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

// --- Gate ------------------------------------------------------------------
if (process.env.SMOKE_A6_REAL !== "1") {
  console.log(
    "[smoke-a6-real] ⏭️  skipped (SMOKE_A6_REAL ≠ 1). " +
      "Para rodar: `SMOKE_A6_REAL=1 npx tsx scripts/smoke-a6-real.ts`",
  );
  process.exit(0);
}

const PROJECT_ID = "mrtok-smoke-a6-real";

// --- Fixture: ProductionSpec enxuta para minimizar custo FAL.ai -----------
// Durações: hook=3s + body=5s + cta=3s = 11s total (~$0.30-0.80 em créditos).
const FIXTURE_PRODUCTION_SPEC: ProductionSpecOutput = {
  shots: [
    {
      block: "hook",
      voice: {
        voice_id: "pt-BR-creator-female-01",
        ssml: 'Ah, <break time="200ms"/> espera — minha pele brilhando de novo?',
        pacing_wpm: 175,
        emphasis: ["espera", "brilhando"],
        pauses_ms: [{ after_word_index: 1, duration_ms: 200 }],
        human_imperfection: "Gagueja levemente no espera e pausa curta",
      },
      video_generation: {
        provider: "kling",
        fal_model_slug: "fal-ai/kling-video/v2.1/standard",
        duration_seconds: 3,
        aspect_ratio: "9:16",
        motion_intensity: "high",
        seed: 123456,
        image_prompt:
          "young Brazilian woman late 20s, natural makeup, tilts phone toward mirror, frustrated gesture, sunlit bathroom, iPhone 17 Pro Max selfie",
        negative_prompt:
          "no text, no caption, no watermark, no logo, no extra hands, no clinical setting",
        motion_description:
          "Camera shakes slightly as subject tilts phone. Quick head turn toward mirror.",
      },
    },
    {
      block: "body",
      voice: {
        voice_id: "pt-BR-creator-female-01",
        ssml: "Essa máscara de argila verde é minha salvação.",
        pacing_wpm: 155,
        emphasis: ["salvação"],
        pauses_ms: [],
        human_imperfection: "Leve aceleração no meio da frase",
      },
      video_generation: {
        provider: "kling",
        fal_model_slug: "fal-ai/kling-video/v2.1/standard",
        duration_seconds: 5,
        aspect_ratio: "9:16",
        motion_intensity: "low",
        seed: 789012,
        image_prompt:
          "same young woman holding unbranded jar of green clay mask, applies to cheek, sunlit bathroom, iPhone 17 Pro Max selfie medium close-up",
        negative_prompt:
          "no text, no caption, no watermark, no logo, no extra hands, no clinical setting",
        motion_description:
          "Slow steady handheld drift. Subject applies product to cheek while maintaining eye contact.",
      },
    },
    {
      block: "cta",
      voice: {
        voice_id: "pt-BR-creator-female-01",
        ssml: "Testa essa facilidade no seu dia a dia!",
        pacing_wpm: 165,
        emphasis: ["Testa"],
        pauses_ms: [],
        human_imperfection: "Tom levemente empolgado no final",
      },
      video_generation: {
        provider: "kling",
        fal_model_slug: "fal-ai/kling-video/v2.1/standard",
        duration_seconds: 3,
        aspect_ratio: "9:16",
        motion_intensity: "medium",
        seed: 345678,
        image_prompt:
          "same young woman fresher-looking skin, smiling softly, quick thumbs up, same bathroom tighter framing, iPhone 17 Pro Max selfie eye level",
        negative_prompt:
          "no text, no caption, no watermark, no logo, no extra hands, no clinical setting",
        motion_description:
          "Subject gives quick thumbs up with playful head tilt toward camera.",
      },
    },
  ],
  global: {
    voice_locale: "pt-BR",
    default_video_provider: "kling",
    fal_gateway: "fal.ai",
    fallback_provider_chain: ["kling", "seedance", "nano-banana"],
  },
};

async function main() {
  const t0 = Date.now();

  // --- 1. Setup --------------------------------------------------------------
  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    console.error("[smoke-a6-real] ❌ SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY ausentes");
    process.exit(1);
  }
  if (!process.env.OPENROUTER_API_KEY) {
    console.error("[smoke-a6-real] ❌ OPENROUTER_API_KEY ausente");
    process.exit(1);
  }
  if (!process.env.FAL_KEY) {
    console.error("[smoke-a6-real] ❌ FAL_KEY ausente (modo real precisa)");
    process.exit(1);
  }

  const supabase = createClient(url, serviceKey, { auth: { persistSession: false } });

  const { runWorkerA6Tick } = await import("../src/workers/worker-a6");
  const { montadorResultSchema } = await import("../src/lib/agents/renderManifest");

  // --- 2. Cleanup prévio -----------------------------------------------------
  const { error: tqDelErr } = await supabase
    .from("task_queue")
    .delete()
    .eq("project_id", PROJECT_ID);
  if (tqDelErr) {
    console.error(`[smoke-a6-real] ❌ cleanup task_queue: ${tqDelErr.message}`);
    process.exit(5);
  }
  const { error: cmDelErr } = await supabase
    .from("creative_matrix")
    .delete()
    .eq("project_id", PROJECT_ID);
  if (cmDelErr) {
    console.error(`[smoke-a6-real] ❌ cleanup creative_matrix: ${cmDelErr.message}`);
    process.exit(5);
  }

  // --- 3. Snapshot ANTES (Regra de Ouro) ------------------------------------
  const { count: matrixCountBefore, error: cBeforeErr } = await supabase
    .from("creative_matrix")
    .select("*", { count: "exact", head: true });
  if (cBeforeErr || matrixCountBefore === null) {
    console.error(`[smoke-a6-real] ❌ snapshot antes: ${cBeforeErr?.message}`);
    process.exit(1);
  }
  console.log(`[smoke-a6-real] 📸 creative_matrix ANTES: ${matrixCountBefore} rows`);

  // --- 4. Insert da fixture --------------------------------------------------
  const { data: inserted, error: insErr } = await supabase
    .from("task_queue")
    .insert({
      project_id: PROJECT_ID,
      agent: "a6",
      status: "pending",
      payload: {
        production_spec: FIXTURE_PRODUCTION_SPEC,
        dry_run: false, // ← modo real
      },
    })
    .select("id")
    .single();
  if (insErr || !inserted) {
    console.error(`[smoke-a6-real] ❌ insert fixture: ${insErr?.message}`);
    process.exit(1);
  }
  const insertedId = inserted.id;
  console.log(`[smoke-a6-real] 📥 task pending criada: ${insertedId}`);

  // --- 5. Execução (modo real — pode levar minutos) --------------------------
  console.log("[smoke-a6-real] ▶️  runWorkerA6Tick({maxTasks:1}) — modo REAL...");
  console.log("[smoke-a6-real] ⏳ isso pode levar 2-6 minutos (FAL.ai + VPS render)");
  const tick = await runWorkerA6Tick({ maxTasks: 1 });
  console.log(
    `[smoke-a6-real] tick: processed=${tick.processed} ok=${tick.succeeded} failed=${tick.failed}`,
  );

  if (tick.succeeded !== 1) {
    console.error("[smoke-a6-real] ❌ tick não teve 1 sucesso");
    console.error(JSON.stringify(tick.results, null, 2));
    process.exit(2);
  }

  // --- 6. Auditoria pós-execução --------------------------------------------
  const { data: row, error: rowErr } = await supabase
    .from("task_queue")
    .select("status, result, error")
    .eq("id", insertedId)
    .single();
  if (rowErr || !row) {
    console.error(`[smoke-a6-real] ❌ leitura da row: ${rowErr?.message}`);
    process.exit(2);
  }
  if (row.status !== "done") {
    console.error(
      `[smoke-a6-real] ❌ status esperado 'done', recebido '${row.status}' (error=${row.error})`,
    );
    process.exit(2);
  }

  const parsed = montadorResultSchema.safeParse(row.result);
  if (!parsed.success) {
    console.error("[smoke-a6-real] ❌ result não bate com schema:");
    for (const issue of parsed.error.issues) {
      console.error(`   - ${issue.path.join(".")}: ${issue.message}`);
    }
    process.exit(3);
  }
  const result = parsed.data;

  // 6a. NÃO é dry_run
  if (result.dry_run) {
    console.error("[smoke-a6-real] ❌ result.dry_run deveria ser false");
    process.exit(3);
  }

  // 6b. output_video_url é file://
  if (!result.output_video_url.startsWith("file://")) {
    console.error(
      `[smoke-a6-real] ❌ output_video_url deveria ser file://, recebido: ${result.output_video_url}`,
    );
    process.exit(3);
  }

  // 6c. telemetry populada
  if (!result.render_telemetry) {
    console.error("[smoke-a6-real] ❌ render_telemetry ausente em modo real");
    process.exit(3);
  }
  console.log("[smoke-a6-real] 📊 telemetry:");
  console.log(`   precheck:        ${result.render_telemetry.precheck_ms}ms`);
  console.log(`   rsync_up:        ${result.render_telemetry.rsync_up_ms}ms`);
  console.log(`   remote_render:   ${result.render_telemetry.remote_render_ms}ms`);
  console.log(`   ffmpeg_metadata: ${result.render_telemetry.ffmpeg_metadata_ms}ms`);
  console.log(`   rsync_down:      ${result.render_telemetry.rsync_down_ms}ms`);
  console.log(`   remote_log:      ${result.render_telemetry.remote_log_path}`);
  console.log(`   output_bytes:    ${result.render_telemetry.output_file_bytes}`);
  console.log(
    `   ffprobe:         ${result.render_telemetry.ffprobe_width}×${result.render_telemetry.ffprobe_height} @ ${result.render_telemetry.ffprobe_bitrate_bps} bps`,
  );

  // 6d. Arquivo MP4 existe localmente
  const localPath = fileURLToPath(result.output_video_url);
  if (!existsSync(localPath)) {
    console.error(`[smoke-a6-real] ❌ MP4 local não existe: ${localPath}`);
    process.exit(3);
  }
  const mp4Size = statSync(localPath).size;
  if (mp4Size < 100_000) {
    console.error(`[smoke-a6-real] ❌ MP4 local suspeito: ${mp4Size} bytes`);
    process.exit(3);
  }
  console.log(`[smoke-a6-real] 🎬 MP4 final: ${localPath} (${mp4Size} bytes)`);

  // --- 7. Verificação via ffprobe local -------------------------------------
  let ffprobeOut: string;
  try {
    ffprobeOut = execFileSync(
      "ffprobe",
      [
        "-v",
        "error",
        "-select_streams",
        "v:0",
        "-show_entries",
        "stream=width,height,bit_rate",
        "-of",
        "csv=p=0",
        localPath,
      ],
      { encoding: "utf-8" },
    ).trim();
  } catch (err) {
    console.error(
      `[smoke-a6-real] ❌ ffprobe local falhou: ${(err as Error).message}. Instalar via brew install ffmpeg`,
    );
    process.exit(6);
  }
  const [wStr, hStr, brStr] = ffprobeOut.split(",");
  const w = Number(wStr);
  const h = Number(hStr);
  const br = Number(brStr);
  console.log(`[smoke-a6-real] 🔍 ffprobe local: ${w}×${h} @ ${br} bps`);

  if (w !== 720 || h !== 1280) {
    console.error(`[smoke-a6-real] ❌ resolução local inválida: ${w}×${h} (esperado 720×1280)`);
    process.exit(6);
  }
  if (br < 6_000_000 || br > 10_500_000) {
    console.error(`[smoke-a6-real] ❌ bitrate local fora da spec: ${br} bps`);
    process.exit(6);
  }

  // --- 8. Verificação da Regra de Ouro --------------------------------------
  const { count: matrixCountAfter, error: cAfterErr } = await supabase
    .from("creative_matrix")
    .select("*", { count: "exact", head: true });
  if (cAfterErr || matrixCountAfter === null) {
    console.error(`[smoke-a6-real] ❌ snapshot depois: ${cAfterErr?.message}`);
    process.exit(1);
  }
  if (matrixCountAfter !== matrixCountBefore) {
    console.error(
      `[smoke-a6-real] 🚨 REGRA DE OURO VIOLADA: ${matrixCountBefore} → ${matrixCountAfter}`,
    );
    process.exit(4);
  }
  console.log("[smoke-a6-real] ✅ Regra de Ouro intacta");

  // --- 9. Cleanup final ------------------------------------------------------
  await supabase.from("task_queue").delete().eq("id", insertedId);

  const totalMs = Date.now() - t0;
  console.log(
    `\n[smoke-a6-real] ✅ smoke REAL PASSOU em ${(totalMs / 1000).toFixed(1)}s · 720×1280 · ${br} bps · ${mp4Size} bytes`,
  );
}

main().catch((err) => {
  console.error("[smoke-a6-real] ❌ falha inesperada:", err);
  process.exit(1);
});

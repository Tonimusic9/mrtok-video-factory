/**
 * Smoke test do Worker a6 — Montador CLI / Remotion (Tarefa 10).
 *
 * Valida end-to-end contra Supabase + OpenRouter REAIS em modo dry_run:
 *   1. Insere uma row pending em task_queue (agent='a6') com ProductionSpec
 *      hardcoded + dry_run=true (FAL.ai/Remotion pulados).
 *   2. Executa runWorkerA6Tick({maxTasks:1}).
 *   3. Audita: task virou 'done', result bate com montadorResultSchema,
 *      clips em ordem hook→body→cta, pixel hash nos bounds, duration_frames
 *      coerente com a ProductionSpec (±1 frame).
 *   4. REGRA DE OURO: confirma que NENHUMA linha foi inserida em
 *      creative_matrix (snapshot global antes/depois + filtro por project_id).
 *
 * Uso: `npx tsx scripts/smoke-a6.ts`
 *
 * Exit codes:
 *   0 = ok
 *   1 = env ausente / setup
 *   2 = tick não processou com sucesso
 *   3 = result no DB não bate com montadorResultSchema / cross-checks
 *   4 = REGRA DE OURO violada (creative_matrix mudou)
 *   5 = falha no cleanup
 */
import { readFileSync } from "node:fs";
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

const PROJECT_ID = "mrtok-smoke-a6";

// --- Fixture: ProductionSpec completa (output típico do a5) ------------------
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
          "young Brazilian woman late 20s, natural makeup, visible oily T-zone, tilts phone toward mirror, frustrated gesture, sunlit bathroom, front-facing iPhone selfie",
        negative_prompt:
          "no text, no caption, no watermark, no logo, no extra hands, no clinical setting, no white coat, no before/after split",
        motion_description:
          "Camera shakes slightly as subject tilts phone. Quick head turn toward mirror with a small frustrated hand gesture.",
      },
    },
    {
      block: "body",
      voice: {
        voice_id: "pt-BR-creator-female-01",
        ssml: "Essa máscara de argila verde é minha salvação nos dias corridos.",
        pacing_wpm: 155,
        emphasis: ["salvação", "corridos"],
        pauses_ms: [],
        human_imperfection: "Leve aceleração no meio da frase",
      },
      video_generation: {
        provider: "hailuo",
        fal_model_slug: "fal-ai/minimax-video",
        duration_seconds: 15,
        aspect_ratio: "9:16",
        motion_intensity: "low",
        seed: 789012,
        image_prompt:
          "same young woman holding unbranded jar of green clay mask, scoops with fingertip, applies to cheek, talks to camera, sunlit bathroom, iPhone selfie medium close-up",
        negative_prompt:
          "no text, no caption, no watermark, no logo, no extra hands, no clinical setting, no white coat, no before/after split",
        motion_description:
          "Slow steady handheld drift. Subject scoops product and applies to cheek while maintaining eye contact with camera.",
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
        provider: "seedance",
        fal_model_slug: "fal-ai/seedance-video-lite",
        duration_seconds: 3,
        aspect_ratio: "9:16",
        motion_intensity: "medium",
        seed: 345678,
        image_prompt:
          "same young woman fresher-looking skin, smiling softly, quick thumbs up, playful head tilt, same bathroom tighter framing, iPhone selfie eye level",
        negative_prompt:
          "no text, no caption, no watermark, no logo, no extra hands, no clinical setting, no white coat, no before/after split",
        motion_description:
          "Subject gives quick thumbs up with playful head tilt toward camera. Slight zoom-in effect.",
      },
    },
  ],
  global: {
    voice_locale: "pt-BR",
    default_video_provider: "kling",
    fal_gateway: "fal.ai",
    fallback_provider_chain: ["kling", "seedance", "veo"],
  },
};

async function main() {
  const t0 = Date.now();

  // --- 1. Setup --------------------------------------------------------------
  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    console.error("[smoke-a6] ❌ SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY ausentes em .env.local");
    process.exit(1);
  }
  if (!process.env.OPENROUTER_API_KEY) {
    console.error("[smoke-a6] ❌ OPENROUTER_API_KEY ausente em .env.local");
    process.exit(1);
  }
  if (!process.env.TELEGRAM_BOT_TOKEN || !process.env.TELEGRAM_CHAT_ID) {
    console.warn("[smoke-a6] ⚠️ TELEGRAM_* não configurado — notificação do tick será no-op");
  }

  const supabase = createClient(url, serviceKey, { auth: { persistSession: false } });

  const { runWorkerA6Tick } = await import("../src/workers/worker-a6");
  const { montadorResultSchema } = await import("../src/lib/agents/renderManifest");

  // --- 2. Cleanup prévio idempotente -----------------------------------------
  const { data: tqDel, error: tqDelErr } = await supabase
    .from("task_queue")
    .delete()
    .eq("project_id", PROJECT_ID)
    .select("id");
  if (tqDelErr) {
    console.error(`[smoke-a6] ❌ cleanup task_queue: ${tqDelErr.message}`);
    process.exit(5);
  }
  const { data: cmDel, error: cmDelErr } = await supabase
    .from("creative_matrix")
    .delete()
    .eq("project_id", PROJECT_ID)
    .select("id");
  if (cmDelErr) {
    console.error(`[smoke-a6] ❌ cleanup creative_matrix: ${cmDelErr.message}`);
    process.exit(5);
  }
  console.log(
    `[smoke-a6] 🧹 cleanup prévio: task_queue=${tqDel?.length ?? 0} creative_matrix=${cmDel?.length ?? 0}`,
  );

  // --- 3. Snapshot ANTES (Regra de Ouro) ------------------------------------
  const { count: matrixCountBefore, error: cBeforeErr } = await supabase
    .from("creative_matrix")
    .select("*", { count: "exact", head: true });
  if (cBeforeErr || matrixCountBefore === null) {
    console.error(`[smoke-a6] ❌ snapshot creative_matrix antes: ${cBeforeErr?.message}`);
    process.exit(1);
  }
  console.log(`[smoke-a6] 📸 creative_matrix global ANTES: ${matrixCountBefore} rows`);

  // --- 4. Insert da fixture --------------------------------------------------
  const { data: inserted, error: insErr } = await supabase
    .from("task_queue")
    .insert({
      project_id: PROJECT_ID,
      agent: "a6",
      status: "pending",
      payload: {
        production_spec: FIXTURE_PRODUCTION_SPEC,
        dry_run: true,
      },
    })
    .select("id")
    .single();
  if (insErr || !inserted) {
    console.error(`[smoke-a6] ❌ insert fixture: ${insErr?.message}`);
    process.exit(1);
  }
  const insertedId = inserted.id;
  console.log(`[smoke-a6] 📥 task pending criada: ${insertedId}`);

  // --- 5. Execução -----------------------------------------------------------
  console.log("[smoke-a6] ▶️  runWorkerA6Tick({maxTasks:1}) ...");
  const tick = await runWorkerA6Tick({ maxTasks: 1 });
  console.log(
    `[smoke-a6] tick: processed=${tick.processed} ok=${tick.succeeded} failed=${tick.failed} skipped=${tick.skipped}`,
  );
  console.log(`[smoke-a6] tick.results: ${JSON.stringify(tick.results, null, 2)}`);

  if (tick.succeeded !== 1) {
    console.error("[smoke-a6] ❌ tick não teve 1 sucesso — abortando antes da auditoria");
    process.exit(2);
  }

  // --- 6. Auditoria pós-execução --------------------------------------------
  const { data: row, error: rowErr } = await supabase
    .from("task_queue")
    .select("status, result, error")
    .eq("id", insertedId)
    .single();
  if (rowErr || !row) {
    console.error(`[smoke-a6] ❌ leitura da row pós-tick: ${rowErr?.message}`);
    process.exit(2);
  }
  if (row.status !== "done") {
    console.error(
      `[smoke-a6] ❌ status esperado 'done', recebido '${row.status}' (error=${row.error})`,
    );
    process.exit(2);
  }

  const parsed = montadorResultSchema.safeParse(row.result);
  if (!parsed.success) {
    console.error("[smoke-a6] ❌ result no DB não bate com montadorResultSchema:");
    for (const issue of parsed.error.issues) {
      console.error(`   - ${issue.path.join(".")}: ${issue.message}`);
    }
    process.exit(3);
  }
  const result = parsed.data;

  // 6a. dry_run flag
  if (!result.dry_run) {
    console.error("[smoke-a6] ❌ dry_run deveria ser true");
    process.exit(3);
  }

  // 6b. Clips em ordem hook→body→cta.
  const manifest = result.render_manifest;
  const order = manifest.clips.map((c) => c.block).join(",");
  if (order !== "hook,body,cta") {
    console.error(`[smoke-a6] ❌ ordem dos clips inválida: ${order}`);
    process.exit(3);
  }

  // 6c. Pixel hash nos bounds.
  if (manifest.pixel_hash.scale < 1.005 || manifest.pixel_hash.scale > 1.015) {
    console.error(
      `[smoke-a6] ❌ pixel_hash.scale=${manifest.pixel_hash.scale} fora de [1.005, 1.015]`,
    );
    process.exit(3);
  }
  if (manifest.pixel_hash.rotation_deg < -0.15 || manifest.pixel_hash.rotation_deg > 0.15) {
    console.error(
      `[smoke-a6] ❌ pixel_hash.rotation_deg=${manifest.pixel_hash.rotation_deg} fora de [-0.15, 0.15]`,
    );
    process.exit(3);
  }

  // 6d. duration_frames coerente com ProductionSpec (±1 frame).
  for (const clip of manifest.clips) {
    const shot = FIXTURE_PRODUCTION_SPEC.shots.find((s) => s.block === clip.block);
    if (!shot) {
      console.error(`[smoke-a6] ❌ bloco ${clip.block} ausente na fixture`);
      process.exit(3);
    }
    const expected = shot.video_generation.duration_seconds * manifest.fps;
    if (Math.abs(clip.duration_frames - expected) > 1) {
      console.error(
        `[smoke-a6] ❌ duration_frames do clip ${clip.block}=${clip.duration_frames} diverge do esperado ${expected} (±1 frame)`,
      );
      process.exit(3);
    }
  }

  // 6e. total_duration_frames == soma.
  const sumFrames = manifest.clips.reduce((s, c) => s + c.duration_frames, 0);
  if (manifest.total_duration_frames !== sumFrames) {
    console.error(
      `[smoke-a6] ❌ total_duration_frames=${manifest.total_duration_frames} ≠ soma=${sumFrames}`,
    );
    process.exit(3);
  }

  // 6f. fal_jobs tem 3 entries com blocks corretos.
  const falBlocks = result.fal_jobs.map((j) => j.block).join(",");
  if (falBlocks !== "hook,body,cta") {
    console.error(`[smoke-a6] ❌ fal_jobs blocks: ${falBlocks}`);
    process.exit(3);
  }

  console.log("\n[smoke-a6] 🎬 render manifest gerado:");
  console.log(`   fps: ${manifest.fps}`);
  console.log(`   resolution: ${manifest.width}×${manifest.height}`);
  console.log(`   total_duration_frames: ${manifest.total_duration_frames}`);
  console.log(`   pixel_hash.scale: ${manifest.pixel_hash.scale}`);
  console.log(`   pixel_hash.rotation_deg: ${manifest.pixel_hash.rotation_deg}`);
  for (const clip of manifest.clips) {
    console.log(
      `\n   [${clip.block.toUpperCase()}] frames=${clip.duration_frames} start=${clip.start_frame} transition=${clip.transition_in}`,
    );
    console.log(`     video_url: ${clip.video_url}`);
    if (clip.text_overlay) {
      console.log(
        `     text_overlay: "${clip.text_overlay.text}" (${clip.text_overlay.position}, ${clip.text_overlay.style})`,
      );
    }
  }
  console.log(`\n   output_video_url: ${result.output_video_url}`);
  console.log(`   dry_run: ${result.dry_run}`);

  // --- 7. Verificação da Regra de Ouro --------------------------------------
  const { count: matrixCountAfter, error: cAfterErr } = await supabase
    .from("creative_matrix")
    .select("*", { count: "exact", head: true });
  if (cAfterErr || matrixCountAfter === null) {
    console.error(`[smoke-a6] ❌ snapshot creative_matrix depois: ${cAfterErr?.message}`);
    process.exit(1);
  }
  console.log(`\n[smoke-a6] 📸 creative_matrix global DEPOIS: ${matrixCountAfter} rows`);

  if (matrixCountAfter !== matrixCountBefore) {
    console.error(
      `[smoke-a6] 🚨 REGRA DE OURO VIOLADA: creative_matrix mudou de ${matrixCountBefore} para ${matrixCountAfter}`,
    );
    process.exit(4);
  }

  const { data: cmLeak, error: cmLeakErr } = await supabase
    .from("creative_matrix")
    .select("id")
    .eq("project_id", PROJECT_ID);
  if (cmLeakErr) {
    console.error(`[smoke-a6] ❌ leitura creative_matrix por project_id: ${cmLeakErr.message}`);
    process.exit(1);
  }
  if (cmLeak && cmLeak.length > 0) {
    console.error(
      `[smoke-a6] 🚨 REGRA DE OURO VIOLADA: ${cmLeak.length} row(s) em creative_matrix com project_id='${PROJECT_ID}'`,
    );
    process.exit(4);
  }
  console.log("[smoke-a6] ✅ Regra de Ouro intacta — creative_matrix inalterada");

  // --- 8. Cleanup final ------------------------------------------------------
  const { error: finalDelErr } = await supabase
    .from("task_queue")
    .delete()
    .eq("id", insertedId);
  if (finalDelErr) {
    console.error(`[smoke-a6] ❌ cleanup final task_queue: ${finalDelErr.message}`);
    process.exit(5);
  }

  const totalMs = Date.now() - t0;
  console.log(
    `\n[smoke-a6] ✅ smoke a6 PASSOU em ${totalMs}ms · dry_run · pixel_hash=${JSON.stringify(manifest.pixel_hash)}`,
  );
}

main().catch((err) => {
  console.error("[smoke-a6] ❌ falha inesperada:", err);
  process.exit(1);
});

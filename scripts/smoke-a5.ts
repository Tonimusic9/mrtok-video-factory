/**
 * Smoke test do Worker a5 — Produtor Visual/Voz (Tarefa 9).
 *
 * Valida end-to-end contra Supabase + OpenRouter REAIS:
 *   1. Insere uma row pending em task_queue (agent='a5') com script +
 *      storyboard hardcoded como fixture (determinístico — sem encadear
 *      smokes upstream).
 *   2. Executa runWorkerA5Tick({maxTasks:1}).
 *   3. Audita: task virou 'done', result bate com productionSpecOutputSchema,
 *      ordem dos shots é hook→body→cta, fal_model_slug coerente com provider,
 *      preferred_video_provider respeitado, duração por shot bate com storyboard.
 *   4. REGRA DE OURO: confirma que NENHUMA linha foi inserida em
 *      creative_matrix (snapshot global antes/depois + filtro por project_id).
 *
 * Uso: `npx tsx scripts/smoke-a5.ts`
 *
 * Exit codes:
 *   0 = ok
 *   1 = env ausente / setup
 *   2 = tick não processou com sucesso
 *   3 = result no DB não bate com productionSpecOutputSchema / cross-checks
 *   4 = REGRA DE OURO violada (creative_matrix mudou)
 *   5 = falha no cleanup
 */
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import type { ScriptOutput } from "../src/lib/agents/scriptwriter";
import type { ImagePromptOutput } from "../src/lib/agents/imagePrompt";

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

const PROJECT_ID = "mrtok-smoke-a5";
const PREFERRED_PROVIDER = "kling" as const;

// --- Fixtures ---------------------------------------------------------------
// Roteiro — reuso literal da fixture do smoke-a4 (determinismo + diff mínimo).
const FIXTURE_SCRIPT: ScriptOutput = {
  hook: {
    voiceover: "Ah, espera—minha pele brilhando de novo às 10 da manhã?",
    visual_disruptor:
      "Close no rosto com brilho visível na zona T, seguido de um gesto de frustração",
    human_imperfection_hint: "Gagueja levemente no 'espera' e faz uma pausa curta",
    duration_seconds: 3,
  },
  body: {
    voiceover:
      "Essa máscara de argila verde é minha salvação nos dias corridos. Aplico, deixo agir uns minutinhos e enxáguo—sem complicação. A pele fica com um toque mais sequinho e menos pesada.",
    key_points: [
      "Fórmula simples, ideal pra quem não tem tempo pra rotinas longas",
      "Ajuda a controlar o brilho e dá uma sensação de pele mais fresca",
    ],
    duration_seconds: 15,
  },
  cta: {
    voiceover: "Testa essa facilidade no seu dia a dia!",
    action_verb: "Testa",
    duration_seconds: 3,
  },
};

// Storyboard — coerente com a fixture do script, em inglês, 9:16.
const FIXTURE_STORYBOARD: ImagePromptOutput = {
  shots: [
    {
      block: "hook",
      duration_seconds: 3,
      subject: "young Brazilian woman in her late 20s, natural makeup, visible oily T-zone",
      action: "tilts phone toward mirror, briefly frowns at her reflection, small frustrated gesture",
      setting: "sunlit bathroom, white tiles, morning light through window",
      camera: "front-facing iPhone selfie, slight handheld shake, eye level close",
      lighting: "natural daylight, soft window light from the left",
      mood: "candid, slightly self-deprecating, relatable",
      negative_prompt:
        "no text, no caption, no watermark, no logo, no extra hands, no clinical setting, no white coat, no before/after split",
    },
    {
      block: "body",
      duration_seconds: 15,
      subject: "same young woman holding an unbranded jar of green clay mask",
      action: "scoops a small amount with fingertip, applies a dab to her cheek, casually talks to camera",
      setting: "same sunlit bathroom, minimalist vanity in background, slightly messy",
      camera: "front-facing iPhone selfie, medium close-up, subtle handheld drift",
      lighting: "natural daylight, soft shadows",
      mood: "warm, friendly, everyday routine",
      negative_prompt:
        "no text, no caption, no watermark, no logo, no extra hands, no clinical setting, no white coat, no before/after split",
    },
    {
      block: "cta",
      duration_seconds: 3,
      subject: "same young woman, fresher-looking skin, smiling softly",
      action: "gives a quick thumbs up and a playful head tilt toward the camera",
      setting: "same bathroom, slightly tighter framing",
      camera: "front-facing iPhone selfie, eye level, steady",
      lighting: "natural daylight",
      mood: "upbeat, inviting, casual",
      negative_prompt:
        "no text, no caption, no watermark, no logo, no extra hands, no clinical setting, no white coat, no before/after split",
    },
  ],
  global_style: {
    aesthetic: "UGC iPhone selfie, natural daylight, subtle grain, shallow depth of field",
    aspect_ratio: "9:16",
    color_palette: "soft warm daylight, muted greens from the mask, natural skin tones",
    forbidden_elements: [
      "clinical setting",
      "white coat",
      "before/after split",
      "ANVISA label",
      "softbox studio lighting",
    ],
  },
};

async function main() {
  const t0 = Date.now();

  // --- 1. Setup --------------------------------------------------------------
  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    console.error("[smoke-a5] ❌ SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY ausentes em .env.local");
    process.exit(1);
  }
  if (!process.env.OPENROUTER_API_KEY) {
    console.error("[smoke-a5] ❌ OPENROUTER_API_KEY ausente em .env.local");
    process.exit(1);
  }
  if (!process.env.TELEGRAM_BOT_TOKEN || !process.env.TELEGRAM_CHAT_ID) {
    console.warn("[smoke-a5] ⚠️ TELEGRAM_* não configurado — notificação do tick será no-op");
  }

  const supabase = createClient(url, serviceKey, { auth: { persistSession: false } });

  const { runWorkerA5Tick } = await import("../src/workers/worker-a5");
  const { productionSpecOutputSchema, FAL_SLUG_BY_PROVIDER } = await import(
    "../src/lib/agents/productionSpec"
  );

  // --- 2. Cleanup prévio idempotente -----------------------------------------
  const { data: tqDel, error: tqDelErr } = await supabase
    .from("task_queue")
    .delete()
    .eq("project_id", PROJECT_ID)
    .select("id");
  if (tqDelErr) {
    console.error(`[smoke-a5] ❌ cleanup task_queue: ${tqDelErr.message}`);
    process.exit(5);
  }
  const { data: cmDel, error: cmDelErr } = await supabase
    .from("creative_matrix")
    .delete()
    .eq("project_id", PROJECT_ID)
    .select("id");
  if (cmDelErr) {
    console.error(`[smoke-a5] ❌ cleanup creative_matrix: ${cmDelErr.message}`);
    process.exit(5);
  }
  console.log(
    `[smoke-a5] 🧹 cleanup prévio: task_queue=${tqDel?.length ?? 0} creative_matrix=${cmDel?.length ?? 0}`,
  );

  // --- 3. Snapshot ANTES (Regra de Ouro) ------------------------------------
  const { count: matrixCountBefore, error: cBeforeErr } = await supabase
    .from("creative_matrix")
    .select("*", { count: "exact", head: true });
  if (cBeforeErr || matrixCountBefore === null) {
    console.error(`[smoke-a5] ❌ snapshot creative_matrix antes: ${cBeforeErr?.message}`);
    process.exit(1);
  }
  console.log(`[smoke-a5] 📸 creative_matrix global ANTES: ${matrixCountBefore} rows`);

  // --- 4. Insert da fixture --------------------------------------------------
  const { data: inserted, error: insErr } = await supabase
    .from("task_queue")
    .insert({
      project_id: PROJECT_ID,
      agent: "a5",
      status: "pending",
      payload: {
        script: FIXTURE_SCRIPT,
        storyboard: FIXTURE_STORYBOARD,
        product_theme: "máscara facial de argila verde para pele oleosa",
        target_persona: "mulher 25-34, rotina apressada, pele mista oleosa",
        voice_locale: "pt-BR",
        preferred_video_provider: PREFERRED_PROVIDER,
        compliance_constraints: [
          "não mostrar embalagem com claims de ANVISA",
          "não usar antes/depois clínico",
          "não mostrar mãos com luva ou jaleco",
        ],
      },
    })
    .select("id")
    .single();
  if (insErr || !inserted) {
    console.error(`[smoke-a5] ❌ insert fixture: ${insErr?.message}`);
    process.exit(1);
  }
  const insertedId = inserted.id;
  console.log(`[smoke-a5] 📥 task pending criada: ${insertedId}`);

  // --- 5. Execução -----------------------------------------------------------
  console.log("[smoke-a5] ▶️  runWorkerA5Tick({maxTasks:1}) ...");
  const tick = await runWorkerA5Tick({ maxTasks: 1 });
  console.log(
    `[smoke-a5] tick: processed=${tick.processed} ok=${tick.succeeded} failed=${tick.failed} skipped=${tick.skipped}`,
  );
  console.log(`[smoke-a5] tick.results: ${JSON.stringify(tick.results, null, 2)}`);

  if (tick.succeeded !== 1) {
    console.error("[smoke-a5] ❌ tick não teve 1 sucesso — abortando antes da auditoria");
    process.exit(2);
  }

  // --- 6. Auditoria pós-execução --------------------------------------------
  const { data: row, error: rowErr } = await supabase
    .from("task_queue")
    .select("status, result, error")
    .eq("id", insertedId)
    .single();
  if (rowErr || !row) {
    console.error(`[smoke-a5] ❌ leitura da row pós-tick: ${rowErr?.message}`);
    process.exit(2);
  }
  if (row.status !== "done") {
    console.error(
      `[smoke-a5] ❌ status esperado 'done', recebido '${row.status}' (error=${row.error})`,
    );
    process.exit(2);
  }

  const parsed = productionSpecOutputSchema.safeParse(row.result);
  if (!parsed.success) {
    console.error("[smoke-a5] ❌ result no DB não bate com productionSpecOutputSchema:");
    for (const issue of parsed.error.issues) {
      console.error(`   - ${issue.path.join(".")}: ${issue.message}`);
    }
    process.exit(3);
  }
  const spec = parsed.data;

  // 6a. Ordem dos shots.
  const order = spec.shots.map((s) => s.block).join(",");
  if (order !== "hook,body,cta") {
    console.error(`[smoke-a5] ❌ ordem dos shots inválida: ${order}`);
    process.exit(3);
  }

  // 6b. fal_model_slug coerente com provider por shot.
  for (const shot of spec.shots) {
    const expected = FAL_SLUG_BY_PROVIDER[shot.video_generation.provider];
    if (shot.video_generation.fal_model_slug !== expected) {
      console.error(
        `[smoke-a5] ❌ fal_model_slug inconsistente no shot ${shot.block}: provider=${shot.video_generation.provider} esperava "${expected}", recebeu "${shot.video_generation.fal_model_slug}"`,
      );
      process.exit(3);
    }
  }

  // 6c. preferred_video_provider respeitado.
  if (spec.global.default_video_provider !== PREFERRED_PROVIDER) {
    console.error(
      `[smoke-a5] ❌ preferred_video_provider ignorado: esperado "${PREFERRED_PROVIDER}", recebido "${spec.global.default_video_provider}"`,
    );
    process.exit(3);
  }

  // 6d. Duração por shot bate com storyboard.
  const storyboardByBlock = new Map(
    FIXTURE_STORYBOARD.shots.map((s) => [s.block, s.duration_seconds]),
  );
  for (const shot of spec.shots) {
    const expected = storyboardByBlock.get(shot.block);
    if (shot.video_generation.duration_seconds !== expected) {
      console.error(
        `[smoke-a5] ❌ duração do shot ${shot.block} diverge: esperado ${expected}s, recebido ${shot.video_generation.duration_seconds}s`,
      );
      process.exit(3);
    }
  }

  console.log("\n[smoke-a5] 🎬 production spec gerada:");
  console.log(`   global.voice_locale: ${spec.global.voice_locale}`);
  console.log(`   global.default_video_provider: ${spec.global.default_video_provider}`);
  console.log(`   global.fal_gateway: ${spec.global.fal_gateway}`);
  console.log(
    `   global.fallback_provider_chain: [${spec.global.fallback_provider_chain.join(", ")}]`,
  );
  for (const shot of spec.shots) {
    console.log(`\n   [${shot.block.toUpperCase()}] ${shot.video_generation.duration_seconds}s`);
    console.log(`     voice.voice_id:           ${shot.voice.voice_id}`);
    console.log(`     voice.pacing_wpm:         ${shot.voice.pacing_wpm}`);
    console.log(`     voice.emphasis:           ${shot.voice.emphasis.join(" | ")}`);
    console.log(`     voice.pauses_ms:          ${JSON.stringify(shot.voice.pauses_ms)}`);
    console.log(`     voice.human_imperfection: ${shot.voice.human_imperfection}`);
    console.log(`     voice.ssml:               ${shot.voice.ssml}`);
    console.log(`     video.provider:           ${shot.video_generation.provider}`);
    console.log(`     video.fal_model_slug:     ${shot.video_generation.fal_model_slug}`);
    console.log(`     video.motion_intensity:   ${shot.video_generation.motion_intensity}`);
    console.log(`     video.seed:               ${shot.video_generation.seed}`);
    console.log(`     video.image_prompt:       ${shot.video_generation.image_prompt}`);
    console.log(`     video.negative_prompt:    ${shot.video_generation.negative_prompt}`);
    console.log(`     video.motion_description: ${shot.video_generation.motion_description}`);
  }
  console.log("");

  // --- 7. Verificação da Regra de Ouro --------------------------------------
  const { count: matrixCountAfter, error: cAfterErr } = await supabase
    .from("creative_matrix")
    .select("*", { count: "exact", head: true });
  if (cAfterErr || matrixCountAfter === null) {
    console.error(`[smoke-a5] ❌ snapshot creative_matrix depois: ${cAfterErr?.message}`);
    process.exit(1);
  }
  console.log(`[smoke-a5] 📸 creative_matrix global DEPOIS: ${matrixCountAfter} rows`);

  if (matrixCountAfter !== matrixCountBefore) {
    console.error(
      `[smoke-a5] 🚨 REGRA DE OURO VIOLADA: creative_matrix mudou de ${matrixCountBefore} para ${matrixCountAfter}`,
    );
    process.exit(4);
  }

  const { data: cmLeak, error: cmLeakErr } = await supabase
    .from("creative_matrix")
    .select("id")
    .eq("project_id", PROJECT_ID);
  if (cmLeakErr) {
    console.error(`[smoke-a5] ❌ leitura creative_matrix por project_id: ${cmLeakErr.message}`);
    process.exit(1);
  }
  if (cmLeak && cmLeak.length > 0) {
    console.error(
      `[smoke-a5] 🚨 REGRA DE OURO VIOLADA: ${cmLeak.length} row(s) em creative_matrix com project_id='${PROJECT_ID}'`,
    );
    process.exit(4);
  }
  console.log("[smoke-a5] ✅ Regra de Ouro intacta — creative_matrix inalterada");

  // --- 8. Cleanup final ------------------------------------------------------
  const { error: finalDelErr } = await supabase
    .from("task_queue")
    .delete()
    .eq("id", insertedId);
  if (finalDelErr) {
    console.error(`[smoke-a5] ❌ cleanup final task_queue: ${finalDelErr.message}`);
    process.exit(5);
  }

  const totalMs = Date.now() - t0;
  console.log(
    `\n[smoke-a5] ✅ smoke a5 PASSOU em ${totalMs}ms · 3 shots · default_provider=${spec.global.default_video_provider}`,
  );
}

main().catch((err) => {
  console.error("[smoke-a5] ❌ falha inesperada:", err);
  process.exit(1);
});

/**
 * smoke-chain-a6-a7.ts — valida o ciclo AUTÔNOMO a6 → a7 ponta-a-ponta.
 *
 * Objetivo: comprovar que, com `delivery_context` no payload do a6, o
 * `agent-runner` injeta uma task a7 `pending` logo após o done do a6, e
 * que essa task é drenada pelo Worker a7 sem intervenção manual.
 *
 * Fluxo:
 *   1. Gera um MP4 dummy em `./output/publish_ready/smoke-chain-<ts>.mp4`
 *      (ffmpeg testsrc, 720×1280, 2s, 30fps) — é o arquivo que o a7
 *      vai enviar de fato para o Telegram.
 *   2. Cleanup prévio idempotente de task_queue(project_id=PROJECT_ID).
 *   3. Insere task a6 pending com `production_spec` + `dry_run=true` +
 *      `delivery_context` (habilita o chaining).
 *   4. Executa `runWorkerA6Tick({maxTasks:1})` — o a6 termina em dry_run,
 *      o runner injeta task a7 filha via `chainNextTask`.
 *   5. Busca a task a7 filha via `parent_task_id` e PATCHA o
 *      `output_video_url` para apontar para o MP4 dummy (porque o a6
 *      dry_run devolve um URL fictício).
 *   6. Executa `runWorkerA7Tick({maxTasks:1})` — envia o MP4 real via
 *      Telegram sendDocument.
 *   7. Audita: task a6 done, task a7 done com recibo válido, file_name
 *      segue o padrão canônico do a7.
 *   8. REGRA DE OURO: creative_matrix inalterada.
 *   9. Cleanup: deleta as duas rows, apaga o MP4.
 *
 * ⚠️  Este smoke DISPARA um envio REAL ao celular do administrador. Use
 *     com moderação.
 *
 * Uso: `npx tsx scripts/smoke-chain-a6-a7.ts`
 *
 * Exit codes:
 *   0 = ok
 *   1 = env ausente / setup / ffmpeg
 *   2 = tick a6 ou a7 não processou com sucesso
 *   3 = chaining não injetou task filha ou result não bate com schema
 *   4 = REGRA DE OURO violada (creative_matrix mudou)
 *   5 = falha no cleanup
 */
import {
  readFileSync,
  existsSync,
  statSync,
  mkdirSync,
  unlinkSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import * as path from "node:path";
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

const PROJECT_ID = "mrtok-smoke-chain-a6-a7";
const ACCOUNT_ID = "acc_chain";
const ACCOUNT_HANDLE = "@smoke_chain_a6a7";
const PRODUCT_NAME = "Sérum Vitamina C Chain";

// --- Fixture ProductionSpec mínima (reaproveitada do smoke-a6) --------------
const FIXTURE_PRODUCTION_SPEC: ProductionSpecOutput = {
  shots: [
    {
      block: "hook",
      voice: {
        voice_id: "pt-BR-creator-female-01",
        ssml: "Ah, espera — minha pele brilhando de novo?",
        pacing_wpm: 175,
        emphasis: ["brilhando"],
        pauses_ms: [],
        human_imperfection: "Tom de surpresa leve",
      },
      video_generation: {
        provider: "kling",
        fal_model_slug: "fal-ai/kling-video/v2.1/standard",
        duration_seconds: 3,
        aspect_ratio: "9:16",
        motion_intensity: "high",
        seed: 111,
        image_prompt: "young woman selfie bathroom chain smoke",
        negative_prompt: "no text, no watermark",
        motion_description: "quick head turn",
      },
    },
    {
      block: "body",
      voice: {
        voice_id: "pt-BR-creator-female-01",
        ssml: "Esse sérum virou meu favorito do dia a dia.",
        pacing_wpm: 155,
        emphasis: ["favorito"],
        pauses_ms: [],
        human_imperfection: "Aceleração no meio",
      },
      video_generation: {
        provider: "seedance",
        fal_model_slug: "fal-ai/seedance-video-lite",
        duration_seconds: 15,
        aspect_ratio: "9:16",
        motion_intensity: "low",
        seed: 222,
        image_prompt: "same woman applying serum to face",
        negative_prompt: "no text, no watermark",
        motion_description: "slow handheld drift",
      },
    },
    {
      block: "cta",
      voice: {
        voice_id: "pt-BR-creator-female-01",
        ssml: "Testa no seu dia a dia!",
        pacing_wpm: 165,
        emphasis: ["Testa"],
        pauses_ms: [],
        human_imperfection: "Tom empolgado",
      },
      video_generation: {
        provider: "seedance",
        fal_model_slug: "fal-ai/seedance-video-lite",
        duration_seconds: 3,
        aspect_ratio: "9:16",
        motion_intensity: "medium",
        seed: 333,
        image_prompt: "same woman thumbs up",
        negative_prompt: "no text, no watermark",
        motion_description: "quick thumbs up with zoom-in",
      },
    },
  ],
  global: {
    voice_locale: "pt-BR",
    default_video_provider: "seedance",
    fal_gateway: "fal.ai",
    fallback_provider_chain: ["seedance", "kling", "veo"],
  },
};

async function main(): Promise<void> {
  const t0 = Date.now();

  // --- 1. Setup --------------------------------------------------------------
  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    console.error("[smoke-chain] ❌ SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY ausentes");
    process.exit(1);
  }
  if (!process.env.OPENROUTER_API_KEY) {
    console.error("[smoke-chain] ❌ OPENROUTER_API_KEY ausente");
    process.exit(1);
  }
  if (!process.env.TELEGRAM_BOT_TOKEN || !process.env.TELEGRAM_CHAT_ID) {
    console.error("[smoke-chain] ❌ TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID ausentes");
    process.exit(1);
  }

  const supabase = createClient(url, serviceKey, {
    auth: { persistSession: false },
  });

  const { runWorkerA6Tick } = await import("../src/workers/worker-a6");
  const { runWorkerA7Tick, deliveryResultSchema } = await import(
    "../src/workers/worker-a7"
  );

  // --- 2. Gerar MP4 dummy ----------------------------------------------------
  const outDir = path.resolve("output/publish_ready");
  if (!existsSync(outDir)) {
    mkdirSync(outDir, { recursive: true });
  }
  const mp4Name = `smoke-chain-${Date.now()}.mp4`;
  const mp4Path = path.join(outDir, mp4Name);
  try {
    execFileSync(
      "ffmpeg",
      [
        "-y",
        "-f", "lavfi",
        "-i", "testsrc=duration=2:size=720x1280:rate=30",
        "-pix_fmt", "yuv420p",
        "-c:v", "libx264",
        "-preset", "ultrafast",
        mp4Path,
      ],
      { stdio: ["ignore", "ignore", "ignore"] },
    );
  } catch (err) {
    console.error(`[smoke-chain] ❌ ffmpeg falhou: ${(err as Error).message}`);
    process.exit(1);
  }
  const mp4Size = statSync(mp4Path).size;
  console.log(`[smoke-chain] 🎬 mp4 dummy: ${mp4Path} (${mp4Size} bytes)`);

  // --- 3. Cleanup prévio idempotente -----------------------------------------
  const { error: tqDelErr } = await supabase
    .from("task_queue")
    .delete()
    .eq("project_id", PROJECT_ID);
  if (tqDelErr) {
    console.error(`[smoke-chain] ❌ cleanup task_queue: ${tqDelErr.message}`);
    process.exit(5);
  }
  console.log("[smoke-chain] 🧹 cleanup prévio ok");

  // --- 4. Snapshot Regra de Ouro ---------------------------------------------
  const { count: matrixCountBefore, error: cBeforeErr } = await supabase
    .from("creative_matrix")
    .select("*", { count: "exact", head: true });
  if (cBeforeErr || matrixCountBefore === null) {
    console.error(`[smoke-chain] ❌ snapshot antes: ${cBeforeErr?.message}`);
    process.exit(1);
  }
  console.log(`[smoke-chain] 📸 creative_matrix ANTES: ${matrixCountBefore}`);

  // --- 5. Insert da task a6 com delivery_context -----------------------------
  const { data: a6Inserted, error: a6InsErr } = await supabase
    .from("task_queue")
    .insert({
      project_id: PROJECT_ID,
      agent: "a6",
      status: "pending",
      payload: {
        production_spec: FIXTURE_PRODUCTION_SPEC,
        dry_run: true,
        delivery_context: {
          account_id: ACCOUNT_ID,
          account_handle: ACCOUNT_HANDLE,
          product_name: PRODUCT_NAME,
        },
      },
    })
    .select("id")
    .single();
  if (a6InsErr || !a6Inserted) {
    console.error(`[smoke-chain] ❌ insert task a6: ${a6InsErr?.message}`);
    process.exit(1);
  }
  const a6Id = a6Inserted.id;
  console.log(`[smoke-chain] 📥 task a6 pending criada: ${a6Id}`);

  // --- 6. Tick a6 (dry_run) --------------------------------------------------
  console.log("[smoke-chain] ▶️  runWorkerA6Tick({maxTasks:1}) ...");
  const a6Tick = await runWorkerA6Tick({ maxTasks: 1 });
  console.log(
    `[smoke-chain] a6 tick: processed=${a6Tick.processed} ok=${a6Tick.succeeded} failed=${a6Tick.failed}`,
  );
  if (a6Tick.succeeded !== 1) {
    console.error("[smoke-chain] ❌ tick a6 não teve 1 sucesso");
    process.exit(2);
  }

  // --- 7. Verificar chaining: task a7 filha deve existir em pending ---------
  const { data: childRows, error: childErr } = await supabase
    .from("task_queue")
    .select("id, agent, status, payload, parent_task_id")
    .eq("parent_task_id", a6Id);
  if (childErr) {
    console.error(`[smoke-chain] ❌ leitura tasks filhas: ${childErr.message}`);
    process.exit(3);
  }
  if (!childRows || childRows.length !== 1) {
    console.error(
      `[smoke-chain] ❌ esperava 1 task a7 filha, recebeu ${childRows?.length ?? 0}`,
    );
    process.exit(3);
  }
  const a7Row = childRows[0];
  if (a7Row.agent !== "a7" || a7Row.status !== "pending") {
    console.error(
      `[smoke-chain] ❌ task filha inválida: agent=${a7Row.agent} status=${a7Row.status}`,
    );
    process.exit(3);
  }
  console.log(`[smoke-chain] 🔗 chaining ok — task a7 pending ${a7Row.id}`);

  // --- 8. Patch do output_video_url para o MP4 dummy ------------------------
  // O a6 em dry_run emite um file:// fictício. Aqui sobrescrevemos o payload
  // da task filha para apontar para o MP4 real gerado acima. Isto simula o
  // que aconteceria com um render real da VPS.
  const patchedPayload = {
    ...(a7Row.payload as Record<string, unknown>),
    output_video_url: `file://${mp4Path}`,
  };
  const { error: patchErr } = await supabase
    .from("task_queue")
    .update({ payload: patchedPayload })
    .eq("id", a7Row.id);
  if (patchErr) {
    console.error(`[smoke-chain] ❌ patch payload a7: ${patchErr.message}`);
    process.exit(3);
  }
  console.log("[smoke-chain] 🩹 payload da task a7 patcheado com mp4 dummy");

  // --- 9. Tick a7 (envio real ao Telegram) -----------------------------------
  console.log("[smoke-chain] ▶️  runWorkerA7Tick({maxTasks:1}) ...");
  const a7Tick = await runWorkerA7Tick({ maxTasks: 1 });
  console.log(
    `[smoke-chain] a7 tick: processed=${a7Tick.processed} ok=${a7Tick.succeeded} failed=${a7Tick.failed}`,
  );
  if (a7Tick.succeeded !== 1) {
    console.error("[smoke-chain] ❌ tick a7 não teve 1 sucesso");
    process.exit(2);
  }

  // --- 10. Auditoria do resultado do a7 --------------------------------------
  const { data: a7RowAfter, error: a7RowErr } = await supabase
    .from("task_queue")
    .select("status, result, error")
    .eq("id", a7Row.id)
    .single();
  if (a7RowErr || !a7RowAfter) {
    console.error(`[smoke-chain] ❌ leitura a7 pós-tick: ${a7RowErr?.message}`);
    process.exit(2);
  }
  if (a7RowAfter.status !== "done") {
    console.error(
      `[smoke-chain] ❌ a7 status=${a7RowAfter.status} (error=${a7RowAfter.error})`,
    );
    process.exit(2);
  }
  const parsed = deliveryResultSchema.safeParse(a7RowAfter.result);
  if (!parsed.success) {
    console.error("[smoke-chain] ❌ result a7 não bate com deliveryResultSchema:");
    for (const issue of parsed.error.issues) {
      console.error(`   - ${issue.path.join(".")}: ${issue.message}`);
    }
    process.exit(3);
  }
  const deliveryResult = parsed.data;
  if (deliveryResult.delivery_status !== "SUCCESS") {
    console.error(`[smoke-chain] ❌ delivery_status=${deliveryResult.delivery_status}`);
    process.exit(3);
  }
  if (deliveryResult.storage_details.target_account_handle !== ACCOUNT_HANDLE) {
    console.error(
      `[smoke-chain] ❌ target_account_handle=${deliveryResult.storage_details.target_account_handle}`,
    );
    process.exit(3);
  }
  const fileNamePattern = new RegExp(`^${ACCOUNT_ID}_[a-z0-9_]+_\\d+\\.mp4$`);
  if (!fileNamePattern.test(deliveryResult.storage_details.file_name)) {
    console.error(
      `[smoke-chain] ❌ file_name fora do padrão: ${deliveryResult.storage_details.file_name}`,
    );
    process.exit(3);
  }

  console.log("\n[smoke-chain] 📬 recibo de entrega:");
  console.log(`   message_id: ${deliveryResult.storage_details.telegram_message_id}`);
  console.log(`   file_name:  ${deliveryResult.storage_details.file_name}`);
  console.log(`   handle:     ${deliveryResult.storage_details.target_account_handle}`);

  // --- 11. Regra de Ouro -----------------------------------------------------
  const { count: matrixCountAfter, error: cAfterErr } = await supabase
    .from("creative_matrix")
    .select("*", { count: "exact", head: true });
  if (cAfterErr || matrixCountAfter === null) {
    console.error(`[smoke-chain] ❌ snapshot depois: ${cAfterErr?.message}`);
    process.exit(1);
  }
  if (matrixCountAfter !== matrixCountBefore) {
    console.error(
      `[smoke-chain] 🚨 REGRA DE OURO VIOLADA: ${matrixCountBefore} → ${matrixCountAfter}`,
    );
    process.exit(4);
  }
  console.log("[smoke-chain] ✅ Regra de Ouro intacta");

  // --- 12. Cleanup final -----------------------------------------------------
  const { error: finalDelErr } = await supabase
    .from("task_queue")
    .delete()
    .eq("project_id", PROJECT_ID);
  if (finalDelErr) {
    console.error(`[smoke-chain] ❌ cleanup final: ${finalDelErr.message}`);
    process.exit(5);
  }
  try {
    unlinkSync(mp4Path);
    console.log(`[smoke-chain] 🧹 mp4 dummy removido: ${mp4Path}`);
  } catch (err) {
    console.warn(`[smoke-chain] ⚠️ falha ao remover mp4: ${(err as Error).message}`);
  }

  const totalMs = Date.now() - t0;
  console.log(
    `\n[smoke-chain] ✅ smoke chain a6→a7 PASSOU em ${totalMs}ms · msg=${deliveryResult.storage_details.telegram_message_id}`,
  );
  console.log(
    "[smoke-chain] 📱 confira o celular — o MP4 deve ter chegado como DOCUMENTO.",
  );
}

main().catch((err) => {
  console.error("[smoke-chain] ❌ falha inesperada:", err);
  process.exit(1);
});

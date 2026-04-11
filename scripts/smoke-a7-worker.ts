/**
 * smoke-a7-worker.ts — valida o RUNTIME do Worker a7 (Delivery) end-to-end
 * contra Supabase REAL + Telegram Bot API REAL.
 *
 * Diferença para `smoke-a7-telegram.ts`:
 *   - aquele valida só a ponte Bot API (sem runtime do agente);
 *   - este valida o `runWorkerA7Tick()` completo: claim atômico, pré-validação
 *     de arquivo, sendDocument, persistência do recibo em task_queue.result.
 *
 * Fluxo:
 *   1. Gera MP4 dummy (ffmpeg testsrc 720×1280, 2s, 30fps) em
 *      `./output/publish_ready/smoke-a7-worker-<ts>.mp4`.
 *   2. Cleanup prévio idempotente de task_queue(project_id=PROJECT_ID).
 *   3. Insere row pending em task_queue(agent='a7') apontando para o MP4.
 *   4. Executa `runWorkerA7Tick({maxTasks:1})`.
 *   5. Audita: tick.succeeded===1, row.status==='done',
 *      result bate com deliveryResultSchema,
 *      telegram_message_id é number positivo,
 *      file_name segue padrão [account_id]_[slug]_[ts].mp4.
 *   6. REGRA DE OURO: confirma que creative_matrix permaneceu inalterada.
 *   7. Cleanup: deleta row, apaga MP4 dummy.
 *
 * ⚠️  Este smoke DISPARA um envio REAL ao celular do administrador via
 *     Telegram. Use com moderação (rate limit Bot API ~30 msgs/s).
 *
 * Uso: `npx tsx scripts/smoke-a7-worker.ts`
 *
 * Exit codes:
 *   0 = ok
 *   1 = env ausente / setup / ffmpeg
 *   2 = tick não processou com sucesso
 *   3 = result no DB não bate com deliveryResultSchema / cross-checks
 *   4 = REGRA DE OURO violada (creative_matrix mudou)
 *   5 = falha no cleanup
 */
import { readFileSync, existsSync, statSync, mkdirSync, unlinkSync } from "node:fs";
import { execFileSync } from "node:child_process";
import * as path from "node:path";
import { createClient } from "@supabase/supabase-js";

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

const PROJECT_ID = "mrtok-smoke-a7-worker";
const ACCOUNT_ID = "acc99";
const ACCOUNT_HANDLE = "@smoke_a7_test";
const PRODUCT_NAME = "Máscara Argila Verde Smoke";

async function main(): Promise<void> {
  const t0 = Date.now();

  // --- 1. Setup --------------------------------------------------------------
  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    console.error("[smoke-a7-worker] ❌ SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY ausentes");
    process.exit(1);
  }
  if (!process.env.TELEGRAM_BOT_TOKEN || !process.env.TELEGRAM_CHAT_ID) {
    console.error("[smoke-a7-worker] ❌ TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID ausentes");
    process.exit(1);
  }

  const supabase = createClient(url, serviceKey, {
    auth: { persistSession: false },
  });

  const { runWorkerA7Tick, deliveryResultSchema } = await import(
    "../src/workers/worker-a7"
  );

  // --- 2. Gerar MP4 dummy em ./output/publish_ready/ -------------------------
  const outDir = path.resolve("output/publish_ready");
  if (!existsSync(outDir)) {
    mkdirSync(outDir, { recursive: true });
  }
  const mp4Name = `smoke-a7-worker-${Date.now()}.mp4`;
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
    console.error(
      `[smoke-a7-worker] ❌ ffmpeg falhou: ${(err as Error).message}`,
    );
    process.exit(1);
  }
  const mp4Size = statSync(mp4Path).size;
  console.log(
    `[smoke-a7-worker] 🎬 mp4 dummy: ${mp4Path} (${mp4Size} bytes)`,
  );

  // --- 3. Cleanup prévio idempotente -----------------------------------------
  const { data: tqDel, error: tqDelErr } = await supabase
    .from("task_queue")
    .delete()
    .eq("project_id", PROJECT_ID)
    .select("id");
  if (tqDelErr) {
    console.error(`[smoke-a7-worker] ❌ cleanup task_queue: ${tqDelErr.message}`);
    process.exit(5);
  }
  console.log(
    `[smoke-a7-worker] 🧹 cleanup prévio: task_queue=${tqDel?.length ?? 0}`,
  );

  // --- 4. Snapshot ANTES (Regra de Ouro) -------------------------------------
  const { count: matrixCountBefore, error: cBeforeErr } = await supabase
    .from("creative_matrix")
    .select("*", { count: "exact", head: true });
  if (cBeforeErr || matrixCountBefore === null) {
    console.error(
      `[smoke-a7-worker] ❌ snapshot creative_matrix antes: ${cBeforeErr?.message}`,
    );
    process.exit(1);
  }
  console.log(
    `[smoke-a7-worker] 📸 creative_matrix global ANTES: ${matrixCountBefore} rows`,
  );

  // --- 5. Insert da task pending ---------------------------------------------
  const { data: inserted, error: insErr } = await supabase
    .from("task_queue")
    .insert({
      project_id: PROJECT_ID,
      agent: "a7",
      status: "pending",
      payload: {
        project_id: PROJECT_ID,
        output_video_url: `file://${mp4Path}`,
        account_id: ACCOUNT_ID,
        account_handle: ACCOUNT_HANDLE,
        product_name: PRODUCT_NAME,
      },
    })
    .select("id")
    .single();
  if (insErr || !inserted) {
    console.error(`[smoke-a7-worker] ❌ insert task: ${insErr?.message}`);
    process.exit(1);
  }
  const insertedId = inserted.id;
  console.log(`[smoke-a7-worker] 📥 task pending criada: ${insertedId}`);

  // --- 6. Execução -----------------------------------------------------------
  console.log("[smoke-a7-worker] ▶️  runWorkerA7Tick({maxTasks:1}) ...");
  const tick = await runWorkerA7Tick({ maxTasks: 1 });
  console.log(
    `[smoke-a7-worker] tick: processed=${tick.processed} ok=${tick.succeeded} failed=${tick.failed} skipped=${tick.skipped}`,
  );
  console.log(
    `[smoke-a7-worker] tick.results: ${JSON.stringify(tick.results, null, 2)}`,
  );

  if (tick.succeeded !== 1) {
    console.error("[smoke-a7-worker] ❌ tick não teve 1 sucesso");
    process.exit(2);
  }

  // --- 7. Auditoria pós-execução ---------------------------------------------
  const { data: row, error: rowErr } = await supabase
    .from("task_queue")
    .select("status, result, error")
    .eq("id", insertedId)
    .single();
  if (rowErr || !row) {
    console.error(`[smoke-a7-worker] ❌ leitura row: ${rowErr?.message}`);
    process.exit(2);
  }
  if (row.status !== "done") {
    console.error(
      `[smoke-a7-worker] ❌ status esperado 'done', recebido '${row.status}' (error=${row.error})`,
    );
    process.exit(2);
  }

  const parsed = deliveryResultSchema.safeParse(row.result);
  if (!parsed.success) {
    console.error("[smoke-a7-worker] ❌ result no DB não bate com deliveryResultSchema:");
    for (const issue of parsed.error.issues) {
      console.error(`   - ${issue.path.join(".")}: ${issue.message}`);
    }
    process.exit(3);
  }
  const result = parsed.data;

  // 7a. delivery_status === 'SUCCESS'
  if (result.delivery_status !== "SUCCESS") {
    console.error(
      `[smoke-a7-worker] ❌ delivery_status=${result.delivery_status}`,
    );
    process.exit(3);
  }

  // 7b. project_id bate
  if (result.project_id !== PROJECT_ID) {
    console.error(
      `[smoke-a7-worker] ❌ project_id=${result.project_id} ≠ ${PROJECT_ID}`,
    );
    process.exit(3);
  }

  // 7c. provider é telegram_document (zod já garante o literal, mas logamos)
  // 7d. chat_id bate com o env
  if (result.storage_details.chat_id !== process.env.TELEGRAM_CHAT_ID) {
    console.error(
      `[smoke-a7-worker] ❌ chat_id=${result.storage_details.chat_id} ≠ env`,
    );
    process.exit(3);
  }

  // 7e. telegram_message_id é number positivo
  if (
    !Number.isFinite(result.storage_details.telegram_message_id) ||
    result.storage_details.telegram_message_id <= 0
  ) {
    console.error(
      `[smoke-a7-worker] ❌ telegram_message_id inválido: ${result.storage_details.telegram_message_id}`,
    );
    process.exit(3);
  }

  // 7f. file_name segue o padrão [account_id]_[slug]_[timestamp].mp4
  const fileNamePattern = new RegExp(`^${ACCOUNT_ID}_[a-z0-9_]+_\\d+\\.mp4$`);
  if (!fileNamePattern.test(result.storage_details.file_name)) {
    console.error(
      `[smoke-a7-worker] ❌ file_name fora do padrão: ${result.storage_details.file_name}`,
    );
    process.exit(3);
  }

  // 7g. target_account_handle preservado
  if (result.storage_details.target_account_handle !== ACCOUNT_HANDLE) {
    console.error(
      `[smoke-a7-worker] ❌ target_account_handle=${result.storage_details.target_account_handle}`,
    );
    process.exit(3);
  }

  console.log("\n[smoke-a7-worker] 📬 recibo de entrega:");
  console.log(`   provider:              ${result.storage_details.provider}`);
  console.log(`   chat_id:               ${result.storage_details.chat_id}`);
  console.log(`   telegram_message_id:   ${result.storage_details.telegram_message_id}`);
  console.log(`   file_name:             ${result.storage_details.file_name}`);
  console.log(`   target_account_handle: ${result.storage_details.target_account_handle}`);
  console.log(`   message_for_ceo:       ${result.message_for_ceo}`);

  // --- 8. Verificação da Regra de Ouro ---------------------------------------
  const { count: matrixCountAfter, error: cAfterErr } = await supabase
    .from("creative_matrix")
    .select("*", { count: "exact", head: true });
  if (cAfterErr || matrixCountAfter === null) {
    console.error(
      `[smoke-a7-worker] ❌ snapshot creative_matrix depois: ${cAfterErr?.message}`,
    );
    process.exit(1);
  }
  console.log(
    `\n[smoke-a7-worker] 📸 creative_matrix global DEPOIS: ${matrixCountAfter} rows`,
  );
  if (matrixCountAfter !== matrixCountBefore) {
    console.error(
      `[smoke-a7-worker] 🚨 REGRA DE OURO VIOLADA: creative_matrix mudou de ${matrixCountBefore} para ${matrixCountAfter}`,
    );
    process.exit(4);
  }
  console.log("[smoke-a7-worker] ✅ Regra de Ouro intacta — creative_matrix inalterada");

  // --- 9. Cleanup final ------------------------------------------------------
  const { error: finalDelErr } = await supabase
    .from("task_queue")
    .delete()
    .eq("id", insertedId);
  if (finalDelErr) {
    console.error(
      `[smoke-a7-worker] ❌ cleanup final task_queue: ${finalDelErr.message}`,
    );
    process.exit(5);
  }

  try {
    unlinkSync(mp4Path);
    console.log(`[smoke-a7-worker] 🧹 mp4 dummy removido: ${mp4Path}`);
  } catch (err) {
    console.warn(
      `[smoke-a7-worker] ⚠️ falha ao remover mp4 dummy: ${(err as Error).message}`,
    );
  }

  const totalMs = Date.now() - t0;
  console.log(
    `\n[smoke-a7-worker] ✅ smoke a7 runtime PASSOU em ${totalMs}ms · msg=${result.storage_details.telegram_message_id} · file=${result.storage_details.file_name}`,
  );
  console.log(
    "[smoke-a7-worker] 📱 confira o celular — o MP4 deve ter chegado como DOCUMENTO (não vídeo reproduzível in-app).",
  );
}

main().catch((err) => {
  console.error("[smoke-a7-worker] ❌ falha inesperada:", err);
  process.exit(1);
});

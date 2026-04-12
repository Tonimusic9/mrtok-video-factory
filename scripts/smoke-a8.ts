/**
 * smoke-a8.ts — valida o RUNTIME do Worker a8 (Analytics) end-to-end contra
 * Supabase REAL, SEM chamar DeepSeek. Estratégia: forçar `min_samples`
 * maior que o número de linhas injetadas → worker curto-circuita e devolve
 * um relatório vazio canônico. Isso exercita:
 *   - claim atômico em task_queue
 *   - query com JOIN hook_performance ⇄ creative_matrix
 *   - filtro temporal por collection_date (colunas novas da migration 0002)
 *   - persistência em task_queue.result validada por analyticsReportSchema
 *   - REGRA DE OURO: creative_matrix count intacto
 *
 * Uma versão "full" que bate no DeepSeek ficará em `smoke-a8-live.ts` (v1.1),
 * quando houver budget de tokens para rodar em CI.
 *
 * Uso: `npx tsx scripts/smoke-a8.ts`
 *
 * Exit codes:
 *   0 = ok
 *   1 = env ausente / setup
 *   2 = tick não processou com sucesso
 *   3 = result no DB não bate com analyticsReportSchema / cross-checks
 *   4 = REGRA DE OURO violada (creative_matrix mudou)
 *   5 = falha no cleanup
 */
import { readFileSync } from "node:fs";
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

const PROJECT_ID = `mrtok-smoke-a8-${Date.now()}`;

async function main(): Promise<void> {
  const t0 = Date.now();

  // --- 1. Setup --------------------------------------------------------------
  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    console.error("[smoke-a8] ❌ SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY ausentes");
    process.exit(1);
  }

  const supabase = createClient(url, serviceKey, {
    auth: { persistSession: false },
  });

  const { runWorkerA8Tick, analyticsReportSchema } = await import(
    "../src/workers/worker-a8"
  );

  // --- 2. Cleanup prévio idempotente -----------------------------------------
  const { error: tqDelErr } = await supabase
    .from("task_queue")
    .delete()
    .eq("project_id", PROJECT_ID);
  if (tqDelErr) {
    console.error(`[smoke-a8] ❌ cleanup task_queue: ${tqDelErr.message}`);
    process.exit(5);
  }

  // --- 3. Snapshot ANTES (Regra de Ouro) -------------------------------------
  const { count: matrixCountBefore, error: cBeforeErr } = await supabase
    .from("creative_matrix")
    .select("*", { count: "exact", head: true });
  if (cBeforeErr || matrixCountBefore === null) {
    console.error(
      `[smoke-a8] ❌ snapshot creative_matrix antes: ${cBeforeErr?.message}`,
    );
    process.exit(1);
  }
  console.log(
    `[smoke-a8] 📸 creative_matrix global ANTES: ${matrixCountBefore} rows`,
  );

  // --- 4. Enfileirar task a8 pending -----------------------------------------
  // Estratégia de curto-circuito: min_samples: 9999 garante que nenhuma
  // quantidade realista de linhas dispara a chamada ao DeepSeek. O worker
  // retorna emptyReport() e o runner persiste direto.
  const { data: inserted, error: insErr } = await supabase
    .from("task_queue")
    .insert({
      project_id: PROJECT_ID,
      agent: "a8",
      status: "pending",
      payload: {
        project_id: PROJECT_ID,
        window_days: 14,
        min_samples: 9999,
        focus: "all",
        scoped_to_project: false,
      },
    })
    .select("id")
    .single();
  if (insErr || !inserted) {
    console.error(`[smoke-a8] ❌ insert task: ${insErr?.message}`);
    process.exit(1);
  }
  const taskId = inserted.id;
  console.log(`[smoke-a8] 📥 task pending criada: ${taskId}`);

  // --- 5. Execução -----------------------------------------------------------
  console.log("[smoke-a8] ▶️  runWorkerA8Tick({maxTasks:1}) ...");
  const tick = await runWorkerA8Tick({ maxTasks: 1 });
  console.log(
    `[smoke-a8] tick: processed=${tick.processed} ok=${tick.succeeded} failed=${tick.failed} skipped=${tick.skipped}`,
  );
  console.log(
    `[smoke-a8] tick.results: ${JSON.stringify(tick.results, null, 2)}`,
  );

  if (tick.succeeded !== 1) {
    console.error("[smoke-a8] ❌ tick não teve 1 sucesso");
    process.exit(2);
  }

  // --- 6. Auditoria pós-execução ---------------------------------------------
  const { data: row, error: rowErr } = await supabase
    .from("task_queue")
    .select("status, result, error")
    .eq("id", taskId)
    .single();
  if (rowErr || !row) {
    console.error(`[smoke-a8] ❌ leitura row: ${rowErr?.message}`);
    process.exit(2);
  }
  if (row.status !== "done") {
    console.error(
      `[smoke-a8] ❌ status esperado 'done', recebido '${row.status}' (error=${row.error})`,
    );
    process.exit(2);
  }

  const parsed = analyticsReportSchema.safeParse(row.result);
  if (!parsed.success) {
    console.error("[smoke-a8] ❌ result no DB não bate com analyticsReportSchema:");
    for (const issue of parsed.error.issues) {
      console.error(`   - ${issue.path.join(".")}: ${issue.message}`);
    }
    process.exit(3);
  }
  const report = parsed.data;

  // 6a. project_id bate
  if (report.project_id !== PROJECT_ID) {
    console.error(
      `[smoke-a8] ❌ project_id=${report.project_id} ≠ ${PROJECT_ID}`,
    );
    process.exit(3);
  }
  // 6b. janela ecoada
  if (report.window_days !== 14) {
    console.error(`[smoke-a8] ❌ window_days=${report.window_days} ≠ 14`);
    process.exit(3);
  }
  // 6c. curto-circuito → insights vazios
  if (report.insights.length !== 0) {
    console.error(
      `[smoke-a8] ❌ insights não vazios no curto-circuito: ${report.insights.length}`,
    );
    process.exit(3);
  }
  // 6d. sample_count coerente (>=0)
  if (report.sample_count < 0) {
    console.error(`[smoke-a8] ❌ sample_count negativo: ${report.sample_count}`);
    process.exit(3);
  }
  // 6e. generated_at parseável
  if (Number.isNaN(Date.parse(report.generated_at))) {
    console.error(
      `[smoke-a8] ❌ generated_at não é ISO válido: ${report.generated_at}`,
    );
    process.exit(3);
  }

  console.log("\n[smoke-a8] 📊 relatório:");
  console.log(`   project_id:     ${report.project_id}`);
  console.log(`   generated_at:   ${report.generated_at}`);
  console.log(`   window_days:    ${report.window_days}`);
  console.log(`   sample_count:   ${report.sample_count}`);
  console.log(`   insights:       ${report.insights.length}`);
  console.log(`   fatigue_alerts: ${report.fatigue_alerts.length}`);

  // --- 7. Verificação da Regra de Ouro ---------------------------------------
  const { count: matrixCountAfter, error: cAfterErr } = await supabase
    .from("creative_matrix")
    .select("*", { count: "exact", head: true });
  if (cAfterErr || matrixCountAfter === null) {
    console.error(
      `[smoke-a8] ❌ snapshot creative_matrix depois: ${cAfterErr?.message}`,
    );
    process.exit(1);
  }
  console.log(
    `\n[smoke-a8] 📸 creative_matrix global DEPOIS: ${matrixCountAfter} rows`,
  );
  if (matrixCountAfter !== matrixCountBefore) {
    console.error(
      `[smoke-a8] 🚨 REGRA DE OURO VIOLADA: creative_matrix mudou de ${matrixCountBefore} para ${matrixCountAfter}`,
    );
    process.exit(4);
  }
  console.log("[smoke-a8] ✅ Regra de Ouro intacta — creative_matrix inalterada");

  // --- 8. Cleanup final ------------------------------------------------------
  const { error: finalDelErr } = await supabase
    .from("task_queue")
    .delete()
    .eq("id", taskId);
  if (finalDelErr) {
    console.error(
      `[smoke-a8] ❌ cleanup final task_queue: ${finalDelErr.message}`,
    );
    process.exit(5);
  }

  const totalMs = Date.now() - t0;
  console.log(
    `\n[smoke-a8] ✅ smoke a8 runtime PASSOU em ${totalMs}ms · sample_count=${report.sample_count}`,
  );
}

main().catch((err) => {
  console.error("[smoke-a8] ❌ falha inesperada:", err);
  process.exit(1);
});

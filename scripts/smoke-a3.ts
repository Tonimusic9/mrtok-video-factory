/**
 * Smoke test do Worker a3 — Scriptwriter (Tarefa 6, Passo 4).
 *
 * Valida end-to-end contra Supabase + OpenRouter REAIS:
 *   1. Insere uma row pending em task_queue (agent='a3').
 *   2. Executa runWorkerA3Tick({maxTasks:1}).
 *   3. Audita: task virou 'done', result bate com scriptOutputSchema.
 *   4. REGRA DE OURO: confirma que NENHUMA linha foi inserida em
 *      creative_matrix (snapshot global antes/depois + filtro por project_id).
 *
 * Uso: `npx tsx scripts/smoke-a3.ts`
 *
 * Exit codes:
 *   0 = ok
 *   1 = env ausente / setup
 *   2 = tick não processou com sucesso
 *   3 = result no DB não bate com scriptOutputSchema
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

const PROJECT_ID = "mrtok-smoke-a3";

async function main() {
  const t0 = Date.now();

  // --- 1. Setup --------------------------------------------------------------
  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    console.error("[smoke-a3] ❌ SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY ausentes em .env.local");
    process.exit(1);
  }
  if (!process.env.OPENROUTER_API_KEY) {
    console.error("[smoke-a3] ❌ OPENROUTER_API_KEY ausente em .env.local");
    process.exit(1);
  }
  if (!process.env.TELEGRAM_BOT_TOKEN || !process.env.TELEGRAM_CHAT_ID) {
    console.warn("[smoke-a3] ⚠️ TELEGRAM_* não configurado — notificação do tick será no-op");
  }

  const supabase = createClient(url, serviceKey, { auth: { persistSession: false } });

  // Imports dinâmicos pós-loadEnv para garantir que módulos que leem env
  // no top-level peguem os valores corretos.
  const { runWorkerA3Tick } = await import("../src/workers/worker-a3");
  const { scriptOutputSchema } = await import("../src/lib/agents/scriptwriter");

  // --- 2. Cleanup prévio idempotente -----------------------------------------
  const { data: tqDel, error: tqDelErr } = await supabase
    .from("task_queue")
    .delete()
    .eq("project_id", PROJECT_ID)
    .select("id");
  if (tqDelErr) {
    console.error(`[smoke-a3] ❌ cleanup task_queue: ${tqDelErr.message}`);
    process.exit(5);
  }
  const { data: cmDel, error: cmDelErr } = await supabase
    .from("creative_matrix")
    .delete()
    .eq("project_id", PROJECT_ID)
    .select("id");
  if (cmDelErr) {
    console.error(`[smoke-a3] ❌ cleanup creative_matrix: ${cmDelErr.message}`);
    process.exit(5);
  }
  console.log(
    `[smoke-a3] 🧹 cleanup prévio: task_queue=${tqDel?.length ?? 0} creative_matrix=${cmDel?.length ?? 0}`,
  );

  // --- 3. Snapshot ANTES (Regra de Ouro) ------------------------------------
  const { count: matrixCountBefore, error: cBeforeErr } = await supabase
    .from("creative_matrix")
    .select("*", { count: "exact", head: true });
  if (cBeforeErr || matrixCountBefore === null) {
    console.error(`[smoke-a3] ❌ snapshot creative_matrix antes: ${cBeforeErr?.message}`);
    process.exit(1);
  }
  console.log(`[smoke-a3] 📸 creative_matrix global ANTES: ${matrixCountBefore} rows`);

  // --- 4. Insert da fixture --------------------------------------------------
  const { data: inserted, error: insErr } = await supabase
    .from("task_queue")
    .insert({
      project_id: PROJECT_ID,
      agent: "a3",
      status: "pending",
      payload: {
        theme: "máscara facial de argila verde para pele oleosa",
        target_persona: "mulher 25-34, rotina apressada, pele mista oleosa",
        compliance_constraints: [
          "não mencionar ANVISA",
          "não prometer eliminação de acne",
        ],
      },
    })
    .select("id")
    .single();
  if (insErr || !inserted) {
    console.error(`[smoke-a3] ❌ insert fixture: ${insErr?.message}`);
    process.exit(1);
  }
  const insertedId = inserted.id;
  console.log(`[smoke-a3] 📥 task pending criada: ${insertedId}`);

  // --- 5. Execução -----------------------------------------------------------
  console.log("[smoke-a3] ▶️  runWorkerA3Tick({maxTasks:1}) ...");
  const tick = await runWorkerA3Tick({ maxTasks: 1 });
  console.log(
    `[smoke-a3] tick: processed=${tick.processed} ok=${tick.succeeded} failed=${tick.failed} skipped=${tick.skipped}`,
  );
  console.log(`[smoke-a3] tick.results: ${JSON.stringify(tick.results, null, 2)}`);

  if (tick.succeeded !== 1) {
    console.error("[smoke-a3] ❌ tick não teve 1 sucesso — abortando antes da auditoria");
    process.exit(2);
  }

  // --- 6. Auditoria pós-execução --------------------------------------------
  const { data: row, error: rowErr } = await supabase
    .from("task_queue")
    .select("status, result, error")
    .eq("id", insertedId)
    .single();
  if (rowErr || !row) {
    console.error(`[smoke-a3] ❌ leitura da row pós-tick: ${rowErr?.message}`);
    process.exit(2);
  }
  if (row.status !== "done") {
    console.error(
      `[smoke-a3] ❌ status esperado 'done', recebido '${row.status}' (error=${row.error})`,
    );
    process.exit(2);
  }

  const parsed = scriptOutputSchema.safeParse(row.result);
  if (!parsed.success) {
    console.error("[smoke-a3] ❌ result no DB não bate com scriptOutputSchema:");
    for (const issue of parsed.error.issues) {
      console.error(`   - ${issue.path.join(".")}: ${issue.message}`);
    }
    process.exit(3);
  }
  const script = parsed.data;
  console.log("\n[smoke-a3] 📜 roteiro gerado:");
  console.log(`   HOOK (${script.hook.duration_seconds}s): ${script.hook.voiceover}`);
  console.log(`     visual: ${script.hook.visual_disruptor}`);
  console.log(`     imperfeição: ${script.hook.human_imperfection_hint}`);
  console.log(`   BODY (${script.body.duration_seconds}s): ${script.body.voiceover}`);
  console.log(`     pontos: ${script.body.key_points.join(" | ")}`);
  console.log(`   CTA  (${script.cta.duration_seconds}s): ${script.cta.voiceover}`);
  console.log(`     verbo: ${script.cta.action_verb}\n`);

  // --- 7. Verificação da Regra de Ouro --------------------------------------
  const { count: matrixCountAfter, error: cAfterErr } = await supabase
    .from("creative_matrix")
    .select("*", { count: "exact", head: true });
  if (cAfterErr || matrixCountAfter === null) {
    console.error(`[smoke-a3] ❌ snapshot creative_matrix depois: ${cAfterErr?.message}`);
    process.exit(1);
  }
  console.log(`[smoke-a3] 📸 creative_matrix global DEPOIS: ${matrixCountAfter} rows`);

  if (matrixCountAfter !== matrixCountBefore) {
    console.error(
      `[smoke-a3] 🚨 REGRA DE OURO VIOLADA: creative_matrix mudou de ${matrixCountBefore} para ${matrixCountAfter}`,
    );
    process.exit(4);
  }

  const { data: cmLeak, error: cmLeakErr } = await supabase
    .from("creative_matrix")
    .select("id")
    .eq("project_id", PROJECT_ID);
  if (cmLeakErr) {
    console.error(`[smoke-a3] ❌ leitura creative_matrix por project_id: ${cmLeakErr.message}`);
    process.exit(1);
  }
  if (cmLeak && cmLeak.length > 0) {
    console.error(
      `[smoke-a3] 🚨 REGRA DE OURO VIOLADA: ${cmLeak.length} row(s) em creative_matrix com project_id='${PROJECT_ID}'`,
    );
    process.exit(4);
  }
  console.log("[smoke-a3] ✅ Regra de Ouro intacta — creative_matrix inalterada");

  // --- 8. Cleanup final ------------------------------------------------------
  const { error: finalDelErr } = await supabase
    .from("task_queue")
    .delete()
    .eq("id", insertedId);
  if (finalDelErr) {
    console.error(`[smoke-a3] ❌ cleanup final task_queue: ${finalDelErr.message}`);
    process.exit(5);
  }

  const totalMs = Date.now() - t0;
  const totalDuration =
    script.hook.duration_seconds + script.body.duration_seconds + script.cta.duration_seconds;
  console.log(
    `\n[smoke-a3] ✅ smoke a3 PASSOU em ${totalMs}ms · roteiro ${totalDuration}s · ${script.body.key_points.length} key_points`,
  );
}

main().catch((err) => {
  console.error("[smoke-a3] ❌ falha inesperada:", err);
  process.exit(1);
});

/**
 * Smoke test do Worker a4 — Diretor de Arte (Tarefa 8, Passo 3).
 *
 * Valida end-to-end contra Supabase + OpenRouter REAIS:
 *   1. Insere uma row pending em task_queue (agent='a4') com um script
 *      hardcoded como fixture (decisão A — sem encadear smoke a3).
 *   2. Executa runWorkerA4Tick({maxTasks:1}).
 *   3. Audita: task virou 'done', result bate com imagePromptOutputSchema,
 *      ordem dos shots é hook→body→cta.
 *   4. REGRA DE OURO: confirma que NENHUMA linha foi inserida em
 *      creative_matrix (snapshot global antes/depois + filtro por project_id).
 *
 * Uso: `npx tsx scripts/smoke-a4.ts`
 *
 * Exit codes:
 *   0 = ok
 *   1 = env ausente / setup
 *   2 = tick não processou com sucesso
 *   3 = result no DB não bate com imagePromptOutputSchema (ou ordem errada)
 *   4 = REGRA DE OURO violada (creative_matrix mudou)
 *   5 = falha no cleanup
 */
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import type { ScriptOutput } from "../src/lib/agents/scriptwriter";

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

const PROJECT_ID = "mrtok-smoke-a4";

// Roteiro fixture — espelha a saída real do smoke-a3 para o tema "máscara
// de argila verde". Hardcoded para tornar o smoke determinístico (custo de
// tokens só do a4, falha do a4 fica isolada e diagnosticável).
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

async function main() {
  const t0 = Date.now();

  // --- 1. Setup --------------------------------------------------------------
  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    console.error("[smoke-a4] ❌ SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY ausentes em .env.local");
    process.exit(1);
  }
  if (!process.env.OPENROUTER_API_KEY) {
    console.error("[smoke-a4] ❌ OPENROUTER_API_KEY ausente em .env.local");
    process.exit(1);
  }
  if (!process.env.TELEGRAM_BOT_TOKEN || !process.env.TELEGRAM_CHAT_ID) {
    console.warn("[smoke-a4] ⚠️ TELEGRAM_* não configurado — notificação do tick será no-op");
  }

  const supabase = createClient(url, serviceKey, { auth: { persistSession: false } });

  // Imports dinâmicos pós-loadEnv para garantir que módulos que leem env
  // no top-level peguem os valores corretos.
  const { runWorkerA4Tick } = await import("../src/workers/worker-a4");
  const { imagePromptOutputSchema } = await import("../src/lib/agents/imagePrompt");

  // --- 2. Cleanup prévio idempotente -----------------------------------------
  const { data: tqDel, error: tqDelErr } = await supabase
    .from("task_queue")
    .delete()
    .eq("project_id", PROJECT_ID)
    .select("id");
  if (tqDelErr) {
    console.error(`[smoke-a4] ❌ cleanup task_queue: ${tqDelErr.message}`);
    process.exit(5);
  }
  const { data: cmDel, error: cmDelErr } = await supabase
    .from("creative_matrix")
    .delete()
    .eq("project_id", PROJECT_ID)
    .select("id");
  if (cmDelErr) {
    console.error(`[smoke-a4] ❌ cleanup creative_matrix: ${cmDelErr.message}`);
    process.exit(5);
  }
  console.log(
    `[smoke-a4] 🧹 cleanup prévio: task_queue=${tqDel?.length ?? 0} creative_matrix=${cmDel?.length ?? 0}`,
  );

  // --- 3. Snapshot ANTES (Regra de Ouro) ------------------------------------
  const { count: matrixCountBefore, error: cBeforeErr } = await supabase
    .from("creative_matrix")
    .select("*", { count: "exact", head: true });
  if (cBeforeErr || matrixCountBefore === null) {
    console.error(`[smoke-a4] ❌ snapshot creative_matrix antes: ${cBeforeErr?.message}`);
    process.exit(1);
  }
  console.log(`[smoke-a4] 📸 creative_matrix global ANTES: ${matrixCountBefore} rows`);

  // --- 4. Insert da fixture --------------------------------------------------
  const { data: inserted, error: insErr } = await supabase
    .from("task_queue")
    .insert({
      project_id: PROJECT_ID,
      agent: "a4",
      status: "pending",
      payload: {
        script: FIXTURE_SCRIPT,
        product_theme: "máscara facial de argila verde para pele oleosa",
        target_persona: "mulher 25-34, rotina apressada, pele mista oleosa",
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
    console.error(`[smoke-a4] ❌ insert fixture: ${insErr?.message}`);
    process.exit(1);
  }
  const insertedId = inserted.id;
  console.log(`[smoke-a4] 📥 task pending criada: ${insertedId}`);

  // --- 5. Execução -----------------------------------------------------------
  console.log("[smoke-a4] ▶️  runWorkerA4Tick({maxTasks:1}) ...");
  const tick = await runWorkerA4Tick({ maxTasks: 1 });
  console.log(
    `[smoke-a4] tick: processed=${tick.processed} ok=${tick.succeeded} failed=${tick.failed} skipped=${tick.skipped}`,
  );
  console.log(`[smoke-a4] tick.results: ${JSON.stringify(tick.results, null, 2)}`);

  if (tick.succeeded !== 1) {
    console.error("[smoke-a4] ❌ tick não teve 1 sucesso — abortando antes da auditoria");
    process.exit(2);
  }

  // --- 6. Auditoria pós-execução --------------------------------------------
  const { data: row, error: rowErr } = await supabase
    .from("task_queue")
    .select("status, result, error")
    .eq("id", insertedId)
    .single();
  if (rowErr || !row) {
    console.error(`[smoke-a4] ❌ leitura da row pós-tick: ${rowErr?.message}`);
    process.exit(2);
  }
  if (row.status !== "done") {
    console.error(
      `[smoke-a4] ❌ status esperado 'done', recebido '${row.status}' (error=${row.error})`,
    );
    process.exit(2);
  }

  const parsed = imagePromptOutputSchema.safeParse(row.result);
  if (!parsed.success) {
    console.error("[smoke-a4] ❌ result no DB não bate com imagePromptOutputSchema:");
    for (const issue of parsed.error.issues) {
      console.error(`   - ${issue.path.join(".")}: ${issue.message}`);
    }
    process.exit(3);
  }
  const storyboard = parsed.data;

  // Validação semântica defensiva (já está no schema, mas reforçamos aqui).
  const order = storyboard.shots.map((s) => s.block).join(",");
  if (order !== "hook,body,cta") {
    console.error(`[smoke-a4] ❌ ordem dos shots inválida: ${order}`);
    process.exit(3);
  }

  console.log("\n[smoke-a4] 🎬 storyboard gerado:");
  console.log(`   global_style.aesthetic: ${storyboard.global_style.aesthetic}`);
  console.log(`   global_style.aspect_ratio: ${storyboard.global_style.aspect_ratio}`);
  console.log(`   global_style.color_palette: ${storyboard.global_style.color_palette}`);
  console.log(
    `   global_style.forbidden: ${storyboard.global_style.forbidden_elements.join(" | ")}`,
  );
  for (const shot of storyboard.shots) {
    console.log(`\n   [${shot.block.toUpperCase()}] ${shot.duration_seconds}s`);
    console.log(`     subject: ${shot.subject}`);
    console.log(`     action:  ${shot.action}`);
    console.log(`     setting: ${shot.setting}`);
    console.log(`     camera:  ${shot.camera}`);
    console.log(`     light:   ${shot.lighting}`);
    console.log(`     mood:    ${shot.mood}`);
    console.log(`     neg:     ${shot.negative_prompt}`);
  }
  console.log("");

  // --- 7. Verificação da Regra de Ouro --------------------------------------
  const { count: matrixCountAfter, error: cAfterErr } = await supabase
    .from("creative_matrix")
    .select("*", { count: "exact", head: true });
  if (cAfterErr || matrixCountAfter === null) {
    console.error(`[smoke-a4] ❌ snapshot creative_matrix depois: ${cAfterErr?.message}`);
    process.exit(1);
  }
  console.log(`[smoke-a4] 📸 creative_matrix global DEPOIS: ${matrixCountAfter} rows`);

  if (matrixCountAfter !== matrixCountBefore) {
    console.error(
      `[smoke-a4] 🚨 REGRA DE OURO VIOLADA: creative_matrix mudou de ${matrixCountBefore} para ${matrixCountAfter}`,
    );
    process.exit(4);
  }

  const { data: cmLeak, error: cmLeakErr } = await supabase
    .from("creative_matrix")
    .select("id")
    .eq("project_id", PROJECT_ID);
  if (cmLeakErr) {
    console.error(`[smoke-a4] ❌ leitura creative_matrix por project_id: ${cmLeakErr.message}`);
    process.exit(1);
  }
  if (cmLeak && cmLeak.length > 0) {
    console.error(
      `[smoke-a4] 🚨 REGRA DE OURO VIOLADA: ${cmLeak.length} row(s) em creative_matrix com project_id='${PROJECT_ID}'`,
    );
    process.exit(4);
  }
  console.log("[smoke-a4] ✅ Regra de Ouro intacta — creative_matrix inalterada");

  // --- 8. Cleanup final ------------------------------------------------------
  const { error: finalDelErr } = await supabase
    .from("task_queue")
    .delete()
    .eq("id", insertedId);
  if (finalDelErr) {
    console.error(`[smoke-a4] ❌ cleanup final task_queue: ${finalDelErr.message}`);
    process.exit(5);
  }

  const totalMs = Date.now() - t0;
  console.log(
    `\n[smoke-a4] ✅ smoke a4 PASSOU em ${totalMs}ms · ${storyboard.shots.length} shots · aspect ${storyboard.global_style.aspect_ratio}`,
  );
}

main().catch((err) => {
  console.error("[smoke-a4] ❌ falha inesperada:", err);
  process.exit(1);
});

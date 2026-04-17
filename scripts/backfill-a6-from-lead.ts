/**
 * Backfill a6 — converte um lead real em task a6 pending (dry_run=true).
 *
 * Fluxo:
 *   1. Lê o lead alvo (default 6705d973; override via LEAD_ID).
 *   2. Aplica `leadToProductionSpec` (pure-function, zero LLM/FAL).
 *   3. Cleanup idempotente por project_id + INSERT task a6 pending com
 *      payload { production_spec, dry_run: true, delivery_context }.
 *
 * Opcional: `A6_DRAIN=1` drena 1 tick (`runWorkerA6Tick({ maxTasks: 1 })`)
 * e audita manifest, ordering, pixel_hash, chainagem a7 e Regra de Ouro
 * (creative_matrix inalterada). Zero-custo FAL (dry_run=true).
 *
 * Uso:
 *   npx tsx scripts/backfill-a6-from-lead.ts
 *   A6_DRAIN=1 npx tsx scripts/backfill-a6-from-lead.ts
 *   LEAD_ID=<uuid> A6_DRAIN=1 npx tsx scripts/backfill-a6-from-lead.ts
 *
 * Exit codes:
 *   0 = ok
 *   1 = env / setup
 *   2 = lead/state inválido ou tick não processou
 *   3 = auditoria do result falhou
 *   4 = Regra de Ouro violada
 *   5 = cleanup
 */
import { config } from "dotenv";
config({ path: ".env.local" });
import { createClient } from "@supabase/supabase-js";
import { creativeDirectionSchema } from "../src/workers/worker-a3";
import { leadToProductionSpec } from "../src/lib/agents/leadToProductionSpec";

const DEFAULT_LEAD_ID = "6705d973-90b6-4511-bc46-d5455c4aedff";
const PROJECT_ID = "backfill-a6-from-lead";

async function main() {
  const leadId = process.env.LEAD_ID?.trim() || DEFAULT_LEAD_ID;
  const drain = process.env.A6_DRAIN === "1";

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("[backfill-a6] ❌ SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY ausentes em .env.local");
    process.exit(1);
  }
  if (drain && !process.env.OPENROUTER_API_KEY) {
    console.error("[backfill-a6] ❌ OPENROUTER_API_KEY ausente (necessário para tick GLM 5.1)");
    process.exit(1);
  }
  const supabase = createClient(url, key, { auth: { persistSession: false } });

  console.log(`[backfill-a6] lead=${leadId} drain=${drain}`);

  // 1. Carrega lead + creative_direction
  const { data: lead, error: leadErr } = await supabase
    .from("product_leads")
    .select("id, title, metadata, status")
    .eq("id", leadId)
    .maybeSingle();
  if (leadErr || !lead) {
    console.error(`[backfill-a6] ❌ lead não encontrado: ${leadErr?.message ?? "sem retorno"}`);
    process.exit(2);
  }
  const meta = (lead.metadata ?? {}) as Record<string, unknown>;
  if (!meta.creative_direction) {
    console.error(`[backfill-a6] ❌ lead ${leadId} sem creative_direction — rode o A3 antes.`);
    process.exit(2);
  }
  const cd = creativeDirectionSchema.parse(meta.creative_direction);

  // 2. Adapter + validação schema
  const spec = leadToProductionSpec({ lead_id: leadId, creative_direction: cd });
  const summary = spec.shots
    .map((s) => `${s.block}:${s.video_generation.provider}/${s.video_generation.duration_seconds}s`)
    .join(" ");
  console.log(`[backfill-a6] ✅ spec ok — ${summary} default=${spec.global.default_video_provider}`);

  // 3. Cleanup idempotente por project_id (limpa resíduo de a7 filho também)
  const { data: cleaned, error: cleanErr } = await supabase
    .from("task_queue")
    .delete()
    .eq("project_id", PROJECT_ID)
    .select("id");
  if (cleanErr) {
    console.error(`[backfill-a6] ❌ cleanup: ${cleanErr.message}`);
    process.exit(5);
  }
  if ((cleaned ?? []).length) {
    console.log(`[backfill-a6] 🧹 cleanup prévio removeu ${cleaned!.length} task(s)`);
  }

  // 4. Snapshot Regra de Ouro (só se for drenar)
  let matrixBefore: number | null = null;
  if (drain) {
    const { count, error } = await supabase
      .from("creative_matrix")
      .select("*", { count: "exact", head: true });
    if (error || count === null) {
      console.error(`[backfill-a6] ❌ snapshot creative_matrix: ${error?.message}`);
      process.exit(1);
    }
    matrixBefore = count;
    console.log(`[backfill-a6] 📸 creative_matrix ANTES: ${matrixBefore} rows`);
  }

  // 5. INSERT task a6 pending
  const deliveryContext = {
    account_id: "backfill_a6",
    account_handle: "@backfill_a6",
    product_name: lead.title as string,
  };
  const { data: task, error: insErr } = await supabase
    .from("task_queue")
    .insert({
      project_id: PROJECT_ID,
      agent: "a6",
      status: "pending",
      payload: {
        production_spec: spec,
        dry_run: true,
        delivery_context: deliveryContext,
      },
    })
    .select("id")
    .single();
  if (insErr || !task) {
    console.error(`[backfill-a6] ❌ insert: ${insErr?.message}`);
    process.exit(3);
  }
  console.log(`[backfill-a6] ✅ task a6 pending criada: ${task.id}`);

  if (!drain) {
    console.log("[backfill-a6] done (use A6_DRAIN=1 para drenar o tick).");
    return;
  }

  // 6. Drain tick + auditoria
  console.log("[backfill-a6] ▶️  runWorkerA6Tick({ maxTasks: 1 }) ...");
  const { runWorkerA6Tick } = await import("../src/workers/worker-a6");
  const { montadorResultSchema } = await import("../src/lib/agents/renderManifest");
  const tick = await runWorkerA6Tick({ maxTasks: 1 });
  console.log(
    `[backfill-a6] tick: processed=${tick.processed} ok=${tick.succeeded} failed=${tick.failed} skipped=${tick.skipped}`,
  );
  if (tick.succeeded !== 1) {
    console.error(`[backfill-a6] ❌ tick sem sucesso: ${JSON.stringify(tick.results)}`);
    process.exit(2);
  }

  const { data: row, error: rowErr } = await supabase
    .from("task_queue")
    .select("status, result, error")
    .eq("id", task.id)
    .single();
  if (rowErr || !row || row.status !== "done") {
    console.error(`[backfill-a6] ❌ task não done: status=${row?.status} error=${row?.error}`);
    process.exit(2);
  }
  const parsed = montadorResultSchema.safeParse(row.result);
  if (!parsed.success) {
    console.error("[backfill-a6] ❌ result inválido:");
    parsed.error.issues.forEach((i) =>
      console.error(`   - ${i.path.join(".")}: ${i.message}`),
    );
    process.exit(3);
  }
  const result = parsed.data;
  if (!result.dry_run) {
    console.error("[backfill-a6] ❌ esperado dry_run=true");
    process.exit(3);
  }
  const m = result.render_manifest;
  const order = m.clips.map((c) => c.block).join(",");
  if (order !== "hook,body,cta") {
    console.error(`[backfill-a6] ❌ ordem clips=${order}`);
    process.exit(3);
  }
  if (m.pixel_hash.scale < 1.005 || m.pixel_hash.scale > 1.015) {
    console.error(`[backfill-a6] ❌ pixel_hash.scale=${m.pixel_hash.scale}`);
    process.exit(3);
  }
  if (m.pixel_hash.rotation_deg < -0.15 || m.pixel_hash.rotation_deg > 0.15) {
    console.error(`[backfill-a6] ❌ pixel_hash.rotation_deg=${m.pixel_hash.rotation_deg}`);
    process.exit(3);
  }
  console.log(
    `[backfill-a6] 🎬 manifest: ${m.fps}fps ${m.width}x${m.height} total=${m.total_duration_frames}f pixel_hash=${JSON.stringify(m.pixel_hash)}`,
  );
  for (const c of m.clips) {
    console.log(
      `   [${c.block}] frames=${c.duration_frames} start=${c.start_frame} transition=${c.transition_in}`,
    );
  }

  // 7. Chaining a7
  const { data: children, error: chErr } = await supabase
    .from("task_queue")
    .select("id, agent, status")
    .eq("parent_task_id", task.id);
  if (chErr) {
    console.error(`[backfill-a6] ❌ leitura filhas: ${chErr.message}`);
    process.exit(3);
  }
  if (
    !children ||
    children.length !== 1 ||
    children[0].agent !== "a7" ||
    children[0].status !== "pending"
  ) {
    console.error(`[backfill-a6] ❌ chaining inválido: ${JSON.stringify(children)}`);
    process.exit(3);
  }
  console.log(`[backfill-a6] 🔗 chaining a7 ok — filha pending ${children[0].id}`);

  // 8. Regra de Ouro
  const { count: matrixAfter, error: afterErr } = await supabase
    .from("creative_matrix")
    .select("*", { count: "exact", head: true });
  if (afterErr || matrixAfter === null) {
    console.error(`[backfill-a6] ❌ snapshot creative_matrix DEPOIS: ${afterErr?.message}`);
    process.exit(1);
  }
  if (matrixAfter !== matrixBefore) {
    console.error(
      `[backfill-a6] 🚨 REGRA DE OURO VIOLADA: creative_matrix ${matrixBefore}→${matrixAfter}`,
    );
    process.exit(4);
  }
  console.log(`[backfill-a6] ✅ Regra de Ouro intacta (creative_matrix ${matrixBefore}→${matrixAfter})`);

  console.log(
    `\n[backfill-a6] ✅ SMOKE REAL DRY_RUN PASSOU — task=${task.id} child_a7=${children[0].id}`,
  );
}

main().catch((err) => {
  console.error("[backfill-a6] fatal:", err);
  process.exit(1);
});

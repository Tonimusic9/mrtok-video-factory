/**
 * diag-a7-zero-fal — INSERT task a7 pending apontando para um MP4 local já
 * renderizado (zero-FAL) e drena 1 tick de `runWorkerA7Tick`.
 *
 * Uso:
 *   MP4_PATH=output/publish_ready/mrtok_diag-<ts>.mp4 npx tsx scripts/diag-a7-zero-fal.ts
 */
import { config } from "dotenv";
config({ path: ".env.local" });
import { resolve } from "node:path";
import { existsSync, statSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const PROJECT_ID = "diag-a7-zero-fal";

async function main() {
  const mp4Rel = process.env.MP4_PATH;
  if (!mp4Rel) {
    console.error("[diag-a7] ❌ MP4_PATH ausente");
    process.exit(1);
  }
  const mp4Abs = resolve(process.cwd(), mp4Rel);
  if (!existsSync(mp4Abs)) {
    console.error(`[diag-a7] ❌ mp4 inexistente: ${mp4Abs}`);
    process.exit(1);
  }
  const size = statSync(mp4Abs).size;
  console.log(`[diag-a7] mp4=${mp4Abs} size=${size}B`);

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("[diag-a7] ❌ SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY ausentes");
    process.exit(1);
  }
  const supabase = createClient(url, key, { auth: { persistSession: false } });

  // cleanup idempotente
  const { data: cleaned } = await supabase
    .from("task_queue")
    .delete()
    .eq("project_id", PROJECT_ID)
    .select("id");
  if ((cleaned ?? []).length) {
    console.log(`[diag-a7] 🧹 cleanup removeu ${cleaned!.length} task(s)`);
  }

  const payload = {
    project_id: PROJECT_ID,
    output_video_url: `file://${mp4Abs}`,
    account_id: "diag01",
    account_handle: "@diag_zero_fal",
    product_name: "Diag VPS zero-FAL",
    caption: "🧪 Diag VPS+a7 — zero-FAL, pipeline end-to-end validado.",
  };

  const { data: task, error: insErr } = await supabase
    .from("task_queue")
    .insert({
      project_id: PROJECT_ID,
      agent: "a7",
      status: "pending",
      payload,
    })
    .select("id")
    .single();
  if (insErr || !task) {
    console.error(`[diag-a7] ❌ insert: ${insErr?.message}`);
    process.exit(1);
  }
  console.log(`[diag-a7] ✅ task a7 pending: ${task.id}`);

  console.log("[diag-a7] ▶️  runWorkerA7Tick({ maxTasks: 1 }) ...");
  const { runWorkerA7Tick } = await import("../src/workers/worker-a7");
  const tick = await runWorkerA7Tick({ maxTasks: 1 });
  console.log(
    `[diag-a7] tick: processed=${tick.processed} ok=${tick.succeeded} failed=${tick.failed} skipped=${tick.skipped}`,
  );
  console.log(`[diag-a7] tick.results=${JSON.stringify(tick.results, null, 2)}`);

  const { data: row } = await supabase
    .from("task_queue")
    .select("status, result, error")
    .eq("id", task.id)
    .single();
  console.log(`[diag-a7] status=${row?.status}`);
  if (row?.status === "done") {
    console.log(`[diag-a7] result=${JSON.stringify(row.result, null, 2)}`);
  } else {
    console.error(`[diag-a7] ❌ error=${row?.error}`);
    process.exit(2);
  }
}

main().catch((err) => {
  console.error("[diag-a7] fatal:", err);
  process.exit(1);
});

/**
 * Cleanup das fixtures do teste E2E (Tarefa 5).
 * Remove task_queue e creative_matrix com project_id='mrtok-e2e-test'.
 *
 * Uso: `npx tsx scripts/cleanup-e2e.ts`
 */
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

function loadEnv(): Record<string, string> {
  const out: Record<string, string> = {};
  const raw = readFileSync(".env.local", "utf-8");
  for (const line of raw.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq === -1) continue;
    out[t.slice(0, eq).trim()] = t.slice(eq + 1).trim();
  }
  return out;
}

async function main() {
  const env = loadEnv();
  const supabase = createClient(
    env.SUPABASE_URL!,
    env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );
  const PROJECT = "mrtok-e2e-test";

  const { data: tasksDeleted, error: tErr } = await supabase
    .from("task_queue")
    .delete()
    .eq("project_id", PROJECT)
    .select("id");
  if (tErr) throw new Error(`task_queue delete: ${tErr.message}`);
  console.log(`🧹 task_queue: ${tasksDeleted?.length ?? 0} rows removidas`);

  const { data: matrixDeleted, error: mErr } = await supabase
    .from("creative_matrix")
    .delete()
    .eq("project_id", PROJECT)
    .select("id");
  if (mErr) throw new Error(`creative_matrix delete: ${mErr.message}`);
  console.log(
    `🧹 creative_matrix: ${matrixDeleted?.length ?? 0} rows removidas`,
  );

  console.log("✅ cleanup concluído.");
}

main().catch((e) => {
  console.error("❌", e);
  process.exit(1);
});

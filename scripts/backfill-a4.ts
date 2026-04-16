/**
 * Backfill — Injeta tasks a4 (Seedance 2.0 i2v) para leads com
 * status='images_generated'. Uso: npx tsx scripts/backfill-a4.ts
 */
import { config } from "dotenv";
config({ path: ".env.local" });
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

async function main() {
  console.log("=== Backfill a4: tasks para leads images_generated ===\n");

  const { data: leads, error: leadsErr } = await supabase
    .from("product_leads")
    .select("id, title, status")
    .eq("status", "images_generated");

  if (leadsErr) {
    console.error("Erro ao buscar leads:", leadsErr.message);
    process.exit(1);
  }

  if (!leads || leads.length === 0) {
    console.log("Nenhum lead images_generated encontrado. Rode o A3 antes.");
    return;
  }

  console.log(`Encontrados ${leads.length} leads images_generated:\n`);
  for (const l of leads) console.log(`  - ${l.id} | ${l.title}`);

  console.log("\nInserindo tasks na task_queue...\n");
  let inserted = 0;

  for (const lead of leads) {
    const { data: task, error: taskErr } = await supabase
      .from("task_queue")
      .insert({
        project_id: "backfill-a4",
        agent: "a4",
        status: "pending",
        payload: { lead_id: lead.id },
      })
      .select("id")
      .single();

    if (taskErr || !task) {
      console.error(`  ERRO lead ${lead.id}: ${taskErr?.message}`);
    } else {
      console.log(`  OK lead ${lead.id} → task ${task.id}`);
      inserted++;
    }
  }

  console.log(
    `\n=== Backfill concluído: ${inserted}/${leads.length} tasks injetadas ===`,
  );
}

main().catch((err) => {
  console.error("Erro fatal:", err);
  process.exit(1);
});

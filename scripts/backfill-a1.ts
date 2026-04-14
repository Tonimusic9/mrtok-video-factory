/**
 * Backfill — Injeta tasks a1 para leads órfãos (status: pending).
 * Uso: npx tsx scripts/backfill-a1.ts
 */
import { config } from "dotenv";
config({ path: ".env.local" });
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

async function main() {
  console.log("=== Backfill a1: Injetando tasks para leads órfãos ===\n");

  // 1. Buscar leads pending
  const { data: leads, error: leadsErr } = await supabase
    .from("product_leads")
    .select("id, title, status")
    .eq("status", "pending");

  if (leadsErr) {
    console.error("Erro ao buscar leads:", leadsErr.message);
    process.exit(1);
  }

  if (!leads || leads.length === 0) {
    console.log("Nenhum lead pending encontrado. Nada a fazer.");
    return;
  }

  console.log(`Encontrados ${leads.length} leads pending:\n`);
  for (const l of leads) {
    console.log(`  - ${l.id} | ${l.title}`);
  }

  // 2. Inserir tasks a1
  console.log("\nInserindo tasks na task_queue...\n");
  let inserted = 0;

  for (const lead of leads) {
    const { data: task, error: taskErr } = await supabase
      .from("task_queue")
      .insert({
        project_id: "backfill-a1",
        agent: "a1",
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

  console.log(`\n=== Backfill concluído: ${inserted}/${leads.length} tasks injetadas ===`);
}

main().catch((err) => {
  console.error("Erro fatal:", err);
  process.exit(1);
});

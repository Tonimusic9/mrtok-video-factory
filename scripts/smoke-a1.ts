/**
 * Smoke test — Worker a1 (Extrator Multimodal).
 * Processa leads pending via Gemini e gera a Structural Matrix.
 * Uso: npx tsx scripts/smoke-a1.ts
 */
import { config } from "dotenv";
config({ path: ".env.local" });
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

async function main() {
  console.log("=== Smoke a1: Extração de Structural Matrix ===\n");

  // 1. Verificar se existe task a1 pending
  const { data: tasks, error: taskErr } = await supabase
    .from("task_queue")
    .select("id, payload")
    .eq("agent", "a1")
    .eq("status", "pending")
    .order("created_at", { ascending: true })
    .limit(1);

  if (taskErr) {
    console.error("Erro ao buscar tasks:", taskErr.message);
    process.exit(1);
  }

  if (!tasks || tasks.length === 0) {
    console.log("Nenhuma task a1 pending. Rode backfill-a1.ts primeiro.");
    process.exit(0);
  }

  console.log(`1. Task a1 encontrada: ${tasks[0].id}`);
  console.log(`   Payload: ${JSON.stringify(tasks[0].payload)}\n`);

  // 2. Rodar o worker
  console.log("2. Executando runWorkerA1Tick...\n");
  const { runWorkerA1Tick } = await import("../src/workers/worker-a1");
  const result = await runWorkerA1Tick({ maxTasks: 1 });

  console.log("3. Resultado do tick:");
  console.log(JSON.stringify(result, null, 2));

  // 4. Verificar status do lead
  const leadId = (tasks[0].payload as any)?.lead_id;
  if (leadId) {
    console.log("\n4. Verificando product_leads...");
    const { data: lead, error: leadErr } = await supabase
      .from("product_leads")
      .select("id, title, status, metadata")
      .eq("id", leadId)
      .single();

    if (leadErr) {
      console.error("Erro ao ler lead:", leadErr.message);
    } else if (lead) {
      console.log(`   Status: ${lead.status}`);
      const meta = lead.metadata as any;
      if (meta?.structural_matrix) {
        console.log(`   Matrix steps: ${meta.structural_matrix.structural_matrix?.length ?? "?"}`);
        console.log(`   Hook style: ${meta.structural_matrix.viral_reference_analysis?.hook_style_detected ?? "?"}`);
        console.log(`   Pacing: ${meta.structural_matrix.viral_reference_analysis?.global_pacing ?? "?"}`);
      }
    }
  }

  console.log("\n=== Smoke a1 concluído ===");
}

main().catch((err) => {
  console.error("Erro fatal:", err);
  process.exit(1);
});

/**
 * Smoke test — Worker a0 (Curador de Winners).
 * Minera 3 produtos reais do nicho "Gadgets virais para iPhone".
 * Uso: npx tsx scripts/smoke-a0.ts
 */
import { config } from "dotenv";
config({ path: ".env.local" });
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const PRODUCT_URLS = [
  "https://www.amazon.com.br/dp/B0D7FKLKQ8",  // MagSafe car mount / suporte magnético
  "https://www.amazon.com.br/dp/B0DFHP4MJN",  // Carregador portátil MagSafe
  "https://www.amazon.com.br/dp/B0CX23V2ZK",  // Gimbal / estabilizador para iPhone
];

async function main() {
  console.log("=== Smoke a0: Mineração de 3 gadgets iPhone ===\n");

  // 1. Inserir task na fila
  const payload = {
    category: "Gadgets virais para iPhone 17 Pro Max",
    search_terms: ["magsafe", "gimbal iphone", "carregador portátil"],
    source_urls: PRODUCT_URLS,
  };

  console.log("1. Inserindo task na task_queue...");
  const { data: task, error: taskErr } = await supabase
    .from("task_queue")
    .insert({
      project_id: "smoke-a0-test",
      agent: "a0",
      status: "pending",
      payload,
    })
    .select("id")
    .single();

  if (taskErr || !task) {
    console.error("Falha ao inserir task:", taskErr?.message);
    process.exit(1);
  }
  console.log(`   Task criada: ${task.id}\n`);

  // 2. Rodar o worker
  console.log("2. Executando runWorkerA0Tick...");
  const { runWorkerA0Tick } = await import("../src/workers/worker-a0");
  const result = await runWorkerA0Tick({ maxTasks: 1 });

  console.log("\n3. Resultado do tick:");
  console.log(JSON.stringify(result, null, 2));

  // 3. Verificar leads na tabela
  console.log("\n4. Verificando product_leads...");
  const { data: leads, error: leadsErr } = await supabase
    .from("product_leads")
    .select("id, title, viral_score, status")
    .order("created_at", { ascending: false })
    .limit(5);

  if (leadsErr) {
    console.error("Erro ao ler leads:", leadsErr.message);
  } else {
    console.log(`   ${leads?.length ?? 0} leads encontrados:`);
    for (const l of leads ?? []) {
      console.log(`   - [${l.viral_score}/100] ${l.title} (${l.status})`);
    }
  }

  console.log("\n=== Smoke a0 concluído ===");
}

main().catch((err) => {
  console.error("Erro fatal:", err);
  process.exit(1);
});

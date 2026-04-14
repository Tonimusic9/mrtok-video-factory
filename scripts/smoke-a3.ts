/**
 * Smoke test — Worker a3 (Nano Banana 2 / Image Generation).
 *
 * Valida end-to-end contra FAL.ai + Supabase Storage REAIS:
 *   1. Pega uma task a3 pending (injetada via chaining a2→a3 ou backfill).
 *   2. Executa runWorkerA3Tick({maxTasks:1}).
 *   3. Imprime URLs públicas das imagens geradas e confirma status
 *      do lead = 'images_generated'.
 *   4. REGRA DE OURO: confirma creative_matrix inalterada.
 *
 * Uso: npx tsx scripts/smoke-a3.ts
 */
import { config } from "dotenv";
config({ path: ".env.local" });
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);

async function main() {
  console.log("=== Smoke a3: Nano Banana 2 (FAL.ai) ===\n");

  if (!process.env.FAL_KEY) {
    console.error("[smoke-a3] ❌ FAL_KEY ausente em .env.local");
    process.exit(1);
  }

  // 1. Snapshot creative_matrix ANTES (Regra de Ouro).
  const { count: matrixBefore } = await supabase
    .from("creative_matrix")
    .select("*", { count: "exact", head: true });
  console.log(`[smoke-a3] 📸 creative_matrix ANTES: ${matrixBefore ?? 0} rows`);

  // 2. Pegar task a3 pending.
  const { data: tasks, error: taskErr } = await supabase
    .from("task_queue")
    .select("id, payload")
    .eq("agent", "a3")
    .eq("status", "pending")
    .order("created_at", { ascending: true })
    .limit(1);

  if (taskErr) {
    console.error("Erro ao buscar tasks:", taskErr.message);
    process.exit(1);
  }

  if (!tasks || tasks.length === 0) {
    console.log("Nenhuma task a3 pending. Rode backfill-a3 primeiro.");
    process.exit(0);
  }

  console.log(`1. Task a3 encontrada: ${tasks[0].id}`);
  console.log(`   Payload: ${JSON.stringify(tasks[0].payload)}\n`);

  const leadId = (tasks[0].payload as { lead_id: string }).lead_id;

  // 3. Rodar o worker.
  console.log("2. Executando runWorkerA3Tick...\n");
  const { runWorkerA3Tick } = await import("../src/workers/worker-a3");
  const result = await runWorkerA3Tick({ maxTasks: 1 });

  console.log("3. Resultado do tick:");
  console.log(JSON.stringify(result, null, 2));

  if (result.succeeded !== 1) {
    console.error("[smoke-a3] ❌ tick não teve 1 sucesso");
    process.exit(2);
  }

  // 4. Exibir URLs geradas.
  const taskResult = result.results[0];
  if (taskResult.status === "done" && taskResult.result) {
    const r = taskResult.result as {
      images_count: number;
      failures_count: number;
      generated_images: Array<{
        scene_index: number;
        phase: string;
        public_url: string;
      }>;
    };
    console.log("\n" + "=".repeat(60));
    console.log(`IMAGENS GERADAS (${r.images_count}, falhas: ${r.failures_count}):`);
    console.log("=".repeat(60));
    for (const img of r.generated_images) {
      console.log(`  cena ${img.scene_index} (${img.phase}): ${img.public_url}`);
    }
  }

  // 5. Conferir status do lead.
  const { data: leadAfter } = await supabase
    .from("product_leads")
    .select("status")
    .eq("id", leadId)
    .single();
  console.log(`\n4. Status do lead ${leadId}: ${leadAfter?.status}`);
  if (leadAfter?.status !== "images_generated") {
    console.error(
      `[smoke-a3] ❌ status esperado 'images_generated', recebido '${leadAfter?.status}'`,
    );
    process.exit(2);
  }

  // 6. Regra de Ouro.
  const { count: matrixAfter } = await supabase
    .from("creative_matrix")
    .select("*", { count: "exact", head: true });
  console.log(`[smoke-a3] 📸 creative_matrix DEPOIS: ${matrixAfter ?? 0} rows`);
  if (matrixAfter !== matrixBefore) {
    console.error(
      `[smoke-a3] 🚨 REGRA DE OURO VIOLADA: creative_matrix ${matrixBefore} → ${matrixAfter}`,
    );
    process.exit(4);
  }
  console.log("[smoke-a3] ✅ Regra de Ouro intacta");

  console.log("\n=== Smoke a3 concluído ===");
}

main().catch((err) => {
  console.error("Erro fatal:", err);
  process.exit(1);
});

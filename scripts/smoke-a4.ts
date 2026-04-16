/**
 * Smoke test — Worker a4 (Seedance 2.0 i2v / fallback Kling 3.1).
 *
 * Valida end-to-end contra FAL.ai + Supabase Storage REAIS:
 *   1. Pega uma task a4 pending (injetada via chaining a3→a4 ou backfill).
 *   2. Executa runWorkerA4Tick({maxTasks:1}).
 *   3. Imprime URLs públicas dos MP4s + confirma status='videos_generated'.
 *   4. REGRA DE OURO: creative_matrix inalterada.
 *
 * Uso: npx tsx scripts/smoke-a4.ts
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
  console.log("=== Smoke a4: Seedance 2.0 i2v (FAL.ai) ===\n");

  if (!process.env.FAL_KEY) {
    console.error("[smoke-a4] ❌ FAL_KEY ausente em .env.local");
    process.exit(1);
  }

  // Stop-loss: verificar saldo mínimo antes de gastar
  const MIN_BALANCE_USD = 2.0;
  console.log(`[smoke-a4] Stop-loss: saldo mínimo exigido = $${MIN_BALANCE_USD}`);
  console.log("[smoke-a4] (verificação manual — se saldo < $2, aborte com Ctrl+C)");

  const { count: matrixBefore } = await supabase
    .from("creative_matrix")
    .select("*", { count: "exact", head: true });
  console.log(`[smoke-a4] 📸 creative_matrix ANTES: ${matrixBefore ?? 0}`);

  const { data: tasks, error: taskErr } = await supabase
    .from("task_queue")
    .select("id, payload")
    .eq("agent", "a4")
    .eq("status", "pending")
    .order("created_at", { ascending: true })
    .limit(1);

  if (taskErr) {
    console.error("Erro ao buscar tasks:", taskErr.message);
    process.exit(1);
  }
  if (!tasks || tasks.length === 0) {
    console.log("Nenhuma task a4 pending. Rode backfill-a4 primeiro.");
    process.exit(0);
  }

  console.log(`1. Task a4: ${tasks[0].id}`);
  console.log(`   Payload: ${JSON.stringify(tasks[0].payload)}\n`);
  const leadId = (tasks[0].payload as { lead_id: string }).lead_id;

  console.log("2. Executando runWorkerA4Tick...\n");
  const { runWorkerA4Tick } = await import("../src/workers/worker-a4");
  const result = await runWorkerA4Tick({ maxTasks: 1 });

  console.log("3. Resultado do tick:");
  console.log(JSON.stringify(result, null, 2));

  if (result.succeeded !== 1) {
    console.error("[smoke-a4] ❌ tick não teve 1 sucesso");
    process.exit(2);
  }

  const tr = result.results[0];
  if (tr.status === "done" && tr.result) {
    const r = tr.result as {
      videos_count: number;
      failures_count: number;
      generated_videos: Array<{
        scene_index: number;
        phase: string;
        provider: string;
        public_url: string;
        duration_seconds: number;
      }>;
    };
    console.log("\n" + "=".repeat(60));
    console.log(
      `VÍDEOS GERADOS (${r.videos_count}, falhas: ${r.failures_count}):`,
    );
    console.log("=".repeat(60));
    for (const v of r.generated_videos) {
      console.log(
        `  cena ${v.scene_index} (${v.phase}) [${v.provider} ${v.duration_seconds}s]: ${v.public_url}`,
      );
    }
  }

  const { data: leadAfter } = await supabase
    .from("product_leads")
    .select("status")
    .eq("id", leadId)
    .single();
  console.log(`\n4. Status do lead ${leadId}: ${leadAfter?.status}`);
  if (leadAfter?.status !== "videos_generated") {
    console.error(
      `[smoke-a4] ❌ status esperado 'videos_generated', recebido '${leadAfter?.status}'`,
    );
    process.exit(2);
  }

  const { count: matrixAfter } = await supabase
    .from("creative_matrix")
    .select("*", { count: "exact", head: true });
  console.log(`[smoke-a4] 📸 creative_matrix DEPOIS: ${matrixAfter ?? 0}`);
  if (matrixAfter !== matrixBefore) {
    console.error(
      `[smoke-a4] 🚨 REGRA DE OURO VIOLADA: ${matrixBefore} → ${matrixAfter}`,
    );
    process.exit(4);
  }
  console.log("[smoke-a4] ✅ Regra de Ouro intacta");

  console.log("\n=== Smoke a4 concluído ===");
}

main().catch((err) => {
  console.error("Erro fatal:", err);
  process.exit(1);
});

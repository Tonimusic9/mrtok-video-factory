/**
 * Smoke test — Worker a2 (Roteirista Criativo).
 * Processa leads que já passaram pelo a1 e exibe os prompts Nano Banana 2.
 * Uso: npx tsx scripts/smoke-a2.ts
 */
import { config } from "dotenv";
config({ path: ".env.local" });
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

async function main() {
  console.log("=== Smoke a2: Direção Criativa ===\n");

  // 1. Verificar tasks a2 pending
  const { data: tasks, error: taskErr } = await supabase
    .from("task_queue")
    .select("id, payload")
    .eq("agent", "a2")
    .eq("status", "pending")
    .order("created_at", { ascending: true })
    .limit(1);

  if (taskErr) {
    console.error("Erro ao buscar tasks:", taskErr.message);
    process.exit(1);
  }

  if (!tasks || tasks.length === 0) {
    console.log("Nenhuma task a2 pending. Rode backfill-a2.ts primeiro.");
    process.exit(0);
  }

  console.log(`1. Task a2 encontrada: ${tasks[0].id}`);
  console.log(`   Payload: ${JSON.stringify(tasks[0].payload)}\n`);

  // 2. Rodar o worker
  console.log("2. Executando runWorkerA2Tick...\n");
  const { runWorkerA2Tick } = await import("../src/workers/worker-a2");
  const result = await runWorkerA2Tick({ maxTasks: 1 });

  console.log("3. Resultado do tick:");
  console.log(JSON.stringify(result, null, 2));

  // 4. Exibir prompts Nano Banana 2 para validação
  if (result.succeeded > 0) {
    const taskResult = result.results[0];
    if (taskResult.status === "done" && taskResult.result) {
      const r = taskResult.result as any;
      const cd = r.creative_direction;
      if (cd?.visual_prompts) {
        console.log("\n" + "=".repeat(60));
        console.log("PROMPTS NANO BANANA 2 (para validação):");
        console.log("=".repeat(60));
        for (const vp of cd.visual_prompts) {
          console.log(`\n--- Cena ${vp.scene_index} (${vp.phase}) ---`);
          console.log(`PROMPT: ${vp.nano_banana_prompt}`);
          console.log(`NEG:    ${vp.negative_prompt}`);
        }
        console.log("\n" + "=".repeat(60));
        console.log("MOTION BUCKETS:");
        console.log("=".repeat(60));
        for (const mb of cd.motion_buckets) {
          console.log(`\n--- Cena ${mb.scene_index} (${mb.phase}) [${mb.provider}] ---`);
          console.log(`MOTION:   ${mb.motion_prompt}`);
          console.log(`CAMERA:   ${mb.camera_movement}`);
          console.log(`DURATION: ${mb.duration_seconds}s | INTENSITY: ${mb.intensity}`);
        }
        console.log("\n" + "=".repeat(60));
        console.log("VOICEOVER SCRIPT:");
        console.log("=".repeat(60));
        for (const vo of cd.voiceover_script) {
          console.log(`\n--- Cena ${vo.scene_index} (${vo.phase}) ---`);
          console.log(`${vo.tone_marker} "${vo.text_pt_br}"`);
          console.log(`IMPERFEIÇÃO: ${vo.human_imperfection_hint}`);
          console.log(`DURAÇÃO: ${vo.duration_seconds}s`);
        }
      }
    }
  }

  console.log("\n=== Smoke a2 concluído ===");
}

main().catch((err) => {
  console.error("Erro fatal:", err);
  process.exit(1);
});

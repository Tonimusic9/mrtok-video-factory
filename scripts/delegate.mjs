#!/usr/bin/env node
/**
 * scripts/delegate.mjs — Despachante local do Agente CEO.
 *
 * Roda sob demanda (ou via cron na VPS) para:
 *   1. Pegar a próxima task pending da task_queue.
 *   2. Marcar como in_progress.
 *   3. Delegar ao modelo correto via OpenRouter (src/lib/openrouter.ts).
 *   4. Gravar resultado + mover status para awaiting_qc ou failed.
 *
 * Esta é a ESPINHA DORSAL do Modo Híbrido — o CEO (Opus 4.6) NUNCA processa
 * copy/código pesado diretamente. Toda execução dos músculos passa aqui.
 *
 * Status na Tarefa 3: ESQUELETO mínimo — pega uma task, imprime o modelo
 * alvo, grava erro "not-implemented". A lógica real de chamada OpenRouter +
 * persistência do resultado será completada na Tarefa 4 junto com o Dashboard
 * de QC que consome as tasks `awaiting_qc`.
 *
 * Uso:
 *   node scripts/delegate.mjs           # processa 1 task
 *   node scripts/delegate.mjs --all     # drena toda a fila pending
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// --- carregar .env.local sem dotenv ---------------------------------------
function loadEnvLocal() {
  const text = readFileSync(resolve(process.cwd(), ".env.local"), "utf8");
  return Object.fromEntries(
    text
      .split("\n")
      .filter((l) => l && !l.startsWith("#") && l.includes("="))
      .map((l) => {
        const i = l.indexOf("=");
        return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
      }),
  );
}

// --- espelho do MODEL_MAP (src/lib/openrouter.ts) -------------------------
const MODEL_MAP = {
  a0: "minimax/minimax-2.7",
  a1: "google/gemini-3-flash",
  a2: "openai/gpt-5.4",
  a3: "qwen/qwen-3.6",
  a4: "qwen/qwen-3.6",
  a5: "openai/gpt-5.4",
  a6: "openai/gpt-5.4",
  a7: "openai/gpt-5.4",
};

async function takeNextPending(supabase) {
  // SELECT ... FOR UPDATE SKIP LOCKED seria ideal; como não temos rpc custom,
  // fazemos um update condicional — na Tarefa 4 migramos para uma função
  // Postgres que faz isso atomicamente.
  const { data: pending, error: selErr } = await supabase
    .from("task_queue")
    .select("id, agent, payload")
    .eq("status", "pending")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (selErr) throw new Error(`[delegate] select: ${selErr.message}`);
  if (!pending) return null;

  const { error: updErr } = await supabase
    .from("task_queue")
    .update({ status: "in_progress" })
    .eq("id", pending.id)
    .eq("status", "pending"); // condicional — evita race trivial
  if (updErr) throw new Error(`[delegate] lock: ${updErr.message}`);

  return pending;
}

async function processTask(supabase, task) {
  const model = MODEL_MAP[task.agent];
  if (!model) {
    await supabase
      .from("task_queue")
      .update({
        status: "failed",
        error: `sem mapeamento de modelo para agent=${task.agent}`,
      })
      .eq("id", task.id);
    return;
  }

  console.log(`[delegate] task=${task.id} agent=${task.agent} model=${model}`);
  console.log("[delegate] payload:", JSON.stringify(task.payload, null, 2));

  // TODO (Tarefa 4): chamar openRouterCompletion() + validar saída +
  // persistir em creative_matrix se agent=a3, etc.
  await supabase
    .from("task_queue")
    .update({
      status: "failed",
      error:
        "not-implemented: delegação real via OpenRouter será completada na Tarefa 4",
    })
    .eq("id", task.id);
}

async function main() {
  const env = loadEnvLocal();
  const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  const drainAll = process.argv.includes("--all");
  let processed = 0;
  while (true) {
    const task = await takeNextPending(supabase);
    if (!task) break;
    await processTask(supabase, task);
    processed += 1;
    if (!drainAll) break;
  }
  console.log(`[delegate] processed=${processed}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

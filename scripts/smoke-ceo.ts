/**
 * Smoke test do Agente CEO (Cérebro) — ping básico à API da Anthropic
 * para garantir que Claude Opus 4.6 está online, autenticado e pronto
 * a orquestrar tarefas.
 *
 * Uso: `npx tsx scripts/smoke-ceo.ts`
 */
import { readFileSync } from "node:fs";

function loadEnv(): void {
  const raw = readFileSync(".env.local", "utf-8");
  for (const line of raw.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq === -1) continue;
    const k = t.slice(0, eq).trim();
    const v = t.slice(eq + 1).trim();
    if (!(k in process.env)) process.env[k] = v;
  }
}

loadEnv();

const MODEL = "claude-opus-4-6";
const ENDPOINT = "https://api.anthropic.com/v1/messages";

async function main() {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key || key.length < 20) {
    console.error("[smoke-ceo] ❌ ANTHROPIC_API_KEY ausente ou inválida");
    process.exit(1);
  }
  console.log(`[smoke-ceo] key: len=${key.length} prefix=${key.slice(0, 10)}`);
  console.log(`[smoke-ceo] modelo: ${MODEL}`);
  console.log(`[smoke-ceo] ping → ${ENDPOINT}`);

  const t0 = Date.now();
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 32,
      messages: [
        {
          role: "user",
          content:
            "Ping do Agente CEO MrTok. Responda exatamente: 'CEO online, pronto a despachar.'",
        },
      ],
    }),
  });
  const latency = Date.now() - t0;

  if (!res.ok) {
    const errText = await res.text();
    console.error(
      `[smoke-ceo] ❌ ${res.status} ${res.statusText} (${latency}ms)\n${errText}`,
    );
    process.exit(2);
  }

  const data = (await res.json()) as {
    id?: string;
    model?: string;
    stop_reason?: string;
    usage?: { input_tokens: number; output_tokens: number };
    content?: Array<{ type: string; text?: string }>;
  };

  const reply = data.content?.find((b) => b.type === "text")?.text?.trim() ?? "";

  console.log(`[smoke-ceo] ✅ HTTP 200 em ${latency}ms`);
  console.log(`[smoke-ceo] message_id: ${data.id}`);
  console.log(`[smoke-ceo] modelo retornado: ${data.model}`);
  console.log(`[smoke-ceo] stop_reason: ${data.stop_reason}`);
  console.log(
    `[smoke-ceo] tokens: in=${data.usage?.input_tokens} out=${data.usage?.output_tokens}`,
  );
  console.log(`[smoke-ceo] resposta: ${reply}`);
  console.log("\n[smoke-ceo] ✅ Cérebro online, autenticado e pronto a despachar.");
}

main().catch((err) => {
  console.error("[smoke-ceo] ❌ falha:", err);
  process.exit(1);
});

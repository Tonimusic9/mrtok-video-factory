/**
 * Smoke test do Scriptwriter (Tarefa 6) — dispara writeScript() real
 * contra OpenRouter (a3 → Qwen 3.6) e valida o contrato + compliance.
 *
 * Uso: `npx tsx scripts/smoke-scriptwriter.ts "<tema>" ["<persona>"]`
 * Exemplo: `npx tsx scripts/smoke-scriptwriter.ts "máscara facial argila verde" "mulher 25-34, pele oleosa"`
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

// Carrega .env.local ANTES de importar módulos que chamam getEnv().
loadEnv();

const FORBIDDEN = [
  "cura",
  "trata ",
  "elimina 100",
  "anvisa",
  "garantido",
  "100%",
];

async function main() {
  // Import dinâmico pós-env para evitar validação precoce no topo.
  const { writeScript } = await import("../src/lib/agents/scriptwriter");

  const theme = process.argv[2];
  const persona = process.argv[3];
  if (!theme) {
    console.error("Uso: tsx scripts/smoke-scriptwriter.ts \"<tema>\" [\"<persona>\"]");
    process.exit(1);
  }

  console.log(`[smoke] tema: ${theme}`);
  if (persona) console.log(`[smoke] persona: ${persona}`);

  const result = await writeScript({
    theme,
    target_persona: persona,
  });

  console.log("\n[smoke] output:");
  console.log(JSON.stringify(result, null, 2));

  // Checks de compliance pós-schema.
  const allText = [
    result.hook.voiceover,
    result.body.voiceover,
    ...result.body.key_points,
    result.cta.voiceover,
  ]
    .join(" ")
    .toLowerCase();

  const hits = FORBIDDEN.filter((w) => allText.includes(w));
  if (hits.length > 0) {
    console.error(`\n[smoke] ❌ termos proibidos encontrados: ${hits.join(", ")}`);
    process.exit(2);
  }
  if (!result.hook.human_imperfection_hint.trim()) {
    console.error("\n[smoke] ❌ human_imperfection_hint vazio (Fator Humano CLAUDE.md §4)");
    process.exit(3);
  }

  console.log("\n[smoke] ✅ schema ok · compliance ok · fator humano presente");
  console.log(`[smoke] modelo: a3 → Qwen 3.6`);
}

main().catch((err) => {
  console.error("[smoke] ❌ falha:", err);
  process.exit(1);
});

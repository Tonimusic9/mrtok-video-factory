/**
 * smoke-a7-telegram.ts — valida a esteira de INFRA do Worker a7 (Delivery via
 * Telegram sendDocument) sem tocar no runtime do agente nem no output real
 * do Worker a6.
 *
 * Estratégia: gerar um pequeno arquivo dummy em tmpdir (test.txt por padrão,
 * ou um mini .mp4 via ffmpeg se --mp4 for passado) e enviar via
 * `multipart/form-data` para o endpoint `sendDocument` da Bot API. Imprime o
 * `message_id` e o `file_id` retornados pela API.
 *
 * ⚠️  REGRA INEGOCIÁVEL: este smoke valida APENAS `sendDocument`.
 *     NUNCA usar `sendVideo` — recomprime e destrói o Unique Pixel Hash.
 *     Ver knowledge/agents/agente-a7-delivery.md §REGRA INEGOCIÁVEL.
 *
 * O que valida:
 *   1. Leitura de TELEGRAM_BOT_TOKEN e TELEGRAM_CHAT_ID do .env.local
 *   2. Criação do arquivo dummy em tmpdir (bit-preservável)
 *   3. Upload via fetch nativo + FormData + Blob (Node 20+)
 *   4. Parse da resposta JSON da Bot API (ok: true + result.message_id)
 *   5. Impressão de um "recibo" com message_id e file name
 *
 * O que NÃO valida (fora do escopo):
 *   - Output real do Worker a6 (/output/publish_ready/*.mp4) — próximo smoke
 *   - Contrato Zod de saída do worker-a7 (pertence ao runtime)
 *   - Fluxo CEO → Admin com identificação de conta-destino
 *
 * Uso:
 *   `npx tsx scripts/smoke-a7-telegram.ts`           # envia um test.txt
 *   `npx tsx scripts/smoke-a7-telegram.ts --mp4`     # envia mp4 dummy (ffmpeg)
 *
 * Exit codes:
 *   0 = ok (Bot API retornou ok: true com message_id)
 *   1 = env ausente / setup / erro inesperado
 *   2 = falha na Bot API do Telegram (HTTP não-200 ou ok: false)
 */
import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import * as path from "node:path";

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

/**
 * Gera um arquivo dummy em tmpdir. Se `asMp4` for true, usa ffmpeg
 * (`testsrc` lavfi, 720×1280, 2s, 30fps) para gerar um mini-mp4 válido;
 * caso contrário, escreve um test.txt simples.
 */
function createDummyAsset(asMp4: boolean): { filePath: string; mimeType: string } {
  if (asMp4) {
    const outPath = path.join(tmpdir(), `smoke-a7-tg-${Date.now()}.mp4`);
    execFileSync(
      "ffmpeg",
      [
        "-y",
        "-f", "lavfi",
        "-i", "testsrc=duration=2:size=720x1280:rate=30",
        "-pix_fmt", "yuv420p",
        "-c:v", "libx264",
        "-preset", "ultrafast",
        outPath,
      ],
      { stdio: ["ignore", "ignore", "ignore"] },
    );
    return { filePath: outPath, mimeType: "video/mp4" };
  }
  const outPath = path.join(tmpdir(), `smoke-a7-tg-${Date.now()}.txt`);
  writeFileSync(outPath, "Smoke Test a7 - O motor está a funcionar!\n", "utf-8");
  return { filePath: outPath, mimeType: "text/plain" };
}

interface TelegramDocument {
  file_id: string;
  file_unique_id: string;
  file_name?: string;
  mime_type?: string;
  file_size?: number;
}

interface TelegramSendDocumentResponse {
  ok: boolean;
  description?: string;
  error_code?: number;
  result?: {
    message_id: number;
    date: number;
    document?: TelegramDocument;
    video?: unknown; // nunca deve aparecer — se aparecer, algo está errado
  };
}

async function main(): Promise<void> {
  const t0 = Date.now();
  const asMp4 = process.argv.includes("--mp4");

  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!botToken) {
    console.error("[smoke-a7-tg] ❌ TELEGRAM_BOT_TOKEN ausente no .env.local");
    process.exit(1);
  }
  if (!chatId) {
    console.error("[smoke-a7-tg] ❌ TELEGRAM_CHAT_ID ausente no .env.local");
    process.exit(1);
  }

  console.log(
    `[smoke-a7-tg] 🎯 alvo: chat_id=${chatId} | método=sendDocument | payload=${asMp4 ? "mp4 dummy" : "test.txt"}`,
  );

  // --- 1. Gera o asset dummy ----------------------------------------------
  const { filePath, mimeType } = createDummyAsset(asMp4);
  const fileName = path.basename(filePath);
  const fileBuffer = readFileSync(filePath);
  console.log(
    `[smoke-a7-tg] 📦 asset: ${filePath} (${fileBuffer.length} bytes, ${mimeType})`,
  );

  // --- 2. Monta o multipart/form-data -------------------------------------
  // Node 20+ tem FormData/Blob/fetch nativos — zero dep extra.
  const form = new FormData();
  form.append("chat_id", chatId);
  form.append(
    "caption",
    `🧪 smoke-a7-telegram: ${fileName}\nMétodo: sendDocument (zero recompressão)`,
  );
  form.append(
    "document",
    new Blob([new Uint8Array(fileBuffer)], { type: mimeType }),
    fileName,
  );

  // --- 3. POST para sendDocument ------------------------------------------
  const url = `https://api.telegram.org/bot${botToken}/sendDocument`;
  console.log("[smoke-a7-tg] 📤 POST sendDocument ...");

  let response: Response;
  try {
    response = await fetch(url, { method: "POST", body: form });
  } catch (err) {
    console.error(
      "[smoke-a7-tg] ❌ falha de rede na Bot API:",
      (err as Error).message,
    );
    process.exit(2);
  }

  const bodyText = await response.text();
  let parsed: TelegramSendDocumentResponse;
  try {
    parsed = JSON.parse(bodyText) as TelegramSendDocumentResponse;
  } catch {
    console.error(
      `[smoke-a7-tg] ❌ resposta não-JSON (status ${response.status}):`,
      bodyText.slice(0, 500),
    );
    process.exit(2);
  }

  if (!response.ok || !parsed.ok) {
    console.error(
      `[smoke-a7-tg] ❌ Bot API respondeu com erro (status ${response.status}, code ${parsed.error_code ?? "n/a"}):`,
      parsed.description ?? bodyText.slice(0, 500),
    );
    process.exit(2);
  }

  if (!parsed.result) {
    console.error("[smoke-a7-tg] ❌ response.result ausente");
    process.exit(2);
  }

  // --- 4. Sanity check: deve ser document, nunca video --------------------
  if (parsed.result.video) {
    console.error(
      "[smoke-a7-tg] ❌ response.result.video presente — Telegram tratou como vídeo! Isso viola a regra sendDocument.",
    );
    process.exit(2);
  }

  const doc = parsed.result.document;
  const totalSec = ((Date.now() - t0) / 1000).toFixed(1);
  console.log("\n[smoke-a7-tg] ✅ SMOKE PASS");
  console.log(`[smoke-a7-tg]    message_id:   ${parsed.result.message_id}`);
  if (doc) {
    console.log(`[smoke-a7-tg]    file_id:      ${doc.file_id}`);
    console.log(`[smoke-a7-tg]    file_name:    ${doc.file_name ?? fileName}`);
    console.log(`[smoke-a7-tg]    mime_type:    ${doc.mime_type ?? mimeType}`);
    console.log(`[smoke-a7-tg]    file_size:    ${doc.file_size ?? fileBuffer.length} bytes`);
  }
  console.log(
    `[smoke-a7-tg] 🎉 PASSOU em ${totalSec}s — infra Telegram sendDocument validada`,
  );
  console.log("[smoke-a7-tg] 📱 confira o celular — o arquivo deve ter chegado como documento (NÃO como vídeo).");
}

main().catch((err) => {
  console.error("[smoke-a7-tg] ❌ erro inesperado:", err);
  process.exit(1);
});

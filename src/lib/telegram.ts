/**
 * Wrapper minimalista do Telegram Bot API para notificações assíncronas
 * do OpenClaw (CLAUDE.md §3 — Orquestração).
 *
 * Uso fire-and-forget: o caller NUNCA deve aguardar a resposta deste
 * módulo no caminho crítico. Falhas de notificação são logadas, não
 * propagadas — o pipeline de produção não pode quebrar por causa do
 * Telegram estar offline.
 *
 * Exceção: `sendTelegramDocument` (Worker a7) é SÍNCRONO e propaga erros
 * — a entrega do MP4 final é caminho crítico e precisa sinalizar falha
 * para o runner marcar a task como `failed`.
 */
import { readFileSync } from "node:fs";
import { getEnv } from "@/lib/env";

/**
 * Envia uma mensagem ao chat configurado em TELEGRAM_CHAT_ID.
 * Retorna true em sucesso, false em falha (sem throw).
 */
export async function notify(text: string): Promise<boolean> {
  try {
    const env = getEnv();
    const url = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chat_id: env.TELEGRAM_CHAT_ID,
        text,
        parse_mode: "Markdown",
        disable_web_page_preview: true,
      }),
    });
    if (!res.ok) {
      console.error(
        `[MrTok/telegram] sendMessage falhou: ${res.status} ${await res.text()}`,
      );
      return false;
    }
    return true;
  } catch (err) {
    console.error("[MrTok/telegram] erro inesperado:", err);
    return false;
  }
}

/**
 * Helper fire-and-forget: dispara a notificação sem bloquear o caller.
 * Use no caminho crítico de API routes.
 */
export function notifyAsync(text: string): void {
  void notify(text).catch((err) =>
    console.error("[MrTok/telegram] notifyAsync swallow:", err),
  );
}

/**
 * Recibo tipado devolvido pelo endpoint `sendDocument` do Telegram.
 * Subconjunto do que a Bot API retorna — só o que o Worker a7
 * (Delivery) precisa persistir em `task_queue.result` para auditoria.
 */
export interface TelegramDocumentReceipt {
  message_id: number;
  chat_id: string;
  file_id: string;
  file_unique_id: string;
  file_name: string;
  file_size: number;
  mime_type: string;
}

/**
 * Shape bruto da resposta JSON da Bot API para `sendDocument`. Mantido
 * interno ao módulo — callers consomem `TelegramDocumentReceipt`.
 */
interface TelegramSendDocumentApiResponse {
  ok: boolean;
  description?: string;
  error_code?: number;
  result?: {
    message_id: number;
    date: number;
    document?: {
      file_id: string;
      file_unique_id: string;
      file_name?: string;
      mime_type?: string;
      file_size?: number;
    };
    /**
     * NUNCA deve aparecer. Se vier preenchido, o Telegram tratou o
     * upload como vídeo (aplicou recompressão) — viola a regra
     * inegociável de `agente-a7-delivery.md` §REGRA INEGOCIÁVEL e
     * destrói o Unique Pixel Hash do Remotion.
     */
    video?: unknown;
  };
}

/**
 * Envia um arquivo binário ao chat configurado em `TELEGRAM_CHAT_ID`
 * via `sendDocument` (zero recompressão server-side, checksum e
 * pixel hash preservados bit-a-bit).
 *
 * ⚠️  PROIBIDO trocar por `sendVideo`. O endpoint `sendVideo` aplica
 * recompressão H.264 + downscale + bitrate cap que destrói:
 *   1. O Unique Pixel Hash (escala [1.005..1.015] + rotação).
 *   2. Os metadados iPhone 17 Pro Max injetados via ffmpeg.
 *   3. O bitrate alvo de 6–10 Mbps.
 * Ver knowledge/agents/agente-a7-delivery.md §REGRA INEGOCIÁVEL.
 *
 * Assinatura propaga erros (diferente de `notify`) — o Worker a7 precisa
 * da exceção para reportar `kind: "failed"` ao runner.
 *
 * Pattern de multipart baseado em `scripts/smoke-a7-telegram.ts:131-206`
 * — usa FormData + Blob nativos do Node 20+, zero deps extras.
 */
export async function sendTelegramDocument(args: {
  filePath: string;
  fileName: string;
  caption?: string;
  mimeType?: string;
}): Promise<TelegramDocumentReceipt> {
  const { filePath, fileName } = args;
  const mimeType = args.mimeType ?? "video/mp4";
  const env = getEnv();

  // 1. Ler bytes do arquivo. Se o caminho for inválido, propaga o erro
  //    nativo do Node (ENOENT etc) — o worker já pré-valida existência
  //    mas mantemos o throw como defesa em profundidade.
  const fileBuffer = readFileSync(filePath);

  // 2. Montar multipart/form-data nativo (Node 20+).
  const form = new FormData();
  form.append("chat_id", env.TELEGRAM_CHAT_ID);
  if (args.caption) {
    form.append("caption", args.caption);
  }
  // Desabilita classificação automática server-side do Bot API — sem isso,
  // MP4 com codec de vídeo válido é reclassificado como `result.video`
  // (recompressão) e destrói o Unique Pixel Hash do Remotion.
  // Ref: https://core.telegram.org/bots/api#senddocument
  form.append("disable_content_type_detection", "true");
  form.append(
    "document",
    new Blob([new Uint8Array(fileBuffer)], { type: mimeType }),
    fileName,
  );

  // 3. POST para sendDocument.
  const url = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendDocument`;
  let response: Response;
  try {
    response = await fetch(url, { method: "POST", body: form });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`[MrTok/telegram] falha de rede em sendDocument: ${msg}`);
  }

  // 4. Parse defensivo da resposta (Bot API às vezes devolve HTML em 5xx).
  const bodyText = await response.text();
  let parsed: TelegramSendDocumentApiResponse;
  try {
    parsed = JSON.parse(bodyText) as TelegramSendDocumentApiResponse;
  } catch {
    throw new Error(
      `[MrTok/telegram] sendDocument resposta não-JSON (status ${response.status}): ${bodyText.slice(0, 500)}`,
    );
  }

  if (!response.ok || !parsed.ok) {
    throw new Error(
      `[MrTok/telegram] sendDocument erro Bot API (status ${response.status}, code ${parsed.error_code ?? "n/a"}): ${parsed.description ?? bodyText.slice(0, 500)}`,
    );
  }

  if (!parsed.result) {
    throw new Error("[MrTok/telegram] sendDocument response.result ausente");
  }

  // 5. Regra inegociável: se o Telegram tratou como vídeo, reprovamos.
  if (parsed.result.video) {
    throw new Error(
      "[MrTok/telegram] sendDocument retornou result.video — Telegram tratou o upload como vídeo (recompressão). Viola a regra inegociável sendDocument.",
    );
  }

  const doc = parsed.result.document;
  if (!doc) {
    throw new Error(
      "[MrTok/telegram] sendDocument response.result.document ausente — não é possível auditar entrega",
    );
  }

  return {
    message_id: parsed.result.message_id,
    chat_id: env.TELEGRAM_CHAT_ID,
    file_id: doc.file_id,
    file_unique_id: doc.file_unique_id,
    file_name: doc.file_name ?? fileName,
    file_size: doc.file_size ?? fileBuffer.length,
    mime_type: doc.mime_type ?? mimeType,
  };
}

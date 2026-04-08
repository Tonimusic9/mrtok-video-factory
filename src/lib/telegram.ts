/**
 * Wrapper minimalista do Telegram Bot API para notificações assíncronas
 * do OpenClaw (CLAUDE.md §3 — Orquestração).
 *
 * Uso fire-and-forget: o caller NUNCA deve aguardar a resposta deste
 * módulo no caminho crítico. Falhas de notificação são logadas, não
 * propagadas — o pipeline de produção não pode quebrar por causa do
 * Telegram estar offline.
 */
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

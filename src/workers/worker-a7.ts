/**
 * Worker a7 — Delivery via Telegram `sendDocument` (Tarefa Pós-pivot 2026-04-11).
 *
 * Glue fino entre o runner genérico (`runAgentTick`) e a ponte Telegram.
 * Drena a fila `task_queue` onde `agent='a7'`.
 *
 * Fluxo:
 *   1. Recebe payload apontando para o `.mp4` finalizado pelo Worker a6
 *      (normalmente um `file://` URL em `./output/publish_ready/`).
 *   2. Pré-valida o arquivo (existe, não-vazio, ≤ 50 MB — limite da Bot
 *      API padrão para `sendDocument`).
 *   3. Monta nome canônico `[account_id]_[product_slug]_[timestamp].mp4`
 *      para o administrador identificar a conta-destino no celular.
 *   4. Envia via `sendTelegramDocument` (nunca `sendVideo` — ver
 *      knowledge/agents/agente-a7-delivery.md §REGRA INEGOCIÁVEL).
 *   5. Retorna `DeliveryResult` com o recibo (`telegram_message_id`)
 *      para consumo do CEO.
 *
 * REGRA DE OURO: este worker NUNCA escreve em `creative_matrix` e NUNCA
 * toca em `compliance_approved` — apenas em `task_queue` via runner.
 *
 * Sem side-effects no top-level: importar este módulo não inicia loop
 * nem registra listener — o acionamento (cron, route handler, smoke) é
 * externo.
 */
import { existsSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import {
  runAgentTick,
  type AgentTickArgs,
  type AgentTickResult,
} from "@/lib/agent-runner";
import { sendTelegramDocument } from "@/lib/telegram";
import { getEnv } from "@/lib/env";

/**
 * Limite da Bot API padrão para `sendDocument`. Acima disso é preciso
 * rodar um Local Bot API Server (limite 2 GB) — fora de escopo.
 * Para vídeos de 15s a 720p (6–10 Mbps) 50 MB é folgado.
 */
const TELEGRAM_DOCUMENT_MAX_BYTES = 50 * 1024 * 1024;

// ---------------------------------------------------------------------------
// Schemas Zod
// ---------------------------------------------------------------------------

export const deliveryTaskPayloadSchema = z.object({
  /** UUID do projeto/criativo (mesmo usado pelo a6). */
  project_id: z.string().min(1),
  /**
   * Caminho para o MP4 finalizado. Aceita `file://...` (padrão emitido
   * por `worker-a6.ts:185`) ou caminho absoluto do filesystem.
   */
  output_video_url: z.string().min(1),
  /** Identificador interno da conta-destino (ex.: "acc01"). */
  account_id: z.string().min(1),
  /** Handle público da conta (ex.: "@loja_top_br"). */
  account_handle: z.string().min(1),
  /** Nome do produto — usado na nomenclatura do arquivo. */
  product_name: z.string().min(1),
  /** Caption opcional; se ausente, gera default com handle + produto. */
  caption: z.string().optional(),
});
export type DeliveryTaskPayload = z.infer<typeof deliveryTaskPayloadSchema>;

export const deliveryResultSchema = z.object({
  project_id: z.string(),
  delivery_status: z.enum(["SUCCESS", "FAILED"]),
  storage_details: z.object({
    provider: z.literal("telegram_document"),
    chat_id: z.string(),
    telegram_message_id: z.number(),
    file_name: z.string(),
    target_account_handle: z.string(),
  }),
  message_for_ceo: z.string(),
});
export type DeliveryResult = z.infer<typeof deliveryResultSchema>;

// ---------------------------------------------------------------------------
// Helpers locais
// ---------------------------------------------------------------------------

/**
 * Resolve o caminho local do MP4 a partir do `output_video_url` do payload.
 * Usa `fileURLToPath` para lidar corretamente com espaços/unicode no path
 * (o workdir do projeto contém "PROJETOS CLAUDE CODE" com espaço).
 */
function resolveLocalPath(outputVideoUrl: string): string {
  if (outputVideoUrl.startsWith("file://")) {
    return fileURLToPath(outputVideoUrl);
  }
  return outputVideoUrl;
}

/**
 * Slug ASCII minúsculo para o `product_name` — o nome vai aparecer no
 * Telegram e deve ser seguro em filesystem em qualquer OS.
 */
function slugify(raw: string): string {
  const slug = raw
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
  return slug.length > 0 ? slug : "produto";
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

export function runWorkerA7Tick(
  args: AgentTickArgs = {},
): Promise<AgentTickResult> {
  return runAgentTick<DeliveryTaskPayload, DeliveryResult>(
    {
      agent: "a7",
      label: "Delivery a7",
      payloadSchema: deliveryTaskPayloadSchema,
      process: async (payload) => {
        const env = getEnv();

        // --- 1. Resolver e pré-validar o arquivo ---------------------------
        const localPath = resolveLocalPath(payload.output_video_url);

        if (!existsSync(localPath)) {
          return {
            kind: "failed",
            error: `mp4 não encontrado: ${localPath}`,
          };
        }

        const { size } = statSync(localPath);
        if (size === 0) {
          return {
            kind: "failed",
            error: `mp4 vazio (0 bytes): ${localPath}`,
          };
        }
        if (size > TELEGRAM_DOCUMENT_MAX_BYTES) {
          return {
            kind: "failed",
            error: `mp4 excede limite sendDocument (50MB): ${size} bytes — rodar Local Bot API Server`,
          };
        }

        // --- 2. Nomenclatura canônica --------------------------------------
        const timestamp = Math.floor(Date.now() / 1000);
        const fileName = `${payload.account_id}_${slugify(payload.product_name)}_${timestamp}.mp4`;
        const caption =
          payload.caption ??
          `📦 ${payload.account_handle} · ${payload.product_name}\nMétodo: sendDocument (pixel hash preservado)`;

        // --- 3. Envio via Telegram Bot API ---------------------------------
        let receipt;
        try {
          receipt = await sendTelegramDocument({
            filePath: localPath,
            fileName,
            caption,
            mimeType: "video/mp4",
          });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          return { kind: "failed", error: `telegram_sendDocument: ${msg}` };
        }

        // --- 4. Montar DeliveryResult conforme contrato do CEO -------------
        const result: DeliveryResult = {
          project_id: payload.project_id,
          delivery_status: "SUCCESS",
          storage_details: {
            provider: "telegram_document",
            chat_id: env.TELEGRAM_CHAT_ID,
            telegram_message_id: receipt.message_id,
            file_name: receipt.file_name,
            target_account_handle: payload.account_handle,
          },
          message_for_ceo: `Vídeo entregue no Telegram (msg ${receipt.message_id}). Pronto para postagem manual em ${payload.account_handle}.`,
        };

        // --- 5. Re-validação defensiva antes de persistir ------------------
        const check = deliveryResultSchema.safeParse(result);
        if (!check.success) {
          const issues = check.error.issues
            .map((i) => `${i.path.join(".")}: ${i.message}`)
            .join("; ");
          return {
            kind: "failed",
            error: `delivery_result_invalid: ${issues}`,
          };
        }

        return { kind: "done", result };
      },
    },
    args,
  );
}

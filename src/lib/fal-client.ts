/**
 * Cliente FAL.ai — gateway de geração de vídeo/imagem.
 *
 * Submete jobs via REST queue e faz poll com backoff exponencial até
 * conclusão ou timeout.
 *
 * Endpoints (2026):
 *   POST https://queue.fal.run/{slug}              → submit (com slug)
 *   GET  https://queue.fal.run/requests/{id}/status → poll status (SEM slug)
 *   GET  https://queue.fal.run/requests/{id}        → fetch result (SEM slug)
 *
 * REGRA: este módulo NÃO importa nada do domínio MrTok (schemas, agents).
 * É um cliente genérico de fila FAL.ai reutilizável.
 */
import { getEnv } from "@/lib/env";
import readline from "readline/promises";

/** Base para submit: POST https://fal.run/queue/{slug} */
const SUBMIT_BASE = "https://fal.run/queue";
/** Base para status/result: GET https://fal.run/queue/requests/{id}/... */
const POLL_BASE = "https://fal.run/queue/requests";

/** Timeout por request individual — 6 minutos. */
const REQUEST_TIMEOUT_MS = 6 * 60 * 1000;

/** Backoff inicial do poll em ms. */
const INITIAL_POLL_INTERVAL_MS = 2_000;

/** Fator multiplicativo do backoff. */
const BACKOFF_FACTOR = 2;

/** Intervalo máximo entre polls. */
const MAX_POLL_INTERVAL_MS = 16_000;

export interface FalSubmitArgs {
  slug: string;
  input: Record<string, unknown>;
}

export interface FalJobResult {
  request_id: string;
  video_url: string;
  duration_ms: number;
}

interface FalQueueResponse {
  request_id: string;
  status?: string;
}

interface FalStatusResponse {
  status: string;
  [key: string]: unknown;
}

interface FalResultResponse {
  video?: { url?: string };
  output?: { video?: string };
  [key: string]: unknown;
}

function authHeaders(): Record<string, string> {
  const env = getEnv();
  return {
    Authorization: `Key ${env.FAL_KEY}`,
    "Content-Type": "application/json",
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Submete um job de vídeo na fila FAL.ai e faz poll até conclusão.
 */
export async function submitAndPoll(args: FalSubmitArgs): Promise<FalJobResult> {
  // Stop-loss: confirmação manual antes de gastar créditos.
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(`⚠️  CUIDADO: Chamada paga → ${args.slug} ($0.50+). Digite "PAGAR" para continuar: `);
  rl.close();
  if (answer !== "PAGAR") {
    console.log("Aborted by user.");
    process.exit(1);
  }

  const t0 = Date.now();
  const headers = authHeaders();

  // 1. Submit (COM slug)
  const submitUrl = `${SUBMIT_BASE}/${args.slug}`;
  const submitRes = await fetch(submitUrl, {
    method: "POST",
    headers,
    body: JSON.stringify(args.input),
  });
  if (!submitRes.ok) {
    const errText = await submitRes.text();
    throw new Error(
      `[fal-client] submit falhou (${submitRes.status}): ${errText}`,
    );
  }
  const submitData = (await submitRes.json()) as FalQueueResponse;
  const requestId = submitData.request_id;
  if (!requestId) {
    throw new Error(
      `[fal-client] submit não retornou request_id: ${JSON.stringify(submitData)}`,
    );
  }

  console.log(`[fal-client] job submetido: ${requestId}`);

  // 2. Poll (SEM slug nas URLs)
  let interval = INITIAL_POLL_INTERVAL_MS;
  const statusUrl = `${POLL_BASE}/${requestId}/status`;
  const resultUrl = `${POLL_BASE}/${requestId}`;

  let pollCount = 0;
  while (true) {
    const elapsed = Date.now() - t0;
    if (elapsed >= REQUEST_TIMEOUT_MS) {
      throw new Error(
        `[fal-client] timeout após ${Math.round(elapsed / 1000)}s para request ${requestId}`,
      );
    }

    await sleep(interval);
    interval = Math.min(interval * BACKOFF_FACTOR, MAX_POLL_INTERVAL_MS);
    pollCount++;

    // Apenas status endpoint (GET direto dá 405 durante processamento)
    const statusRes = await fetch(statusUrl, { headers });

    if (statusRes.status === 405) {
      console.error(`[CIRCUIT BREAKER] HTTP 405 em ${statusUrl} — URL de Polling Inválida`);
      process.exit(1);
    }

    if (!statusRes.ok) {
      console.warn(`[fal-client] poll #${pollCount} status HTTP ${statusRes.status}`);
      continue;
    }

    const statusData = (await statusRes.json()) as FalStatusResponse;
    const st = String(statusData.status ?? "").toUpperCase();

    console.log(
      `[fal-client:debug] poll #${pollCount} (${Math.round(elapsed / 1000)}s) status="${st}"`,
      JSON.stringify(statusData).slice(0, 300),
    );

    if (st === "FAILED") {
      const detail = typeof statusData.error === "string" ? statusData.error : "";
      throw new Error(`[fal-client] job ${requestId} FAILED: ${detail || "sem detalhe"}`);
    }

    if (st === "COMPLETED" || st === "SUCCESS" || st === "OK") {
      console.log(`[fal-client] status=${st} — buscando resultado`);
      const finalRes = await fetch(resultUrl, { headers });
      if (!finalRes.ok) {
        throw new Error(`[fal-client] result GET falhou (${finalRes.status})`);
      }
      const resultData = (await finalRes.json()) as FalResultResponse;
      const videoUrl =
        resultData.video?.url ??
        resultData.output?.video ??
        extractVideoUrl(resultData);
      if (!videoUrl) {
        throw new Error(
          `[fal-client] resultado sem video_url: ${JSON.stringify(resultData).slice(0, 500)}`,
        );
      }
      return { request_id: requestId, video_url: videoUrl, duration_ms: Date.now() - t0 };
    }

    // IN_QUEUE, IN_PROGRESS → continua
  }
}

function extractVideoUrl(data: Record<string, unknown>): string | undefined {
  for (const value of Object.values(data)) {
    if (typeof value === "string" && value.startsWith("https://") && value.includes(".mp4")) {
      return value;
    }
    if (typeof value === "object" && value !== null) {
      const nested = extractVideoUrl(value as Record<string, unknown>);
      if (nested) return nested;
    }
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Image jobs (Worker a3 — Nano Banana 2)
// ---------------------------------------------------------------------------

export interface FalImageJobResult {
  request_id: string;
  image_url: string;
  duration_ms: number;
}

interface FalImageResultResponse {
  images?: Array<{ url?: string }>;
  image?: { url?: string };
  output?: { images?: Array<{ url?: string }> };
  [key: string]: unknown;
}

/**
 * Submete um job de imagem na fila FAL.ai e faz poll até conclusão.
 */
export async function submitAndPollImage(
  args: FalSubmitArgs,
): Promise<FalImageJobResult> {
  const t0 = Date.now();
  const headers = authHeaders();

  const submitUrl = `${SUBMIT_BASE}/${args.slug}`;
  const submitRes = await fetch(submitUrl, {
    method: "POST",
    headers,
    body: JSON.stringify(args.input),
  });
  if (!submitRes.ok) {
    const errText = await submitRes.text();
    throw new Error(
      `[fal-client:image] submit falhou (${submitRes.status}): ${errText}`,
    );
  }
  const submitData = (await submitRes.json()) as FalQueueResponse;
  const requestId = submitData.request_id;
  if (!requestId) {
    throw new Error(
      `[fal-client:image] submit sem request_id: ${JSON.stringify(submitData)}`,
    );
  }

  let interval = INITIAL_POLL_INTERVAL_MS;
  const statusUrl = `${POLL_BASE}/${requestId}/status`;
  const resultUrl = `${POLL_BASE}/${requestId}`;

  let pollCount = 0;
  while (true) {
    const elapsed = Date.now() - t0;
    if (elapsed >= REQUEST_TIMEOUT_MS) {
      throw new Error(
        `[fal-client:image] timeout após ${Math.round(elapsed / 1000)}s para ${requestId}`,
      );
    }

    await sleep(interval);
    interval = Math.min(interval * BACKOFF_FACTOR, MAX_POLL_INTERVAL_MS);
    pollCount++;

    const statusRes = await fetch(statusUrl, { headers });
    if (statusRes.status === 405) {
      console.error(`[CIRCUIT BREAKER] HTTP 405 em ${statusUrl} — URL de Polling Inválida`);
      process.exit(1);
    }
    if (!statusRes.ok) continue;

    const statusData = (await statusRes.json()) as FalStatusResponse;
    const st = String(statusData.status ?? "").toUpperCase();

    console.log(`[fal-client:image:debug] poll #${pollCount} (${Math.round(elapsed / 1000)}s) status="${st}"`);

    if (st === "FAILED") {
      throw new Error(`[fal-client:image] job ${requestId} FAILED`);
    }

    if (st === "COMPLETED" || st === "SUCCESS" || st === "OK") {
      const finalRes = await fetch(resultUrl, { headers });
      if (!finalRes.ok) {
        throw new Error(`[fal-client:image] result falhou (${finalRes.status})`);
      }
      const resultData = (await finalRes.json()) as FalImageResultResponse;
      const imageUrl =
        resultData.images?.[0]?.url ??
        resultData.image?.url ??
        resultData.output?.images?.[0]?.url ??
        extractImageUrl(resultData);
      if (!imageUrl) {
        throw new Error(
          `[fal-client:image] resultado sem url: ${JSON.stringify(resultData).slice(0, 500)}`,
        );
      }
      return { request_id: requestId, image_url: imageUrl, duration_ms: Date.now() - t0 };
    }
  }
}

function extractImageUrl(data: Record<string, unknown>): string | undefined {
  for (const value of Object.values(data)) {
    if (
      typeof value === "string" &&
      value.startsWith("https://") &&
      /\.(png|jpg|jpeg|webp)(\?|$)/i.test(value)
    ) {
      return value;
    }
    if (typeof value === "object" && value !== null) {
      const nested = extractImageUrl(value as Record<string, unknown>);
      if (nested) return nested;
    }
  }
  return undefined;
}

/**
 * Cliente FAL.ai — gateway de geração de vídeo (Tarefa 10, Worker a6).
 *
 * Submete jobs via REST queue e faz poll com backoff exponencial até
 * conclusão ou timeout. Cada request tem timeout individual de 5 minutos.
 *
 * Endpoints:
 *   POST https://queue.fal.run/{slug}                         → submit
 *   GET  https://queue.fal.run/{slug}/requests/{id}/status    → poll
 *   GET  https://queue.fal.run/{slug}/requests/{id}           → result
 *
 * REGRA: este módulo NÃO importa nada do domínio MrTok (schemas, agents).
 * É um cliente genérico de fila FAL.ai reutilizável.
 */
import { getEnv } from "@/lib/env";

const QUEUE_BASE = "https://queue.fal.run";

/** Timeout por request individual — 5 minutos. */
const REQUEST_TIMEOUT_MS = 5 * 60 * 1000;

/** Backoff inicial do poll em ms. */
const INITIAL_POLL_INTERVAL_MS = 2_000;

/** Fator multiplicativo do backoff. */
const BACKOFF_FACTOR = 2;

/** Intervalo máximo entre polls. */
const MAX_POLL_INTERVAL_MS = 16_000;

export interface FalSubmitArgs {
  /** Slug FAL.ai do modelo (ex: "fal-ai/kling-video/v2.1/standard"). */
  slug: string;
  /** Parâmetros específicos do modelo. */
  input: Record<string, unknown>;
}

export interface FalJobResult {
  /** ID do request na fila FAL.ai. */
  request_id: string;
  /** URL do vídeo gerado. */
  video_url: string;
  /** Duração do processamento em ms. */
  duration_ms: number;
}

interface FalQueueResponse {
  request_id: string;
  status?: string;
}

interface FalStatusResponse {
  status: "IN_QUEUE" | "IN_PROGRESS" | "COMPLETED" | "FAILED";
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

/**
 * Submete um job na fila FAL.ai e faz poll até conclusão.
 * Timeout de 5 minutos POR REQUEST INDIVIDUAL.
 */
export async function submitAndPoll(args: FalSubmitArgs): Promise<FalJobResult> {
  const t0 = Date.now();
  const headers = authHeaders();

  // 1. Submit
  const submitUrl = `${QUEUE_BASE}/${args.slug}`;
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

  // 2. Poll com backoff exponencial
  let interval = INITIAL_POLL_INTERVAL_MS;
  const statusUrl = `${QUEUE_BASE}/${args.slug}/requests/${requestId}/status`;
  const resultUrl = `${QUEUE_BASE}/${args.slug}/requests/${requestId}`;

  while (true) {
    const elapsed = Date.now() - t0;
    if (elapsed >= REQUEST_TIMEOUT_MS) {
      throw new Error(
        `[fal-client] timeout após ${Math.round(elapsed / 1000)}s para request ${requestId}`,
      );
    }

    await sleep(interval);
    interval = Math.min(interval * BACKOFF_FACTOR, MAX_POLL_INTERVAL_MS);

    const statusRes = await fetch(statusUrl, { headers });
    if (!statusRes.ok) {
      // Falha transitória no poll — continuar tentando até timeout.
      continue;
    }
    const statusData = (await statusRes.json()) as FalStatusResponse;

    if (statusData.status === "FAILED") {
      throw new Error(
        `[fal-client] job ${requestId} falhou no provider`,
      );
    }

    if (statusData.status === "COMPLETED") {
      // 3. Buscar resultado
      const resultRes = await fetch(resultUrl, { headers });
      if (!resultRes.ok) {
        const errText = await resultRes.text();
        throw new Error(
          `[fal-client] result falhou (${resultRes.status}): ${errText}`,
        );
      }
      const resultData = (await resultRes.json()) as FalResultResponse;

      // Diferentes modelos retornam a URL em campos diferentes.
      const videoUrl =
        resultData.video?.url ??
        resultData.output?.video ??
        extractVideoUrl(resultData);

      if (!videoUrl) {
        throw new Error(
          `[fal-client] resultado sem video_url: ${JSON.stringify(resultData).slice(0, 500)}`,
        );
      }

      return {
        request_id: requestId,
        video_url: videoUrl,
        duration_ms: Date.now() - t0,
      };
    }
    // IN_QUEUE ou IN_PROGRESS → continua o poll.
  }
}

/**
 * Fallback: procura URL de vídeo em qualquer campo do resultado.
 * Alguns modelos FAL.ai usam estruturas de resposta não-padrão.
 */
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
 * Submete um job de imagem (ex.: Nano Banana 2) na fila FAL.ai e faz poll
 * até conclusão. Segue o mesmo padrão de `submitAndPoll` (vídeo) mas extrai
 * a primeira URL de imagem do payload — Nano Banana retorna `images: [{url}]`.
 */
export async function submitAndPollImage(
  args: FalSubmitArgs,
): Promise<FalImageJobResult> {
  const t0 = Date.now();
  const headers = authHeaders();

  const submitUrl = `${QUEUE_BASE}/${args.slug}`;
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
  const statusUrl = `${QUEUE_BASE}/${args.slug}/requests/${requestId}/status`;
  const resultUrl = `${QUEUE_BASE}/${args.slug}/requests/${requestId}`;

  while (true) {
    const elapsed = Date.now() - t0;
    if (elapsed >= REQUEST_TIMEOUT_MS) {
      throw new Error(
        `[fal-client:image] timeout após ${Math.round(elapsed / 1000)}s para ${requestId}`,
      );
    }

    await sleep(interval);
    interval = Math.min(interval * BACKOFF_FACTOR, MAX_POLL_INTERVAL_MS);

    const statusRes = await fetch(statusUrl, { headers });
    if (!statusRes.ok) continue;
    const statusData = (await statusRes.json()) as FalStatusResponse;

    if (statusData.status === "FAILED") {
      throw new Error(`[fal-client:image] job ${requestId} FAILED no provider`);
    }

    if (statusData.status === "COMPLETED") {
      const resultRes = await fetch(resultUrl, { headers });
      if (!resultRes.ok) {
        const errText = await resultRes.text();
        throw new Error(
          `[fal-client:image] result falhou (${resultRes.status}): ${errText}`,
        );
      }
      const resultData = (await resultRes.json()) as FalImageResultResponse;

      const imageUrl =
        resultData.images?.[0]?.url ??
        resultData.image?.url ??
        resultData.output?.images?.[0]?.url ??
        extractImageUrl(resultData);

      if (!imageUrl) {
        throw new Error(
          `[fal-client:image] resultado sem url de imagem: ${JSON.stringify(resultData).slice(0, 500)}`,
        );
      }

      return {
        request_id: requestId,
        image_url: imageUrl,
        duration_ms: Date.now() - t0,
      };
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

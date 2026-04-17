/**
 * Cliente FAL.ai — gateway de geração de vídeo/imagem via SDK oficial.
 *
 * Delega todo o roteamento (submit, polling, result) ao @fal-ai/client,
 * eliminando a necessidade de gerenciar URLs de queue manualmente.
 *
 * Autenticação: o SDK lê automaticamente a env var FAL_KEY.
 *
 * REGRA: este módulo NÃO importa nada do domínio MrTok (schemas, agents).
 * É um cliente genérico de fila FAL.ai reutilizável.
 */
import { fal } from "@fal-ai/client";
import { getEnv } from "@/lib/env";

// ---------------------------------------------------------------------------
// Interfaces — Vídeo
// ---------------------------------------------------------------------------

export interface FalSubmitArgs {
  slug: string;
  input: Record<string, unknown>;
}

export interface FalJobResult {
  request_id: string;
  video_url: string;
  duration_ms: number;
}

// ---------------------------------------------------------------------------
// Interfaces — Imagem (Worker a3 — Nano Banana 2)
// ---------------------------------------------------------------------------

export interface FalImageJobResult {
  request_id: string;
  image_url: string;
  duration_ms: number;
}

// ---------------------------------------------------------------------------
// Inicialização do SDK (garante que FAL_KEY está configurada)
// ---------------------------------------------------------------------------

function ensureFalConfig(): void {
  const env = getEnv();
  fal.config({ credentials: env.FAL_KEY });
}

// ---------------------------------------------------------------------------
// Vídeo: submitAndPoll
// ---------------------------------------------------------------------------

/**
 * Submete um job de vídeo na fila FAL.ai via SDK e aguarda conclusão.
 */
export async function submitAndPoll(args: FalSubmitArgs): Promise<FalJobResult> {
  ensureFalConfig();
  console.log(`[fal-client] Submetendo via SDK Oficial FAL.ai: ${args.slug}`);
  const t0 = Date.now();

  try {
    const result = await fal.subscribe(args.slug, {
      input: args.input,
      logs: true,
      onQueueUpdate: (update) => {
        const elapsed = Math.round((Date.now() - t0) / 1000);
        console.log(`[fal-client:debug] status="${update.status}" (${elapsed}s)`);
      },
    });

    const elapsed = Date.now() - t0;
    console.log(`[fal-client] Job concluído em ${Math.round(elapsed / 1000)}s`);

    // Extrair video_url — o SDK retorna data com formatos variados por modelo
    const data = result.data as Record<string, unknown>;
    const videoUrl = extractVideoUrl(data);
    if (!videoUrl) {
      throw new Error(
        `[fal-client] resultado sem video_url: ${JSON.stringify(data).slice(0, 500)}`,
      );
    }

    return {
      request_id: result.requestId,
      video_url: videoUrl,
      duration_ms: elapsed,
    };
  } catch (error) {
    console.error(`[fal-client] FAL SDK Error:`, error);
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Imagem: submitAndPollImage
// ---------------------------------------------------------------------------

/**
 * Submete um job de imagem na fila FAL.ai via SDK e aguarda conclusão.
 */
export async function submitAndPollImage(
  args: FalSubmitArgs,
): Promise<FalImageJobResult> {
  ensureFalConfig();
  const t0 = Date.now();

  const result = await fal.subscribe(args.slug, {
    input: args.input,
    logs: true,
    onQueueUpdate: (update) => {
      const elapsed = Math.round((Date.now() - t0) / 1000);
      console.log(`[fal-client:image:debug] status="${update.status}" (${elapsed}s)`);
    },
  });

  const elapsed = Date.now() - t0;
  const data = result.data as Record<string, unknown>;
  const imageUrl = extractImageUrl(data);
  if (!imageUrl) {
    throw new Error(
      `[fal-client:image] resultado sem url: ${JSON.stringify(data).slice(0, 500)}`,
    );
  }

  return {
    request_id: result.requestId,
    image_url: imageUrl,
    duration_ms: elapsed,
  };
}

// ---------------------------------------------------------------------------
// Extratores genéricos de URL
// ---------------------------------------------------------------------------

interface FalVideoData {
  video?: { url?: string };
  output?: { video?: string };
  [key: string]: unknown;
}

function extractVideoUrl(data: Record<string, unknown>): string | undefined {
  const d = data as FalVideoData;
  if (d.video?.url) return d.video.url;
  if (d.output?.video) return d.output.video;
  // Fallback: busca recursiva
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

function extractImageUrl(data: Record<string, unknown>): string | undefined {
  // Formatos comuns: images[0].url, image.url, output.images[0].url
  const images = data.images as Array<{ url?: string }> | undefined;
  if (images?.[0]?.url) return images[0].url;
  const image = data.image as { url?: string } | undefined;
  if (image?.url) return image.url;
  const output = data.output as { images?: Array<{ url?: string }> } | undefined;
  if (output?.images?.[0]?.url) return output.images[0].url;
  // Fallback recursivo
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

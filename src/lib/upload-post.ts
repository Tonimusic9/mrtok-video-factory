/**
 * Cliente HTTP tipado do Upload-Post API.
 *
 * Endpoints canônicos (ver /knowledge/mrtok-reverse-engineering.md §4.1):
 *  - POST /upload_photos
 *  - GET  /api/uploadposts/status?request_id={id}
 *  - GET  /api/uploadposts/history
 *  - GET  /api/analytics/{profile}?platforms=...
 *
 * Decisão arquitetural (Tarefa 3): Upload-Post no lugar de Postiz por
 * suporte nativo a request_id tracking — elimina linking manual.
 */
import { getEnv } from "@/lib/env";
import {
  uploadPostRequestSchema,
  uploadPostResponseSchema,
  uploadPostStatusResponseSchema,
  type UploadPostPlatform,
  type UploadPostRequest,
  type UploadPostResponse,
  type UploadPostStatusResponse,
} from "@/lib/upload-post-schema";

/** Erro tipado para falhas HTTP do Upload-Post. */
export class UploadPostError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body: string,
  ) {
    super(message);
    this.name = "UploadPostError";
  }
}

function authHeaders(): Record<string, string> {
  const env = getEnv();
  return {
    "content-type": "application/json",
    authorization: `Bearer ${env.UPLOAD_POST_API_KEY}`,
  };
}

function baseUrl(): string {
  return getEnv().UPLOAD_POST_BASE_URL.replace(/\/+$/, "");
}

async function readError(res: Response): Promise<UploadPostError> {
  const body = await res.text().catch(() => "");
  return new UploadPostError(
    `Upload-Post HTTP ${res.status}`,
    res.status,
    body,
  );
}

/**
 * POST /upload_photos — submete carrossel multi-plataforma.
 * Retorna { request_id, status } (status canônico: "queued").
 */
export async function dispatchPhotos(
  payload: UploadPostRequest,
): Promise<UploadPostResponse> {
  const validated = uploadPostRequestSchema.parse(payload);
  const res = await fetch(`${baseUrl()}/upload_photos`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(validated),
  });
  if (!res.ok) throw await readError(res);
  return uploadPostResponseSchema.parse(await res.json());
}

/**
 * GET /api/uploadposts/status?request_id={id}
 */
export async function getStatus(
  requestId: string,
): Promise<UploadPostStatusResponse> {
  const url = new URL(`${baseUrl()}/api/uploadposts/status`);
  url.searchParams.set("request_id", requestId);
  const res = await fetch(url, { headers: authHeaders() });
  if (!res.ok) throw await readError(res);
  return uploadPostStatusResponseSchema.parse(await res.json());
}

/**
 * GET /api/uploadposts/history — histórico de uploads do profile.
 */
export async function getHistory(): Promise<unknown> {
  const res = await fetch(`${baseUrl()}/api/uploadposts/history`, {
    headers: authHeaders(),
  });
  if (!res.ok) throw await readError(res);
  return res.json();
}

/**
 * GET /api/analytics/{profile}?platforms=...
 * Métricas timeseries para alimentar o Agente 8 (Gemma local).
 */
export async function getAnalytics(
  profile: string,
  platforms: readonly UploadPostPlatform[],
): Promise<unknown> {
  const url = new URL(
    `${baseUrl()}/api/analytics/${encodeURIComponent(profile)}`,
  );
  url.searchParams.set("platforms", platforms.join(","));
  const res = await fetch(url, { headers: authHeaders() });
  if (!res.ok) throw await readError(res);
  return res.json();
}

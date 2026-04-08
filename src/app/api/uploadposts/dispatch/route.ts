/**
 * POST /api/uploadposts/dispatch
 *
 * Wrapper HTTP fino sobre `dispatchCreativeMatrix`. Toda a lógica
 * (gate de compliance, sanity-check, hash, persistência, Telegram)
 * vive em `src/lib/dispatch-service.ts` para reuso pelo Dashboard de QC.
 *
 * Segurança: depende do proxy.ts para guarda Tailscale.
 */
import { z } from "zod";
import { dispatchCreativeMatrix } from "@/lib/dispatch-service";
import {
  uploadPostPhotoSchema,
  uploadPostPlatformSchema,
} from "@/lib/upload-post-schema";

export const runtime = "nodejs";

const dispatchBodySchema = z.object({
  creative_matrix_id: z.string().uuid(),
  caption: z.string().min(1).max(2200),
  platforms: z.array(uploadPostPlatformSchema).min(1),
  photos: z.array(uploadPostPhotoSchema).min(1),
  schedule_iso: z.string().datetime().nullable().optional(),
});

export async function POST(req: Request) {
  if (req.headers.get("content-type")?.includes("application/json") !== true) {
    return Response.json(
      { error: "unsupported_media_type" },
      { status: 415 },
    );
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }

  const parsed = dispatchBodySchema.safeParse(raw);
  if (!parsed.success) {
    return Response.json(
      {
        error: "invalid_payload",
        issues: parsed.error.issues.map((i) => ({
          path: i.path.join("."),
          message: i.message,
        })),
      },
      { status: 422 },
    );
  }

  const result = await dispatchCreativeMatrix(parsed.data);

  if (!result.ok) {
    return Response.json(
      {
        error: result.code,
        detail: result.detail,
        upstream_status: result.upstream_status ?? null,
        upstream_body: result.upstream_body ?? null,
        request_id: result.request_id ?? null,
      },
      { status: result.http_status },
    );
  }

  return Response.json(
    {
      ok: true,
      request_id: result.request_id,
      hook_performance_id: result.hook_performance_id,
      unique_pixel_hash: result.unique_pixel_hash,
    },
    { status: 202 },
  );
}

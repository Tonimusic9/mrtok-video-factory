/**
 * GET /api/uploadposts/status?request_id={id}
 *
 * Proxy thin para o endpoint canônico do Upload-Post. Sem persistência —
 * o loop de coleta de métricas é responsabilidade do Agente 8 (Tarefa
 * posterior). Esta rota existe para o Dashboard de QC consultar o
 * status de um dispatch on-demand.
 */
import { getStatus, UploadPostError } from "@/lib/upload-post";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const requestId = url.searchParams.get("request_id");
  if (!requestId) {
    return Response.json(
      { error: "missing_request_id" },
      { status: 400 },
    );
  }

  try {
    const status = await getStatus(requestId);
    return Response.json({ ok: true, status });
  } catch (err) {
    const isHttp = err instanceof UploadPostError;
    return Response.json(
      {
        error: "upload_post_status_failed",
        detail: (err as Error).message,
        upstream_status: isHttp ? err.status : null,
        upstream_body: isHttp ? err.body : null,
      },
      { status: isHttp ? 502 : 500 },
    );
  }
}

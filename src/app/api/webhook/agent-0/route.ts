/**
 * Webhook do Agente 0 (Curador de Winners · Minimax 2.7).
 *
 * Recebe o gatilho mobile do Swipe File — um produto candidato minerado
 * manualmente ou por bookmarklet — e enfileira uma task na `task_queue`
 * para que o Agente CEO inicie o pipeline completo (a0 → a1 → a2 → a3 → ...).
 *
 * Segurança: o middleware (src/middleware.ts) já bloqueia IPs fora do range
 * Tailscale quando READ_ONLY_MODE=true. Esta route assume que quem chega
 * aqui já passou pela verificação de IP.
 */
import { z } from "zod";
import { getSupabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";

const swipeFilePayloadSchema = z.object({
  project_id: z.string().min(1),
  source_url: z.string().url(),
  product_title: z.string().min(1),
  product_category: z.enum([
    "home",
    "beauty",
    "fitness",
    "productivity",
    "food",
    "other",
  ]),
  /** URL do vídeo viral de referência a ser decupado pelo Agente 1. */
  reference_video_url: z.string().url().optional(),
  /** Notas livres do operador que minerou o produto. */
  operator_notes: z.string().max(2000).optional(),
});

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }

  const parsed = swipeFilePayloadSchema.safeParse(body);
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

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("task_queue")
    .insert({
      project_id: parsed.data.project_id,
      agent: "a0",
      payload: parsed.data,
    })
    .select("id, status, created_at")
    .single();

  if (error) {
    return Response.json(
      { error: "enqueue_failed", detail: error.message },
      { status: 500 },
    );
  }

  return Response.json(
    {
      ok: true,
      task_id: data.id,
      status: data.status,
      enqueued_at: data.created_at,
    },
    { status: 202 },
  );
}

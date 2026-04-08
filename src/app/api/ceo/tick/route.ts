/**
 * POST /api/ceo/tick
 *
 * Endpoint do Agente CEO acionado por cron externo (Hostinger → curl
 * via Tailscale). Toda lógica vive em `src/lib/ceo-orchestrator.ts`.
 *
 * Segurança em duas camadas:
 *  1. proxy.ts já restringe /api/* ao range Tailscale.
 *  2. Header `x-ceo-secret` precisa bater com env CEO_TICK_SECRET.
 */
import { z } from "zod";
import { getEnv } from "@/lib/env";
import { runCeoTick } from "@/lib/ceo-orchestrator";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const tickBodySchema = z
  .object({
    maxTasks: z.number().int().min(1).max(20).optional(),
  })
  .optional();

export async function POST(req: Request) {
  const env = getEnv();

  const provided = req.headers.get("x-ceo-secret");
  if (!provided || provided !== env.CEO_TICK_SECRET) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  let raw: unknown = undefined;
  if (req.headers.get("content-type")?.includes("application/json")) {
    try {
      raw = await req.json();
    } catch {
      return Response.json({ error: "invalid_json" }, { status: 400 });
    }
  }

  const parsed = tickBodySchema.safeParse(raw);
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

  try {
    const result = await runCeoTick({ maxTasks: parsed.data?.maxTasks });
    return Response.json({ ok: true, ...result }, { status: 200 });
  } catch (err) {
    return Response.json(
      { error: "ceo_tick_failed", detail: (err as Error).message },
      { status: 500 },
    );
  }
}

/**
 * Health check — liberado pelo middleware mesmo com READ_ONLY_MODE.
 * Não acessa banco, não valida env, responde sempre 200.
 */
export const runtime = "nodejs";

export function GET() {
  return Response.json({
    ok: true,
    service: "mrtok",
    ts: new Date().toISOString(),
  });
}

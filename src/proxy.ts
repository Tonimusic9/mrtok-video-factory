/**
 * Proxy global (Next 16) — sucessor canônico do antigo `middleware.ts`.
 *
 * Restringe /api/* ao range Tailscale da VPS Hostinger quando
 * READ_ONLY_MODE=true. /api/health é sempre permitido.
 *
 * Ver CLAUDE.md §4 — Segurança da VPS, portas públicas bloqueadas.
 */
import { NextResponse, type NextRequest } from "next/server";
import { getClientIp, isAllowedIp } from "@/lib/security";

export const config = {
  matcher: ["/api/:path*"],
};

export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (pathname === "/api/health") {
    return NextResponse.next();
  }

  const readOnly = (process.env.READ_ONLY_MODE ?? "true") === "true";
  if (!readOnly) return NextResponse.next();

  const allowedCsv = process.env.ALLOWED_IPS ?? "";
  const clientIp = getClientIp(req.headers);

  if (!isAllowedIp(clientIp, allowedCsv)) {
    return NextResponse.json(
      {
        error: "forbidden",
        reason: "IP fora do range Tailscale autorizado (READ_ONLY_MODE)",
      },
      { status: 403 },
    );
  }

  return NextResponse.next();
}

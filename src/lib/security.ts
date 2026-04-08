/**
 * Utilitários de segurança — restrição de acesso às rotas /api/* ao range
 * Tailscale da VPS Hostinger. Consumido pelo middleware e API routes.
 * Ver CLAUDE.md §4 — portas públicas bloqueadas, sandbox OpenClaw.
 */

/**
 * Converte um IPv4 ("a.b.c.d") em inteiro de 32 bits.
 * Retorna null para entradas inválidas.
 */
function ipv4ToInt(ip: string): number | null {
  const parts = ip.trim().split(".");
  if (parts.length !== 4) return null;
  let acc = 0;
  for (const p of parts) {
    const n = Number(p);
    if (!Number.isInteger(n) || n < 0 || n > 255) return null;
    acc = (acc << 8) + n;
  }
  return acc >>> 0;
}

/**
 * Verifica se `ip` pertence a `entry`, onde entry pode ser:
 *  - IP exato ("100.72.40.35")
 *  - CIDR IPv4 ("100.64.0.0/10")
 */
function matchEntry(ip: string, entry: string): boolean {
  const trimmed = entry.trim();
  if (!trimmed) return false;
  if (!trimmed.includes("/")) return trimmed === ip;

  const [cidrIp, bitsStr] = trimmed.split("/");
  const bits = Number(bitsStr);
  if (!Number.isInteger(bits) || bits < 0 || bits > 32) return false;

  const ipInt = ipv4ToInt(ip);
  const cidrInt = ipv4ToInt(cidrIp);
  if (ipInt == null || cidrInt == null) return false;

  if (bits === 0) return true;
  const mask = (~0 << (32 - bits)) >>> 0;
  return (ipInt & mask) === (cidrInt & mask);
}

/**
 * Retorna true se `ip` estiver em algum dos entries CSV de ALLOWED_IPS.
 */
export function isAllowedIp(ip: string | null, allowedCsv: string): boolean {
  if (!ip) return false;
  const normalized = ip.replace(/^::ffff:/, ""); // mapeado IPv4
  return allowedCsv
    .split(",")
    .some((entry) => matchEntry(normalized, entry));
}

/**
 * Extrai o IP do cliente a partir dos headers padrão de proxy.
 */
export function getClientIp(headers: Headers): string | null {
  const xff = headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0]!.trim();
  return headers.get("x-real-ip");
}

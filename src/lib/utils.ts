/**
 * Helpers de UI compartilhados.
 */
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Combina classes Tailwind de forma segura, resolvendo conflitos de
 * classes utilitárias (ex: `px-2 px-4` vira `px-4`).
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/**
 * Formata números grandes em abreviações compactas (1.2K, 3.4M).
 */
export function formatCompactNumber(n: number): string {
  if (!Number.isFinite(n)) return "0";
  const abs = Math.abs(n);
  if (abs >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString("pt-BR", { maximumFractionDigits: 0 });
}

/**
 * Formata uma razão 0–1 como percentual com 2 casas.
 */
export function formatPercent(ratio: number): string {
  if (!Number.isFinite(ratio)) return "0.00%";
  return `${(ratio * 100).toFixed(2)}%`;
}

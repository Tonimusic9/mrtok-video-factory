/**
 * /qc/larry-loop — Matriz 2x2 do Larry Loop sobre `hook_performance`.
 *
 * Ver dossiê §2.3 (knowledge/mrtok-reverse-engineering.md):
 *
 *   | Views\Conv | Alto              | Baixo                       |
 *   | Alto       | Escalar variações | Revisar CTA                 |
 *   | Baixo      | Hooks mais fortes | Reset completo de estratégia |
 *
 * Thresholds canônicos:
 *   - Views altas: views_3s >= 5000
 *   - Conversão alta: conversions / views_3s >= 0.015 (1.5%)
 */
import { getSupabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const VIEWS_HIGH_THRESHOLD = 5000;
const CONV_HIGH_THRESHOLD = 0.015;

type Quadrant =
  | "high_views_high_conv"
  | "high_views_low_conv"
  | "low_views_high_conv"
  | "low_views_low_conv";

interface Bucket {
  label: string;
  action: string;
  rows: Array<{
    id: string;
    request_id: string | null;
    views_3s: number;
    conversions: number;
    rate: number;
  }>;
}

function classify(views: number, conversions: number): Quadrant {
  const rate = views > 0 ? conversions / views : 0;
  const highViews = views >= VIEWS_HIGH_THRESHOLD;
  const highConv = rate >= CONV_HIGH_THRESHOLD;
  if (highViews && highConv) return "high_views_high_conv";
  if (highViews && !highConv) return "high_views_low_conv";
  if (!highViews && highConv) return "low_views_high_conv";
  return "low_views_low_conv";
}

export default async function LarryLoopPage() {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("hook_performance")
    .select("id, request_id, views_3s, conversions")
    .order("measured_at", { ascending: false })
    .limit(500);

  if (error) {
    return (
      <div className="text-red-400">
        Erro ao carregar hook_performance: {error.message}
      </div>
    );
  }

  const buckets: Record<Quadrant, Bucket> = {
    high_views_high_conv: {
      label: "▲ Views · ▲ Conversão",
      action: "Escalar variações vencedoras",
      rows: [],
    },
    high_views_low_conv: {
      label: "▲ Views · ▼ Conversão",
      action: "Revisar CTA / pós-clique",
      rows: [],
    },
    low_views_high_conv: {
      label: "▼ Views · ▲ Conversão",
      action: "Testar hooks mais fortes (manter CTA)",
      rows: [],
    },
    low_views_low_conv: {
      label: "▼ Views · ▼ Conversão",
      action: "Reset completo de estratégia",
      rows: [],
    },
  };

  for (const row of data ?? []) {
    const q = classify(row.views_3s, row.conversions);
    buckets[q].rows.push({
      id: row.id,
      request_id: row.request_id,
      views_3s: row.views_3s,
      conversions: row.conversions,
      rate: row.views_3s > 0 ? row.conversions / row.views_3s : 0,
    });
  }

  const quadrants: Quadrant[] = [
    "high_views_high_conv",
    "high_views_low_conv",
    "low_views_high_conv",
    "low_views_low_conv",
  ];

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold">Larry Loop · 2×2</h2>
        <p className="text-sm text-zinc-400 mt-1">
          Thresholds: views ≥ {VIEWS_HIGH_THRESHOLD.toLocaleString("pt-BR")}{" "}
          · conv ≥ {(CONV_HIGH_THRESHOLD * 100).toFixed(1)}%. Janela: últimas
          500 medições.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {quadrants.map((q) => {
          const b = buckets[q];
          return (
            <div
              key={q}
              className="border border-zinc-800 rounded-lg p-4 bg-zinc-950"
            >
              <div className="flex items-center justify-between mb-2">
                <div className="font-semibold">{b.label}</div>
                <div className="text-xs text-zinc-500">{b.rows.length}</div>
              </div>
              <div className="text-xs text-zinc-400 mb-3">{b.action}</div>
              <ul className="text-xs space-y-1 max-h-48 overflow-auto">
                {b.rows.length === 0 && (
                  <li className="text-zinc-600">— sem dados —</li>
                )}
                {b.rows.slice(0, 20).map((r) => (
                  <li
                    key={r.id}
                    className="font-mono flex justify-between gap-2"
                  >
                    <span className="truncate">
                      {r.request_id ?? r.id.slice(0, 8)}
                    </span>
                    <span className="text-zinc-500">
                      {r.views_3s.toLocaleString("pt-BR")} ·{" "}
                      {(r.rate * 100).toFixed(1)}%
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
    </div>
  );
}

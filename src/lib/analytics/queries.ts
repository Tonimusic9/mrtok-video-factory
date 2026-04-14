/**
 * Queries server-side para o Dashboard de Analytics.
 *
 * - Lê direto de `hook_performance` ⋈ `creative_matrix` via service-role.
 * - NUNCA usar do client — somente Server Components / Route Handlers.
 * - Calcula engagement localmente (SQL estendido indisponível na tipagem
 *   gerada, usamos fetch + redução em JS).
 *
 * Observação: a tipagem gerada em `src/types/database.generated.ts` pode
 * não refletir as colunas adicionadas em migration 0002 (views/likes/
 * comments/shares/collection_date). Usamos casts pontuais nesses pontos.
 */
import { getSupabaseAdmin } from "@/lib/supabase";

// ---------------------------------------------------------------------------
// Tipos públicos
// ---------------------------------------------------------------------------

export interface KpiSummary {
  totalVideos: number;
  totalViews: number;
  totalLikes: number;
  totalEngagements: number;
  avgViewsPerVideo: number;
  avgEngagementRate: number; // 0..1
  windowDays: number;
}

export interface VideoPerformanceRow {
  creativeMatrixId: string;
  projectId: string;
  title: string;
  thumbnailUrl: string | null;
  views: number;
  likes: number;
  comments: number;
  shares: number;
  engagementRate: number; // 0..1
  engagementScore: number; // 0..100 (percentil dentro do conjunto)
  lastCollectedAt: string | null;
  rank: number;
}

export type VideoSortBy =
  | "most_views"
  | "most_likes"
  | "most_comments"
  | "most_shares"
  | "engagement"
  | "newest";

export interface VideoQueryOptions {
  windowDays?: number;
  sortBy?: VideoSortBy;
  limit?: number;
}

// ---------------------------------------------------------------------------
// Shapes internos (Supabase bruto)
// ---------------------------------------------------------------------------

interface RawHookPerfRow {
  creative_matrix_id: string;
  views: number;
  likes: number;
  comments: number;
  shares: number;
  collection_date: string;
  creative_matrix: {
    id: string;
    project_id: string;
    metadata: Record<string, unknown> | null;
    created_at: string;
  } | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function windowStartISO(windowDays: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - windowDays);
  return d.toISOString().slice(0, 10); // YYYY-MM-DD
}

function safeRatio(numerator: number, denominator: number): number {
  if (!denominator || denominator <= 0) return 0;
  return numerator / denominator;
}

function extractTitle(metadata: Record<string, unknown> | null): string {
  if (!metadata) return "Vídeo sem título";
  const candidate =
    (metadata.title as string | undefined) ??
    (metadata.display_name as string | undefined) ??
    (metadata.hook_primary as string | undefined) ??
    (metadata.slug as string | undefined);
  return candidate?.trim() || "Vídeo sem título";
}

function extractThumbnail(
  metadata: Record<string, unknown> | null,
): string | null {
  if (!metadata) return null;
  const candidate =
    (metadata.thumbnail_url as string | undefined) ??
    (metadata.thumbnail as string | undefined) ??
    (metadata.cover_url as string | undefined) ??
    (metadata.preview_url as string | undefined);
  return candidate?.trim() || null;
}

// ---------------------------------------------------------------------------
// Query 1 — KPI Summary (topo do dashboard)
// ---------------------------------------------------------------------------

export async function getKpiSummary(
  windowDays = 14,
): Promise<KpiSummary> {
  const supabase = getSupabaseAdmin();
  const fromDate = windowStartISO(windowDays);

  // biome-ignore lint: usamos any local porque as colunas da migration 0002
  // não estão nos tipos gerados ainda (views/likes/comments/shares).
  const { data, error } = await (supabase as any)
    .from("hook_performance")
    .select("creative_matrix_id, views, likes, comments, shares")
    .gte("collection_date", fromDate);

  if (error) {
    console.error("[analytics.getKpiSummary] supabase error:", error);
    return emptyKpi(windowDays);
  }

  const rows = (data ?? []) as Array<{
    creative_matrix_id: string | null;
    views: number | null;
    likes: number | null;
    comments: number | null;
    shares: number | null;
  }>;

  if (rows.length === 0) return emptyKpi(windowDays);

  const distinctVideos = new Set<string>();
  let totalViews = 0;
  let totalLikes = 0;
  let totalComments = 0;
  let totalShares = 0;

  for (const r of rows) {
    if (r.creative_matrix_id) distinctVideos.add(r.creative_matrix_id);
    totalViews += r.views ?? 0;
    totalLikes += r.likes ?? 0;
    totalComments += r.comments ?? 0;
    totalShares += r.shares ?? 0;
  }

  const totalEngagements = totalLikes + totalComments + totalShares;
  const totalVideos = distinctVideos.size;

  return {
    totalVideos,
    totalViews,
    totalLikes,
    totalEngagements,
    avgViewsPerVideo: totalVideos === 0 ? 0 : Math.round(totalViews / totalVideos),
    avgEngagementRate: safeRatio(totalEngagements, totalViews),
    windowDays,
  };
}

function emptyKpi(windowDays: number): KpiSummary {
  return {
    totalVideos: 0,
    totalViews: 0,
    totalLikes: 0,
    totalEngagements: 0,
    avgViewsPerVideo: 0,
    avgEngagementRate: 0,
    windowDays,
  };
}

// ---------------------------------------------------------------------------
// Query 2 — Video Performance Grid
// ---------------------------------------------------------------------------

export async function aggregateVideoPerformance(
  opts: VideoQueryOptions = {},
): Promise<VideoPerformanceRow[]> {
  const { windowDays = 14, sortBy = "most_views", limit = 24 } = opts;
  const supabase = getSupabaseAdmin();
  const fromDate = windowStartISO(windowDays);

  // biome-ignore lint: colunas da migration 0002 fora da tipagem gerada.
  const { data, error } = await (supabase as any)
    .from("hook_performance")
    .select(
      `creative_matrix_id,
       views,
       likes,
       comments,
       shares,
       collection_date,
       creative_matrix:creative_matrix_id ( id, project_id, metadata, created_at )`,
    )
    .gte("collection_date", fromDate)
    .not("creative_matrix_id", "is", null);

  if (error) {
    console.error("[analytics.aggregateVideoPerformance] supabase error:", error);
    return [];
  }

  const rawRows = (data ?? []) as RawHookPerfRow[];
  if (rawRows.length === 0) return [];

  // Agrega por creative_matrix_id — última snapshot vence para
  // views/likes/comments/shares (cada coleta é cumulativa do TikTok).
  const byId = new Map<
    string,
    {
      cm: RawHookPerfRow["creative_matrix"];
      views: number;
      likes: number;
      comments: number;
      shares: number;
      lastDate: string;
    }
  >();

  for (const r of rawRows) {
    const id = r.creative_matrix_id;
    if (!id) continue;
    const existing = byId.get(id);
    if (!existing) {
      byId.set(id, {
        cm: r.creative_matrix,
        views: r.views ?? 0,
        likes: r.likes ?? 0,
        comments: r.comments ?? 0,
        shares: r.shares ?? 0,
        lastDate: r.collection_date,
      });
      continue;
    }
    // Fica com a snapshot mais recente (maior collection_date).
    if (r.collection_date > existing.lastDate) {
      existing.views = r.views ?? 0;
      existing.likes = r.likes ?? 0;
      existing.comments = r.comments ?? 0;
      existing.shares = r.shares ?? 0;
      existing.lastDate = r.collection_date;
    }
  }

  // Projeta em linhas + engagementRate.
  const projected = Array.from(byId.entries()).map(([id, agg]) => {
    const views = agg.views;
    const engagements = agg.likes + agg.comments + agg.shares;
    const engagementRate = safeRatio(engagements, views);
    return {
      creativeMatrixId: id,
      projectId: agg.cm?.project_id ?? "unknown",
      title: extractTitle(agg.cm?.metadata ?? null),
      thumbnailUrl: extractThumbnail(agg.cm?.metadata ?? null),
      views,
      likes: agg.likes,
      comments: agg.comments,
      shares: agg.shares,
      engagementRate,
      engagementScore: 0, // preenchido abaixo (percentil)
      lastCollectedAt: agg.lastDate ?? null,
    };
  });

  // Engagement score = percentil de engagementRate dentro do conjunto,
  // em 0..100. Empates ganham o mesmo rank-percentil.
  const sortedByRate = [...projected].sort(
    (a, b) => a.engagementRate - b.engagementRate,
  );
  const n = sortedByRate.length;
  sortedByRate.forEach((row, idx) => {
    // rank-percentile clássico: (idx+1)/n → 0..100
    const pct = Math.round(((idx + 1) / n) * 100);
    row.engagementScore = pct;
  });

  // Sort final segundo opts.
  const sorted = [...projected];
  switch (sortBy) {
    case "most_likes":
      sorted.sort((a, b) => b.likes - a.likes);
      break;
    case "most_comments":
      sorted.sort((a, b) => b.comments - a.comments);
      break;
    case "most_shares":
      sorted.sort((a, b) => b.shares - a.shares);
      break;
    case "engagement":
      sorted.sort((a, b) => b.engagementScore - a.engagementScore);
      break;
    case "newest":
      sorted.sort((a, b) =>
        (b.lastCollectedAt ?? "").localeCompare(a.lastCollectedAt ?? ""),
      );
      break;
    case "most_views":
    default:
      sorted.sort((a, b) => b.views - a.views);
      break;
  }

  return sorted.slice(0, limit).map((row, idx) => ({ ...row, rank: idx + 1 }));
}

// ---------------------------------------------------------------------------
// Query 3 — Leads Summary (Topo do Funil — Worker a0)
// ---------------------------------------------------------------------------

export interface LeadsSummary {
  totalLeads: number;
  pending: number;
  queued: number;
  processed: number;
  avgViralScore: number;
}

export async function getLeadsSummary(): Promise<LeadsSummary> {
  const supabase = getSupabaseAdmin();

  const { data, error } = await (supabase as any)
    .from("product_leads")
    .select("status, viral_score, engagement_score");

  if (error) {
    console.error("[analytics.getLeadsSummary] supabase error:", error);
    return { totalLeads: 0, pending: 0, queued: 0, processed: 0, avgViralScore: 0 };
  }

  const rows = (data ?? []) as Array<{
    status: string;
    viral_score: number | null;
    engagement_score: number | null;
  }>;
  if (rows.length === 0) {
    return { totalLeads: 0, pending: 0, queued: 0, processed: 0, avgViralScore: 0 };
  }

  let pending = 0;
  let queued = 0;
  let processed = 0;
  let totalScore = 0;

  for (const r of rows) {
    if (r.status === "pending") pending++;
    else if (r.status === "processed") processed++;
    totalScore += r.viral_score ?? r.engagement_score ?? 0;
  }

  return {
    totalLeads: rows.length,
    pending,
    queued,
    processed,
    avgViralScore: Math.round(totalScore / rows.length),
  };
}

import { Suspense } from "react";
import { Video, Eye, Heart, TrendingUp, Search, Zap } from "lucide-react";
import { getKpiSummary, getLeadsSummary } from "@/lib/analytics/queries";
import { getSupabaseAdmin } from "@/lib/supabase";
import { KpiCard, KpiCardSkeleton } from "@/components/analytics/kpi-card";
import { Badge } from "@/components/ui/badge";

export const dynamic = "force-dynamic";

async function checkSupabaseConnection(): Promise<boolean> {
  try {
    const sb = getSupabaseAdmin();
    const { error } = await (sb as any)
      .from("hook_performance")
      .select("creative_matrix_id", { count: "exact", head: true });
    return !error;
  } catch {
    return false;
  }
}

async function KpiGrid() {
  const kpi = await getKpiSummary(14);

  const engagementPct =
    kpi.avgEngagementRate > 0
      ? `${(kpi.avgEngagementRate * 100).toFixed(1)}%`
      : "0%";

  return (
    <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <KpiCard
        title="Total Videos"
        value={kpi.totalVideos}
        icon={Video}
        iconColor="text-info"
      />
      <KpiCard
        title="Total Views"
        value={kpi.totalViews}
        icon={Eye}
        iconColor="text-success"
      />
      <KpiCard
        title="Total Likes"
        value={kpi.totalLikes}
        icon={Heart}
        iconColor="text-primary"
      />
      <KpiCard
        title="Engagement Rate"
        value={engagementPct}
        icon={TrendingUp}
        subtitle={`${kpi.avgViewsPerVideo.toLocaleString("pt-BR")} views/video`}
        iconColor="text-warning"
      />
    </section>
  );
}

async function LeadsGrid() {
  const leads = await getLeadsSummary();

  return (
    <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <KpiCard
        title="Leads Capturados"
        value={leads.totalLeads}
        icon={Search}
        subtitle={`${leads.pending} pendentes`}
        iconColor="text-info"
      />
      <KpiCard
        title="Na Fila (a1)"
        value={leads.queued}
        icon={Zap}
        subtitle={`${leads.processed} processados`}
        iconColor="text-warning"
      />
      <KpiCard
        title="Viral Score Medio"
        value={leads.avgViralScore > 0 ? `${leads.avgViralScore}/100` : "--"}
        icon={TrendingUp}
        iconColor="text-primary"
      />
    </section>
  );
}

function KpiGridSkeleton() {
  return (
    <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {Array.from({ length: 4 }).map((_, i) => (
        <KpiCardSkeleton key={i} />
      ))}
    </section>
  );
}

function LeadsGridSkeleton() {
  return (
    <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: 3 }).map((_, i) => (
        <KpiCardSkeleton key={i} />
      ))}
    </section>
  );
}

export default async function AnalyticsPage() {
  const connected = await checkSupabaseConnection();

  return (
    <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <header className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            Analytics
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Performance dos ultimos 14 dias
          </p>
        </div>
        <Badge
          variant={connected ? "outline" : "destructive"}
          className={
            connected
              ? "border-success/30 bg-success/10 text-success"
              : undefined
          }
        >
          {connected ? "Supabase Admin OK" : "Supabase Offline"}
        </Badge>
      </header>

      <Suspense fallback={<KpiGridSkeleton />}>
        <KpiGrid />
      </Suspense>

      <div className="mt-10">
        <h2 className="mb-4 text-lg font-semibold text-foreground">
          Top of Funnel — Worker a0
        </h2>
        <Suspense fallback={<LeadsGridSkeleton />}>
          <LeadsGrid />
        </Suspense>
      </div>
    </main>
  );
}

/**
 * /qc/[id] — detalhe da Matriz Criativa para revisão e dispatch.
 *
 * Mostra hooks_matrix, storyboard e formulário de aprovação +
 * dispatch (DispatchForm client component).
 */
import { notFound } from "next/navigation";
import Link from "next/link";
import { getSupabaseAdmin } from "@/lib/supabase";
import { DispatchForm } from "./dispatch-form";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function QCDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = getSupabaseAdmin();
  const { data: matrix, error } = await supabase
    .from("creative_matrix")
    .select("*")
    .eq("id", id)
    .single();

  if (error || !matrix) notFound();

  return (
    <div className="space-y-6">
      <div>
        <Link href="/qc" className="text-sm text-zinc-400 hover:text-zinc-100">
          ← Voltar
        </Link>
        <h2 className="text-xl font-semibold mt-2">{matrix.project_id}</h2>
        <div className="text-xs text-zinc-500 font-mono">{matrix.id}</div>
        <div className="text-xs text-zinc-400 mt-1">
          Status:{" "}
          {matrix.compliance_approved ? (
            <span className="text-emerald-400">✓ aprovado</span>
          ) : (
            <span className="text-amber-400">pendente</span>
          )}
        </div>
      </div>

      <section>
        <h3 className="text-sm uppercase tracking-wide text-zinc-500 mb-2">
          Metadata
        </h3>
        <pre className="bg-zinc-900 border border-zinc-800 rounded p-3 text-xs overflow-auto">
          {JSON.stringify(matrix.metadata, null, 2)}
        </pre>
      </section>

      <section>
        <h3 className="text-sm uppercase tracking-wide text-zinc-500 mb-2">
          Hooks Matrix
        </h3>
        <pre className="bg-zinc-900 border border-zinc-800 rounded p-3 text-xs overflow-auto">
          {JSON.stringify(matrix.hooks_matrix, null, 2)}
        </pre>
      </section>

      <section>
        <h3 className="text-sm uppercase tracking-wide text-zinc-500 mb-2">
          Storyboard
        </h3>
        <pre className="bg-zinc-900 border border-zinc-800 rounded p-3 text-xs overflow-auto">
          {JSON.stringify(matrix.storyboard, null, 2)}
        </pre>
      </section>

      <section>
        <h3 className="text-sm uppercase tracking-wide text-zinc-500 mb-2">
          Aprovar e Disparar
        </h3>
        <DispatchForm creativeMatrixId={matrix.id} />
      </section>
    </div>
  );
}

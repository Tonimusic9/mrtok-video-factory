/**
 * /qc — lista de Matrizes Criativas pendentes de aprovação.
 *
 * Fonte: `creative_matrix where compliance_approved = false`.
 * O operador clica em uma row para ir ao detalhe e disparar.
 */
import Link from "next/link";
import { getSupabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function QCListPage() {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("creative_matrix")
    .select("id, project_id, created_at, compliance_approved, persona_id")
    .eq("compliance_approved", false)
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) {
    return (
      <div className="text-red-400">
        Erro ao carregar fila de QC: {error.message}
      </div>
    );
  }

  if (!data || data.length === 0) {
    return (
      <div className="text-zinc-400">
        Nenhuma Matriz Criativa pendente de aprovação. ✨
      </div>
    );
  }

  return (
    <div>
      <h2 className="text-xl font-semibold mb-4">
        Pendentes de aprovação ({data.length})
      </h2>
      <ul className="divide-y divide-zinc-800 border border-zinc-800 rounded-lg overflow-hidden">
        {data.map((row) => (
          <li key={row.id}>
            <Link
              href={`/qc/${row.id}`}
              className="block px-4 py-3 hover:bg-zinc-900 transition"
            >
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-medium">{row.project_id}</div>
                  <div className="text-xs text-zinc-500 font-mono">
                    {row.id}
                  </div>
                </div>
                <div className="text-xs text-zinc-400">
                  {new Date(row.created_at).toLocaleString("pt-BR")}
                </div>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

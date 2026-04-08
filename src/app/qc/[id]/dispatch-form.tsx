"use client";

/**
 * Formulário client-side para aprovar + disparar uma Matriz Criativa.
 * Usa `useFormState` (React 19) para feedback imediato sem JS framework.
 */
import { useActionState } from "react";
import {
  approveAndDispatch,
  type ActionState,
} from "@/app/qc/[id]/actions";

const PLATFORMS = [
  "tiktok",
  "instagram",
  "youtube",
  "linkedin",
  "x",
  "threads",
  "pinterest",
  "reddit",
  "bluesky",
] as const;

const initial: ActionState = { status: "idle" };

const PHOTOS_PLACEHOLDER = `[
  { "order": 1, "url": "https://.../slide-1.png" },
  { "order": 2, "url": "https://.../slide-2.png" },
  { "order": 3, "url": "https://.../slide-3.png" },
  { "order": 4, "url": "https://.../slide-4.png" },
  { "order": 5, "url": "https://.../slide-5.png" },
  { "order": 6, "url": "https://.../slide-6.png" }
]`;

export function DispatchForm({ creativeMatrixId }: { creativeMatrixId: string }) {
  const [state, formAction, pending] = useActionState(
    approveAndDispatch,
    initial,
  );

  return (
    <form action={formAction} className="space-y-4">
      <input
        type="hidden"
        name="creative_matrix_id"
        value={creativeMatrixId}
      />

      {/* Lembrete human-in-the-loop (Larry skill canônica) */}
      <div className="border border-amber-700/50 bg-amber-950/30 text-amber-200 p-3 rounded text-sm">
        <strong>⚠ Áudio Trending (human-in-the-loop):</strong> após o
        dispatch, abra o TikTok no celular, edite o draft e adicione um
        áudio em alta dentro de 30s. Isso amplifica drasticamente o
        alcance algorítmico (ver dossiê §4.4).
      </div>

      <div>
        <label className="block text-sm text-zinc-400 mb-1">Caption</label>
        <textarea
          name="caption"
          required
          rows={3}
          maxLength={2200}
          className="w-full bg-zinc-900 border border-zinc-800 rounded p-2 text-sm"
          placeholder="tipo assim... descobri isso ontem 😅 #fyp #brasil"
        />
      </div>

      <div>
        <label className="block text-sm text-zinc-400 mb-1">
          Notas de compliance (opcional)
        </label>
        <input
          type="text"
          name="compliance_notes"
          maxLength={2000}
          className="w-full bg-zinc-900 border border-zinc-800 rounded p-2 text-sm"
        />
      </div>

      <div>
        <label className="block text-sm text-zinc-400 mb-1">Plataformas</label>
        <div className="flex flex-wrap gap-3">
          {PLATFORMS.map((p) => (
            <label key={p} className="flex items-center gap-1 text-sm">
              <input
                type="checkbox"
                name="platforms"
                value={p}
                defaultChecked={p === "tiktok" || p === "instagram"}
              />
              {p}
            </label>
          ))}
        </div>
      </div>

      <div>
        <label className="block text-sm text-zinc-400 mb-1">
          Photos (JSON array — Tarefa 6 vai automatizar)
        </label>
        <textarea
          name="photos_json"
          required
          rows={8}
          className="w-full bg-zinc-900 border border-zinc-800 rounded p-2 text-xs font-mono"
          placeholder={PHOTOS_PLACEHOLDER}
        />
      </div>

      <button
        type="submit"
        disabled={pending}
        className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-semibold px-4 py-2 rounded"
      >
        {pending ? "Disparando..." : "✓ Aprovar e Disparar"}
      </button>

      {state.status === "ok" && (
        <div className="text-emerald-400 text-sm">
          🚀 Dispatch enviado · {state.message}
        </div>
      )}
      {state.status === "error" && (
        <div className="text-red-400 text-sm">⚠ {state.message}</div>
      )}
    </form>
  );
}

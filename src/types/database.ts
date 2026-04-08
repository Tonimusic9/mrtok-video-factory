/**
 * Tipagens das tabelas Supabase.
 *
 * A interface `Database` é gerada automaticamente via
 * `supabase gen types typescript --project-id <ref> --schema public`
 * e salva em `database.generated.ts` — NÃO EDITAR manualmente.
 *
 * Este arquivo re-exporta o `Database` gerado + alias semânticos usados
 * pelo resto do código MrTok.
 */
import type { Database as GeneratedDatabase } from "./database.generated";

export type Database = GeneratedDatabase;
export type { Json } from "./database.generated";

// --- Enums ------------------------------------------------------------------
export type TaskStatus = Database["public"]["Enums"]["task_status"];
export type TaskAgent = Database["public"]["Enums"]["task_agent"];

// --- Row aliases ------------------------------------------------------------
type Tables = Database["public"]["Tables"];
export type PersonaRow = Tables["personas"]["Row"];
export type FormatRow = Tables["formats"]["Row"];
export type SceneLibraryRow = Tables["scene_library"]["Row"];
export type TaskQueueRow = Tables["task_queue"]["Row"];
export type CreativeMatrixRow = Tables["creative_matrix"]["Row"];
export type HookPerformanceRow = Tables["hook_performance"]["Row"];

// --- Shapes auxiliares (JSON convertido em tipo de alto nível) -------------
export interface ConsistencyLocks {
  subject: string;
  angle: string;
  lighting: string;
  background: string;
}

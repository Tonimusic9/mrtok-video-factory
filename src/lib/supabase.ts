/**
 * Clientes Supabase tipados.
 *
 *  - `getSupabaseAnon()`  : leitura pública (anon key). Usar em client components.
 *  - `getSupabaseAdmin()` : service role. SOMENTE server-side (API routes, scripts).
 *                            Nunca expor ao browser.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getEnv } from "@/lib/env";
import type { Database } from "@/types/database";

let anonClient: SupabaseClient<Database> | null = null;
let adminClient: SupabaseClient<Database> | null = null;

export function getSupabaseAnon(): SupabaseClient<Database> {
  if (anonClient) return anonClient;
  const env = getEnv();
  anonClient = createClient<Database>(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
    auth: { persistSession: false },
  });
  return anonClient;
}

export function getSupabaseAdmin(): SupabaseClient<Database> {
  if (adminClient) return adminClient;
  const env = getEnv();
  adminClient = createClient<Database>(
    env.SUPABASE_URL,
    env.SUPABASE_SERVICE_ROLE_KEY,
    {
      auth: { persistSession: false, autoRefreshToken: false },
    },
  );
  return adminClient;
}

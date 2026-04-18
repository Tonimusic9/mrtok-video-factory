/**
 * Pré-voo A3 — SELECT-only. Zero escrita, zero FAL, zero Gemini.
 * Uso: npx tsx scripts/preflight-a3.ts
 */
import { config } from "dotenv";
config({ path: ".env.local" });
import { createClient } from "@supabase/supabase-js";

const TARGET_LEAD = "6705d973-90b6-4511-bc46-d5455c4aedff";

async function main() {
  const envs = ["FAL_KEY", "GEMINI_API_KEY", "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"] as const;
  const envStatus = envs.map((k) => `${k}=${process.env[k] ? "OK" : "MISSING"}`).join(" | ");

  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.log("ENV:", envStatus);
    process.exit(1);
  }

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false } },
  );

  // 1. Lead alvo
  const { data: lead, error: leadErr } = await supabase
    .from("product_leads")
    .select("id, title, status, metadata")
    .eq("id", TARGET_LEAD)
    .maybeSingle();

  console.log("=== LEAD ALVO ===");
  if (leadErr || !lead) {
    console.log(`ERRO ou ausente: ${leadErr?.message ?? "not found"}`);
  } else {
    const meta = (lead.metadata ?? {}) as Record<string, unknown>;
    console.log(`id=${lead.id}`);
    console.log(`title=${lead.title}`);
    console.log(`status=${lead.status}`);
    console.log(`structural_matrix=${meta.structural_matrix ? "PRESENTE" : "AUSENTE"}`);
    console.log(`creative_direction=${meta.creative_direction ? "PRESENTE" : "AUSENTE"}`);
    console.log(`generated_images=${meta.generated_images ? "PRESENTE" : "AUSENTE"}`);
  }

  // 2. Fila A3 pending
  const { data: tasks, error: tErr } = await supabase
    .from("task_queue")
    .select("id, created_at, payload")
    .eq("agent", "a3")
    .eq("status", "pending")
    .order("created_at", { ascending: true });

  console.log("\n=== FILA A3 PENDING ===");
  if (tErr) {
    console.log(`ERRO: ${tErr.message}`);
  } else if (!tasks || tasks.length === 0) {
    console.log("VAZIA (0 pending)");
  } else {
    tasks.forEach((t, i) => {
      const lid = (t.payload as { lead_id?: string } | null)?.lead_id ?? "?";
      const flag = lid === TARGET_LEAD ? "  <-- ALVO" : "";
      console.log(`[${i}] task=${t.id} created=${t.created_at} lead=${lid}${flag}`);
    });
    const oldest = tasks[0];
    const oldestLead = (oldest.payload as { lead_id?: string } | null)?.lead_id ?? "?";
    console.log(`MAIS_ANTIGA_APONTA_PARA_ALVO=${oldestLead === TARGET_LEAD ? "SIM" : "NAO"}`);
  }

  // 3. creative_matrix baseline + envs
  const { count, error: cErr } = await supabase
    .from("creative_matrix")
    .select("*", { count: "exact", head: true });

  console.log("\n=== BASELINE ===");
  console.log(`creative_matrix_count=${cErr ? `ERRO:${cErr.message}` : count ?? 0}`);
  console.log(`ENV: ${envStatus}`);
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});

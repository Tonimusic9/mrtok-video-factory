/**
 * Pré-voo A4 — SELECT-only. Zero escrita, zero FAL.
 * Uso: npx tsx scripts/preflight-a4.ts
 */
import { config } from "dotenv";
config({ path: ".env.local" });
import { createClient } from "@supabase/supabase-js";

const TARGET_LEAD = "6705d973-90b6-4511-bc46-d5455c4aedff";
const TARGET_TASK = "6daae831-2812-4ead-8eee-c8f4d5022d74";

async function main() {
  const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );

  // 1. Task A4 alvo
  const { data: task, error: tErr } = await supabase
    .from("task_queue")
    .select("id, agent, status, payload, parent_task_id, created_at")
    .eq("id", TARGET_TASK)
    .maybeSingle();

  console.log("=== TASK A4 ALVO ===");
  if (tErr || !task) {
    console.log(`ERRO ou ausente: ${tErr?.message ?? "not found"}`);
  } else {
    const lid = (task.payload as { lead_id?: string } | null)?.lead_id ?? "?";
    console.log(`id=${task.id}`);
    console.log(`agent=${task.agent}`);
    console.log(`status=${task.status}`);
    console.log(`payload.lead_id=${lid}`);
    console.log(`parent_task_id=${task.parent_task_id ?? "null"}`);
    console.log(`created_at=${task.created_at}`);
    console.log(`LEAD_BATE_COM_ALVO=${lid === TARGET_LEAD ? "SIM" : "NAO"}`);
  }

  // 2. Fila A4 pending total (sanity — deve ser 1)
  const { data: a4Pending } = await supabase
    .from("task_queue")
    .select("id, payload, created_at")
    .eq("agent", "a4")
    .eq("status", "pending")
    .order("created_at", { ascending: true });
  console.log(`\n=== FILA A4 PENDING (total) ===`);
  console.log(`count=${a4Pending?.length ?? 0}`);
  (a4Pending ?? []).forEach((t, i) => {
    const lid = (t.payload as { lead_id?: string } | null)?.lead_id ?? "?";
    console.log(`[${i}] task=${t.id} lead=${lid} created=${t.created_at}`);
  });

  // 3. Lead alvo
  const { data: lead, error: lErr } = await supabase
    .from("product_leads")
    .select("id, title, status, metadata")
    .eq("id", TARGET_LEAD)
    .maybeSingle();

  console.log("\n=== LEAD ALVO ===");
  if (lErr || !lead) {
    console.log(`ERRO: ${lErr?.message ?? "not found"}`);
    process.exit(1);
  }
  const meta = (lead.metadata ?? {}) as Record<string, unknown>;
  console.log(`status=${lead.status}`);

  const generatedImages = meta.generated_images as
    | Array<{ scene_index: number; phase: string; public_url: string; storage_path: string }>
    | undefined;
  console.log(`generated_images=${generatedImages ? `${generatedImages.length} imgs` : "AUSENTE"}`);
  if (generatedImages) {
    const cena1 = generatedImages.find((g) => g.scene_index === 1);
    if (cena1) {
      console.log(`cena_1_phase=${cena1.phase}`);
      console.log(`cena_1_storage_path=${cena1.storage_path}`);
      console.log(`cena_1_public_url=${cena1.public_url}`);
    } else {
      console.log(`CENA_1_AUSENTE_EM_generated_images`);
    }
  }

  const cd = meta.creative_direction as
    | {
        motion_buckets?: Array<{
          scene_index: number;
          phase: string;
          provider: string;
          motion_prompt: string;
          duration_seconds: number;
          camera_movement: string;
          intensity: string;
        }>;
      }
    | undefined;
  const mb0 = cd?.motion_buckets?.[0];
  console.log(`motion_buckets[0]=${mb0 ? "PRESENTE" : "AUSENTE"}`);
  if (mb0) {
    console.log(`  scene_index=${mb0.scene_index} phase=${mb0.phase} provider=${mb0.provider}`);
    console.log(`  duration_s=${mb0.duration_seconds} camera=${mb0.camera_movement} intensity=${mb0.intensity}`);
    console.log(`  motion_prompt="${mb0.motion_prompt}"`);
  }

  // 4. Verificar PNG cena 1 acessível (HEAD)
  if (generatedImages) {
    const cena1 = generatedImages.find((g) => g.scene_index === 1);
    if (cena1) {
      try {
        const res = await fetch(cena1.public_url, { method: "HEAD" });
        console.log(`\n=== PNG CENA 1 HEAD ===`);
        console.log(`status=${res.status} content-type=${res.headers.get("content-type")} content-length=${res.headers.get("content-length")}`);
      } catch (e) {
        console.log(`\n=== PNG CENA 1 HEAD ===\nERRO_FETCH: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});

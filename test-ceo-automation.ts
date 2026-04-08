/**
 * E2E rápido do Agente CEO (Tarefa 5).
 *
 * Pipeline:
 *  1. Acha uma creative_matrix com compliance_approved=true.
 *  2. Insere uma task_queue row (agent='ceo', status='pending') com payload.
 *  3. POST /api/ceo/tick com CEO_TICK_SECRET → simula o cron.
 *  4. Relê a task para confirmar o outcome (done/failed) sem depender só
 *     da resposta da rota.
 *
 * Uso: `npx tsx test-ceo-automation.ts`
 *
 * Requisitos: `.env.local` populado e dev server rodando em :3000.
 */
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

// --- mini loader de .env.local (sem dotenv) --------------------------------
function loadEnvLocal(): Record<string, string> {
  const out: Record<string, string> = {};
  try {
    const raw = readFileSync(".env.local", "utf-8");
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq === -1) continue;
      const k = trimmed.slice(0, eq).trim();
      let v = trimmed.slice(eq + 1).trim();
      if (
        (v.startsWith('"') && v.endsWith('"')) ||
        (v.startsWith("'") && v.endsWith("'"))
      ) {
        v = v.slice(1, -1);
      }
      out[k] = v;
    }
  } catch (err) {
    console.error("❌ Falha ao ler .env.local:", (err as Error).message);
    process.exit(1);
  }
  return out;
}

function requireVar(env: Record<string, string>, key: string): string {
  const v = env[key] ?? process.env[key];
  if (!v) {
    console.error(`❌ Variável ausente: ${key}`);
    process.exit(1);
  }
  return v;
}

// --- main ------------------------------------------------------------------
async function main() {
  console.log("🤖 MrTok — Teste E2E do Agente CEO\n");

  const env = loadEnvLocal();
  const SUPABASE_URL = requireVar(env, "SUPABASE_URL");
  const SUPABASE_SERVICE_ROLE_KEY = requireVar(env, "SUPABASE_SERVICE_ROLE_KEY");
  const CEO_TICK_SECRET = requireVar(env, "CEO_TICK_SECRET");
  const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  // 1. Achar uma creative_matrix aprovada -----------------------------------
  console.log("1️⃣  Buscando creative_matrix com compliance_approved=true...");
  const { data: matrix, error: mErr } = await supabase
    .from("creative_matrix")
    .select("id, project_id")
    .eq("compliance_approved", true)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (mErr) {
    console.error("   ❌ erro na query:", mErr.message);
    process.exit(1);
  }
  let matrixId: string;
  let projectId: string;

  if (!matrix) {
    console.log("   ⚠️ nenhuma encontrada — semeando fixture E2E...");
    const fixture = {
      project_id: "mrtok-e2e-test",
      metadata: {
        total_estimated_duration: 25,
        format_style: "ugc_carousel",
        persona_id: "persona-e2e",
        voice_profile: "feminina_jovem_descolada",
      },
      hooks_matrix: [
        {
          hook_type: "curiosity_gap",
          visual_disruptor_trigger: "close-up no produto com luz quente",
          voiceover_script: "Você não vai acreditar no que descobri…",
          human_imperfections_injection: "respiração audível antes da fala",
        },
        {
          hook_type: "shock_value",
          visual_disruptor_trigger: "objeto caindo em câmera lenta",
          voiceover_script: "Para tudo, isso aqui mudou minha rotina!",
          human_imperfections_injection: "gagueja na palavra 'rotina'",
        },
        {
          hook_type: "social_proof",
          visual_disruptor_trigger: "tela dividida com prints de comentários",
          voiceover_script: "37 mil pessoas já usaram esse truque.",
          human_imperfections_injection: "leve risada nervosa no final",
        },
      ],
      storyboard: [
        {
          segment_index: 1,
          emotional_beat: "curiosity",
          voiceover_script: "Tudo começou quando eu tentei…",
          visual_prompt:
            "produto real sobre mesa de madeira, luz natural lateral, sem retoque",
          text_overlay: "ISSO AQUI…",
          continuity: { requires_previous_frame: false },
        },
      ],
    };

    const { data: seeded, error: seedErr } = await supabase
      .from("creative_matrix")
      .insert({
        project_id: fixture.project_id,
        metadata: fixture.metadata,
        hooks_matrix: fixture.hooks_matrix,
        storyboard: fixture.storyboard,
        compliance_approved: true,
      })
      .select("id, project_id")
      .single();

    if (seedErr || !seeded) {
      console.error("   ❌ seed falhou:", seedErr?.message);
      process.exit(1);
    }
    matrixId = seeded.id;
    projectId = seeded.project_id;
    console.log(`   ✅ fixture semeada: ${matrixId}`);
  } else {
    matrixId = matrix.id;
    projectId = matrix.project_id;
    console.log(`   ✅ achada: ${matrixId} (project=${projectId})`);
  }

  // 2. Inserir task_queue row ------------------------------------------------
  console.log("\n2️⃣  Inserindo task_queue row (agent=ceo, status=pending)...");
  const payload = {
    creative_matrix_id: matrixId,
    caption:
      "Teste E2E MrTok CEO — não publicar em produção. #mrtok #teste",
    platforms: ["tiktok", "instagram"],
    photos: [
      {
        url: "https://placehold.co/1080x1920/png?text=MrTok+E2E+1",
        order: 1,
      },
      {
        url: "https://placehold.co/1080x1920/png?text=MrTok+E2E+2",
        order: 2,
      },
    ],
    schedule_iso: null,
  };

  const { data: task, error: tErr } = await supabase
    .from("task_queue")
    .insert({
      project_id: projectId,
      agent: "ceo",
      status: "pending",
      payload,
    })
    .select("id, created_at")
    .single();

  if (tErr || !task) {
    console.error("   ❌ insert falhou:", tErr?.message);
    process.exit(1);
  }
  console.log(`   ✅ task criada: ${task.id}`);

  // 3. POST /api/ceo/tick ----------------------------------------------------
  const url = `${BASE_URL}/api/ceo/tick`;
  console.log(`\n3️⃣  POST ${url} (simulando cron)...`);

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-ceo-secret": CEO_TICK_SECRET,
        // Simula tráfego vindo da VPS Tailscale para passar o proxy.ts
        // (em produção o cron roda direto na VPS, então o IP é nativo).
        "x-forwarded-for": "100.72.40.35",
      },
      body: JSON.stringify({ maxTasks: 5 }),
    });
  } catch (err) {
    console.error("   ❌ fetch falhou:", (err as Error).message);
    console.error("      Dev server está rodando em", BASE_URL, "?");
    process.exit(1);
  }

  const body = await res.json().catch(() => ({ error: "non_json_response" }));
  console.log(`   ← status HTTP: ${res.status}`);
  console.log("   ← body:");
  console.log(
    JSON.stringify(body, null, 2)
      .split("\n")
      .map((l) => "      " + l)
      .join("\n"),
  );

  // 4. Reler a task para confirmar outcome ----------------------------------
  console.log("\n4️⃣  Relendo task_queue para confirmar outcome...");
  const { data: finalTask, error: fErr } = await supabase
    .from("task_queue")
    .select("id, status, error, result, updated_at")
    .eq("id", task.id)
    .single();

  if (fErr || !finalTask) {
    console.error("   ❌ erro ao reler task:", fErr?.message);
    process.exit(1);
  }
  console.log(`   status final: ${finalTask.status}`);
  if (finalTask.error) console.log(`   error: ${finalTask.error}`);
  if (finalTask.result)
    console.log(`   result: ${JSON.stringify(finalTask.result)}`);

  // 5. Auditoria crítica: compliance_approved não pode ter sido revertida ---
  console.log(
    "\n5️⃣  Auditoria: confirmando que compliance_approved continua true...",
  );
  const { data: matrixAfter } = await supabase
    .from("creative_matrix")
    .select("compliance_approved")
    .eq("id", matrixId)
    .single();

  if (matrixAfter?.compliance_approved === true) {
    console.log("   ✅ compliance_approved intacto (true).");
  } else {
    console.log(
      "   ❌ REGRESSÃO DE AUDITORIA: compliance_approved =",
      matrixAfter?.compliance_approved,
    );
    process.exit(1);
  }

  console.log("\n🏁 Fim do teste E2E.");
  if (finalTask.status === "done") {
    console.log(
      "   ✅ CEO disparou o dispatch com sucesso — ToniBot acionado (via dispatch-service → Telegram).",
    );
  } else if (finalTask.status === "failed") {
    console.log(
      "   ⚠️ Task terminou em 'failed' — ToniBot acionado para notificar falha. Cheque o error acima.",
    );
  } else {
    console.log(`   ⚠️ Estado inesperado: ${finalTask.status}`);
  }
}

main().catch((err) => {
  console.error("❌ Exceção não tratada:", err);
  process.exit(1);
});

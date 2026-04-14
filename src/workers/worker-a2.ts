/**
 * Worker a2 — Roteirista Criativo / Diretor de Performance.
 *
 * Bridge entre a Structural Matrix do a1 e os workers downstream (a3/a4/a5).
 * Converte a psicologia de retenção abstraída pelo a1 em artefatos concretos:
 *   - Visual Prompts otimizados para Nano Banana 2 (geração de imagem)
 *   - Motion Buckets para Seedance 2.0 / Kling 3.1 (geração de vídeo)
 *   - Roteiro de VO com marcações de tom e timing
 *
 * Engine: Gemini 3.0 Flash (mesma do a0/a1 — ROI imbatível para tarefas
 * de transformação texto→texto estruturado).
 *
 * REGRA DE OURO: este worker NUNCA escreve em `creative_matrix`.
 * Escrita limitada a `task_queue.result` (via runner).
 */
import { z } from "zod";
import { runAgentTick, type AgentTickArgs, type AgentTickResult } from "@/lib/agent-runner";
import { generateWithGemini } from "@/lib/gemini-client";
import { getSupabaseAdmin } from "@/lib/supabase";
import { extractorResultSchema, type ExtractorResult } from "@/workers/worker-a1";
import type { Json } from "@/types/database";

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

export const creativeDirectorTaskPayloadSchema = z.object({
  lead_id: z.string().uuid(),
  parent_task_id: z.string().uuid().optional(),
});
export type CreativeDirectorTaskPayload = z.infer<typeof creativeDirectorTaskPayloadSchema>;

const visualPromptSchema = z.object({
  scene_index: z.number().int(),
  phase: z.string(),
  nano_banana_prompt: z.string().min(1),
  negative_prompt: z.string().min(1),
  aspect_ratio: z.literal("9:16"),
});

const motionBucketSchema = z.object({
  scene_index: z.number().int(),
  phase: z.string(),
  provider: z.enum(["seedance_2_0", "kling_3_1", "veo_3_1_fast"]),
  motion_prompt: z.string().min(1),
  duration_seconds: z.number().positive().max(15),
  camera_movement: z.string().min(1),
  intensity: z.string().transform((v) => {
    const lower = v.toLowerCase();
    if (["low", "medium", "high"].includes(lower)) return lower as "low" | "medium" | "high";
    return "medium" as const;
  }),
});

const voiceoverSegmentSchema = z.object({
  scene_index: z.number().int(),
  phase: z.string(),
  text_pt_br: z.string().min(1),
  tone_marker: z.string().min(1),
  duration_seconds: z.number().positive().max(15),
  human_imperfection_hint: z.string().min(1),
});

export const creativeDirectorResultSchema = z.object({
  lead_id: z.string(),
  lead_title: z.string(),
  visual_prompts: z.array(visualPromptSchema).min(2).max(5),
  motion_buckets: z.array(motionBucketSchema).min(2).max(5),
  voiceover_script: z.array(voiceoverSegmentSchema).min(2).max(5),
  global_style: z.object({
    aesthetic: z.string().min(1),
    color_palette: z.string().min(1),
    reference_device: z.literal("iPhone 17 Pro Max"),
    forbidden_elements: z.array(z.string()).min(1),
  }),
});
export type CreativeDirectorResult = z.infer<typeof creativeDirectorResultSchema>;

// ---------------------------------------------------------------------------
// Prompt para o Gemini
// ---------------------------------------------------------------------------

function buildCreativeDirectorPrompt(
  title: string,
  matrix: ExtractorResult,
): string {
  const matrixJson = JSON.stringify(matrix, null, 2);

  return `Você é o Diretor de Arte e Roteirista de Performance do MrTok — fábrica brasileira de UGC para TikTok Shop.

Sua missão: converter a Structural Matrix abaixo em 3 artefatos de produção concretos.

PRODUTO: ${title}
STRUCTURAL MATRIX (gerada pelo Engenheiro de Retenção):
${matrixJson}

GERE EXCLUSIVAMENTE um JSON válido (sem markdown) com este formato:

{
  "lead_id": "(preencher com o id do lead)",
  "lead_title": "${title}",
  "visual_prompts": [
    {
      "scene_index": 1,
      "phase": "hook",
      "nano_banana_prompt": "Ultra-detailed photorealistic prompt for Nano Banana 2. MUST include: 'shot on iPhone 17 Pro Max, raw UGC style, casual framing, natural daylight, 9:16 vertical'. Describe the exact visual composition, subject position, expression, lighting, background. In ENGLISH.",
      "negative_prompt": "CGI, anime, studio lighting, perfect skin, stock photo, watermark, text overlay, logo",
      "aspect_ratio": "9:16"
    }
  ],
  "motion_buckets": [
    {
      "scene_index": 1,
      "phase": "hook",
      "provider": "seedance_2_0",
      "motion_prompt": "Describe the EXACT motion to animate from start frame to end frame. Camera movement, subject action, speed. Be specific about physics and continuity. In ENGLISH.",
      "duration_seconds": 2,
      "camera_movement": "quick zoom in / slow pan / static / handheld shake",
      "intensity": "high"
    }
  ],
  "voiceover_script": [
    {
      "scene_index": 1,
      "phase": "hook",
      "text_pt_br": "Texto em português BR coloquial. Máximo 2 frases. Deve provocar a emoção do psychological_trigger.",
      "tone_marker": "[sussurrando] / [animado] / [chocado] / [íntimo]",
      "duration_seconds": 2,
      "human_imperfection_hint": "Leve gaguejar no início / pausa de surpresa / riso nervoso"
    }
  ],
  "global_style": {
    "aesthetic": "Raw UGC, shot on iPhone 17 Pro Max, casual selfie framing, imperfect but authentic",
    "color_palette": "Warm natural tones, soft daylight, no filters",
    "reference_device": "iPhone 17 Pro Max",
    "forbidden_elements": ["CGI", "anime", "studio lighting", "perfect composition", "stock footage", "before/after clinical"]
  }
}

REGRAS OBRIGATÓRIAS:
1. Visual prompts em INGLÊS (performance dos geradores de imagem).
2. Voiceover em PORTUGUÊS BR coloquial. NUNCA exagerar produto ou fazer claims médicos.
3. Cada scene_index mapeia 1:1 com os steps da structural_matrix.
4. Motion buckets devem respeitar: Seedance 2.0 max 15s, Kling 3.1 max 10s, Veo 3.1 Fast max 8s.
5. Hook (cena 1): SEMPRE "seedance_2_0" com intensity "high" e duration max 3s.
6. Resolução canônica: 720x1280 (720p vertical). PROIBIDO 1080p ou 4K.
7. TODA cena deve ter human_imperfection_hint no voiceover — fator anti-shadowban.
8. Negative prompts AGRESSIVOS contra CGI, anime, stock footage.`;
}

// ---------------------------------------------------------------------------
// Lógica de processamento
// ---------------------------------------------------------------------------

async function processLead(
  leadId: string,
): Promise<CreativeDirectorResult> {
  const supabase = getSupabaseAdmin();

  // 1. Buscar lead + structural matrix do metadata
  const { data: lead, error: leadErr } = await (supabase as any)
    .from("product_leads")
    .select("id, title, metadata")
    .eq("id", leadId)
    .single();

  if (leadErr || !lead) {
    throw new Error(`Lead não encontrado: ${leadErr?.message ?? "sem retorno"}`);
  }

  const meta = lead.metadata as Record<string, unknown>;
  const structuralMatrix = meta?.structural_matrix;
  if (!structuralMatrix) {
    throw new Error(`Lead ${leadId} não possui structural_matrix. Rode o a1 primeiro.`);
  }

  const matrix = extractorResultSchema.parse(structuralMatrix);

  // 2. Gerar artefatos de produção via Gemini 3.0 Flash
  const prompt = buildCreativeDirectorPrompt(lead.title, matrix);
  const raw = await generateWithGemini(prompt);

  // 3. Parse + validação
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error("Gemini não retornou JSON válido na direção criativa a2");
  }

  const parsed = JSON.parse(jsonMatch[0]);
  // Injetar lead_id que o modelo pode não ter preenchido corretamente
  parsed.lead_id = leadId;
  parsed.lead_title = lead.title;

  const result = creativeDirectorResultSchema.parse(parsed);

  // 4. Salvar creative_direction no metadata do lead.
  //    Status permanece "processed" até a migration 0004 ser aplicada
  //    (adiciona "directed" ao check constraint). Após aplicar, trocar
  //    para: status: "directed".
  const updatedMetadata = {
    ...meta,
    creative_direction: result,
  };

  const { error: updateErr } = await (supabase as any)
    .from("product_leads")
    .update({
      metadata: updatedMetadata,
    })
    .eq("id", leadId);

  if (updateErr) {
    throw new Error(`Falha ao atualizar lead: ${updateErr.message}`);
  }

  return result;
}

// ---------------------------------------------------------------------------
// Resultado tipado para o runner
// ---------------------------------------------------------------------------

interface A2RunnerResult {
  lead_id: string;
  lead_title: string;
  visual_prompts_count: number;
  motion_buckets_count: number;
  voiceover_segments_count: number;
  creative_direction: CreativeDirectorResult;
  [key: string]: Json | undefined;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export function runWorkerA2Tick(args: AgentTickArgs = {}): Promise<AgentTickResult> {
  return runAgentTick<CreativeDirectorTaskPayload, A2RunnerResult>(
    {
      agent: "a2",
      label: "Roteirista Criativo a2",
      payloadSchema: creativeDirectorTaskPayloadSchema,
      process: async (payload) => {
        const result = await processLead(payload.lead_id);

        return {
          kind: "done",
          result: {
            lead_id: payload.lead_id,
            lead_title: result.lead_title,
            visual_prompts_count: result.visual_prompts.length,
            motion_buckets_count: result.motion_buckets.length,
            voiceover_segments_count: result.voiceover_script.length,
            creative_direction: result as unknown as CreativeDirectorResult,
          },
        };
      },
    },
    args,
  );
}

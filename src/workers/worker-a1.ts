/**
 * Worker a1 — Extrator Multimodal (Engenheiro de Retenção).
 *
 * Consome leads `pending` da `product_leads` e gera a Structural Matrix
 * de retenção (Hook/Body/CTA) via Gemini 3.0 Flash.
 *
 * Input: lead_id (UUID) vindo da task_queue.
 * Output: viral_reference_analysis + structural_matrix (JSON validado por Zod).
 *
 * REGRA DE OURO: este worker NUNCA escreve em `creative_matrix`.
 * Escrita limitada a `product_leads` (atualização de status/metadata) e `task_queue` (via runner).
 */
import { z } from "zod";
import { runAgentTick, type AgentTickArgs, type AgentTickResult } from "@/lib/agent-runner";
import { generateWithGemini } from "@/lib/gemini-client";
import { getSupabaseAdmin } from "@/lib/supabase";
import type { Json } from "@/types/database";

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

export const extractorTaskPayloadSchema = z.object({
  lead_id: z.string().uuid(),
});
export type ExtractorTaskPayload = z.infer<typeof extractorTaskPayloadSchema>;

const structuralMatrixStepSchema = z.object({
  step_index: z.number().int(),
  timestamp_range: z.string(),
  phase: z.enum(["hook", "agitation_or_demonstration", "solution_and_cta"]),
  psychological_trigger: z.string(),
  visual_action_abstracted: z.string(),
  text_overlay_purpose: z.string(),
  audio_vibe: z.string(),
});

export const extractorResultSchema = z.object({
  viral_reference_analysis: z.object({
    lead_title: z.string(),
    global_pacing: z.enum(["frenetic", "moderate", "slow_storytelling"]),
    hook_style_detected: z.string(),
    text_on_screen_density: z.enum(["high", "medium", "low"]),
  }),
  structural_matrix: z.array(structuralMatrixStepSchema).min(2).max(5),
});
export type ExtractorResult = z.infer<typeof extractorResultSchema>;

/** Schema do metadata que o a0 persiste em product_leads */
const leadMetadataSchema = z.object({
  curation_id: z.string(),
  core_mechanism: z.string(),
  pain_point: z.string(),
  target_audience: z.string(),
  justification: z.string(),
});

// ---------------------------------------------------------------------------
// Prompt para o Gemini
// ---------------------------------------------------------------------------

function buildExtractionPrompt(
  title: string,
  meta: z.infer<typeof leadMetadataSchema>,
): string {
  return `Você é um Engenheiro de Retenção de Vídeo e Cientista Comportamental do TikTok.

Sua tarefa: dado o perfil de um produto viral, gere a MATRIZ ESTRUTURAL de um vídeo UGC de 15 segundos (formato 9:16) que maximize a retenção no TikTok Shop Brasil.

REGRA DE OURO: NÃO descreva o produto de forma específica. Extraia a *ação psicológica e visual* abstrata.

DADOS DO PRODUTO:
- Nome: ${title}
- Mecanismo Central: ${meta.core_mechanism}
- Dor que Resolve: ${meta.pain_point}
- Público-Alvo BR: ${meta.target_audience}
- Justificativa Viral: ${meta.justification}

Gere EXCLUSIVAMENTE um JSON válido (sem markdown, sem comentários) no formato:

{
  "viral_reference_analysis": {
    "lead_title": "string (nome do produto)",
    "global_pacing": "frenetic|moderate|slow_storytelling",
    "hook_style_detected": "string (ex: Negativity Bias, Satisfying Loop, Aggressive Claim)",
    "text_on_screen_density": "high|medium|low"
  },
  "structural_matrix": [
    {
      "step_index": 1,
      "timestamp_range": "00:00 - 00:02",
      "phase": "hook",
      "psychological_trigger": "string (ex: Curiosidade, Choque, Invalidação de Crença)",
      "visual_action_abstracted": "string (Descrição da câmera e ação agnóstica ao produto)",
      "text_overlay_purpose": "string (Função do texto nesta cena)",
      "audio_vibe": "string (ex: Voz ofegante, ASMR, música em crescendo)"
    },
    {
      "step_index": 2,
      "timestamp_range": "00:02 - 00:08",
      "phase": "agitation_or_demonstration",
      "psychological_trigger": "string",
      "visual_action_abstracted": "string",
      "text_overlay_purpose": "string",
      "audio_vibe": "string"
    },
    {
      "step_index": 3,
      "timestamp_range": "00:08 - 00:15",
      "phase": "solution_and_cta",
      "psychological_trigger": "string",
      "visual_action_abstracted": "string",
      "text_overlay_purpose": "string",
      "audio_vibe": "string"
    }
  ]
}

IMPORTANTE:
- O vídeo é para iPhone 17 Pro Max (estética UGC nativa).
- O hook DEVE quebrar o padrão de rolagem nos primeiros 2 segundos.
- Cada fase deve ter um gatilho psicológico dominante DIFERENTE.
- As descrições visuais devem ser agnósticas ao produto — foque na AÇÃO e EMOÇÃO.`;
}

// ---------------------------------------------------------------------------
// Lógica de extração
// ---------------------------------------------------------------------------

interface LeadRow {
  id: string;
  title: string;
  metadata: Record<string, unknown>;
}

async function extractStructuralMatrix(
  leadId: string,
): Promise<ExtractorResult> {
  const supabase = getSupabaseAdmin();

  // 1. Buscar lead
  const { data: lead, error: leadErr } = await (supabase as any)
    .from("product_leads")
    .select("id, title, metadata")
    .eq("id", leadId)
    .single();

  if (leadErr || !lead) {
    throw new Error(`Lead não encontrado: ${leadErr?.message ?? "sem retorno"}`);
  }

  const typedLead = lead as LeadRow;
  const metaParsed = leadMetadataSchema.parse(typedLead.metadata);

  // 2. Gerar matriz via Gemini 3.0 Flash
  const prompt = buildExtractionPrompt(typedLead.title, metaParsed);
  const raw = await generateWithGemini(prompt);

  // 3. Parse do JSON retornado
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error("Gemini não retornou JSON válido na extração a1");
  }
  const parsed = JSON.parse(jsonMatch[0]);
  const result = extractorResultSchema.parse(parsed);

  // 4. Atualizar product_leads → status: processed + salvar matriz no metadata
  const updatedMetadata = {
    ...typedLead.metadata,
    structural_matrix: result,
  };

  const { error: updateErr } = await (supabase as any)
    .from("product_leads")
    .update({
      status: "processed",
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

interface A1Result {
  lead_id: string;
  lead_title: string;
  matrix_steps: number;
  extraction: ExtractorResult;
  [key: string]: Json | undefined;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export function runWorkerA1Tick(args: AgentTickArgs = {}): Promise<AgentTickResult> {
  return runAgentTick<ExtractorTaskPayload, A1Result>(
    {
      agent: "a1",
      label: "Extrator a1",
      payloadSchema: extractorTaskPayloadSchema,
      process: async (payload) => {
        const extraction = await extractStructuralMatrix(payload.lead_id);

        return {
          kind: "done",
          result: {
            lead_id: payload.lead_id,
            lead_title: extraction.viral_reference_analysis.lead_title,
            matrix_steps: extraction.structural_matrix.length,
            extraction: extraction as unknown as ExtractorResult,
          },
        };
      },
    },
    args,
  );
}

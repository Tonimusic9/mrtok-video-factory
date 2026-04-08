/**
 * Tipagens canônicas da Matriz Criativa — saída EXCLUSIVA do Agente 3 (Qwen 3.6).
 *
 * Espelha fielmente o contrato declarado em
 * `.claude/skills/agente-3-copywriter.md` §[FORMATO DE SAÍDA EXIGIDO].
 *
 * Regras inegociáveis (CLAUDE.md §4):
 *  - hooks_matrix DEVE conter `visual_disruptor_trigger` (Equação do Hook).
 *  - hooks_matrix DEVE conter `human_imperfections_injection` (Fator Humano).
 *  - storyboard DEVE conter `emotional_beat`, `visual_prompt` (com restrição
 *    de realismo), `text_overlay` e `continuity`.
 *  - metadata DEVE conter `voice_profile` (tom de voz para Kling 3.0).
 */
import { z } from "zod";

// --- Metadata ---------------------------------------------------------------
export const metadataSchema = z.object({
  total_estimated_duration: z.number().nonnegative(),
  format_style: z.string().min(1),
  persona_id: z.string().min(1),
  voice_profile: z.string().min(1, "voice_profile é obrigatório (Kling 3.0)"),
});
export type CreativeMatrixMetadata = z.infer<typeof metadataSchema>;

// --- Hook (Equação do Hook + Fator Humano) ---------------------------------
export const hookSchema = z.object({
  hook_type: z.string().min(1),
  visual_disruptor_trigger: z
    .string()
    .min(1, "visual_disruptor_trigger é obrigatório (Equação do Hook 83%)"),
  voiceover_script: z.string().min(1),
  human_imperfections_injection: z
    .string()
    .min(1, "human_imperfections_injection é obrigatório (Fator Humano)"),
});
export type CreativeHook = z.infer<typeof hookSchema>;

// --- Storyboard segment ----------------------------------------------------
export const continuitySchema = z.object({
  requires_previous_frame: z.boolean(),
});

export const storyboardSegmentSchema = z.object({
  segment_index: z.number().int().positive(),
  emotional_beat: z.string().min(1),
  voiceover_script: z.string().min(1),
  visual_prompt: z
    .string()
    .min(1, "visual_prompt precisa refletir o produto real (compliance)"),
  text_overlay: z.string(),
  continuity: continuitySchema,
});
export type StoryboardSegment = z.infer<typeof storyboardSegmentSchema>;

// --- Matriz Criativa completa ----------------------------------------------
export const creativeMatrixSchema = z.object({
  project_id: z.string().min(1),
  metadata: metadataSchema,
  hooks_matrix: z
    .array(hookSchema)
    .min(3, "Mínimo de 3 variações testáveis (Regra dos 83%)"),
  storyboard: z.array(storyboardSegmentSchema).min(1),
});
export type CreativeMatrix = z.infer<typeof creativeMatrixSchema>;

/**
 * Parse seguro com mensagens agregadas — usado pelo Agente QC.
 */
export function parseCreativeMatrix(input: unknown): CreativeMatrix {
  const parsed = creativeMatrixSchema.safeParse(input);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".") || "<root>"}: ${i.message}`)
      .join("\n");
    throw new Error(`[MrTok/QC] Matriz Criativa inválida:\n${issues}`);
  }
  return parsed.data;
}

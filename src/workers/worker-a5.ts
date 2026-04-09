/**
 * Worker a5 — Produtor Visual/Voz (Tarefa 9).
 *
 * Glue fino entre o runner genérico (`runAgentTick`) e a lógica de domínio
 * (`generateProductionSpec`). Drena a fila `task_queue` onde `agent='a5'`.
 *
 * REGRA DE OURO: este worker NUNCA escreve em `creative_matrix` e NUNCA
 * chama FAL.ai / KIE.ai / qualquer provider de mídia. A spec vive em
 * `task_queue.result` (gravada pelo runner). A renderização real é
 * responsabilidade do worker a6 (Montador CLI) em tarefa futura.
 *
 * Sem side-effects no top-level: importar este módulo não inicia loop nem
 * registra listener — o acionamento (cron, route handler, smoke) é externo.
 *
 * Cadeia a3 → a4 → a5: o payload aceita `script` (ScriptOutput do a3) e
 * `storyboard` (ImagePromptOutput do a4) COMPLETOS, não ids para o worker
 * buscar. Quem orquestra a cadeia (CEO ou route handler futuro) lê o
 * `result` das tasks upstream e os passa como payload da task a5.
 */
import { z } from "zod";
import { runAgentTick, type AgentTickArgs, type AgentTickResult } from "@/lib/agent-runner";
import {
  generateProductionSpec,
  productionSpecOutputSchema,
  VIDEO_PROVIDERS,
  type ProductionSpecOutput,
} from "@/lib/agents/productionSpec";
import { scriptOutputSchema } from "@/lib/agents/scriptwriter";
import { imagePromptOutputSchema } from "@/lib/agents/imagePrompt";

// Payload aceito na fila para `agent='a5'`. Reusa `scriptOutputSchema` e
// `imagePromptOutputSchema` — sem duplicação. `creative_matrix_id` e
// `source_task_id` são apenas ecoados para rastreabilidade — nunca usados
// para escrever na matriz.
export const productionSpecTaskPayloadSchema = z.object({
  script: scriptOutputSchema,
  storyboard: imagePromptOutputSchema,
  product_theme: z.string().min(1),
  target_persona: z.string().min(1).optional(),
  voice_locale: z.literal("pt-BR").optional(),
  preferred_video_provider: z.enum(VIDEO_PROVIDERS).optional(),
  compliance_constraints: z.array(z.string().min(1)).optional(),
  creative_matrix_id: z.string().uuid().optional(),
  source_task_id: z.string().uuid().optional(),
});
export type ProductionSpecTaskPayload = z.infer<typeof productionSpecTaskPayloadSchema>;

// Re-export para quem consome o worker precisar auditar o resultado.
export { productionSpecOutputSchema };
export type { ProductionSpecOutput };

export function runWorkerA5Tick(args: AgentTickArgs = {}): Promise<AgentTickResult> {
  return runAgentTick<ProductionSpecTaskPayload, ProductionSpecOutput>(
    {
      agent: "a5",
      label: "Produtor a5",
      payloadSchema: productionSpecTaskPayloadSchema,
      process: async (payload) => {
        const spec = await generateProductionSpec({
          script: payload.script,
          storyboard: payload.storyboard,
          product_theme: payload.product_theme,
          target_persona: payload.target_persona,
          voice_locale: payload.voice_locale,
          preferred_video_provider: payload.preferred_video_provider,
          compliance_constraints: payload.compliance_constraints,
        });
        return { kind: "done", result: spec };
      },
    },
    args,
  );
}

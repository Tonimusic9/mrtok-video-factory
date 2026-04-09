/**
 * Worker a4 — Diretor de Arte / Image Prompt Generator (Tarefa 8, Passo 2).
 *
 * Glue fino entre o runner genérico (`runAgentTick`) e a lógica de domínio
 * (`generateImagePrompts`). Drena a fila `task_queue` onde `agent='a4'`.
 *
 * REGRA DE OURO: este worker NUNCA escreve em `creative_matrix`. O storyboard
 * vive em `task_queue.result` (gravado pelo runner). Materialização posterior
 * é responsabilidade do CEO/QC, não daqui.
 *
 * Sem side-effects no top-level: importar este módulo não inicia loop nem
 * registra listener — o acionamento (cron, route handler, smoke) é externo.
 *
 * Cadeia a3 → a4 (decisão de design): o payload aceita o `script` COMPLETO
 * já estruturado, não um `task_id` do a3 para o worker buscar. Quem orquestra
 * a cadeia (CEO ou route handler futuro) lê o `result` da task a3 e o passa
 * como `payload.script` da nova task a4 — preserva a separação
 * CEO=orquestração / worker=execução estabelecida na Tarefa 5.
 */
import { z } from "zod";
import { runAgentTick, type AgentTickArgs, type AgentTickResult } from "@/lib/agent-runner";
import {
  generateImagePrompts,
  type ImagePromptOutput,
} from "@/lib/agents/imagePrompt";
import { scriptOutputSchema } from "@/lib/agents/scriptwriter";

// Payload aceito na fila para `agent='a4'`. `script` reusa o schema canônico
// do a3 (`scriptOutputSchema`) — sem duplicação. `creative_matrix_id` e
// `source_task_id` são apenas ecoados para rastreabilidade — nunca usados
// para escrever na matriz.
export const imagePromptTaskPayloadSchema = z.object({
  script: scriptOutputSchema,
  product_theme: z.string().min(1),
  target_persona: z.string().min(1).optional(),
  compliance_constraints: z.array(z.string().min(1)).optional(),
  creative_matrix_id: z.string().uuid().optional(),
  source_task_id: z.string().uuid().optional(),
});
export type ImagePromptTaskPayload = z.infer<typeof imagePromptTaskPayloadSchema>;

export function runWorkerA4Tick(args: AgentTickArgs = {}): Promise<AgentTickResult> {
  return runAgentTick<ImagePromptTaskPayload, ImagePromptOutput>(
    {
      agent: "a4",
      label: "Diretor de Arte a4",
      payloadSchema: imagePromptTaskPayloadSchema,
      process: async (payload) => {
        const storyboard = await generateImagePrompts({
          script: payload.script,
          product_theme: payload.product_theme,
          target_persona: payload.target_persona,
          compliance_constraints: payload.compliance_constraints,
        });
        return { kind: "done", result: storyboard };
      },
    },
    args,
  );
}

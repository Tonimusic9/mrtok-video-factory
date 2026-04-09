/**
 * Worker a3 — Scriptwriter (Tarefa 6, Passo 3).
 *
 * Glue fino entre o runner genérico (`runAgentTick`) e a lógica de domínio
 * (`writeScript`). Drena a fila `task_queue` onde `agent='a3'`.
 *
 * REGRA DE OURO: este worker NUNCA escreve em `creative_matrix`. O resultado
 * do scriptwriter vive em `task_queue.result` (gravado pelo runner). Qualquer
 * materialização posterior é responsabilidade do CEO/QC, não daqui.
 *
 * Sem side-effects no top-level: importar este módulo não inicia loop nem
 * registra listener — o acionamento (cron, route handler, smoke) é externo.
 */
import { z } from "zod";
import { runAgentTick, type AgentTickArgs, type AgentTickResult } from "@/lib/agent-runner";
import { writeScript, type ScriptOutput } from "@/lib/agents/scriptwriter";

// Payload aceito na fila para `agent='a3'`. Espelha `ScriptwriterInput`
// (src/lib/agents/scriptwriter.ts:47) + um campo opcional de rastreabilidade
// (`creative_matrix_id`) que é apenas ecoado adiante — nunca usado para
// escrever na matriz.
export const scriptwriterTaskPayloadSchema = z.object({
  theme: z.string().min(1),
  target_persona: z.string().min(1).optional(),
  compliance_constraints: z.array(z.string().min(1)).optional(),
  creative_matrix_id: z.string().uuid().optional(),
});
export type ScriptwriterTaskPayload = z.infer<typeof scriptwriterTaskPayloadSchema>;

export function runWorkerA3Tick(args: AgentTickArgs = {}): Promise<AgentTickResult> {
  return runAgentTick<ScriptwriterTaskPayload, ScriptOutput>(
    {
      agent: "a3",
      label: "Scriptwriter a3",
      payloadSchema: scriptwriterTaskPayloadSchema,
      process: async (payload) => {
        const script = await writeScript({
          theme: payload.theme,
          target_persona: payload.target_persona,
          compliance_constraints: payload.compliance_constraints,
        });
        return { kind: "done", result: script };
      },
    },
    args,
  );
}

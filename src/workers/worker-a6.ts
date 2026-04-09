/**
 * Worker a6 — Montador CLI / Remotion (Tarefa 10).
 *
 * Glue fino entre o runner genérico (`runAgentTick`) e a lógica de montagem.
 * Drena a fila `task_queue` onde `agent='a6'`.
 *
 * Fluxo:
 *   1. Recebe ProductionSpec (output do a5) no payload.
 *   2. Gera vídeos por shot via FAL.ai (paralelo, com fallback chain).
 *   3. Usa GLM 5.1 via OpenRouter para gerar RenderManifest.
 *   4. Renderiza via Remotion (futuro — por ora retorna manifest).
 *
 * REGRA DE OURO: este worker NUNCA escreve em `creative_matrix` e NUNCA
 * toca em `compliance_approved`.
 *
 * Suporta `dry_run: true` no payload para pular FAL.ai e Remotion,
 * validando apenas a geração do manifest via LLM.
 *
 * Sem side-effects no top-level: importar este módulo não inicia loop nem
 * registra listener — o acionamento (cron, route handler, smoke) é externo.
 */
import { runAgentTick, type AgentTickArgs, type AgentTickResult } from "@/lib/agent-runner";
import { submitAndPoll, type FalJobResult } from "@/lib/fal-client";
import {
  generateRenderManifest,
  montadorTaskPayloadSchema,
  montadorResultSchema,
  type MontadorTaskPayload,
  type MontadorResult,
} from "@/lib/agents/renderManifest";
import { FAL_SLUG_BY_PROVIDER, type VideoProvider } from "@/lib/agents/productionSpec";

// Re-export para quem consome o worker precisar auditar o resultado.
export { montadorResultSchema, montadorTaskPayloadSchema };
export type { MontadorResult, MontadorTaskPayload };

/** Placeholder usado em dry_run — nunca chamado contra FAL.ai real. */
const DRY_RUN_URL_PREFIX = "https://placeholder.fal.ai";

interface ShotFalResult {
  block: "hook" | "body" | "cta";
  fal_request_id: string;
  video_url: string;
  provider: VideoProvider;
  duration_ms: number;
}

/**
 * Gera vídeo de um shot via FAL.ai, tentando fallback chain em caso de falha.
 */
async function generateShotVideo(
  block: "hook" | "body" | "cta",
  imagePrompt: string,
  negativePrompt: string,
  durationSeconds: number,
  primaryProvider: VideoProvider,
  fallbackChain: VideoProvider[],
): Promise<ShotFalResult> {
  const providers = [primaryProvider, ...fallbackChain.filter((p) => p !== primaryProvider)];
  let lastError: Error | null = null;

  for (const provider of providers) {
    const slug = FAL_SLUG_BY_PROVIDER[provider];
    try {
      const result: FalJobResult = await submitAndPoll({
        slug,
        input: {
          prompt: imagePrompt,
          negative_prompt: negativePrompt,
          duration: durationSeconds,
          aspect_ratio: "9:16",
        },
      });
      return {
        block,
        fal_request_id: result.request_id,
        video_url: result.video_url,
        provider,
        duration_ms: result.duration_ms,
      };
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      // Continua para o próximo provider na chain.
    }
  }

  throw new Error(
    `[worker-a6] todos os providers falharam para shot ${block}: ${lastError?.message}`,
  );
}

export function runWorkerA6Tick(args: AgentTickArgs = {}): Promise<AgentTickResult> {
  return runAgentTick<MontadorTaskPayload, MontadorResult>(
    {
      agent: "a6",
      label: "Montador a6",
      payloadSchema: montadorTaskPayloadSchema,
      process: async (payload) => {
        const spec = payload.production_spec;
        const isDryRun = payload.dry_run === true;

        // --- 1. Gerar vídeos via FAL.ai (ou placeholders em dry_run) ---
        let falJobs: ShotFalResult[];

        if (isDryRun) {
          falJobs = spec.shots.map((shot) => ({
            block: shot.block,
            fal_request_id: `dry-run-${shot.block}`,
            video_url: `${DRY_RUN_URL_PREFIX}/${shot.block}.mp4`,
            provider: shot.video_generation.provider,
            duration_ms: 0,
          }));
        } else {
          // Paralelo via Promise.allSettled + fallback chain.
          const promises = spec.shots.map((shot) =>
            generateShotVideo(
              shot.block,
              shot.video_generation.image_prompt,
              shot.video_generation.negative_prompt,
              shot.video_generation.duration_seconds,
              shot.video_generation.provider,
              spec.global.fallback_provider_chain,
            ),
          );
          const settled = await Promise.allSettled(promises);
          const errors: string[] = [];
          falJobs = [];
          for (const s of settled) {
            if (s.status === "fulfilled") {
              falJobs.push(s.value);
            } else {
              errors.push(s.reason instanceof Error ? s.reason.message : String(s.reason));
            }
          }
          if (errors.length > 0) {
            throw new Error(
              `[worker-a6] ${errors.length} shot(s) falharam na geração FAL.ai:\n${errors.join("\n")}`,
            );
          }
        }

        // --- 2. Gerar RenderManifest via GLM 5.1 ---
        const videoUrls = falJobs.map((j) => ({ block: j.block, url: j.video_url }));
        const manifest = await generateRenderManifest({
          production_spec: spec,
          video_urls: videoUrls,
        });

        // --- 3. Renderizar via Remotion (futuro — por ora retorna manifest) ---
        // TODO: Integrar @remotion/renderer quando composição estiver pronta.
        const outputVideoUrl = isDryRun
          ? `${DRY_RUN_URL_PREFIX}/final-output.mp4`
          : `${DRY_RUN_URL_PREFIX}/render-pending.mp4`;

        const result: MontadorResult = {
          render_manifest: manifest,
          fal_jobs: falJobs,
          output_video_url: outputVideoUrl,
          pixel_hash_applied: manifest.pixel_hash,
          dry_run: isDryRun,
        };

        // Validação final do resultado completo.
        const check = montadorResultSchema.safeParse(result);
        if (!check.success) {
          const issues = check.error.issues
            .map((i) => `${i.path.join(".")}: ${i.message}`)
            .join("; ");
          throw new Error(`[worker-a6] resultado inválido: ${issues}`);
        }

        return { kind: "done", result };
      },
    },
    args,
  );
}

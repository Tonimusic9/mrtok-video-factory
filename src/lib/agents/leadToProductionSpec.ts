/**
 * Adapter mínimo: `CreativeDirection` (output do a3) → `ProductionSpec`
 * (input do a6). Pure-function, zero LLM, zero FAL, zero I/O.
 *
 * Destrava o worker-a6 para leads reais sem depender do worker-a5 legado
 * (que exige `ScriptOutput` + `ImagePromptOutput` — pipeline antigo).
 *
 * REGRA DE OURO: nenhum efeito colateral, nenhuma escrita em `creative_matrix`.
 * A fonte única dos slugs FAL continua em `FAL_SLUG_BY_PROVIDER`.
 */
import {
  FAL_SLUG_BY_PROVIDER,
  VIDEO_PROVIDERS,
  productionSpecOutputSchema,
  type ProductionSpecOutput,
  type VideoProvider,
} from "@/lib/agents/productionSpec";
import type { CreativeDirection } from "@/workers/worker-a3";

type Block = "hook" | "body" | "cta";

/** Phases canônicas do a1/a3 → blocos do ProductionSpec. */
const PHASE_TO_BLOCK: Record<string, Block> = {
  hook: "hook",
  agitation_or_demonstration: "body",
  solution_and_cta: "cta",
};

/** Naming legado do a3 → enum canônico do ProductionSpec. */
const PROVIDER_MAP: Record<string, VideoProvider> = {
  seedance_2_0: "seedance",
  kling_3_0_pro: "kling",
  kling_3_1: "kling",
  veo_3_1_fast: "veo",
};

const REQUIRED_PHASES = [
  "hook",
  "agitation_or_demonstration",
  "solution_and_cta",
] as const;

const DEFAULT_VOICE_ID = "pt-BR-creator-female-01";

/** Pacing padrão por bloco (WPM) — ajustável depois que TTS entrar no loop. */
const PACING_BY_BLOCK: Record<Block, number> = {
  hook: 175,
  body: 155,
  cta: 165,
};

/**
 * djb2 determinístico por `lead_id + scene_index`. Mantém seed estável entre
 * re-runs do mesmo lead e no range do schema (≤ 2^31-1).
 */
function deterministicSeed(leadId: string, sceneIndex: number): number {
  const input = `${leadId}:${sceneIndex}`;
  let h = 5381;
  for (let i = 0; i < input.length; i++) {
    h = ((h << 5) + h + input.charCodeAt(i)) >>> 0;
  }
  return h % 2147483647;
}

export interface LeadToProductionSpecInput {
  lead_id: string;
  creative_direction: CreativeDirection;
}

/**
 * Converte o `creative_direction` persistido em `product_leads.metadata` em
 * uma `ProductionSpec` válida contra `productionSpecOutputSchema`.
 *
 * Fail-closed: lança se faltar qualquer um dos 3 phases obrigatórios, se o
 * provider for desconhecido, ou se o schema final falhar.
 */
export function leadToProductionSpec(
  input: LeadToProductionSpecInput,
): ProductionSpecOutput {
  const { lead_id, creative_direction: cd } = input;

  const motionByPhase = new Map(cd.motion_buckets.map((m) => [m.phase, m]));
  const visualByPhase = new Map(cd.visual_prompts.map((v) => [v.phase, v]));
  const voiceByPhase = new Map(cd.voiceover_script.map((v) => [v.phase, v]));

  const shots = REQUIRED_PHASES.map((phase) => {
    const block = PHASE_TO_BLOCK[phase];
    const motion = motionByPhase.get(phase);
    const visual = visualByPhase.get(phase);
    const voice = voiceByPhase.get(phase);
    if (!motion || !visual || !voice) {
      throw new Error(
        `[leadToProductionSpec] phase "${phase}" incompleto (motion=${!!motion} visual=${!!visual} voice=${!!voice})`,
      );
    }

    const provider = PROVIDER_MAP[motion.provider];
    if (!provider) {
      throw new Error(
        `[leadToProductionSpec] provider legado desconhecido "${motion.provider}" no phase ${phase}`,
      );
    }

    return {
      block,
      voice: {
        voice_id: DEFAULT_VOICE_ID,
        ssml: voice.text_pt_br,
        pacing_wpm: PACING_BY_BLOCK[block],
        emphasis: [] as string[],
        pauses_ms: [] as Array<{
          after_word_index: number;
          duration_ms: number;
        }>,
        human_imperfection: voice.human_imperfection_hint,
      },
      video_generation: {
        provider,
        fal_model_slug: FAL_SLUG_BY_PROVIDER[provider],
        duration_seconds: motion.duration_seconds,
        aspect_ratio: "9:16" as const,
        motion_intensity: motion.intensity,
        seed: deterministicSeed(lead_id, motion.scene_index),
        image_prompt: visual.nano_banana_prompt,
        negative_prompt: visual.negative_prompt,
        motion_description: motion.motion_prompt,
      },
    };
  });

  const defaultProvider = shots[0].video_generation.provider;
  const fallbackChain: VideoProvider[] = [
    defaultProvider,
    ...VIDEO_PROVIDERS.filter((p) => p !== defaultProvider),
  ].slice(0, 3);

  const candidate: ProductionSpecOutput = {
    shots,
    global: {
      voice_locale: "pt-BR",
      default_video_provider: defaultProvider,
      fal_gateway: "fal.ai",
      fallback_provider_chain: fallbackChain,
    },
  };

  const parsed = productionSpecOutputSchema.safeParse(candidate);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`[leadToProductionSpec] schema inválido:\n${issues}`);
  }
  return parsed.data;
}

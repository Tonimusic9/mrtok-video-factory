/**
 * Agente Músculo — Montador CLI / Diretor de Composição (Tarefa 10).
 *
 * Recebe a ProductionSpec do a5 + URLs de vídeo geradas via FAL.ai e devolve
 * um RenderManifest: timeline Remotion-consumível com clips sequenciados,
 * transições e parâmetros de Unique Pixel Hash randomizados.
 *
 * REGRAS (CLAUDE.md §4):
 *  - Unique Pixel Hash obrigatório: escala [1.005..1.015], rotação [-0.15..0.15]°
 *    para garantir hash única por exportação.
 *  - Formato vertical 9:16 (720×1280) a 30fps — resolução canônica v2.0.
 *  - Roteamento via OpenRouter (`agent='a6'` → Z-AI GLM 5.1).
 *
 * REGRA DE OURO: este módulo NUNCA escreve em `creative_matrix` e NUNCA
 * toca em `compliance_approved`.
 */
import { z } from "zod";
import { openRouterCompletion } from "@/lib/openrouter";
import {
  productionSpecOutputSchema,
  VIDEO_PROVIDERS,
  type ProductionSpecOutput,
} from "@/lib/agents/productionSpec";

// --- Schemas de saída (RenderManifest) --------------------------------------

export const pixelHashModifiersSchema = z.object({
  scale: z.number().min(1.005).max(1.015),
  rotation_deg: z.number().min(-0.15).max(0.15),
});
export type PixelHashModifiers = z.infer<typeof pixelHashModifiersSchema>;

export const clipEntrySchema = z.object({
  block: z.enum(["hook", "body", "cta"]),
  video_url: z.string().min(1),
  start_frame: z.number().int().nonnegative(),
  duration_frames: z.number().int().positive(),
  transition_in: z.enum(["cut", "fade", "slide_up"]),
  text_overlay: z
    .object({
      text: z.string().min(1),
      position: z.enum(["top", "center", "bottom"]),
      style: z.enum(["ugc_caption", "cta_bold"]),
    })
    .nullish(),
});
export type ClipEntry = z.infer<typeof clipEntrySchema>;

export const renderManifestSchema = z.object({
  fps: z.literal(30),
  width: z.literal(720),
  height: z.literal(1280),
  clips: z.array(clipEntrySchema).length(3),
  pixel_hash: pixelHashModifiersSchema,
  total_duration_frames: z.number().int().positive(),
});
export type RenderManifest = z.infer<typeof renderManifestSchema>;

// --- Schemas de payload/resultado do worker ---------------------------------

export const montadorTaskPayloadSchema = z.object({
  production_spec: productionSpecOutputSchema,
  creative_matrix_id: z.string().uuid().optional(),
  source_task_id: z.string().uuid().optional(),
  dry_run: z.boolean().optional(),
});
export type MontadorTaskPayload = z.infer<typeof montadorTaskPayloadSchema>;

const falJobEntrySchema = z.object({
  block: z.enum(["hook", "body", "cta"]),
  fal_request_id: z.string().min(1),
  video_url: z.string().min(1),
  provider: z.enum(VIDEO_PROVIDERS),
  duration_ms: z.number().nonnegative(),
});

/**
 * Telemetria do render remoto — populada apenas em modo real (não dry_run).
 * Capturada pelo worker a6 via streaming do stdout do `deploy-render.sh` e
 * pelo `ffprobe` pós-render que roda na VPS antes do pull-back.
 */
export const renderTelemetrySchema = z.object({
  precheck_ms: z.number().nonnegative(),
  rsync_up_ms: z.number().nonnegative(),
  remote_render_ms: z.number().nonnegative(),
  ffmpeg_metadata_ms: z.number().nonnegative(),
  rsync_down_ms: z.number().nonnegative(),
  remote_log_path: z.string().min(1),
  output_file_bytes: z.number().int().positive(),
  ffprobe_width: z.literal(720),
  ffprobe_height: z.literal(1280),
  ffprobe_bitrate_bps: z.number().int().min(6_000_000).max(10_500_000),
});
export type RenderTelemetry = z.infer<typeof renderTelemetrySchema>;

export const montadorResultSchema = z.object({
  render_manifest: renderManifestSchema,
  fal_jobs: z.array(falJobEntrySchema).length(3),
  output_video_url: z.string().min(1),
  pixel_hash_applied: pixelHashModifiersSchema,
  dry_run: z.boolean(),
  render_telemetry: renderTelemetrySchema.optional(),
});
export type MontadorResult = z.infer<typeof montadorResultSchema>;

// --- Input para o LLM -------------------------------------------------------

export interface RenderManifestInput {
  production_spec: ProductionSpecOutput;
  video_urls: { block: "hook" | "body" | "cta"; url: string }[];
}

// --- Prompt -----------------------------------------------------------------

const SYSTEM_PROMPT = `Você é o Montador de Vídeo do MrTok, fábrica brasileira de UGC para TikTok Shop.

Sua tarefa: dada uma ProductionSpec (3 shots com specs de voz e vídeo) e as URLs de vídeo já geradas, produzir um RenderManifest — um JSON que o Remotion consome para compor o vídeo final.

REGRAS DO MANIFEST:
1. fps: sempre 30.
2. width: 720, height: 1280 (9:16 vertical TikTok 720p — resolução canônica v2.0, proibido 1080p/4K).
3. clips: EXATAMENTE 3, na ordem hook → body → cta.
4. Cada clip:
   - block: "hook", "body" ou "cta"
   - video_url: a URL fornecida para aquele bloco
   - start_frame: frame inicial (0-based). hook começa em 0, body começa após hook, cta após body.
   - duration_frames: duração em frames = duration_seconds do shot × 30 fps (arredondar para inteiro mais próximo).
   - transition_in: tipo de transição. hook DEVE ser "cut" (primeira cena). body e cta podem ser "cut", "fade" ou "slide_up". Escolha transições que fluam naturalmente com o estilo UGC.
   - text_overlay (opcional): texto curto para overlay. Se incluir no CTA, usar style "cta_bold" com position "bottom". Body pode ter "ugc_caption" no "bottom". Hook normalmente sem overlay.

5. pixel_hash: parâmetros de Unique Pixel Hash para blindagem algorítmica.
   - scale: float entre 1.005 e 1.015 (gere um valor aleatório nesse range).
   - rotation_deg: float entre -0.15 e 0.15 (gere um valor aleatório nesse range).
   IMPORTANTE: gere valores DIFERENTES a cada chamada. Não reutilize valores fixos.

6. total_duration_frames: soma de todos os duration_frames dos clips.

REGRAS DE FORMATO:
- Saída: JSON estrito no schema fornecido. Sem texto fora do JSON.
- Campos numéricos são números (não strings).`;

function buildUserPrompt(input: RenderManifestInput): string {
  const { production_spec, video_urls } = input;
  const urlMap = new Map(video_urls.map((v) => [v.block, v.url]));

  const shotDescs = production_spec.shots
    .map((shot) => {
      const url = urlMap.get(shot.block) ?? "MISSING";
      return `[${shot.block.toUpperCase()}]
  duration_seconds: ${shot.video_generation.duration_seconds}
  provider: ${shot.video_generation.provider}
  video_url: ${url}
  motion_intensity: ${shot.video_generation.motion_intensity}
  voiceover snippet: ${shot.voice.ssml.slice(0, 80)}...`;
    })
    .join("\n");

  return `ProductionSpec (3 shots):
${shotDescs}

Gere o RenderManifest JSON.`;
}

// --- Função principal -------------------------------------------------------

export async function generateRenderManifest(
  input: RenderManifestInput,
): Promise<RenderManifest> {
  const completion = await openRouterCompletion({
    agent: "a6",
    jsonMode: true,
    temperature: 0.8,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: buildUserPrompt(input) },
    ],
  });

  // Strip tolerante de code-fence (mesmo quirk que Minimax no a5).
  const rawContent = completion.content.trim();
  const fenceMatch = rawContent.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  const jsonText = fenceMatch ? fenceMatch[1] : rawContent;

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(jsonText);
  } catch (err) {
    throw new Error(
      `[render-manifest] resposta não é JSON válido: ${(err as Error).message}\n---\n${completion.content}`,
    );
  }

  const result = renderManifestSchema.safeParse(parsedJson);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`[render-manifest] schema inválido:\n${issues}`);
  }
  const manifest = result.data;

  // --- Cross-checks fail-closed --------------------------------------------

  // 1. Ordem dos clips.
  const order = manifest.clips.map((c) => c.block).join(",");
  if (order !== "hook,body,cta") {
    throw new Error(
      `[render-manifest] clips fora de ordem: esperado hook,body,cta — recebido ${order}`,
    );
  }

  // 2. total_duration_frames == soma duration_frames.
  const sumFrames = manifest.clips.reduce((s, c) => s + c.duration_frames, 0);
  if (manifest.total_duration_frames !== sumFrames) {
    throw new Error(
      `[render-manifest] total_duration_frames=${manifest.total_duration_frames} ≠ soma=${sumFrames}`,
    );
  }

  // 3. pixel_hash bounds (schema já valida, mas reforçamos mensagem).
  if (manifest.pixel_hash.scale < 1.005 || manifest.pixel_hash.scale > 1.015) {
    throw new Error(
      `[render-manifest] pixel_hash.scale=${manifest.pixel_hash.scale} fora de [1.005, 1.015]`,
    );
  }
  if (
    manifest.pixel_hash.rotation_deg < -0.15 ||
    manifest.pixel_hash.rotation_deg > 0.15
  ) {
    throw new Error(
      `[render-manifest] pixel_hash.rotation_deg=${manifest.pixel_hash.rotation_deg} fora de [-0.15, 0.15]`,
    );
  }

  // 4. duration_frames por clip ≈ shot.duration_seconds × fps (±1 frame tolerância).
  for (const clip of manifest.clips) {
    const shot = input.production_spec.shots.find((s) => s.block === clip.block);
    if (!shot) {
      throw new Error(
        `[render-manifest] bloco ${clip.block} ausente na ProductionSpec`,
      );
    }
    const expected = shot.video_generation.duration_seconds * manifest.fps;
    if (Math.abs(clip.duration_frames - expected) > 1) {
      throw new Error(
        `[render-manifest] duration_frames do clip ${clip.block}=${clip.duration_frames} diverge do esperado ${expected} (±1 frame)`,
      );
    }
  }

  // 5. start_frame sequencial correto.
  let expectedStart = 0;
  for (const clip of manifest.clips) {
    if (clip.start_frame !== expectedStart) {
      throw new Error(
        `[render-manifest] start_frame do clip ${clip.block}=${clip.start_frame}, esperado ${expectedStart}`,
      );
    }
    expectedStart += clip.duration_frames;
  }

  // 6. video_url bate com o fornecido.
  for (const clip of manifest.clips) {
    const provided = input.video_urls.find((v) => v.block === clip.block);
    if (provided && clip.video_url !== provided.url) {
      throw new Error(
        `[render-manifest] video_url do clip ${clip.block} diverge: esperado "${provided.url}", recebido "${clip.video_url}"`,
      );
    }
  }

  return manifest;
}

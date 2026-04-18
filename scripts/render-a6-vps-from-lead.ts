/**
 * render-a6-vps-from-lead — one-shot zero-FAL: monta RenderManifest a partir
 * dos `metadata.generated_videos` já saneados do lead e dispara `runRemoteRender`
 * (rsync → VPS → Remotion → ffmpeg iPhone metadata → pull MP4).
 *
 * Via B Mk2: evita o caminho worker-a6 !dry_run (que chama FAL do zero) e
 * preserva o contrato `deploy-render.sh` canônico. Não escreve em DB.
 *
 * Uso: npx tsx scripts/render-a6-vps-from-lead.ts
 * Env: LEAD_ID (default 6705d973-90b6-4511-bc46-d5455c4aedff)
 */
import { config } from "dotenv";
config({ path: ".env.local" });
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { runRemoteRender } from "../src/lib/agents/remoteRender";
import {
  renderManifestSchema,
  type RenderManifest,
} from "../src/lib/agents/renderManifest";

const DEFAULT_LEAD_ID = "6705d973-90b6-4511-bc46-d5455c4aedff";

type Block = "hook" | "body" | "cta";
const PHASE_TO_BLOCK: Record<string, Block> = {
  hook: "hook",
  agitation_or_demonstration: "body",
  solution_and_cta: "cta",
};
const TRANSITION_BY_BLOCK: Record<Block, "cut" | "fade" | "slide_up"> = {
  hook: "cut",
  body: "fade",
  cta: "slide_up",
};

function deterministicPixelHash(leadId: string): {
  scale: number;
  rotation_deg: number;
} {
  let h = 5381;
  for (let i = 0; i < leadId.length; i++) {
    h = ((h << 5) + h + leadId.charCodeAt(i)) >>> 0;
  }
  const scale = 1.005 + (h % 1001) / 100000;
  const rot = -0.15 + ((h >>> 8) % 301) / 1000;
  return {
    scale: Math.round(scale * 1000) / 1000,
    rotation_deg: Math.round(rot * 100) / 100,
  };
}

async function main() {
  const leadId = process.env.LEAD_ID?.trim() || DEFAULT_LEAD_ID;
  const sb = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );

  const { data: lead, error } = await sb
    .from("product_leads")
    .select("id, title, metadata")
    .eq("id", leadId)
    .single();
  if (error || !lead) {
    console.error(`[a6-vps] lead not found: ${error?.message}`);
    process.exit(2);
  }
  const meta = (lead.metadata ?? {}) as Record<string, unknown>;
  const videos = (meta.generated_videos as Array<Record<string, unknown>>) ?? [];
  if (videos.length !== 3) {
    console.error(`[a6-vps] expected 3 videos, got ${videos.length}`);
    process.exit(2);
  }

  const fps = 30 as const;
  const clips = (["hook", "body", "cta"] as const).map((block, idx) => {
    const v = videos.find(
      (x) => PHASE_TO_BLOCK[x.phase as string] === block,
    );
    if (!v) throw new Error(`[a6-vps] vídeo ausente para block=${block}`);
    const url = v.public_url as string;
    const durFrames = Math.round(((v.duration_seconds as number) || 5) * fps);
    return {
      block,
      video_url: url,
      duration_frames: durFrames,
      transition_in: TRANSITION_BY_BLOCK[block],
      text_overlay: null,
      start_frame: 0,
      _idx: idx,
    };
  });

  let cursor = 0;
  for (const c of clips) {
    c.start_frame = cursor;
    cursor += c.duration_frames;
  }
  const totalFrames = cursor;

  const manifestRaw: RenderManifest = {
    fps,
    width: 720,
    height: 1280,
    clips: clips.map((c) => ({
      block: c.block,
      video_url: c.video_url,
      start_frame: c.start_frame,
      duration_frames: c.duration_frames,
      transition_in: c.transition_in,
      text_overlay: c.text_overlay,
    })),
    pixel_hash: deterministicPixelHash(leadId),
    total_duration_frames: totalFrames,
  };

  const parsed = renderManifestSchema.safeParse(manifestRaw);
  if (!parsed.success) {
    console.error("[a6-vps] manifest inválido:");
    for (const i of parsed.error.issues)
      console.error(`  - ${i.path.join(".")}: ${i.message}`);
    process.exit(3);
  }
  const manifest = parsed.data;

  const runId = randomUUID();
  console.log(`[a6-vps] lead=${leadId} runId=${runId}`);
  console.log(
    `[a6-vps] manifest 720×1280@${manifest.fps}fps total=${manifest.total_duration_frames}f pixel_hash=${JSON.stringify(manifest.pixel_hash)}`,
  );
  for (const c of manifest.clips) {
    console.log(
      `   [${c.block}] start=${c.start_frame} dur=${c.duration_frames}f transition=${c.transition_in}`,
    );
  }

  try {
    const { localPath, telemetry } = await runRemoteRender({ manifest, runId });
    console.log("\n[a6-vps] ✅ RENDER OK");
    console.log(`[a6-vps] MP4_PATH=${localPath}`);
    console.log(`[a6-vps] TELEMETRY=${JSON.stringify(telemetry, null, 2)}`);
  } catch (err) {
    console.error("\n[a6-vps] ❌ FALHA NO RENDER REMOTO:");
    console.error((err as Error).message);
    process.exit(2);
  }
}

main().catch((err) => {
  console.error("[a6-vps] fatal:", err);
  process.exit(1);
});

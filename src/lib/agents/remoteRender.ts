/**
 * remoteRender — Ponte Mac → VPS → Mac para renderização Remotion (Tarefa 10).
 *
 * Fluxo:
 *   1. Baixa os MP4s do FAL.ai (URLs assinadas têm TTL curto — baixar ASAP).
 *   2. Clona o RenderManifest reescrevendo `video_url` para basenames locais
 *      (o Remotion na VPS resolve relativo a /var/www/mrtok/video-renderer/).
 *   3. Persiste o manifest clonado em workspace/video-renderer/manifest.json.
 *   4. Spawna `bash scripts/deploy-render.sh <runId>` com stdio PIPED.
 *   5. Streama linha por linha (readline) para o logger do worker, parseando
 *      linhas-chave `[stage] done in Xs` e `FFPROBE:` para montar telemetry.
 *   6. Em sucesso (exit 0): retorna `{ localPath, telemetry }`.
 *
 * REGRA DE OURO: esta função NÃO toca em Supabase. O worker a6 é quem
 * escreve o result via runAgentTick.
 *
 * Hard boundary: o script `deploy-render.sh` faz o rsync SOMENTE para
 * `100.72.40.35` (CLAUDE.md §4) — este módulo não tem conhecimento do IP.
 */
import { spawn } from "node:child_process";
import { mkdir, writeFile, stat } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createInterface } from "node:readline";
import * as path from "node:path";
import type { RenderManifest, RenderTelemetry } from "@/lib/agents/renderManifest";

const WORKSPACE_DIR = "workspace/video-renderer";
const ASSETS_DIR = `${WORKSPACE_DIR}/assets`;
const MANIFEST_PATH = `${WORKSPACE_DIR}/manifest.json`;
const OUTPUT_DIR = "output/publish_ready";
const DEPLOY_SCRIPT = "scripts/deploy-render.sh";

const RENDER_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutos — worst-case p/ 21s de vídeo 720p.

export interface RunRemoteRenderArgs {
  manifest: RenderManifest;
  runId: string;
}

export interface RunRemoteRenderResult {
  localPath: string;
  telemetry: RenderTelemetry;
}

/**
 * Baixa um MP4 de uma URL FAL.ai para um caminho local via stream.
 * Usa pipeline para aplicar backpressure e evitar buffer na memória.
 */
async function downloadToFile(url: string, destPath: string): Promise<void> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(
      `[remoteRender] fetch ${url} falhou: HTTP ${response.status} ${response.statusText}`,
    );
  }
  if (!response.body) {
    throw new Error(`[remoteRender] fetch ${url} sem body`);
  }
  await pipeline(
    Readable.fromWeb(response.body as import("stream/web").ReadableStream),
    createWriteStream(destPath),
  );
}

/**
 * Parser incremental de linhas do stdout do `deploy-render.sh`.
 * Reconhece:
 *   - `[stage] done in Xs`        → tempo do estágio
 *   - `FFPROBE:W,H,BITRATE`       → dimensões e bitrate do MP4 final
 *   - `OUTPUT_BYTES:N`            → tamanho em bytes do MP4 final
 *   - `REMOTE_LOG:/var/log/...`   → path do log remoto persistente
 */
interface TelemetryAccumulator {
  precheck_ms?: number;
  rsync_up_ms?: number;
  remote_render_ms?: number;
  ffmpeg_metadata_ms?: number;
  rsync_down_ms?: number;
  remote_log_path?: string;
  output_file_bytes?: number;
  ffprobe_width?: number;
  ffprobe_height?: number;
  ffprobe_bitrate_bps?: number;
}

function parseLine(line: string, acc: TelemetryAccumulator): void {
  // Ex: "[precheck] done in 2s"
  const stageMatch = line.match(/^\[(\w+)\]\s+done in\s+(\d+)s\s*$/);
  if (stageMatch) {
    const [, stage, secondsStr] = stageMatch;
    const ms = Number(secondsStr) * 1000;
    switch (stage) {
      case "precheck":
        acc.precheck_ms = ms;
        break;
      case "rsync_up":
        acc.rsync_up_ms = ms;
        break;
      case "remote_render":
        acc.remote_render_ms = ms;
        break;
      case "ffmpeg_metadata":
        acc.ffmpeg_metadata_ms = ms;
        break;
      case "rsync_down":
        acc.rsync_down_ms = ms;
        break;
    }
    return;
  }

  // Ex: "FFPROBE:720,1280,7800000"
  const ffprobeMatch = line.match(/^FFPROBE:(\d+),(\d+),(\d+)\s*$/);
  if (ffprobeMatch) {
    acc.ffprobe_width = Number(ffprobeMatch[1]);
    acc.ffprobe_height = Number(ffprobeMatch[2]);
    acc.ffprobe_bitrate_bps = Number(ffprobeMatch[3]);
    return;
  }

  // Ex: "OUTPUT_BYTES:987654"
  const bytesMatch = line.match(/^OUTPUT_BYTES:(\d+)\s*$/);
  if (bytesMatch) {
    acc.output_file_bytes = Number(bytesMatch[1]);
    return;
  }

  // Ex: "REMOTE_LOG:/var/log/mrtok-render/abc.log"
  const logMatch = line.match(/^REMOTE_LOG:(.+)$/);
  if (logMatch) {
    acc.remote_log_path = logMatch[1].trim();
    return;
  }
}

/**
 * Executa o render remoto via `deploy-render.sh` com streaming de logs.
 */
export async function runRemoteRender(
  args: RunRemoteRenderArgs,
): Promise<RunRemoteRenderResult> {
  const { manifest, runId } = args;

  // --- 1. Preparar diretórios locais ----------------------------------------
  await mkdir(ASSETS_DIR, { recursive: true });
  await mkdir(OUTPUT_DIR, { recursive: true });

  // --- 2. Baixar MP4s do FAL.ai em paralelo ---------------------------------
  const downloads = manifest.clips.map(async (clip) => {
    const localBasename = `${clip.block}.mp4`;
    const localPath = path.join(ASSETS_DIR, localBasename);
    console.log(
      `[a6/render:${runId}] baixando ${clip.block} de ${clip.video_url} → ${localPath}`,
    );
    await downloadToFile(clip.video_url, localPath);
    const st = await stat(localPath);
    if (st.size < 1000) {
      throw new Error(
        `[remoteRender] ${localBasename} baixado com tamanho suspeito: ${st.size} bytes`,
      );
    }
    return { block: clip.block, localBasename };
  });
  const downloaded = await Promise.all(downloads);
  const basenameByBlock = new Map(downloaded.map((d) => [d.block, d.localBasename]));

  // --- 3. Clonar manifest reescrevendo video_url para caminhos relativos ----
  const rewrittenManifest: RenderManifest = {
    ...manifest,
    clips: manifest.clips.map((clip) => ({
      ...clip,
      // Caminho relativo ao workspace do Remotion na VPS:
      // /var/www/mrtok/video-renderer/assets/<block>.mp4
      video_url: `assets/${basenameByBlock.get(clip.block)}`,
    })),
  };
  await writeFile(MANIFEST_PATH, JSON.stringify(rewrittenManifest, null, 2), "utf-8");
  console.log(`[a6/render:${runId}] manifest escrito em ${MANIFEST_PATH}`);

  // --- 4. Spawn do deploy-render.sh com streaming ---------------------------
  const telemetry: TelemetryAccumulator = {};
  const abortController = new AbortController();
  const timeoutId = setTimeout(() => abortController.abort(), RENDER_TIMEOUT_MS);

  const child = spawn("bash", [DEPLOY_SCRIPT, runId], {
    stdio: ["ignore", "pipe", "pipe"],
    signal: abortController.signal,
  });

  const stdoutReader = createInterface({ input: child.stdout, crlfDelay: Infinity });
  const stderrReader = createInterface({ input: child.stderr, crlfDelay: Infinity });

  stdoutReader.on("line", (line) => {
    console.log(`[a6/render:${runId}] ${line}`);
    parseLine(line, telemetry);
  });
  stderrReader.on("line", (line) => {
    console.error(`[a6/render:${runId}] stderr: ${line}`);
    parseLine(line, telemetry);
  });

  const exitCode: number = await new Promise((resolve, reject) => {
    child.on("error", (err) => {
      clearTimeout(timeoutId);
      reject(
        new Error(
          `[remoteRender] spawn do deploy-render.sh falhou: ${err.message}`,
        ),
      );
    });
    child.on("close", (code) => {
      clearTimeout(timeoutId);
      resolve(code ?? -1);
    });
  });

  if (exitCode !== 0) {
    throw new Error(
      `[remoteRender] deploy-render.sh exit=${exitCode} (runId=${runId}). ` +
        `Verifique logs com prefixo [a6/render:${runId}] acima.`,
    );
  }

  // --- 5. Localizar arquivo final e validar telemetry ----------------------
  const localPath = path.join(OUTPUT_DIR, `mrtok_${runId}.mp4`);
  let finalStat;
  try {
    finalStat = await stat(localPath);
  } catch {
    throw new Error(
      `[remoteRender] arquivo final ${localPath} não existe após pull-back`,
    );
  }
  if (finalStat.size < 100_000) {
    throw new Error(
      `[remoteRender] arquivo final ${localPath} suspeito: ${finalStat.size} bytes`,
    );
  }

  // --- 6. Montar telemetry final (fail-closed) -----------------------------
  const required: (keyof TelemetryAccumulator)[] = [
    "precheck_ms",
    "rsync_up_ms",
    "remote_render_ms",
    "ffmpeg_metadata_ms",
    "rsync_down_ms",
    "remote_log_path",
    "output_file_bytes",
    "ffprobe_width",
    "ffprobe_height",
    "ffprobe_bitrate_bps",
  ];
  const missing = required.filter((k) => telemetry[k] === undefined);
  if (missing.length > 0) {
    throw new Error(
      `[remoteRender] telemetry incompleta — faltando: ${missing.join(", ")}. ` +
        `O deploy-render.sh precisa emitir todas as linhas de telemetria.`,
    );
  }

  if (telemetry.ffprobe_width !== 720 || telemetry.ffprobe_height !== 1280) {
    throw new Error(
      `[remoteRender] resolução inválida: ${telemetry.ffprobe_width}×${telemetry.ffprobe_height} (esperado 720×1280)`,
    );
  }
  if (
    telemetry.ffprobe_bitrate_bps! < 6_000_000 ||
    telemetry.ffprobe_bitrate_bps! > 10_500_000
  ) {
    throw new Error(
      `[remoteRender] bitrate fora do sweet spot: ${telemetry.ffprobe_bitrate_bps} bps (esperado 6-10 Mbps)`,
    );
  }

  const finalTelemetry: RenderTelemetry = {
    precheck_ms: telemetry.precheck_ms!,
    rsync_up_ms: telemetry.rsync_up_ms!,
    remote_render_ms: telemetry.remote_render_ms!,
    ffmpeg_metadata_ms: telemetry.ffmpeg_metadata_ms!,
    rsync_down_ms: telemetry.rsync_down_ms!,
    remote_log_path: telemetry.remote_log_path!,
    output_file_bytes: telemetry.output_file_bytes!,
    ffprobe_width: telemetry.ffprobe_width as 720,
    ffprobe_height: telemetry.ffprobe_height as 1280,
    ffprobe_bitrate_bps: telemetry.ffprobe_bitrate_bps!,
  };

  return { localPath, telemetry: finalTelemetry };
}

/**
 * Serviço de dispatch — núcleo compartilhado entre a rota
 * `/api/uploadposts/dispatch` (Tarefa 3) e o Dashboard de QC (Tarefa 4).
 *
 * Mantém o gate de compliance e a sanity-check da Matriz Criativa em
 * UM ÚNICO LUGAR. Toda chamada de dispatch passa por aqui — ninguém
 * deve replicar essa lógica.
 */
import { getEnv } from "@/lib/env";
import { getSupabaseAdmin } from "@/lib/supabase";
import { parseCreativeMatrix } from "@/types/creative-matrix";
import { computeUniquePixelHash } from "@/lib/pixel-hash";
import { notifyAsync } from "@/lib/telegram";
import { dispatchPhotos, UploadPostError } from "@/lib/upload-post";
import type {
  UploadPostPhoto,
  UploadPostPlatform,
} from "@/lib/upload-post-schema";

export interface DispatchInput {
  creative_matrix_id: string;
  caption: string;
  platforms: UploadPostPlatform[];
  photos: UploadPostPhoto[];
  schedule_iso?: string | null;
}

export interface DispatchSuccess {
  ok: true;
  request_id: string;
  hook_performance_id: string;
  unique_pixel_hash: string;
}

export type DispatchFailureCode =
  | "creative_matrix_not_found"
  | "compliance_not_approved"
  | "creative_matrix_corrupted"
  | "upload_post_failed"
  | "hook_performance_insert_failed";

export interface DispatchFailure {
  ok: false;
  code: DispatchFailureCode;
  http_status: number;
  detail: string;
  upstream_status?: number | null;
  upstream_body?: string | null;
  request_id?: string;
}

export type DispatchResult = DispatchSuccess | DispatchFailure;

export async function dispatchCreativeMatrix(
  input: DispatchInput,
): Promise<DispatchResult> {
  const supabase = getSupabaseAdmin();

  const { data: matrix, error: loadErr } = await supabase
    .from("creative_matrix")
    .select("*")
    .eq("id", input.creative_matrix_id)
    .single();

  if (loadErr || !matrix) {
    return {
      ok: false,
      code: "creative_matrix_not_found",
      http_status: 404,
      detail: loadErr?.message ?? "row inexistente",
    };
  }

  // Gate de compliance — CLAUDE.md §4. Inegociável.
  if (!matrix.compliance_approved) {
    return {
      ok: false,
      code: "compliance_not_approved",
      http_status: 412,
      detail:
        "Creative Matrix precisa de compliance_approved=true antes do dispatch (TikTok Shop blindagem).",
    };
  }

  // Defesa em profundidade contra row corrompida.
  try {
    parseCreativeMatrix({
      project_id: matrix.project_id,
      metadata: matrix.metadata,
      hooks_matrix: matrix.hooks_matrix,
      storyboard: matrix.storyboard,
    });
  } catch (err) {
    return {
      ok: false,
      code: "creative_matrix_corrupted",
      http_status: 422,
      detail: (err as Error).message,
    };
  }

  const env = getEnv();
  const orderedPhotos = [...input.photos].sort((a, b) => a.order - b.order);
  const uniqueHash = computeUniquePixelHash(
    matrix.id,
    orderedPhotos.map((p) => p.url),
  );

  let dispatchResult;
  try {
    dispatchResult = await dispatchPhotos({
      profile: env.UPLOAD_POST_PROFILE,
      platforms: input.platforms,
      caption: input.caption,
      photos: orderedPhotos,
      schedule_iso: input.schedule_iso ?? null,
      metadata: {
        project_id: matrix.project_id,
        creative_matrix_id: matrix.id,
        unique_pixel_hash: uniqueHash,
      },
    });
  } catch (err) {
    const isHttp = err instanceof UploadPostError;
    notifyAsync(
      `❌ *MrTok dispatch falhou*\nproject: \`${matrix.project_id}\`\ncreative_matrix: \`${matrix.id}\`\nerro: \`${(err as Error).message}\``,
    );
    return {
      ok: false,
      code: "upload_post_failed",
      http_status: 502,
      detail: (err as Error).message,
      upstream_status: isHttp ? err.status : null,
      upstream_body: isHttp ? err.body : null,
    };
  }

  const platformUrls = input.platforms.reduce<Record<string, null>>(
    (acc, p) => {
      acc[p] = null;
      return acc;
    },
    {},
  );

  const { data: perfRow, error: insertErr } = await supabase
    .from("hook_performance")
    .insert({
      creative_matrix_id: matrix.id,
      request_id: dispatchResult.request_id,
      caption: input.caption,
      platform_urls: platformUrls,
    })
    .select("id")
    .single();

  if (insertErr || !perfRow) {
    notifyAsync(
      `⚠️ *MrTok dispatch parcial*\nrequest_id: \`${dispatchResult.request_id}\` enviado mas hook_performance falhou: \`${insertErr?.message}\``,
    );
    return {
      ok: false,
      code: "hook_performance_insert_failed",
      http_status: 500,
      detail: insertErr?.message ?? "insert falhou",
      request_id: dispatchResult.request_id,
    };
  }

  notifyAsync(
    `🚀 *MrTok dispatch ok*\nproject: \`${matrix.project_id}\`\nrequest_id: \`${dispatchResult.request_id}\`\nplataformas: ${input.platforms.join(", ")}`,
  );

  return {
    ok: true,
    request_id: dispatchResult.request_id,
    hook_performance_id: perfRow.id,
    unique_pixel_hash: uniqueHash,
  };
}

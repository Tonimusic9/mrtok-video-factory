"use server";

/**
 * Server actions do detalhe da Matriz Criativa.
 *
 * `approveAndDispatch` faz dois passos atômicos do ponto de vista do
 * operador:
 *   1. flip `compliance_approved=true` (+ notas opcionais);
 *   2. chama `dispatchCreativeMatrix` (que reaproveita o gate, hash,
 *      persistência em hook_performance e Telegram).
 *
 * Se o dispatch falhar, NÃO revertemos o flip — o operador aprovou
 * conscientemente o conteúdo, e a row aprovada deve permanecer
 * aprovada para retry manual.
 */
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getSupabaseAdmin } from "@/lib/supabase";
import {
  dispatchCreativeMatrix,
  type DispatchResult,
} from "@/lib/dispatch-service";
import {
  uploadPostPhotoSchema,
  uploadPostPlatformSchema,
} from "@/lib/upload-post-schema";

const formSchema = z.object({
  creative_matrix_id: z.string().uuid(),
  caption: z.string().min(1).max(2200),
  compliance_notes: z.string().max(2000).optional(),
  platforms: z.array(uploadPostPlatformSchema).min(1),
  // Operador cola um JSON array de { order, url } no textarea — Tarefa 6
  // (Remotion) substituirá isso por upload automático.
  photos_json: z.string().min(1),
});

export interface ActionState {
  status: "idle" | "ok" | "error";
  message?: string;
  result?: DispatchResult;
}

export async function approveAndDispatch(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = formSchema.safeParse({
    creative_matrix_id: formData.get("creative_matrix_id"),
    caption: formData.get("caption"),
    compliance_notes: formData.get("compliance_notes") || undefined,
    platforms: formData.getAll("platforms"),
    photos_json: formData.get("photos_json"),
  });
  if (!parsed.success) {
    return {
      status: "error",
      message: parsed.error.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join(" · "),
    };
  }

  let photos;
  try {
    const raw = JSON.parse(parsed.data.photos_json);
    photos = z.array(uploadPostPhotoSchema).min(1).parse(raw);
  } catch (err) {
    return {
      status: "error",
      message: `photos_json inválido: ${(err as Error).message}`,
    };
  }

  // Passo 1: flip compliance_approved.
  const supabase = getSupabaseAdmin();
  const { error: updateErr } = await supabase
    .from("creative_matrix")
    .update({
      compliance_approved: true,
      compliance_notes: parsed.data.compliance_notes ?? null,
    })
    .eq("id", parsed.data.creative_matrix_id);

  if (updateErr) {
    return {
      status: "error",
      message: `Falha ao aprovar: ${updateErr.message}`,
    };
  }

  // Passo 2: dispatch.
  const result = await dispatchCreativeMatrix({
    creative_matrix_id: parsed.data.creative_matrix_id,
    caption: parsed.data.caption,
    platforms: parsed.data.platforms,
    photos,
  });

  revalidatePath("/qc");
  revalidatePath(`/qc/${parsed.data.creative_matrix_id}`);
  revalidatePath("/qc/larry-loop");

  if (!result.ok) {
    return {
      status: "error",
      message: `${result.code}: ${result.detail}`,
      result,
    };
  }
  return {
    status: "ok",
    message: `request_id: ${result.request_id}`,
    result,
  };
}

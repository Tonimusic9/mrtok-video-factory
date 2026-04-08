/**
 * Unique Pixel Hash (CLAUDE.md §4 — obrigatório).
 *
 * Gera um identificador único por dispatch para que o pacote enviado
 * ao Upload-Post seja rastreável e distinguível mesmo quando a mesma
 * Matriz Criativa é redistribuída em variantes. O hash de RENDERIZAÇÃO
 * (escala 1.01x, rotação 0.1º) é responsabilidade separada do Agente 6
 * (Remotion); este hash cobre o nível do payload de distribuição.
 */
import { createHash } from "node:crypto";

export function computeUniquePixelHash(
  creativeMatrixId: string,
  orderedPhotoUrls: readonly string[],
  timestampMs: number = Date.now(),
): string {
  const hash = createHash("sha256");
  hash.update(creativeMatrixId);
  hash.update("\n");
  for (const url of orderedPhotoUrls) {
    hash.update(url);
    hash.update("\n");
  }
  hash.update(String(timestampMs));
  return `sha256:${hash.digest("hex")}`;
}

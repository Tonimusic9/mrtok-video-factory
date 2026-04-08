/**
 * Unique Pixel Hash — CLAUDE.md §4 (Estratégia obrigatória).
 *
 * Todo export do Remotion (Agente 6) deve incluir micro-variações aleatórias
 * de escala e rotação para garantir que o hash visual de cada vídeo seja
 * único — driblando a detecção de conteúdo não-original do TikTok Shop que
 * pune re-uploads de IA.
 *
 * Este módulo produz uma assinatura determinística por seed (um render com
 * o mesmo seed produz o mesmo resultado — útil para reprodutibilidade e
 * debugging) mas cada `renderId` recebe um seed novo gerado via
 * `crypto.randomUUID()` no pipeline de render, garantindo que cada export
 * final tenha uma assinatura visual distinta.
 *
 * Intensidades (plafond do CLAUDE.md):
 *   - scale: base 1.0 ± 0.01   → 0.99 a 1.01
 *   - rotation: base 0° ± 0.1° → -0.1° a +0.1°
 *   - translate X/Y: ± 0.5 px  (sub-pixel; imperceptível a olho humano)
 *
 * Essas magnitudes são imperceptíveis visualmente mas suficientes para
 * alterar completamente o hash perceptual (pHash) e o hash de bytes de cada
 * frame exportado.
 */

/** Limites canônicos — NÃO aumentar sem revisão de compliance visual. */
export const HASH_LIMITS = {
  scaleDelta: 0.01,
  rotationDegrees: 0.1,
  translatePx: 0.5,
} as const;

export interface UniquePixelHashConfig {
  scale: number;
  rotationDeg: number;
  translateX: number;
  translateY: number;
  /** Assinatura textual para log/rastreio no banco (hook_performance). */
  signature: string;
  /** Seed original usado (determinístico). */
  seed: string;
}

/**
 * Mulberry32 — PRNG pequeno e rápido, seedável, com distribuição uniforme
 * suficiente para micro-jitter de render (NÃO é criptograficamente seguro,
 * e não precisa ser).
 */
function mulberry32(a: number): () => number {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Converte um seed string para um inteiro de 32 bits (hash DJB2 simples). */
function seedToInt(seed: string): number {
  let h = 5381;
  for (let i = 0; i < seed.length; i++) {
    h = ((h << 5) + h + seed.charCodeAt(i)) | 0;
  }
  return h >>> 0;
}

/**
 * Gera a configuração de Unique Pixel Hash para um render.
 * Mesma seed → mesmo resultado (determinístico / reproduzível).
 */
export function buildUniquePixelHash(seed: string): UniquePixelHashConfig {
  const rng = mulberry32(seedToInt(seed));
  const jitter = (max: number) => (rng() * 2 - 1) * max;

  const scale = 1 + jitter(HASH_LIMITS.scaleDelta);
  const rotationDeg = jitter(HASH_LIMITS.rotationDegrees);
  const translateX = jitter(HASH_LIMITS.translatePx);
  const translateY = jitter(HASH_LIMITS.translatePx);

  const signature = [
    `s${scale.toFixed(5)}`,
    `r${rotationDeg.toFixed(5)}`,
    `tx${translateX.toFixed(3)}`,
    `ty${translateY.toFixed(3)}`,
  ].join("|");

  return { scale, rotationDeg, translateX, translateY, signature, seed };
}

/**
 * Constrói a string `transform` do CSS Remotion a partir da config.
 * Uso em Remotion: `<AbsoluteFill style={{ transform: ... }}>`.
 */
export function hashConfigToCssTransform(cfg: UniquePixelHashConfig): string {
  return `translate(${cfg.translateX.toFixed(3)}px, ${cfg.translateY.toFixed(
    3,
  )}px) rotate(${cfg.rotationDeg.toFixed(5)}deg) scale(${cfg.scale.toFixed(
    5,
  )})`;
}

/**
 * Helper de sanidade — garante que a config respeita os limites canônicos
 * antes do render. Use como assertion no pipeline.
 */
export function assertWithinLimits(cfg: UniquePixelHashConfig): void {
  const scaleDelta = Math.abs(cfg.scale - 1);
  if (scaleDelta > HASH_LIMITS.scaleDelta + 1e-9) {
    throw new Error(
      `[UniquePixelHash] scale ${cfg.scale} fora do limite ±${HASH_LIMITS.scaleDelta}`,
    );
  }
  if (Math.abs(cfg.rotationDeg) > HASH_LIMITS.rotationDegrees + 1e-9) {
    throw new Error(
      `[UniquePixelHash] rotation ${cfg.rotationDeg}° fora do limite ±${HASH_LIMITS.rotationDegrees}°`,
    );
  }
  if (
    Math.abs(cfg.translateX) > HASH_LIMITS.translatePx + 1e-9 ||
    Math.abs(cfg.translateY) > HASH_LIMITS.translatePx + 1e-9
  ) {
    throw new Error(
      `[UniquePixelHash] translate fora do limite ±${HASH_LIMITS.translatePx}px`,
    );
  }
}

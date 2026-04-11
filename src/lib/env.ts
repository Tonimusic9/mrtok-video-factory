/**
 * Loader tipado de variáveis de ambiente do MrTok.
 * Valida a presença das chaves críticas no boot; falha rápida se faltar algo.
 * Ver CLAUDE.md §2 (Infra Híbrida) e §4 (Segurança).
 */
import { z } from "zod";

const envSchema = z.object({
  // Cérebro
  ANTHROPIC_API_KEY: z.string().min(1, "ANTHROPIC_API_KEY ausente (Cérebro Opus 4.6)"),

  // Músculos
  OPENROUTER_API_KEY: z.string().min(1, "OPENROUTER_API_KEY ausente (roteamento híbrido)"),

  // Supabase
  SUPABASE_URL: z.string().url(),
  SUPABASE_ANON_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),

  // Telegram
  TELEGRAM_BOT_TOKEN: z.string().min(1),
  TELEGRAM_CHAT_ID: z.string().min(1),

  // VPS / Tailscale
  VPS_TAILSCALE_IP: z.string().min(1),
  GEMMA_LOCAL_URL: z.string().url(),

  // Worker a7 (Delivery) — Telegram sendDocument
  // Reutiliza TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID já declarados acima.
  // Obrigatório: usar sendDocument (não sendVideo) para preservar metadata
  // do Remotion (Unique Pixel Hash) — Telegram não recomprime documents.

  // Upload-Post (distribuição multi-plataforma — Tarefa 3)
  UPLOAD_POST_API_KEY: z.string().min(1, "UPLOAD_POST_API_KEY ausente"),
  UPLOAD_POST_BASE_URL: z
    .string()
    .url()
    .default("https://api.upload-post.com"),
  UPLOAD_POST_PROFILE: z.string().min(1, "UPLOAD_POST_PROFILE ausente"),

  // Agente CEO (Tarefa 5) — secret do endpoint /api/ceo/tick acionado por cron
  CEO_TICK_SECRET: z.string().min(16, "CEO_TICK_SECRET ausente ou curto demais"),

  // FAL.ai (gateway de vídeo — Tarefa 10, Worker a6)
  FAL_KEY: z.string().min(1, "FAL_KEY ausente (gateway FAL.ai para geração de vídeo)"),

  // Segurança
  ALLOWED_IPS: z.string().min(1, "ALLOWED_IPS deve conter ao menos o range Tailscale"),
  READ_ONLY_MODE: z
    .enum(["true", "false"])
    .default("true")
    .transform((v) => v === "true"),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | null = null;

export function getEnv(): Env {
  if (cached) return cached;
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`[MrTok] Variáveis de ambiente inválidas:\n${issues}`);
  }
  cached = parsed.data;
  return cached;
}

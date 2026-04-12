/**
 * Cliente OpenRouter (Modo Híbrido) — CLAUDE.md §3.
 *
 * O Agente CEO (Opus 4.6) NUNCA processa copy/código pesado diretamente.
 * Toda execução dos "músculos" é delegada via este gateway, que roteia para o
 * modelo correto conforme o agente solicitante.
 *
 * Mapeamento canônico (ver arquitetura_ugc.md):
 *   a0 · Curador de Winners      → Minimax M2.7
 *   a1 · Extrator Multimodal     → Gemini 3 Flash Preview
 *   a2 · Framework (AIDA/PAS)    → Minimax M2.7
 *   a3 · Copywriter PT-BR        → Qwen3 Max
 *   a4 · Diretor de Arte         → Qwen3 Max
 *   a5 · Produtor Visual/Voz     → Minimax M2.7
 *   a6 · Montador CLI            → GLM 5.1
 *   a7 · Deployer                → GLM 5.1
 *   a8 · Analytics / Estrategista → DeepSeek V3.1
 *
 * ARQUITETURA 100% OPEN SOURCE / NON-OPENAI:
 * Nenhum músculo roteia para OpenAI. Todos os agentes usam modelos
 * open-weights ou de laboratórios não-OpenAI (Minimax, Google, Qwen/Alibaba,
 * Z-AI/Zhipu). O único componente closed-source é o Cérebro (Claude Opus 4.6
 * via API direta da Anthropic) — ver CLAUDE.md §2.
 */
import { getEnv } from "@/lib/env";
import type { TaskAgent } from "@/types/database";

/** Slugs OpenRouter — validados contra GET /api/v1/models em 2026-04-08. */
export const MODEL_MAP: Record<Exclude<TaskAgent, "qc" | "ceo">, string> = {
  a0: "minimax/minimax-m2.7",
  a1: "google/gemini-3-flash-preview",
  a2: "minimax/minimax-m2.7",
  a3: "qwen/qwen3-max",
  a4: "qwen/qwen3-max",
  a5: "minimax/minimax-m2.7",
  a6: "z-ai/glm-5.1",
  a7: "z-ai/glm-5.1",
  // a8 — Analytics / Estrategista de ROI (migrado de Gemma 4 local em 2026-04-11
  // para DeepSeek V3.1 via OpenRouter; libera RAM da VPS p/ renders Remotion do a6).
  a8: "deepseek/deepseek-chat-v3.1",
};

export interface OpenRouterMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface OpenRouterCompletionArgs {
  agent: keyof typeof MODEL_MAP;
  messages: OpenRouterMessage[];
  temperature?: number;
  jsonMode?: boolean;
  maxTokens?: number;
}

export interface OpenRouterCompletionResult {
  model: string;
  content: string;
  raw: unknown;
}

const ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";

/**
 * Dispara uma chamada de chat completion no OpenRouter para o agente dado.
 * O CEO não deve chamar isso diretamente — use via /scripts/delegate.
 */
export async function openRouterCompletion(
  args: OpenRouterCompletionArgs,
): Promise<OpenRouterCompletionResult> {
  const env = getEnv();
  const model = MODEL_MAP[args.agent];

  const body: Record<string, unknown> = {
    model,
    messages: args.messages,
    temperature: args.temperature ?? 0.7,
  };
  if (args.maxTokens) body.max_tokens = args.maxTokens;
  if (args.jsonMode) body.response_format = { type: "json_object" };

  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://mrtok.local",
      "X-Title": "MrTok Framework",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`[OpenRouter] ${res.status} ${res.statusText} — ${errText}`);
  }

  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = data.choices?.[0]?.message?.content ?? "";
  return { model, content, raw: data };
}

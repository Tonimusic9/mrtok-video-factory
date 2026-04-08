/**
 * Cliente OpenRouter (Modo Híbrido) — CLAUDE.md §3.
 *
 * O Agente CEO (Opus 4.6) NUNCA processa copy/código pesado diretamente.
 * Toda execução dos "músculos" é delegada via este gateway, que roteia para o
 * modelo correto conforme o agente solicitante.
 *
 * Mapeamento canônico (ver arquitetura_ugc.md):
 *   a0 · Curador de Winners      → Minimax 2.7
 *   a1 · Extrator Multimodal     → Gemini 3 Flash
 *   a2 · Framework (AIDA/PAS)    → GPT-5.4
 *   a3 · Copywriter PT-BR        → Qwen 3.6
 *   a4 · Diretor de Arte         → Qwen 3.6
 *   a5 · Produtor Visual/Voz     → GPT-5.4
 *   a6 · Montador CLI            → GPT-5.4
 *   a7 · Deployer                → GPT-5.4
 */
import { getEnv } from "@/lib/env";
import type { TaskAgent } from "@/types/database";

/** Slugs OpenRouter — validar/atualizar quando os modelos forem publicados. */
export const MODEL_MAP: Record<Exclude<TaskAgent, "qc" | "a8" | "ceo">, string> = {
  a0: "minimax/minimax-2.7",
  a1: "google/gemini-3-flash",
  a2: "openai/gpt-5.4",
  a3: "qwen/qwen-3.6",
  a4: "qwen/qwen-3.6",
  a5: "openai/gpt-5.4",
  a6: "openai/gpt-5.4",
  a7: "openai/gpt-5.4",
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

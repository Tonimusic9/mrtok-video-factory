/**
 * Cliente Gemini para o Worker a0 (Curador de Winners).
 * Tenta API direta primeiro; fallback para OpenRouter se quota excedida.
 */
import { GoogleGenerativeAI } from "@google/generative-ai";
import { getEnv } from "@/lib/env";

let genAI: GoogleGenerativeAI | null = null;

function getGemini(): GoogleGenerativeAI {
  if (genAI) return genAI;
  const env = getEnv();
  genAI = new GoogleGenerativeAI(env.GEMINI_API_KEY);
  return genAI;
}

async function generateViaOpenRouter(prompt: string): Promise<string> {
  const env = getEnv();
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.4,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`OpenRouter error ${res.status}: ${body}`);
  }

  const json = await res.json();
  return json.choices?.[0]?.message?.content ?? "";
}

/**
 * Envia prompt ao Gemini 3.0 Flash. Fallback via OpenRouter se quota excedida.
 */
export async function generateWithGemini(prompt: string): Promise<string> {
  try {
    const ai = getGemini();
    const model = ai.getGenerativeModel({ model: "gemini-2.5-flash" });
    const result = await model.generateContent(prompt);
    return result.response.text();
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("429") || msg.includes("quota")) {
      console.warn("[gemini-client] Quota excedida, fallback para OpenRouter...");
      return generateViaOpenRouter(prompt);
    }
    throw err;
  }
}

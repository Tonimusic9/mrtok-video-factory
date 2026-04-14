/**
 * Worker a0 — Curador de Winners (Topo do Funil).
 *
 * Minera produtos com sinal de PMF via Firecrawl + Gemini 3.0 Flash.
 * Salva leads na tabela `product_leads` e encadeia task para o Worker a1.
 *
 * REGRA DE OURO: este worker NUNCA escreve em `creative_matrix`.
 * Escrita limitada a `product_leads` (leads brutos) e `task_queue` (via chaining).
 *
 * Schema real da tabela product_leads:
 *   id, title, source_url, engagement_score, viral_score, metadata (jsonb), status, created_at
 */
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { runAgentTick, type AgentTickArgs, type AgentTickResult } from "@/lib/agent-runner";
import { scrapeProductPage, type ScrapedProduct } from "@/lib/firecrawl-client";
import { generateWithGemini } from "@/lib/gemini-client";
import { getSupabaseAdmin } from "@/lib/supabase";
import type { Json } from "@/types/database";

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

export const curatorTaskPayloadSchema = z.object({
  category: z.string().min(1),
  search_terms: z.array(z.string().min(1)).min(1),
  source_urls: z.array(z.string().url()).min(1),
});
export type CuratorTaskPayload = z.infer<typeof curatorTaskPayloadSchema>;

/** Output interno da análise Gemini */
const geminiAnalysisSchema = z.object({
  product_data: z.object({
    name: z.string(),
    core_mechanism: z.string(),
    primary_pain_point_solved: z.string(),
    target_audience_br: z.string(),
  }),
  viral_potential_score: z.number().int().min(0).max(100),
  justification: z.string(),
});
type GeminiAnalysis = z.infer<typeof geminiAnalysisSchema>;

// ---------------------------------------------------------------------------
// Prompt para o Gemini
// ---------------------------------------------------------------------------

function buildCurationPrompt(scraped: ScrapedProduct, category: string): string {
  return `Você é um Caçador de Tendências especializado em TikTok Shop Brasil.

Analise o produto abaixo e retorne EXCLUSIVAMENTE um JSON válido (sem markdown, sem comentários):

CATEGORIA: ${category}
TÍTULO: ${scraped.title}
PREÇO: ${scraped.price ?? "desconhecido"}
REVIEWS: ${scraped.reviews_snippet ?? "sem dados"}
DESCRIÇÃO:
${scraped.description}

CONTEÚDO DA PÁGINA (resumido):
${scraped.raw_markdown}

CRITÉRIOS (o produto deve atender pelo menos 2 de 3):
1. Visualmente Satisfatório/Disruptivo nos primeiros 3 segundos
2. Resolve uma Dor Aguda do dia a dia
3. Efeito "Eu Preciso Disso Agora" (ticket R$50-R$150)

FORMATO DE RETORNO (JSON puro):
{
  "product_data": {
    "name": "string",
    "core_mechanism": "Como funciona visualmente em 1 frase",
    "primary_pain_point_solved": "Qual dor resolve",
    "target_audience_br": "Persona brasileira ideal"
  },
  "viral_potential_score": 0-100,
  "justification": "Por que este produto vai vender no Brasil em 1 frase"
}`;
}

// ---------------------------------------------------------------------------
// Lógica de curadoria
// ---------------------------------------------------------------------------

async function curateProduct(
  url: string,
  category: string,
): Promise<{ analysis: GeminiAnalysis; sourceUrl: string }> {
  // 1. Scrape via Firecrawl
  const scraped = await scrapeProductPage(url);

  // 2. Análise via Gemini 3.0 Flash (fallback OpenRouter)
  const prompt = buildCurationPrompt(scraped, category);
  const raw = await generateWithGemini(prompt);

  // 3. Parse do JSON retornado
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error("Gemini não retornou JSON válido");
  }
  const parsed = JSON.parse(jsonMatch[0]);
  const analysis = geminiAnalysisSchema.parse(parsed);

  return { analysis, sourceUrl: url };
}

/**
 * Persiste lead na tabela product_leads (schema real).
 * Campos extras vão no metadata JSONB.
 */
async function persistLead(
  analysis: GeminiAnalysis,
  sourceUrl: string,
): Promise<string> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await (supabase as any)
    .from("product_leads")
    .insert({
      title: analysis.product_data.name,
      source_url: sourceUrl,
      engagement_score: analysis.viral_potential_score,
      viral_score: analysis.viral_potential_score,
      metadata: {
        curation_id: `a0-${randomUUID().slice(0, 8)}`,
        core_mechanism: analysis.product_data.core_mechanism,
        pain_point: analysis.product_data.primary_pain_point_solved,
        target_audience: analysis.product_data.target_audience_br,
        justification: analysis.justification,
      },
      status: "pending",
    })
    .select("id")
    .single();

  if (error || !data) {
    throw new Error(`Falha ao persistir lead: ${error?.message ?? "sem retorno"}`);
  }
  return (data as any).id;
}

// ---------------------------------------------------------------------------
// Resultado tipado para o runner
// ---------------------------------------------------------------------------

interface CuratorResult {
  leads_count: number;
  leads: Array<{
    title: string;
    viral_score: number;
    lead_id: string;
  }>;
  [key: string]: Json | undefined;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export function runWorkerA0Tick(args: AgentTickArgs = {}): Promise<AgentTickResult> {
  return runAgentTick<CuratorTaskPayload, CuratorResult>(
    {
      agent: "a0",
      label: "Curador a0",
      payloadSchema: curatorTaskPayloadSchema,
      process: async (payload) => {
        const leads: CuratorResult["leads"] = [];

        for (const url of payload.source_urls) {
          const { analysis, sourceUrl } = await curateProduct(url, payload.category);
          const leadId = await persistLead(analysis, sourceUrl);

          leads.push({
            title: analysis.product_data.name,
            viral_score: analysis.viral_potential_score,
            lead_id: leadId,
          });
        }

        return {
          kind: "done",
          result: {
            leads_count: leads.length,
            leads,
          },
        };
      },
    },
    args,
  );
}

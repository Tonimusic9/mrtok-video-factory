/**
 * Cliente Firecrawl para o Worker a0 (Curador de Winners).
 * Usa a Firecrawl API para scrape de páginas JS-heavy (TikTok, Amazon, AliExpress).
 */
import { FirecrawlClient } from "@mendable/firecrawl-js";
import { getEnv } from "@/lib/env";

let client: FirecrawlClient | null = null;

export function getFirecrawl(): FirecrawlClient {
  if (client) return client;
  const env = getEnv();
  client = new FirecrawlClient({ apiKey: env.FIRECRAWL_API_KEY });
  return client;
}

export interface ScrapedProduct {
  title: string;
  description: string;
  price: string | null;
  reviews_snippet: string | null;
  raw_markdown: string;
  source_url: string;
}

/**
 * Faz scrape de uma URL de produto e extrai dados estruturados.
 */
export async function scrapeProductPage(url: string): Promise<ScrapedProduct> {
  const fc = getFirecrawl();
  const result = await fc.scrape(url, {
    formats: ["markdown"],
  });

  const md = result.markdown ?? "";

  // Extração heurística do markdown — Gemini refina depois
  const titleMatch = md.match(/^#\s+(.+)/m);
  const priceMatch = md.match(/R\$\s*[\d.,]+|USD\s*[\d.,]+|\$[\d.,]+/i);
  const reviewMatch = md.match(/(\d+)\s*(?:reviews?|avaliações?)/i);

  return {
    title: titleMatch?.[1]?.trim() ?? "Produto sem título",
    description: md.slice(0, 500),
    price: priceMatch?.[0] ?? null,
    reviews_snippet: reviewMatch?.[0] ?? null,
    raw_markdown: md.slice(0, 3000),
    source_url: url,
  };
}

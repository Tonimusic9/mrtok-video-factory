-- ============================================================================
-- MrTok — Migration 0002 (extend hook_performance)
-- Adiciona KPIs crus do TikTok coletados pós-postagem para alimentar o
-- Worker a8 (Analytics · DeepSeek V3.1 via OpenRouter).
--
-- Ingestão v1: manual via dashboard /analytics (admin digita números após
-- postar). Scraping automático via Firecrawl fica para v1.1.
--
-- Observação: mantém `impressions/reach/views_3s/conversions` intactos —
-- `views_3s` continua sendo retenção de hook (métrica de funil interno),
-- `views` novo é o KPI BRUTO do contador público do TikTok.
-- ============================================================================

alter table hook_performance
  add column if not exists views           int  not null default 0,
  add column if not exists likes           int  not null default 0,
  add column if not exists comments        int  not null default 0,
  add column if not exists shares          int  not null default 0,
  add column if not exists collection_date date not null default current_date,
  add column if not exists collected_by    text;  -- 'manual' | 'scrape:firecrawl' (v1.1)

-- Índice para queries temporais do a8 (snapshots do dia / janela móvel).
create index if not exists hook_performance_collection_date_idx
  on hook_performance (collection_date desc);

-- Índice para cruzar um creative_matrix específico com sua série temporal.
create index if not exists hook_performance_matrix_date_idx
  on hook_performance (creative_matrix_id, collection_date desc);

-- ============================================================================
-- MrTok — Migration 0003 (product_leads)
-- Tabela de leads brutos capturados pelo Worker a0 (Curador de Winners).
-- Topo do funil: produtos com sinal de PMF minerados via Firecrawl + Gemini.
-- ============================================================================

create table if not exists product_leads (
  id                   uuid primary key default gen_random_uuid(),
  curation_id          text not null unique,
  title                text not null,
  core_mechanism       text,
  pain_point           text,
  target_audience      text,
  source_url           text not null,
  reference_video_url  text,
  viral_score          integer not null default 0
                         check (viral_score between 0 and 100),
  justification        text,
  metadata             jsonb not null default '{}'::jsonb,
  status               text not null default 'pending'
                         check (status in ('pending','queued','processed','discarded')),
  created_at           timestamptz not null default now()
);

create index if not exists idx_product_leads_status on product_leads(status);
create index if not exists idx_product_leads_viral on product_leads(viral_score desc);

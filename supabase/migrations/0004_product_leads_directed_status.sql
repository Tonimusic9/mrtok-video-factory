-- ============================================================================
-- MrTok — Migration 0004 (product_leads status expansion)
-- Adiciona status 'directed' para leads que passaram pelo Worker a2
-- (Roteirista Criativo) e possuem creative_direction no metadata.
-- ============================================================================

alter table product_leads
  drop constraint if exists product_leads_status_check;

alter table product_leads
  add constraint product_leads_status_check
    check (status in ('pending','queued','processed','directed','discarded'));

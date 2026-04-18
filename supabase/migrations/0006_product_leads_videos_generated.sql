-- ============================================================================
-- MrTok — Migration 0006 (Worker a4 — Seedance 2.0 Image-to-Video)
-- Adiciona status 'videos_generated' para leads cujos keyframes já foram
-- animados em MP4 via Seedance 2.0 (fallback Kling 3.0 Pro) e uploadados para
-- Storage. Cria o bucket público `mrtok-videos` consumido pelo Remotion no a6.
-- ============================================================================

alter table product_leads
  drop constraint if exists product_leads_status_check;

alter table product_leads
  add constraint product_leads_status_check
    check (status in (
      'pending',
      'queued',
      'processed',
      'directed',
      'images_generated',
      'videos_generated',
      'discarded'
    ));

-- Bucket de storage para clipes de cena gerados pelo a4.
-- Público para leitura (consumido direto pelo Remotion no a6).
insert into storage.buckets (id, name, public)
values ('mrtok-videos', 'mrtok-videos', true)
on conflict (id) do nothing;

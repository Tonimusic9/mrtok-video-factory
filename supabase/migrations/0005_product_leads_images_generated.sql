-- ============================================================================
-- MrTok — Migration 0005 (Worker a3 — Nano Banana 2 Image Generation)
-- Adiciona status 'images_generated' para leads que já tiveram keyframes
-- renderizados via Nano Banana 2 (FAL.ai) e uploadados para Storage.
-- Cria também o bucket público `mrtok-images` para servir os keyframes.
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
      'discarded'
    ));

-- Bucket de storage para keyframes gerados pelo a3.
-- Público para leitura (URLs diretas nos manifests a6 / Remotion).
-- Upload restrito ao service_role (workers do backend).
insert into storage.buckets (id, name, public)
values ('mrtok-images', 'mrtok-images', true)
on conflict (id) do nothing;

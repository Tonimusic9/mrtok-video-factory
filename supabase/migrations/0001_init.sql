-- ============================================================================
-- MrTok — Migration 0001 (init)
-- Schemas relacionais do Dashboard/DB conforme /knowledge/mrtok-reverse-engineering.md §3
-- Cobre: Personas, Formats, Scene Library, Task Queue, Creative Matrix, Hook Performance.
-- ============================================================================

-- Extensões ------------------------------------------------------------------
create extension if not exists "pgcrypto";

-- Enums ----------------------------------------------------------------------
do $$ begin
  create type task_status as enum ('pending','in_progress','awaiting_qc','done','failed');
exception when duplicate_object then null; end $$;

do $$ begin
  create type task_agent as enum ('a0','a1','a2','a3','a4','a5','a6','qc','a7','a8','ceo');
exception when duplicate_object then null; end $$;

-- ----------------------------------------------------------------------------
-- 1. personas — arquétipos de voz (Agente 3 · Qwen 3.6 / Agente 5 · Kling 3.0)
-- ----------------------------------------------------------------------------
create table if not exists personas (
  id               uuid primary key default gen_random_uuid(),
  slug             text unique not null,
  display_name     text not null,
  demographic      text,
  voice_profile    text not null,
  speech_quirks    jsonb not null default '[]'::jsonb,
  emotional_range  text[] not null default '{}',
  do_not_say       text[] not null default '{}',
  created_at       timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- 2. formats — frameworks narrativos (Agente 2 · GPT-5.4)
-- ----------------------------------------------------------------------------
create table if not exists formats (
  id              uuid primary key default gen_random_uuid(),
  slug            text unique not null,
  name            text not null,
  framework       text not null,
  slide_count     int not null check (slide_count > 0),
  hook_structure  text not null,
  pacing_seconds  int[] not null default '{}',
  template_json   jsonb not null,
  created_at      timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- 3. scene_library — cenas por categoria (Agente 4 · Qwen 3.6)
--    Enforce realismo do produto via forbidden_elements.
-- ----------------------------------------------------------------------------
create table if not exists scene_library (
  id                  uuid primary key default gen_random_uuid(),
  category            text not null,
  scene_key           text not null,
  visual_prompt       text not null,
  preservation_rules  text[] not null default '{}',
  consistency_locks   jsonb not null,
  forbidden_elements  text[] not null default '{}',
  created_at          timestamptz not null default now(),
  unique (category, scene_key)
);
create index if not exists scene_library_category_idx on scene_library (category);

-- ----------------------------------------------------------------------------
-- 4. task_queue — fila de orquestração do Agente CEO (Opus 4.6)
-- ----------------------------------------------------------------------------
create table if not exists task_queue (
  id              uuid primary key default gen_random_uuid(),
  project_id      text not null,
  agent           task_agent not null,
  status          task_status not null default 'pending',
  payload         jsonb not null,
  result          jsonb,
  error           text,
  parent_task_id  uuid references task_queue(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists task_queue_status_agent_idx on task_queue (status, agent);
create index if not exists task_queue_project_idx on task_queue (project_id);

-- trigger para updated_at
create or replace function set_updated_at() returns trigger as $$
begin
  new.updated_at := now();
  return new;
end $$ language plpgsql;

drop trigger if exists trg_task_queue_updated_at on task_queue;
create trigger trg_task_queue_updated_at
  before update on task_queue
  for each row execute function set_updated_at();

-- ----------------------------------------------------------------------------
-- 5. creative_matrix — saída canônica do Agente 3 (ver agente-3-copywriter.md)
--    Campos obrigatórios: hooks_matrix (com visual_disruptor_trigger +
--    human_imperfections_injection), storyboard (com emotional_beat,
--    visual_prompt, text_overlay, continuity), metadata (com voice_profile).
-- ----------------------------------------------------------------------------
create table if not exists creative_matrix (
  id                     uuid primary key default gen_random_uuid(),
  project_id             text not null,
  persona_id             uuid references personas(id) on delete set null,
  format_id              uuid references formats(id) on delete set null,
  metadata               jsonb not null,
  hooks_matrix           jsonb not null,
  storyboard             jsonb not null,
  compliance_approved    boolean not null default false,
  compliance_notes       text,
  source_task_id         uuid references task_queue(id) on delete set null,
  created_at             timestamptz not null default now(),
  -- Guards estruturais mínimos (JSON Schema leve via jsonb checks)
  constraint hooks_matrix_not_empty check (jsonb_typeof(hooks_matrix) = 'array' and jsonb_array_length(hooks_matrix) >= 3),
  constraint storyboard_not_empty   check (jsonb_typeof(storyboard) = 'array' and jsonb_array_length(storyboard) >= 1),
  constraint metadata_has_voice     check (metadata ? 'voice_profile')
);
create index if not exists creative_matrix_project_idx on creative_matrix (project_id);

-- ----------------------------------------------------------------------------
-- 6. hook_performance — telemetria do Agente 8 (Gemma 4 local)
--    Inclui views_3s (curva de retenção de 3 segundos).
-- ----------------------------------------------------------------------------
create table if not exists hook_performance (
  id                  uuid primary key default gen_random_uuid(),
  creative_matrix_id  uuid references creative_matrix(id) on delete cascade,
  request_id          text,
  caption             text,
  platform_urls       jsonb,
  impressions         int not null default 0,
  reach               int not null default 0,
  views_3s            int not null default 0,
  conversions         int not null default 0,
  hook_failure        boolean,
  cta_failure         boolean,
  measured_at         timestamptz not null default now()
);
create index if not exists hook_performance_matrix_idx on hook_performance (creative_matrix_id);
create index if not exists hook_performance_request_idx on hook_performance (request_id);

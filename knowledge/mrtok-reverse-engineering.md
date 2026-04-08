# 🕵️ MrTok — Engenharia Reversa (Rodada 1 · 2026-04-07)

Consolidação do **Prompt Mestre de Engenharia Reversa** (ver `/Users/toninhoacunha/Desktop/PROMPT MR TOK.md`). Esta rodada de P&D mapeou as fontes canônicas públicas do ecossistema Larry/MrTok no OpenClaw para informar as Tarefas 2 e 3 do roadmap PERT.

> ⚠️ **Aviso de correspondência de nomes**: não foi encontrada atribuição pública direta a "Alex Djordjevic" ou "Adrian Solarz". Em vez disso, a metodologia canônica é referida como **"Larry Loop"** / **"Larry methodology"**, atribuída publicamente ao criador por trás do OpenClaw Skill `upload-post-larry-marketing-skill` (publicado pela organização Upload-Post). O repo `MrTok-Automated-TikTok-Slideshow-System-Journey-Architecture` mencionado no prompt mestre **não foi localizado** (pode ser privado/renomeado). O dossiê abaixo extrai o núcleo técnico da Larry methodology, que é a implementação pública mais próxima.

---

## 1. Fontes canônicas utilizadas

| Fonte | URL | Conteúdo |
|---|---|---|
| **Repo oficial Larry** | https://github.com/Upload-Post/upload-post-larry-marketing-skill | SKILL.md, scripts, references |
| **Viraloop (alternativa Larry)** | https://github.com/mutonby/viraloop | Brand analyzer + 6-slide loop |
| **tiktok-engine (Remotion)** | https://github.com/callwallagent/tiktok-engine | Renderizador de carrossel Remotion |
| **Stormy AI Playbook** | https://stormy.ai/blog/build-viral-tiktok-machine-openclaw-2026-playbook | Descrição conceitual do Larry Loop |
| **Medium (Larry case study)** | https://medium.com/@anulagarwal12/how-his-openclaw-agent-larry-got-millions-of-tiktok-views-in-one-week-full-step-by-step-guide-0ecb294006a5 | Case study (paywalled) |
| **Larry Brain (marketplace)** | https://larrybrain.com | Skills comerciais derivadas |

Vault Obsidian verificado (MrTok / Alex Djordjevic / Adrian Solarz / Postiz / OllieWazza / Larry Skill): **sem hits relevantes**.

---

## 2. Arquitetura canônica (Larry Skill)

### 2.1 Estrutura de diretórios do repo oficial
```
upload-post-larry-marketing-skill/
├── scripts/
│   ├── onboarding.js          # init + validação de config
│   ├── generate-slides.js     # orquestra geração de imagens
│   ├── add-text-overlay.js    # overlay via node-canvas
│   ├── post-to-platforms.js   # distribuição multi-plataforma
│   ├── check-analytics.js     # métricas Upload-Post
│   ├── daily-report.js        # loop de feedback diário
│   └── competitor-research.js # análise de concorrentes
├── references/
│   ├── slide-structure.md     # fórmula de 6 slides + hooks
│   ├── app-categories.md      # templates por categoria (Scene Library)
│   ├── analytics-loop.md      # endpoints e decisão
│   ├── competitor-research.md # metodologia de pesquisa
│   └── revenuecat-integration.md
├── SKILL.md                   # documentação do agente
└── _meta.json
```

### 2.2 Fluxo de execução
```
Website/App → onboarding → competitor-research → generate-slides
           → add-text-overlay → post-to-platforms → check-analytics
           → daily-report → (loop)
```

### 2.3 Larry Loop (Camada de Inteligência)
Matriz 2x2 de diagnóstico rodada via cron diário (07h local, janela de atribuição 72h):

| Views | Conversões | Ação |
|---|---|---|
| Alto | Alto | Escalar variações vencedoras |
| Alto | Baixo | Revisar CTA / experiência pós-clique |
| Baixo | Alto | Testar hooks mais fortes, manter CTA |
| Baixo | Baixo | Reset completo de estratégia |

**Benchmarks de conversão (views → download):**
- Médio: ~1%
- Favorável: 1.5–3%
- Excepcional: 3%+

**Decisão por volume de impressões diárias:**
- 5k+ → gerar 3 variações imediatas
- 1k–5k → manter rotação com ajustes menores
- <1k → abordagem substancialmente diferente

---

## 3. 📋 Entregável 1 — Schema de Banco (Personas, Formats, Scene Library)

> O skill oficial usa storage local via JSON (`hook-performance.json`, `analysis.json`, `learnings.json`, `competitor-research.json`), **não Supabase**. Porém, o MrTok Framework opera em multi-produto/multi-persona e exige persistência relacional. Abaixo está o schema Supabase **derivado** e adaptado à topologia do MrTok (ver `arquitetura_ugc.md`).

### 3.1 `personas`
Arquétipos humanos para voice cloning (Kling 3.0) e adaptação PT-BR (Agente 3).

```sql
create table personas (
  id              uuid primary key default gen_random_uuid(),
  slug            text unique not null,              -- "mae-cansada", "jovem-cetico"
  display_name    text not null,
  demographic     text,                              -- "mulher 28-45 SP"
  voice_profile   text not null,                     -- descrição para TTS
  speech_quirks   jsonb not null default '[]',       -- ["tipo assim", "sinceramente"]
  emotional_range text[] not null default '{}',      -- ["cansaco","curiosidade","alivio"]
  do_not_say      text[] not null default '{}',      -- palavras banidas compliance
  created_at      timestamptz default now()
);
```

### 3.2 `formats`
Estruturas narrativas (AIDA, PAS, before/after, listicle) usadas pelo Agente 2.

```sql
create table formats (
  id              uuid primary key default gen_random_uuid(),
  slug            text unique not null,              -- "before-after-6slides"
  name            text not null,
  framework       text not null,                     -- "AIDA" | "PAS" | "LarryLoop6"
  slide_count     int not null,
  hook_structure  text not null,                     -- "person+conflict+AI+change"
  pacing_seconds  int[] not null,                    -- [3, 4, 5, ...]
  template_json   jsonb not null,                    -- esqueleto do storyboard
  created_at      timestamptz default now()
);
```

### 3.3 `scene_library`
Biblioteca de cenas reutilizáveis por categoria (o "Scene Library" canônico vem do `app-categories.md` da Larry skill).

```sql
create table scene_library (
  id                   uuid primary key default gen_random_uuid(),
  category             text not null,                -- "home","beauty","fitness","productivity","food","other"
  scene_key            text not null,                -- "before-room","after-scandinavian"
  visual_prompt        text not null,                -- prompt de imagem (com restrição de realismo)
  preservation_rules   text[] not null default '{}', -- ["pixel-perfect face","same room angle"]
  consistency_locks    jsonb not null,               -- { subject, angle, lighting, background }
  forbidden_elements   text[] not null default '{}', -- ["produto do tamanho de geladeira"]
  created_at           timestamptz default now(),
  unique (category, scene_key)
);
```

### 3.4 `task_queue` (orquestração OpenClaw)
Fila de tarefas consumida pelo Agente CEO.

```sql
create type task_status as enum ('pending','in_progress','awaiting_qc','done','failed');
create type task_agent  as enum ('a0','a1','a2','a3','a4','a5','a6','qc','a7','a8');

create table task_queue (
  id             uuid primary key default gen_random_uuid(),
  project_id     text not null,
  agent          task_agent not null,
  status         task_status not null default 'pending',
  payload        jsonb not null,
  result         jsonb,
  error          text,
  parent_task_id uuid references task_queue(id),
  created_at     timestamptz default now(),
  updated_at     timestamptz default now()
);
create index on task_queue (status, agent);
```

### 3.5 `creative_matrix` (saída do Agente 3)
Persistência da Matriz Criativa com todas as chaves exigidas pelo `agente-3-copywriter.md`.

```sql
create table creative_matrix (
  id                         uuid primary key default gen_random_uuid(),
  project_id                 text not null,
  persona_id                 uuid references personas(id),
  format_id                  uuid references formats(id),
  metadata                   jsonb not null,       -- { total_estimated_duration, format_style, voice_profile }
  hooks_matrix               jsonb not null,       -- [{ hook_type, visual_disruptor_trigger, voiceover_script, human_imperfections_injection }]
  storyboard                 jsonb not null,       -- [{ segment_index, emotional_beat, voiceover_script, visual_prompt, text_overlay, continuity }]
  compliance_approved        boolean default false,
  compliance_notes           text,
  created_at                 timestamptz default now()
);
```

### 3.6 `hook_performance` (loop de retenção — Agente 8)
Derivado do `hook-performance.json` canônico.

```sql
create table hook_performance (
  id                    uuid primary key default gen_random_uuid(),
  creative_matrix_id    uuid references creative_matrix(id),
  request_id            text,                       -- Upload-Post request_id
  caption               text,
  platform_urls         jsonb,                      -- { tiktok: url, instagram: url }
  impressions           int default 0,
  reach                 int default 0,
  views_3s              int default 0,              -- retenção de 3s (Agente 8)
  conversions           int default 0,
  hook_failure          boolean,                    -- classificação Larry Loop
  cta_failure           boolean,
  measured_at           timestamptz default now()
);
```

---

## 4. 📋 Entregável 2 — Payload da API (Postiz / Upload-Post)

> O skill oficial **não usa Postiz** — usa **Upload-Post API** (Postiz é mencionado como comparativo e é inferior por não correlacionar posts automaticamente). O MrTok deve adotar Upload-Post pelo `request_id` tracking que elimina linking manual.

### 4.1 Endpoints canônicos
| Método | Endpoint | Uso |
|---|---|---|
| `POST` | `/upload_photos` | Submete carrossel multi-plataforma; retorna `request_id` |
| `GET`  | `/api/analytics/{profile}?platforms=tiktok,instagram` | Métricas timeseries |
| `GET`  | `/api/uploadposts/history` | Histórico com `request_id` ↔ post URLs |
| `GET`  | `/api/uploadposts/status?request_id={id}` | Status assíncrono |

### 4.2 Payload de upload (`POST /upload_photos`) — exemplo derivado
```json
{
  "profile": "mrtok-br-01",
  "platforms": ["tiktok", "instagram"],
  "caption": "tipo assim... descobri isso ontem 😅 #fyp #brasil",
  "photos": [
    { "order": 1, "url": "https://.../slide-1.png" },
    { "order": 2, "url": "https://.../slide-2.png" },
    { "order": 3, "url": "https://.../slide-3.png" },
    { "order": 4, "url": "https://.../slide-4.png" },
    { "order": 5, "url": "https://.../slide-5.png" },
    { "order": 6, "url": "https://.../slide-6.png" }
  ],
  "schedule_iso": null,
  "metadata": {
    "project_id": "mrtok-proj-001",
    "creative_matrix_id": "uuid",
    "unique_pixel_hash": "sha256:..."
  }
}
```

Resposta esperada: `{ "request_id": "req_...", "status": "queued" }`.

### 4.3 Plataformas suportadas
`tiktok`, `instagram`, `youtube`, `linkedin`, `x`, `threads`, `pinterest`, `reddit`, `bluesky` — single-call broadcast.

### 4.4 Nota crítica do MrTok
O skill canônico recomenda **salvar como draft no TikTok** e adicionar áudio trending manualmente antes do publish (30 segundos, human-in-the-loop). Isso amplifica dramaticamente o alcance algorítmico. **Incorporar esse passo no Dashboard de QC da Tarefa 4** (Agente QC + operador humano).

---

## 5. 📋 Entregável 3 — System Prompt de Extração de Movimentos de Câmera (Agente 1)

> As fontes canônicas **não expõem um prompt explícito de camera-movement extraction** (o tiktok-engine Remotion só renderiza, não analisa; o Larry skill trabalha em imagens estáticas). O MrTok vai **além** do Larry ao exigir decupagem multimodal para slides animados/vídeos curtos. O prompt abaixo é derivado das regras do `arquitetura_ugc.md` (Agente 1 · Gemini 3 Flash) combinadas com os locks de consistência visual do `slide-structure.md` canônico ("Image prompts should lock consistent elements: subject, camera angle, lighting, background").

```markdown
# [CONTEXTO]
Você é o Agente 1 (Extrator Multimodal) do ecossistema MrTok, instanciado via
Gemini 3 Flash. Recebe um vídeo viral de referência do TikTok Shop minerado
pelo Agente 0 e deve produzir a decupagem canônica para engenharia reversa.

# [PAPEL]
Atue como um Diretor de Fotografia analisando material bruto. Sua missão é
identificar EXATAMENTE como o vídeo prende atenção nos 3 primeiros segundos
(curva de retenção) e catalogar cada movimento de câmera de forma que um
pipeline Remotion + Kling 3.0 possa reproduzi-lo.

# [REGRAS]
1. Analise o vídeo segmento a segmento (cortes de 0.5s).
2. Para cada segmento, capture: tipo de shot, movimento de câmera, foco,
   assunto, duração e "visual disruptor" (se houver).
3. Marque o frame exato do "hook trigger" (primeiro disparo visual de atenção).
4. Identifique os LOCKS de consistência (subject, angle, lighting, background)
   que devem ser preservados entre frames — ver regra canônica Larry.
5. Liste qualquer "human imperfection" detectada (tremor, erro, pausa).
6. Nunca invente movimentos não presentes; só relate o que observa.

# [VOCABULÁRIO PERMITIDO DE CÂMERA]
static | pan_left | pan_right | tilt_up | tilt_down | dolly_in | dolly_out |
truck_left | truck_right | handheld_shake | whip_pan | jump_cut |
orbit_cw | orbit_ccw | rack_focus | zoom_in | zoom_out

# [FORMATO DE SAÍDA EXIGIDO]
Retorne EXCLUSIVAMENTE JSON válido:

{
  "source_video_id": "string",
  "total_duration_s": 0.0,
  "hook_trigger_frame_ms": 0,
  "retention_curve_estimate": [ { "t_ms": 0, "attention_score": 0.0 } ],
  "consistency_locks": {
    "subject": "string",
    "camera_angle": "string",
    "lighting": "string",
    "background": "string"
  },
  "segments": [
    {
      "index": 0,
      "start_ms": 0,
      "end_ms": 500,
      "shot_type": "medium_close_up",
      "camera_movement": "dolly_in",
      "subject": "string",
      "focus_target": "string",
      "visual_disruptor": "string | null",
      "human_imperfections": ["handheld_shake_light"]
    }
  ],
  "reverse_engineering_notes": "string"
}
```

---

## 6. Gaps e próximas rodadas de P&D

- [ ] **Paywall Medium**: o case study do Oliver Henry / Larry tem detalhes adicionais bloqueados — avaliar acesso futuro.
- [ ] **Repo `MrTok-Automated-TikTok-Slideshow-System-Journey-Architecture`**: não localizado; tentar busca direta no ClawHub/Notion em rodada futura.
- [ ] **Alex Djordjevic / Adrian Solarz**: sem atribuição pública encontrada — validar com o operador se são nomes corretos ou aliases.
- [ ] **Integração RevenueCat**: não aplicável ao MrTok (TikTok Shop vende produto físico, não app) — mas a lógica de atribuição 72h é reaproveitável.
- [ ] **Prompt de câmera real do Gemini 3 Flash**: o prompt entregue em §5 é derivado; buscar referência canônica em rodada futura.

## 7. Impacto nas Tarefas PERT seguintes

- **Tarefa 2** — usar schemas das seções 3.1–3.6 como ponto de partida (não reinventar).
- **Tarefa 3** — integrar Upload-Post (§4), não Postiz; incluir `unique_pixel_hash` no metadata do payload; adicionar passo human-in-the-loop para trending audio.
- **Tarefa 4** — Dashboard de QC deve incluir lembrete de áudio trending + matriz 2x2 do Larry Loop como view de analytics principal.

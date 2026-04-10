# Bíblia de Retomada — MrTok AIGC Video Factory

> Gerado em: 2026-04-09 | Fontes: Obsidian Session Logs (Tarefas 5, 9, 10) + estado atual do repositório.

---

## 1. Estado dos Workers

| Worker | Responsabilidade | LLM (via OpenRouter) | Smoke Test | Status |
|--------|-----------------|----------------------|-----------|--------|
| **a3** (Scriptwriter) | Gera roteiro hook/body/cta | Qwen3 Max | ✅ exit 0 em ~12s | Operacional |
| **a4** (Diretor de Arte) | Storyboard 3 shots EN + negative_prompt | Qwen3 Max | ✅ exit 0 em ~24s | Operacional |
| **a5** (Produtor Visual/Voz) | ProductionSpec com voz SSML PT-BR + video_generation por shot | Minimax M2.7 | ✅ exit 0 em ~48s | Operacional |
| **a6** (Montador CLI) | FAL.ai paralelo → GLM 5.1 RenderManifest → Remotion | GLM 5.1 | ✅ exit 0 em ~28s (`dry_run=true`) | Operacional (dry_run) |
| a0, a1, a2, a7 | — | — | — | ❌ Não implementados |

### Detalhes do a6 (modo dry_run)

O smoke do a6 (`scripts/smoke-a6.ts`) roda em `dry_run: true`:

- LLM real (GLM 5.1 via OpenRouter) é chamado → RenderManifest gerado.
- FAL.ai **skipado** → sem geração de vídeo real, sem custo de mídia.
- Remotion render **skipado** → retorna manifest + URL placeholder.

Para execução real: `FAL_KEY` deve ser preenchido em `.env.local` e `dry_run` removido do payload.

### Regra de Ouro (invariante crítica)

**Todos os workers (a3–a6) têm zero escrita em `creative_matrix`.** Cada smoke test audita isso com snapshot global antes/depois. Violação = smoke falha.

---

## 2. Decisões de Engenharia

### 2.1 Claim Atômico do CEO

**Implementação:** `UPDATE task_queue SET status='in_progress' WHERE id=? AND status='pending' RETURNING id`

- **Por quê:** Supabase REST não expõe `SELECT FOR UPDATE`. O update condicional garante *exactly-once* entre ticks concorrentes sem lock explícito.
- **Consequência:** Dois ticks paralelos processam tasks diferentes — nunca a mesma. Verificado: `xargs -P2` pendente em staging.
- **Caso de borda `dispatch_ok + task_update_failed`:** Task é marcada `failed` com prefixo `task_update_failed_after_dispatch:` + `request_id` no Telegram para reconciliação manual. O dispatch já efetuado **nunca é revertido**.
- **Arquivo:** `src/lib/ceo-orchestrator.ts` → `processCeoTask()`

### 2.2 Proteção de Segredos via Tailscale + Proxy

**Arquitetura de defesa em duas camadas:**

1. **Camada 1 — Tailscale:** Toda entrada na VPS (`100.72.40.35`) passa pelo `proxy.ts` (Next.js Middleware). Requisições de IPs externos ao mesh Tailscale são bloqueadas antes de atingir qualquer rota.
2. **Camada 2 — `CEO_TICK_SECRET`:** Header `x-ceo-secret` obrigatório (≥16 chars) em `POST /api/ceo/tick`. Mesmo dentro da rede Tailscale, sem o secret a rota retorna 401.
3. **Variáveis de ambiente:** Nenhum token/key no código. Tudo em `.env.local` (gitignored). `.env.example` documentado.

**Arquivo relevante:** `src/app/api/ceo/tick/route.ts`, `src/lib/env.ts`

### 2.3 Runner Genérico (`runAgentTick`)

Todos os workers (a3, a4, a5, a6) são wrappers finos sobre `src/lib/agent-runner.ts`:

```
select FIFO → claim atômico → validar payload Zod → process → done/failed → notificar Telegram
```

O CEO foi refatorado para também consumir o runner, preservando a Regra de Ouro via outcome `already_persisted`.

### 2.4 Unique Pixel Hash (obrigatório por CLAUDE.md §4)

Implementado em `remotion/src/PixelHashWrapper.tsx` via CSS transform:

```
scale(${s}) rotate(${r}deg)
s ∈ [1.005..1.015]  |  r ∈ [-0.15..0.15]°
```

Gerado randomicamente pelo GLM 5.1 dentro do RenderManifest. Garante hash única por exportação para blindagem algorítmica do TikTok Shop.

---

## 3. Mapeamento de Gaps

### 3.1 Dependências citadas no CLAUDE.md não instaladas

| Componente | Citado em | Status |
|-----------|-----------|--------|
| **OpenClaw** (orquestrador de cron) | §2, §3 | ❌ Não instalado no repo local. Roda separado na VPS Hostinger. |
| **OpenMontage** (manifestos Remotion) | §3 | ❌ Não encontrado em `package.json` nem em nenhum arquivo do repo. Pode ser um sistema futuro ou interno à VPS. |
| `@launchpad/shared` (componentes Remotion) | §3 | ❌ Não encontrado em `package.json`. Componentes Remotion foram desenvolvidos diretamente em `remotion/src/` (MrTokVideo, PixelHashWrapper, Root). |

> **Nota:** OpenMontage e `@launchpad/shared` são referências do CLAUDE.md que provavelmente representam **naming intenção futura** — o equivalente funcional foi construído internamente. Confirmar com o professor sênior se devem ser extraídos como pacotes.

### 3.2 Workers não implementados

Workers **a0, a1, a2, a7** não possuem arquivos em `src/workers/` nem em `src/lib/agents/`. A ordem de implementação não está definida no CLAUDE.md.

### 3.3 Remotion render real

O worker a6 ainda não integra `@remotion/renderer` para render real. Retorna manifest + URL placeholder. Remotion está instalado (`"remotion": "^4.0.447"`) mas o step de renderização programática é pendente.

### 3.4 Smoke de pipeline encadeado

`smoke-pipeline-a3-a4-a5-a6.ts` não existe. Cada smoke é isolado. Pipeline end-to-end só será validado quando o CEO despachar a cadeia completa em staging.

### 3.5 Route handlers / cron de produção

Os workers são drenáveis via função (`runWorkerA3Tick`, etc.) mas não há route handlers `POST /api/worker-aX/tick` nem entradas de cron na VPS para os workers a3–a6. O CEO tem seu endpoint, os workers ainda não.

---

## 4. Conexão com a Nova Arquitetura de LLMs

### 4.1 Modelos operacionais (confirmados por smoke tests)

| Modelo | Worker | Roteamento | Status |
|--------|--------|-----------|--------|
| **Qwen3 Max** | a3 (Scriptwriter) + a4 (Diretor de Arte) | OpenRouter | ✅ Operacional |
| **Minimax M2.7** | a5 (Produtor Visual/Voz) | OpenRouter | ✅ Operacional |
| **GLM 5.1** (Z-AI) | a6 (RenderManifest) | OpenRouter | ✅ Operacional |
| **Claude Opus 4.6** | CEO / Orquestrador (Cérebro) | API Direta Anthropic | ✅ Operacional |

### 4.2 GPT-5.4 — Totalmente descartado

**Não existe referência a GPT-5.4 (ou qualquer modelo OpenAI) em nenhum arquivo do repositório.** A estratégia híbrida 100% open-source / non-OpenAI para os workers foi adotada desde o início da Tarefa 6 e confirmada nos 4 smokes. O CLAUDE.md §2 documenta explicitamente: *"100% Open Source / Non-OpenAI"* para os workers.

### 4.3 FAL.ai — Gateway de geração de mídia

Providers configurados: `kling`, `seedance`, `hailuo`, `veo`, `nano-banana`. Mapa canônico em `src/lib/agents/productionSpec.ts` (`FAL_SLUG_BY_PROVIDER`). Fallback chain implementado no worker a6.

---

## 5. Próximos Passos Recomendados

1. **Render real no a6** — Integrar `@remotion/renderer` + testar com `FAL_KEY` real.
2. **Definir próximos workers** — Escolher entre a0, a1, a2, a7 (sequência não documentada).
3. **Route handlers para workers** — Criar endpoints `POST /api/worker-aX/tick` para cada worker, espelhando o CEO.
4. **Clarificar OpenMontage / @launchpad/shared** — Confirmar se são repos a clonar ou naming interno.
5. **Smoke encadeado** — `smoke-pipeline-a3-a6.ts` para validar a cadeia completa antes de produção.
6. **Cron na VPS** — Configurar ticks dos workers via OpenClaw apontando para `http://100.72.40.35:3000/api/worker-aX/tick`.

---

*Fontes: Session logs Obsidian `2026-04-08-mrtok-tarefa5-agente-ceo.md`, `2026-04-09-mrtok-tarefas-6-7-8.md`, `2026-04-09-mrtok-tarefa-9-worker-a5.md`, `2026-04-09-mrtok-tarefa-10-worker-a6.md` + leitura direta do repositório.*

# CLAUDE.md — MrTok Framework

## 1. Project Description
**Projeto:** MrTok (TikTok Shop BR – AIGC Video Factory).
**Objetivo:** Fábrica autônoma de UGC orquestrada via OpenClaw, desenhada para alta conversão e **blindagem algorítmica** contra punições do TikTok Shop (shadowbans por IA não original ou propaganda enganosa).

## 2. File Structure & Infrastructure
- **VPS Hostinger (Tailscale):** `100.72.40.35`
- **Dashboard/DB:** Next.js + Supabase.
- **Estratégia de LLMs (Híbrida):** - **Cérebro (Orquestração/QC):** Claude Opus 4.6 via API Direta (Anthropic).
  - **Músculos (Execução):** Roteamento via OpenRouter. **100% Open Source / Non-OpenAI** — todos os Agentes Workers (a0–a7) rodam em modelos open-weights ou de laboratórios não-OpenAI (Minimax M2.7, Google Gemini 3 Flash, Qwen3 Max, Z-AI GLM 5.1), eliminando gargalos de rate limit da OpenAI e os estrangulamentos de contexto associados. Único componente closed-source é o Cérebro (Opus).
  - **Analytics Local:** Gemma 4 rodando na VPS Hostinger.
- Pastas: `/raw`, `/knowledge`, `/templates`, `/workspace/video-renderer`, `/scripts`, `/output`.
- **Distribuição multi-plataforma:** Upload-Post API (`UPLOAD_POST_API_KEY`, `UPLOAD_POST_BASE_URL`, `UPLOAD_POST_PROFILE`) — escolhido sobre Postiz pelo `request_id` tracking automático.

## 3. Coding Conventions
- **Orquestração:** OpenClaw com notificações assíncronas via módulo Telegram.
- **Modo Híbrido OpenRouter:** Uso mandatório do gateway para roteamento granular. O Agente CEO deve delegar tarefas de execução aos sub-agentes via OpenRouter, nunca processando copy ou código pesado na API do Opus.
- **Montagem:** O Remotion (Agente 6) usa manifestos do `OpenMontage` e componentes do `@launchpad/shared`.

## 4. Rules & Constraints
- **Segurança da VPS:** Sandbox ativa no OpenClaw, portas públicas bloqueadas.
- **Integridade e Verossimilhança do Produto (CRÍTICO):** É TERMINANTEMENTE PROIBIDO gerar imagens ou roteiros que exagerem o produto ou prometam funções irreais. Compliance total com TikTok Shop.
- **Estratégia Unique Pixel Hash (Obrigatório):** Todo código de renderização do Remotion deve incluir modificadores aleatorizados (escala 1.01x, rotação 0.1º) para garantir hash única por exportação.
- **Fator Humano Obrigatório:** A propriedade `human_imperfections_injection` no JSON do Agente 3 é obrigatória para simular criadores reais.
- **Fluxo PERT:** Trabalhe exclusivamente seguindo o fluxo: Plan, Execute, Review, Test.

## 5. Status do Pipeline (Tarefas)
- ✅ **Tarefa 1** — Scaffold Next.js 16 + infra base + skills.
- ✅ **Tarefa 2** — Schemas Supabase + tipos da Matriz Criativa + webhook agente-0.
- ✅ **Tarefa 3** — Integração Upload-Post + migração middleware → proxy.ts.
- ✅ **Tarefa 4** — Dashboard QC + extração de `dispatch-service` compartilhado.
- ✅ **Tarefa 5** — Agente CEO (orquestrador autônomo de dispatch). E2E validado em runtime; regra de auditoria (`compliance_approved` imutável em falha) confirmada.
- 🚧 **Tarefa 6** — Agentes Músculo via OpenRouter. Em andamento: estrutura inicial do Scriptwriter (`src/lib/agents/scriptwriter.ts`) com contrato Zod (hook/body/cta) e roteamento `a3 → Qwen 3.6`. Próximo passo: brainstorming de prompt + few-shots e integração com a fila `task_queue`.

## 6. Git Recovery (2026-04-08)
Durante a Tarefa 6, a ref `refs/heads/main` foi zerada por um processo desconhecido entre dois commits, fazendo `git status` reportar "No commits yet" e tentar criar um root commit órfão (`ce42dea`) com o projeto inteiro. Recovery executado em três passos:
1. `git reset --soft 55868b0` — restaurou o ponteiro `main` ao histórico linear (tarefas 1–5 + setup Tarefa 6) sem perder o staged set.
2. `git commit` — criou `c5c6cf1 chore: instalação de skills de contexto e mestre-statusbar` em cima do histórico restaurado.
3. **Tag de segurança `tarefa-6-setup`** criada apontando `c5c6cf1` — âncora caso a ref morra de novo: recovery vira `git update-ref refs/heads/main tarefa-6-setup`.
4. **Remote `origin` removido** — apontava para `d0cc06a` (commit "chore: inicializa repositório", desconectado do nosso histórico, possivelmente fonte do reset). Repo agora é puramente local.

Histórico final estável: `c5c6cf1 → 55868b0 → 55698a5 → b55ce7d → 76d4eb9 → faa8cbf → e59db12 → 5df3d04`.

# MrTok — AIGC Video Factory (TikTok Shop BR)

Fábrica autônoma de UGC orquestrada via **OpenClaw**, desenhada para alta conversão e **blindagem algorítmica** contra shadowbans do TikTok Shop.

## Infraestrutura Híbrida
- **Cérebro / QC** — Claude Opus 4.6 (API Anthropic)
- **Músculos** — OpenRouter (GPT-5.4 · Qwen 3.6 · Minimax 2.7 · Gemini 3 Flash)
- **Analytics** — DeepSeek V3.1 via OpenRouter (stateless, fora da VPS)

## Pilares de Blindagem
1. **Compliance TikTok Shop** — Agente 3 proíbe promessas irreais; `visual_prompt` sempre reflete o produto físico real.
2. **Unique Pixel Hash** — Remotion injeta micro-variações de escala/rotação a cada export, garantindo hash única.
3. **Fator Humano** — `human_imperfections_injection` obrigatório na Matriz Criativa (pausas, hesitações, tom natural).

## Estrutura de pastas
- `/raw` — assets brutos minerados pelo Agente 0
- `/knowledge` — Personas, Formats, Scene Library
- `/templates` — templates JSON da Matriz Criativa e manifestos OpenMontage
- `/workspace/video-renderer` — projeto Remotion (Agente 6)
- `/scripts` — automações locais de delegação OpenRouter
- `/output` — vídeos finais renderizados
- `/src` — aplicação Next.js (dashboard + API routes)

## Documentação
- `CLAUDE.md` — framework, convenções e regras inegociáveis
- `.claude/skills/arquitetura_ugc.md` — topologia completa dos agentes
- `.claude/skills/agente-3-copywriter.md` — prompt do Agente 3 (Qwen 3.6)

## Setup local
```bash
cp .env.example .env.local   # preencher chaves
npm install
npm run dev                  # http://localhost:3000
```

## Workflow PERT
Plan → Execute → Review → Test. Cada tarefa **pausa** para revisão antes de avançar.

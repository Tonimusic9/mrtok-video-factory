CLAUDE.md — MrTok Framework
1. Project Description
MrTok é uma fábrica autônoma de conteúdo UGC para TikTok Shop BR, orquestrada via OpenClaw. O sistema automatiza o ciclo completo: da mineração de produtos à postagem final.

Target Audience: Anunciantes e agências que buscam escala com criativos nativos (9:16, Slideshow, Reels).

Problem Solved: Elimina o tempo de criação manual e reduz drasticamente o risco de shadowbans por "conteúdo não original".

Value Prop: Blindagem algorítmica através de Unique Pixel Hash e injeção de comportamento humano no copy e áudio.

2. File Structure
Infrastructure: VPS Hostinger (100.72.40.35) acessível apenas via Tailscale.

src/: Núcleo Next.js contendo a lógica de agentes, workers e schemas Zod.

remotion/: Ambiente de renderização com composições TSX e o PixelHashWrapper.tsx.

workspace/video-renderer/: Repositórios clonados como OpenMontage e componentes @trycua/launchpad.

scripts/: Testes de fumaça (smoke-aX.ts) e o script crítico deploy-render.sh.

knowledge/ & templates/: Documentação de compliance, prompts e especificações de vídeo.

3. Coding Conventions
Stack de Modelos (Ecossistema Híbrido):

Cérebro (CEO / Gatekeeper QC): Claude Opus 4.6 (API Direta Anthropic) - Auditoria visual e orquestração.

Worker (a0/a1): Gemini 3.0 Flash - Curadoria multimodal e extração de engenharia reversa de vídeos (ROI imbatível para ingestão de vídeo).

Workers (a3/a4): Qwen3 Max - Redação de roteiros (Doutrina Harry Dry) e direção de arte via prompt.

Worker (a5/a6): Kling 3.1 / Seedance 2.0 (via FAL.ai) para geração visual, e GLM 5.1 / Remotion para montagem final.

Padrão de Execução: Uso do runner runAgentTick com Claim Atômico via Supabase (UPDATE...RETURNING).

Segurança de Dados: Validação obrigatória de todo payload via Zod e tipagem estrita em TypeScript.

Integração: Consumo de mídia via FAL.ai (Kling 3.1, Nano Banana 2) e notificações assíncronas via Telegram.

4. Rules & Constraints

NUNCA editar .env.local automaticamente: Atualize o env.ts e documente as variáveis necessárias.

Hard Boundaries: O rsync e deploys devem apontar obrigatoriamente para o IP 100.72.40.35.

Unique Pixel Hash & Retenção: Todo render deve aplicar escala [1.005..1.015] e rotação [-0.15..0.15]°. Além disso, todo vídeo finalizado DEVE obrigatoriamente incluir a Redline (barra de progresso) e legendas dinâmicas via Remotion para máxima retenção.

Regra de Ouro (Dados): Workers possuem ZERO permissão de escrita direta na creative_matrix. Apenas o CEO e o Worker a8 consolidam dados no Supabase.

Regra de Ouro (ROI & Custos): É estritamente proibido disparar chamadas de API de vídeo (Kling/Veo/Seedance) sem o status `PASS` do Agente QC (Gatekeeper) nas imagens base SHxA (Start Frame) e SHxB (End Frame).

Workflow de Persistência:
- Plan: Iniciar com /plan.
- Execute & Test: Implementar e rodar smokes.
- Git Sync: Realizar git commit e push para o servidor Git remoto ao finalizar a tarefa.
- Obsidian Log: Atualizar o log de sessão no Obsidian somente após a confirmação do push.

# [VARIÁVEIS DE AMBIENTE OBRIGATÓRIAS]
O ecossistema depende das seguintes chaves no `.env.local` (validadas via `env.ts`):
- `ANTHROPIC_API_KEY` (Para o CEO/Gatekeeper Opus 4.6)
- `GEMINI_API_KEY` (Para o Worker a0 e a1 - Gemini 3.0 Flash)
- `OPENROUTER_API_KEY` (Para roteamento do Qwen3 Max e modelos locais)
- `FAL_KEY` (Para chamadas de vídeo/imagem: Kling 3.1, Veo 3.1, Seedance 2.0, Nano Banana 2)
- `FIRECRAWL_API_KEY` (Para o Worker a0 realizar o bypass de JS no scraping)
- `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` (Para banco de dados e gestão multicontas)
- `TELEGRAM_BOT_TOKEN` e `TELEGRAM_CHAT_ID` (Para o CEO enviar pings de rascunhos pendentes)
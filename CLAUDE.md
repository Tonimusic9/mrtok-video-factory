CLAUDE.md — MrTok Framework
1. Project Description
MrTok é uma fábrica autônoma de conteúdo UGC para TikTok Shop BR, orquestrada via OpenClaw. O sistema automatiza o ciclo completo: da mineração de produtos à entrega final via Telegram `sendDocument` direto ao celular do administrador para postagem manual.

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

Cérebro (CEO / Gatekeeper QC): Claude Opus 4.6 (API Direta Anthropic) - Auditoria visual (Fase 1: imagens) e orquestração central. Delega a auditoria de vídeo (Fase 2) ao Gemini 3.0 Flash.

Worker (a0/a1): Gemini 3.0 Flash - Curadoria multimodal e extração de engenharia reversa de vídeos (ROI imbatível para ingestão de vídeo).

Workers (a3/a4): Qwen3 Max - Redação de roteiros (Doutrina Harry Dry) e direção de arte via prompt.

Worker (a5 - Produtor Visual): Motores Nativos via FAL.ai. Provider primário homologado: **Kling 3.0 Pro image-to-video** (`fal-ai/kling-video/v3/pro/image-to-video`, 5s canônico por cena, preço $0.112/s sem áudio). Seedance 2.0 DESATIVADO (timeouts crônicos); Veo 3.1 Fast permanece como alternativa arquitetural não ativa.

Worker (a6 - Montador Remotion): Z-AI GLM 5.1 - Gera o manifesto de montagem (JSON) e executa o framework Remotion.

Worker (a7 - Delivery): Agente de Entrega via Telegram. Envia o vídeo finalizado da VPS direto ao celular do administrador via método `sendDocument` (NUNCA `sendVideo`, que recomprime e destrói o Unique Pixel Hash).

Worker (a8 - Analytics): DeepSeek V3.1 via OpenRouter - Minera dados e clusteriza winners. Migrado do Gemma 4 local para evitar contenção de RAM na VPS durante renders Remotion do Worker a6.

Padrão de Execução: Uso do runner runAgentTick com Claim Atômico via Supabase (UPDATE...RETURNING).

Segurança de Dados: Validação obrigatória de todo payload via Zod e tipagem estrita em TypeScript.

Integração: Consumo de mídia via FAL.ai (**Kling 3.0 Pro i2v** e **Nano Banana Pro** homologados; Seedance 2.0 e Veo 3.1 Fast como alternativas arquiteturais) e entrega/notificações assíncronas via Telegram.

4. Rules & Constraints

NUNCA editar .env.local automaticamente: Atualize o env.ts e documente as variáveis necessárias.

Hard Boundaries: O rsync e deploys devem apontar obrigatoriamente para o IP 100.72.40.35.

Unique Pixel Hash & Retenção: Todo render deve aplicar escala [1.005..1.015] e rotação [-0.15..0.15]°. Além disso, todo vídeo finalizado DEVE obrigatoriamente incluir a Redline (barra de progresso) e legendas dinâmicas via Remotion para máxima retenção.

Resolução Canônica: Todo o ecossistema opera em **720x1280 (Vertical 9:16 - 720p)**. Proibido renderizar em 1080p ou 4K.

Dispositivo de Referência UGC: **iPhone 17 Pro Max**. Usar em prompts de estética (a4) e metadados de exportação (a6).

Motor de Vídeo Homologado: **Kling 3.0 Pro image-to-video** (5s canônico por cena, enforced via `KLING_DURATION` em `worker-a4.ts`). Slug FAL: `fal-ai/kling-video/v3/pro/image-to-video`. Label interno legado no payload: `kling_3_1`. Alternativas arquiteturais não ativas: Seedance 2.0 (15s max) e Veo 3.1 Fast (8s max) — reativação exige autorização explícita do administrador.

Regra de Ouro (Dados): Workers possuem ZERO permissão de escrita direta na creative_matrix. Apenas o CEO e o Worker a8 consolidam dados no Supabase.

Regra de Ouro (ROI & Custos): É estritamente proibido disparar chamadas de API de vídeo (Kling/Veo/Seedance) sem o status `PASS` do Gatekeeper QC (Fase 1) nas imagens base SHxA (Start Frame) e SHxB (End Frame).

Regra de Ouro (Entrega): O fluxo de publicação é VPS → Telegram `sendDocument` → download manual no celular pelo administrador → postagem manual no TikTok. É obrigatório o uso de `sendDocument` (nunca `sendVideo`) para preservar o Unique Pixel Hash injetado pelo Remotion. Não há integração direta com a API do TikTok para upload.

Nota sobre Whisper: A Groq Whisper API (`whisper-large-v3`) é utilizada exclusivamente para **transcrição** (Speech-to-Text) dos áudios nativos gerados pelos motores de vídeo. Não é utilizada para geração de voz (TTS).

Workflow de Persistência:
- Plan: Iniciar com /plan.
- Execute & Test: Implementar e rodar smokes.
- Git Sync: Realizar git commit e push para o servidor Git remoto ao finalizar a tarefa.
- Obsidian Log: Atualizar o log de sessão no Obsidian somente após a confirmação do push.

# [VARIÁVEIS DE AMBIENTE OBRIGATÓRIAS]
O ecossistema depende das seguintes chaves no `.env.local` (validadas via `env.ts`):
- `ANTHROPIC_API_KEY` (Para o CEO/Gatekeeper Opus 4.6)
- `GEMINI_API_KEY` (Para o Worker a0, a1 e delegação de QC Fase 2 - Gemini 3.0 Flash)
- `OPENROUTER_API_KEY` (Para roteamento do Qwen3 Max e modelos locais)
- `FAL_KEY` (Para chamadas de vídeo/imagem homologadas: **Kling 3.0 Pro i2v** e **Nano Banana Pro**; alternativas arquiteturais Seedance 2.0 e Veo 3.1 Fast)
- `FIRECRAWL_API_KEY` (Para o Worker a0 realizar o bypass de JS no scraping)
- `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` (Para banco de dados e gestão multicontas)
- `TELEGRAM_BOT_TOKEN` e `TELEGRAM_CHAT_ID` (Para o CEO enviar pings de rascunhos pendentes)
- O Worker a7 (Delivery) envia o `.mp4` final via `sendDocument` do Telegram reutilizando `TELEGRAM_BOT_TOKEN` e `TELEGRAM_CHAT_ID` acima. Nenhuma credencial adicional.

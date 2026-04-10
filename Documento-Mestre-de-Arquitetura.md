# 🏗️ Documento Mestre de Arquitetura - Ecossistema AI UGC (MrTok Framework)

> **Nota de Contexto:** Este documento é a Fonte da Verdade para decisões arquiteturais, histórico do sistema, topologia detalhada de agentes, estruturas de banco de dados e UI (Dashboard). Para o fluxo operacional diário, variáveis de ambiente e regras rígidas de codificação, consulte o arquivo `CLAUDE.md`.

---

## 1. Visão Macro e Filosofia (Blindagem Algorítmica)

**Projeto:** MrTok (TikTok Shop BR – AIGC Video Factory)
**Objetivo:** Operar uma fábrica autônoma de UGC orquestrada via OpenClaw, rodando em `localhost:5050` e interligada a uma VPS restrita. Não é um SaaS, é uma infraestrutura proprietária.

A dor principal que o MrTok resolve é o esgotamento criativo e o risco de penalizações (shadowbans) do TikTok Shop para conteúdos gerados por IA. 
A arquitetura resolve isso com:
1. **Unique Pixel Hash:** Modificadores matemáticos randômicos de escala (1.005 a 1.015) e rotação (-0.15° a 0.15°) via Remotion para injetar unicidade na hash de cada `.mp4` renderizado.
2. **Fator Humano Simulativo:** Injeção obrigatória no copy (`human_imperfections_injection`) de pausas, respirações e hesitações. Continuidade anti-robótica no Agente 4 (passando 50-100 caracteres como contexto visual para o próximo clipe).
3. **Compliance Restrita:** Uso de `negative_prompt` pesados para impedir promessas milagrosas e desrespeito aos Termos de Serviço do TikTok Shop.

---

## 2. Topologia de Agentes e Stack de LLMs (Ecossistema Híbrido)

**Histórico de Decisão (Divergência Corrigida):** A arquitetura original previa o uso do modelo `GPT-5.4` para vários agentes. Essa abordagem foi **abandonada**. O sistema atual roda 100% em modo Híbrido via OpenRouter e APIs diretas, utilizando modelos focados em custo-benefício, multimodalidade nativa e ausência de censura indesejada, mantendo o Claude Opus apenas como Cérebro.

### O Cérebro (Orquestração/QC e Comunicação)
* **CEO e Gatekeeper (QC):** Claude Opus 4.6 (API Direta Anthropic). Delega tarefas, prioriza a fila e atua como Auditor Visual implacável (reprovando falhas de continuidade antes do render). Nunca processa código pesado. 
* **Regra de Comunicação (Single Point of Contact):** O CEO é a **ÚNICA** entidade do sistema autorizada a acionar o módulo do Telegram. Todos os Workers (a0 ao a8) operam em silêncio absoluto. O CEO centraliza os logs e envia apenas pings assíncronos executivos ao Administrador (ex: status de deploy concluído, alertas de erro crítico na API ou pedidos de aprovação final).

### Os Músculos (Workers via OpenRouter & APIs Locais)
* ⏳ **Worker a0 (Curador de Winners):** Gemini 3.0 Flash. Alimenta o pipeline upstream. Usa visão e velocidade hiper-rápida para rastrear sinais de PMF via Firecrawl API (`/scrape`) e Skills SCTM.
* ⏳ **Worker a1 (Extrator Multimodal):** Gemini 3.0 Flash. Realiza a ingestão de vídeo/áudio de referências virais para mapear *beats* emocionais, ritmo de cortes e fazer a engenharia reversa da retenção.
* ⏳ **Worker a2 (Framework de Venda):** Minimax M2.7. Estrutura o copy com frameworks clássicos (AIDA, PAS).
* ✅ **Worker a3 (Scriptwriter):** Qwen3 Max. (*Smoke pass: ~12s*). Redige roteiros PT-BR baseados na **Doutrina Harry Dry** (Concreto, Único, Falsificável). Aplica a Regra dos 83% e divide as cenas matematicamente para não estourar as APIs de vídeo.
* ✅ **Worker a4 (Diretor de Arte):** Qwen3 Max orquestrando **Nano Banana 2**. Cria o Storyboard UGC (9:16) e extrai os *Start Frames* e *End Frames* para cada clipe, preparando o terreno visual.
* ✅ **Worker a5 (Produtor Visual/Voz):** Aciona os motores de vídeo via FAL.ai baseando-se nos frames do a4. **Limites Rígidos de Tempo (Single-Shot):**
  - **Kling 3.1:** Máx 10s por cena (Física ultrarrealista).
  - **Veo 3.1 Fast:** Máx 8s por cena (Planos cinematográficos).
  - **Seedance 2.0:** Máx 15s por cena (Atuação humana e sincronia labial).
* ✅ **Worker a6 (Montador CLI / Remotion):** Orquestra o framework Remotion. Gera a timeline final unindo os clipes, sincroniza as legendas dinâmicas com o áudio, insere a Redline (barra de progresso) e aplica o Unique Pixel Hash.
* ⏳ **Worker a7 (Deployer):** Z-AI GLM 5.1. Responsável pelo upload técnico.
  - **Regra de Postagem:** É terminantemente proibido publicar vídeos em modo "Public". Todo upload via API deve ser realizado com o parâmetro `post_mode: "DRAFT"`.
  - **Confirmação:** Após o upload, deve reportar ao CEO que o vídeo está disponível para revisão manual no Seller Center.
* ⏳ **Worker a8 (Analytics):** Gemma 4 (Rodando na VPS Hostinger). Minera os dados e clusteriza winners.

### 2.1. Matriz de Consistência Visual (O DNA)
Para impedir *character drift* (mutações de rosto/roupa) e desperdício de fundos nas APIs de vídeo, o Worker a4 aplica um protocolo rígido obrigatório:
1. **Character/Environment DNA:** O modelo Nano Banana 2 gera folhas de referência (Character Sheets 360º) para travar a identidade da influenciadora e do ambiente.
2. **Start/End Frame Anchoring (Ancoragem):** O pipeline nunca pede para a IA de vídeo gerar do zero. O último frame (End Frame) do Vídeo 1 é matematicamente gerado para servir de referência base (Start Frame) para o Vídeo 2.
---

## 3. TikTok Analytics Dashboard (O Centro de Comando)

Interface local (Next.js) ligada ao banco de dados do sistema (Supabase) que atua como os "olhos" do CEO (Opus) para entender a performance real (fechamento de loop). Reprodução exata do conceito "MrTok / Larry Skill".

### 3.1. Camada de Dados (Supabase - Gestão Multicontas)
O sistema foi desenhado para suportar o roteamento dinâmico de dados para N contas do TikTok Shop Brasil. Toda a inteligência criativa e métricas de performance são segmentadas por conta.

accounts: Tabela mestre para o gerenciamento de múltiplas lojas.

Campos: id, handle (ex: @loja_top_br), access_token, tipo, timezone, status.

videos: Registro central de toda a produção da fábrica. Todo vídeo é vinculado a uma conta.

Campos: account_id (FK), tiktok_video_id, hook_id, script_id, persona_id, story_angle_id, data_postagem, post_status (DRAFT por padrão).

video_metrics_daily: Captura diária da performance real extraída pelo Worker a8.

Campos: date, views, clicks, add_to_cart, purchases, gmv, impressions, ctr, click_to_sale, aov.

Tabelas de Inteligência Criativa (Clusters): Utilizadas para o roteamento de o que funciona em cada nicho/conta.

Tabelas: hooks, scripts, personas, story_angles.

Campos base: label, descrição, tags, num_videos, total_views, avg_views.

### 3.2. Estrutura da Interface (UI Next.js - Rota `/analytics`)

1. **Overview Topo (KPIs Globais):**
   * Cards de valores agregados: Total GMV, Items Sold, Product Clicks, Click→Sale Rate (%), Avg Order Value.
2. **Revenue & Performance:**
   * Lista de contas com mini-cards individuais (Total GMV, Items Sold, Daily Avg, Click→Sale, Avg Order).
3. **Gráficos Core (Meio da tela):**
   * *Daily GMV ($):* Gráfico de linhas temporais (uma linha por conta).
   * *Conversion Rates (%):* Gráfico de linha temporal.
   * *Daily Impressions:* Gráfico de barras temporais.
4. **Creative Intelligence (O Coração do Feedback Loop):**
   * Quatro Grids/Listas pareadas mostrando o ranking (1..N):
     - Top Hooks (Text on screen)
     - Top Scripts (Transcripts)
     - Top Visual Descriptions (Personas)
     - Top Story Angles
   * *Dados na lista:* Número de vídeos criados naquele cluster, Total de Views, Média de Views por vídeo.
5. **Video Library & Stats (Rodapé):**
   * Indicadores gerais: Total Videos, Total Views, Views Over Time (gráfico de linha).
   * Filtros dinâmicos: Conta ("All Accounts" ou específica).
   * Sorting: Most Views, Most Likes, Engagement Rate, Newest First.
   * Cards do vídeo: Exibem ícones literais do app do TikTok (Views, Likes, Comments, Shares) + Tags indicando o Hook e Persona usados.

---

## 4. Repositórios Externos, Skills e Integrações de Terceiros

Para que o framework funcione fora do `dry_run` e gere valor real, o ecosssistema consome dependências externas vitais:

* **Vídeo & Animação:**
  * `calesthio/OpenMontage`: (Diretório `workspace/video-renderer/`) Fornece estruturas e manifestos de montagem dinâmicos para o Remotion (Worker a6).
  * `@trycua/launchpad`: (Instalado via NPM) Componentes de overlay dinâmicos e overlays UGC-like.
* **Curadoria (A alimentar o a0):**
  * `mvanhorn/last30days-skill`: (Em `~/.claude/skills/`) Motor de mineração na Amazon/TikTok.
  * `tiktok-viral-product-hunter`: Skill SCTM complementar para achar sinal de PMF.
* **APIs Utilitárias:**
  * **Firecrawl API (`/scrape`):** Obrigatório para o Worker a0 quebrar as barreiras de JS Rendering nas páginas de produto.
  * **Groq Whisper API (`whisper-large-v3`):** Para geração de legendas dinâmicas e text-on-screen com timestamps super precisos (palavra por palavra).
  * **Airtable:** Utilizado na etapa de QC (Quality Control) para aprovação visual (preview inline) de assets antes de postar.
* **Notificações:**
  * `bytedance/deer-flow` (Módulo Telegram): Utilizado estritamente para o CEO disparar pings assíncronos de status e aprovações para o celular do admin.

---

## 5. Agente Produtor e Formatos Alternativos (Pipeline Opcional)

Gatilho via contrato Zod dos Agentes 3 e 4 no campo `format`.
Quando diferente de "vídeo 9:16 padrão", o Agente Produtor (skill opcional) entra em cena consumindo beats emocionais:

* **ScrollClaw (`format: "slideshow"`):**
  * Monta carrosséis clássicos do TikTok (até 6 fotos).
  * Fonte: Proxima Nova (Texto branco, stroke preto).
  * Mantém hierarquia de retenção em formato estático.
* **ReelClaw (`format: "reel_quick"`):**
  * Consulta banco `dansugc/reelclaw` via MCP.
  * Extrator (a1) isola os momentos catárticos (demo clip) e envia posições de corte.
  * FFmpeg (Worker a6 auxiliar) costura hook agressivo com a demo.
  * Fonte: TikTokSansDisplayBold, respeitando a "Green Zone" da tela do usuário.

---

## 6. Pipeline de Renderização: O Desafio do Worker a6

O Worker a6 já compila o `RenderManifest` em testes (`dry_run` = verde), mas **não está produzindo o vídeo real**. Ele precisa atravessar a barreira de segurança da VPS.

**A arquitetura de deploy (`scripts/deploy-render.sh`):**
A arquitetura proíbe renderização pesada do Remotion na máquina local (Mac) para não travar o loop de orquestração.
O fluxo mandatório (ainda pendente de código) é:
1. `rsync` silencioso transferindo os assets e o manifesto gerados localmente para a VPS Hostinger (100.72.40.35 via Tailscale).
2. O script aciona remotamente o `remotion render` na VPS.
3. O script faz o `pull` do `.mp4` compilado, devolvendo-o para a pasta `/output/publish_ready/` na máquina host.

---

## 7. Roadmap Arquitetural (Ordem de Execução Baseada na Auditoria)

1. **Desbloquear Produção a6 (CRÍTICO):** Criar `scripts/deploy-render.sh` e integrar a chamada final do `@remotion/renderer` no `worker-a6.ts`.
2. **Integração de Repositórios Ausentes:** Clonar `OpenMontage`, importar `@trycua/launchpad`, puxar as skills `last30days` e instalar módulo do Telegram.
3. **Evolução do Worker a3:** Implementar as lógicas dos *3 Diagnósticos* e *Regra dos 83%* exigidas no copy.
4. **Ativação da Entrada do Funil (Worker a0):** Ligar o Minimax com Firecrawl e Skills SCTM para iniciar o fluxo contínuo real.
5. **UI / Dashboard:** Codificar o Next.js mapeando as lógicas da seção §3.
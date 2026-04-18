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

**Nota Histórica:** O Worker a2 (Framework de Venda / Minimax M2.7) foi descontinuado. Sua função de estruturar copy com frameworks clássicos (AIDA, PAS) foi integralmente absorvida pelos 3 Diagnósticos Obrigatórios do Worker a3.

**Nota Histórica (2026-04-11):** O Worker a8 (Analytics) migrou de **Gemma 4** (residente na VPS Hostinger) para **DeepSeek V3.1 via OpenRouter**, prevenindo OOM durante renders do Remotion no Worker a6. A proposta original era adotar DeepSeek V4, mas o modelo ainda não estava disponível no OpenRouter na data da migração (Reuters/The Information, 03/04/2026, indicava lançamento iminente). V3.1 foi escolhido como substituto imediato por já estar em produção no roteador.

### O Cérebro (Orquestração/QC e Comunicação)
* **CEO e Gatekeeper (QC):** Claude Opus 4.6 (API Direta Anthropic). Delega tarefas, prioriza a fila e atua como Auditor Visual implacável em duas fases: **Fase 1 (Imagens)** — executada nativamente pelo Opus, reprovando falhas de continuidade antes do render; **Fase 2 (Vídeo)** — delegada ao Gemini 3.0 Flash para análise de movimento e mutações pós-render. Nunca processa código pesado.
* **Regra de Comunicação (Single Point of Contact):** O CEO é a **ÚNICA** entidade do sistema autorizada a acionar o módulo do Telegram. Todos os Workers (a0 ao a8) operam em silêncio absoluto. O CEO centraliza os logs e envia apenas pings assíncronos executivos ao Administrador (ex: link do Google Drive pronto para download, alertas de erro crítico na API ou pedidos de aprovação final).

### Os Músculos (Workers via OpenRouter & APIs Locais)
* ⏳ **Worker a0 (Curador de Winners):** Gemini 3.0 Flash. Alimenta o pipeline upstream. Usa visão e velocidade hiper-rápida para rastrear sinais de PMF via Firecrawl API (`/scrape`) e Skills SCTM.
* ⏳ **Worker a1 (Extrator Multimodal):** Gemini 3.0 Flash. Realiza a ingestão de vídeo/áudio de referências virais para mapear *beats* emocionais, ritmo de cortes e fazer a engenharia reversa da retenção.
* ✅ **Worker a3 (Scriptwriter):** Qwen3 Max. (*Smoke pass: ~12s*). Redige roteiros PT-BR baseados na **Doutrina Harry Dry** (Concreto, Único, Falsificável). Aplica a Regra dos 83%, os 3 Diagnósticos (que incorporam AIDA/PAS) e divide as cenas matematicamente para não estourar as APIs de vídeo.
* ✅ **Worker a4 (Diretor de Arte):** Qwen3 Max orquestrando **Nano Banana Pro** (`fal-ai/nano-banana-pro`, `aspect_ratio:"9:16"`, `resolution:"1K"`). Cria o Storyboard UGC (9:16) e extrai os *Start Frames* e *End Frames* para cada clipe, preparando o terreno visual. Referência estética: `shot on iPhone 17 Pro Max`.
* ✅ **Worker a5 (Produtor Visual/Voz):** Aciona os motores de vídeo via FAL.ai baseando-se nos frames do a4. **Motor Homologado: Kling v3 Pro image-to-video** (`fal-ai/kling-video/v3/pro/image-to-video`, enforced em `worker-a4.ts`). **Configuração canônica atual:**
  - **Kling v3 Pro i2v (Homologado):** 5s canônico por cena, preço $0.112/s sem áudio. Único provider ativo após estabilização em 2026-04-17.
  - **Seedance 2.0 (DESATIVADO):** Timeouts crônicos na fila FAL — slug preservado em `FAL_SLUG_BY_PROVIDER` como alternativa arquitetural, 15s max quando reativado.
  - **Veo 3.1 Fast (alternativa):** 8s max por cena; não ativa no pipeline atual.
  - **Resolução Canônica:** 720x1280 (720p Vertical 9:16).
  - **Label interno legado:** `kling_3_1` no enum do `motion_bucket.provider` (`worker-a3.ts:68`, `worker-a4.ts:83,226`) — dívida documental, não bloqueia pipeline.
* ✅ **Worker a6 (Montador CLI / Remotion):** Z-AI GLM 5.1. Orquestra o framework Remotion. Gera a timeline final unindo N clipes (número dinâmico conforme o storyboard do a3), sincroniza as legendas dinâmicas com o áudio, insere a Redline (barra de progresso) e aplica o Unique Pixel Hash (escala [1.005..1.015] + rotação [-0.15°..0.15°]). Exporta em 720x1280, 6-10 Mbps, com metadados de iPhone 17 Pro Max.
* ✅ **Worker a7 (Delivery / Entrega):** Agente de Logística de Mensageria. Transporta o vídeo finalizado da VPS Hostinger direto ao celular do administrador via **Telegram `sendDocument`** (nunca `sendVideo`, que recomprime e destrói o Unique Pixel Hash). Reutiliza `TELEGRAM_BOT_TOKEN` e `TELEGRAM_CHAT_ID` já em uso pelo CEO. A postagem no TikTok é feita **manualmente** pelo administrador no celular, garantindo maior alcance orgânico e segurança de conta. Não há integração direta com a API do TikTok para upload. **Decisão de 2026-04-11:** pivot de Google Drive para Telegram — elimina o step manual de "abrir Drive → baixar → postar", entregando o `.mp4` direto na notificação push do celular.
* ⏳ **Worker a8 (Analytics):** DeepSeek V3.1 via OpenRouter. Minera dados do Supabase (`video_metrics_daily`) e clusteriza winners. Stateless — não reside na VPS, liberando RAM dedicada ao Remotion (a6).

### 2.1. Matriz de Consistência Visual (O DNA)
Para impedir *character drift* (mutações de rosto/roupa) e desperdício de fundos nas APIs de vídeo, o Worker a4 aplica um protocolo rígido obrigatório:
1. **Character/Environment DNA:** O modelo Nano Banana Pro gera folhas de referência (Character Sheets 360º) para travar a identidade da influenciadora e do ambiente.
2. **Start/End Frame Anchoring (Ancoragem):** O pipeline nunca pede para a IA de vídeo gerar do zero. O último frame (End Frame) do Vídeo 1 é matematicamente gerado para servir de referência base (Start Frame) para o Vídeo 2.

---

## 3. TikTok Analytics Dashboard (O Centro de Comando)

Interface local (Next.js) ligada ao banco de dados do sistema (Supabase) que atua como os "olhos" do CEO (Opus) para entender a performance real (fechamento de loop). Reprodução exata do conceito "MrTok / Larry Skill".

### 3.1. Camada de Dados (Supabase - Gestão Multicontas)
O sistema foi desenhado para suportar o roteamento dinâmico de dados para N contas do TikTok Shop Brasil. Toda a inteligência criativa e métricas de performance são segmentadas por conta.

accounts: Tabela mestre para o gerenciamento de múltiplas lojas.

Campos: id, handle (ex: @loja_top_br), tipo, timezone, status.

videos: Registro central de toda a produção da fábrica. Todo vídeo é vinculado a uma conta.

Campos: account_id (FK), tiktok_video_id, hook_id, script_id, persona_id, story_angle_id, data_postagem, post_status, google_drive_file_link.

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

Para que o framework funcione fora do `dry_run` e gere valor real, o ecossistema consome dependências externas vitais:

* **Vídeo & Animação:**
  * `calesthio/OpenMontage`: (Diretório `workspace/video-renderer/`) Fornece estruturas e manifestos de montagem dinâmicos para o Remotion (Worker a6).
  * `@trycua/launchpad`: (Instalado via NPM) Componentes de overlay dinâmicos e overlays UGC-like.
* **Curadoria (A alimentar o a0):**
  * `mvanhorn/last30days-skill`: (Em `~/.claude/skills/`) Motor de mineração na Amazon/TikTok.
  * `tiktok-viral-product-hunter`: Skill SCTM complementar para achar sinal de PMF.
* **APIs Utilitárias:**
  * **Firecrawl API (`/scrape`):** Obrigatório para o Worker a0 quebrar as barreiras de JS Rendering nas páginas de produto.
  * **Groq Whisper API (`whisper-large-v3`):** Utilizada exclusivamente para **transcrição (Speech-to-Text)** dos áudios nativos gerados pelos motores de vídeo (Seedance/Kling). Gera legendas dinâmicas com timestamps palavra por palavra. **Não é utilizada para geração de voz (TTS).**
* **Entrega de Ativos:**
  * **Telegram Bot API (`sendDocument`):** Utilizada pelo Worker a7 para transportar o vídeo finalizado da VPS direto ao celular do administrador sem recompressão. A postagem no TikTok é manual.
* **Notificações:**
  * `bytedance/deer-flow` (Módulo Telegram): Utilizado estritamente para o CEO disparar pings assíncronos de status (ex: link do Google Drive pronto para download) e aprovações para o celular do admin.

---


Para que o framework funcione fora do `dry_run` e gere valor real, o ecossistema consome dependências externas vitais. Essas integrações não substituem a arquitetura central do MrTok; elas servem como motores e serviços especializados dentro da esteira própria do projeto.

### 4.1. Motores de Geração de Mídia
- **FAL.ai**  
  Camada de execução para geração de imagens e vídeos pelos workers de produção visual. Atualmente o ecossistema utiliza:
  - **Nano Banana Pro** (`fal-ai/nano-banana-pro`, `aspect_ratio:"9:16"`, `resolution:"1K"`) para geração de imagens-base e storyboard no fluxo do upstream visual.
  - **Kling v3 Pro image-to-video** (`fal-ai/kling-video/v3/pro/image-to-video`, 5s canônico, $0.112/s sem áudio) como provider primário único homologado no worker a4. Migrado de Kling 1.5 Pro em 2026-04-17 (ver `worker-a4.ts:7-9`).
  - **Seedance 2.0 temporariamente desativado** (timeouts crônicos na fila FAL). **Veo 3.1 Fast** permanece como opção arquitetural, mas não ativo. Reativação exige autorização explícita do administrador.

### 4.2. Renderização, Montagem e Pós-Produção
- **Remotion + infraestrutura própria de render remoto**  
  O Worker A6 utiliza um pipeline próprio de montagem e renderização baseado em Remotion, com manifesto de render, injeção de Unique Pixel Hash, metadados de exportação e execução remota na VPS.  
  O diretório `workspace/video-renderer/` permanece como área técnica de trabalho para assets, manifestos e componentes auxiliares do render, mas **não depende mais de OpenMontage como peça estratégica ou fundacional do ecossistema**.

- **`scripts/deploy-render.sh`**  
  Script operacional crítico para sincronização com a VPS, disparo do render remoto, coleta do arquivo final e validações técnicas como `ffprobe`.

### 4.3. Entrega Final e Mensageria
- **Telegram Bot API (`sendDocument`)**  
  Canal oficial de entrega do vídeo final ao administrador.  
  O método canônico é **`sendDocument`**, nunca `sendVideo`, para preservar:
  - o **Unique Pixel Hash**
  - os metadados de exportação
  - o arquivo final sem recompressão server-side

  O fluxo oficial de entrega é:
  **VPS / pipeline local → Telegram `sendDocument` → celular do administrador → postagem manual no TikTok**

  O antigo fluxo via **Google Drive foi descontinuado** e não faz mais parte do pipeline oficial.

### 4.4. Transcrição e Processamento de Áudio
- **Groq Whisper API (`whisper-large-v3`)**  
  Utilizada exclusivamente para **Speech-to-Text (STT)** dos áudios nativos gerados pelos motores de vídeo.  
  Não é usada para TTS nem substitui os motores nativos de voz dos próprios geradores de vídeo.

### 4.5. Pesquisa, Coleta e Enriquecimento de Dados
- **Firecrawl API**  
  Usada para scraping e leitura de páginas dinâmicas no upstream de descoberta e curadoria, especialmente no Worker A0.

### 4.6. Modelos e Roteamento de IA
- **OpenRouter**  
  Camada de roteamento dos modelos auxiliares do ecossistema, usada conforme o papel de cada worker e suas exigências de custo, velocidade, multimodalidade e robustez.

### 4.7. Skills e MCPs Operacionais
O ambiente do projeto pode utilizar ferramentas de apoio para restaurar contexto, validar integrações, registrar sessões e reduzir custo operacional, incluindo:
- **Obsidian MCP**
- **Smart Connections MCP**
- **Context7 MCP**
- **git / gh**
- skills instaladas relevantes por fase

Essas ferramentas apoiam a operação, mas **não substituem a hierarquia de verdade do projeto**, que continua sendo:
**código atual > `CLAUDE.md` > Documento Mestre > memória operacional**

### 4.8. Estado Atual das Integrações Críticas
No estado atual do projeto (atualizado 2026-04-18):
- o caminho **A3 → A4** já foi homologado em caso real;
- o canário de **Kling v3 Pro image-to-video** já foi validado;
- a **cadeia completa A3 → A4 → A6 → A7** foi homologada ponta a ponta em modo zero-FAL sobre o lead canário `6705d973-90b6-4511-bc46-d5455c4aedff` (3/3 imagens Nano Banana Pro em 9:16 + 3/3 vídeos Kling v3 Pro em path produtivo, render Remotion/VPS real 720×1280 @ 6.3 Mbps, entrega Telegram `sendDocument` confirmada);
- o fluxo **Remotion/VPS + A7/Telegram** já foi validado em modo zero-FAL com `disable_content_type_detection` preservando o Unique Pixel Hash (commit `e6da468`);
- a entrega final via **Telegram `sendDocument`** está confirmada como canal oficial do ecossistema.

As integrações acima devem ser tratadas como parte viva da operação e atualizadas sempre que o código homologado superar o estado descrito neste documento.

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
O fluxo mandatório é:
1. `rsync` silencioso transferindo os assets e o manifesto gerados localmente para a VPS Hostinger (100.72.40.35 via Tailscale).
2. O script aciona remotamente o `remotion render` na VPS.
3. O script faz o `pull` do `.mp4` compilado, devolvendo-o para a pasta `/output/publish_ready/` na máquina host.
4. O Worker a7 (Delivery) pega o vídeo da pasta e envia via Telegram `sendDocument` direto ao celular do administrador (zero recompressão, hash preservada).

---

## 7. Roadmap Arquitetural (Ordem de Execução Baseada na Auditoria)

1. ✅ **Desbloquear Produção a6 (CONCLUÍDO 2026-04-18):** Chamada final do `@remotion/renderer` via `runRemoteRender` → `scripts/deploy-render.sh` homologada em 720×1280 @ 6.3 Mbps com Unique Pixel Hash (escala+rotação).
2. ✅ **Ativar Worker a7 (Delivery) (CONCLUÍDO 2026-04-18):** Fluxo Telegram `sendDocument` em `worker-a7.ts` transportando o vídeo da VPS direto ao celular do admin sem recompressão (disable_content_type_detection shipped).
3. **Integração de Repositórios Ausentes:** Clonar `OpenMontage`, importar `@trycua/launchpad`, puxar as skills `last30days` e instalar módulo do Telegram.
4. **Evolução do Worker a3:** Implementar as lógicas dos *3 Diagnósticos* e *Regra dos 83%* exigidas no copy.
5. **Ativação da Entrada do Funil (Worker a0):** Ligar o Gemini 3.0 Flash com Firecrawl e Skills SCTM para iniciar o fluxo contínuo real.
6. **UI / Dashboard:** Codificar o Next.js mapeando as lógicas da seção §3.

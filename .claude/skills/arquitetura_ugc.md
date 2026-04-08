# 🏗️ Documento Mestre de Arquitetura: Ecossistema AI UGC (MrTok Framework)

## 🎯 Objetivo do System
Uma fábrica autônoma de anúncios UGC virais focada em volume programático e blindagem contra banimentos.

## 🤖 Topologia de Agentes (Pipeline de Produção)

### 👑 Agente CEO: Supervisor Maestro (Claude Opus 4.6 - API)
- Gerencia o estado das tarefas e fila do Supabase. Orquestra a delegação para "músculos" via OpenRouter.

### 🕵️ Agente 0: Curador de Winners (Minimax 2.7 - OpenRouter)
- Pesquisa Amazon Movers & Shakers e minera reviews negativos via `last30days-skill`.

### 🧠 Agente 1: Extrator Multimodal (Gemini 3 Flash - API/OpenRouter)
- Decupa vídeos e movimentos exatos de câmera para engenharia reversa.

### 📐 Agente 2: Framework (GPT-5.4 - OpenRouter)
- Estrutura a lógica de venda (AIDA/PAS) em JSON baseado na decupagem do Agente 1.

### ✍️ Agente 3: Adaptador PT-BR (Qwen 3.6 - OpenRouter)
- Produz a Matriz Criativa com a "Equação do Hook" e "Camada de Desconforto".

### 🎨 Agente 4: Diretor de Arte (Qwen 3.6 - OpenRouter)
- Define estética visual nativa TikTok e garante realismo do produto.

### 🎥 Agente 5: Produtor Visual/Voz (GPT-5.4 - OpenRouter)
- Gera payloads para Kling 3.0 e clonagem de voz com imperfeições humanas.

### ✂️ Agente 6: Montador CLI (GPT-5.4 - OpenRouter)
- Backend `OpenMontage` no Remotion. Aplica a estratégia **Unique Pixel Hash**.

### 🛡️ Agente QC: Quality Control (Claude Opus 4.6 - API)
- Validação final de compliance e estética antes do deploy.

### 🚀 Agente 7: Deployer (GPT-5.4 - OpenRouter)
- Automação via Playwright para upload e configuração de campanha.

### 📊 Agente 8: Analytics (Gemma 4 - Local VPS)
- Analisa Curva de Retenção de 3s e retroalimenta o Supabase.
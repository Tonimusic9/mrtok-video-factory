# [PROTOCOLO DE CONSISTÊNCIA VISUAL - MrTok]

Este documento define as regras de "DNA" para evitar o desperdício de créditos em vídeos alucinados. Todo vídeo gerado deve obrigatoriamente seguir este pipeline de 3 camadas.

## 1. Camada de Identidade (Character DNA)
- **O que é:** Uma folha de referência (Character Sheet) 360º gerada pelo Nano Banana 2.
- **Regra:** Proibido iniciar a geração de cenas sem antes ter o arquivo `dna_influencer.png` aprovado pelo QC (Fase 1).
- **Consistência:** O prompt das cenas deve sempre referenciar o DNA (ex: "Using Image 1 as reference, show the same character...").

## 2. Camada de Ambiente (Environment DNA)
- **O que é:** Uma imagem limpa do cenário (ex: a cozinha, o quarto, o escritório) sem personagens.
- **Objetivo:** Travar a iluminação e as cores de fundo. Se a luz mudar no meio do vídeo, a retenção cai.

## 3. Camada de Storyboard (A Física do Movimento)
- **O que é:** Um grid 3x3 que mostra a evolução da ação em 9 frames.
- **Uso Técnico:** Serve para extrair o `Start Frame` e o `End Frame` de cada bloco de vídeo (duração variável conforme o motor escolhido e o storyboard do a3).
- **O Pulo do Gato:** O último frame do Vídeo 1 (SH1B) DEVE ser usado como referência visual para o primeiro frame do Vídeo 2 (SH2A).

## 4. Parâmetros Canônicos do Ecossistema
- **Resolução:** 720x1280 (Vertical 9:16 - 720p).
- **Dispositivo de Referência UGC:** iPhone 17 Pro Max (usado em prompts de estética e metadados de exportação).
- **Motor Padrão:** Seedance 2.0 (15s max). Alternativas: Kling 3.1 (10s max), Veo 3.1 Fast (8s max).
- **Unique Pixel Hash:** Escala [1.005..1.015] + Rotação [-0.15°..0.15°].
- **Bitrate de Exportação:** 6-10 Mbps (sweet spot TikTok).

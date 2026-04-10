#!/bin/bash

# ==============================================================================
# MRTOK AIGC VIDEO FACTORY - DEPLOY & RENDER SCRIPT
# Orquestra a renderização remota do Worker a6 via Remotion na VPS
# ==============================================================================

set -e # Interrompe o script se qualquer comando falhar

# Configurações da VPS e Caminhos
VPS_IP="100.72.40.35" # IP da Hostinger via Tailscale
VPS_USER="root"
LOCAL_ASSETS_DIR="./workspace/video-renderer/assets/"
LOCAL_MANIFEST="./workspace/video-renderer/manifest.json"
REMOTE_WORKSPACE="/var/www/mrtok/video-renderer/"
LOCAL_OUTPUT_DIR="./output/publish_ready/"

echo "🚀 [MRTOK] Iniciando pipeline de renderização remota..."

# 1. Preparação Local
if [ ! -f "$LOCAL_MANIFEST" ]; then
    echo "❌ Erro: manifest.json não encontrado. O Worker a6 executou corretamente?"
    exit 1
fi

mkdir -p "$LOCAL_OUTPUT_DIR"

# 2. Rsync: Enviando Assets e Manifesto para a VPS (Silencioso e Rápido)
echo "📦 [1/3] Sincronizando assets com a VPS ($VPS_IP)..."
rsync -azq --delete "$LOCAL_ASSETS_DIR" "${VPS_USER}@${VPS_IP}:${REMOTE_WORKSPACE}assets/"
rsync -azq "$LOCAL_MANIFEST" "${VPS_USER}@${VPS_IP}:${REMOTE_WORKSPACE}manifest.json"

# 3. Execução Remota: Renderizando via Remotion na VPS
echo "🎬 [2/3] Acionando Remotion na VPS. Isso pode levar alguns minutos..."
ssh "${VPS_USER}@${VPS_IP}" << 'ENDSSH'
    cd /var/www/mrtok/video-renderer/
    
    # Renderiza o vídeo usando as props do manifesto
    # Aplicando o Unique Pixel Hash matematicamente via props
    npx remotion render src/index.ts out/final-video.mp4 --props="manifest.json" --log=warn
ENDSSH

# 4. Rsync: Puxando o vídeo finalizado de volta para o Mac local
echo "📥 [3/3] Recuperando o vídeo renderizado..."
rsync -azq "${VPS_USER}@${VPS_IP}:${REMOTE_WORKSPACE}out/final-video.mp4" "$LOCAL_OUTPUT_DIR/mrtok_$(date +%s).mp4"

echo "✅ [MRTOK] Renderização concluída com sucesso!"
echo "📍 Arquivo salvo em: $LOCAL_OUTPUT_DIR"
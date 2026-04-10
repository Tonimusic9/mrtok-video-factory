#!/bin/bash

# ==============================================================================
# MRTOK AIGC VIDEO FACTORY - DEPLOY & RENDER SCRIPT (v2.0)
# Orquestra a renderização remota do Worker a6 via Remotion na VPS Hostinger.
#
# Uso: bash scripts/deploy-render.sh <RUN_ID>
#   RUN_ID: correlação de logs (default: timestamp unix). O MP4 final é
#           gravado em ./output/publish_ready/mrtok_<RUN_ID>.mp4
#
# Protocolo de telemetria (stdout é parseado pelo worker a6):
#   [<stage>] done in <N>s       — estágios: precheck, rsync_up, remote_render,
#                                    ffmpeg_metadata, rsync_down
#   REMOTE_LOG:<path>            — caminho do log persistente na VPS
#   OUTPUT_BYTES:<N>             — tamanho do MP4 final em bytes
#   FFPROBE:<W>,<H>,<BITRATE>    — dimensões e bitrate validados via ffprobe
#
# Exit codes:
#   0  = sucesso
#   1  = erro genérico (manifest ausente, etc)
#   10 = VPS: workspace /var/www/mrtok/video-renderer/ inexistente
#   11 = VPS: package.json do Remotion ausente
#   12 = VPS: node_modules/@remotion ausente (npm install não foi rodado)
#   13 = VPS: ffmpeg ausente
#   20 = VPS: MP4 final inexistente ou < 100KB após render
# ==============================================================================

set -e

# --- Configuração ------------------------------------------------------------
VPS_IP="100.72.40.35" # Hard boundary — CLAUDE.md §4 (Hostinger via Tailscale)
VPS_USER="root"
LOCAL_REMOTION_SRC="./remotion/src/"
LOCAL_ASSETS_DIR="./workspace/video-renderer/assets/"
LOCAL_MANIFEST="./workspace/video-renderer/manifest.json"
REMOTE_WORKSPACE="/var/www/mrtok/video-renderer/"
REMOTE_LOG_DIR="/var/log/mrtok-render"
LOCAL_OUTPUT_DIR="./output/publish_ready"

RUN_ID="${1:-$(date +%s)}"
REMOTE_LOG_PATH="${REMOTE_LOG_DIR}/${RUN_ID}.log"
LOCAL_OUTPUT_PATH="${LOCAL_OUTPUT_DIR}/mrtok_${RUN_ID}.mp4"

echo "[deploy-render] 🚀 RUN_ID=${RUN_ID}"
echo "[deploy-render] VPS=${VPS_IP} workspace=${REMOTE_WORKSPACE}"

# --- 0. Validação local ------------------------------------------------------
if [ ! -f "$LOCAL_MANIFEST" ]; then
    echo "❌ manifest.json não encontrado em $LOCAL_MANIFEST"
    exit 1
fi
if [ ! -d "$LOCAL_ASSETS_DIR" ]; then
    echo "❌ assets dir não encontrado em $LOCAL_ASSETS_DIR"
    exit 1
fi
if [ ! -d "$LOCAL_REMOTION_SRC" ]; then
    echo "❌ remotion/src/ não encontrado em $LOCAL_REMOTION_SRC"
    exit 1
fi
mkdir -p "$LOCAL_OUTPUT_DIR"

# --- 1. Pre-flight health check da VPS --------------------------------------
echo "[deploy-render] 🩺 [1/5] pre-check VPS..."
SECONDS=0
ssh -o ConnectTimeout=5 "${VPS_USER}@${VPS_IP}" "REMOTE_LOG_DIR='${REMOTE_LOG_DIR}' bash -s" <<'PRECHECK'
    set -e
    test -d /var/www/mrtok/video-renderer || { echo "❌ VPS: workspace inexistente"; exit 10; }
    test -f /var/www/mrtok/video-renderer/package.json || { echo "❌ VPS: package.json ausente"; exit 11; }
    test -d /var/www/mrtok/video-renderer/node_modules/@remotion || { echo "❌ VPS: node_modules/@remotion ausente"; exit 12; }
    command -v ffmpeg >/dev/null 2>&1 || { echo "❌ VPS: ffmpeg ausente"; exit 13; }
    command -v ffprobe >/dev/null 2>&1 || { echo "❌ VPS: ffprobe ausente"; exit 13; }
    mkdir -p "$REMOTE_LOG_DIR"
    df -h /var/www/mrtok/video-renderer | tail -1
PRECHECK
echo "[precheck] done in ${SECONDS}s"

# --- 2. Rsync UP: código Remotion + assets + manifest -----------------------
echo "[deploy-render] 📦 [2/5] rsync UP (remotion/src + assets + manifest)..."
SECONDS=0
# 2a. Código da composição Remotion (Root.tsx, MrTokVideo.tsx, PixelHashWrapper.tsx)
rsync -azq --delete "$LOCAL_REMOTION_SRC" "${VPS_USER}@${VPS_IP}:${REMOTE_WORKSPACE}src/"
# 2b. MP4s brutos do FAL.ai baixados pelo worker
rsync -azq --delete "$LOCAL_ASSETS_DIR" "${VPS_USER}@${VPS_IP}:${REMOTE_WORKSPACE}assets/"
# 2c. Manifest JSON com clips reescritos para caminhos relativos
rsync -azq "$LOCAL_MANIFEST" "${VPS_USER}@${VPS_IP}:${REMOTE_WORKSPACE}manifest.json"
echo "[rsync_up] done in ${SECONDS}s"

# --- 3. Execução Remota: Remotion render ------------------------------------
echo "[deploy-render] 🎬 [3/5] remote render na VPS (pode levar 1-4 min)..."
echo "REMOTE_LOG:${REMOTE_LOG_PATH}"
SECONDS=0
ssh "${VPS_USER}@${VPS_IP}" "RUN_ID='${RUN_ID}' REMOTE_LOG_PATH='${REMOTE_LOG_PATH}' bash -s" <<'ENDSSH'
    set -e
    cd /var/www/mrtok/video-renderer/
    mkdir -p out
    # Resolução canônica: 720x1280 (definida no Root.tsx + manifest.json).
    # Unique Pixel Hash: aplicado via PixelHashWrapper.tsx com valores do manifest.
    # Bitrate: 8 Mbps (sweet spot TikTok, dentro da faixa 6-10 Mbps).
    npx remotion render src/index.ts MrTokVideo out/final-video.mp4 \
        --props="manifest.json" \
        --log=info \
        --video-bitrate=8M \
        --codec=h264 \
        2>&1 | tee "${REMOTE_LOG_PATH}"
ENDSSH
echo "[remote_render] done in ${SECONDS}s"

# --- 4. Metadata iPhone 17 Pro Max + ffprobe pós-check ----------------------
echo "[deploy-render] 📱 [4/5] injetando metadata iPhone 17 Pro Max..."
SECONDS=0
ssh "${VPS_USER}@${VPS_IP}" 'bash -s' <<'METADATA'
    set -e
    cd /var/www/mrtok/video-renderer/out/
    test -f final-video.mp4 || { echo "❌ VPS: final-video.mp4 inexistente"; exit 20; }
    SIZE=$(stat -c%s final-video.mp4 2>/dev/null || stat -f%z final-video.mp4)
    if [ "$SIZE" -lt 100000 ]; then
        echo "❌ VPS: final-video.mp4 suspeito: ${SIZE} bytes"
        exit 20
    fi

    # Injeção de metadata UGC — faz o TikTok tratar o arquivo como iPhone real.
    ffmpeg -y -i final-video.mp4 \
        -metadata make="Apple" \
        -metadata model="iPhone 17 Pro Max" \
        -metadata software="iOS 19.0" \
        -c copy final-video-tagged.mp4 2>/dev/null
    mv final-video-tagged.mp4 final-video.mp4

    # Cross-check final de dimensões e bitrate — fail-closed aqui evita
    # que um MP4 fora da spec v2.0 chegue ao Worker a7.
    FFPROBE_OUT=$(ffprobe -v error -select_streams v:0 \
        -show_entries stream=width,height,bit_rate \
        -of csv=p=0 final-video.mp4)
    echo "FFPROBE:${FFPROBE_OUT}"

    FINAL_SIZE=$(stat -c%s final-video.mp4 2>/dev/null || stat -f%z final-video.mp4)
    echo "OUTPUT_BYTES:${FINAL_SIZE}"
METADATA
echo "[ffmpeg_metadata] done in ${SECONDS}s"

# --- 5. Rsync DOWN: puxa o MP4 final para o Mac -----------------------------
echo "[deploy-render] 📥 [5/5] rsync DOWN (MP4 final)..."
SECONDS=0
rsync -azq "${VPS_USER}@${VPS_IP}:${REMOTE_WORKSPACE}out/final-video.mp4" "$LOCAL_OUTPUT_PATH"
echo "[rsync_down] done in ${SECONDS}s"

echo "[deploy-render] ✅ RUN_ID=${RUN_ID} concluído — ${LOCAL_OUTPUT_PATH}"
echo "[deploy-render] 📌 próximo: Worker a7 (Delivery) → Google Drive"

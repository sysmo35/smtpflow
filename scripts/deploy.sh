#!/bin/bash
# ─────────────────────────────────────────────────────────────
#  deploy.sh — Aggiorna SMTPFlow su VPS esistente
#  Usage: sudo bash scripts/deploy.sh
# ─────────────────────────────────────────────────────────────
set -e

[[ $EUID -eq 0 ]] || { echo "Esegui come root: sudo bash scripts/deploy.sh"; exit 1; }

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
INSTALL_DIR="/opt/smtpflow"

echo "[1/4] Build frontend..."
cd "$REPO_DIR/frontend" && npm install --quiet && npm run build --quiet

echo "[2/4] Copia file..."
cp -r "$REPO_DIR/backend/src"         "$INSTALL_DIR/backend/"
cp -r "$REPO_DIR/backend/migrations"  "$INSTALL_DIR/backend/"
cp    "$REPO_DIR/backend/package.json" "$INSTALL_DIR/backend/"
cp -r "$REPO_DIR/frontend/dist/."     "$INSTALL_DIR/frontend/dist/"
cp "$REPO_DIR/scripts/sync-dkim.sh"      "$INSTALL_DIR/sync-dkim.sh"
cp "$REPO_DIR/scripts/bounce-handler.sh" "$INSTALL_DIR/bounce-handler.sh"
chmod +x "$INSTALL_DIR/sync-dkim.sh" "$INSTALL_DIR/bounce-handler.sh"

echo "[3/4] Installa nuove dipendenze backend (se presenti)..."
cd "$INSTALL_DIR/backend" && npm install --omit=dev --quiet

echo "[4/4] Riavvia app..."
pm2 restart smtpflow

echo ""
echo "Deploy completato!"
pm2 status smtpflow

#!/usr/bin/env bash
# Quick deploy script: pull latest code, install deps, build, restart pm2 service.
# Usage: ./deploy.sh

set -euo pipefail

APP_DIR="$(cd "$(dirname "$0")" && pwd)"
APP_NAME="monitor-score"
PORT="${PORT:-3000}"

cd "$APP_DIR"

echo "==> Pulling latest code..."
git pull

echo "==> Installing dependencies..."
npm install

echo "==> Building..."
npm run build

echo "==> Restarting pm2 ($APP_NAME) on PORT=$PORT ..."
PORT=$PORT pm2 restart "$APP_NAME" --update-env || PORT=$PORT pm2 start npm --name "$APP_NAME" -- run start --update-env

echo "==> Saving pm2 process list..."
pm2 save

echo "Done."

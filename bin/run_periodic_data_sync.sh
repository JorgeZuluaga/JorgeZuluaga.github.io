#!/usr/bin/env bash
# launchd (diario): Goodreads (likes + últimas reseñas + stats) + logs visitantes + likes locales.
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_DIR"

LOCK_DIR="$REPO_DIR/.secrets/cv-data-sync.lockdir"
LOCK_PID_FILE="$LOCK_DIR/pid"
mkdir -p "$REPO_DIR/.secrets"

if mkdir "$LOCK_DIR" 2>/dev/null; then
  printf '%s\n' "$$" > "$LOCK_PID_FILE"
  trap 'rm -rf "$LOCK_DIR"' EXIT INT TERM
else
  if [[ -f "$LOCK_PID_FILE" ]]; then
    LOCK_PID="$(tr -d '\r\n' < "$LOCK_PID_FILE" || true)"
    if [[ -n "${LOCK_PID:-}" ]] && kill -0 "$LOCK_PID" 2>/dev/null; then
      echo "[$(date -u +"%Y-%m-%dT%H:%M:%SZ")] Another sync is already running (pid=$LOCK_PID). Exiting."
      exit 0
    fi
  fi
  rm -rf "$LOCK_DIR"
  mkdir "$LOCK_DIR"
  printf '%s\n' "$$" > "$LOCK_PID_FILE"
  trap 'rm -rf "$LOCK_DIR"' EXIT INT TERM
fi

TOKEN_FILE_DEFAULT="$REPO_DIR/.secrets/log_read_token"
TOKEN_FILE="${LOG_READ_TOKEN_FILE:-$TOKEN_FILE_DEFAULT}"

if [[ -z "${LOG_READ_TOKEN:-}" && -f "$TOKEN_FILE" ]]; then
  LOG_READ_TOKEN="$(tr -d '\r\n' < "$TOKEN_FILE")"
  export LOG_READ_TOKEN
fi

echo "[$(date -u +"%Y-%m-%dT%H:%M:%SZ")] Goodreads (likes + reseñas recientes + stats)..."
bash "$REPO_DIR/bin/run_daily_goodreads_sync.sh"

if [[ -n "${LOG_READ_TOKEN:-}" ]]; then
  echo "[$(date -u +"%Y-%m-%dT%H:%M:%SZ")] Visitor logs backup..."
  make visitor-logs-sync
else
  echo "[$(date -u +"%Y-%m-%dT%H:%M:%SZ")] Sin LOG_READ_TOKEN: se omite visitor-logs-sync."
fi

echo "[$(date -u +"%Y-%m-%dT%H:%M:%SZ")] Snapshot likes locales..."
make library-local-likes-sync

if [[ -x "$REPO_DIR/.secrets/update-likes.sh" ]]; then
  echo "[$(date -u +"%Y-%m-%dT%H:%M:%SZ")] Hook opcional .secrets/update-likes.sh"
  "$REPO_DIR/.secrets/update-likes.sh" || true
fi

git add \
  info/visitor-logs-backup.ndjson \
  info/visitor-logs-backup-state.json \
  info/visitor-logs-snapshot.json \
  info/library.json \
  info/library-stats.json 2>/dev/null || true

if ! git diff --cached --quiet 2>/dev/null; then
  COMMIT_TS="$(date +"%Y-%m-%d %H:%M:%S %Z")"
  git commit -m "chore: sync biblioteca, visitor logs y likes (${COMMIT_TS})" || true
  git push || true
  echo "[$(date -u +"%Y-%m-%dT%H:%M:%SZ")] Cambios confirmados (si había repo limpio)."
else
  echo "[$(date -u +"%Y-%m-%dT%H:%M:%SZ")] Sin cambios para commit."
fi

echo "[$(date -u +"%Y-%m-%dT%H:%M:%SZ")] Periodic data sync completed."

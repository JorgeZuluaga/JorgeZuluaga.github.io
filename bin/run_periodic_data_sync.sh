#!/usr/bin/env bash
set -euo pipefail

# Periodic sync runner for launchd:
# 1) visitor logs backup (requires LOG_READ_TOKEN)
# 2) local review likes snapshot

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_DIR"

# Optional token file support for unattended runs.
# You can override with LOG_READ_TOKEN_FILE env var.
TOKEN_FILE_DEFAULT="$REPO_DIR/.secrets/log_read_token"
TOKEN_FILE="${LOG_READ_TOKEN_FILE:-$TOKEN_FILE_DEFAULT}"

if [[ -z "${LOG_READ_TOKEN:-}" && -f "$TOKEN_FILE" ]]; then
  LOG_READ_TOKEN="$(tr -d '\r\n' < "$TOKEN_FILE")"
  export LOG_READ_TOKEN
fi

if [[ -z "${LOG_READ_TOKEN:-}" ]]; then
  echo "ERROR: LOG_READ_TOKEN is required (env var or file: $TOKEN_FILE)." >&2
  exit 1
fi

echo "[$(date -u +"%Y-%m-%dT%H:%M:%SZ")] Starting periodic data sync..."
make visitor-logs-sync
make library-local-likes-sync

git add \
  info/visitor-logs-backup.ndjson \
  info/visitor-logs-backup-state.json \
  info/visitor-logs-snapshot.json \
  info/library.json

if ! git diff --cached --quiet; then
  COMMIT_TS="$(date +"%Y-%m-%d %H:%M:%S %Z")"
  git commit -m "chore: sync visitor logs and local likes (${COMMIT_TS})"
  git push
  echo "[$(date -u +"%Y-%m-%dT%H:%M:%SZ")] Changes committed and pushed."
else
  echo "[$(date -u +"%Y-%m-%dT%H:%M:%SZ")] No data changes to commit."
fi

echo "[$(date -u +"%Y-%m-%dT%H:%M:%SZ")] Periodic data sync completed."

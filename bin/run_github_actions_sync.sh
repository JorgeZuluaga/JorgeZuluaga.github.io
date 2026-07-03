#!/usr/bin/env bash
# Entrada para GitHub Actions: sync diario + correo + push (sin BookBuddy).
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_DIR"

export SYNC_SOURCE="${SYNC_SOURCE:-github-actions}"
export SYNC_STATE_FILE="${SYNC_STATE_FILE:-info/sync-state.json}"
export NOTIFY_STATE_FILE="${NOTIFY_STATE_FILE:-info/review-notify-state.json}"

git config user.name "${GIT_AUTHOR_NAME:-github-actions[bot]}"
git config user.email "${GIT_AUTHOR_EMAIL:-41898282+github-actions[bot]@users.noreply.github.com}"

bash "$REPO_DIR/bin/materialize_ci_secrets.sh"

# Cookie opcional para scripts que leen .secrets/cookie
if [[ -n "${GOODREADS_COOKIE:-}" ]]; then
  export COOKIE="$GOODREADS_COOKIE"
fi
if [[ -n "${LOG_READ_TOKEN:-}" ]]; then
  export LOG_READ_TOKEN
fi

exec bash "$REPO_DIR/bin/run_periodic_data_sync.sh"

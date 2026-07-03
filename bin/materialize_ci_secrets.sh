#!/usr/bin/env bash
# Escribe .secrets/* desde variables de entorno (GitHub Actions Secrets).
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SECRETS_DIR="$REPO_DIR/.secrets"
mkdir -p "$SECRETS_DIR"

write_if_set() {
  local env_name="$1"
  local file_name="$2"
  local value="${!env_name:-}"
  if [[ -n "$value" ]]; then
    printf '%s\n' "$value" > "$SECRETS_DIR/$file_name"
    echo "[materialize-secrets] $file_name ← \$${env_name}"
  fi
}

write_if_set GMAIL_SMTP_USER gmail-smtp-user
write_if_set GMAIL_APP_PASSWORD gmail-app-password
write_if_set REVIEW_NOTIFY_TOKEN review-notify-token
write_if_set REVIEW_NOTIFY_WORKER_URL review-notify-worker-url
write_if_set GOODREADS_COOKIE cookie
write_if_set LOG_READ_TOKEN log_read_token
write_if_set RSS_URL rss

echo "[materialize-secrets] listo ($(ls -1 "$SECRETS_DIR" 2>/dev/null | wc -l | tr -d ' ') archivos)"

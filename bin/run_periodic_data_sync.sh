#!/usr/bin/env bash
# launchd (diario): Goodreads (likes + últimas reseñas + stats) + logs visitantes + likes locales + git push.
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_DIR"

LOCK_DIR="$REPO_DIR/.secrets/cv-data-sync.lockdir"
LOCK_PID_FILE="$LOCK_DIR/pid"
mkdir -p "$REPO_DIR/.secrets"

utc_now() { date -u +"%Y-%m-%dT%H:%M:%SZ"; }

record_state() {
  python3 bin/sync_state.py set "$@"
}

commit_library_to_repo() {
  local ts sha msg
  ts="$(date +"%Y-%m-%d %H:%M:%S %Z")"
  git add \
    info/library.json \
    info/library-stats.json \
    reviews/ 2>/dev/null || true

  if git diff --cached --quiet 2>/dev/null; then
    echo "[$(utc_now)] Sin cambios en biblioteca/reseñas para commit."
    return 0
  fi

  msg="chore: sync biblioteca y reseñas (${ts})"
  if ! git commit -m "$msg"; then
    echo "[$(utc_now)] git commit falló (¿working tree sucio fuera del add?)." >&2
    return 1
  fi
  if ! git push; then
    echo "[$(utc_now)] git push falló." >&2
    return 1
  fi

  sha="$(git rev-parse --short HEAD)"
  record_state \
    "lastGitCommitAt=$(utc_now)" \
    "lastGitCommitSha=${sha}"
  echo "[$(utc_now)] Publicado en remoto: ${sha} — ${msg}"
  return 0
}

record_auto_run() {
  python3 bin/sync_state.py record-run \
    --started-at "$1" \
    --finished-at "${2:-}" \
    --success "$3" \
    --reason "${4:-}"
}

if mkdir "$LOCK_DIR" 2>/dev/null; then
  printf '%s\n' "$$" > "$LOCK_PID_FILE"
  trap 'rm -rf "$LOCK_DIR"' EXIT INT TERM
else
  if [[ -f "$LOCK_PID_FILE" ]]; then
    LOCK_PID="$(tr -d '\r\n' < "$LOCK_PID_FILE" || true)"
    if [[ -n "${LOCK_PID:-}" ]] && kill -0 "$LOCK_PID" 2>/dev/null; then
      echo "[$(utc_now)] Another sync is already running (pid=$LOCK_PID). Exiting."
      exit 0
    fi
  fi
  rm -rf "$LOCK_DIR"
  mkdir "$LOCK_DIR"
  printf '%s\n' "$$" > "$LOCK_PID_FILE"
  trap 'rm -rf "$LOCK_DIR"' EXIT INT TERM
fi

if python3 bin/sync_skip_if_fresh.py; then
  TS="$(utc_now)"
  echo "[${TS}] Periodic sync skipped (already synced today)."
  record_auto_run "$TS" "$TS" true "omitido (ya sincronizado hoy)"
  exit 0
fi

RUN_STARTED="$(utc_now)"

fail_auto_run() {
  local reason="$1"
  record_auto_run "$RUN_STARTED" "$(utc_now)" false "$reason"
}

TOKEN_FILE_DEFAULT="$REPO_DIR/.secrets/log_read_token"
TOKEN_FILE="${LOG_READ_TOKEN_FILE:-$TOKEN_FILE_DEFAULT}"

if [[ -z "${LOG_READ_TOKEN:-}" && -f "$TOKEN_FILE" ]]; then
  LOG_READ_TOKEN="$(tr -d '\r\n' < "$TOKEN_FILE")"
  export LOG_READ_TOKEN
fi

SYNC_SOURCE=launchd
export SYNC_SOURCE

echo "[$(utc_now)] Goodreads (likes + reseñas recientes + stats)..."
if ! bash "$REPO_DIR/bin/run_daily_goodreads_sync.sh"; then
  echo "[$(utc_now)] Goodreads daily sync failed; no se publicará al repo." >&2
  fail_auto_run "Goodreads"
  exit 1
fi

if [[ -n "${LOG_READ_TOKEN:-}" ]]; then
  echo "[$(utc_now)] Visitor logs backup..."
  make visitor-logs-sync
else
  echo "[$(utc_now)] Sin LOG_READ_TOKEN: se omite visitor-logs-sync."
fi

echo "[$(utc_now)] Snapshot likes locales..."
make library-local-likes-sync

if [[ -x "$REPO_DIR/.secrets/update-likes.sh" ]]; then
  echo "[$(utc_now)] Hook opcional .secrets/update-likes.sh"
  "$REPO_DIR/.secrets/update-likes.sh" || true
fi

git add \
  info/visitor-logs-backup.ndjson \
  info/visitor-logs-backup-state.json \
  info/visitor-logs-snapshot.json \
  2>/dev/null || true

if ! commit_library_to_repo; then
  record_state \
    "lastFailureAt=$(utc_now)" \
    "lastFailureReason=git commit/push failed" \
    "lastFailureStep=git-publish"
  fail_auto_run "git publish"
  exit 1
fi

FINISHED="$(utc_now)"
record_state "lastPeriodicSyncSuccessAt=${FINISHED}"
record_auto_run "$RUN_STARTED" "$FINISHED" true "completo"
echo "[${FINISHED}] Periodic data sync completed."

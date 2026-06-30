#!/usr/bin/env bash
# Pasos A–C del QUICKSTART: likes Goodreads + últimas reseñas + estadísticas.
# RSS_URL: env, luego .secrets/rss, luego source.rssUrl en library.json.
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_DIR"

RSS_URL="${RSS_URL:-}"
if [[ -z "$RSS_URL" && -f "$REPO_DIR/.secrets/rss" ]]; then
  RSS_URL="$(tr -d '\r\n' < "$REPO_DIR/.secrets/rss")"
fi
if [[ -z "$RSS_URL" ]]; then
  RSS_URL="$(python3 bin/read_library_rss_url.py || true)"
fi
if [[ -z "$RSS_URL" ]]; then
  echo "Defina RSS_URL, cree .secrets/rss o mantenga source.rssUrl en info/library.json" >&2
  exit 1
fi

COOKIE="${COOKIE:-}"
if [[ -z "$COOKIE" && -f "$REPO_DIR/.secrets/cookie" ]]; then
  COOKIE="$(tr -d '\r\n' < "$REPO_DIR/.secrets/cookie")"
fi

export RSS_URL COOKIE
RSS_PAGES="${RSS_PAGES:-100}"
REVIEW_RSS_PAGES="${REVIEW_RSS_PAGES:-100}"
SYNC_MAX_ATTEMPTS="${SYNC_MAX_ATTEMPTS:-3}"
SYNC_RETRY_WAIT_SEC="${SYNC_RETRY_WAIT_SEC:-300}"
SYNC_SOURCE="${SYNC_SOURCE:-manual}"

utc_now() { date -u +"%Y-%m-%dT%H:%M:%SZ"; }

record_state() {
  python3 bin/sync_state.py set "$@"
}

run_daily_once() {
  echo "[daily-goodreads] RSS_URL cargado (${#RSS_URL} chars); cookie $([ -n "${COOKIE:-}" ] && echo sí || echo no)"

  echo ""
  echo "=== [1/8] library-goodreads-likes (RSS + scrape likes + ISBN) ==="
  make library-goodreads-likes RSS_URL="$RSS_URL" RSS_PAGES="$RSS_PAGES" COOKIE="${COOKIE:-}"

  echo ""
  echo "=== [2/8] library-goodreads-reviews-latest (mirror ~10 reseñas) ==="
  make library-goodreads-reviews-latest COOKIE="${COOKIE:-}" REVIEW_RSS_PAGES="$REVIEW_RSS_PAGES"

  echo ""
  echo "=== [3/8] library-goodreads-isbn-sync (ISBN faltantes desde RSS) ==="
  make library-goodreads-isbn-sync RSS_URL="$RSS_URL" RSS_PAGES="$RSS_PAGES"

  echo ""
  echo "=== [4/8] library-link-details-by-isbn ==="
  make library-link-details-by-isbn

  echo ""
  echo "=== [5/8] buscalibre-links-fetch (enlaces nuevos) ==="
  make buscalibre-links-fetch MISSING_FROM_LIBRARY=1

  echo ""
  echo "=== [6/8] library-stats ==="
  make library-stats

  echo ""
  echo "=== [7/8] library-drzrating-update ==="
  make library-drzrating-update

  if [[ -z "${SKIP_REVIEW_NOTIFY:-}" ]]; then
    echo ""
    echo "=== [8/8] review-notify-send (tras Buscalibre) ==="
    make review-notify-send || echo "[daily-goodreads] review-notify-send omitido o falló."
  else
    echo ""
    echo "=== [8/8] review-notify-send omitido (SKIP_REVIEW_NOTIFY=1) ==="
  fi

  echo ""
  echo "[daily-goodreads] Completado."
}

FAIL_REASON=""
FAIL_STEP=""

on_fail() {
  local step="$1"
  local code="$2"
  FAIL_STEP="$step"
  FAIL_REASON="exit ${code} en ${step}"
}

attempt=1
while [[ "$attempt" -le "$SYNC_MAX_ATTEMPTS" ]]; do
  TS="$(utc_now)"
  record_state \
    "lastAttemptAt=${TS}" \
    "lastAttemptSource=${SYNC_SOURCE}" \
    "lastAttemptNumber=${attempt}" \
    "lastAttemptMax=${SYNC_MAX_ATTEMPTS}"

  echo ""
  echo "[daily-goodreads] Intento ${attempt}/${SYNC_MAX_ATTEMPTS} (${SYNC_SOURCE}) — ${TS}"

  if run_daily_once; then
    record_state \
      "lastDailyGoodreadsSuccessAt=${TS}" \
      "lastFailureAt=" \
      "lastFailureReason=" \
      "lastFailureStep=" \
      "consecutiveFailures=0"
    exit 0
  fi

  code=$?
  on_fail "daily-goodreads" "$code"
  record_state \
    "lastFailureAt=${TS}" \
    "lastFailureReason=${FAIL_REASON}" \
    "lastFailureStep=${FAIL_STEP}"

  if [[ "$attempt" -ge "$SYNC_MAX_ATTEMPTS" ]]; then
    prev_fail="$(python3 bin/sync_state.py get --key consecutiveFailures 2>/dev/null || echo 0)"
    if [[ -z "$prev_fail" || ! "$prev_fail" =~ ^[0-9]+$ ]]; then prev_fail=0; fi
    record_state "consecutiveFailures=$((prev_fail + 1))"
    echo "[daily-goodreads] Falló tras ${SYNC_MAX_ATTEMPTS} intento(s)." >&2
    exit "$code"
  fi

  echo "[daily-goodreads] Reintento en ${SYNC_RETRY_WAIT_SEC}s…" >&2
  sleep "$SYNC_RETRY_WAIT_SEC"
  attempt=$((attempt + 1))
done

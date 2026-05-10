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

echo "[daily-goodreads] RSS_URL cargado (${#RSS_URL} chars); cookie $([ -n "${COOKIE:-}" ] && echo sí || echo no)"

echo ""
echo "=== [1/4] library-goodreads-likes (RSS + scrape likes) ==="
make library-goodreads-likes RSS_URL="$RSS_URL" RSS_PAGES="$RSS_PAGES" COOKIE="${COOKIE:-}"

echo ""
echo "=== [2/4] library-goodreads-reviews-latest (mirror ~10 reseñas) ==="
make library-goodreads-reviews-latest COOKIE="${COOKIE:-}" REVIEW_RSS_PAGES="$REVIEW_RSS_PAGES"

echo ""
echo "=== [3/4] library-stats ==="
make library-stats

echo ""
echo "=== [4/4] library-drzrating-update ==="
make library-drzrating-update

echo ""
echo "[daily-goodreads] Completado."

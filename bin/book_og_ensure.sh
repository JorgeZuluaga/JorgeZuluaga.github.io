#!/usr/bin/env bash
# Tras actualizar catálogo (diario / BookBuddy): el worker book-og NO necesita
# redeploy por datos — lee library.json, library-details y covers desde GitHub Pages.
# Este script:
#  1) Comprueba que el worker responda.
#  2) Opcionalmente re-despliega el código si BOOK_OG_DEPLOY=1 (o --deploy).
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_DIR"

BOOK_OG_URL="${BOOK_OG_URL:-https://book-og-worker.drz-academy.workers.dev}"
FORCE_DEPLOY=0

for arg in "$@"; do
  case "$arg" in
    --deploy) FORCE_DEPLOY=1 ;;
    --url=*) BOOK_OG_URL="${arg#--url=}" ;;
  esac
done

if [[ "${BOOK_OG_DEPLOY:-}" == "1" || "${BOOK_OG_DEPLOY:-}" == "true" ]]; then
  FORCE_DEPLOY=1
fi

utc_now() { date -u +"%Y-%m-%dT%H:%M:%SZ"; }

echo "[$(utc_now)] book-og: worker lee el catálogo desde GitHub Pages (sin redeploy por datos)."
echo "[$(utc_now)] book-og: comprobando ${BOOK_OG_URL}/ …"

if curl -fsS --max-time 20 "${BOOK_OG_URL}/" >/dev/null; then
  echo "[$(utc_now)] book-og: OK (worker en línea)."
else
  echo "[$(utc_now)] book-og: worker no responde en ${BOOK_OG_URL}" >&2
  if [[ "$FORCE_DEPLOY" -ne 1 ]]; then
    echo "[$(utc_now)] book-og: para redeployar código: make book-og-deploy  (o BOOK_OG_DEPLOY=1)" >&2
    exit 1
  fi
fi

if [[ "$FORCE_DEPLOY" -eq 1 ]]; then
  echo "[$(utc_now)] book-og: desplegando código del worker (BOOK_OG_DEPLOY/ --deploy)…"
  if ! command -v npx >/dev/null 2>&1; then
    echo "[$(utc_now)] book-og: npx no disponible; no se puede desplegar." >&2
    exit 1
  fi
  npx wrangler deploy --config wrangler-book-og.toml
  echo "[$(utc_now)] book-og: deploy listo."
fi

exit 0

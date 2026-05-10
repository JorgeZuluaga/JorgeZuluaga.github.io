.PHONY: \
	help start dev stop \
	classroom \
	library-build \
	library-goodreads-likes library-goodreads-books-only library-goodreads-reviews-latest \
	library-daily-goodreads \
	library-update library-stats library-refresh library-local-likes-sync visitor-logs-sync library-antibiblioteca-sync \
	notebooklm-reviews-export \
	antilibrary-covers-fetch \
	antilibrary-covers-extract-html \
	reviews-first reviews-all reviews-force reviews-refresh reviews-fix reviews-enrich reviews-enrich-dry \
	library-review-counts \
	library-details-import library-details-match library-details-sync \
	library-bookbuddy-update library-bookbuddy-covers library-stub-dcc-details library-cross-ref-report \
	library-ddc-update library-ddc-generate-pending library-ddc-apply-gemini \
	sync-dcc-library-details \
	update-all-books \
	worker-deploy

PORT ?= 8000
HOST ?= 127.0.0.1
LIBRARY_JSON ?= info/library.json
LIBRARY_STATS_JSON ?= info/library-stats.json
LIBRARY_DETAILS_JSON ?= info/library-details.json
BOOKBUDDY_CSV ?= info/bookbuddy.csv
# Por defecto: una línea en cada archivo (sin commit; .secrets/ está en .gitignore).
RSS_URL ?= $(shell cat .secrets/rss 2>/dev/null | tr -d '\r\n')
COOKIE ?= $(shell cat .secrets/cookie 2>/dev/null | tr -d '\r\n')
export RSS_URL COOKIE
RSS_PAGES ?= 100
REVIEW_RSS_PAGES ?= 100
FORCE ?= 0
SITE_BASE_URL ?= https://jorgezuluaga.github.io
VISITOR_WORKER_BASE ?= https://visitor-log-worker.jorgezuluaga.workers.dev
BATCH_SIZE ?= 50
GEMINI_CLASSIFICATION_FILES ?= update/books-to-classify/gemini-code-*.json

help:
	@echo "Guía detallada: QUICKSTART.md"
	@echo ""
	@echo "Biblioteca (Goodreads / BookBuddy / Gemini):"
	@echo "  make library-goodreads-likes      - Solo likes (RSS merge + scrape; sin mirror HTML)"
	@echo "  make library-goodreads-books-only - Solo libros nuevos desde RSS (sin likes; preserva titles)"
	@echo "  make library-goodreads-reviews-latest - Últimas ~10 reseñas en reviews/"
	@echo "  make library-daily-goodreads      - Script diario: likes + últimas reseñas + stats"
	@echo "  make library-bookbuddy-update     - Import CSV + stub dcc_classes + match bookIds"
	@echo "  make library-bookbuddy-covers     - Portadas desde info/bookbuddy.htm (fallback: update/bookbuddy.htm)"
	@echo "  make library-drzrating-gemini-export - Exporta pendientes+contexto DrZ para Gemini"
	@echo "  make library-drzrating-gemini-apply  - Aplica DrZRating desde JSON de Gemini"
	@echo "  make library-cross-ref-report     - Informe cruces → update/cross-reference-report.md"
	@echo "  make library-ddc-generate-pending - Lotes Gemini (sin reasoning detallado)"
	@echo "  make library-ddc-apply-gemini     - Aplicar JSON devueltos por Gemini"
	@echo "  make sync-dcc-library-details     - Copiar DCC de library.json a library-details"
	@echo "  make update-all-books             - Cadena A→G parcial (véase QUICKSTART.md)"
	@echo "  make library-update               - LEGACY: FORCE=0|1|2 + reviews-all/force + details-sync"
	@echo ""
	@echo "Servidor / otros:"
	@echo "  make start | dev | stop | classroom | worker-deploy"
	@echo "  make visitor-logs-sync (LOG_READ_TOKEN) | library-local-likes-sync"
	@echo "  make reviews-all | reviews-force | notebooklm-reviews-export | ..."

start:
	@echo "Starting server on http://$(HOST):$(PORT)"
	@nohup python3 -m http.server "$(PORT)" --bind "$(HOST)" >/dev/null 2>&1 &
	@sleep 0.2
	@echo "Started. Stop with: make stop"

dev:
	@echo "Starting HOT-RELOAD server on http://$(HOST):$(PORT)"
	@python3 bin/dev_server.py --host "$(HOST)" --port "$(PORT)" --root "."

stop:
	@echo "Stopping server on port $(PORT) (best-effort)"
	@PID="$$(lsof -tiTCP:$(PORT) -sTCP:LISTEN 2>/dev/null | head -n 1)"; \
	if [ -n "$$PID" ]; then \
		echo "Killing pid $$PID"; \
		kill "$$PID" 2>/dev/null || true; \
		sleep 0.2; \
		if kill -0 "$$PID" 2>/dev/null; then \
			echo "Still running, forcing stop (SIGKILL)"; \
			kill -9 "$$PID" 2>/dev/null || true; \
		fi; \
	else \
		echo "No process listening on $(PORT)."; \
	fi

classroom:
	@python3 bin/sync_classroom.py

# Rebuild info/library.json from Goodreads RSS.
# Example:
# make library-build RSS_URL="https://www.goodreads.com/review/list_rss/..."
# Optional:
# make library-build RSS_URL="..." COOKIE="..." RSS_PAGES=5
library-build:
	@if [ -z "$(RSS_URL)" ]; then \
		echo "RSS_URL es obligatorio. Ejemplo:"; \
		echo "make library-build RSS_URL=\"https://www.goodreads.com/review/list_rss/...\""; \
		exit 1; \
	fi
	@python3 bin/build_library_from_goodreads.py \
		--rss-url "$(RSS_URL)" \
		--out "$(LIBRARY_JSON)" \
		--rss-pages "$(RSS_PAGES)" \
		--scrape-likes-mode all \
		--merge-from "$(LIBRARY_JSON)" \
		--library-details-json "$(LIBRARY_DETAILS_JSON)" \
		--cookie "$(COOKIE)" \
		--verbose

# A: Solo actualizar likes desde Goodreads (RSS merge + scrape en páginas de reseña; no genera HTML en reviews/).
library-goodreads-likes:
	@echo ""
	@echo ">>> library-goodreads-likes: RSS ($(RSS_PAGES) páginas) + scrape de likes → $(LIBRARY_JSON)"
	@if [ -z "$(RSS_URL)" ]; then \
		echo "RSS_URL vacío. Ejemplo: RSS_URL=\$$(python3 bin/read_library_rss_url.py) o export en la shell."; \
		exit 1; \
	fi
	@python3 bin/build_library_from_goodreads.py \
		--rss-url "$(RSS_URL)" \
		--out "$(LIBRARY_JSON)" \
		--rss-pages "$(RSS_PAGES)" \
		--scrape-likes-mode all \
		--merge-from "$(LIBRARY_JSON)" \
		--library-details-json "$(LIBRARY_DETAILS_JSON)" \
		--cookie "$(COOKIE)"

# B: Solo incorporar libros leídos nuevos desde RSS (sin scrape de likes ni mirrors). No cambia title si ya existía.
library-goodreads-books-only:
	@echo ""
	@echo ">>> library-goodreads-books-only: RSS sin likes → $(LIBRARY_JSON)"
	@if [ -z "$(RSS_URL)" ]; then echo "RSS_URL vacío."; exit 1; fi
	@python3 bin/build_library_from_goodreads.py \
		--rss-url "$(RSS_URL)" \
		--out "$(LIBRARY_JSON)" \
		--rss-pages "$(RSS_PAGES)" \
		--scrape-likes-mode none \
		--merge-from "$(LIBRARY_JSON)" \
		--library-details-json "$(LIBRARY_DETAILS_JSON)" \
		--preserve-existing-titles \
		--cookie "$(COOKIE)"

# C: Mirror solo las ~10 reseñas más recientes (y portadas vía RSS cuando existan).
library-goodreads-reviews-latest:
	@echo ""
	@echo ">>> library-goodreads-reviews-latest: mirror --refresh-latest 10"
	@python3 bin/mirror_all_reviews.py \
		--library-json "$(LIBRARY_JSON)" \
		--reviews-dir reviews \
		--cookie "$(COOKIE)" \
		--rss-pages "$(REVIEW_RSS_PAGES)" \
		--site-base-url "$(SITE_BASE_URL)" \
		--refresh-latest 10

# A+B+C en un script (usa RSS_URL de library.json si no se exporta).
library-daily-goodreads:
	@bash bin/run_daily_goodreads_sync.sh

# Incremental update:
# FORCE=0 -> no likes scrape; only new books are added to library, existing metadata is preserved.
# FORCE=1 -> scrape likes only for new books, mirror only new reviews.
# FORCE=2 -> full likes + full reviews refresh.
library-update:
	@echo ""
	@echo ">>> library-update (LEGACY) FORCE=$(FORCE) → RSS + reviews + details-sync"
	@if [ -z "$(RSS_URL)" ]; then \
		echo "RSS_URL es obligatorio. Ejemplo:"; \
		echo "make library-update RSS_URL=\"https://www.goodreads.com/review/list_rss/...\" FORCE=0"; \
		exit 1; \
	fi
	@if [ "$(FORCE)" != "0" ] && [ "$(FORCE)" != "1" ] && [ "$(FORCE)" != "2" ]; then \
		echo "FORCE debe ser 0, 1 o 2."; \
		exit 1; \
	fi
	@LIKES_MODE="none"; \
	if [ "$(FORCE)" = "1" ]; then LIKES_MODE="new"; fi; \
	if [ "$(FORCE)" = "2" ]; then LIKES_MODE="all"; fi; \
	echo "library-update: FORCE=$(FORCE) likes=$$LIKES_MODE"; \
	python3 bin/build_library_from_goodreads.py \
		--rss-url "$(RSS_URL)" \
		--out "$(LIBRARY_JSON)" \
		--rss-pages "$(RSS_PAGES)" \
		--scrape-likes-mode "$$LIKES_MODE" \
		--merge-from "$(LIBRARY_JSON)" \
		--cookie "$(COOKIE)" \
		--verbose
	@if [ "$(FORCE)" = "2" ]; then \
		$(MAKE) reviews-force COOKIE="$(COOKIE)" REVIEW_RSS_PAGES="$(REVIEW_RSS_PAGES)"; \
	else \
		$(MAKE) reviews-all COOKIE="$(COOKIE)" REVIEW_RSS_PAGES="$(REVIEW_RSS_PAGES)"; \
	fi
	@$(MAKE) library-details-sync
	@$(MAKE) library-stats
	@$(MAKE) library-drzrating-update
	@echo "Library update completed (FORCE=$(FORCE))."

# Regenerate info/library-stats.json from info/library.json.
library-stats:
	@echo ""
	@echo ">>> library-stats → $(LIBRARY_STATS_JSON)"
	@python3 bin/update_library_stats.py "$(LIBRARY_JSON)" --out "$(LIBRARY_STATS_JSON)"

# Update custom drzrating for books still pending (drzrating -1 or 0)
library-drzrating-update:
	@echo ""
	@echo ">>> library-drzrating-update"
	@python3 bin/update_drzrating.py \
		--library-json "$(LIBRARY_JSON)" \
		--base-dir "."

# Full refresh for library data + details sync + derived stats.
library-refresh: library-build library-details-sync library-stats
	@echo "Library refresh completed."

# Save local review likes snapshot directly into info/library.json.
library-local-likes-sync:
	@echo ""
	@echo ">>> library-local-likes-sync ($(VISITOR_WORKER_BASE))"
	@python3 bin/sync_local_review_likes.py \
		--library-json "$(LIBRARY_JSON)" \
		--worker-base "$(VISITOR_WORKER_BASE)"

# Sync historical visitor logs from worker into local backup snapshot files.
visitor-logs-sync:
	@echo ""
	@echo ">>> visitor-logs-sync (worker $(VISITOR_WORKER_BASE))"
	@if [ -z "$$LOG_READ_TOKEN" ]; then \
		echo "LOG_READ_TOKEN es obligatorio."; \
		echo "Ejemplo: LOG_READ_TOKEN=... make visitor-logs-sync"; \
		exit 1; \
	fi
	@python3 bin/sync_visitor_logs_backup.py \
		--worker-base "$(VISITOR_WORKER_BASE)" \
		--token "$$LOG_READ_TOKEN"

library-antibiblioteca-sync:
	@python3 bin/match_library_details_bookids.py \
		--library-json "$(LIBRARY_JSON)" \
		--library-details-json "$(LIBRARY_DETAILS_JSON)"

notebooklm-reviews-export:
	@python3 bin/export_reviews_for_notebooklm.py \
		--library-json "$(LIBRARY_JSON)" \
		--output-dir "update/reviews" \
		--chunk-size "$${CHUNK_SIZE:-5}"

antilibrary-covers-fetch:
	@python3 bin/fetch_antilibrary_covers.py \
		--library-json "$(LIBRARY_JSON)" \
		--library-details-json "$(LIBRARY_DETAILS_JSON)" \
		--output-dir "$${OUTPUT_DIR:-antilibrary/covers}" \
		--limit "$${LIMIT:-50}" \
		--retries "$${RETRIES:-3}"

antilibrary-covers-extract-html:
	@python3 bin/extract_bookbuddy_embedded_covers.py \
		--input-html "$${BOOKBUDDY_HTML:-update/BookBuddy 2026-05-02 093121.htm}" \
		--output-dir "$${OUTPUT_DIR:-antilibrary/covers}" \
		--report-json "$${OUTPUT_DIR:-antilibrary/covers}/extract-from-html-report.json"

# Generate/update local mirror for the first review only.
reviews-first:
	@echo ""
	@echo ">>> reviews-first (smoke test mirror)"
	@python3 bin/mirror_first_review.py \
		--library-json "$(LIBRARY_JSON)" \
		--reviews-dir reviews \
		--cookie "$(COOKIE)" \
		--rss-pages "$(REVIEW_RSS_PAGES)" \
		--site-base-url "$(SITE_BASE_URL)"

# Generate/update local mirror for all reviews found.
reviews-all:
	@echo ""
	@echo ">>> reviews-all (mirror completo; puede tardar mucho)"
	@python3 bin/mirror_all_reviews.py \
		--library-json "$(LIBRARY_JSON)" \
		--reviews-dir reviews \
		--cookie "$(COOKIE)" \
		--rss-pages "$(REVIEW_RSS_PAGES)" \
		--site-base-url "$(SITE_BASE_URL)"

# Force regenerate local mirror for all reviews.
reviews-force:
	@echo ""
	@echo ">>> reviews-force (regenera todas las reseñas)"
	@python3 bin/mirror_all_reviews.py \
		--library-json "$(LIBRARY_JSON)" \
		--reviews-dir reviews \
		--cookie "$(COOKIE)" \
		--rss-pages "$(REVIEW_RSS_PAGES)" \
		--site-base-url "$(SITE_BASE_URL)" \
		--force

# Typical review update workflow.
reviews-refresh: reviews-all library-stats
	@echo "Reviews refresh completed."

# Recalculate reviewCount (words in local mirror body) for all books with reviewUrl.
library-review-counts:
	@python3 bin/review_word_count.py --library-json "$(LIBRARY_JSON)"

# Fix spelling/grammar in review HTML files not yet corrected.
reviews-fix:
	@if [ -z "$$GOOGLE_API_KEY" ]; then \
		echo "GOOGLE_API_KEY es obligatorio."; \
		echo "Ejemplo: GOOGLE_API_KEY=... make reviews-fix"; \
		exit 1; \
	fi
	@python3 bin/fix_reviews.py --api-key "$$GOOGLE_API_KEY"

# Enrich local review pages with ISBN/Purchase metadata from library-details.
reviews-enrich:
	@python3 bin/enrich_review_pages_from_library_details.py \
		--library-json "$(LIBRARY_JSON)" \
		--library-details-json "$(LIBRARY_DETAILS_JSON)"

# Dry-run preview for review metadata enrichment.
reviews-enrich-dry:
	@python3 bin/enrich_review_pages_from_library_details.py \
		--library-json "$(LIBRARY_JSON)" \
		--library-details-json "$(LIBRARY_DETAILS_JSON)" \
		--dry-run

# Import rows from BookBuddy CSV into library-details JSON (no duplicates).
library-details-import:
	@python3 bin/import_bookbuddy_to_library_details.py \
		--csv "$(BOOKBUDDY_CSV)" \
		--out "$(LIBRARY_DETAILS_JSON)"

# Match Goodreads bookId values into library-details JSON by title+author.
library-details-match:
	@python3 bin/match_library_details_bookids.py \
		--library-json "$(LIBRARY_JSON)" \
		--library-details-json "$(LIBRARY_DETAILS_JSON)" \
		--cross-ref-json "update/cross-reference-overrides.json"

# Recommended workflow when bookbuddy.csv changes.
library-details-sync: library-details-import library-details-match

# D: Tras copiar bookbuddy.csv (y opcionalmente export HTML BookBuddy): import + marcador DCC vacío + match bookIds.
library-bookbuddy-update: library-details-import library-stub-dcc-details library-details-match

library-stub-dcc-details:
	@python3 bin/stub_empty_dcc_library_details.py --library-details-json "$(LIBRARY_DETAILS_JSON)"

# Portadas embebidas desde export HTML BookBuddy (por defecto info/bookbuddy.htm; fallback update/bookbuddy.htm).
library-bookbuddy-covers:
	@python3 bin/extract_bookbuddy_embedded_covers.py \
		--output-dir "$${OUTPUT_DIR:-antilibrary/covers}"

# E: Informe markdown para revisar cruces antes/después de match_library_details_bookids.
library-cross-ref-report:
	@python3 bin/report_cross_reference_candidates.py \
		--library-json "$(LIBRARY_JSON)" \
		--library-details-json "$(LIBRARY_DETAILS_JSON)" \
		--only-unmatched \
		--out "update/cross-reference-overrides.json"

# Copiar clasificación DCC desde library.json hacia filas enlazadas en library-details.json.
sync-dcc-library-details:
	@python3 bin/sync_dcc_library_to_library_details.py

library-ddc-generate-pending:
	@echo ""
	@echo ">>> library-ddc-generate-pending → update/books_to_classify*.json"
	@python3 bin/generate_books_to_classify.py \
		--library-json "$(LIBRARY_JSON)" \
		--library-details "$(LIBRARY_DETAILS_JSON)" \
		--output-dir update \
		--prefix books_to_classify \
		--batch-size "$(BATCH_SIZE)"

library-drzrating-gemini-export:
	@echo ""
	@echo ">>> library-drzrating-gemini-export → update/drzrating_pending.json + update/drzrating_context.json"
	@python3 bin/export_drzrating_for_gemini.py --library-json "$(LIBRARY_JSON)"

library-drzrating-gemini-apply:
	@echo ""
	@echo ">>> library-drzrating-gemini-apply IN=update/drzrating_gemini_output.json → $(LIBRARY_JSON)"
	@python3 bin/apply_drzrating_from_gemini.py \
		--in-json "$${IN:-update/drzrating_gemini_output.json}" \
		--library-json "$(LIBRARY_JSON)"

library-ddc-apply-gemini:
	@echo ""
	@echo ">>> library-ddc-apply-gemini ($(GEMINI_CLASSIFICATION_FILES))"
	@python3 bin/apply_dcc_from_gemini.py $(GEMINI_CLASSIFICATION_FILES)
	@echo "Clasificación Gemini aplicada. Opcional: make sync-dcc-library-details"

# Update Dewey Decimal Classification based on OpenLibrary and Genres.
library-ddc-update:
	@python3 bin/update_ddc.py

# Cadena automatizable (revisar informe de cruces antes de confiar en match).
update-all-books:
	@echo "→ likes Goodreads"
	@$(MAKE) library-goodreads-likes
	@echo "→ últimas reseñas locales"
	@$(MAKE) library-goodreads-reviews-latest
	@echo "→ BookBuddy CSV import + stub dcc_classes"
	@$(MAKE) library-details-import
	@$(MAKE) library-stub-dcc-details
	@echo "→ informe cruces (editar details y luego: make library-details-match)"
	@$(MAKE) library-cross-ref-report
	@echo "→ lotes pendientes para Gemini"
	@$(MAKE) library-ddc-generate-pending
	@echo "Hecho. Pasos humanos: revisar update/cross-reference-report.md, make library-details-match, subir update/books_to_classify*.json a Gemini, make library-ddc-apply-gemini"

# Deploy Cloudflare Worker defined in wrangler.toml.
worker-deploy:
	@npx wrangler deploy

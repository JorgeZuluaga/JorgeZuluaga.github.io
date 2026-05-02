.PHONY: \
	help start dev stop \
	classroom \
	library-build library-update library-stats library-refresh library-local-likes-sync visitor-logs-sync library-antibiblioteca-sync \
	notebooklm-reviews-export \
	antilibrary-covers-fetch \
	antilibrary-covers-extract-html \
	reviews-first reviews-all reviews-force reviews-refresh reviews-fix reviews-enrich reviews-enrich-dry \
	library-details-import library-details-match library-details-sync \
	worker-deploy

PORT ?= 8000
HOST ?= 127.0.0.1
LIBRARY_JSON ?= info/library.json
LIBRARY_STATS_JSON ?= info/library-stats.json
LIBRARY_DETAILS_JSON ?= info/library-details.json
BOOKBUDDY_CSV ?= info/bookbuddy.csv
RSS_URL ?=
COOKIE ?= 
RSS_PAGES ?= 100
REVIEW_RSS_PAGES ?= 100
FORCE ?= 0
SITE_BASE_URL ?= https://jorgezuluaga.github.io
VISITOR_WORKER_BASE ?= https://visitor-log-worker.jorgezuluaga.workers.dev

help:
	@echo "Available targets:"
	@echo "  make help               - Show this help"
	@echo "  make start              - Start simple HTTP server (background)"
	@echo "  make dev                - Start hot-reload local dev server"
	@echo "  make stop               - Stop server running on PORT"
	@echo "  make classroom          - Sync Google Classroom courses"
	@echo "  make library-build      - Build info/library.json from Goodreads RSS"
	@echo "                            Required: RSS_URL=... Optional: COOKIE=... RSS_PAGES=... (likes completos)"
	@echo "  make library-update     - Incremental update (books + reviews) using FORCE mode"
	@echo "                            FORCE=0: solo libros nuevos, sin refresh de likes"
	@echo "                            FORCE=1: likes/reseñas solo de libros nuevos"
	@echo "                            FORCE=2: likes y reseñas completas (full refresh)"
	@echo "  make library-stats      - Rebuild info/library-stats.json"
	@echo "  make library-refresh    - Run library-build + library-stats"
	@echo "  make library-local-likes-sync - Snapshot local likes from worker into info/library.json"
	@echo "                            Optional: VISITOR_WORKER_BASE=... (default worker URL)"
	@echo "  make visitor-logs-sync  - Sync historical visitor logs to local backup files in info/"
	@echo "                            Required env: LOG_READ_TOKEN=... Optional: VISITOR_WORKER_BASE=..."
	@echo "  make library-antibiblioteca-sync - Match library-details and seed unread books into library.json"
	@echo "  make notebooklm-reviews-export - Export reviews to update/reviews in Markdown batches"
	@echo "                            Optional: CHUNK_SIZE=5 (reviews per file)"
	@echo "  make antilibrary-covers-fetch - Fetch anti-library covers by ISBN (pilot default 50)"
	@echo "                            Optional: LIMIT=50 OUTPUT_DIR=antilibrary/covers RETRIES=3"
	@echo "  make antilibrary-covers-extract-html - Extract embedded covers from BookBuddy HTML only"
	@echo "                            Optional: BOOKBUDDY_HTML='update/BookBuddy ... .htm' OUTPUT_DIR=antilibrary/covers"
	@echo "  make reviews-all        - Mirror all reviews in reviews/"
	@echo "                            Optional: COOKIE=... REVIEW_RSS_PAGES=..."
	@echo "  make reviews-first      - Mirror only the first review (smoke test)"
	@echo "  make reviews-force      - Force regenerate all mirrored reviews"
	@echo "  make reviews-refresh    - Run reviews-all + library-stats"
	@echo "  make reviews-fix        - Fix review HTML text with Gemini"
	@echo "                            Required env: GOOGLE_API_KEY=..."
	@echo "  make reviews-enrich     - Enrich reviews/*.html with ISBN + purchase metadata from library-details"
	@echo "  make reviews-enrich-dry - Preview review enrichment without writing changes"
	@echo "  make library-details-import - Import $(BOOKBUDDY_CSV) into $(LIBRARY_DETAILS_JSON)"
	@echo "  make library-details-match  - Match bookId from $(LIBRARY_JSON) into $(LIBRARY_DETAILS_JSON)"
	@echo "  make library-details-sync   - Run import + match (use after changing bookbuddy.csv)"
	@echo "  make worker-deploy      - Deploy Cloudflare worker (visitor-log-worker)"

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
		--cookie "$(COOKIE)" \
		--verbose

# Incremental update:
# FORCE=0 -> no likes scrape; only new books are added to library, existing metadata is preserved.
# FORCE=1 -> scrape likes only for new books, mirror only new reviews.
# FORCE=2 -> full likes + full reviews refresh.
library-update:
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
	@python3 bin/update_library_stats.py "$(LIBRARY_JSON)" --out "$(LIBRARY_STATS_JSON)"

# Update custom drzrating for newly added books (drzrating = 0)
library-drzrating-update:
	@python3 bin/update_drzrating.py \
		--library-json "$(LIBRARY_JSON)" \
		--base-dir "."

# Full refresh for library data + details sync + derived stats.
library-refresh: library-build library-details-sync library-stats
	@echo "Library refresh completed."

# Save local review likes snapshot directly into info/library.json.
library-local-likes-sync:
	@python3 bin/sync_local_review_likes.py \
		--library-json "$(LIBRARY_JSON)" \
		--worker-base "$(VISITOR_WORKER_BASE)"

# Sync historical visitor logs from worker into local backup snapshot files.
visitor-logs-sync:
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
	@python3 bin/mirror_first_review.py \
		--library-json "$(LIBRARY_JSON)" \
		--reviews-dir reviews \
		--cookie "$(COOKIE)" \
		--rss-pages "$(REVIEW_RSS_PAGES)" \
		--site-base-url "$(SITE_BASE_URL)"

# Generate/update local mirror for all reviews found.
reviews-all:
	@python3 bin/mirror_all_reviews.py \
		--library-json "$(LIBRARY_JSON)" \
		--reviews-dir reviews \
		--cookie "$(COOKIE)" \
		--rss-pages "$(REVIEW_RSS_PAGES)" \
		--site-base-url "$(SITE_BASE_URL)"

# Force regenerate local mirror for all reviews.
reviews-force:
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
		--library-details-json "$(LIBRARY_DETAILS_JSON)"

# Recommended workflow when bookbuddy.csv changes.
library-details-sync: library-details-import library-details-match
	@echo "Library details sync completed."

# Deploy Cloudflare Worker defined in wrangler.toml.
worker-deploy:
	@npx wrangler deploy

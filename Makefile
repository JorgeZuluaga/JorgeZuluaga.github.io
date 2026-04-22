.PHONY: \
	help start dev stop \
	classroom \
	library-build library-stats library-refresh \
	reviews-all reviews-force reviews-refresh

PORT ?= 8000
HOST ?= 127.0.0.1
LIBRARY_JSON ?= info/library.json
LIBRARY_STATS_JSON ?= info/library-stats.json
RSS_URL ?=
COOKIE ?=
RSS_PAGES ?= 1
REVIEW_RSS_PAGES ?= 80

help:
	@echo "Available targets:"
	@echo "  make help               - Show this help"
	@echo "  make start              - Start simple HTTP server (background)"
	@echo "  make dev                - Start hot-reload local dev server"
	@echo "  make stop               - Stop server running on PORT"
	@echo "  make classroom          - Sync Google Classroom courses"
	@echo "  make library-build      - Build info/library.json from Goodreads RSS"
	@echo "                            Required: RSS_URL=... Optional: COOKIE=... RSS_PAGES=..."
	@echo "  make library-stats      - Rebuild info/library-stats.json"
	@echo "  make library-refresh    - Run library-build + library-stats"
	@echo "  make reviews-all        - Mirror all reviews in reviews/"
	@echo "                            Optional: COOKIE=... REVIEW_RSS_PAGES=..."
	@echo "  make reviews-force      - Force regenerate all mirrored reviews"
	@echo "  make reviews-refresh    - Run reviews-all + library-stats"

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
		--scrape-likes \
		--cookie "$(COOKIE)" \
		--verbose

# Regenerate info/library-stats.json from info/library.json.
library-stats:
	@python3 bin/update_library_stats.py "$(LIBRARY_JSON)" --out "$(LIBRARY_STATS_JSON)"

# Full refresh for library data + derived stats.
library-refresh: library-build library-stats
	@echo "Library refresh completed."

# Generate/update local mirror for all reviews found.
reviews-all:
	@python3 bin/mirror_all_reviews.py \
		--library-json "$(LIBRARY_JSON)" \
		--reviews-dir reviews \
		--cookie "$(COOKIE)" \
		--rss-pages "$(REVIEW_RSS_PAGES)"

# Force regenerate local mirror for all reviews.
reviews-force:
	@python3 bin/mirror_all_reviews.py \
		--library-json "$(LIBRARY_JSON)" \
		--reviews-dir reviews \
		--cookie "$(COOKIE)" \
		--rss-pages "$(REVIEW_RSS_PAGES)" \
		--force

# Typical review update workflow.
reviews-refresh: reviews-all library-stats
	@echo "Reviews refresh completed."

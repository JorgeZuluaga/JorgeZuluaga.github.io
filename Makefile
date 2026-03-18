.PHONY: start stop

PORT ?= 8000
HOST ?= 127.0.0.1

start:
	@echo "Starting server on http://$(HOST):$(PORT)"
	@nohup python3 -m http.server "$(PORT)" --bind "$(HOST)" >/dev/null 2>&1 &
	@sleep 0.2
	@echo "Started. Stop with: make stop"

stop:
	@echo "Stopping http.server (best-effort)"
	@pkill -TERM -f "http\\.server" 2>/dev/null || true
	@sleep 0.2
	@if pgrep -f "http\\.server" >/dev/null 2>&1; then \
		echo "Still running, forcing stop (SIGKILL). PIDs:"; \
		pgrep -f "http\\.server" | tr '\n' ' ' && echo ""; \
		pkill -KILL -f "http\\.server" 2>/dev/null || true; \
		sleep 0.2; \
	fi
	@if pgrep -f "http\\.server" >/dev/null 2>&1; then \
		echo "Warning: http.server still appears to be running. Matching processes:"; \
		ps -ax -o pid=,command= | grep -E "http\\.server" | grep -v grep || true; \
	else \
		echo "Stopped."; \
	fi

# =============================================================================
# .dev_common.mk — Deep cleanup and Python env helpers (local copy per project)
# =============================================================================
# Include from the project Makefile:
#   include .dev_common.mk          (git repos — file lives in repo root)
#   include ../make/.dev_common.mk  (non-git folders under dev/)
#
# Optional overrides in the project Makefile:
#   VENV_DIR  — virtualenv directory name (default: .venv)
#   PYTHON    — Python interpreter (default: python3)
#
# Optional on the command line:
#   GIT_GC_AGGRESSIVE=1 make cleanall   — use `git gc --aggressive` (much
#                                          slower, recomputes all deltas)
# =============================================================================

PYTHON   ?= python3
VENV_DIR ?= .venv
GIT_GC_AGGRESSIVE ?=

.PHONY: _dev_cleanall _dev_cleanall_caches _dev_cleanall_node \
        _dev_cleanall_venvs _dev_cleanall_build _dev_cleanall_docs \
        _dev_cleanall_misc _dev_cleanall_git _dev_env

# ---------------------------------------------------------------------------
# cleanall — deep cleanup
# ---------------------------------------------------------------------------

_dev_cleanall: _dev_cleanall_caches _dev_cleanall_node _dev_cleanall_venvs \
               _dev_cleanall_build _dev_cleanall_docs _dev_cleanall_misc \
               _dev_cleanall_git
	@echo "✓ Deep cleanup finished in $(notdir $(CURDIR))"

_dev_cleanall_caches:
	@echo "→ Python / Jupyter / linter caches…"
	@find . \
		\( -path './.git' -o -path './.git/*' \) -prune -o \
		-type d \( \
			-name '__pycache__' -o \
			-name '.ipynb_checkpoints' -o \
			-name '.pytest_cache' -o \
			-name '.mypy_cache' -o \
			-name '.ruff_cache' -o \
			-name '.hypothesis' -o \
			-name '.tox' \
		\) -print 2>/dev/null \
		| while IFS= read -r d; do [ -n "$$d" ] && rm -rf "$$d"; done || true
	@find . \
		\( -path './.git' -o -path './.git/*' \) -prune -o \
		-type f \( \
			-name '*.py[cod]' -o \
			-name '*$$py.class' -o \
			-name '.DS_Store' -o \
			-name 'Thumbs.db' -o \
			-name '*.swp' -o \
			-name '*~' -o \
			-name '#*#' \
		\) -print -delete 2>/dev/null || true

_dev_cleanall_node:
	@echo "→ Node.js / npm artifacts…"
	@find . \
		\( -path './.git' -o -path './.git/*' \) -prune -o \
		-type d \( \
			-name 'node_modules' -o \
			-name '.next' -o \
			-name '.nuxt' -o \
			-name '.turbo' -o \
			-name '.parcel-cache' -o \
			-name '.svelte-kit' \
		\) -print 2>/dev/null \
		| while IFS= read -r d; do [ -n "$$d" ] && rm -rf "$$d"; done || true
	@find . \
		\( -path './.git' -o -path './.git/*' \) -prune -o \
		-type d -name 'out' -path '*/apps/*' -print 2>/dev/null \
		| while IFS= read -r d; do [ -n "$$d" ] && rm -rf "$$d"; done || true
	@find . \
		\( -path './.git' -o -path './.git/*' \) -prune -o \
		-type f \( -name 'npm-debug.log*' -o -name 'yarn-error.log' -o -name '.eslintcache' \) \
		-print -delete 2>/dev/null || true

_dev_cleanall_venvs:
	@echo "→ Python virtual environments…"
	@for d in .venv venv env .devenv .tox; do \
		if [ -d "$$d" ]; then \
			echo "   rm -rf $$d"; \
			rm -rf "$$d" || true; \
		fi; \
	done; \
	find . -maxdepth 3 \
		\( -path './.git' -o -path './.git/*' \) -prune -o \
		-type d -name 'bin' -print 2>/dev/null \
		| while IFS= read -r bindir; do \
			venv="$$(dirname "$$bindir")"; \
			if [ -f "$$bindir/activate" ] || [ -f "$$venv/pyvenv.cfg" ]; then \
				case "$$venv" in \
					./.venv|./venv|./env|./.devenv|./.tox) continue ;; \
				esac; \
				echo "   rm -rf $$venv"; \
				rm -rf "$$venv" || true; \
			fi; \
		done; \
	true

_dev_cleanall_build:
	@echo "→ Python build artifacts…"
	@find . \
		\( -path './.git' -o -path './.git/*' \) -prune -o \
		-type d \( \
			-name 'build' -o \
			-name 'dist' -o \
			-name '*.egg-info' -o \
			-name 'htmlcov' -o \
			-name '.eggs' \
		\) -print 2>/dev/null \
		| while IFS= read -r d; do [ -n "$$d" ] && rm -rf "$$d"; done || true
	@find . \
		\( -path './.git' -o -path './.git/*' \) -prune -o \
		-type f \( -name '.coverage' -o -name 'coverage.xml' \) \
		-print -delete 2>/dev/null || true

# Compiled documentation: Sphinx (_build) and Jekyll (_site).
# Directories containing git-tracked files are skipped (some repos commit
# their built docs, e.g. for GitHub Pages).
_dev_cleanall_docs:
	@echo "→ Compiled documentation (_build, _site)…"
	@find . \
		\( -path './.git' -o -path './.git/*' \) -prune -o \
		-type d \( -name '_build' -o -name '_site' \) -prune -print 2>/dev/null \
		| while IFS= read -r d; do \
			[ -n "$$d" ] || continue; \
			if git -C "$$d" ls-files --error-unmatch . >/dev/null 2>&1; then \
				echo "   skip $$d (tracked by git)"; \
			else \
				echo "   rm -rf $$d"; \
				rm -rf "$$d" || true; \
			fi; \
		done || true

_dev_cleanall_misc:
	@echo "→ Misc temporary files…"
	@find . \
		\( -path './.git' -o -path './.git/*' \) -prune -o \
		-type d \( -name '.cache' -o -name '.sass-cache' \) -print 2>/dev/null \
		| while IFS= read -r d; do [ -n "$$d" ] && rm -rf "$$d"; done || true

# Git maintenance for every repository inside the project (root and nested
# clones). Only non-destructive operations: history, branches, stashes,
# unpushed commits and reflog (default 90/30-day expiry) are preserved.
#   worktree prune  — drop metadata of worktrees whose folder no longer exists
#   rerere gc       — expire old recorded merge resolutions
#   lfs prune       — drop old local LFS copies already on the remote (never
#                     unpushed ones); only if the repo uses LFS
#   gc              — pack loose objects, delete loose copies already packed,
#                     prune unreachable objects older than 2 weeks, pack refs,
#                     write commit-graph
_dev_cleanall_git:
	@echo "→ Git maintenance (gc$(if $(GIT_GC_AGGRESSIVE), --aggressive))…"
	@find . -type d -name '.git' -prune -print 2>/dev/null \
		| while IFS= read -r g; do \
			[ -n "$$g" ] || continue; \
			repo="$$(dirname "$$g")"; \
			git -C "$$repo" rev-parse --git-dir >/dev/null 2>&1 || continue; \
			before=$$(du -sk "$$g" 2>/dev/null | cut -f1); \
			git -C "$$repo" worktree prune </dev/null 2>/dev/null || true; \
			git -C "$$repo" rerere gc </dev/null 2>/dev/null || true; \
			if [ -d "$$g/lfs" ] && command -v git-lfs >/dev/null 2>&1; then \
				git -C "$$repo" lfs prune </dev/null || true; \
			fi; \
			git -C "$$repo" gc --quiet $(if $(GIT_GC_AGGRESSIVE),--aggressive) </dev/null \
				|| echo "   ⚠ git gc failed in $$repo"; \
			after=$$(du -sk "$$g" 2>/dev/null | cut -f1); \
			echo "   $$repo/.git: $$((before / 1024)) MB → $$((after / 1024)) MB"; \
		done || true

# ---------------------------------------------------------------------------
# env — create Python virtual environment
# ---------------------------------------------------------------------------

_dev_env:
	@echo "→ Creating virtual environment in $(VENV_DIR)…"
	@test -d $(VENV_DIR) || $(PYTHON) -m venv $(VENV_DIR)
	@. $(VENV_DIR)/bin/activate && pip install --upgrade pip
	@if [ -f requirements.txt ]; then \
		echo "→ Installing requirements.txt…"; \
		. $(VENV_DIR)/bin/activate && pip install -r requirements.txt; \
	fi
	@if [ -f requirements-dev.txt ]; then \
		echo "→ Installing requirements-dev.txt…"; \
		. $(VENV_DIR)/bin/activate && pip install -r requirements-dev.txt; \
	fi
	@if [ -f setup.py ] || [ -f pyproject.toml ]; then \
		echo "→ Installing package in editable mode…"; \
		. $(VENV_DIR)/bin/activate && pip install -e .; \
	fi
	@echo "✓ Environment ready. Activate with: source $(VENV_DIR)/bin/activate"

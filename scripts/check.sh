#!/usr/bin/env bash
# Те же проверки, что в CI (.github/workflows/ci.yml), одной командой.
#
#   ./scripts/check.sh          # только проверить
#   ./scripts/check.sh --fix    # сначала отформатировать и автоисправить, потом проверить
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FIX=0
[ "${1:-}" = "--fix" ] && FIX=1

step() { printf '\n\033[1;34m▶ %s\033[0m\n' "$*"; }

# --- Бэкенд ---
cd "$ROOT/bot"
uv sync -q --group dev
if [ "$FIX" = 1 ]; then
  step "ruff: автоисправление и форматирование"
  uv run --no-sync ruff check --fix -q .
  uv run --no-sync ruff format -q .
  uv export --locked --no-dev --no-hashes --no-emit-project --no-header -q -o requirements.txt
fi
step "ruff check";    uv run --no-sync ruff check .
step "ruff format";   uv run --no-sync ruff format --check .
step "ty";            uv run --no-sync ty check
step "pytest";        uv run --no-sync pytest -q

# --- Фронт ---
cd "$ROOT/web_app"
[ -d node_modules ] || bun install --frozen-lockfile
if [ "$FIX" = 1 ]; then
  step "bun fmt: форматирование"
  bun run format >/dev/null
  bunx eslint --fix src
fi
step "bun fmt";       bun run format:check
step "eslint";        bun run lint
step "tsc";           bun run typecheck
step "ng build";      bunx ng build --output-path "$(mktemp -d)" >/dev/null

# --- Скрипты ---
if command -v shellcheck >/dev/null; then
  step "shellcheck"; shellcheck "$ROOT"/scripts/*.sh
fi

printf '\n\033[1;32m✓ Все проверки пройдены\033[0m\n'

#!/usr/bin/env bash
# Локальная разработка через туннель: одной командой поднимает API, бота (на вебхуке),
# фронт (ng serve) и публичный HTTPS-адрес, чтобы открывать Mini App в Telegram без деплоя.
#
#   ./scripts/dev-tunnel.sh            # туннель выбирается сам: cloudflared → ssh (localhost.run) → ngrok
#   TUNNEL=ssh ./scripts/dev-tunnel.sh   # только этот
#
# Настройки — в .env.dev в корне (образец: .env.dev.example). Нужен ОТДЕЛЬНЫЙ тестовый бот:
# скрипт переставляет ему вебхук и кнопку меню на адрес туннеля.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEV="$ROOT/.dev"
mkdir -p "$DEV/logs" "$ROOT/bot/src/logs"   # bot/src/logs — файловые логи бота (logging.yaml)

say()  { printf '\033[1;32m▶ %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m! %s\033[0m\n' "$*" >&2; }
die()  { printf '\033[1;31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

# --- Настройки ---------------------------------------------------------------
ENV_FILE="${ENV_FILE:-$ROOT/.env.dev}"
[ -f "$ENV_FILE" ] || die "Нет $ENV_FILE. Сделайте: cp .env.dev.example .env.dev и впишите BOT_TOKEN"
set -a
# shellcheck source=/dev/null
. "$ENV_FILE"
set +a

[ -n "${BOT_TOKEN:-}" ] || die "В $ENV_FILE не задан BOT_TOKEN"
[ -n "${WISH_VALIDATE_TG_IDS:-}" ] || die "В $ENV_FILE не задан WISH_VALIDATE_TG_IDS (ваш Telegram ID)"

export WEB_PORT="${WEB_PORT:-4200}" API_PORT="${API_PORT:-8000}" WEBHOOK_PORT="${WEBHOOK_PORT:-8080}"
# Порт занят (например, бот от прошлого запуска) — сразу говорим, а не падаем после туннеля
for port in "$WEB_PORT" "$API_PORT" "$WEBHOOK_PORT"; do
  if (exec 3<>"/dev/tcp/127.0.0.1/$port") 2>/dev/null; then
    die "Порт $port занят. Освободите его или задайте другой в $ENV_FILE (WEB_PORT / API_PORT / WEBHOOK_PORT)"
  fi
done
export DB_URL="${DB_URL:-sqlite+aiosqlite:///$DEV/santa.db}"
export STATE_STORAGE_REDIS_URL="${STATE_STORAGE_REDIS_URL:-}"   # пусто = состояния в памяти
export WEBHOOK_SECRET="${WEBHOOK_SECRET:-$(head -c 18 /dev/urandom | od -An -tx1 | tr -d ' \n')}"
export AUTHOR_SUPPORT_LINK="${AUTHOR_SUPPORT_LINK:-https://t.me/}"
export DEBUG_TOOLS="${DEBUG_TOOLS:-1}"                    # отладочная панель (уровень, мандаринки); 0 — выключить
export ROOT_DIR="$ROOT/bot/labels"                         # картинки бота (в Docker это /labels)
export LOGS_CONFIGURATION_PATH="$ROOT/bot/logging.yaml"

# --- Зависимости -------------------------------------------------------------
PY="$ROOT/bot/.venv/bin/python"
if [ ! -x "$PY" ]; then
  say "Ставлю зависимости бота в bot/.venv"
  if command -v uv >/dev/null; then
    (cd "$ROOT/bot" && uv sync -q --group dev)
  else
    python3 -m venv "$ROOT/bot/.venv" && "$PY" -m pip install -q -r "$ROOT/bot/requirements.txt" aiosqlite
  fi
fi
if [ ! -d "$ROOT/web_app/node_modules" ]; then
  say "Ставлю зависимости фронта (bun install)"
  command -v bun >/dev/null || die "Нужен bun: curl -fsSL https://bun.sh/install | bash"
  (cd "$ROOT/web_app" && bun install)
fi

# --- Процессы и уборка -------------------------------------------------------
PIDS=()
NAMES=()   # имя процесса для каждого PID — чтобы сказать, кто упал
TG="https://api.telegram.org/bot$BOT_TOKEN"

cleanup() {
  trap - EXIT INT TERM
  echo
  say "Останавливаю…"
  # Туннель сейчас умрёт: снимаем вебхук и возвращаем обычную кнопку меню
  curl -fsS -o /dev/null "$TG/deleteWebhook" 2>/dev/null || true
  curl -fsS -o /dev/null -H 'Content-Type: application/json' \
    -d '{"menu_button":{"type":"default"}}' "$TG/setChatMenuButton" 2>/dev/null || true
  for pid in "${PIDS[@]}"; do killtree "$pid"; done
  wait 2>/dev/null || true
}

# kill с потомками (ng serve, python, tee внутри конвейеров)
killtree() {
  local child
  for child in $(pgrep -P "$1" 2>/dev/null); do killtree "$child"; done
  kill "$1" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

# Запуск с префиксом в выводе и копией в .dev/logs/<name>.log
run() {
  local name="$1"; shift
  ( "$@" 2>&1 | tee "$DEV/logs/$name.log" | sed -u "s/^/[$name] /" ) &
  PIDS+=($!)
  NAMES+=("$name")
}

# --- Туннель -----------------------------------------------------------------
# Каждый вид пробуется по очереди, берётся первый, который реально подключился:
# cloudflared (у части провайдеров заблокирован: TCP/UDP 7844 к Cloudflare) →
# ssh на localhost.run (порт 22, без страницы-предупреждения — PWA ставится) →
# ngrok (бесплатный отдаёт браузеру страницу-предупреждение: Mini App работает,
# а PWA с телефона не установить — Chrome видит её вместо манифеста).
TUNNEL_LOG="$DEV/logs/tunnel.log"
PUBLIC_URL=""
TUNNEL_PID=""

# start_tunnel <вид>: запускает, ждёт адрес и подключение; при неудаче гасит процесс
start_tunnel() {
  local kind="$1" pattern="" ready="" waited=0
  : > "$TUNNEL_LOG"
  case "$kind" in
    cloudflared)
      # http2, не QUIC: UDP часто режут
      cloudflared tunnel --no-autoupdate --protocol http2 --url "http://localhost:$WEB_PORT" >"$TUNNEL_LOG" 2>&1 &
      pattern='https://[a-z0-9]+(-[a-z0-9]+)+\.trycloudflare\.com'  # не api.trycloudflare.com из лога
      # Адрес печатается раньше подключения: до него адрес отвечает «Error 1033»
      ready='Registered tunnel connection' ;;
    ngrok)
      ngrok http "$WEB_PORT" --log stdout --log-format logfmt >"$TUNNEL_LOG" 2>&1 &
      # бесплатные адреса: *.ngrok-free.app, с 2025 — *.ngrok-free.dev; свой домен берём из API ngrok
      pattern='https://[a-z0-9.-]+\.ngrok(-free)?\.(app|dev|io)' ;;
    ssh)
      ssh -o StrictHostKeyChecking=accept-new -o ServerAliveInterval=30 -o ExitOnForwardFailure=yes \
        -o ConnectTimeout=15 -R "80:localhost:$WEB_PORT" nokey@localhost.run >"$TUNNEL_LOG" 2>&1 &
      pattern='https://[a-z0-9]+\.lhr\.life' ;;
    *) die "Неизвестный TUNNEL=$kind (cloudflared | ssh | ngrok)" ;;
  esac
  TUNNEL_PID=$!
  PUBLIC_URL=""
  while [ "$waited" -lt 45 ]; do
    [ -z "$PUBLIC_URL" ] && PUBLIC_URL="$(grep -oE "$pattern" "$TUNNEL_LOG" | head -1 || true)"
    # ngrok: адрес надёжнее спросить у его локального API (порт 4040, если занят — 4041…)
    if [ -z "$PUBLIC_URL" ] && [ "$kind" = ngrok ]; then
      for api in 4040 4041 4042; do
        PUBLIC_URL="$(curl -fsS "http://127.0.0.1:$api/api/tunnels" 2>/dev/null \
          | grep -oE '"public_url":"https://[^"]+' | head -1 | cut -d'"' -f4 || true)"
        [ -n "$PUBLIC_URL" ] && break
      done
    fi
    if [ -n "$PUBLIC_URL" ] && { [ -z "$ready" ] || grep -q "$ready" "$TUNNEL_LOG"; }; then
      PIDS+=("$TUNNEL_PID")
      NAMES+=(tunnel)
      return 0
    fi
    kill -0 "$TUNNEL_PID" 2>/dev/null || break
    sleep 1
    waited=$((waited + 1))
  done
  warn "$kind не подключился. Последние строки лога:"
  tail -n 8 "$TUNNEL_LOG" >&2
  killtree "$TUNNEL_PID"
  PUBLIC_URL=""
  return 1
}

TUNNEL="${TUNNEL:-auto}"
if [ "$TUNNEL" = auto ]; then
  CANDIDATES=()
  for kind in cloudflared ssh ngrok; do
    command -v "$kind" >/dev/null && CANDIDATES+=("$kind")
  done
  [ "${#CANDIDATES[@]}" -gt 0 ] || die "Нет ни cloudflared, ни ssh, ни ngrok. Поставьте cloudflared: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/"
else
  CANDIDATES=("$TUNNEL")
fi

for kind in "${CANDIDATES[@]}"; do
  say "Поднимаю туннель ($kind) → localhost:$WEB_PORT"
  if start_tunnel "$kind"; then TUNNEL="$kind"; break; fi
done
[ -n "$PUBLIC_URL" ] || die "Ни один туннель не подключился (${CANDIDATES[*]}). Проверьте сеть или включите VPN"
if [ "$TUNNEL" = ngrok ]; then
  warn "Через бесплатный ngrok телефон не установит PWA (страница-предупреждение вместо манифеста) — Mini App работает"
fi

export WEBAPP_URL="$PUBLIC_URL"
export WEBHOOK_URL="$PUBLIC_URL/telegram/webhook"

# --- Приложение --------------------------------------------------------------
say "Запускаю фронт, API и бота"
run web bash -c "cd '$ROOT/web_app' && exec npx ng serve --port $WEB_PORT"
run api bash -c "cd '$ROOT/bot/src' && exec '$PY' api_main.py"
# Бот и API создают таблицы при старте; на SQLite нет advisory lock — даём API начать первым
sleep 3
run bot bash -c "cd '$ROOT/bot/src' && exec '$PY' main.py"

BOT_NAME="$(curl -fsS "$TG/getMe" | grep -oE '"username":"[^"]+"' | cut -d'"' -f4 || true)"
cat <<EOF

  🎄 Готово!
     Сайт / Mini App:  $PUBLIC_URL
     Бот:              ${BOT_NAME:+https://t.me/$BOT_NAME}  (кнопка «🎄 Санта» открывает Mini App)
     Логи:             .dev/logs/
  Ctrl+C — остановить всё (вебхук и кнопка меню снимутся).

EOF

# Ждём, пока все живы (без wait -n — его нет в bash 3 на macOS)
DEAD=""
while [ -z "$DEAD" ]; do
  for i in "${!PIDS[@]}"; do
    kill -0 "${PIDS[$i]}" 2>/dev/null || { DEAD="${NAMES[$i]}"; break; }
  done
  [ -n "$DEAD" ] || sleep 2
done
warn "Завершился процесс «$DEAD» — останавливаю остальные. Конец его лога (.dev/logs/$DEAD.log):"
tail -n 15 "$DEV/logs/$DEAD.log" >&2 || true

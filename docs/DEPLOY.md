# Развёртывание «Тайного Санты»

## Как всё устроено

- Один домен обслуживает Mini App в Telegram, обычный сайт и PWA (приложение на телефон).
- Входящие запросы принимает **Caddy** (контейнер `web`): он сам получает и продлевает HTTPS-сертификат Let's Encrypt.
  - `/` — статика Angular-приложения;
  - `/api/*` — HTTP API (контейнер `api`, порт 8000);
  - `/telegram/webhook` — вебхук Telegram (контейнер `bot`, порт 8080).
- В `docker-compose.yaml` также живут `db` (Postgres) и `state_storage` (Redis).

## Что нужно

- Недорогой VPS (1 vCPU / 1–2 ГБ RAM достаточно), Ubuntu/Debian.
- Домен с A-записью на IP сервера.
- Открытые порты 80 и 443 (TCP) и 443 (UDP).

## Установка по шагам

1. Установите Docker (на сервере):
   ```bash
   curl -fsSL https://get.docker.com | sh
   ```
2. Склонируйте проект:
   ```bash
   git clone <адрес-репозитория> secret_santa && cd secret_santa
   ```
3. Создайте и заполните настройки:
   ```bash
   cp .env.example .env
   nano .env
   ```
   Укажите `DOMAIN`, `WEBAPP_URL` (`https://ваш-домен`), пароли БД и Redis, `BOT_TOKEN`, `WEBHOOK_SECRET` (случайная строка: `openssl rand -hex 24`), `WISH_VALIDATE_TG_IDS` (Telegram ID модераторов через запятую).
4. Запустите:
   ```bash
   docker compose up -d --build
   ```
5. Проверьте:
   ```bash
   docker compose ps
   docker compose logs -f bot api web
   ```
   Откройте `https://ваш-домен` — сайт должен загрузиться по HTTPS.

Обновление: `git pull && docker compose up -d --build`.

## Настройка в BotFather

1. `/setdomain` → выберите бота → введите ваш домен. Это нужно для Telegram Login Widget (вход на сайте).
2. Кнопка меню с Mini App: `/mybots` → ваш бот → Bot Settings → Menu Button → Configure menu button → URL `https://ваш-домен`.
3. По желанию: `/newapp` — создаст прямую ссылку вида `t.me/<бот>/<приложение>`.
4. Модераторы пожеланий задаются в `WISH_VALIDATE_TG_IDS`.

## Установка PWA пользователями

- **Android (Chrome):** открыть сайт → меню ⋮ → «Установить приложение».
- **iPhone (Safari):** открыть сайт → «Поделиться» → «На экран «Домой»».

Позже приложение можно выложить в Google Play как TWA (через Bubblewrap, разовый взнос $25). В App Store публиковаться не нужно.

## Локальная разработка через туннель (Mini App в Telegram без деплоя)

Mini App и вебхук Telegram работают только по HTTPS, поэтому локально всё открывается через туннель.
Одна команда поднимает API, бота (на вебхуке), фронт (`ng serve` с живой перезагрузкой) и публичный HTTPS-адрес:

```bash
cp .env.dev.example .env.dev    # впишите BOT_TOKEN тестового бота и свой Telegram ID
./scripts/dev-tunnel.sh
```

- Нужен **отдельный тестовый бот** (@BotFather → `/newbot`): скрипт ставит ему вебхук и кнопку меню «🎄 Санта»
  на адрес туннеля, а по Ctrl+C снимает их.
- Туннель выбирается сам: `cloudflared` (бесплатно, без регистрации — рекомендуется) → `ngrok` → `ssh` на localhost.run
  (ничего ставить не надо). Явно: `TUNNEL=ngrok ./scripts/dev-tunnel.sh`.
  Поставить cloudflared: `brew install cloudflared` или пакет со страницы Cloudflare (Downloads).
- База по умолчанию — SQLite в `.dev/santa.db`, состояния бота — в памяти. Postgres/Redis можно задать в `.env.dev`.
- Логи: `.dev/logs/` (и в терминале с префиксами `[web]`, `[api]`, `[bot]`).
- Адрес туннеля меняется при каждом запуске, поэтому вход на **сайте** через Telegram Login Widget не заработает
  (нужен `/setdomain`). Mini App внутри Telegram работает и без него.
- Схема: туннель → `ng serve :4200` → `/api` на `:8000`, `/telegram/webhook` на `:8080` (`web_app/proxy.conf.mjs`).
  Если порт занят, поменяйте `WEB_PORT` / `API_PORT` / `WEBHOOK_PORT` в `.env.dev`.

## Локальная разработка без туннеля

```bash
# Бот: оставьте WEBHOOK_URL пустым — бот будет работать через polling
cd bot/src && python main.py

# API
cd bot/src && python api_main.py        # слушает :8000

# Веб-приложение (запросы /api проксируются на localhost:8000 через web_app/proxy.conf.mjs)
cd web_app && bun install && npx ng serve
```

(Не используйте `npm install` — с этим lock-файлом он работает некорректно.)

## Резервные копии

```bash
docker compose exec -T db sh -c 'pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB"' > backup_$(date +%F).sql
```

Восстановление: `docker compose exec -T db sh -c 'psql -U "$POSTGRES_USER" "$POSTGRES_DB"' < backup.sql`.

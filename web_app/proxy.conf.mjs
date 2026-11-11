// Прокси для ng serve: порты API и вебхука бота берутся из окружения (.env.dev → scripts/dev-tunnel.sh)
const api = process.env.API_PORT || 8000;
const bot = process.env.WEBHOOK_PORT || 8080;

export default {
  '/api': { target: `http://localhost:${api}`, secure: false, changeOrigin: true },
  '/telegram/webhook': { target: `http://localhost:${bot}`, secure: false },
};

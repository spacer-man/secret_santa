import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { App } from './app/app';
import { loadTelegram } from './app/core/tg-bridge';

// Telegram's script must be in place before the app reads it (and before the router touches the hash)
loadTelegram()
  .then(() => bootstrapApplication(App, appConfig))
  .catch((err) => console.error(err));

// PWA: installable on Android / iOS home screen and works offline-ish
if ('serviceWorker' in navigator && location.protocol === 'https:') {
  addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
}

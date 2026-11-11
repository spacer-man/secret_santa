import { isDevMode } from '@angular/core';
import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { App } from './app/app';
import { loadTelegram } from './app/core/tg-bridge';

// Telegram's script must be in place before the app reads it (and before the router touches the hash)
loadTelegram()
  .then(() => bootstrapApplication(App, appConfig))
  .catch((err) => console.error(err));

// PWA: installable on Android / iOS home screen and works offline-ish.
// Not in development (ng serve, the tunnel): there the files keep their names between builds,
// a cached copy would hide every change. A worker left from before is removed with its cache.
if ('serviceWorker' in navigator && location.protocol === 'https:') {
  if (isDevMode()) {
    navigator.serviceWorker
      .getRegistrations()
      .then((all) => all.forEach((r) => r.unregister()))
      .catch(() => {});
    caches
      ?.keys()
      .then((keys) => keys.forEach((k) => caches.delete(k)))
      .catch(() => {});
  } else {
    addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
  }
}

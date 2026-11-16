import { isDevMode } from '@angular/core';
import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { App } from './app/app';

bootstrapApplication(App, appConfig).catch((err) => console.error(err));

// PWA: installable on Android / iOS home screen and works offline-ish.
// In development (`ng serve`, also through the tunnel) there is no service worker: it would
// keep old code on the phone. One left from before is removed together with its cache.
if ('serviceWorker' in navigator && location.protocol === 'https:') {
  if (isDevMode()) {
    navigator.serviceWorker
      .getRegistrations()
      .then((all) => all.forEach((r) => r.unregister()))
      .catch(() => {});
    if ('caches' in window) {
      caches
        .keys()
        .then((keys) => keys.forEach((k) => caches.delete(k)))
        .catch(() => {});
    }
  } else {
    addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
  }
}

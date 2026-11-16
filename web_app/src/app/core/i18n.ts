import { Injectable } from '@angular/core';
import type { Dict } from './i18n-ru';

export type Lang = 'ru' | 'en';

/** The language of the person: Telegram's, else the browser's */
export function detectLanguage(): Lang {
  const code =
    window.Telegram?.WebApp?.initDataUnsafe.user?.language_code ?? navigator.language ?? 'en';
  return /^(ru|uk|be|kk)/.test(code) ? 'ru' : 'en';
}

let lang: Lang = 'en';
let dict: Dict | undefined;
let guess: { lang: Lang; dict: Promise<Dict> } | undefined;

const browserLang = (): Lang => (/^(ru|uk|be|kk)/.test(navigator.language ?? '') ? 'ru' : 'en');

function fetchDict(l: Lang): Promise<Dict> {
  return l === 'ru' ? import('./i18n-ru').then((m) => m.ru) : import('./i18n-en').then((m) => m.en);
}

/**
 * Only the needed language is downloaded. Start early with a guess from the
 * browser (in parallel with Telegram's script), then settle once Telegram
 * tells the real language — before the app starts.
 */
export function preloadLanguage(): void {
  const l = browserLang();
  guess = { lang: l, dict: fetchDict(l) };
}

export async function loadLanguage(): Promise<void> {
  lang = detectLanguage();
  dict = await (guess?.lang === lang ? guess.dict : fetchDict(lang));
}

export type Key = { [K in keyof Dict]: Dict[K] extends string ? K : never }[keyof Dict];

@Injectable({ providedIn: 'root' })
export class I18n {
  /** Fixed for the session: the texts of one language only are downloaded */
  readonly lang = (): Lang => lang;

  get dict(): Dict {
    if (!dict) throw new Error('loadLanguage() must finish before the app starts');
    return dict;
  }

  t(key: Key): string {
    return this.dict[key];
  }
}

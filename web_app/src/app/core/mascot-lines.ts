/**
 * What the mascot says, by language → character → topic.
 * Tokens: {me} — the hero's name, {laugh} — his laugh, {name} — the person's name.
 * Russian lines avoid gendered verbs about the person (we do not know who reads).
 */
export type Mood = 'classic' | 'jolly' | 'fairy' | 'grumpy';
export type Topic =
  'greet' | 'tip' | 'rules' | 'teaser' | 'install' | 'write' | 'gift' | 'midnight';

/** What one language has: character → topic → lines */
export type MoodLines = Record<Mood, Record<Topic, string[]>>;

/** Lines of one language only: a lazy chunk each */
export function loadLines(lang: 'ru' | 'en'): Promise<MoodLines> {
  return lang === 'ru'
    ? import('./mascot-lines-ru').then((m) => m.ru)
    : import('./mascot-lines-en').then((m) => m.en);
}

import { Injectable, computed, inject, signal } from '@angular/core';
import { I18n } from './i18n';
import { Store } from './store';
import { LINES, Mood, Topic } from './mascot-lines';

export type { Mood, Topic } from './mascot-lines';
/** Ded Moroz (the Russian Father Frost) or Santa Claus */
export type Hero = 'moroz' | 'santa';

export const HEROES: Hero[] = ['moroz', 'santa'];
export const MOODS: Mood[] = ['classic', 'jolly', 'fairy', 'grumpy'];

const KEY = 'santa.mascot';

interface Saved {
  hero: Hero;
  mood: Mood;
}

/**
 * The mascot: a hero (Ded Moroz or Santa) with a character the person picks
 * (classic, jolly — for teens, with jokes and slang, fairy-tale, grumpy).
 * The choice lives in this browser only.
 */
@Injectable({ providedIn: 'root' })
export class Mascot {
  private readonly i18n = inject(I18n);
  private readonly store = inject(Store);
  private readonly saved = this.load();

  readonly hero = signal<Hero>(this.saved?.hero ?? (this.i18n.lang() === 'ru' ? 'moroz' : 'santa'));
  readonly mood = signal<Mood>(this.saved?.mood ?? 'classic');
  /** The person has not chosen yet: the settings are offered once */
  readonly chosen = signal(!!this.saved);

  readonly name = computed(() => this.i18n.dict.mascot.heroes[this.hero()]);

  /** Index of the next line per topic: lines go in turn, starting at a random one */
  private readonly next = new Map<string, number>();

  set(hero: Hero, mood: Mood): void {
    this.hero.set(hero);
    this.mood.set(mood);
    this.chosen.set(true);
    this.next.clear();
    try {
      localStorage.setItem(KEY, JSON.stringify({ hero, mood } satisfies Saved));
    } catch {}
  }

  /** The next line on the topic (in the given character, or the chosen one) */
  say(topic: Topic, mood: Mood = this.mood(), hero: Hero = this.hero()): string {
    const lines = LINES[this.i18n.lang()][mood][topic];
    const key = `${mood}:${topic}`;
    const i = this.next.get(key) ?? Math.floor(Math.random() * lines.length);
    this.next.set(key, (i + 1) % lines.length);
    return this.fill(lines[i % lines.length], hero);
  }

  /** The first line of a topic, always the same (for samples in the settings) */
  sample(topic: Topic, mood: Mood, hero: Hero = this.hero()): string {
    return this.fill(LINES[this.i18n.lang()][mood][topic][0], hero);
  }

  private fill(line: string, hero: Hero): string {
    const d = this.i18n.dict.mascot;
    const name = this.store.me()?.first_name?.trim() || d.friend;
    return line
      .replaceAll('{me}', d.heroes[hero])
      .replaceAll('{laugh}', d.laugh[hero])
      .replaceAll('{name}', name);
  }

  private load(): Saved | null {
    try {
      const v = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<Saved> | null;
      if (v && HEROES.includes(v.hero as Hero) && MOODS.includes(v.mood as Mood)) {
        return v as Saved;
      }
    } catch {}
    return null;
  }
}

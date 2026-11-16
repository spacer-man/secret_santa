import { Injectable, computed, inject, signal } from '@angular/core';
import { DAYTIME_HOURS } from '../components/tree3d/daytime';
import { Store } from './store';
import { offsetMinutes } from './time';

/** Time of day of the courtyard: as on the user's clock, or a fixed one picked by hand */
export type DaytimeMode = 'auto' | keyof typeof DAYTIME_HOURS;
export type DayPhase = keyof typeof DAYTIME_HOURS;

export const DAYTIME_MODES: DaytimeMode[] = ['auto', 'morning', 'day', 'evening', 'night'];
export const PHASE_ICONS: Record<DaytimeMode, string> = {
  auto: '🕰',
  morning: '🌄',
  day: '☀️',
  evening: '🌅',
  night: '🌙',
};

const KEY = 'santa.daytime';

function readMode(): DaytimeMode {
  try {
    const v = localStorage.getItem(KEY) as DaytimeMode | null;
    return v && DAYTIME_MODES.includes(v) ? v : 'auto';
  } catch {
    return 'auto';
  }
}

/** Which part of the day an hour belongs to (for the icon on the button) */
export function phaseOf(hour: number): DayPhase {
  if (hour < 7 || hour >= 19.5) return 'night';
  if (hour < 11) return 'morning';
  if (hour < 16) return 'day';
  return 'evening';
}

/** The chosen time of day (this browser only) and the hour the scene shows */
@Injectable({ providedIn: 'root' })
export class Daytime {
  private readonly store = inject(Store);
  readonly mode = signal<DaytimeMode>(readMode());

  /** Hour (0..24, to the minute) in the user's timezone, or on this device if it is unknown */
  readonly clockHour = computed(() => {
    const now = this.store.now();
    const tz = this.store.me()?.timezone;
    let minutes: number;
    if (tz) {
      const d = new Date(now + offsetMinutes(tz) * 60_000);
      minutes = d.getUTCHours() * 60 + d.getUTCMinutes();
    } else {
      const d = new Date(now);
      minutes = d.getHours() * 60 + d.getMinutes();
    }
    return minutes / 60;
  });

  /** The hour shown in the scene */
  readonly hour = computed(() => {
    const mode = this.mode();
    return mode === 'auto' ? this.clockHour() : DAYTIME_HOURS[mode];
  });

  readonly phase = computed(() => phaseOf(this.hour()));

  set(mode: DaytimeMode): void {
    this.mode.set(mode);
    try {
      localStorage.setItem(KEY, mode);
    } catch {
      // Private mode: the choice lives until the page is closed
    }
  }
}

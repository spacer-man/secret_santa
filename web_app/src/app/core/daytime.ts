import { Injectable, computed, inject, signal } from '@angular/core';
import { DAYTIME_FIXED, SunPlace, sunPlace, sunTimes } from '../components/tree3d/daytime';
import { Store } from './store';

/** Time of day of the courtyard: by the real sun at the user's place, or a fixed one picked by hand */
export type DayPhase = keyof typeof DAYTIME_FIXED;
export type DaytimeMode = 'auto' | DayPhase;

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

/** Which part of the day it is by the sun (for the icon on the button) */
export function phaseOf(sun: SunPlace): DayPhase {
  if (sun.elevation < -6) return 'night';
  if (sun.elevation < 10) return sun.hourAngle < 0 ? 'morning' : 'evening';
  return 'day';
}

const hhmm = (time: number) => {
  const d = new Date(time);
  return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
};

/**
 * The chosen time of day (this browser only) and where the sun is for the scene.
 * The place is the main city of the device's timezone (`Europe/Moscow` → Moscow):
 * no geolocation, nothing leaves the device. Unknown zone: the device's UTC offset
 * gives the longitude, the latitude is a middle northern one.
 */
@Injectable({ providedIn: 'root' })
export class Daytime {
  private readonly store = inject(Store);
  readonly mode = signal<DaytimeMode>(readMode());
  private readonly place = signal({ lat: 50, lon: -new Date().getTimezoneOffset() / 4 });
  /** Changes once a minute: the sun is recounted, the scene follows without a transition */
  private readonly minute = computed(() => Math.floor(this.store.now() / 60_000));

  constructor() {
    void this.locate();
  }

  private async locate(): Promise<void> {
    let zone = '';
    try {
      zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    } catch {
      return;
    }
    // The table is small but not needed at start: a chunk of its own
    const { ZONES } = await import('./zones');
    const found = ZONES.split(';').find((row) => row.startsWith(zone + ' '));
    if (!found) return;
    const [, lat, lon] = found.split(' ');
    this.place.set({ lat: Number(lat), lon: Number(lon) });
  }

  /** Where the sun is for the scene */
  readonly sun = computed<SunPlace>(() => {
    const mode = this.mode();
    if (mode !== 'auto') return DAYTIME_FIXED[mode];
    const { lat, lon } = this.place();
    return sunPlace(this.minute() * 60_000, lat, lon);
  });

  readonly phase = computed(() => phaseOf(this.sun()));

  /** The time on this device, "16:05" */
  readonly clock = computed(() => hhmm(this.minute() * 60_000));

  /** Today's sunrise and sunset here, as "8:58" (null: polar night or day, see `up`) */
  readonly today = computed(() => {
    const now = this.minute() * 60_000;
    const { lat, lon } = this.place();
    const midnight = new Date(now).setHours(0, 0, 0, 0);
    const t = sunTimes(now, lat, lon, midnight);
    return {
      rise: t.rise === null ? null : hhmm(t.rise),
      set: t.set === null ? null : hhmm(t.set),
      up: t.up,
    };
  });

  set(mode: DaytimeMode): void {
    this.mode.set(mode);
    try {
      localStorage.setItem(KEY, mode);
    } catch {
      // Private mode: the choice lives until the page is closed
    }
  }
}

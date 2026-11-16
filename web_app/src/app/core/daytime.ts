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
const PLACE_KEY = 'santa.place';

/** Where the sun is counted for. `source`: the timezone's main city, the UTC offset, a city picked, geolocation */
export interface Place {
  lat: number;
  lon: number;
  ru?: string;
  en?: string;
  source: 'zone' | 'offset' | 'city' | 'geo';
}

/** A city from the built-in list */
export interface City {
  ru: string;
  en: string;
  lat: number;
  lon: number;
}

function readPlace(): Place | null {
  try {
    const v = JSON.parse(localStorage.getItem(PLACE_KEY) ?? 'null') as Place | null;
    return v && Number.isFinite(v.lat) && Number.isFinite(v.lon) ? v : null;
  } catch {
    return null;
  }
}

function writePlace(place: Place | null): void {
  try {
    if (place) localStorage.setItem(PLACE_KEY, JSON.stringify(place));
    else localStorage.removeItem(PLACE_KEY);
  } catch {
    // Private mode: lives until the page is closed
  }
}

let cities: Promise<City[]> | undefined;
/** The built-in list of cities (a lazy chunk) */
function loadCities(): Promise<City[]> {
  cities ??= import('./cities').then(({ CITIES }) =>
    CITIES.split(';')
      .filter(Boolean)
      .map((row) => {
        const [ru, en, lat, lon] = row.split('|');
        return { ru, en, lat: Number(lat), lon: Number(lon) };
      }),
  );
  return cities;
}

/** Distance along the Earth, km */
function km(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const r = Math.PI / 180;
  const h =
    Math.sin(((b.lat - a.lat) * r) / 2) ** 2 +
    Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(((b.lon - a.lon) * r) / 2) ** 2;
  return 12_742 * Math.asin(Math.sqrt(h));
}

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
 * The chosen time of day and where the sun is for the scene (this browser only:
 * nothing leaves the device). By default the place is the main city of the device's
 * timezone (`Europe/Moscow` → Moscow); unknown zone: the device's UTC offset gives the
 * longitude, the latitude is a middle northern one. The person may name a city from
 * the built-in list or ask the browser's geolocation instead.
 */
@Injectable({ providedIn: 'root' })
export class Daytime {
  private readonly store = inject(Store);
  readonly mode = signal<DaytimeMode>(readMode());
  /** The place by the timezone (the default) */
  private readonly zonePlace = signal<Place>({
    lat: 50,
    lon: -new Date().getTimezoneOffset() / 4,
    source: 'offset',
  });
  /** A place picked by the person, if any */
  private readonly custom = signal<Place | null>(readPlace());
  readonly place = computed(() => this.custom() ?? this.zonePlace());
  /** Changes once a minute: the sun is recounted, the scene follows without a transition */
  private readonly minute = computed(() => Math.floor(this.store.now() / 60_000));

  constructor() {
    void this.fromZone();
  }

  private async fromZone(): Promise<void> {
    let zone = '';
    try {
      zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    } catch {
      return;
    }
    // The tables are small but not needed at start: chunks of their own
    const [{ ZONES }, list] = await Promise.all([import('./zones'), loadCities()]);
    const found = ZONES.split(';').find((row) => row.startsWith(zone + ' '));
    if (!found) return;
    const [, lat, lon] = found.split(' ');
    // A name for it: the city of the list, or the English one of the zone
    const en = zone.split('/').pop()!.replace(/_/g, ' ');
    const city = list.find((c) => c.en === en);
    this.zonePlace.set({
      lat: Number(lat),
      lon: Number(lon),
      ru: city?.ru ?? en,
      en: city?.en ?? en,
      source: 'zone',
    });
  }

  /** Cities of the built-in list whose name starts with (or holds) the query */
  async search(query: string): Promise<City[]> {
    const q = query.trim().toLowerCase().replace(/ё/g, 'е');
    if (!q) return [];
    const norm = (s: string) => s.toLowerCase().replace(/ё/g, 'е');
    const list = await loadCities();
    const starts = list.filter((c) => norm(c.ru).startsWith(q) || norm(c.en).startsWith(q));
    const holds = list.filter(
      (c) => !starts.includes(c) && (norm(c.ru).includes(q) || norm(c.en).includes(q)),
    );
    return [...starts, ...holds].slice(0, 6);
  }

  pickCity(city: City): void {
    this.setPlace({ ...city, source: 'city' });
  }

  /**
   * The browser's geolocation (it asks the person). Rounded to ~10 km: the sun does not
   * need more. Named by the nearest city of the list, if it is close.
   */
  async locate(): Promise<'ok' | 'denied' | 'unavailable'> {
    if (!navigator.geolocation) return 'unavailable';
    try {
      const pos = await new Promise<GeolocationPosition>((resolve, reject) =>
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          maximumAge: 3_600_000,
          timeout: 20_000,
        }),
      );
      const place: Place = {
        lat: Math.round(pos.coords.latitude * 10) / 10,
        lon: Math.round(pos.coords.longitude * 10) / 10,
        source: 'geo',
      };
      const list = await loadCities();
      const near = list.reduce<City | null>(
        (best, c) => (!best || km(place, c) < km(place, best) ? c : best),
        null,
      );
      if (near && km(place, near) < 120) Object.assign(place, { ru: near.ru, en: near.en });
      this.setPlace(place);
      return 'ok';
    } catch (err) {
      return (err as GeolocationPositionError)?.code === 1 ? 'denied' : 'unavailable';
    }
  }

  /** Back to the timezone's city */
  resetPlace(): void {
    this.setPlace(null);
  }

  private setPlace(place: Place | null): void {
    this.custom.set(place);
    writePlace(place);
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

import { Injectable, computed, inject, signal } from '@angular/core';
import { DAYTIME_FIXED, SunPlace, sunPlace, sunTimes } from '../components/tree3d/daytime';
import { Api } from './api';
import { I18n } from './i18n';
import { Store } from './store';
import { closestTimezone, deviceNewYearOffset, formatOffset, offsetMinutes } from './time';

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

/**
 * Where the sun is counted for. `source`: the timezone's main city, the UTC offset, a city picked,
 * geolocation. `offset`: minutes from UTC there on New Year's night — the place always agrees with
 * the timezone of the account (the gift comes at midnight by it)
 */
export interface Place {
  lat: number;
  lon: number;
  ru?: string;
  en?: string;
  offset?: number;
  source: 'zone' | 'offset' | 'city' | 'geo';
}

/** A city from the built-in list */
export interface City {
  ru: string;
  en: string;
  lat: number;
  lon: number;
  /** Minutes from UTC on New Year's night */
  offset: number;
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
        const [ru, en, lat, lon, offset] = row.split('|');
        return { ru, en, lat: Number(lat), lon: Number(lon), offset: Number(offset) };
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

const DAY = 86_400_000;

/** "16:05" at the given UTC offset (minutes) */
const hhmm = (time: number, offset: number) => {
  const d = new Date(time + offset * 60_000);
  return `${d.getUTCHours()}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
};

/**
 * The chosen time of day and where the sun is for the scene (the place stays in this
 * browser). The place always agrees with the timezone of the account:
 * - by default it's the main city of the device's timezone (`Europe/Moscow` → Moscow), if the
 *   account has the device's offset; else the first city of the list with the account's offset;
 *   none: the offset gives the longitude, the latitude is a middle northern one;
 * - a city picked (or found by geolocation) in another timezone changes the account's timezone
 *   to it (only the offset goes to the server, never the city);
 * - a timezone changed elsewhere (the registration page) makes a picked city of another offset
 *   step aside: the default place of the new timezone is used.
 */
@Injectable({ providedIn: 'root' })
export class Daytime {
  private readonly store = inject(Store);
  private readonly api = inject(Api);
  private readonly i18n = inject(I18n);
  readonly mode = signal<DaytimeMode>(readMode());
  private readonly deviceOffset = deviceNewYearOffset();
  /** The main city of the device's timezone */
  private readonly devicePlace = signal<Place>({
    lat: 50,
    lon: this.deviceOffset / 4,
    offset: this.deviceOffset,
    source: 'offset',
  });
  private readonly cityList = signal<City[]>([]);
  /** A place picked by the person, if any */
  private readonly custom = signal<Place | null>(readPlace());

  /** UTC offset of the account (minutes on New Year's night); not registered: the device's */
  readonly accountOffset = computed(() => {
    const tz = this.store.me()?.timezone;
    return tz ? offsetMinutes(tz) : this.deviceOffset;
  });

  /** The place by the timezone of the account */
  private readonly zonePlace = computed<Place>(() => {
    const offset = this.accountOffset();
    if (this.devicePlace().offset === offset) return this.devicePlace();
    const city = this.cityList().find((c) => c.offset === offset);
    if (city) return { ...city, source: 'zone' };
    return { lat: 50, lon: offset / 4, offset, source: 'offset' };
  });

  readonly place = computed<Place>(() => {
    const custom = this.custom();
    const offset = custom?.offset ?? this.deviceOffset;
    return custom && offset === this.accountOffset() ? custom : this.zonePlace();
  });

  /** "UTC+3" of the place */
  readonly placeTimezone = computed(() =>
    formatOffset(this.place().offset ?? this.accountOffset()),
  );
  /** Changes once a minute: the sun is recounted, the scene follows without a transition */
  private readonly minute = computed(() => Math.floor(this.store.now() / 60_000));

  constructor() {
    void this.fromZone();
    void loadCities().then((list) => this.cityList.set(list));
  }

  /** Up to `n` cities of the list in the timezone, for showing what it is */
  async citiesOf(tz: string, n = 3): Promise<City[]> {
    const offset = offsetMinutes(tz);
    return (await loadCities()).filter((c) => c.offset === offset).slice(0, n);
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
    this.devicePlace.set({
      lat: Number(lat),
      lon: Number(lon),
      ru: city?.ru ?? en,
      en: city?.en ?? en,
      offset: this.deviceOffset,
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

  placeOfCity(city: City): Place {
    return { ...city, source: 'city' };
  }

  /**
   * The browser's geolocation (it asks the person). Rounded to ~10 km: the sun does not
   * need more. Named by the nearest city of the list, if it is close.
   */
  async locate(): Promise<{ result: 'ok' | 'denied' | 'unavailable'; place?: Place }> {
    if (!navigator.geolocation) return { result: 'unavailable' };
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
        // The person is there: the device's clock is that place's
        offset: this.deviceOffset,
        source: 'geo',
      };
      const list = await loadCities();
      const near = list.reduce<City | null>(
        (best, c) => (!best || km(place, c) < km(place, best) ? c : best),
        null,
      );
      if (near && km(place, near) < 120) {
        Object.assign(place, { ru: near.ru, en: near.en, offset: near.offset });
      }
      return { result: 'ok', place };
    } catch (err) {
      return {
        result: (err as GeolocationPositionError)?.code === 1 ? 'denied' : 'unavailable',
      };
    }
  }

  /** Back to the timezone's city */
  resetPlace(): void {
    this.custom.set(null);
    writePlace(null);
  }

  /**
   * The timezone the account would move to for this place (null: it already is in it).
   * The caller asks the person first: no, and the place stays as it was.
   */
  timezoneFor(place: Place): string | null {
    const offset = place.offset ?? this.deviceOffset;
    if (!this.store.registered() || offset === this.accountOffset()) return null;
    return closestTimezone(this.store.config()?.timezones ?? [formatOffset(offset)], offset);
  }

  /** Remember the place; one in another timezone moves the account's timezone there */
  async setPlace(place: Place): Promise<void> {
    const timezone = this.timezoneFor(place);
    if (timezone) {
      this.store.me.set(await this.api.saveProfile(timezone, null, this.i18n.lang()));
      // The closest known offset, if the city's own isn't one of them
      place = { ...place, offset: offsetMinutes(timezone) };
    }
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

  private readonly placeOffset = computed(() => this.place().offset ?? this.accountOffset());

  /** The time at the place, "16:05" */
  readonly clock = computed(() => hhmm(this.minute() * 60_000, this.placeOffset()));

  /** Today's sunrise and sunset at the place, as "8:58" (null: polar night or day, see `up`) */
  readonly today = computed(() => {
    const now = this.minute() * 60_000;
    const offset = this.placeOffset() * 60_000;
    const { lat, lon } = this.place();
    const midnight = Math.floor((now + offset) / DAY) * DAY - offset;
    const t = sunTimes(now, lat, lon, midnight);
    return {
      rise: t.rise === null ? null : hhmm(t.rise, this.placeOffset()),
      set: t.set === null ? null : hhmm(t.set, this.placeOffset()),
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

/** Timezones are fixed UTC offsets: "UTC+3", "UTC+5:30" (same format as the bot) */

export function offsetMinutes(tz: string): number {
  const m = /^UTC([+-])(\d{1,2})(?::(\d{2}))?$/.exec(tz);
  if (!m) return 0;
  const value = Number(m[2]) * 60 + Number(m[3] ?? 0);
  return m[1] === '-' ? -value : value;
}

export function formatOffset(minutes: number): string {
  const sign = minutes >= 0 ? '+' : '-';
  const h = Math.floor(Math.abs(minutes) / 60);
  const m = Math.abs(minutes) % 60;
  return `UTC${sign}${h}${m ? ':' + String(m).padStart(2, '0') : ''}`;
}

/** The device offset on New Year's night (DST-aware) */
export function detectTimezone(known: string[]): string {
  const year =
    new Date().getMonth() === 0 ? new Date().getFullYear() : new Date().getFullYear() + 1;
  const offset = -new Date(year, 0, 1).getTimezoneOffset();
  const tz = formatOffset(offset);
  if (known.includes(tz)) return tz;
  // Closest known one
  return known.reduce((a, b) =>
    Math.abs(offsetMinutes(a) - offset) <= Math.abs(offsetMinutes(b) - offset) ? a : b,
  );
}

/** New Year midnight of the timezone, as a UTC timestamp (current one during 1 January) */
export function newYearMoment(tz: string, now = Date.now()): number {
  const offset = offsetMinutes(tz) * 60_000;
  const local = new Date(now + offset);
  const isNewYearDay = local.getUTCMonth() === 0 && local.getUTCDate() === 1;
  const year = isNewYearDay ? local.getUTCFullYear() : local.getUTCFullYear() + 1;
  return Date.UTC(year, 0, 1) - offset;
}

/** Local time in the timezone as "HH:MM" */
export function localTime(tz: string, now = Date.now()): string {
  const d = new Date(now + offsetMinutes(tz) * 60_000);
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}

export interface Parts {
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
}

export function split(ms: number): Parts {
  const s = Math.max(0, Math.floor(ms / 1000));
  return {
    days: Math.floor(s / 86400),
    hours: Math.floor((s % 86400) / 3600),
    minutes: Math.floor((s % 3600) / 60),
    seconds: s % 60,
  };
}

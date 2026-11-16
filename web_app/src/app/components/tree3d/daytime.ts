/**
 * Time of day: the sky, the light and the mood of the courtyard by where the
 * sun really is. The look depends on the height of the sun (night below -12°,
 * blue hour at -6°, dawn or sunset at the horizon, day from 15°) and on the half
 * of the day (pink dawn in the morning, orange sunset in the evening), so it
 * matches the window: early dark in a northern winter, a polar night with blue
 * twilight at noon, long light evenings of a southern summer.
 * No three.js here: the interface uses it too.
 */

/** An sRGB colour, 0..1 per channel (display values, as picked by eye) */
export type Rgb = readonly [number, number, number];

export interface Daylight {
  /** Sky gradient: zenith, middle, horizon */
  skyTop: Rgb;
  skyMid: Rgb;
  skyLow: Rgb;
  fog: Rgb;
  /** Ambient light from the sky and from the snow below */
  hemiSky: Rgb;
  hemiGround: Rgb;
  hemi: number;
  /** The main light: the sun by day, the moon by night */
  sun: Rgb;
  sunPower: number;
  /** Warm fill from the side of the camera */
  fill: Rgb;
  fillPower: number;
  /** Starry sky 0..1 (also the northern lights and shooting stars) */
  stars: number;
  /** The moon disc, the sun disc: 0..1 */
  moon: number;
  sunDisc: number;
  /** 0 = broad day, 1 = night: lanterns and windows light up above 0.5 */
  dark: number;
  /** Strength of the bloom around the bright things */
  bloom: number;
}

const hex = (c: number): Rgb => [((c >> 16) & 255) / 255, ((c >> 8) & 255) / 255, (c & 255) / 255];

const NIGHT: Daylight = {
  skyTop: [0.005, 0.008, 0.05],
  skyMid: [0.035, 0.03, 0.12],
  skyLow: [0.085, 0.065, 0.19],
  fog: hex(0x0b0c22),
  hemiSky: hex(0x5464be),
  hemiGround: hex(0x0d0a22),
  hemi: 0.48,
  sun: hex(0x93a6ff),
  sunPower: 0.75,
  fill: hex(0xffb070),
  fillPower: 0.18,
  stars: 1,
  moon: 1,
  sunDisc: 0,
  dark: 1,
  bloom: 0.6,
};

const DAWN: Daylight = {
  skyTop: hex(0x1e2e66),
  skyMid: hex(0x6c5a9a),
  skyLow: hex(0xf0a08a),
  fog: hex(0x5a4c80),
  hemiSky: hex(0x8a8ed8),
  hemiGround: hex(0x2a2448),
  hemi: 1.0,
  sun: hex(0xff9e6a),
  sunPower: 1.4,
  fill: hex(0xffb070),
  fillPower: 0.3,
  stars: 0.15,
  moon: 0.25,
  sunDisc: 1,
  dark: 0.55,
  bloom: 0.5,
};

const MORNING: Daylight = {
  skyTop: hex(0x4a7ccc),
  skyMid: hex(0x9cbfe8),
  skyLow: hex(0xf6dccc),
  fog: hex(0xa8b8dc),
  hemiSky: hex(0xc6d4ff),
  hemiGround: hex(0x585c88),
  hemi: 1.4,
  sun: hex(0xffe6c8),
  sunPower: 1.8,
  fill: hex(0xffc890),
  fillPower: 0.25,
  stars: 0,
  moon: 0,
  sunDisc: 1,
  dark: 0,
  bloom: 0.35,
};

const DAY: Daylight = {
  skyTop: hex(0x3a74d0),
  skyMid: hex(0x86b6ee),
  skyLow: hex(0xd6e8ff),
  fog: hex(0xa8bee4),
  hemiSky: hex(0xd4e0ff),
  hemiGround: hex(0x6a70a0),
  hemi: 1.45,
  sun: hex(0xfff8ee),
  sunPower: 1.8,
  fill: hex(0xffc890),
  fillPower: 0.2,
  stars: 0,
  moon: 0,
  sunDisc: 1,
  dark: 0,
  bloom: 0.3,
};

const AFTERNOON: Daylight = {
  ...DAY,
  skyLow: hex(0xf2dcc0),
  fog: hex(0xb8b8d8),
  sun: hex(0xffdcb0),
  sunPower: 1.65,
};

const SUNSET: Daylight = {
  skyTop: hex(0x2a3a80),
  skyMid: hex(0xb06a96),
  skyLow: hex(0xffa060),
  fog: hex(0x7a5a86),
  hemiSky: hex(0x9a8ad0),
  hemiGround: hex(0x302650),
  hemi: 1.0,
  sun: hex(0xff8a4a),
  sunPower: 1.5,
  fill: hex(0xff9a60),
  fillPower: 0.3,
  stars: 0.1,
  moon: 0.15,
  sunDisc: 1,
  dark: 0.5,
  bloom: 0.5,
};

const DUSK: Daylight = {
  skyTop: hex(0x0c1448),
  skyMid: hex(0x2c2c78),
  skyLow: hex(0x7a4a8a),
  fog: hex(0x241e4a),
  hemiSky: hex(0x5a64c8),
  hemiGround: hex(0x16123a),
  hemi: 0.7,
  sun: hex(0x9aa6ff),
  sunPower: 0.8,
  fill: hex(0xffb070),
  fillPower: 0.2,
  stars: 0.5,
  moon: 0.7,
  sunDisc: 0,
  dark: 0.85,
  bloom: 0.6,
};

/** Where the sun is: elevation over the horizon and hour angle (0 at noon, <0 morning), degrees */
export interface SunPlace {
  elevation: number;
  hourAngle: number;
}

/** Key heights of the sun, degrees: before noon and after it */
const MORNING_KEYS: [number, Daylight][] = [
  [-12, NIGHT],
  [-6, DUSK],
  [0, DAWN],
  [6, MORNING],
  [15, DAY],
];
const EVENING_KEYS: [number, Daylight][] = [
  [-12, NIGHT],
  [-6, DUSK],
  [0, SUNSET],
  [6, AFTERNOON],
  [15, DAY],
];

/** The sun of the fixed choices (besides "as on my clock") */
export const DAYTIME_FIXED: Record<'morning' | 'day' | 'evening' | 'night', SunPlace> = {
  morning: { elevation: 3, hourAngle: -50 },
  day: { elevation: 20, hourAngle: 0 },
  evening: { elevation: -3, hourAngle: 60 },
  night: { elevation: -40, hourAngle: 180 },
};

const mix = (a: number, b: number, k: number) => a + (b - a) * k;
const mixRgb = (a: Rgb, b: Rgb, k: number): Rgb => [
  mix(a[0], b[0], k),
  mix(a[1], b[1], k),
  mix(a[2], b[2], k),
];
const smooth = (a: number, b: number, x: number) => {
  const k = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return k * k * (3 - 2 * k);
};
const RAD = Math.PI / 180;

/** Blends two looks: k = 0 is `a`, 1 is `b` */
export function blendDaylight(a: Daylight, b: Daylight, k: number): Daylight {
  const out = {} as Record<string, unknown>;
  for (const key of Object.keys(a) as (keyof Daylight)[]) {
    const x = a[key];
    const y = b[key];
    out[key] = typeof x === 'number' ? mix(x, y as number, k) : mixRgb(x, y as Rgb, k);
  }
  return out as unknown as Daylight;
}

function byHeight(keys: [number, Daylight][], elevation: number): Daylight {
  if (elevation <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    const [e1, b] = keys[i];
    if (elevation <= e1) {
      const [e0, a] = keys[i - 1];
      return blendDaylight(a, b, smooth(e0, e1, elevation));
    }
  }
  return keys[keys.length - 1][1];
}

/** The look of the courtyard with the sun at this place */
export function daylightAt(sun: SunPlace): Daylight {
  // Morning and evening looks meet smoothly around noon and around midnight
  const evening = smooth(-0.25, 0.25, Math.sin(sun.hourAngle * RAD));
  return blendDaylight(
    byHeight(MORNING_KEYS, sun.elevation),
    byHeight(EVENING_KEYS, sun.elevation),
    evening,
  );
}

/**
 * Where to draw the sun in the scene: azimuth (as in Math.atan2(z, x)) and elevation, rad.
 * The yard has no north: the sun just goes from left to right over the same side of the sky.
 */
export function sunInScene(sun: SunPlace): { azimuth: number; elevation: number } {
  return { azimuth: -Math.PI / 2 + sun.hourAngle * RAD * 1.3, elevation: sun.elevation * RAD };
}

/**
 * The real sun at a moment and a place (a short astronomical formula, good to a fraction
 * of a degree): elevation and hour angle, degrees.
 */
export function sunPlace(time: number, lat: number, lon: number): SunPlace {
  const d = time / 86_400_000 - 10_957.5; // days since 1 Jan 2000, noon UTC
  const g = (357.529 + 0.98560028 * d) * RAD;
  const q = 280.459 + 0.98564736 * d;
  const l = (q + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * RAD;
  const e = (23.439 - 0.00000036 * d) * RAD;
  const ra = Math.atan2(Math.cos(e) * Math.sin(l), Math.cos(l)) / RAD;
  const dec = Math.asin(Math.sin(e) * Math.sin(l));
  const sidereal = 280.46061837 + 360.98564736629 * d + lon;
  const ha = ((((sidereal - ra) % 360) + 540) % 360) - 180;
  const elevation = Math.asin(
    Math.sin(lat * RAD) * Math.sin(dec) + Math.cos(lat * RAD) * Math.cos(dec) * Math.cos(ha * RAD),
  );
  return { elevation: elevation / RAD, hourAngle: ha };
}

/** Sunrise and sunset of the day around `time` (UTC ms), or null if the sun does not cross the horizon */
export function sunTimes(
  time: number,
  lat: number,
  lon: number,
  dayStart: number,
): { rise: number | null; set: number | null; up: boolean } {
  const HORIZON = -0.833; // the refraction lifts the sun a little
  const STEP = 5 * 60_000;
  let rise: number | null = null;
  let set: number | null = null;
  let prev = sunPlace(dayStart, lat, lon).elevation;
  for (let t = dayStart + STEP; t <= dayStart + 86_400_000; t += STEP) {
    const e = sunPlace(t, lat, lon).elevation;
    if (prev < HORIZON && e >= HORIZON) rise ??= t;
    if (prev >= HORIZON && e < HORIZON) set ??= t;
    prev = e;
  }
  return { rise, set, up: sunPlace(time, lat, lon).elevation >= HORIZON };
}

/**
 * Time of day: the sky, the light and the mood of the courtyard at a given
 * hour (0..24). A few hand-made key moments (night, dawn, morning, day,
 * sunset, blue hour) are blended smoothly, so any hour has its own look and
 * the auto mode drifts with the clock. Winter: the sun is up from ~8 to ~17,
 * low over the mountains.
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

/** Key moments of the day: [hour, look]; between them the look is blended */
const KEYS: [number, Daylight][] = [
  [0, NIGHT],
  [6.6, NIGHT],
  [8, DAWN],
  [9.6, MORNING],
  [13, DAY],
  [15.2, AFTERNOON],
  [16.6, SUNSET],
  [17.8, DUSK],
  [20.2, NIGHT],
  [24, NIGHT],
];

/** Hours of the fixed choices (besides "as on my clock") */
export const DAYTIME_HOURS = { morning: 9, day: 13, evening: 17.2, night: 0 } as const;

/** Sunrise and sunset of the winter sun */
const SUNRISE = 7.8;
const SUNSET_AT = 16.9;

const mix = (a: number, b: number, k: number) => a + (b - a) * k;
const mixRgb = (a: Rgb, b: Rgb, k: number): Rgb => [
  mix(a[0], b[0], k),
  mix(a[1], b[1], k),
  mix(a[2], b[2], k),
];

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

/** The look of the courtyard at this hour (0..24) */
export function daylightAt(hour: number): Daylight {
  const h = ((hour % 24) + 24) % 24;
  for (let i = 1; i < KEYS.length; i++) {
    const [h1, b] = KEYS[i];
    if (h <= h1) {
      const [h0, a] = KEYS[i - 1];
      const k = (h - h0) / Math.max(1e-6, h1 - h0);
      return blendDaylight(a, b, k * k * (3 - 2 * k));
    }
  }
  return NIGHT;
}

/**
 * Where the sun is at this hour: azimuth (as in Math.atan2(z, x)) and elevation, rad.
 * A low winter arc: rises in the east, ~24° at noon, sets in the west.
 */
export function sunAt(hour: number): { azimuth: number; elevation: number } {
  const k = (hour - SUNRISE) / (SUNSET_AT - SUNRISE);
  return {
    azimuth: -Math.PI / 2 + (k - 0.5) * 2.4,
    elevation: Math.sin(Math.PI * k) * 0.42,
  };
}

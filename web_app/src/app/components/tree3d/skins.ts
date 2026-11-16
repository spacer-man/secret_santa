/** Shop skins of the scene (no three.js here: imported by the UI) */
export type LightSkin = (typeof LIGHT_SKINS)[number];

/** Prices live in the shop catalog (the API); item key is `lights-` + skin key */
export const LIGHT_SKINS = [
  'multi',
  'warm',
  'gold',
  'icy',
  'candy',
  'flakes',
  'rainbow',
  'stars',
  'sparks',
  'meteor',
  'starbow',
  'starfall',
] as const;

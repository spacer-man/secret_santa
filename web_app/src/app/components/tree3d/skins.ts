/** Shop skins of the scene (no three.js here: imported by the UI) */
export type LightSkin = 'multi' | 'warm' | 'gold' | 'icy' | 'candy';

export const LIGHT_SKINS: { key: LightSkin; price: number }[] = [
  { key: 'multi', price: 200 },
  { key: 'warm', price: 150 },
  { key: 'gold', price: 150 },
  { key: 'icy', price: 150 },
  { key: 'candy', price: 150 },
];

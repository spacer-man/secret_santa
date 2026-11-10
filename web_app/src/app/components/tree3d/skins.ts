/** Shop skins of the scene (no three.js here: imported by the UI) */
export type LightSkin = 'multi' | 'warm' | 'gold' | 'icy' | 'candy';

/** Prices live in the shop catalog (the API); item key is `lights-` + skin key */
export const LIGHT_SKINS: LightSkin[] = ['multi', 'warm', 'gold', 'icy', 'candy'];

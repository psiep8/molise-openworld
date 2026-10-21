/**
 * Aspetto del giocatore.
 *
 * Tutto è procedurale: niente GLB, niente asset esterni. I capi sono stili
 * generici (elegante, formale, tuta, campagna, sportivo, hippie), non riproduzioni
 * di marchi reali: i nomi di marca sono marchi registrati e non vengono usati.
 */

export type Sex = 'donna' | 'uomo';
export type Build = 'snello' | 'normale' | 'robusto';
export type HairStyle = 'raso' | 'corto' | 'riccio' | 'coda' | 'lunghi' | 'chignon';
export type OutfitStyle = 'casual' | 'elegante' | 'formale' | 'tuta' | 'campagna' | 'sportivo' | 'hippie';
export type OutfitTone = 'classico' | 'scuro' | 'chiaro';
export type HatStyle = 'none' | 'cap' | 'band' | 'fedora';

export interface Appearance {
  sex: Sex;
  /** altezza in metri */
  height: number;
  build: Build;
  /** carnagione, colore esadecimale */
  skin: number;
  hairStyle: HairStyle;
  hairColor: number;
  beard: boolean;
  outfit: OutfitStyle;
  /** variante di colore del capo */
  tone: OutfitTone;
}

export const HEIGHT_MIN = 1.5;
export const HEIGHT_MAX = 2.0;
const BASE_HEIGHT = 1.75;

export const SEX_LABEL: Record<Sex, string> = { donna: 'Donna', uomo: 'Uomo' };
export const BUILD_LABEL: Record<Build, string> = { snello: 'Snello', normale: 'Normale', robusto: 'Robusto' };
export const BUILD_GIRTH: Record<Build, number> = { snello: 0.9, normale: 1, robusto: 1.14 };
export const HAIR_LABEL: Record<HairStyle, string> = {
  raso: 'Raso',
  corto: 'Corto',
  riccio: 'Riccio',
  coda: 'Coda',
  lunghi: 'Lunghi',
  chignon: 'Chignon',
};
export const TONE_LABEL: Record<OutfitTone, string> = { classico: 'Classico', scuro: 'Scuro', chiaro: 'Chiaro' };

export const SKINS: readonly { label: string; color: number }[] = [
  { label: 'Chiara', color: 0xf0c8a8 },
  { label: 'Media', color: 0xd7a07c },
  { label: 'Olivastra', color: 0xbf8756 },
  { label: 'Ambrata', color: 0xa06a44 },
  { label: 'Scura', color: 0x74492f },
  { label: 'Ebano', color: 0x4c2f21 },
];

export const HAIR_COLORS: readonly { label: string; color: number }[] = [
  { label: 'Nero', color: 0x1b1714 },
  { label: 'Castano', color: 0x53382a },
  { label: 'Castano chiaro', color: 0x8a5f3c },
  { label: 'Biondo', color: 0xc9a061 },
  { label: 'Rosso', color: 0x9c4626 },
  { label: 'Bianco', color: 0xd8d5cc },
];

interface OutfitDef {
  label: string;
  hint: string;
  top: number;
  bottom: number;
  shoes: number;
  accent: number;
  roughness: number;
  metalness: number;
  hat: HatStyle;
  collar: boolean;
  tie: boolean;
}

export const OUTFITS: Record<OutfitStyle, OutfitDef> = {
  casual: {
    label: 'Casual',
    hint: 'Felpa e jeans, comodi tutti i giorni',
    top: 0x3f6f8f,
    bottom: 0x394150,
    shoes: 0xe8e2d6,
    accent: 0x2a2f36,
    roughness: 0.88,
    metalness: 0,
    hat: 'none',
    collar: false,
    tie: false,
  },
  elegante: {
    label: 'Elegante',
    hint: 'Blazer, camicia e pantaloni scuri',
    top: 0x1b2a41,
    bottom: 0x232931,
    shoes: 0x33231a,
    accent: 0xf2efe6,
    roughness: 0.5,
    metalness: 0.05,
    hat: 'none',
    collar: true,
    tie: false,
  },
  formale: {
    label: 'Formale',
    hint: 'Abito scuro, camicia bianca e cravatta',
    top: 0x14171c,
    bottom: 0x14171c,
    shoes: 0x0d0d0f,
    accent: 0xf7f4ec,
    roughness: 0.42,
    metalness: 0.06,
    hat: 'none',
    collar: true,
    tie: true,
  },
  tuta: {
    label: 'Tuta',
    hint: 'Tuta sportiva con profili a contrasto',
    top: 0x2c3e50,
    bottom: 0x2c3e50,
    shoes: 0xf2f2f2,
    accent: 0xff7a3d,
    roughness: 0.78,
    metalness: 0,
    hat: 'cap',
    collar: false,
    tie: false,
  },
  campagna: {
    label: 'Campagna',
    hint: 'Giacca da lavoro, jeans e berretto',
    top: 0x6b7a4a,
    bottom: 0x41556b,
    shoes: 0x4a3a2c,
    accent: 0x9aa06f,
    roughness: 0.95,
    metalness: 0,
    hat: 'cap',
    collar: false,
    tie: false,
  },
  sportivo: {
    label: 'Sportivo',
    hint: 'Maglia tecnica, pantaloncini scuri e cappellino',
    top: 0xe4453f,
    bottom: 0x22262a,
    shoes: 0xffffff,
    accent: 0xffffff,
    roughness: 0.7,
    metalness: 0,
    hat: 'cap',
    collar: false,
    tie: false,
  },
  hippie: {
    label: 'Hippie',
    hint: 'Camicia a toni caldi, fascia in testa e sandali',
    top: 0xc98a3f,
    bottom: 0x5c6b46,
    shoes: 0x6b4a2f,
    accent: 0x8a4f9e,
    roughness: 0.92,
    metalness: 0,
    hat: 'band',
    collar: false,
    tie: false,
  },
};

export const OUTFIT_STYLES = Object.keys(OUTFITS) as OutfitStyle[];

/** Scurisce o schiarisce un colore, per le varianti di tono dei capi. */
export function shade(color: number, factor: number): number {
  const r = (color >> 16) & 255;
  const g = (color >> 8) & 255;
  const b = color & 255;
  const mix = (c: number): number => Math.round(Math.max(0, Math.min(255, c * factor)));
  return (mix(r) << 16) | (mix(g) << 8) | mix(b);
}

export function outfitColors(appearance: Appearance): {
  top: number;
  bottom: number;
  shoes: number;
  accent: number;
  roughness: number;
  metalness: number;
  hat: HatStyle;
  collar: boolean;
  tie: boolean;
} {
  const def = OUTFITS[appearance.outfit];
  const factor = appearance.tone === 'scuro' ? 0.62 : appearance.tone === 'chiaro' ? 1.35 : 1;
  const keepAccent = appearance.tone === 'classico';
  return {
    top: shade(def.top, factor),
    bottom: shade(def.bottom, factor),
    shoes: def.shoes,
    accent: keepAccent ? def.accent : shade(def.accent, factor),
    roughness: def.roughness,
    metalness: def.metalness,
    hat: def.hat,
    collar: def.collar,
    tie: def.tie,
  };
}

/** Modello alto/basso usato dal rig: 1 = 1,75 m. */
export function heightScale(appearance: Appearance): number {
  return appearance.height / BASE_HEIGHT;
}

export function outfitLabel(appearance: Appearance): string {
  return `${OUTFITS[appearance.outfit].label} · ${TONE_LABEL[appearance.tone]}`;
}

export function appearanceSummary(appearance: Appearance): string {
  const beard = appearance.sex === 'uomo' && appearance.beard ? ' · barba' : '';
  const height = appearance.height.toFixed(2).replace('.', ',');
  return `${SEX_LABEL[appearance.sex]} · ${height} m · ${BUILD_LABEL[appearance.build]}${beard}`;
}

export const DEFAULT_APPEARANCE: Appearance = {
  sex: 'donna',
  height: 1.7,
  build: 'normale',
  skin: 0xd7a07c,
  hairStyle: 'coda',
  hairColor: 0x53382a,
  beard: false,
  outfit: 'casual',
  tone: 'classico',
};

const STORAGE_KEY = 'molise.player.appearance';

const SEXES: readonly Sex[] = ['donna', 'uomo'];
const BUILDS: readonly Build[] = ['snello', 'normale', 'robusto'];
const HAIR_STYLES = Object.keys(HAIR_LABEL) as HairStyle[];
const TONES = Object.keys(TONE_LABEL) as OutfitTone[];

const has = <T extends string>(values: readonly T[], value: unknown): value is T =>
  typeof value === 'string' && (values as readonly string[]).includes(value);

/** Corregge valori mancanti o fuori scala arrivati da localStorage o dall'URL. */
export function sanitizeAppearance(input: Partial<Appearance> | null | undefined): Appearance {
  const a = input ?? {};
  return {
    sex: has(SEXES, a.sex) ? a.sex : DEFAULT_APPEARANCE.sex,
    height:
      typeof a.height === 'number' && Number.isFinite(a.height)
        ? Math.max(HEIGHT_MIN, Math.min(HEIGHT_MAX, a.height))
        : DEFAULT_APPEARANCE.height,
    build: has(BUILDS, a.build) ? a.build : DEFAULT_APPEARANCE.build,
    skin: typeof a.skin === 'number' && Number.isFinite(a.skin) ? a.skin : DEFAULT_APPEARANCE.skin,
    hairStyle: has(HAIR_STYLES, a.hairStyle) ? a.hairStyle : DEFAULT_APPEARANCE.hairStyle,
    hairColor:
      typeof a.hairColor === 'number' && Number.isFinite(a.hairColor)
        ? a.hairColor
        : DEFAULT_APPEARANCE.hairColor,
    beard: a.beard === true,
    outfit: has(OUTFIT_STYLES, a.outfit) ? a.outfit : DEFAULT_APPEARANCE.outfit,
    tone: has(TONES, a.tone) ? a.tone : DEFAULT_APPEARANCE.tone,
  };
}

export function loadAppearance(): Appearance {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_APPEARANCE };
    return sanitizeAppearance(JSON.parse(raw) as Partial<Appearance>);
  } catch {
    return { ...DEFAULT_APPEARANCE };
  }
}

export function saveAppearance(appearance: Appearance): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(appearance));
  } catch {
    // localStorage può essere disabilitato
  }
}

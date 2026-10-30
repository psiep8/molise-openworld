import * as THREE from 'three';

/**
 * Colori dell'aria lontana.
 *
 * La foschia non è un velo bianco uniforme: verso il sole è più calda e chiara,
 * dalla parte opposta più blu e profonda, e **non arriva mai a opacità piena**.
 * Se l'aria coprisse il 100% del rilievo, a 11 km resterebbe solo il colore
 * della nebbia, cioè un orizzonte bianco: è il difetto che si vedeva prima.
 *
 * I colori sono in sRGB (esadecimali); `THREE.Color` li converte nello spazio
 * lineare in cui lavorano le luci e il tone mapping.
 */
export interface WeatherLook {
  /** Elevazione del sole in gradi (negativa = sotto l'orizzonte). */
  sunElevation: number;
  /** Copertura nuvolosa 0…1. */
  cloud: number;
  /** Pioggia 0…1. */
  rain: number;
  /** Neve 0…1. */
  snow: number;
  /** Nebbia 0…1: aria corta, grigio-azzurra. */
  mist?: number;
  /** Giorno 0…1 (0 = notte piena). */
  day: number;
}

export interface HorizonPalette {
  /** Aria lontana dalla parte opposta al sole. */
  away: number;
  /** Aria lontana verso il sole (più calda, non bianca). */
  sun: number;
  /** Cielo all'orizzonte: più profondo della nebbia. */
  sky: number;
  /** Colore della nebbia di scena. */
  fog: number;
  /** Opacità massima dell'aria a 11 km: resta sempre colore del rilievo. */
  airOpacity: number;
}

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));
const smoothstep = (edge0: number, edge1: number, value: number): number => {
  const t = clamp01((value - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
};

/**
 * Tavolozza dell'orizzonte per meteo e ora.
 *
 * Sereno: blu-grigio saturo (`#7f97aa`–`#8aa0b2`), non il celeste lattiginoso
 * di prima. Verso il sole si scalda solo con il sole basso; a mezzogiorno resta
 * quasi neutra, altrimenti l'orizzonte sembrerebbe sempre al tramonto.
 * Pioggia e nebbia: grigio-azzurro con profondità, mai bianco puro.
 */
export function horizonPalette(look: WeatherLook): HorizonPalette {
  const day = clamp01(look.day);
  const cloud = clamp01(look.cloud);
  const rain = clamp01(look.rain);
  const snow = clamp01(look.snow);
  const mist = clamp01(look.mist ?? 0);
  const low = 1 - smoothstep(8, 30, look.sunElevation);

  // sereno di giorno: l'aria lontana ha il blu dei monti, non il bianco
  const away = new THREE.Color(0x7f97aa);
  const sun = new THREE.Color(0x9fb0b8).lerp(new THREE.Color(0xd8b088), low * 0.75);
  const sky = new THREE.Color(0x6d8aa6);
  const fog = new THREE.Color(0x8fa3b3);

  // nuvole: l'aria si appiattisce, ma resta azzurrina
  away.lerp(new THREE.Color(0x7d8b96), cloud * 0.7);
  sun.lerp(new THREE.Color(0x9aa5aa), cloud * 0.7);
  sky.lerp(new THREE.Color(0x7e8f9d), cloud * 0.7);
  fog.lerp(new THREE.Color(0x93a1ab), cloud * 0.7);

  // pioggia: grigio-azzurro con gradiente, non bianco
  away.lerp(new THREE.Color(0x6d7f8c), rain * 0.85);
  sun.lerp(new THREE.Color(0x87939a), rain * 0.85);
  sky.lerp(new THREE.Color(0x6a7c8a), rain * 0.85);
  fog.lerp(new THREE.Color(0x8797a2), rain * 0.85);

  // nebbia: aria corta e chiara, comunque fredda
  away.lerp(new THREE.Color(0x93a4af), mist * 0.9);
  sun.lerp(new THREE.Color(0xa9b4ba), mist * 0.9);
  sky.lerp(new THREE.Color(0x8b9ca8), mist * 0.9);
  fog.lerp(new THREE.Color(0x9aa8b1), mist * 0.9);

  // neve: bianco-azzurro freddo, non il bianco caldo del sole
  away.lerp(new THREE.Color(0x9fb3c4), snow * 0.8);
  sun.lerp(new THREE.Color(0xb9c7d2), snow * 0.8);
  sky.lerp(new THREE.Color(0x8fa6ba), snow * 0.8);
  fog.lerp(new THREE.Color(0xaebfcb), snow * 0.8);

  // notte: blu profondo; sotto la soglia della nebbia non si vede nulla
  const nightAway = new THREE.Color(0x1d2a38);
  const nightSun = new THREE.Color(0x24303c);
  const nightSky = new THREE.Color(0x16222e);
  const nightFog = new THREE.Color(0x1a2632);
  away.lerp(nightAway, 1 - day);
  sun.lerp(nightSun, 1 - day);
  sky.lerp(nightSky, 1 - day);
  fog.lerp(nightFog, 1 - day);

  const airOpacity = 0.78 + cloud * 0.03 + rain * 0.05 + mist * 0.04 - snow * 0.02;
  return {
    away: away.getHex(),
    sun: sun.getHex(),
    sky: sky.getHex(),
    fog: fog.getHex(),
    // il tetto resta sotto 0,9: il rilievo deve sempre trasparire
    airOpacity: Math.min(0.88, Math.max(0.7, airOpacity)),
  };
}

/**
 * Quanto l'aria verso una direzione è quella "del sole".
 *
 * `alignment` è il coseno fra la direzione orizzontale del punto e quella del
 * sole: +1 = verso il sole, −1 = dalla parte opposta. La transizione è larga
 * (il cono d'oro è di decine di gradi, non un puntino).
 */
export function sunwardMix(alignment: number): number {
  return smoothstep(-0.35, 0.95, alignment) * 0.75;
}

/**
 * Quota di aria sopra il rilievo a una certa distanza.
 *
 * Curva `1 − exp(−d / scala)` con tetto: a 11 km circa 0,75 del massimo, e
 * comunque mai 1. `scala` corta (4,2 km) per avere profondità già a 3–5 km.
 */
export function airOpacityAt(distance: number, palette: HorizonPalette): number {
  if (!Number.isFinite(distance) || distance <= 0) return 0;
  const t = 1 - Math.exp(-distance / 4_200);
  return palette.airOpacity * t;
}

/** Colore dell'aria verso una direzione: blu lontano dal sole, caldo verso. */
export function airColorAt(alignment: number, palette: HorizonPalette, out = new THREE.Color()): THREE.Color {
  out.setHex(palette.away);
  return out.lerp(new THREE.Color().setHex(palette.sun), sunwardMix(alignment));
}

/**
 * Colore finale del rilievo lontano: terreno illuminato miscelato all'aria.
 * L'opacità è limitata, quindi il colore del monte non sparisce mai del tutto.
 */
export function distantTerrainColor(
  base: THREE.Color,
  distance: number,
  alignment: number,
  palette: HorizonPalette,
  out = new THREE.Color(),
): THREE.Color {
  const opacity = airOpacityAt(distance, palette);
  airColorAt(alignment, palette, out);
  return out.lerp(base, 1 - opacity);
}

/** Coseno fra la direzione orizzontale (x,z) e quella del sole. */
export function horizontalAlignment(dx: number, dz: number, sunX: number, sunZ: number): number {
  const length = Math.hypot(dx, dz);
  const sunLength = Math.hypot(sunX, sunZ);
  if (length < 1e-6 || sunLength < 1e-6) return 0;
  return Math.max(-1, Math.min(1, (dx * sunX + dz * sunZ) / (length * sunLength)));
}

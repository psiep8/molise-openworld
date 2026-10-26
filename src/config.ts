/**
 * Costanti del mondo. Deve restare allineato a scripts/fetch-geodata.mjs:
 * il bbox e le formule di proiezione determinano come heights.bin viene
 * campionato e come vengono proiettati i dati OSM.
 */
export const BBOX = {
  latMin: 41.815,
  latMax: 41.925,
  lonMin: 14.69,
  lonMax: 14.86,
} as const;

export const CENTER_LAT = (BBOX.latMin + BBOX.latMax) / 2;
export const CENTER_LON = (BBOX.lonMin + BBOX.lonMax) / 2;

const rad = Math.PI / 180;

/** Raggio di curvatura locale (formule WGS84 semplificate, errore < 0.1 m). */
export const METERS_PER_DEG_LAT =
  111132.92 -
  559.82 * Math.cos(2 * CENTER_LAT * rad) +
  1.175 * Math.cos(4 * CENTER_LAT * rad) -
  0.0023 * Math.cos(6 * CENTER_LAT * rad);

export const METERS_PER_DEG_LON =
  111412.84 * Math.cos(CENTER_LAT * rad) -
  93.5 * Math.cos(3 * CENTER_LAT * rad) +
  0.118 * Math.cos(5 * CENTER_LAT * rad);

export const WORLD = {
  /** ampiezza est-ovest in metri */
  width: (BBOX.lonMax - BBOX.lonMin) * METERS_PER_DEG_LON,
  /** ampiezza nord-sud in metri */
  height: (BBOX.latMax - BBOX.latMin) * METERS_PER_DEG_LAT,
  halfWidth: ((BBOX.lonMax - BBOX.lonMin) * METERS_PER_DEG_LON) / 2,
  halfHeight: ((BBOX.latMax - BBOX.latMin) * METERS_PER_DEG_LAT) / 2,
  name: 'Valle del Biferno — Molise',
} as const;

/**
 * Sistema di coordinate locale, "three-friendly":
 *  x = est (metri), z = sud (metri), y = quota.
 * Il nord è quindi -z, come la direzione di default della camera.
 */
export function latLonToWorld(lat: number, lon: number): { x: number; z: number } {
  return {
    x: (lon - CENTER_LON) * METERS_PER_DEG_LON,
    z: -(lat - CENTER_LAT) * METERS_PER_DEG_LAT,
  };
}

export function worldToLatLon(x: number, z: number): { lat: number; lon: number } {
  return {
    lat: CENTER_LAT - z / METERS_PER_DEG_LAT,
    lon: CENTER_LON + x / METERS_PER_DEG_LON,
  };
}

export interface Village {
  name: string;
  lat: number;
  lon: number;
  /** quota approssimativa, usata solo per l'interfaccia */
  elev: number;
}

export const VILLAGES: Village[] = [
  { name: 'Palata', lat: 41.8905, lon: 14.7854, elev: 520 },
  { name: 'Montecilfone', lat: 41.9025, lon: 14.8364, elev: 405 },
  { name: 'Acquaviva Collecroce', lat: 41.8676, lon: 14.7468, elev: 425 },
  { name: 'Tavenna', lat: 41.9086, lon: 14.7625, elev: 550 },
  { name: 'Castelmauro', lat: 41.8291, lon: 14.7103, elev: 690 },
];

/**
 * Centri urbani fuori dal mondo giocabile ma dentro il paesaggio che si vede
 * dall'orizzonte. Non hanno geometria 3D: servono alla mappa (come destinazioni
 * con distanza e direzione) e all'etichetta sotto la minimappa, così non si
 * perde l'orientamento verso la costa e il capoluogo.
 */
export const FAR_TOWNS: Village[] = [
  { name: 'Montenero di Bisaccia', lat: 41.9455, lon: 14.786, elev: 260 },
  { name: 'Larino', lat: 41.8045, lon: 14.918, elev: 400 },
  { name: 'Termoli', lat: 41.9955, lon: 14.992, elev: 20 },
  { name: 'San Salvo', lat: 42.0438, lon: 14.7283, elev: 100 },
  { name: 'Vasto', lat: 42.1116, lon: 14.7071, elev: 140 },
  { name: 'Campobasso', lat: 41.5604, lon: 14.6628, elev: 700 },
];

/** Palata è la "casa": il gioco parte sempre dal suo centro. */
export const HOME = VILLAGES[0];

/** Centro di Palata: punto di partenza a piedi. */
export const START = latLonToWorld(HOME.lat, HOME.lon);

/** Dimensione di un chunk di terreno in metri (≈ 2 tile z16). */
export const CHUNK_SIZE = 912;

/** Passo della griglia del terreno dentro un chunk. */
export const TERRAIN_SEGMENTS = 96;

/** Raggio di streaming del terreno (m) e margine prima di liberare la memoria. */
export const VIEW_RADIUS = 3100;
export const DETAIL_RADIUS = 950;

/** Densità e limiti della vegetazione. */
export const TREES_MAX = 14000;

/** Colori di riferimento (in stile "paesaggio molisano"). */
export const COLORS = {
  skyTop: 0x5d8fbe,
  skyHorizon: 0xe8d7bd,
  sun: 0xfff2d6,
  fog: 0xc9d2d8,
  asphalt: 0x3d4045,
  dirt: 0x8a7a5f,
  grass: 0x5f7a45,
  roof: 0x9c5b3f,
  water: 0x3f6f86,
} as const;

/** Etichette e limiti di gioco. */
export const GAME = {
  walkSpeed: 4.4,
  runSpeed: 8.6,
  jumpSpeed: 5.2,
  gravity: 20,
  eyeHeight: 1.68,
  interactionRange: 5,
  maxSpeedKmh: 125,
} as const;

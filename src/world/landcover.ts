import * as THREE from 'three';
import { CHUNK_SIZE, WORLD } from '../config';
import { terrainMicroNormal } from '../gfx/detail-textures';

/**
 * Copertura del suolo della Fase A (vedi `scripts/fetch-landcover.mjs`).
 *
 * I file in `public/geo/landcover/` non sono versionati: sono un'opera derivata
 * da ESA WorldCover (CC BY 4.0) e OpenStreetMap (ODbL 1.0). Si rigenerano con
 * `npm run landcover`. Se mancano, il terreno continua a usare il vecchio
 * shader erba/roccia: questa classe non lancia e `ready` resta `false`.
 *
 * Formato dei dati (RGBA8, 0..255):
 *  - R = coltivo secco/stoppie, G = prato, B = sottobosco, A = roccia/terra;
 *  - `fields.png`: RG = direzione dei solchi, B = aratura, A = forza del campo;
 *  - i chunk sono 456×456 a 2 m/px.
 *
 * Per non pagare sei campioni di texture per pixel (misurati: quasi dimezzava
 * gli fps su una iGPU), il colore del dettaglio viene **cotto** una volta sola
 * per chunk in una texture di modulazione RGB: il shader fa un solo campione e
 * moltiplica. La cottura usa le tre scale del brief (60 m, 6 m, 0,8 m): le due
 * scale di colore entrano nella texture a 2 m/px, la terza resta nel
 * micro-rilievo normale e nei solchi, che sono gli unici a aver bisogno di
 * stare sotto il metro.
 */

const ROOT = `${import.meta.env.BASE_URL}geo/landcover`;
const TEXTURE_ROOT = `${import.meta.env.BASE_URL}textures`;
const LOCAL_PIXELS = 456;
const LOCAL_MPP = CHUNK_SIZE / LOCAL_PIXELS;
const DETAIL_SIZE = 256;

/** Sonda temporanea del banco prova: `?lcdebug=base` evita la cottura locale. */
const DEBUG_LOCAL_BASE =
  typeof window !== 'undefined' &&
  new URLSearchParams(window.location.search).get('lcdebug') === 'base';

export type LandcoverMode = 'full' | 'base' | 'off';

export interface LandcoverMeta {
  generatedAt: string;
  source: string;
  license: string;
  worldCoverUrl: string;
  world: { width: number; height: number; halfWidth: number; halfHeight: number };
  chunk: {
    size: number;
    pixels: number;
    metersPerPixel: number;
    cxMin: number;
    cxMax: number;
    czMin: number;
    czMax: number;
  };
  base: { file: string; width: number; height: number; metersPerPixel: number };
  fields: { file: string; width: number; height: number; metersPerPixel: number };
  legend: Record<string, string>;
  stats: { chunks: number; written: number; skipped: number };
}

export interface SeasonTint {
  /** moltiplicatori RGB per classe (1 = nessuna tinta) */
  plough: [number, number, number];
  grass: [number, number, number];
  woodland: [number, number, number];
  rock: [number, number, number];
  /** 0..1: quanto la tinta sposta il satellite */
  strength: number;
}

interface SeasonKey extends SeasonTint {
  month: number;
}

/**
 * Tinte stagionali. Il gioco parte a ottobre (vedi `monthForGameDay`), il mese
 * in cui il Molise è fatto di stoppie gialle, uliveti grigio-verdi e boschi
 * che virano al ruggine. Le altre stagioni servono a non lasciare il filtro
 * fermo se il calendario avanza.
 */
const SEASONS: SeasonKey[] = [
  {
    month: 1,
    plough: [0.94, 0.97, 0.95],
    grass: [0.92, 0.98, 0.94],
    woodland: [0.88, 0.92, 0.9],
    rock: [0.97, 0.99, 1.0],
    strength: 0.34,
  },
  {
    month: 4,
    plough: [0.99, 1.02, 0.94],
    grass: [0.9, 1.08, 0.86],
    woodland: [0.9, 1.04, 0.88],
    rock: [1.0, 1.0, 1.0],
    strength: 0.4,
  },
  {
    month: 7,
    plough: [1.1, 0.98, 0.78],
    grass: [1.02, 0.99, 0.75],
    woodland: [0.93, 0.94, 0.79],
    rock: [1.02, 1.0, 0.96],
    strength: 0.55,
  },
  {
    month: 10,
    plough: [1.14, 0.95, 0.72],
    grass: [1.03, 0.95, 0.72],
    woodland: [0.96, 0.88, 0.72],
    rock: [1.0, 0.98, 0.95],
    strength: 0.6,
  },
  {
    month: 13,
    plough: [0.94, 0.97, 0.95],
    grass: [0.92, 0.98, 0.94],
    woodland: [0.88, 0.92, 0.9],
    rock: [0.97, 0.99, 1.0],
    strength: 0.34,
  },
];

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const clamp = (v: number, a: number, b: number): number => (v < a ? a : v > b ? b : v);

/** Tinte del mese `month` (1..12), interpolate tra le quattro stagioni. */
export function seasonTints(month: number): SeasonTint {
  const m = ((Math.round(month) - 1) % 12 + 12) % 12 + 1;
  let a = SEASONS[0]!;
  let b = SEASONS[1]!;
  for (let i = 0; i < SEASONS.length - 1; i++) {
    if (m >= SEASONS[i]!.month && m <= SEASONS[i + 1]!.month) {
      a = SEASONS[i]!;
      b = SEASONS[i + 1]!;
      break;
    }
  }
  const t = b.month === a.month ? 0 : (m - a.month) / (b.month - a.month);
  const mix = (x: [number, number, number], y: [number, number, number]): [number, number, number] => [
    lerp(x[0], y[0], t),
    lerp(x[1], y[1], t),
    lerp(x[2], y[2], t),
  ];
  return {
    plough: mix(a.plough, b.plough),
    grass: mix(a.grass, b.grass),
    woodland: mix(a.woodland, b.woodland),
    rock: mix(a.rock, b.rock),
    strength: lerp(a.strength, b.strength, t),
  };
}

/**
 * Media stagionale pesata sulle classi: è l'unica tinta applicata a runtime.
 * Le differenze **relative** tra classi sono cotte a ottobre nella texture;
 * il filtro globale del mese sposta tutte le classi insieme.
 */
export function seasonGlobal(month: number): [number, number, number] {
  const t = seasonTints(month);
  const w = { plough: 0.4, grass: 0.26, woodland: 0.24, rock: 0.1 };
  return [
    t.plough[0] * w.plough + t.grass[0] * w.grass + t.woodland[0] * w.woodland + t.rock[0] * w.rock,
    t.plough[1] * w.plough + t.grass[1] * w.grass + t.woodland[1] * w.woodland + t.rock[1] * w.rock,
    t.plough[2] * w.plough + t.grass[2] * w.grass + t.woodland[2] * w.woodland + t.rock[2] * w.rock,
  ];
}

/** Tinte di classe normalizzate sulla media: il colore relativo resta cotto. */
function relativeTints(month: number): [number, number, number][] {
  const t = seasonTints(month);
  const g = seasonGlobal(month);
  const rel = (c: [number, number, number]): [number, number, number] => [c[0] / g[0], c[1] / g[1], c[2] / g[2]];
  return [rel(t.plough), rel(t.grass), rel(t.woodland), rel(t.rock)];
}

/**
 * Il giorno 1 è il 1º ottobre: è la stagione con cui il gioco si apre e quella
 * in cui sono scattate le misure del banco prova. Ogni mese vale 30 giorni.
 */
export function monthForGameDay(day: number): number {
  const d = ((Math.floor(day) - 1) % 360 + 360) % 360;
  return ((9 + Math.floor(d / 30)) % 12) + 1;
}

interface LocalEntry {
  texture: THREE.Texture | null;
  ready: boolean;
  failed: boolean;
  refs: number;
  disposed: boolean;
  callbacks: Set<(texture: THREE.Texture) => void>;
}

function hash2(x: number, y: number): number {
  let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

/** Canale procedurale di riserva: entra solo se il JPG della classe manca. */
function proceduralChannel(kind: number, x: number, y: number, size: number): number {
  const u = (x / size) * Math.PI * 2;
  const v = (y / size) * Math.PI * 2;
  const n =
    Math.sin(u * 3 + Math.sin(v * 2) * 1.7) * 0.5 +
    Math.sin(v * 5 + Math.cos(u * 4) * 1.3) * 0.3 +
    (hash2(x, y) - 0.5) * 0.4;
  if (kind === 0) {
    const furrow = Math.sin(v * 26 + Math.sin(u * 2) * 2.4) * 0.5 + 0.5;
    return clamp(0.28 + furrow * 0.42 + n * 0.12, 0, 1);
  }
  if (kind === 1) return clamp(0.5 + n * 0.42, 0, 1);
  if (kind === 2) return clamp(0.44 + n * 0.3 + Math.sin(u * 7 + v * 3) * 0.08, 0, 1);
  return clamp(0.5 + n * 0.36 + Math.sin(u * 11 + v * 13) * 0.08, 0, 1);
}

interface ImageData2 {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

function loadImagePixels(url: string, width?: number, height?: number): Promise<ImageData2> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.decoding = 'async';
    image.onload = () => {
      try {
        const w = width ?? image.naturalWidth;
        const h = height ?? image.naturalHeight;
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) throw new Error('canvas 2d non disponibile');
        ctx.drawImage(image, 0, 0, w, h);
        resolve({ data: ctx.getImageData(0, 0, w, h).data, width: w, height: h });
      } catch (err) {
        reject(err);
      }
    };
    image.onerror = () => reject(new Error(`immagine non disponibile: ${url}`));
    image.src = url;
  });
}

/**
 * Luminanza delle quattro classi in un'unica RGBA (R coltivo, G prato,
 * B bosco, A roccia). Costa un solo campione per scala e resta un dato, non
 * un colore: la tinta arriva dai moltiplicatori stagionali.
 */
async function buildDetailData(): Promise<Uint8Array> {
  const kinds = ['ploughed', 'grass', 'woodland', 'rock'] as const;
  const data = new Uint8Array(DETAIL_SIZE * DETAIL_SIZE * 4);
  for (let c = 0; c < kinds.length; c++) {
    let pixels: Uint8ClampedArray | null = null;
    try {
      pixels = (await loadImagePixels(`${TEXTURE_ROOT}/${kinds[c]}/color.jpg`, DETAIL_SIZE, DETAIL_SIZE)).data;
    } catch {
      // senza JPG si usa il rumore procedurale: nessun buco, solo meno foto
    }
    const channel = new Float32Array(DETAIL_SIZE * DETAIL_SIZE);
    let sum = 0;
    let sum2 = 0;
    for (let i = 0; i < channel.length; i++) {
      let lum: number;
      if (pixels) {
        const k = i * 4;
        lum = (0.299 * pixels[k]! + 0.587 * pixels[k + 1]! + 0.114 * pixels[k + 2]!) / 255;
      } else {
        lum = proceduralChannel(c, i % DETAIL_SIZE, Math.floor(i / DETAIL_SIZE), DETAIL_SIZE);
      }
      channel[i] = lum;
      sum += lum;
      sum2 += lum * lum;
    }
    const mean = sum / channel.length;
    const variance = Math.max(1e-5, sum2 / channel.length - mean * mean);
    const gain = 0.18 / Math.sqrt(variance);
    for (let i = 0; i < channel.length; i++) {
      data[i * 4 + c] = Math.round(clamp(0.5 + (channel[i]! - mean) * gain, 0, 1) * 255);
    }
  }
  return data;
}

/** Bilineare con ripetizione a specchio: niente cuciture ogni 60 m. */
function sampleDetail(data: Uint8Array, u: number, v: number, channel: number): number {
  const size = DETAIL_SIZE;
  const wrap = (t: number): number => {
    const m = ((t % (2 * size)) + 2 * size) % (2 * size);
    return m <= size ? m : 2 * size - m;
  };
  const fx = wrap(u);
  const fy = wrap(v);
  const x0 = Math.floor(fx) % size;
  const y0 = Math.floor(fy) % size;
  const x1 = (x0 + 1) % size;
  const y1 = (y0 + 1) % size;
  const tx = fx - Math.floor(fx);
  const ty = fy - Math.floor(fy);
  const a = data[(y0 * size + x0) * 4 + channel]!;
  const b = data[(y0 * size + x1) * 4 + channel]!;
  const c = data[(y1 * size + x0) * 4 + channel]!;
  const d = data[(y1 * size + x1) * 4 + channel]!;
  return (lerp(lerp(a, b, tx), lerp(c, d, tx), ty) / 255) as number;
}

/** Luminanza di dettaglio alla scala scelta, già pesata sulle classi. */
function detailLuminance(data: Uint8Array, wx: number, wz: number, scale: number, weights: number[]): number {
  const macro = sampleDetail(data, wx / scale, wz / scale, 0);
  const grass = sampleDetail(data, wx / scale, wz / scale, 1);
  const wood = sampleDetail(data, wx / scale, wz / scale, 2);
  const rock = sampleDetail(data, wx / scale, wz / scale, 3);
  return macro * weights[0]! + grass * weights[1]! + wood * weights[2]! + rock * weights[3]!;
}

function normalizeWeights(pixels: Uint8ClampedArray, i: number): number[] {
  const k = i * 4;
  // A è il flag di validità del PNG (vedi `fetch-landcover.mjs`): con alfa=0
  // Canvas2D avrebbe già perso l'RGB, quindi il pixel è fuori copertura.
  if (pixels[k + 3]! < 128) return [0, 0, 0, 0];
  const r = pixels[k]! / 255;
  const g = pixels[k + 1]! / 255;
  const b = pixels[k + 2]! / 255;
  const a = clamp(1 - (r + g + b), 0, 1);
  const sum = r + g + b + a;
  return sum > 0.001 ? [r / sum, g / sum, b / sum, a / sum] : [0, 0, 0, 0];
}

/**
 * Cottura della modulazione: per ogni texel campiona la detail map a 60 m e
 * 6 m, la pesa con la copertura del suolo e scrive `mul / 2` in RGB, con il
 * peso del coltivo in A (serve ai solchi).
 */
function bakeOverlay(
  weightsPixels: Uint8ClampedArray,
  width: number,
  height: number,
  worldX: (i: number) => number,
  worldZ: (j: number) => number,
  detail: Uint8Array,
  tints: [number, number, number][],
  strength: number,
): THREE.DataTexture {
  const out = new Uint8Array(width * height * 4);
  for (let j = 0; j < height; j++) {
    const wz = worldZ(j);
    for (let i = 0; i < width; i++) {
      const wx = worldX(i);
      const w = normalizeWeights(weightsPixels, j * width + i);
      const k = (j * width + i) * 4;
      // fuori copertura (acqua, città, bordo): overlay nero = nessuna tinta,
      // il satellite resta com'è. Anche i solchi si spengono (A = 0).
      if (w[0]! + w[1]! + w[2]! + w[3]! < 0.001) {
        out[k] = 0;
        out[k + 1] = 0;
        out[k + 2] = 0;
        out[k + 3] = 0;
        continue;
      }
      const macro = detailLuminance(detail, wx, wz, 60, w);
      // meso ruotata di ~40°, come nel shader originale: due griglie diverse
      const rx = wx * 0.766 - wz * 0.643;
      const rz = wx * 0.643 + wz * 0.766;
      const meso = detailLuminance(detail, rx + 22, rz + 7, 6, w);
      const lum = macro * 0.45 + meso * 0.55;
      const mod = 1 + (lum - 0.5) * strength;
      const tint =
        tints[0]![0] * w[0]! + tints[1]![0] * w[1]! + tints[2]![0] * w[2]! + tints[3]![0] * w[3]!;
      const tintG =
        tints[0]![1] * w[0]! + tints[1]![1] * w[1]! + tints[2]![1] * w[2]! + tints[3]![1] * w[3]!;
      const tintB =
        tints[0]![2] * w[0]! + tints[1]![2] * w[1]! + tints[2]![2] * w[2]! + tints[3]![2]! * w[3]!;
      out[k] = Math.round(clamp(mod * tint * 0.5, 0, 1) * 255);
      out[k + 1] = Math.round(clamp(mod * tintG * 0.5, 0, 1) * 255);
      out[k + 2] = Math.round(clamp(mod * tintB * 0.5, 0, 1) * 255);
      out[k + 3] = Math.round(clamp(w[0]! * 255, 0, 255));
    }
  }
  const texture = new THREE.DataTexture(out, width, height, THREE.RGBAFormat);
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.colorSpace = THREE.NoColorSpace;
  texture.flipY = false;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  return texture;
}

function configureDataTexture(texture: THREE.Texture, anisotropy: number): void {
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.colorSpace = THREE.NoColorSpace;
  texture.flipY = false;
  texture.anisotropy = anisotropy;
  texture.needsUpdate = true;
}

export class Landcover {
  readonly microNormal: THREE.Texture;
  /** true quando la mappa globale è pronta: senza di lui resta il vecchio shader */
  ready = false;
  meta: LandcoverMeta | null = null;
  /** modulazione globale cotta (RGB) con il peso del coltivo in A */
  baseTexture: THREE.Texture | null = null;
  fieldsTexture: THREE.Texture | null = null;
  /** dettaglio 0,8 m in RGBA (coltivo, prato, bosco, roccia), ripetuto */
  detailTexture: THREE.DataTexture | null = null;
  /** forza del dettaglio 0..1 (0,58 = overlay dichiarato dal brief) */
  readonly detailStrength = 0.58;
  readonly seasonGlobalUniform = new THREE.Vector3(1, 1, 1);

  private mode: LandcoverMode = 'off';
  private radius = 0;
  private readonly locals = new Map<string, LocalEntry>();
  private loading: Promise<void> | null = null;
  private month = 10;
  private detailData: Uint8Array | null = null;
  private bakes = 0;
  private bakeMs = 0;
  private maxBakeMs = 0;
  private readonly loader = new THREE.TextureLoader();

  constructor(
    private readonly anisotropy = 4,
    mode: LandcoverMode = 'off',
    radius = 0,
  ) {
    this.mode = mode;
    this.radius = radius;
    this.microNormal = terrainMicroNormal();
    this.setSeason(10);
  }

  get effectiveMode(): LandcoverMode {
    return this.ready ? this.mode : 'off';
  }

  get radiusMeters(): number {
    return this.radius;
  }

  get fieldsReady(): boolean {
    return this.fieldsTexture !== null;
  }

  get localLoaded(): number {
    let n = 0;
    for (const e of this.locals.values()) if (e.ready) n++;
    return n;
  }

  get pending(): number {
    let n = 0;
    for (const e of this.locals.values()) if (!e.ready && !e.failed) n++;
    return n;
  }

  get monthIndex(): number {
    return this.month;
  }

  /** Carica base, campi e anteprima dei dettagli. Non lancia mai. */
  async load(): Promise<void> {
    if (this.loading) return this.loading;
    this.loading = (async () => {
      const [meta, basePixels, fields, detail] = await Promise.all([
        this.loadMeta(),
        loadImagePixels(`${ROOT}/base.png`).catch(() => null),
        this.loadTexture(`${ROOT}/fields.png`),
        buildDetailData().catch(() => null),
      ]);
      this.meta = meta;
      this.detailData = detail;
      this.fieldsTexture = fields;
      if (detail) {
        const tex = new THREE.DataTexture(detail, DETAIL_SIZE, DETAIL_SIZE, THREE.RGBAFormat);
        configureDataTexture(tex, this.anisotropy);
        tex.wrapS = THREE.RepeatWrapping;
        tex.wrapT = THREE.RepeatWrapping;
        tex.name = 'landcover-detail-08m';
        tex.needsUpdate = true;
        this.detailTexture = tex;
      }
      if (basePixels && detail) {
        const tints = relativeTints(this.month);
        const width = basePixels.width;
        const height = basePixels.height;
        this.baseTexture = bakeOverlay(
          basePixels.data,
          width,
          height,
          (i) => -WORLD.halfWidth + (i + 0.5) * (WORLD.width / width),
          (j) => -WORLD.halfHeight + (j + 0.5) * (WORLD.height / height),
          detail,
          tints,
          this.detailStrength,
        );
        this.baseTexture.name = 'landcover-base-overlay';
        this.baseTexture.anisotropy = this.anisotropy;
        this.baseTexture.needsUpdate = true;
        this.ready = true;
      } else {
        this.ready = false;
      }
    })();
    return this.loading;
  }

  configure(mode: LandcoverMode, radius: number): void {
    this.mode = mode;
    this.radius = Math.max(0, radius);
  }

  setSeason(month: number): void {
    this.month = month;
    const g = seasonGlobal(month);
    this.seasonGlobalUniform.set(g[0], g[1], g[2]);
  }

  /** true se questo chunk ricade nel raggio del dettaglio locale. */
  covers(cx: number, cz: number, x: number, z: number): boolean {
    if (this.mode !== 'full' || this.radius <= 0) return false;
    const dx = (cx + 0.5) * CHUNK_SIZE - x;
    const dz = (cz + 0.5) * CHUNK_SIZE - z;
    return Math.hypot(dx, dz) <= this.radius + CHUNK_SIZE * 0.5;
  }

  /**
   * Restituisce subito una texture (null finché il chunk non è pronto) e
   * chiama `onReady` quando la modulazione è cotta. Il chiamante deve fare
   * `release` quando libera il chunk.
   */
  acquire(cx: number, cz: number, onReady: (texture: THREE.Texture) => void): THREE.Texture | null {
    if (DEBUG_LOCAL_BASE && this.baseTexture) {
      onReady(this.baseTexture);
      return this.baseTexture;
    }
    const key = `${cx},${cz}`;
    let entry = this.locals.get(key);
    if (!entry) {
      entry = {
        texture: null,
        ready: false,
        failed: false,
        refs: 0,
        disposed: false,
        callbacks: new Set(),
      };
      this.locals.set(key, entry);
      void this.loadLocal(key, cx, cz, entry);
    }
    entry.refs++;
    if (entry.ready && entry.texture) onReady(entry.texture);
    else if (!entry.failed) entry.callbacks.add(onReady);
    return entry.texture;
  }

  release(cx: number, cz: number): void {
    const key = `${cx},${cz}`;
    const entry = this.locals.get(key);
    if (!entry) return;
    entry.refs--;
    if (entry.refs > 0) return;
    entry.disposed = true;
    entry.callbacks.clear();
    entry.texture?.dispose();
    this.locals.delete(key);
  }

  /** Texture da contare nella stima di memoria (le locali sono già pronte). */
  textures(): THREE.Texture[] {
    const list: THREE.Texture[] = [this.microNormal];
    if (this.baseTexture) list.push(this.baseTexture);
    if (this.fieldsTexture) list.push(this.fieldsTexture);
    if (this.detailTexture) list.push(this.detailTexture);
    for (const e of this.locals.values()) if (e.ready && e.texture) list.push(e.texture);
    return list;
  }

  /** Diagnostica per `window.__molise` e per il banco prova. */
  stats(): {
    mode: LandcoverMode;
    ready: boolean;
    local: number;
    pending: number;
    pendingKeys: string[];
    bakes: number;
    bakeMs: number;
    maxBakeMs: number;
    radius: number;
    month: number;
    chunks: number;
  } {
    const pendingKeys: string[] = [];
    for (const [key, e] of this.locals) if (!e.ready && !e.failed) pendingKeys.push(key);
    return {
      mode: this.effectiveMode,
      ready: this.ready,
      local: this.localLoaded,
      pending: pendingKeys.length,
      pendingKeys,
      bakes: this.bakes,
      bakeMs: +this.bakeMs.toFixed(1),
      maxBakeMs: +this.maxBakeMs.toFixed(1),
      radius: this.radius,
      month: this.month,
      chunks: this.meta?.stats?.chunks ?? 0,
    };
  }

  dispose(): void {
    for (const [key, entry] of this.locals) {
      entry.disposed = true;
      entry.callbacks.clear();
      entry.texture?.dispose();
      this.locals.delete(key);
    }
    this.baseTexture?.dispose();
    this.fieldsTexture?.dispose();
    this.detailTexture?.dispose();
    this.baseTexture = null;
    this.fieldsTexture = null;
    this.detailTexture = null;
    this.detailData = null;
    this.ready = false;
  }

  private async loadMeta(): Promise<LandcoverMeta | null> {
    try {
      const res = await fetch(`${ROOT}/meta.json`);
      if (!res.ok) return null;
      return (await res.json()) as LandcoverMeta;
    } catch {
      return null;
    }
  }

  private async loadTexture(url: string): Promise<THREE.Texture | null> {
    try {
      const texture = await this.loader.loadAsync(url);
      configureDataTexture(texture, this.anisotropy);
      return texture;
    } catch {
      return null;
    }
  }

  private async loadLocal(key: string, cx: number, cz: number, entry: LocalEntry): Promise<void> {
    try {
      const pixels = await loadImagePixels(`${ROOT}/${cx}_${cz}.png`, LOCAL_PIXELS, LOCAL_PIXELS);
      if (entry.disposed || !this.detailData) {
        return;
      }
      const x0 = cx * CHUNK_SIZE;
      const z0 = cz * CHUNK_SIZE;
      const bakeStart = performance.now();
      const texture = bakeOverlay(
        pixels.data,
        LOCAL_PIXELS,
        LOCAL_PIXELS,
        (i) => x0 + (i + 0.5) * LOCAL_MPP,
        (j) => z0 + (j + 0.5) * LOCAL_MPP,
        this.detailData,
        relativeTints(this.month),
        this.detailStrength,
      );
      const bakeTime = performance.now() - bakeStart;
      this.bakes++;
      this.bakeMs += bakeTime;
      if (bakeTime > this.maxBakeMs) this.maxBakeMs = bakeTime;
      texture.name = `landcover-${cx}-${cz}`;
      texture.anisotropy = this.anisotropy;
      texture.needsUpdate = true;
      if (entry.disposed) {
        texture.dispose();
        return;
      }
      entry.texture = texture;
      entry.ready = true;
      for (const cb of entry.callbacks) cb(texture);
      entry.callbacks.clear();
    } catch {
      entry.failed = true;
      entry.callbacks.clear();
      // nessuna texture locale: il chunk usa quella globale
    } finally {
      if (!entry.ready && entry.disposed) this.locals.delete(key);
    }
  }
}

/** Costanti utili al shader e ai test. */
export const LANDCOVER_LOCAL_MPP = LOCAL_MPP;
export const LANDCOVER_BASE_MPP = 12;

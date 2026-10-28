import { clamp, mulberry32, smoothstep } from './geo';

const PROCEDURAL_SEED = 0x4d4f4c49;
const PROCEDURAL_SCALE = 0.0005;
const PROCEDURAL_AMPLITUDE = 240;
const TRANSITION_DISTANCE = 100;
const NOISE_SIZE = 256;

const PERMUTATION = (() => {
  const values = new Uint8Array(NOISE_SIZE * 2);
  const source = Uint8Array.from({ length: NOISE_SIZE }, (_, i) => i);
  const random = mulberry32(PROCEDURAL_SEED);
  for (let i = NOISE_SIZE - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [source[i], source[j]] = [source[j]!, source[i]!];
  }
  for (let i = 0; i < values.length; i++) values[i] = source[i % NOISE_SIZE]!;
  return values;
})();

function fade(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

function gradient(hash: number, x: number, z: number): number {
  switch (hash & 7) {
    case 0:
      return x + z;
    case 1:
      return -x + z;
    case 2:
      return x - z;
    case 3:
      return -x - z;
    case 4:
      return x;
    case 5:
      return -x;
    case 6:
      return z;
    default:
      return -z;
  }
}

/** Perlin noise seeded once, so every coordinate has a stable world height. */
function perlin2(x: number, z: number): number {
  const xi = Math.floor(x) & 255;
  const zi = Math.floor(z) & 255;
  const xf = x - Math.floor(x);
  const zf = z - Math.floor(z);
  const u = fade(xf);
  const v = fade(zf);
  const aa = PERMUTATION[PERMUTATION[xi]! + zi]!;
  const ab = PERMUTATION[PERMUTATION[xi]! + zi + 1]!;
  const ba = PERMUTATION[PERMUTATION[xi + 1]! + zi]!;
  const bb = PERMUTATION[PERMUTATION[xi + 1]! + zi + 1]!;
  const top = (1 - u) * gradient(aa, xf, zf) + u * gradient(ba, xf - 1, zf);
  const bottom = (1 - u) * gradient(ab, xf, zf - 1) + u * gradient(bb, xf - 1, zf - 1);
  return clamp((top * (1 - v) + bottom * v) * 0.70710678, -1, 1);
}

/** Four octave fBm tuned for broad Molise-like hills with deterministic detail. */
export function proceduralElevationNoise(x: number, z: number): number {
  let frequency = PROCEDURAL_SCALE;
  let amplitude = 1;
  let value = 0;
  let total = 0;
  for (let octave = 0; octave < 4; octave++) {
    value += perlin2(x * frequency, z * frequency) * amplitude;
    total += amplitude;
    frequency *= 2;
    amplitude *= 0.5;
  }
  return (value / total) * PROCEDURAL_AMPLITUDE;
}

export interface HeightMeta {
  source: string;
  license: string;
  attribution: string;
  encoding: string;
  step: number;
  nx: number;
  nz: number;
  originX: number;
  originZ: number;
  lat: number;
  lon: number;
  metersPerDegLat: number;
  metersPerDegLon: number;
  minElevation: number;
  maxElevation: number;
  generatedAt: string;
}

export interface StreamedElevationGrid {
  minLon: number;
  maxLon: number;
  minLat: number;
  maxLat: number;
  width: number;
  height: number;
  values: readonly number[];
}

/**
 * Griglia di elevazione regolare in metri locali (x = est, z = sud).
 * L'ordine dei campioni è row-major: indice = j * nx + i, con j che cresce verso sud.
 */
export class Heightfield {
  readonly meta: HeightMeta;
  private readonly data: Int16Array;
  private readonly minX: number;
  private readonly maxX: number;
  private readonly minZ: number;
  private readonly maxZ: number;
  private readonly proceduralBase: number;
  private readonly streamedTiles = new Map<string, StreamedElevationGrid>();

  constructor(meta: HeightMeta, data: Int16Array) {
    if (data.length !== meta.nx * meta.nz) {
      throw new Error(`heightfield: attesi ${meta.nx * meta.nz} campioni, trovati ${data.length}`);
    }
    this.meta = meta;
    this.data = data;
    this.minX = meta.originX;
    this.maxX = meta.originX + (meta.nx - 1) * meta.step;
    this.minZ = meta.originZ;
    this.maxZ = meta.originZ + (meta.nz - 1) * meta.step;
    this.proceduralBase = this.sample(Math.floor((meta.nx - 1) / 2), Math.floor((meta.nz - 1) / 2));
  }

  sample(i: number, j: number): number {
    const { nx, nz } = this.meta;
    const ii = clamp(i, 0, nx - 1);
    const jj = clamp(j, 0, nz - 1);
    return this.data[jj * nx + ii] / 10;
  }

  /** Quota (metri): DEM reale nel suo bbox, fBm deterministico oltre il bordo. */
  heightAt(x: number, z: number): number {
    if (!Number.isFinite(x) || !Number.isFinite(z)) {
      throw new Error(`heightfield: coordinate non finite (${x}, ${z})`);
    }
    if (this.contains(x, z)) return this.demHeightAt(x, z);
    const streamed = this.streamedHeightAt(x, z);
    if (streamed !== undefined) return streamed;

    const edgeX = clamp(x, this.minX, this.maxX);
    const edgeZ = clamp(z, this.minZ, this.maxZ);
    const dx = x - edgeX;
    const dz = z - edgeZ;
    const distance = Math.hypot(dx, dz);
    const edgeHeight = this.demHeightAt(edgeX, edgeZ);
    const eps = this.meta.step;
    const gradX =
      dx === 0
        ? 0
        : (Math.sign(dx) * (edgeHeight - this.demHeightAt(edgeX - Math.sign(dx) * eps, edgeZ))) / eps;
    const gradZ =
      dz === 0
        ? 0
        : (Math.sign(dz) * (edgeHeight - this.demHeightAt(edgeX, edgeZ - Math.sign(dz) * eps))) / eps;
    const continuedDem = edgeHeight + gradX * dx + gradZ * dz;
    const procedural = this.proceduralBase + proceduralElevationNoise(x, z);
    const blend = smoothstep(0, TRANSITION_DISTANCE, distance);
    return continuedDem + (procedural - continuedDem) * blend;
  }

  setStreamedTile(id: string, grid: StreamedElevationGrid): void {
    if (!id) throw new Error('heightfield: ID tile vuoto');
    if (
      !Number.isInteger(grid.width) ||
      !Number.isInteger(grid.height) ||
      grid.width < 2 ||
      grid.height < 2 ||
      grid.values.length !== grid.width * grid.height
    ) {
      throw new Error(`heightfield: griglia streamed non valida (${id})`);
    }
    this.streamedTiles.set(id, grid);
  }

  removeStreamedTile(id: string): boolean {
    return this.streamedTiles.delete(id);
  }

  contains(x: number, z: number): boolean {
    return x >= this.minX && x <= this.maxX && z >= this.minZ && z <= this.maxZ;
  }

  /** Estensione del DEM locale in coordinate mondo. */
  get bounds(): { minX: number; maxX: number; minZ: number; maxZ: number } {
    return { minX: this.minX, maxX: this.maxX, minZ: this.minZ, maxZ: this.maxZ };
  }

  private streamedHeightAt(x: number, z: number): number | undefined {
    const lon = this.meta.lon + x / this.meta.metersPerDegLon;
    const lat = this.meta.lat - z / this.meta.metersPerDegLat;
    let best: { grid: StreamedElevationGrid; resolution: number } | undefined;

    for (const grid of this.streamedTiles.values()) {
      if (lon < grid.minLon || lon > grid.maxLon || lat < grid.minLat || lat > grid.maxLat) continue;
      const resolution =
        ((grid.maxLon - grid.minLon) / (grid.width - 1)) *
        ((grid.maxLat - grid.minLat) / (grid.height - 1));
      if (!best || resolution < best.resolution) best = { grid, resolution };
    }
    if (!best) return undefined;

    const { grid } = best;
    const fx = ((lon - grid.minLon) / (grid.maxLon - grid.minLon)) * (grid.width - 1);
    const fz = ((grid.maxLat - lat) / (grid.maxLat - grid.minLat)) * (grid.height - 1);
    const ix = Math.min(grid.width - 2, Math.max(0, Math.floor(fx)));
    const iz = Math.min(grid.height - 2, Math.max(0, Math.floor(fz)));
    const tx = fx - ix;
    const tz = fz - iz;
    const h00 = grid.values[iz * grid.width + ix]! / 10;
    const h10 = grid.values[iz * grid.width + ix + 1]! / 10;
    const h01 = grid.values[(iz + 1) * grid.width + ix]! / 10;
    const h11 = grid.values[(iz + 1) * grid.width + ix + 1]! / 10;
    return (h00 * (1 - tx) + h10 * tx) * (1 - tz) + (h01 * (1 - tx) + h11 * tx) * tz;
  }

  private demHeightAt(x: number, z: number): number {
    const { originX, originZ, step, nx, nz } = this.meta;
    const fx = clamp((x - originX) / step, 0, nx - 1 - 1e-9);
    const fz = clamp((z - originZ) / step, 0, nz - 1 - 1e-9);
    const i = Math.floor(fx);
    const j = Math.floor(fz);
    const tx = fx - i;
    const tz = fz - j;
    const h00 = this.sample(i, j);
    const h10 = this.sample(i + 1, j);
    const h01 = this.sample(i, j + 1);
    const h11 = this.sample(i + 1, j + 1);
    return (h00 * (1 - tx) + h10 * tx) * (1 - tz) + (h01 * (1 - tx) + h11 * tx) * tz;
  }

  /** Normale del terreno (vettore non normalizzato da normalizzare a monte). */
  normalAt(x: number, z: number, eps = 4): { x: number; y: number; z: number } {
    const hL = this.heightAt(x - eps, z);
    const hR = this.heightAt(x + eps, z);
    const hU = this.heightAt(x, z - eps);
    const hD = this.heightAt(x, z + eps);
    return { x: hL - hR, y: 2 * eps, z: hU - hD };
  }

  /** Pendenza in gradi (0 = pianura). */
  slopeAt(x: number, z: number, eps = 6): number {
    const n = this.normalAt(x, z, eps);
    const len = Math.hypot(n.x, n.y, n.z);
    return (Math.acos(clamp(n.y / len, -1, 1)) * 180) / Math.PI;
  }

  /** Dislivello lungo una direzione, comodo per la fisica dell'auto. */
  riseAlong(x: number, z: number, dx: number, dz: number, dist: number): number {
    return this.heightAt(x + dx * dist, z + dz * dist) - this.heightAt(x - dx * dist, z - dz * dist);
  }

  get minElevation(): number {
    return this.meta.minElevation;
  }

  get maxElevation(): number {
    return this.meta.maxElevation;
  }
}

export async function loadHeightfield(base = './geo/'): Promise<Heightfield> {
  const metaRes = await fetch(`${base}heights.json`);
  if (!metaRes.ok) throw new Error(`heights.json: HTTP ${metaRes.status}`);
  const meta = (await metaRes.json()) as HeightMeta;

  const binRes = await fetch(`${base}heights.bin`);
  if (!binRes.ok) throw new Error(`heights.bin: HTTP ${binRes.status} (esegui "npm run geo")`);
  const buffer = await binRes.arrayBuffer();
  const expected = meta.nx * meta.nz * 2;
  if (buffer.byteLength !== expected) {
    throw new Error(`heights.bin: ${buffer.byteLength} byte, attesi ${expected}. Rigenera con "npm run geo".`);
  }
  return new Heightfield(meta, new Int16Array(buffer));
}

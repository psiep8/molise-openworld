import { clamp } from './geo';

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

/**
 * Griglia di elevazione regolare in metri locali (x = est, z = sud).
 * L'ordine dei campioni è row-major: indice = j * nx + i, con j che cresce verso sud.
 */
export class Heightfield {
  readonly meta: HeightMeta;
  private readonly data: Int16Array;

  constructor(meta: HeightMeta, data: Int16Array) {
    if (data.length !== meta.nx * meta.nz) {
      throw new Error(`heightfield: attesi ${meta.nx * meta.nz} campioni, trovati ${data.length}`);
    }
    this.meta = meta;
    this.data = data;
  }

  sample(i: number, j: number): number {
    const { nx, nz } = this.meta;
    const ii = clamp(i, 0, nx - 1);
    const jj = clamp(j, 0, nz - 1);
    return this.data[jj * nx + ii] / 10;
  }

  /** Quota (metri) con interpolazione bilineare. Fuori dal mondo: clamp ai bordi. */
  heightAt(x: number, z: number): number {
    const { originX, originZ, step, nx, nz } = this.meta;
    const fx = clamp((x - originX) / step, 0, nx - 1e-9);
    const fz = clamp((z - originZ) / step, 0, nz - 1e-9);
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

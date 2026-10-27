/**
 * Altezza della chioma (ETH Global Canopy Height 2020, 10 m, CC BY 4.0).
 *
 * Il dato è facoltativo: se `public/geo/canopy.bin` non esiste (o è stato
 * generato per un bbox diverso) il gioco continua con la vegetazione OSM.
 * Serve a due cose concrete:
 *  - dare agli alberi un'altezza plausibile invece di uno scale casuale;
 *  - non piantare un bosco fitto dove il satellite vede prato/coltivo.
 */

export interface CanopyMeta {
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
  minHeight: number;
  maxHeight: number;
  treeCells: number;
  generatedAt: string;
}

export class CanopyField {
  readonly meta: CanopyMeta;
  private readonly data: Uint8Array;

  constructor(meta: CanopyMeta, data: Uint8Array) {
    if (data.length !== meta.nx * meta.nz) {
      throw new Error(`canopy: attesi ${meta.nx * meta.nz} campioni, trovati ${data.length}`);
    }
    this.meta = meta;
    this.data = data;
  }

  /** Altezza della chioma in metri; 0 = nessun albero. */
  heightAt(x: number, z: number): number {
    const { originX, originZ, step, nx, nz } = this.meta;
    const fx = Math.max(0, Math.min(nx - 1e-6, (x - originX) / step));
    const fz = Math.max(0, Math.min(nz - 1e-6, (z - originZ) / step));
    const i = Math.floor(fx);
    const j = Math.floor(fz);
    const tx = fx - i;
    const tz = fz - j;
    const at = (ii: number, jj: number): number =>
      this.data[Math.min(nz - 1, Math.max(0, jj)) * nx + Math.min(nx - 1, Math.max(0, ii))] ?? 0;
    const h00 = at(i, j);
    const h10 = at(i + 1, j);
    const h01 = at(i, j + 1);
    const h11 = at(i + 1, j + 1);
    return (h00 * (1 - tx) + h10 * tx) * (1 - tz) + (h01 * (1 - tx) + h11 * tx) * tz;
  }

  /** true se dentro il bbox in cui il dato è stato ritagliato. */
  covers(x: number, z: number): boolean {
    const { originX, originZ, step, nx, nz } = this.meta;
    return x >= originX && z >= originZ && x <= originX + (nx - 1) * step && z <= originZ + (nz - 1) * step;
  }
}

export async function loadCanopy(base = './geo/'): Promise<CanopyField | null> {
  try {
    const metaRes = await fetch(`${base}canopy.json`);
    if (!metaRes.ok) return null;
    const meta = (await metaRes.json()) as CanopyMeta;
    const binRes = await fetch(`${base}canopy.bin`);
    if (!binRes.ok) return null;
    const buffer = await binRes.arrayBuffer();
    if (buffer.byteLength !== meta.nx * meta.nz) return null;
    return new CanopyField(meta, new Uint8Array(buffer));
  } catch {
    return null;
  }
}

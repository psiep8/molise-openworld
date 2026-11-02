/**
 * Case in schiera: muri comuni e spigoli da non decorare.
 *
 * In un centro storico le case sono attaccate: la facciata laterale di una è il
 * muro di casa della vicina. Costruendole una per una, ognuna faceva la sua
 * gronda a sbalzo di 45 cm e la sua finestra su quel lato, e i due tetti si
 * infilavano l'uno nell'altro con le facciate coincidenti che z-fightavano.
 *
 * Qui si riconoscono i lati che due impronte condividono (collineari, entro
 * pochi centimetri, con un tratto in comune lungo) e si rientra il muro di
 * pochi centimetri: le due superfici smettono di essere complanari.
 *
 * Tutto puro e testabile con array di punti.
 */

import type { Pt } from '../geo/geo';

/** Distanza di un punto dalla retta passante per `a`–`b` (non dal segmento). */
function lineDistance(px: number, pz: number, a: Pt, b: Pt): number {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const len = Math.hypot(dx, dz);
  if (len < 1e-9) return Math.hypot(px - a.x, pz - a.z);
  return Math.abs((px - a.x) * dz - (pz - a.z) * dx) / len;
}

function markShared(
  a: readonly Pt[],
  b: readonly Pt[],
  flagsA: boolean[],
  flagsB: boolean[],
  tolerance: number,
): void {
  for (let i = 0; i < a.length; i++) {
    const a0 = a[i]!;
    const a1 = a[(i + 1) % a.length]!;
    const ax = a1.x - a0.x;
    const az = a1.z - a0.z;
    const lenA = Math.hypot(ax, az);
    if (lenA < 1e-3) continue;
    for (let j = 0; j < b.length; j++) {
      const b0 = b[j]!;
      const b1 = b[(j + 1) % b.length]!;
      const bx = b1.x - b0.x;
      const bz = b1.z - b0.z;
      const lenB = Math.hypot(bx, bz);
      if (lenB < 1e-3) continue;
      // lati paralleli (una schiera può avere muri leggermente fuori asse)
      if (Math.abs((ax * bz - az * bx) / (lenA * lenB)) > 0.08) continue;
      // e sulla stessa retta: gli estremi di ciascuno giacciono sulla retta
      // dell'altro, così due lati di case vicine ma non attaccate non contano
      if (
        lineDistance(a0.x, a0.z, b0, b1) > tolerance ||
        lineDistance(a1.x, a1.z, b0, b1) > tolerance ||
        lineDistance(b0.x, b0.z, a0, a1) > tolerance ||
        lineDistance(b1.x, b1.z, a0, a1) > tolerance
      ) {
        continue;
      }
      // tratto davvero in comune: un angolo che si sfiora non basta
      const ux = ax / lenA;
      const uz = az / lenA;
      const t0 = (b0.x - a0.x) * ux + (b0.z - a0.z) * uz;
      const t1 = (b1.x - a0.x) * ux + (b1.z - a0.z) * uz;
      const overlap = Math.min(lenA, Math.max(t0, t1)) - Math.max(0, Math.min(t0, t1));
      if (overlap < Math.min(lenA, lenB) * 0.5) continue;
      flagsA[i] = true;
      flagsB[j] = true;
    }
  }
}

/** Bounding box orizzontale: serve solo a indicizzare le case vicine. */
function cellRange(points: readonly Pt[], tolerance: number, cell: number): number[] {
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minZ = Math.min(minZ, p.z);
    maxZ = Math.max(maxZ, p.z);
  }
  return [
    Math.floor((minX - tolerance) / cell),
    Math.floor((maxX + tolerance) / cell),
    Math.floor((minZ - tolerance) / cell),
    Math.floor((maxZ + tolerance) / cell),
  ];
}

/**
 * Per ogni edificio, quali lati sono condivisi con un edificio vicino.
 * `flags[edificio][lato]`, con lo stesso ordine dei punti dell'impronta.
 */
export function findSharedEdges(
  buildings: readonly (readonly Pt[])[],
  tolerance = 0.45,
): boolean[][] {
  const flags = buildings.map((points) => points.map(() => false));
  const cell = 12;
  const grid = new Map<string, number[]>();

  buildings.forEach((points, index) => {
    if (points.length < 3) return;
    const [gx0, gx1, gz0, gz1] = cellRange(points, tolerance, cell);
    for (let gx = gx0; gx <= gx1; gx++) {
      for (let gz = gz0; gz <= gz1; gz++) {
        const key = `${gx}:${gz}`;
        const bucket = grid.get(key);
        if (bucket) bucket.push(index);
        else grid.set(key, [index]);
      }
    }
  });

  buildings.forEach((points, a) => {
    if (points.length < 3) return;
    const flagsA = flags[a]!;
    const seen = new Set<number>();
    const [gx0, gx1, gz0, gz1] = cellRange(points, tolerance, cell);
    for (let gx = gx0; gx <= gx1; gx++) {
      for (let gz = gz0; gz <= gz1; gz++) {
        const bucket = grid.get(`${gx}:${gz}`);
        if (!bucket) continue;
        for (const b of bucket) {
          if (b <= a || seen.has(b)) continue;
          seen.add(b);
          const other = buildings[b]!;
          if (other.length < 3) continue;
          markShared(points, other, flagsA, flags[b]!, tolerance);
        }
      }
    }
  });

  return flags;
}

/**
 * Rientra di `amount` i lati condivisi, lasciando fermo il resto.
 * Il rientro rompe la complanarità delle due facciate (niente z-fighting) e
 * cade dentro il muro del vicino, quindi non si vede.
 */
export function insetSharedEdges(
  points: readonly Pt[],
  shared: readonly boolean[],
  amount = 0.04,
): Pt[] {
  const out = points.map((p) => ({ x: p.x, z: p.z }));
  if (amount <= 0 || points.length < 3) return out;
  let cx = 0;
  let cz = 0;
  for (const p of points) {
    cx += p.x;
    cz += p.z;
  }
  cx /= points.length;
  cz /= points.length;

  for (let i = 0; i < points.length; i++) {
    if (!shared[i]) continue;
    const a = points[i]!;
    const b = points[(i + 1) % points.length]!;
    const length = Math.hypot(b.x - a.x, b.z - a.z);
    if (length < 1e-6) continue;
    let nx = (b.z - a.z) / length;
    let nz = -(b.x - a.x) / length;
    // verso l'interno dell'impronta
    if (nx * (a.x - cx) + nz * (a.z - cz) > 0) {
      nx = -nx;
      nz = -nz;
    }
    const j = (i + 1) % points.length;
    out[i]!.x += nx * amount;
    out[i]!.z += nz * amount;
    out[j]!.x += nx * amount;
    out[j]!.z += nz * amount;
  }
  return out;
}

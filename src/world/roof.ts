/**
 * Progettazione dei tetti a falde sopra un'impronta OSM.
 *
 * Due difetti da correggere, entrambi visibili da lontano:
 *
 *  1. **gronda scalata dal baricentro** (`centro + (p − centro) · 1,045`): lo
 *     sporto era proporzionale alla distanza dal centro, quindi su un'impronta
 *     allungata sporgeva mezzo metro sui lati corti e venti centimetri sui lati
 *     lunghi. La gronda non correva parallela al muro e gli angoli "sbiecavano".
 *     Qui si usa un offset di poligono a distanza costante (con miter smussato).
 *
 *  2. **colmo sempre rimpicciolito del 42% verso il baricentro**: su un
 *     rettangolo 8×14 il colmo diventava un rettangolo 4,6×8 senza alcun asse,
 *     e le case sembravano coperchi. Per le impronte quasi rettangolari si
 *     costruisce il tetto vero: asse lungo, due falde principali, due testate a
 *     padiglione, colmo orizzontale allineato al lato lungo. Per il resto resta
 *     l'anello interno, ma con raggio costante e più prudente.
 *
 * Se nemmeno il ripiego produce un tetto sensato si restituisce null: il
 * chiamante mette una copertura piana, che è brutta ma non è una geometria
 * impossibile.
 */
import { pointInPolygon, type Pt } from '../geo/geo';

export interface Pt3 {
  x: number;
  y: number;
  z: number;
}

export interface RoofSlope {
  /** ordine: gronda i, gronda i+1, colmo i+1, colmo i */
  corners: [Pt3, Pt3, Pt3, Pt3];
  /** lunghezza della gronda (per le UV) */
  eaveLength: number;
  /** lunghezza della pendenza (per le UV) */
  slopeLength: number;
}

export interface HipRoofPlan {
  slopes: RoofSlope[];
  /** anello del colmo, da triangolare come superficie piana */
  ridgeRing: Pt[];
  ridgeY: number;
  /** lunghezza complessiva della gronda, per far combaciare le UV */
  perimeter: number;
}

export function polygonArea(points: readonly Pt[]): number {
  let area = 0;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[j]!;
    const b = points[i]!;
    area += a.x * b.z - b.x * a.z;
  }
  return Math.abs(area * 0.5);
}

function bboxExtent(points: readonly Pt[], axis: 'x' | 'z'): number {
  let min = Infinity;
  let max = -Infinity;
  for (const p of points) {
    const value = axis === 'x' ? p.x : p.z;
    min = Math.min(min, value);
    max = Math.max(max, value);
  }
  return Number.isFinite(min) ? max - min : 0;
}

function centroid(points: readonly Pt[]): Pt {
  let x = 0;
  let z = 0;
  for (const p of points) {
    x += p.x;
    z += p.z;
  }
  return { x: x / points.length, z: z / points.length };
}

/**
 * Offset di un poligono a distanza costante.
 *
 * Positivo = verso l'esterno, negativo = verso l'interno. Ai vertici si usa la
 * bisettrice delle due normali, con il denominatore limitato: su angoli molto
 * acuti il miter esploderebbe e la gronda farebbe una punta lunga metri.
 * Restituisce null se il poligono non è utilizzabile.
 */
export function offsetPolygon(points: readonly Pt[], distance: number): Pt[] | null {
  if (points.length < 3) return null;
  if (!Number.isFinite(distance) || Math.abs(distance) < 1e-6) return points.map((p) => ({ x: p.x, z: p.z }));
  const center = centroid(points);
  const count = points.length;
  const normals: Pt[] = [];
  for (let i = 0; i < count; i++) {
    const a = points[(i - 1 + count) % count]!;
    const b = points[i]!;
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    if (len < 1e-6) return null;
    let nx = (b.z - a.z) / len;
    let nz = -(b.x - a.x) / len;
    if (nx * (b.x - center.x) + nz * (b.z - center.z) < 0) {
      nx = -nx;
      nz = -nz;
    }
    normals.push({ x: nx, z: nz });
  }

  const output: Pt[] = [];
  for (let i = 0; i < count; i++) {
    // i due lati che si toccano in questo vertice: quello che finisce qui
    // (`normals[i]`) e quello che parte da qui (`normals[i + 1]`)
    const previous = normals[i]!;
    const next = normals[(i + 1) % count]!;
    let mx = previous.x + next.x;
    let mz = previous.z + next.z;
    const length = Math.hypot(mx, mz);
    if (length < 0.15) return null;
    mx /= length;
    mz /= length;
    const cosine = mx * next.x + mz * next.z;
    const scale = distance / Math.max(0.35, cosine);
    const x = points[i]!.x + mx * scale;
    const z = points[i]!.z + mz * scale;
    if (!Number.isFinite(x) || !Number.isFinite(z)) return null;
    output.push({ x, z });
  }
  return output;
}

/**
 * Offset di un poligono con distanza diversa per lato.
 *
 * Serve alle case in schiera: la gronda deve sportare sui lati liberi e
 * fermarsi sul muro comune, invece di entrare nel tetto del vicino.
 * `distances[i]` vale per il lato che va da `points[i]` a `points[i + 1]`.
 */
export function offsetPolygonVariable(
  points: readonly Pt[],
  distances: readonly number[],
): Pt[] | null {
  if (points.length < 3 || distances.length !== points.length) return null;
  const center = centroid(points);
  const count = points.length;
  const normals: Pt[] = [];
  for (let i = 0; i < count; i++) {
    const a = points[(i - 1 + count) % count]!;
    const b = points[i]!;
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    if (len < 1e-6) return null;
    let nx = (b.z - a.z) / len;
    let nz = -(b.x - a.x) / len;
    if (nx * (b.x - center.x) + nz * (b.z - center.z) < 0) {
      nx = -nx;
      nz = -nz;
    }
    normals.push({ x: nx, z: nz });
  }
  const output: Pt[] = [];
  for (let i = 0; i < count; i++) {
    const previous = normals[i]!;
    const next = normals[(i + 1) % count]!;
    let mx = previous.x + next.x;
    let mz = previous.z + next.z;
    const length = Math.hypot(mx, mz);
    if (length < 0.15) return null;
    mx /= length;
    mz /= length;
    const cosine = mx * next.x + mz * next.z;
    const distance = (distances[(i - 1 + count) % count]! + distances[i]!) * 0.5;
    const scale = distance / Math.max(0.35, cosine);
    const x = points[i]!.x + mx * scale;
    const z = points[i]!.z + mz * scale;
    if (!Number.isFinite(x) || !Number.isFinite(z)) return null;
    output.push({ x, z });
  }
  return output;
}

/** Minimo rettangolo orientato sul lato più lungo di un quadrilatero. */
function orientedBox(points: readonly Pt[]): {
  axis: Pt;
  side: Pt;
  center: Pt;
  span: number;
  depth: number;
} | null {
  let axis = { x: 0, z: 0 };
  let longest = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i]!;
    const b = points[(i + 1) % points.length]!;
    const length = Math.hypot(b.x - a.x, b.z - a.z);
    if (length > longest) {
      longest = length;
      axis = { x: (b.x - a.x) / length, z: (b.z - a.z) / length };
    }
  }
  if (longest < 0.5) return null;
  let side = { x: -axis.z, z: axis.x };
  const extents = (uAxis: Pt, vAxis: Pt): [number, number, number, number] => {
    let minU = Infinity;
    let maxU = -Infinity;
    let minV = Infinity;
    let maxV = -Infinity;
    for (const p of points) {
      const u = p.x * uAxis.x + p.z * uAxis.z;
      const v = p.x * vAxis.x + p.z * vAxis.z;
      minU = Math.min(minU, u);
      maxU = Math.max(maxU, u);
      minV = Math.min(minV, v);
      maxV = Math.max(maxV, v);
    }
    return [minU, maxU, minV, maxV];
  };
  let [minU, maxU, minV, maxV] = extents(axis, side);
  let span = maxU - minU;
  let depth = maxV - minV;
  // l'asse deve essere quello lungo: su un quadrilatero quasi quadrato il
  // risultato non cambia, ma su un 6×18 non vogliamo il colmo di traverso
  if (depth > span) {
    const swapped = side;
    axis = swapped;
    side = { x: -swapped.z, z: swapped.x };
    [minU, maxU, minV, maxV] = extents(axis, side);
    span = maxU - minU;
    depth = maxV - minV;
  }
  if (span < 0.5 || depth < 0.5) return null;
  const midU = (minU + maxU) * 0.5;
  const midV = (minV + maxV) * 0.5;
  return {
    axis,
    side,
    center: { x: axis.x * midU + side.x * midV, z: axis.z * midU + side.z * midV },
    span,
    depth,
  };
}

function world(box: { axis: Pt; side: Pt; center: Pt }, u: number, v: number): Pt {
  return {
    x: box.center.x + box.axis.x * u + box.side.x * v,
    z: box.center.z + box.axis.z * u + box.side.z * v,
  };
}

/**
 * Piano del tetto: falde fra gronda e colmo più l'anello superiore.
 * `inset` è quanto il colmo rientra rispetto alla gronda (0.42 = 42%).
 */
export function planHipRoof(footprint: Pt[], baseY: number, ridgeRise: number, inset = 0.42): HipRoofPlan | null {
  if (footprint.length < 3 || ridgeRise <= 0) return null;
  if (polygonArea(footprint) < 4) return null;
  const ratio = Math.min(0.9, Math.max(0.05, inset));
  const ridgeY = baseY + ridgeRise;

  // quasi rettangolo: asse lungo, colmo diritto, due testate a padiglione
  if (footprint.length === 4) {
    const box = orientedBox(footprint);
    // il rettangolo orientato deve combaciare con l'impronta: su un trapezio
    // (o su un quadrilatero sghembo) gli angoli del box cadrebbero fuori dai
    // muri e il tetto sporgerebbe nel vuoto
    if (box && polygonArea(footprint) >= box.span * box.depth * 0.86) {
      const hipRun = box.depth * ratio;
      const ridgeHalf = Math.max(0, box.span * 0.5 - hipRun);
      const uMid = 0;
      const vMid = 0;
      const r1 = world(box, uMid - ridgeHalf, vMid);
      const r2 = world(box, uMid + ridgeHalf, vMid);
      const e00 = world(box, -box.span * 0.5, -box.depth * 0.5);
      const e10 = world(box, box.span * 0.5, -box.depth * 0.5);
      const e11 = world(box, box.span * 0.5, box.depth * 0.5);
      const e01 = world(box, -box.span * 0.5, box.depth * 0.5);

      const slope = (a: Pt, b: Pt, c: Pt, d: Pt, horizontal: number): RoofSlope => ({
        corners: [
          { x: a.x, y: baseY, z: a.z },
          { x: b.x, y: baseY, z: b.z },
          { x: c.x, y: ridgeY, z: c.z },
          { x: d.x, y: ridgeY, z: d.z },
        ],
        eaveLength: Math.max(0.01, Math.hypot(b.x - a.x, b.z - a.z)),
        slopeLength: Math.max(0.05, Math.hypot(horizontal, ridgeRise)),
      });

      const longRun = box.depth * 0.5;
      const slopes: RoofSlope[] = [
        slope(e00, e10, r2, r1, longRun),
        slope(e11, e01, r1, r2, longRun),
        slope(e01, e00, r1, r1, hipRun),
        slope(e10, e11, r2, r2, hipRun),
      ];
      const ridgeRing = ridgeHalf > 1e-3 ? [r1, r2] : [r1];
      return {
        slopes,
        ridgeRing,
        ridgeY,
        perimeter: 2 * (box.span + box.depth),
      };
    }
  }

  // ripiego: anello interno a distanza costante, non scalato dal baricentro
  const center = centroid(footprint);
  if (!pointInPolygon(center.x, center.z, footprint)) return null;
  const short = Math.max(
    1,
    Math.min(bboxExtent(footprint, 'x'), bboxExtent(footprint, 'z')),
  );
  const insetDistance = Math.min(3.5, Math.max(0.3, short * 0.5 * ratio));
  // su impronte strette l'offset a distanza costante collassa: si rientra
  // verso il baricentro, che almeno resta dentro l'impronta
  const shrink = Math.max(0.3, 1 - insetDistance / (short * 0.5));
  const inner =
    offsetPolygon(footprint, -insetDistance) ??
    footprint.map((p) => ({
      x: center.x + (p.x - center.x) * shrink,
      z: center.z + (p.z - center.z) * shrink,
    }));
  if (!inner || polygonArea(inner) < polygonArea(footprint) * 0.08) return null;
  const ridgeRing = inner;
  const slopes: RoofSlope[] = [];
  let perimeter = 0;
  for (let i = 0; i < footprint.length; i++) {
    const j = (i + 1) % footprint.length;
    const a = footprint[i]!;
    const b = footprint[j]!;
    const c = ridgeRing[j]!;
    const d = ridgeRing[i]!;
    const eaveLength = Math.hypot(b.x - a.x, b.z - a.z);
    if (eaveLength < 0.01) continue;
    const midX = (a.x + b.x) * 0.5;
    const midZ = (a.z + b.z) * 0.5;
    const ridgeMidX = (c.x + d.x) * 0.5;
    const ridgeMidZ = (c.z + d.z) * 0.5;
    perimeter += eaveLength;
    slopes.push({
      corners: [
        { x: a.x, y: baseY, z: a.z },
        { x: b.x, y: baseY, z: b.z },
        { x: c.x, y: ridgeY, z: c.z },
        { x: d.x, y: ridgeY, z: d.z },
      ],
      eaveLength,
      slopeLength: Math.max(
        0.05,
        Math.hypot(ridgeMidX - midX, ridgeMidZ - midZ, ridgeRise),
      ),
    });
  }
  if (slopes.length < 3) return null;
  return { slopes, ridgeRing, ridgeY, perimeter };
}

/**
 * Progettazione dei tetti a falde (hip roof) sopra un'impronta OSM.
 *
 * La geometria è pura e testabile: dato il poligono dell'edificio, si costruisce
 * un anello interno rimpicciolito verso il baricentro e alla quota del colmo, poi
 * si collegano i due anelli con falde inclinate. Per un rettangolo il risultato è
 * il classico tetto a padiglione dei paesi molisani; per le impronte irregolari
 * in cui il baricentro cade fuori dal poligono si restituisce null e il chiamante
 * ricade sul tetto piatto, evitando geometrie impossibili.
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

function centroid(points: Pt[]): Pt {
  let x = 0;
  let z = 0;
  for (const p of points) {
    x += p.x;
    z += p.z;
  }
  return { x: x / points.length, z: z / points.length };
}

/**
 * Piano del tetto: falde fra gronda e colmo più l'anello superiore.
 * `inset` è quanto il colmo rientra rispetto alla gronda (0.42 = 42%).
 */
export function planHipRoof(footprint: Pt[], baseY: number, ridgeRise: number, inset = 0.42): HipRoofPlan | null {
  if (footprint.length < 3 || ridgeRise <= 0) return null;
  const center = centroid(footprint);
  // baricentro fuori dall'impronta: meglio un tetto piatto che una falda storta
  if (!pointInPolygon(center.x, center.z, footprint)) return null;

  const innerScale = 1 - inset;
  const ridgeRing: Pt[] = footprint.map((p) => ({
    x: center.x + (p.x - center.x) * innerScale,
    z: center.z + (p.z - center.z) * innerScale,
  }));
  const ridgeY = baseY + ridgeRise;

  const slopes: RoofSlope[] = [];
  let perimeter = 0;
  for (let i = 0; i < footprint.length; i++) {
    const j = (i + 1) % footprint.length;
    const a = footprint[i];
    const b = footprint[j];
    const c = ridgeRing[j];
    const d = ridgeRing[i];
    const eaveLength = Math.hypot(b.x - a.x, b.z - a.z);
    const midX = (a.x + b.x) / 2;
    const midZ = (a.z + b.z) / 2;
    const ridgeMidX = (c.x + d.x) / 2;
    const ridgeMidZ = (c.z + d.z) / 2;
    const slopeLength = Math.hypot(ridgeMidX - midX, ridgeMidZ - midZ, ridgeRise);
    if (eaveLength < 0.01) continue;
    perimeter += eaveLength;
    slopes.push({
      corners: [
        { x: a.x, y: baseY, z: a.z },
        { x: b.x, y: baseY, z: b.z },
        { x: c.x, y: ridgeY, z: c.z },
        { x: d.x, y: ridgeY, z: d.z },
      ],
      eaveLength,
      slopeLength: Math.max(0.05, slopeLength),
    });
  }

  if (slopes.length < 3) return null;
  return { slopes, ridgeRing, ridgeY, perimeter };
}

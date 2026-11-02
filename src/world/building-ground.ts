/**
 * Quota di un edificio sul pendio: facciata, fondazione e piani.
 *
 * Il difetto da cui nasce questo modulo: la casa veniva estrusa dal punto più
 * basso dell'impronta, e **tutto** — portone, finestre, balcone, cornicione —
 * era misurato da lì. Su un pendio il lato strada sta uno o due metri più in
 * alto del lato valle: il piano terra finiva sotto la strada e il balcone del
 * primo piano si affacciava all'altezza del marciapiede ("case che partono dal
 * balcone").
 *
 * Qui la geometria si separa in due quote:
 *
 *  - **base**: il punto più basso meno 25 cm. È dove arriva il muro/fondazione,
 *    e serve a non lasciare il vuoto sul lato in discesa;
 *  - **groundFront**: la quota del terreno davanti alla facciata principale
 *    (quella verso strada). Da lì si contano portone, piani, finestre e balcone.
 *
 * Se il terreno a monte è più alto della facciata, il tetto sale quel tanto che
 * basta a lasciare almeno `minAboveUphill` metri di muro sopra il terreno:
 * altrimenti la copertura affonderebbe nel pendio.
 *
 * Tutto è puro: nessun Three.js, nessun DOM, si testa con una funzione quota.
 */

import type { Pt } from '../geo/geo';

export interface BuildingGrounding {
  /** fondo del muro (punto più basso − 0,25 m) */
  base: number;
  /** quota minima del terreno sul perimetro */
  groundMin: number;
  /** quota massima del terreno sul perimetro */
  groundMax: number;
  /** quota del terreno davanti alla facciata principale */
  groundFront: number;
  /** indice del lato che guarda la strada */
  frontEdge: number;
  /** sommità del muro (sotto la gronda) */
  topY: number;
  /** numero di piani sopra la strada */
  stories: number;
  /** altezza di un piano, misurata da groundFront */
  floorH: number;
  /** quota del primo balcone (null se la casa è a un piano) */
  balconyY: number | null;
  /** dislivello fra strada e punto più basso (per lo zoccolo) */
  foundation: number;
}

export interface GroundingOptions {
  /** indice del lato strada, se già noto */
  frontEdge?: number;
  /** altezze di piano: piano terra un filo più alto */
  floorHeight?: number;
  /** metri di muro che devono restare sopra il terreno a monte */
  minAboveUphill?: number;
}

function edgeMidpoint(a: Pt, b: Pt): Pt {
  return { x: (a.x + b.x) * 0.5, z: (a.z + b.z) * 0.5 };
}

/** Indice del lato più lungo: ripiego quando la strada non è nota. */
export function longestEdgeIndex(points: readonly Pt[]): number {
  let best = 0;
  let bestLength = -1;
  for (let i = 0; i < points.length; i++) {
    const a = points[i]!;
    const b = points[(i + 1) % points.length]!;
    const length = Math.hypot(b.x - a.x, b.z - a.z);
    if (length > bestLength) {
      bestLength = length;
      best = i;
    }
  }
  return best;
}

/**
 * Quota "davanti alla casa": media fra i due estremi del lato e il suo centro.
 * Il centro da solo può cadere su un gradino del DEM; tre campioni seguono
 * meglio il marciapiede reale, che è una linea.
 */
export function groundAtEdge(
  points: readonly Pt[],
  edge: number,
  heightAt: (x: number, z: number) => number,
): number {
  const a = points[edge]!;
  const b = points[(edge + 1) % points.length]!;
  const mid = edgeMidpoint(a, b);
  return (heightAt(a.x, a.z) + heightAt(b.x, b.z) + 2 * heightAt(mid.x, mid.z)) / 4;
}

/**
 * Calcola base, facciata, piani e balcone di un edificio.
 *
 * `height` è l'altezza stimata/dichiarata (metri). La facciata principale è
 * `frontEdge`; se manca si usa il lato più lungo, che nei dati OSM è quasi
 * sempre quello su strada.
 */
export function planBuildingGrounding(
  points: readonly Pt[],
  heightAt: (x: number, z: number) => number,
  height: number,
  options: GroundingOptions = {},
): BuildingGrounding {
  if (points.length < 3) throw new RangeError('impronta con meno di tre punti');
  if (!Number.isFinite(height) || height <= 0) throw new RangeError('altezza non valida');
  const floorHeight = Math.max(2.4, options.floorHeight ?? 3.05);
  const minAboveUphill = Math.max(1.6, options.minAboveUphill ?? 2.6);

  let groundMin = Infinity;
  let groundMax = -Infinity;
  for (const p of points) {
    const ground = heightAt(p.x, p.z);
    if (!Number.isFinite(ground)) continue;
    groundMin = Math.min(groundMin, ground);
    groundMax = Math.max(groundMax, ground);
  }
  if (!Number.isFinite(groundMin) || !Number.isFinite(groundMax)) {
    throw new RangeError('quote del terreno non finite');
  }

  const frontEdge =
    options.frontEdge !== undefined && options.frontEdge >= 0 && options.frontEdge < points.length
      ? options.frontEdge
      : longestEdgeIndex(points);
  const groundFront = groundAtEdge(points, frontEdge, heightAt);
  // il muro deve arrivare almeno a un piano sopra il terreno a monte, anche
  // quando la facciata è molto sotto il crinale
  const topY = Math.max(groundFront + height, groundMax + minAboveUphill);
  const stories = Math.max(1, Math.round((topY - groundFront) / floorHeight));
  const floorH = (topY - groundFront) / stories;
  const balconyY = stories >= 2 && floorH >= 2.6 ? groundFront + floorH : null;

  return {
    base: groundMin - 0.25,
    groundMin,
    groundMax,
    groundFront,
    frontEdge,
    topY,
    stories,
    floorH,
    balconyY,
    foundation: Math.max(0, groundFront - groundMin),
  };
}

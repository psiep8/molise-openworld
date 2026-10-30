import type { Pt } from '../geo/geo';
import { TERRAIN_MESH_STEP } from '../geo/terrain-surface';

/**
 * Il nastro stradale è una griglia di triangoli. Fra un vertice e l'altro è
 * piano, mentre il terreno ha le sue pieghe (le diagonali della mesh da 9,5 m)
 * e colline che una corda lunga taglia in pieno.
 *
 * Da qui nascono i due difetti visti in gioco: il prato che sbuca sopra
 * l'asfalto nei punti in cui la corda passa sotto la mesh, e la strada che
 * "buca" l'auto quando la corda passa sopra il terreno. La polilinea
 * semplificata di una provinciale dritta può essere lunga centinaia di metri:
 * due soli vertici non possono seguire il rilievo.
 *
 * Il nastro viene quindi ricampionato a metà della cella del terreno: dentro
 * un tratto così corto la superficie ha al massimo una piega, quindi la corda
 * non può scavalcare una collina. La larghezza è divisa in colonne per lo
 * stesso motivo: anche la diagonale della mesh non deve cadere in mezzo a una
 * fascia senza vertici.
 */

/** Passo massimo fra due stazioni lungo la strada (m). */
export const ROAD_SURFACE_MAX_STEP = TERRAIN_MESH_STEP / 2;
/**
 * Cella massima in larghezza (m). Sotto i 2 m la piega del terreno resta
 * nascosta dai ~20 cm di asfalto e dalle colonne vicine.
 */
export const ROAD_SURFACE_MAX_ACROSS = 1.8;

/** Colonne del nastro: abbastanza da non lasciare pieghe del terreno scoperte. */
export function roadRibbonColumns(width: number): number {
  if (!Number.isFinite(width) || width <= 0) {
    throw new RangeError(`Larghezza del nastro non valida: ${width}`);
  }
  return Math.max(2, Math.ceil(width / ROAD_SURFACE_MAX_ACROSS) + 1);
}

/**
 * Stazioni lungo la strada, a passo costante (i punti della polilinea restano
 * tutti: le curve non si tagliano).
 *
 * Un passo fisso, oltre a essere deterministico, tiene insieme tutti i nastri
 * della stessa strada: asfalto, spalla, ciglione e segnaletica ricadono sugli
 * stessi punti e non si aprono fessure fra una fascia e l'altra.
 */
export function roadRibbonStations(points: readonly Pt[], maxStep = ROAD_SURFACE_MAX_STEP): Pt[] {
  if (!Number.isFinite(maxStep) || maxStep <= 0) {
    throw new RangeError(`Passo del nastro non valido: ${maxStep}`);
  }
  if (points.length === 0) return [];
  const out: Pt[] = [{ x: points[0]!.x, z: points[0]!.z }];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const length = Math.hypot(dx, dz);
    if (length < 1e-4) continue;
    const pieces = Math.max(1, Math.ceil(length / maxStep));
    for (let k = 1; k <= pieces; k++) {
      out.push({ x: a.x + (dx * k) / pieces, z: a.z + (dz * k) / pieces });
    }
  }
  return out;
}

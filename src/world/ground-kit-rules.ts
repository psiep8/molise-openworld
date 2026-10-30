import { COVER_CROP, COVER_DRY, COVER_WOOD, type CoverClass } from './ground-mask';
import { pointInPolygon, type Bounds, type Pt } from '../geo/geo';

type GroundArea = { kind: string; points: Pt[]; bounds: Bounds };

/**
 * Aree dove una zolla di terra non ha senso: acqua, asfalto, cortili, cantieri.
 *
 * `residential` **non** è in elenco: il poligono dell'area residenziale copre
 * tutto il paese, quindi bastava quello per bloccare ogni cella e lasciare il
 * suolo del centro abitato al mosaico satellite. Le case sono già escluse una
 * per una dalle impronte degli edifici; i prati fra le case sono suolo vero.
 */
const NON_GROUND_AREAS = new Set([
  'water',
  'reservoir',
  'basin',
  'river',
  'lake',
  'sea',
  'industrial',
  'commercial',
  'retail',
  'parking',
  'farmyard',
  'construction',
  'railway',
]);

export type GroundKitSlug =
  | 'ground-bank-tile'
  | 'ground-field-tile'
  | 'ground-meadow-tile'
  | 'ground-mud'
  | 'ground-photo-small';

export interface GroundKitContext {
  cover: CoverClass;
  slopeDegrees: number;
  distanceToRoad: number;
  surface: string | null;
  /** Bagnato 0…1 dal meteo: decide la presenza di fango. */
  wetness?: number;
  /** Stable value in [0, 1); callers seed it from the world cell. */
  seed: number;
}

/** Avoid placing ground GLBs over mapped water and built/paved OSM areas. */
export function groundAreaBlocksKit(x: number, z: number, areas: readonly GroundArea[]): boolean {
  return areas.some(
    (area) =>
      NON_GROUND_AREAS.has(area.kind) &&
      x >= area.bounds.minX &&
      x <= area.bounds.maxX &&
      z >= area.bounds.minZ &&
      z <= area.bounds.maxZ &&
      pointInPolygon(x, z, area.points),
  );
}

/** Suolo nudo asciutto: coltivo se il dato lo dice, altrimenti prato. */
function dryGroundSlug(cover: CoverClass): GroundKitSlug {
  return cover === COVER_CROP || cover === COVER_DRY ? 'ground-field-tile' : 'ground-meadow-tile';
}

/** Classifies one deterministic ground-kit placement from georeferenced data. */
export function groundKitSlugAt(context: GroundKitContext): GroundKitSlug | null {
  const { cover, slopeDegrees, distanceToRoad, surface, seed } = context;
  const wetness = context.wetness ?? 0;
  if (
    !Number.isFinite(slopeDegrees) ||
    Number.isNaN(distanceToRoad) ||
    distanceToRoad === Number.NEGATIVE_INFINITY ||
    !Number.isFinite(seed) ||
    seed < 0 ||
    seed >= 1 ||
    !Number.isFinite(wetness) ||
    wetness < 0 ||
    wetness > 1
  ) {
    throw new RangeError('Dati non validi per la scelta della zolla');
  }
  if (distanceToRoad < 0 || slopeDegrees > 24) return null;

  // Roccia e scarpate vere sono le uniche superfici da zolla "bank": sul prato
  // in pendenza dolce (14-20°) la zolla di roccia sembrava un lastrone caduto
  // dal cielo. La soglia alta tiene la pietra dove il DEM la mostra davvero.
  if (surface === 'rock' || distanceToRoad <= 3.4 || slopeDegrees >= 20) {
    return 'ground-bank-tile';
  }
  // Il fango non è una tinta: con la pioggia la terra smossa diventa una pozza
  // di fango GLB. Senza pioggia la stessa cella resta terra/coltivo: prima
  // comparivano chiazze di fango asciutte anche a bagnato zero.
  if (surface === 'dirt') {
    if (wetness >= 0.35) {
      const mudChance = 0.2 + wetness * 0.7;
      if (seed > 1 - mudChance) return 'ground-mud';
    }
    return dryGroundSlug(cover);
  }
  if (wetness > 0.7 && cover !== COVER_WOOD && seed > 0.93) return 'ground-mud';
  if (cover === COVER_CROP || cover === COVER_DRY) return 'ground-field-tile';
  // Nel bosco il suolo è foglia e sottobosco, non roccia: la zolla da scarpata
  // resta fuori e la copertura resta continua.
  return 'ground-meadow-tile';
}

/** Differential tangent used to align a visual GLB tile to the DEM locally. */
export function terrainSlopeAt(
  heightAt: (x: number, z: number) => number,
  x: number,
  z: number,
  step = 2,
): { x: number; z: number; degrees: number } {
  if (!Number.isFinite(step) || step <= 0) throw new RangeError('Passo DEM non valido');
  const slopeX = (heightAt(x + step, z) - heightAt(x - step, z)) / (2 * step);
  const slopeZ = (heightAt(x, z + step) - heightAt(x, z - step)) / (2 * step);
  return {
    x: slopeX,
    z: slopeZ,
    degrees: (Math.atan(Math.hypot(slopeX, slopeZ)) * 180) / Math.PI,
  };
}

/** Grid-aligned world cells, nearest first, so instance caps cover the player. */
export function groundGridCells(
  x: number,
  z: number,
  radius: number,
  spacing: number,
): { x: number; z: number }[] {
  if (
    !Number.isFinite(x) ||
    !Number.isFinite(z) ||
    !Number.isFinite(radius) ||
    radius < 0 ||
    !Number.isFinite(spacing) ||
    spacing <= 0
  ) {
    throw new RangeError('Griglia di zolle non valida');
  }
  const cells: { x: number; z: number }[] = [];
  const startX = Math.ceil((x - radius) / spacing) * spacing;
  const startZ = Math.ceil((z - radius) / spacing) * spacing;
  for (let cellZ = startZ; cellZ <= z + radius; cellZ += spacing) {
    for (let cellX = startX; cellX <= x + radius; cellX += spacing) {
      if (Math.hypot(cellX - x, cellZ - z) <= radius) cells.push({ x: cellX, z: cellZ });
    }
  }
  cells.sort(
    (a, b) =>
      Math.hypot(a.x - x, a.z - z) - Math.hypot(b.x - x, b.z - z) ||
      a.z - b.z ||
      a.x - b.x,
  );
  return cells;
}

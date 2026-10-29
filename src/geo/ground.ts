import type { Heightfield } from './elevation';
import type { RoadIndex, RoadSurfaceSample } from './osm';

/**
 * Quota del piano calpestabile.
 *
 * Questa è l'unica porta d'ingresso alla quota del mondo: gioco, giocatore,
 * auto, pedoni, camera, oggetti di scena e meteo leggono tutti da qui. Prima
 * ognuno sommava `heights.heightAt` e `roads.surfaceOffset` per conto suo, e
 * bastava un ponte o un marciapiede nuovo perché le versioni divergessero.
 */
export interface GroundSample {
  /** quota assoluta in metri (Y di three.js) */
  y: number;
  /** differenza rispetto al DEM, comoda per il gradino del cordolo */
  lift: number;
  kind: 'terrain' | 'road' | 'shoulder' | 'sidewalk' | 'bridge' | 'tunnel';
  onRoad: boolean;
  paved: boolean;
  surface: string;
}

export interface GroundSampler {
  sampleAt(x: number, z: number): GroundSample;
  heightAt(x: number, z: number): number;
}

/** Priorità delle superfici, la stessa usata da `RoadIndex.sampleSurface`. */
function surfaceRank(kind: RoadSurfaceSample['kind']): number {
  if (kind === 'bridge') return 5;
  if (kind === 'tunnel') return 4;
  if (kind === 'road') return 3;
  if (kind === 'sidewalk') return 2;
  return 1;
}

export class WorldGround implements GroundSampler {
  /**
   * `roads` è un array vivo: lo streamer geografico aggiunge e toglie i propri
   * indici mentre i tile entrano ed escono dal raggio, senza ricostruire il
   * terreno né il giocatore.
   */
  readonly roads: readonly RoadIndex[];
  /**
   * Classificazione del terreno fuori strada (terra, erba, roccia). Il
   * landcover viene caricato dopo il terreno, quindi si collega a posteriori:
   * finché manca il campionatore resta il vecchio `terrain`.
   */
  private surfaceAt: ((x: number, z: number) => string | null) | null = null;

  constructor(
    readonly heights: Heightfield,
    roads: RoadIndex | readonly RoadIndex[],
  ) {
    this.roads = Array.isArray(roads) ? roads : [roads as RoadIndex];
  }

  /** Collega la mappa di copertura del suolo alla fisica fuori strada. */
  setSurfaceProvider(provider: ((x: number, z: number) => string | null) | null): void {
    this.surfaceAt = provider;
  }

  sampleAt(x: number, z: number): GroundSample {
    const terrain = this.heights.heightAt(x, z);
    let best: RoadSurfaceSample | null = null;
    let bestRank = -1;
    let bestY = -Infinity;
    for (const index of this.roads) {
      const road = index.sampleSurface(x, z, terrain);
      if (!road) continue;
      const rank = surfaceRank(road.kind);
      if (rank > bestRank || (rank === bestRank && road.y > bestY + 0.001)) {
        best = road;
        bestRank = rank;
        bestY = road.y;
      }
    }
    if (best) {
      return {
        y: best.y,
        lift: best.lift,
        kind: best.kind,
        onRoad: best.kind === 'road' || best.kind === 'bridge' || best.kind === 'tunnel',
        paved: best.paved,
        surface: best.surface,
      };
    }
    return {
      y: terrain,
      lift: 0,
      kind: 'terrain',
      onRoad: false,
      paved: false,
      surface: this.surfaceAt?.(x, z) ?? 'terrain',
    };
  }

  heightAt(x: number, z: number): number {
    return this.sampleAt(x, z).y;
  }
}

/** Adattatore per i sistemi che accettano una semplice funzione. */
export function groundFunction(ground: GroundSampler): (x: number, z: number) => number {
  return (x, z) => ground.heightAt(x, z);
}

export function liftOf(sample: GroundSample | RoadSurfaceSample): number {
  return sample.lift;
}

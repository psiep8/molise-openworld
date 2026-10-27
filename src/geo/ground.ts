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

export class WorldGround implements GroundSampler {
  constructor(
    readonly heights: Heightfield,
    readonly roads: RoadIndex,
  ) {}

  sampleAt(x: number, z: number): GroundSample {
    const terrain = this.heights.heightAt(x, z);
    const road = this.roads.sampleSurface(x, z, terrain);
    if (road) {
      return {
        y: road.y,
        lift: road.lift,
        kind: road.kind,
        onRoad: road.kind === 'road' || road.kind === 'bridge' || road.kind === 'tunnel',
        paved: road.paved,
        surface: road.surface,
      };
    }
    return { y: terrain, lift: 0, kind: 'terrain', onRoad: false, paved: false, surface: 'terrain' };
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

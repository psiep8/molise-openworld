import { describe, expect, it } from 'vitest';
import { boundsOf, type Pt } from '../src/geo/geo';
import type { Heightfield } from '../src/geo/elevation';
import { BuildingIndex, type Building, type RoadIndex } from '../src/geo/osm';
import { findChurchSpot } from '../src/world/church';

const flat = {
  heightAt: () => 0,
  slopeAt: () => 0,
} as unknown as Heightfield;

const noRoads = { isOnRoad: () => false } as unknown as RoadIndex;
const allRoads = { isOnRoad: () => true } as unknown as RoadIndex;

function building(x: number, z: number, half: number): Building {
  const points: Pt[] = [
    { x: x - half, z: z - half },
    { x: x + half, z: z - half },
    { x: x + half, z: z + half },
    { x: x - half, z: z + half },
  ];
  return { height: 20, points, bounds: boundsOf(points), area: half * half * 4 };
}

describe('chiesa di paese', () => {
  it('senza ostacoli si mette sul primo anello attorno al centro', () => {
    const origin = { x: 0, z: 0 };
    const spot = findChurchSpot(origin, noRoads, new BuildingIndex([]), flat);
    expect(spot).not.toBeNull();
    const dist = Math.hypot(spot!.x, spot!.z);
    expect(dist).toBeCloseTo(34, 3);
    // la facciata guarda il centro del paese: la direzione locale +z, ruotata,
    // deve puntare verso l'origine
    expect(Math.cos(spot!.yaw)).toBeCloseTo(-spot!.z / dist, 5);
    expect(Math.sin(spot!.yaw)).toBeCloseTo(-spot!.x / dist, 5);
  });

  it('non si pianta sopra una casa, nemmeno se occupa tutti gli anelli', () => {
    const index = new BuildingIndex([building(0, 0, 400)]);
    expect(findChurchSpot({ x: 0, z: 0 }, noRoads, index, flat)).toBeNull();
  });

  it('non si pianta in mezzo alla strada', () => {
    expect(findChurchSpot({ x: 0, z: 0 }, allRoads, new BuildingIndex([]), flat)).toBeNull();
  });

  it('tollera un pendio dolce ma non uno scosceso', () => {
    const steep = {
      heightAt: () => 0,
      slopeAt: () => 40,
    } as unknown as Heightfield;
    expect(findChurchSpot({ x: 0, z: 0 }, noRoads, new BuildingIndex([]), steep)).toBeNull();
  });
});

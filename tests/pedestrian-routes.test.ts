import { describe, expect, it } from 'vitest';
import type { BuildingIndex } from '../src/geo/osm';
import type { Pt } from '../src/geo/geo';
import { makeRoute } from '../src/world/pedestrians';

/** Strada dritta lungo z, larghezza 8 m: il bordo asfalto sta a x = 4. */
const road: Pt[] = [
  { x: 0, z: 0 },
  { x: 0, z: 20 },
  { x: 0, z: 40 },
  { x: 0, z: 60 },
];

function fakeBuildings(blocked: (x: number, z: number) => boolean): BuildingIndex {
  return {
    resolveCircle(x: number, z: number, radius: number) {
      if (!blocked(x, z)) return { x, z, hit: false };
      return { x: x + radius + 0.01, z, hit: true };
    },
  } as unknown as BuildingIndex;
}

describe('rotte dei pedoni dentro i vicoli', () => {
  it('senza edifici il percorso sta sul marciapiede', () => {
    const route = makeRoute(road, 1, 5.15)!;
    expect(route).not.toBeNull();
    for (const p of route.points) expect(p.x).toBeCloseTo(-5.15, 6);
  });

  it('se il muro occupa il marciapiede il percorso si riavvicina alla strada', () => {
    // muro fra x = -6 e x = -4: i primi tre candidati cadono dentro
    const buildings = fakeBuildings((x) => x < -4 && x > -6);
    const route = makeRoute(road, 1, 5.15, buildings)!;
    expect(route).not.toBeNull();
    for (const p of route.points) {
      expect(buildings.resolveCircle(p.x, p.z, 0.35).hit).toBe(false);
      expect(Math.abs(p.x)).toBeLessThan(4);
    }
  });

  it('se il vicolo è cieco la rotta si scarta, non attraversa la casa', () => {
    const buildings = fakeBuildings(() => true);
    expect(makeRoute(road, 1, 5.15, buildings)).toBeNull();
  });
});

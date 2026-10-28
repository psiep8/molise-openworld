import { describe, expect, it } from 'vitest';
import { Heightfield, type HeightMeta } from '../src/geo/elevation';
import { WorldGround } from '../src/geo/ground';
import {
  BRIDGE_CLEARANCE,
  prepareRoadElevations,
  RoadIndex,
  ROAD_LIFT,
  type Road,
} from '../src/geo/osm';

function flatHeights(elevation = 100): Heightfield {
  const meta: HeightMeta = {
    source: 'test',
    license: 'test',
    attribution: 'test',
    encoding: 'decimetri',
    step: 5,
    nx: 81,
    nz: 41,
    originX: -200,
    originZ: -100,
    lat: 41.87,
    lon: 14.77,
    metersPerDegLat: 111000,
    metersPerDegLon: 83000,
    minElevation: elevation,
    maxElevation: elevation,
    generatedAt: '2026-01-01T00:00:00.000Z',
  };
  return new Heightfield(meta, new Int16Array(meta.nx * meta.nz).fill(elevation * 10));
}

function road(overrides: Partial<Road> = {}): Road {
  return {
    type: 'secondary',
    name: 'Test',
    width: 6,
    paved: true,
    surface: 'asphalt',
    points: [
      { x: -60, z: 0 },
      { x: 0, z: 0 },
      { x: 60, z: 0 },
    ],
    bounds: { minX: -60, maxX: 60, minZ: 0, maxZ: 0 },
    ...overrides,
  };
}

describe('groundAt condivisa', () => {
  it('sulla strada normale restituisce DEM + lift, non il solo DEM', () => {
    const heights = flatHeights();
    const asphalt = road();
    prepareRoadElevations([asphalt], heights);
    const ground = new WorldGround(heights, new RoadIndex([asphalt], heights));
    const sample = ground.sampleAt(0, 0);
    expect(sample.kind).toBe('road');
    expect(sample.onRoad).toBe(true);
    expect(sample.y).toBeCloseTo(100 + ROAD_LIFT, 5);
  });

  it('su un ponte usa la quota dell’impalcato e non il fondovalle', () => {
    const heights = flatHeights(100);
    // Il terreno sotto il ponte scende a 80 m: se groundAt leggesse il DEM
    // l'auto finirebbe nel fiume pur camminando sull'asfalto visibile.
    const bridge = road({ bridge: true, points: [{ x: -60, z: 0 }, { x: 60, z: 0 }] });
    prepareRoadElevations([bridge], heights);
    const ground = new WorldGround(heights, new RoadIndex([bridge], heights));
    const sample = ground.sampleAt(0, 0);
    expect(sample.kind).toBe('bridge');
    expect(sample.y).toBeCloseTo(100 + BRIDGE_CLEARANCE + ROAD_LIFT, 4);
    expect(sample.lift).toBeGreaterThan(BRIDGE_CLEARANCE);
  });

  it('un tunnel taggato mantiene una quota continua e distinta dal DEM interno', () => {
    const heights = flatHeights(100);
    const tunnel = road({ tunnel: true, points: [{ x: -60, z: 0 }, { x: 60, z: 0 }] });
    prepareRoadElevations([tunnel], heights);
    expect(tunnel.elevations).toHaveLength(2);
    const ground = new WorldGround(heights, new RoadIndex([tunnel], heights));
    const sample = ground.sampleAt(0, 0);
    expect(sample.kind).toBe('tunnel');
    expect(sample.y).toBeCloseTo(100 + ROAD_LIFT, 4);
  });

  it('fuori strada torna il terreno, senza offset fantasma', () => {
    const heights = flatHeights();
    const asphalt = road();
    const ground = new WorldGround(heights, new RoadIndex([asphalt], heights));
    const sample = ground.sampleAt(0, 40);
    expect(sample.kind).toBe('terrain');
    expect(sample.onRoad).toBe(false);
    expect(sample.y).toBeCloseTo(100, 5);
    expect(sample.lift).toBe(0);
  });

  it('marciapiede e spalla hanno quote distinte e coerenti con il cordolo', () => {
    const heights = flatHeights();
    const asphalt = road();
    const ground = new WorldGround(heights, new RoadIndex([asphalt], heights));
    // La strada corre lungo x: la larghezza si misura lungo z.
    const walk = ground.sampleAt(0, 3.5);
    const shoulder = ground.sampleAt(0, 40);
    expect(walk.kind).toBe('sidewalk');
    expect(walk.y).toBeGreaterThan(100 + ROAD_LIFT);
    expect(shoulder.kind).toBe('terrain');
  });

  it('con più indici stradali vince la superficie a priorità più alta', () => {
    const heights = flatHeights(100);
    const asphalt = road();
    const streamed = road({
      bridge: true,
      points: [{ x: -60, z: 0 }, { x: 60, z: 0 }],
    });
    prepareRoadElevations([asphalt, streamed], heights);
    const local = new RoadIndex([asphalt], heights);
    const remote = new RoadIndex([streamed], heights);
    const ground = new WorldGround(heights, [local, remote]);
    // Il ponte streamed insiste sullo stesso punto dell'asfalto locale: la
    // carreggiata sospesa deve vincere, altrimenti l'auto affonderebbe.
    const sample = ground.sampleAt(0, 0);
    expect(sample.kind).toBe('bridge');
    expect(sample.y).toBeCloseTo(100 + BRIDGE_CLEARANCE + ROAD_LIFT, 4);
  });

  it('accetta un array vivo: aggiungere un indice cambia subito la quota', () => {
    const heights = flatHeights(100);
    const asphalt = road();
    prepareRoadElevations([asphalt], heights);
    const indexes: RoadIndex[] = [];
    const ground = new WorldGround(heights, indexes);
    expect(ground.sampleAt(0, 0).kind).toBe('terrain');
    indexes.push(new RoadIndex([asphalt], heights));
    expect(ground.sampleAt(0, 0).kind).toBe('road');
  });
});

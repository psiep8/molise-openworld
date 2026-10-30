import { describe, expect, it } from 'vitest';
import { Heightfield, type HeightMeta } from '../src/geo/elevation';
import { WorldGround } from '../src/geo/ground';
import { terrainMeshHeightAt } from '../src/geo/terrain-surface';
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

/** DEM con dossi veri: serve a distinguere la mesh del terreno dal bilineare. */
function bumpyHeights(): Heightfield {
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
    minElevation: 0,
    maxElevation: 500,
    generatedAt: '2026-01-01T00:00:00.000Z',
  };
  const data = new Int16Array(meta.nx * meta.nz);
  for (let j = 0; j < meta.nz; j++) {
    for (let i = 0; i < meta.nx; i++) {
      const x = meta.originX + i * meta.step;
      const z = meta.originZ + j * meta.step;
      data[j * meta.nx + i] = Math.round((100 + 4 * Math.sin(x / 13) + 3 * Math.cos(z / 11)) * 10);
    }
  }
  return new Heightfield(meta, data);
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

  it('la quota fisica segue la spalla e rientra sul DEM senza gradino', () => {
    const heights = flatHeights();
    const rural = road({ walkSpans: [false, false, false] });
    const ground = new WorldGround(heights, new RoadIndex([rural], heights));
    // spalla di ghiaia (fino a 3,35 m), poi una falda dolce di 1,4 m
    const shoulder = ground.sampleAt(0, 3.3);
    const slope = ground.sampleAt(0, 4.05);
    const outerEdge = ground.sampleAt(0, 4.74);
    const beyond = ground.sampleAt(0, 4.78);
    expect(shoulder.kind).toBe('shoulder');
    expect(shoulder.y).toBeCloseTo(100 + ROAD_LIFT - 0.03, 5);
    expect(slope.kind).toBe('shoulder');
    // il ciglione scende verso il prato: non è una cunetta a parete
    expect(slope.y).toBeLessThan(shoulder.y);
    expect(slope.y).toBeGreaterThan(100);
    expect(outerEdge.kind).toBe('shoulder');
    expect(outerEdge.y).toBeCloseTo(100, 2);
    expect(beyond.kind).toBe('terrain');
    expect(Math.abs(beyond.y - outerEdge.y)).toBeLessThanOrEqual(0.02);
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

  it('fuori strada espone la superficie del landcover quando è collegato', () => {
    const heights = flatHeights();
    const asphalt = road();
    const ground = new WorldGround(heights, new RoadIndex([asphalt], heights));
    expect(ground.sampleAt(0, 40).surface).toBe('terrain');
    ground.setSurfaceProvider((x) => (x < 0 ? 'dirt' : 'grass'));
    expect(ground.sampleAt(-10, 40).surface).toBe('dirt');
    expect(ground.sampleAt(10, 40).surface).toBe('grass');
    // il landcover non deve sovrascrivere l'asfalto
    expect(ground.sampleAt(0, 0).surface).not.toBe('grass');
  });

  it('la quota calpestabile è quella della mesh del terreno, non il DEM bilineare', () => {
    const heights = bumpyHeights();
    const asphalt = road();
    prepareRoadElevations([asphalt], heights);
    const ground = new WorldGround(heights, new RoadIndex([asphalt], heights));

    // un punto dove le due superfici sono davvero diverse, altrimenti il test
    // non dimostrerebbe niente
    let x = 0;
    for (let candidate = -55; candidate <= 55; candidate += 0.5) {
      if (Math.abs(terrainMeshHeightAt(heights, candidate, 0) - heights.heightAt(candidate, 0)) > 0.05) {
        x = candidate;
        break;
      }
    }
    const mesh = terrainMeshHeightAt(heights, x, 0);
    expect(Math.abs(mesh - heights.heightAt(x, 0))).toBeGreaterThan(0.05);

    const onRoad = ground.sampleAt(x, 0);
    expect(onRoad.kind).toBe('road');
    expect(onRoad.y).toBeCloseTo(mesh + ROAD_LIFT, 5);

    // fuori strada la stessa superficie, senza il lift dell'asfalto
    const offRoad = ground.sampleAt(x, 40);
    expect(offRoad.kind).toBe('terrain');
    expect(offRoad.y).toBeCloseTo(terrainMeshHeightAt(heights, x, 40), 5);
    expect(offRoad.y).toBe(terrainMeshHeightAt(heights, x, 40));
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

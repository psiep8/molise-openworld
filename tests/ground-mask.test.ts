import { describe, expect, it } from 'vitest';
import { Heightfield, type HeightMeta } from '../src/geo/elevation';
import { BuildingIndex, RoadIndex, roadSurface, roadWidth, type Building, type Road } from '../src/geo/osm';
import { GroundMask } from '../src/world/ground-mask';

const meta: HeightMeta = {
  source: 'test',
  license: 'test',
  attribution: 'test',
  encoding: 'int16-le, decimetri',
  step: 10,
  nx: 21,
  nz: 21,
  originX: -100,
  originZ: -100,
  lat: 41.87,
  lon: 14.775,
  metersPerDegLat: 111145,
  metersPerDegLon: 83014,
  minElevation: 0,
  maxElevation: 200,
  generatedAt: 'test',
};

function flat(): Heightfield {
  return new Heightfield(meta, new Int16Array(meta.nx * meta.nz));
}

/** Rampa al 100% (45°): ogni 10 m di x sale di 10 m. */
function ramp(): Heightfield {
  const data = new Int16Array(meta.nx * meta.nz);
  for (let j = 0; j < meta.nz; j++) {
    for (let i = 0; i < meta.nx; i++) data[j * meta.nx + i] = i * 100;
  }
  return new Heightfield(meta, data);
}

function road(type: string, points: { x: number; z: number }[]): Road {
  return {
    type,
    name: '',
    width: roadWidth(type),
    paved: roadSurface(type) === 'asphalt',
    points,
    bounds: {
      minX: Math.min(...points.map((p) => p.x)),
      maxX: Math.max(...points.map((p) => p.x)),
      minZ: Math.min(...points.map((p) => p.z)),
      maxZ: Math.max(...points.map((p) => p.z)),
    },
  };
}

function building(x: number, z: number, size = 10): Building {
  return {
    height: 6,
    points: [
      { x, z },
      { x: x + size, z },
      { x: x + size, z: z + size },
      { x, z: z + size },
    ],
    bounds: { minX: x, maxX: x + size, minZ: z, maxZ: z + size },
    area: size * size,
  };
}

const roads = new RoadIndex([
  road('residential', [
    { x: -50, z: 0 },
    { x: 50, z: 0 },
  ]),
]);
const buildings = new BuildingIndex([building(20, 20)]);

describe('GroundMask', () => {
  it('blocca strada ed edificio e lascia libero il prato', () => {
    const mask = new GroundMask(40);
    mask.build(0, 0, flat(), roads, buildings, 2.7, 0.5);
    // cella (80,80) = centro (0,25; 0,25): sulla carreggiata
    expect(mask.isBlocked(80, 80)).toBe(true);
    // (80,100) = (0,25; 10,25): a 10 m dalla strada, fuori dall'edificio
    expect(mask.isBlocked(80, 100)).toBe(false);
    // (130,130) = (25,25; 25,25): dentro l'edificio
    expect(mask.isBlocked(130, 130)).toBe(true);
  });

  it('conserva la distanza dal ciglio per l\'erba corta di bordo', () => {
    const mask = new GroundMask(40);
    mask.build(0, 0, flat(), roads, buildings, 2.7, 0.5);
    // centro cella a z = 3,25: 0,65 m oltre il ciglio (2,6)
    expect(mask.roadDistance(80, 86)).toBeCloseTo(0.65, 2);
    // lontano: satura
    expect(mask.roadDistance(80, 100)).toBeGreaterThan(6.3);
  });

  it('blocca i pendii oltre 30°', () => {
    const mask = new GroundMask(40);
    mask.build(0, 0, ramp(), roads, buildings, -1000, -1000);
    expect(mask.isBlocked(80, 80)).toBe(true);
  });

  it('interpola la quota dalla griglia interna', () => {
    const mask = new GroundMask(40);
    mask.build(0, 0, flat(), roads, buildings, 2.7, 0.5);
    expect(mask.heightAt(0, 0)).toBeCloseTo(0, 5);
    expect(mask.heightAt(12.3, -7.1)).toBeCloseTo(0, 5);
  });
});

import { describe, expect, it } from 'vitest';
import { BuildingIndex, RoadIndex, roadSurface, roadWidth, type Building, type Road } from '../src/geo/osm';

function building(x: number, z: number, size = 10, height = 6): Building {
  const points = [
    { x, z },
    { x: x + size, z },
    { x: x + size, z: z + size },
    { x, z: z + size },
  ];
  return {
    height,
    points,
    bounds: { minX: x, maxX: x + size, minZ: z, maxZ: z + size },
    area: size * size,
  };
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

describe('indice edifici', () => {
  it('spinge un cerchio fuori da un edificio e riporta la collisione', () => {
    const index = new BuildingIndex([building(0, 0)]);
    const res = index.resolveCircle(5, 5, 0.5);
    expect(res.hit).toBe(true);
    const outside =
      res.x <= -0.4 || res.x >= 10.4 || res.z <= -0.4 || res.z >= 10.4;
    expect(outside).toBe(true);
  });

  it('non tocca chi è lontano', () => {
    const index = new BuildingIndex([building(0, 0)]);
    const res = index.resolveCircle(100, 100, 0.5);
    expect(res.hit).toBe(false);
    expect(res.x).toBe(100);
    expect(res.z).toBe(100);
  });

  it('risolve anche il bordo esterno a distanza minore del raggio', () => {
    const index = new BuildingIndex([building(0, 0)]);
    const res = index.resolveCircle(10.3, 5, 0.6);
    expect(res.hit).toBe(true);
    expect(res.x).toBeGreaterThanOrEqual(10.55);
  });
});

describe('indice strade', () => {
  const index = new RoadIndex([
    road('residential', [
      { x: -50, z: 0 },
      { x: 50, z: 0 },
    ]),
    road('track', [
      { x: 0, z: -50 },
      { x: 0, z: 50 },
    ]),
  ]);

  it('riconosce di essere su strada asfaltata', () => {
    expect(index.isOnRoad(0, 0)).toBe(true);
    expect(index.isOnRoad(0, 1.8)).toBe(true);
  });

  it('riconosce lo sterrato e il fuori strada', () => {
    expect(index.isOnRoad(0, 30, 0.2)).toBe(true);
    expect(index.isOnRoad(40, 40, 0.2)).toBe(false);
  });

  it('trova la strada asfaltata più vicina', () => {
    const near = index.nearest(20, 10);
    expect(near).not.toBeNull();
    expect(near?.road.type).toBe('residential');
    expect(Math.abs(near!.z)).toBeLessThan(0.001);
  });
});

describe('larghezze e superfici', () => {
  it('distingue asfalto e sterrato', () => {
    expect(roadSurface('primary')).toBe('asphalt');
    expect(roadSurface('track')).toBe('dirt');
    expect(roadWidth('primary')).toBeGreaterThan(roadWidth('track'));
    expect(roadWidth('tipo-inventato')).toBe(4.5);
  });
});

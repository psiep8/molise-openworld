import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { Heightfield } from '../src/geo/elevation';
import type { OsmData, Road, RoadIndex } from '../src/geo/osm';
import { buildRoadsideKit } from '../src/world/roadside-kit';
import { WorldKit, type WorldAsset, type WorldRole } from '../src/world/worldkit';

function asset(slug: string, role: WorldRole, size: [number, number, number]): WorldAsset {
  const geometry = new THREE.BoxGeometry(size[0], size[1], size[2]);
  return {
    slug,
    role,
    name: slug,
    size: new THREE.Vector3(...size),
    triangles: 40,
    parts: [{ name: slug, geometry, material: new THREE.MeshStandardMaterial(), castShadow: false }],
  };
}

/** Varianti volutamente molto diverse: è il caso che apriva i buchi. */
function roadsideKit(): WorldKit {
  return new WorldKit([
    asset('sidewalk-a', 'sidewalk', [2, 0.1, 1.15]),
    asset('sidewalk-b', 'sidewalk', [1.15, 0.1, 2]),
    asset('curb', 'curb', [0.22, 0.18, 5.43]),
  ]);
}

function heights(fn: (x: number, z: number) => number): Heightfield {
  return {
    heightAt: (x: number, z: number) => fn(x, z),
    slopeAt: (x: number, z: number) => {
      const e = 0.5;
      const dx = (fn(x + e, z) - fn(x - e, z)) / (2 * e);
      const dz = (fn(x, z + e) - fn(x, z - e)) / (2 * e);
      return (Math.atan(Math.hypot(dx, dz)) * 180) / Math.PI;
    },
  } as unknown as Heightfield;
}

/** Strada dritta lungo z, 400 m, tutti i nodi con marciapiede. */
function townRoad(): OsmData {
  const points = [];
  for (let i = 0; i <= 20; i++) points.push({ x: 0, z: i * 20 });
  const road = {
    type: 'secondary',
    name: 'Via di prova',
    width: 6,
    paved: true,
    surface: 'asphalt',
    points,
    walkSpans: new Array(points.length).fill(true),
    bounds: { minX: 0, maxX: 0, minZ: 0, maxZ: 400 },
  } as unknown as Road;
  return { roads: [road] } as unknown as OsmData;
}

/** Indice finto: serve solo `isOnRoad` per gli incroci. */
function roadIndex(crossAtZ: number | null = null): RoadIndex {
  return {
    isOnRoad: (x: number, z: number, tolerance = 0) => {
      if (Math.abs(x) > 14) return false;
      if (crossAtZ === null) return false;
      return Math.abs(z - crossAtZ) <= 2.4 + tolerance;
    },
  } as unknown as RoadIndex;
}

describe('buildRoadsideKit', () => {
  it('accosta le varianti di lunghezza diversa senza buchi', () => {
    const result = buildRoadsideKit(
      townRoad(),
      heights(() => 50),
      roadIndex(),
      roadsideKit(),
      300,
    );
    expect(result.sidewalks).toBeGreaterThan(20);
    expect(result.diagnostics.gaps).toBe(0);
    expect(result.diagnostics.quoteErrors).toBe(0);
    expect(result.diagnostics.overlaps).toBe(0);
  });

  it('inclina i moduli sul piano della strada, non con un pitch per asse', () => {
    // 5% in salita lungo +z: il piano vale slopeZ = 0,05, slopeX = 0
    const result = buildRoadsideKit(
      townRoad(),
      heights((_x, z) => 50 + z * 0.05),
      roadIndex(),
      roadsideKit(),
      120,
    );
    expect(result.spots.sidewalks.length).toBeGreaterThan(6);
    for (const spot of result.spots.sidewalks) {
      expect(spot.pitch).toBeUndefined();
      expect(spot.slopeZ).toBeCloseTo(0.05, 2);
      expect(spot.slopeX).toBeCloseTo(0, 2);
    }
  });

  it('resta continuo su una strada parallela a X in salita (nessun buco)', () => {
    const road = townRoad();
    const points = road.roads[0]!.points.map((_p, i) => ({ x: i * 20, z: 0 }));
    road.roads[0]!.points = points;
    road.roads[0]!.walkSpans = new Array(points.length).fill(true);
    const result = buildRoadsideKit(
      road,
      heights((x) => 50 + x * 0.08),
      roadIndex(),
      roadsideKit(),
      400,
    );
    expect(result.spots.sidewalks.length).toBeGreaterThan(20);
    expect(result.diagnostics.gaps).toBe(0);
    expect(result.diagnostics.skipped).toBe(0);
    for (const spot of result.spots.sidewalks) {
      expect(spot.slopeX).toBeCloseTo(0.08, 2);
      expect(spot.slopeZ).toBeCloseTo(0, 2);
    }
  });

  it.each([
    ['X', 1, 0],
    ['Z', 0, 1],
    ['diagonale', Math.SQRT1_2, Math.SQRT1_2],
  ])('resta continuo in salita lungo %s con lo stesso piano', (_label, dx, dz) => {
    const road = townRoad();
    const points = road.roads[0]!.points.map((_p, i) => ({ x: i * 20 * dx, z: i * 20 * dz }));
    road.roads[0]!.points = points;
    road.roads[0]!.walkSpans = new Array(points.length).fill(true);
    const grade = 0.08;
    const result = buildRoadsideKit(
      road,
      heights((x, z) => 50 + (x * dx + z * dz) * grade),
      roadIndex(),
      roadsideKit(),
      400,
    );
    expect(result.spots.sidewalks.length).toBeGreaterThan(20);
    expect(result.diagnostics.gaps).toBe(0);
    expect(result.diagnostics.skipped).toBe(0);
    for (const spot of result.spots.sidewalks) {
      expect(spot.slopeX).toBeCloseTo(grade * dx, 2);
      expect(spot.slopeZ).toBeCloseTo(grade * dz, 2);
    }
  });

  it('non salta le campate ripide e usa una sola variante per via', () => {
    const result = buildRoadsideKit(
      townRoad(),
      heights((_x, z) => 50 + z * 0.15),
      roadIndex(),
      roadsideKit(),
      200,
    );
    expect(result.spots.sidewalks.length).toBeGreaterThan(10);
    expect(result.diagnostics.skipped).toBe(0);
    expect(result.diagnostics.gaps).toBe(0);
    expect(new Set(result.spots.sidewalks.map((s) => s.variant)).size).toBe(1);
  });

  it('non fa attraversare le lastre sopra un incrocio', () => {
    const result = buildRoadsideKit(
      townRoad(),
      heights(() => 50),
      roadIndex(100),
      roadsideKit(),
      300,
    );
    expect(result.diagnostics.junctionSkips).toBeGreaterThan(0);
    for (const spot of result.spots.sidewalks) {
      expect(Math.abs(spot.z - 100)).toBeGreaterThan(2.4);
    }
  });

  it('rispetta il budget per preset', () => {
    const result = buildRoadsideKit(
      townRoad(),
      heights(() => 50),
      roadIndex(),
      roadsideKit(),
      20,
    );
    expect(result.sidewalks + result.curbs).toBeLessThanOrEqual(20);
    expect(result.diagnostics.modules).toBe(result.sidewalks + result.curbs);
  });
});

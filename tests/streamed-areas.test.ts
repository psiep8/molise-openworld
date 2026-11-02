import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { latLonToWorld } from '../src/config';
import type { Heightfield } from '../src/geo/elevation';
import type { WorldDataTile } from '../src/geo/world-tiles';
import { buildStreamedAreas } from '../src/world/streamed-areas';

const CENTER = { lat: 41.8905, lon: 14.7854 };
const RING = [
  { lat: CENTER.lat - 0.0003, lon: CENTER.lon - 0.0004 },
  { lat: CENTER.lat - 0.0003, lon: CENTER.lon + 0.0004 },
  { lat: CENTER.lat + 0.0003, lon: CENTER.lon + 0.0004 },
  { lat: CENTER.lat + 0.0003, lon: CENTER.lon - 0.0004 },
];

function tile(): WorldDataTile {
  return {
    schemaVersion: 2,
    tile: { z: 14, x: 8865, y: 6089 },
    attribution: '© OpenStreetMap contributors (ODbL)',
    roads: [],
    buildings: [],
    areas: [{ id: 'way/1', kind: 'water', points: RING }],
    landcover: [{ id: 'way/2', kind: 'wood', points: RING }],
    pois: [{ id: 'node/7', kind: 'cafe', lat: CENTER.lat, lon: CENTER.lon }],
  };
}

function heights(value = 100): Heightfield {
  return {
    heightAt: () => value,
    bounds: { minX: -1e7, maxX: 1e7, minZ: -1e7, maxZ: 1e7 },
  } as unknown as Heightfield;
}

const remote = { minX: 1e6, maxX: 1e6 + 100, minZ: 1e6, maxZ: 1e6 + 100 };

describe('buildStreamedAreas', () => {
  it('drappeggia landcover e acqua sul terreno e conta i POI', () => {
    const result = buildStreamedAreas(tile(), heights(100), remote);
    expect(result.stats.landcover).toBe(1);
    expect(result.stats.areas).toBe(1);
    expect(result.stats.pois).toBe(1);
    expect(result.stats.triangles).toBeGreaterThan(0);
    expect(result.stats.skipped).toBe(0);

    const mesh = result.group.children[0] as THREE.Mesh;
    mesh.geometry.computeBoundingBox();
    const box = mesh.geometry.boundingBox!;
    // landcover a +6 cm, acqua piatta a +12 cm
    expect(box.min.y).toBeCloseTo(100.06, 2);
    expect(box.max.y).toBeCloseTo(100.12, 2);
  });

  it('salta i poligoni che cadono nel DEM locale (li disegna OSM locale)', () => {
    const world = latLonToWorld(CENTER.lat, CENTER.lon);
    const local = {
      minX: world.x - 500,
      maxX: world.x + 500,
      minZ: world.z - 500,
      maxZ: world.z + 500,
    };
    const result = buildStreamedAreas(tile(), heights(100), local);
    expect(result.stats.skipped).toBe(2);
    expect(result.stats.triangles).toBe(0);
    expect(result.group.children).toHaveLength(0);
  });

  it('senza superfici non costruisce mesh ma riporta i POI', () => {
    const empty: WorldDataTile = { ...tile(), areas: [], landcover: [] };
    const result = buildStreamedAreas(empty, heights(100), remote);
    expect(result.stats.pois).toBe(1);
    expect(result.group.children).toHaveLength(0);
  });
});

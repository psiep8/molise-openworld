import { describe, expect, it } from 'vitest';
import type { Heightfield } from '../src/geo/elevation';
import { BuildingIndex, RoadIndex, type Area } from '../src/geo/osm';
import {
  COVER_CROP,
  COVER_DRY,
  COVER_MEADOW,
  COVER_WOOD,
  GroundMask,
  coverClass,
} from '../src/world/ground-mask';

const heights = { heightAt: () => 100 } as unknown as Heightfield;
const emptyRoads = new RoadIndex([]);
const emptyBuildings = new BuildingIndex([]);

function square(kind: string, cx: number, cz: number, half: number): Area {
  const points = [
    { x: cx - half, z: cz - half },
    { x: cx + half, z: cz - half },
    { x: cx + half, z: cz + half },
    { x: cx - half, z: cz + half },
  ];
  return {
    kind,
    points,
    bounds: {
      minX: cx - half,
      maxX: cx + half,
      minZ: cz - half,
      maxZ: cz + half,
    },
  };
}

function coverAtPoint(mask: GroundMask, x: number, z: number): number {
  const i = Math.floor((x - mask.originX) / mask.cellSize);
  const j = Math.floor((z - mask.originZ) / mask.cellSize);
  return mask.coverAt(i, j);
}

describe('copertura del suolo', () => {
  it('mappa le classi OSM', () => {
    expect(coverClass('wood')).toBe(COVER_WOOD);
    expect(coverClass('forest')).toBe(COVER_WOOD);
    expect(coverClass('farmland')).toBe(COVER_CROP);
    expect(coverClass('vineyard')).toBe(COVER_CROP);
    expect(coverClass('scrub')).toBe(COVER_DRY);
    expect(coverClass('grassland')).toBe(COVER_MEADOW);
    expect(coverClass('qualcosa-di-nuovo')).toBe(COVER_MEADOW);
  });

  it('rasterizza i poligoni nelle celle della maschera', () => {
    const mask = new GroundMask(12);
    mask.build(0, 0, heights, emptyRoads, emptyBuildings, 2.7, 0.5, [], [
      square('wood', 3, 3, 4),
      square('farmland', -4, -4, 3),
    ]);
    expect(coverAtPoint(mask, 3, 3)).toBe(COVER_WOOD);
    expect(coverAtPoint(mask, -4, -4)).toBe(COVER_CROP);
    // fuori da ogni area resta prato
    expect(coverAtPoint(mask, 9, -9)).toBe(COVER_MEADOW);
  });

  it('il bosco vince sul prato quando i poligoni si sovrappongono', () => {
    const mask = new GroundMask(12);
    mask.build(0, 0, heights, emptyRoads, emptyBuildings, 2.7, 0.5, [], [
      square('grassland', 0, 0, 8),
      square('wood', 0, 0, 3),
    ]);
    expect(coverAtPoint(mask, 0, 0)).toBe(COVER_WOOD);
    // il prato resta dove il bosco non arriva
    expect(coverAtPoint(mask, 6, 0)).toBe(COVER_MEADOW);
  });
});

import { describe, expect, it } from 'vitest';
import type { Area } from '../src/geo/osm';
import { terrainCoverWeightsAt } from '../src/world/terrain';

function area(kind: string, half = 10): Area {
  const points = [
    { x: -half, z: -half },
    { x: half, z: -half },
    { x: half, z: half },
    { x: -half, z: half },
  ];
  return {
    kind,
    points,
    bounds: { minX: -half, maxX: half, minZ: -half, maxZ: half },
  };
}

describe('copertura georeferenziata del terreno', () => {
  it('classifica bosco, coltivo, arbusti e cava', () => {
    expect(terrainCoverWeightsAt(0, 0, [area('wood')])).toEqual([0, 1, 0, 0]);
    expect(terrainCoverWeightsAt(0, 0, [area('farmland')])).toEqual([1, 0, 0, 0]);
    expect(terrainCoverWeightsAt(0, 0, [area('scrub')])).toEqual([0, 0, 1, 0]);
    expect(terrainCoverWeightsAt(0, 0, [area('quarry')])).toEqual([0, 0, 0, 1]);
  });

  it('non colora come prato le aree urbanizzate o d’acqua', () => {
    for (const kind of ['farmyard', 'industrial', 'residential', 'water']) {
      expect(terrainCoverWeightsAt(0, 0, [area(kind)])).toEqual([0, 0, 0, 1]);
    }
  });

  it('usa prato come copertura predefinita e fuori dai poligoni', () => {
    expect(terrainCoverWeightsAt(0, 0, [area('meadow')])).toEqual([0, 0, 0, 0]);
    expect(terrainCoverWeightsAt(20, 0, [area('wood')])).toEqual([0, 0, 0, 0]);
    expect(terrainCoverWeightsAt(0, 0, [])).toEqual([0, 0, 0, 0]);
  });

  it('dà precedenza alla classe geografica più specifica', () => {
    expect(terrainCoverWeightsAt(0, 0, [area('farmland'), area('forest')])).toEqual([0, 1, 0, 0]);
    expect(terrainCoverWeightsAt(0, 0, [area('forest'), area('quarry')])).toEqual([0, 0, 0, 1]);
  });
});

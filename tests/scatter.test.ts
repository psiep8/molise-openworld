import { describe, expect, it } from 'vitest';
import { CanopyField, type CanopyMeta } from '../src/geo/canopy';
import { Heightfield, type HeightMeta } from '../src/geo/elevation';
import type { Area, Building, OsmData, Road } from '../src/geo/osm';
import { BuildingIndex, RoadIndex } from '../src/geo/osm';
import { ScatterGenerator, scatterCollisionRadius } from '../src/world/scatter-gen';

const heightMeta: HeightMeta = {
  source: 'test',
  license: 'test',
  attribution: 'test',
  encoding: 'int16-le, decimetri',
  step: 10,
  nx: 201,
  nz: 201,
  originX: -1000,
  originZ: -1000,
  lat: 41.87,
  lon: 14.775,
  metersPerDegLat: 111145,
  metersPerDegLon: 83014,
  minElevation: 100,
  maxElevation: 100,
  generatedAt: 'test',
};

const canopyMeta: CanopyMeta = {
  source: 'test',
  license: 'test',
  attribution: 'test',
  encoding: 'uint8-meters',
  step: 10,
  nx: 101,
  nz: 101,
  originX: -500,
  originZ: -500,
  lat: 41.87,
  lon: 14.775,
  metersPerDegLat: 111145,
  metersPerDegLon: 83014,
  minHeight: 0,
  maxHeight: 20,
  treeCells: 0,
  generatedAt: 'test',
};

const wooded: Area = {
  kind: 'wood',
  points: [
    { x: -100, z: -100 },
    { x: 200, z: -100 },
    { x: 200, z: 200 },
    { x: -100, z: 200 },
  ],
  bounds: { minX: -100, maxX: 200, minZ: -100, maxZ: 200 },
};

function createOsm(overrides: Partial<OsmData> = {}): OsmData {
  return {
    generatedAt: 'test',
    attribution: 'test',
    stats: {},
    places: [],
    roads: [],
    buildings: [],
    areas: [wooded],
    waterways: [],
    ...overrides,
  };
}

function createRoad(): Road {
  const points = [{ x: -100, z: 0 }, { x: 100, z: 0 }];
  return {
    type: 'residential',
    name: 'test road',
    width: 6,
    paved: true,
    points,
    bounds: { minX: -100, maxX: 100, minZ: 0, maxZ: 0 },
  };
}

function createBuilding(): Building {
  const points = [
    { x: -8, z: -8 },
    { x: 8, z: -8 },
    { x: 8, z: 8 },
    { x: -8, z: 8 },
  ];
  return {
    height: 7,
    points,
    bounds: { minX: -8, maxX: 8, minZ: -8, maxZ: 8 },
    area: 256,
  };
}

function generator(options: {
  osm?: OsmData;
  canopy?: CanopyField | null;
  seed?: number;
} = {}): ScatterGenerator {
  const heights = new Heightfield(heightMeta, new Int16Array(heightMeta.nx * heightMeta.nz).fill(1000));
  const osm = options.osm ?? createOsm();
  return new ScatterGenerator({
    osm,
    heights,
    roads: new RoadIndex(osm.roads, heights),
    buildings: new BuildingIndex(osm.buildings),
    canopy: options.canopy,
    seed: options.seed,
  });
}

describe('cell-based vegetation scatter', () => {
  it('gli arbusti sono attraversabili: niente collider, solo gli alberi fermano', () => {
    expect(scatterCollisionRadius('shrub', 1)).toBeNull();
    expect(scatterCollisionRadius('shrub', 0.5)).toBeNull();
    expect(scatterCollisionRadius('broadleaf', 1)).toBeCloseTo(0.29);
    expect(scatterCollisionRadius('rock', 1)).toBeNull();
  });

  it('is deterministic per cell regardless of generation order', () => {
    const first = generator({ seed: 7824 });
    const second = generator({ seed: 7824 });
    const expected = first.generateCell(0, 0);

    second.generateCell(3, -4);
    second.generateCell(-1, 2);

    expect(second.generateCell(0, 0)).toEqual(expected);
    expect(expected.length).toBeGreaterThan(0);
    expect(expected.every((instance) => instance.x >= 0 && instance.x < 48)).toBe(true);
    expect(expected.every((instance) => instance.z >= 0 && instance.z < 48)).toBe(true);
  });

  it('honors canopy height and leaves mapped open woodland unplanted', () => {
    const noCanopy = new CanopyField(canopyMeta, new Uint8Array(canopyMeta.nx * canopyMeta.nz));
    const result = generator({ canopy: noCanopy }).generateCell(0, 0);

    expect(result.some((instance) => ['broadleaf', 'olive', 'cypress', 'poplar'].includes(instance.kind))).toBe(false);
  });

  it('keeps trees, shrubs, and rocks clear of roads and building footprints', () => {
    const osm = createOsm({
      roads: [createRoad()],
      buildings: [createBuilding()],
    });
    const instances = generator({ osm }).generateCell(0, 0);
    const roadIndex = new RoadIndex(osm.roads);
    const buildingIndex = new BuildingIndex(osm.buildings);

    expect(instances.every((instance) => !roadIndex.isOnRoad(instance.x, instance.z, 1))).toBe(true);
    expect(instances.every((instance) => !buildingIndex.hitsCircle(instance.x, instance.z, 1))).toBe(true);
  });

  it('scatters visible shrubs along uncultivated rural road verges', () => {
    const osm = createOsm({ roads: [createRoad()], areas: [] });
    const instances = generator({ osm, seed: 7824 }).generateCell(0, 0);
    const shrubs = instances.filter((instance) => instance.kind === 'shrub');
    const roadIndex = new RoadIndex(osm.roads);

    expect(shrubs.length).toBeGreaterThan(0);
    expect(shrubs.every((instance) => !roadIndex.isOnRoad(instance.x, instance.z, 1.8))).toBe(true);
  });
});

import { describe, expect, it } from 'vitest';
import { Heightfield, type HeightMeta } from '../src/geo/elevation';
import type { Road } from '../src/geo/osm';
import { createContourRoadExtension, extendBoundaryRoads } from '../src/world/roads';

const meta: HeightMeta = {
  source: 'test',
  license: 'test',
  attribution: 'test',
  encoding: 'int16-le, decimetri',
  step: 10,
  nx: 5,
  nz: 5,
  originX: -20,
  originZ: -20,
  lat: 41.87,
  lon: 14.775,
  metersPerDegLat: 111145,
  metersPerDegLon: 83014,
  minElevation: 500,
  maxElevation: 500,
  generatedAt: 'test',
};

const heights = new Heightfield(meta, new Int16Array(25).fill(5000));

function road(points: { x: number; z: number }[]): Road {
  return {
    type: 'primary',
    name: 'SS 157',
    width: 8,
    paved: true,
    points,
    bounds: {
      minX: Math.min(...points.map((point) => point.x)),
      maxX: Math.max(...points.map((point) => point.x)),
      minZ: Math.min(...points.map((point) => point.z)),
      maxZ: Math.max(...points.map((point) => point.z)),
    },
  };
}

describe('procedural road continuation', () => {
  it('continues an endpoint deterministically in fixed-length contour samples', () => {
    const source = road([{ x: 0, z: 0 }, { x: 10, z: 0 }]);
    const extension = createContourRoadExtension(source, false, heights, 600);
    const repeated = createContourRoadExtension(source, false, heights, 600);

    expect(extension.points).toHaveLength(11);
    expect(extension.points[0]).toEqual(source.points[1]);
    expect(extension.points).toEqual(repeated.points);
    expect(extension.points.at(-1)?.x).toBeGreaterThan(extension.points[0]!.x);
    for (let i = 1; i < extension.points.length; i++) {
      const previous = extension.points[i - 1]!;
      const point = extension.points[i]!;
      expect(Math.hypot(point.x - previous.x, point.z - previous.z)).toBeCloseTo(60, 5);
    }
  });

  it('adds a matching road ribbon source at an open DEM-boundary endpoint', () => {
    const source = road([{ x: -20, z: 0 }, { x: -5, z: 0 }]);
    const osm = {
      generatedAt: 'test',
      attribution: 'test',
      stats: {},
      places: [],
      roads: [source],
      buildings: [],
      areas: [],
      waterways: [],
    };

    expect(extendBoundaryRoads(osm, heights)).toBe(1);
    expect(osm.roads).toHaveLength(2);
    expect(osm.roads[1]!.points[0]).toEqual(source.points[0]);
    expect(osm.roads[1]!.points.length).toBeGreaterThan(100);
  });
});

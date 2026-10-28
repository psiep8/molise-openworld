import { describe, expect, it } from 'vitest';
import { latLonToWorld } from '../src/config';
import {
  buildingFromFeature,
  clipPolylineOutsideBounds,
  ownsFeature,
  roadFromFeature,
  type LocalBounds,
} from '../src/world/streamed-world';
import { tileAt, type GeoBuildingFeature, type GeoRoadFeature } from '../src/geo/world-tiles';

const LOCAL: LocalBounds = { minX: -50, maxX: 50, minZ: -50, maxZ: 50 };

function geoRoad(overrides: Partial<GeoRoadFeature> = {}): GeoRoadFeature {
  return {
    id: 'way/1',
    type: 'secondary',
    name: 'Provinciale',
    width: 6,
    paved: true,
    points: [
      { lat: 41.87, lon: 14.775 },
      { lat: 41.8701, lon: 14.7751 },
    ],
    ...overrides,
  };
}

function geoBuilding(): GeoBuildingFeature {
  return {
    id: 'way/2',
    height: 7,
    points: [
      { lat: 41.87, lon: 14.775 },
      { lat: 41.87, lon: 14.7751 },
      { lat: 41.8701, lon: 14.7751 },
      { lat: 41.8701, lon: 14.775 },
    ],
  };
}

describe('conversione feature geografiche', () => {
  it('porta le coordinate WGS84 nel sistema locale e conserva i tag', () => {
    const projected = geoRoad().points.map((p) => latLonToWorld(p.lat, p.lon));
    const road = roadFromFeature(
      geoRoad({ bridge: true, layer: 2, lanes: 2, maxspeed: 50, surface: 'asphalt' }),
      projected,
    );
    expect(road.points).toEqual(projected);
    expect(road.width).toBe(6);
    expect(road.paved).toBe(true);
    expect(road.bridge).toBe(true);
    expect(road.layer).toBe(2);
    expect(road.lanes).toBe(2);
    expect(road.maxspeed).toBe(50);
    expect(road.surface).toBe('asphalt');
    expect(road.bounds.minX).toBeCloseTo(projected[0]!.x, 6);
    // i bundle fuori dal paese non hanno marciapiede
    expect(road.walkSpans).toEqual([false, false]);
  });

  it('calcola area e bounds di un edificio e scarta le impronte degeneri', () => {
    const building = buildingFromFeature(geoBuilding());
    expect(building).not.toBeNull();
    expect(building!.height).toBe(7);
    expect(building!.area).toBeGreaterThan(40);
    expect(building!.bounds.maxX).toBeGreaterThan(building!.bounds.minX);

    const flat = buildingFromFeature({
      ...geoBuilding(),
      points: [
        { lat: 41.87, lon: 14.775 },
        { lat: 41.87, lon: 14.7751 },
        { lat: 41.87, lon: 14.7752 },
      ],
    });
    expect(flat).toBeNull();
  });

  it('riconosce il tile proprietario dal primo punto', () => {
    const tile = tileAt(41.87, 14.775, 14);
    expect(ownsFeature(geoRoad().points, tile)).toBe(true);
    expect(ownsFeature(geoRoad().points, { ...tile, x: tile.x + 1 })).toBe(false);
  });
});

describe('ritaglio sul bordo del DEM locale', () => {
  it('tiene i due tratti esterni di una strada che attraversa il bbox', () => {
    const runs = clipPolylineOutsideBounds([{ x: -120, z: 0 }, { x: 120, z: 0 }], LOCAL);
    expect(runs).toHaveLength(2);
    expect(runs[0]![0]!.x).toBe(-120);
    expect(runs[0]![1]!.x).toBe(-50);
    expect(runs[1]![0]!.x).toBe(50);
    expect(runs[1]![1]!.x).toBe(120);
  });

  it('lascia intera una strada completamente fuori', () => {
    const runs = clipPolylineOutsideBounds([{ x: 80, z: 10 }, { x: 140, z: 10 }], LOCAL);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toEqual([{ x: 80, z: 10 }, { x: 140, z: 10 }]);
  });

  it('scarta una strada completamente dentro', () => {
    expect(clipPolylineOutsideBounds([{ x: -20, z: 0 }, { x: 20, z: 0 }], LOCAL)).toEqual([]);
  });

  it('gestisce una diagonale che entra ed esce dal bbox', () => {
    const runs = clipPolylineOutsideBounds([{ x: -100, z: -100 }, { x: 100, z: 100 }], LOCAL);
    expect(runs).toHaveLength(2);
    expect(runs[0]![1]!.x).toBeCloseTo(-50, 6);
    expect(runs[1]![0]!.x).toBeCloseTo(50, 6);
  });
});

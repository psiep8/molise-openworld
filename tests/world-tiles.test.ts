import { describe, expect, it, vi } from 'vitest';
import { OpenRasterTileCache } from '../src/world/tile-cache';
import {
  createWorldDataTileProvider,
  parseWorldDataTile,
  tileAt,
  tileKey,
  tilesAround,
  WorldTileManager,
  type WorldTileCoordinate,
} from '../src/geo/world-tiles';

function payload(tile: WorldTileCoordinate): string {
  return JSON.stringify({
    schemaVersion: 1,
    tile,
    attribution: 'Open geodata, ODbL / CC BY',
    roads: [
      {
        id: 'way/1',
        type: 'primary',
        width: 6,
        paved: true,
        points: [
          { lat: 41.9, lon: 14.7 },
          { lat: 41.91, lon: 14.71 },
        ],
      },
    ],
    buildings: [
      {
        id: 'way/2',
        height: 7,
        points: [
          { lat: 41.9, lon: 14.7 },
          { lat: 41.9, lon: 14.701 },
          { lat: 41.901, lon: 14.701 },
        ],
      },
    ],
    elevation: {
      minLon: 14.7,
      maxLon: 14.71,
      minLat: 41.9,
      maxLat: 41.91,
      width: 2,
      height: 2,
      encoding: 'int16-decimeters',
      values: [100, 101, 102, 103],
    },
  });
}

function tileFromRequest(input: RequestInfo | URL): WorldTileCoordinate {
  const [z, x, y] = new URL(String(input)).pathname.split('/').filter(Boolean);
  return {
    z: Number(z),
    x: Number(x),
    y: Number(y?.replace(/\.json$/, '')),
  };
}

describe('world geo tile coordinates', () => {
  it('uses standard XYZ addressing and wraps the antimeridian', () => {
    expect(tileAt(0, 0, 1)).toEqual({ z: 1, x: 1, y: 1 });
    expect(tileAt(0, 180, 3)).toEqual({ z: 3, x: 0, y: 4 });
    expect(tileAt(0, -180, 3)).toEqual({ z: 3, x: 0, y: 4 });
  });

  it('includes the center tile and wraps nearby tiles across the date line', () => {
    expect(tilesAround(0, 0, 0, 4)).toEqual([{ z: 4, x: 8, y: 8 }]);
    const crossing = tilesAround(0, 179.999, 1000, 3);
    expect(crossing.some((tile) => tile.x === 0)).toBe(true);
    expect(crossing.some((tile) => tile.x === 7)).toBe(true);
  });

  it('rejects invalid coordinates, zooms, and unbounded areas', () => {
    expect(() => tileAt(91, 0, 4)).toThrow('coordinate');
    expect(() => tileAt(0, 0, 23)).toThrow('zoom');
    expect(() => tilesAround(0, 0, -1, 4)).toThrow('raggio');
    expect(() => tilesAround(0, 0, 20_000_000, 14)).toThrow('area tile troppo ampia');
  });

  it('requires an attribution and XYZ placeholders for remote data', () => {
    expect(createWorldDataTileProvider(undefined, undefined)).toBeNull();
    expect(() => createWorldDataTileProvider('https://host/{z}/{x}/{y}.json', undefined)).toThrow(
      'ATTRIBUTION',
    );
    expect(() => createWorldDataTileProvider('https://host/{z}/{x}.json', 'Open data')).toThrow(
      'deve contenere {z}, {x} e {y}',
    );
    const provider = createWorldDataTileProvider(
      'https://host/{z}/{x}/{y}.json',
      '© OpenStreetMap contributors (ODbL)',
    );
    expect(provider?.url({ z: 12, x: 123, y: 456 })).toBe('https://host/12/123/456.json');
  });
});

describe('parseWorldDataTile', () => {
  const tile = { z: 12, x: 2_149, y: 1_401 };

  it('validates and reads roads, buildings, and elevation samples', () => {
    const result = parseWorldDataTile(payload(tile), tile);
    expect(result.roads[0]?.points).toHaveLength(2);
    expect(result.buildings[0]?.height).toBe(7);
    expect(result.elevation?.values).toEqual([100, 101, 102, 103]);
  });

  it('rejects malformed, oversized, and wrongly addressed payloads', () => {
    expect(() => parseWorldDataTile('{', tile)).toThrow('JSON non valido');
    expect(() => parseWorldDataTile(payload({ ...tile, x: tile.x + 1 }), tile)).toThrow(
      'coordinate tile discordanti',
    );
    const invalid = JSON.parse(payload(tile)) as Record<string, unknown>;
    invalid.roads = [{ id: 'bad', type: 'road', width: -1, paved: true, points: [] }];
    expect(() => parseWorldDataTile(JSON.stringify(invalid), tile)).toThrow('strada 0 non valida');
  });

  it('rejects DEM samples outside the declared signed 16-bit encoding', () => {
    const invalid = JSON.parse(payload(tile)) as Record<string, unknown>;
    const elevation = invalid.elevation as { values: number[] };
    elevation.values[0] = 32_768;
    expect(() => parseWorldDataTile(JSON.stringify(invalid), tile)).toThrow('griglia DEM non valida');
  });
});

describe('WorldTileManager', () => {
  it('loads tile bundles through persistent cache and unloads tiles outside the wanted area', async () => {
    const loaded: string[] = [];
    const unloaded: string[] = [];
    const provider = createWorldDataTileProvider(
      'https://host/{z}/{x}/{y}.json',
      'Open data attribution',
    )!;
    const cache = new OpenRasterTileCache(undefined, async (input) => {
      return new Response(payload(tileFromRequest(input)));
    });
    const manager = new WorldTileManager(provider, cache, {
      onLoad: (tile) => loaded.push(tileKey(tile.tile)),
      onUnload: (tile) => unloaded.push(tileKey(tile)),
    });
    const first = tileAt(41.9, 14.7, 12);
    const second = tileAt(-41.9, -165.3, 12);

    manager.update(41.9, 14.7, 0, 12);
    await vi.waitFor(() => expect(loaded).toEqual([tileKey(first)]));
    manager.update(41.9, 14.7, 0, 12);
    expect(manager.activeTiles).toHaveLength(1);
    manager.update(-41.9, -165.3, 0, 12);
    await vi.waitFor(() => expect(loaded).toHaveLength(2));
    expect(unloaded).toEqual([tileKey(first)]);
    expect(loaded[1]).toBe(tileKey(second));
    manager.dispose();
    expect(manager.activeTiles).toHaveLength(0);
  });

  it('reports fetch failures and supports explicit retries', async () => {
    let attempts = 0;
    const errors: string[] = [];
    const loaded: string[] = [];
    const provider = createWorldDataTileProvider(
      'https://host/{z}/{x}/{y}.json',
      'Open data attribution',
    )!;
    const cache = new OpenRasterTileCache(undefined, async (input) => {
      attempts++;
      if (attempts === 1) return new Response(null, { status: 503 });
      return new Response(payload(tileFromRequest(input)));
    });
    const manager = new WorldTileManager(provider, cache, {
      onError: (tile, error) => errors.push(`${tileKey(tile)}: ${error.message}`),
      onLoad: (tile) => loaded.push(tileKey(tile.tile)),
    });

    manager.update(41.9, 14.7, 0, 12);
    await vi.waitFor(() => expect(errors).toHaveLength(1));
    manager.retryFailed();
    await vi.waitFor(() => expect(loaded).toHaveLength(1));
    expect(attempts).toBe(2);
    manager.dispose();
  });
});

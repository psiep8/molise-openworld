import { OpenRasterTileCache, openRasterTileCache } from '../world/tile-cache';

const WEB_MERCATOR_LIMIT = 85.05112878;
const MAX_TILE_JSON_BYTES = 12 * 1024 * 1024;
const MAX_GRID_SAMPLES = 1024 * 1024;
const MAX_ACTIVE_TILES = 512;

export interface WorldTileCoordinate {
  z: number;
  x: number;
  y: number;
}

export interface GeoPoint {
  lat: number;
  lon: number;
}

export interface GeoRoadFeature {
  id: string;
  type: string;
  name?: string;
  width: number;
  paved: boolean;
  points: GeoPoint[];
  bridge?: boolean;
  tunnel?: boolean;
  lanes?: number;
  surface?: string;
  oneway?: 1 | -1;
  maxspeed?: number;
  /** Ordine verticale OSM: i ponti hanno layer > 0, le gallerie < 0. */
  layer?: number;
}

export interface GeoBuildingFeature {
  id: string;
  height: number;
  points: GeoPoint[];
}

export interface GeoElevationGrid {
  minLon: number;
  maxLon: number;
  minLat: number;
  maxLat: number;
  width: number;
  height: number;
  encoding: 'int16-decimeters';
  values: number[];
}

export interface WorldDataTile {
  schemaVersion: 1;
  tile: WorldTileCoordinate;
  attribution: string;
  elevation?: GeoElevationGrid;
  roads: GeoRoadFeature[];
  buildings: GeoBuildingFeature[];
}

export interface WorldDataTileProvider {
  id: string;
  attribution: string;
  url(tile: WorldTileCoordinate): string;
  maxZoom: number;
}

export function createWorldDataTileProvider(
  template: string | undefined,
  attribution: string | undefined,
): WorldDataTileProvider | null {
  if (!template) return null;
  if (!attribution) {
    throw new Error('VITE_OPEN_WORLD_DATA_ATTRIBUTION è obbligatorio con VITE_OPEN_WORLD_DATA_TILE_URL');
  }
  if (!['{z}', '{x}', '{y}'].every((token) => template.includes(token))) {
    throw new Error('VITE_OPEN_WORLD_DATA_TILE_URL deve contenere {z}, {x} e {y}');
  }
  return {
    id: 'configured-open-world-data',
    attribution,
    url: ({ z, x, y }) =>
      template.replaceAll('{z}', String(z)).replaceAll('{x}', String(x)).replaceAll('{y}', String(y)),
    maxZoom: 16,
  };
}

export const OPEN_WORLD_DATA_PROVIDER = createWorldDataTileProvider(
  import.meta.env.VITE_OPEN_WORLD_DATA_TILE_URL?.trim(),
  import.meta.env.VITE_OPEN_WORLD_DATA_ATTRIBUTION?.trim(),
);

export function tileAt(lat: number, lon: number, z: number): WorldTileCoordinate {
  validateCoordinate(lat, lon);
  validateZoom(z);
  const n = 2 ** z;
  const clampedLat = Math.max(-WEB_MERCATOR_LIMIT, Math.min(WEB_MERCATOR_LIMIT, lat));
  const x = Math.floor(((lon + 180) / 360) * n);
  const latRad = (clampedLat * Math.PI) / 180;
  const y = Math.floor(((1 - Math.asinh(Math.tan(latRad)) / Math.PI) / 2) * n);
  return { z, x: ((x % n) + n) % n, y: Math.max(0, Math.min(n - 1, y)) };
}

export function tileKey(tile: WorldTileCoordinate): string {
  return `${tile.z}/${tile.x}/${tile.y}`;
}

export function tilesAround(
  lat: number,
  lon: number,
  radiusMeters: number,
  z: number,
): WorldTileCoordinate[] {
  validateCoordinate(lat, lon);
  validateZoom(z);
  if (!Number.isFinite(radiusMeters) || radiusMeters < 0) {
    throw new Error(`raggio geografico non valido: ${radiusMeters}`);
  }
  const center = tileAt(lat, lon, z);
  const n = 2 ** z;
  const latitudeRadius = radiusMeters / 110_574;
  const longitudeRadius = radiusMeters / Math.max(1, 111_320 * Math.cos((lat * Math.PI) / 180));
  const north = Math.min(WEB_MERCATOR_LIMIT, lat + latitudeRadius);
  const south = Math.max(-WEB_MERCATOR_LIMIT, lat - latitudeRadius);
  const west = lon - longitudeRadius;
  const east = lon + longitudeRadius;
  const top = tileAt(north, lon, z).y;
  const bottom = tileAt(south, lon, z).y;
  const left = Math.floor(((west + 180) / 360) * n);
  const right = Math.floor(((east + 180) / 360) * n);
  if ((bottom - top + 1) * (right - left + 1) > MAX_ACTIVE_TILES) {
    throw new Error(`area tile troppo ampia: massimo ${MAX_ACTIVE_TILES} tile per aggiornamento`);
  }
  const tiles = new Map<string, WorldTileCoordinate>();

  for (let y = top; y <= bottom; y++) {
    for (let unwrappedX = left; unwrappedX <= right; unwrappedX++) {
      const tile = { z, x: ((unwrappedX % n) + n) % n, y };
      tiles.set(tileKey(tile), tile);
    }
  }
  tiles.set(tileKey(center), center);
  return [...tiles.values()].sort((a, b) => {
    const da = wrappedTileDistance2(a, center, n);
    const db = wrappedTileDistance2(b, center, n);
    return da - db;
  });
}

export interface WorldTileCallbacks {
  onLoad?: (tile: WorldDataTile) => void;
  onUnload?: (tile: WorldTileCoordinate) => void;
  onError?: (tile: WorldTileCoordinate, error: Error) => void;
}

export class WorldTileManager {
  private readonly loaded = new Map<string, WorldDataTile>();
  private readonly failed = new Set<string>();
  private readonly inflight = new Set<string>();
  private desired = new Map<string, WorldTileCoordinate>();
  private queue: WorldTileCoordinate[] = [];
  private activeLoads = 0;
  private disposed = false;

  constructor(
    readonly provider: WorldDataTileProvider,
    private readonly cache: OpenRasterTileCache = openRasterTileCache,
    private readonly callbacks: WorldTileCallbacks = {},
    private readonly maxConcurrent = 4,
  ) {
    if (!Number.isInteger(maxConcurrent) || maxConcurrent < 1) {
      throw new Error(`concorrenza tile non valida: ${maxConcurrent}`);
    }
  }

  get activeTiles(): readonly WorldDataTile[] {
    return [...this.loaded.values()];
  }

  update(lat: number, lon: number, radiusMeters: number, zoom = 14): void {
    if (this.disposed) throw new Error('gestore tile geografici già chiuso');
    if (zoom < 0 || zoom > this.provider.maxZoom) {
      throw new Error(`zoom tile ${zoom} fuori dal limite del provider (${this.provider.maxZoom})`);
    }
    const next = new Map(
      tilesAround(lat, lon, radiusMeters, zoom).map((tile) => [tileKey(tile), tile] as const),
    );
    this.desired = next;
    this.queue = [...next]
      .filter(([key]) => !this.loaded.has(key) && !this.inflight.has(key) && !this.failed.has(key))
      .map(([, tile]) => tile);

    for (const [key, tile] of this.loaded) {
      if (next.has(key)) continue;
      this.loaded.delete(key);
      this.callbacks.onUnload?.(tile.tile);
    }
    this.pump();
  }

  retryFailed(): void {
    if (this.disposed) throw new Error('gestore tile geografici già chiuso');
    this.failed.clear();
    this.updateDesiredQueue();
    this.pump();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.queue = [];
    for (const [key, tile] of this.loaded) {
      this.callbacks.onUnload?.(tile.tile);
      this.loaded.delete(key);
    }
    this.desired.clear();
  }

  private updateDesiredQueue(): void {
    this.queue = [...this.desired]
      .filter(([key]) => !this.loaded.has(key) && !this.inflight.has(key) && !this.failed.has(key))
      .map(([, tile]) => tile);
  }

  private pump(): void {
    while (!this.disposed && this.activeLoads < this.maxConcurrent && this.queue.length > 0) {
      const tile = this.queue.shift()!;
      const key = tileKey(tile);
      if (!this.desired.has(key) || this.inflight.has(key)) continue;
      this.inflight.add(key);
      this.activeLoads++;
      void this.load(tile, key);
    }
  }

  private async load(tile: WorldTileCoordinate, key: string): Promise<void> {
    try {
      const url = this.provider.url(tile);
      const blob = await this.cache.load(url);
      if (blob.size > MAX_TILE_JSON_BYTES) {
        throw new Error(`tile ${key} troppo grande: ${blob.size} byte`);
      }
      const payload = parseWorldDataTile(await blob.text(), tile);
      if (this.disposed || !this.desired.has(key)) return;
      this.loaded.set(key, payload);
      this.callbacks.onLoad?.(payload);
    } catch (error) {
      const failure = error instanceof Error ? error : new Error(String(error));
      this.failed.add(key);
      this.callbacks.onError?.(tile, failure);
    } finally {
      this.inflight.delete(key);
      this.activeLoads--;
      this.pump();
    }
  }
}

export function parseWorldDataTile(json: string, expected: WorldTileCoordinate): WorldDataTile {
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch (error) {
    throw new Error(`tile ${tileKey(expected)}: JSON non valido`, { cause: error });
  }
  if (!isRecord(value) || value.schemaVersion !== 1 || !isRecord(value.tile)) {
    throw new Error(`tile ${tileKey(expected)}: schemaVersion 1 richiesto`);
  }
  const actual = value.tile;
  if (actual.z !== expected.z || actual.x !== expected.x || actual.y !== expected.y) {
    throw new Error(`tile ${tileKey(expected)}: coordinate tile discordanti`);
  }
  if (typeof value.attribution !== 'string' || value.attribution.trim().length === 0) {
    throw new Error(`tile ${tileKey(expected)}: attribuzione mancante`);
  }
  if (!Array.isArray(value.roads) || !Array.isArray(value.buildings)) {
    throw new Error(`tile ${tileKey(expected)}: roads e buildings devono essere array`);
  }

  const roads = value.roads.map((road, index) => parseRoad(road, expected, index));
  const buildings = value.buildings.map((building, index) => parseBuilding(building, expected, index));
  const elevation =
    value.elevation === undefined ? undefined : parseElevation(value.elevation, expected);

  return {
    schemaVersion: 1,
    tile: { z: expected.z, x: expected.x, y: expected.y },
    attribution: value.attribution,
    roads,
    buildings,
    ...(elevation ? { elevation } : {}),
  };
}

function parseRoad(value: unknown, tile: WorldTileCoordinate, index: number): GeoRoadFeature {
  if (
    !isRecord(value) ||
    typeof value.id !== 'string' ||
    typeof value.type !== 'string' ||
    typeof value.width !== 'number' ||
    !Number.isFinite(value.width) ||
    value.width <= 0 ||
    typeof value.paved !== 'boolean' ||
    !Array.isArray(value.points) ||
    value.points.length < 2
  ) {
    throw new Error(`tile ${tileKey(tile)}: strada ${index} non valida`);
  }
  const road: GeoRoadFeature = {
    id: value.id,
    type: value.type,
    width: value.width,
    paved: value.paved,
    points: value.points.map((point) => parseGeoPoint(point, tile)),
  };
  if (typeof value.name === 'string') road.name = value.name;
  if (typeof value.bridge === 'boolean') road.bridge = value.bridge;
  if (typeof value.tunnel === 'boolean') road.tunnel = value.tunnel;
  if (typeof value.lanes === 'number' && Number.isFinite(value.lanes)) road.lanes = value.lanes;
  if (typeof value.surface === 'string') road.surface = value.surface;
  if (value.oneway === 1 || value.oneway === -1) road.oneway = value.oneway;
  if (typeof value.maxspeed === 'number' && Number.isFinite(value.maxspeed)) road.maxspeed = value.maxspeed;
  if (typeof value.layer === 'number' && Number.isFinite(value.layer)) road.layer = value.layer;
  return road;
}

function parseBuilding(value: unknown, tile: WorldTileCoordinate, index: number): GeoBuildingFeature {
  if (
    !isRecord(value) ||
    typeof value.id !== 'string' ||
    typeof value.height !== 'number' ||
    !Number.isFinite(value.height) ||
    value.height <= 0 ||
    !Array.isArray(value.points) ||
    value.points.length < 3
  ) {
    throw new Error(`tile ${tileKey(tile)}: edificio ${index} non valido`);
  }
  return {
    id: value.id,
    height: value.height,
    points: value.points.map((point) => parseGeoPoint(point, tile)),
  };
}

function parseElevation(value: unknown, tile: WorldTileCoordinate): GeoElevationGrid {
  if (
    !isRecord(value) ||
    ![value.minLon, value.maxLon, value.minLat, value.maxLat, value.width, value.height].every(
      (field) => typeof field === 'number' && Number.isFinite(field),
    ) ||
    typeof value.width !== 'number' ||
    typeof value.height !== 'number' ||
    !Number.isInteger(value.width) ||
    !Number.isInteger(value.height) ||
    value.width < 2 ||
    value.height < 2 ||
    value.width * value.height > MAX_GRID_SAMPLES ||
    value.encoding !== 'int16-decimeters' ||
    !Array.isArray(value.values) ||
    value.values.length !== value.width * value.height ||
    !value.values.every((sample) => Number.isInteger(sample) && sample >= -32768 && sample <= 32767)
  ) {
    throw new Error(`tile ${tileKey(tile)}: griglia DEM non valida`);
  }
  const grid: GeoElevationGrid = {
    minLon: value.minLon as number,
    maxLon: value.maxLon as number,
    minLat: value.minLat as number,
    maxLat: value.maxLat as number,
    width: value.width,
    height: value.height,
    encoding: 'int16-decimeters',
    values: value.values as number[],
  };
  if (grid.minLon < -180 || grid.maxLon > 180 || grid.minLon >= grid.maxLon) {
    throw new Error(`tile ${tileKey(tile)}: limiti longitudine DEM non validi`);
  }
  if (grid.minLat < -WEB_MERCATOR_LIMIT || grid.maxLat > WEB_MERCATOR_LIMIT || grid.minLat >= grid.maxLat) {
    throw new Error(`tile ${tileKey(tile)}: limiti latitudine DEM non validi`);
  }
  return grid;
}

function parseGeoPoint(value: unknown, tile: WorldTileCoordinate): GeoPoint {
  if (
    !isRecord(value) ||
    typeof value.lat !== 'number' ||
    !Number.isFinite(value.lat) ||
    value.lat < -90 ||
    value.lat > 90 ||
    typeof value.lon !== 'number' ||
    !Number.isFinite(value.lon) ||
    value.lon < -180 ||
    value.lon > 180
  ) {
    throw new Error(`tile ${tileKey(tile)}: coordinata WGS84 non valida`);
  }
  return { lat: value.lat, lon: value.lon };
}

function wrappedTileDistance2(a: WorldTileCoordinate, b: WorldTileCoordinate, n: number): number {
  const dx = Math.min(Math.abs(a.x - b.x), n - Math.abs(a.x - b.x));
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

function validateCoordinate(lat: number, lon: number): void {
  if (
    !Number.isFinite(lat) ||
    !Number.isFinite(lon) ||
    lat < -90 ||
    lat > 90 ||
    lon < -180 ||
    lon > 180
  ) {
    throw new Error(`coordinate geografiche non valide: ${lat}, ${lon}`);
  }
}

function validateZoom(z: number): void {
  if (!Number.isInteger(z) || z < 0 || z > 22) {
    throw new Error(`zoom XYZ non valido: ${z}`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export interface GeoPoint {
  lat: number;
  lon: number;
}

export interface OsmWay {
  id: number;
  tags: Record<string, string>;
  refs: number[];
}

export interface OsmExtract {
  nodes: Map<number, GeoPoint>;
  ways: OsmWay[];
}

export interface TileCoordinate {
  z: number;
  x: number;
  y: number;
}

export interface TileBundle {
  schemaVersion: 1;
  tile: TileCoordinate;
  attribution: string;
  roads: {
    id: string;
    type: string;
    width: number;
    paved: boolean;
    surface: string;
    points: GeoPoint[];
    name?: string;
    bridge?: boolean;
    tunnel?: boolean;
    layer?: number;
    lanes?: number;
    oneway?: 1 | -1;
    maxspeed?: number;
  }[];
  buildings: { id: string; height: number; points: GeoPoint[] }[];
}

export interface BBox {
  minLat: number;
  minLon: number;
  maxLat: number;
  maxLon: number;
}

export function parseOsmXml(xml: string): OsmExtract;

export function buildTiles(
  extract: OsmExtract,
  options: { zoom?: number; attribution: string; bbox?: BBox | null },
): Map<string, TileBundle>;

export function writeTiles(
  tiles: Map<string, TileBundle>,
  outDir: string,
): Promise<{ files: number; bytes: number }>;

import * as THREE from 'three';
import { latLonToWorld } from '../config';
import type { Heightfield } from '../geo/elevation';
import { boundsOf, type Pt } from '../geo/geo';
import {
  prepareRoadElevations,
  RoadIndex,
  type Building,
  type BuildingIndex,
  type OsmData,
  type Road,
} from '../geo/osm';
import {
  tileAt,
  tileKey,
  type GeoBuildingFeature,
  type GeoPoint,
  type GeoRoadFeature,
  type WorldDataTile,
  type WorldTileCoordinate,
} from '../geo/world-tiles';
import { buildBuildings, releaseWindowGlowMaterial } from './buildings';
import type { CityKit } from './citykit';
import { buildRoads, roadPolyline } from './roads';

export interface LocalBounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export interface StreamedWorldStats {
  tiles: number;
  roads: number;
  buildings: number;
  enabled: boolean;
}

export interface StreamedWorldOptions {
  scene: THREE.Scene;
  heights: Heightfield;
  renderer: THREE.WebGLRenderer;
  /** indice globale delle impronte: giocatore, auto e pedoni lo leggono a ogni frame */
  buildings: BuildingIndex;
  /** array vivo condiviso con `WorldGround` (indici statici + streamed) */
  roadIndexes: RoadIndex[];
  detail: 'full' | 'simple';
  kit?: CityKit | null;
  enabled?: boolean;
}

interface StreamedTile {
  key: string;
  tile: WorldDataTile;
  roads: Road[];
  buildings: Building[];
  group: THREE.Group | null;
  roadIndex: RoadIndex | null;
  windowMaterial: THREE.MeshStandardMaterial | null;
}

/**
 * Disegna e indicizza strade ed edifici dei bundle geografici XYZ.
 *
 * Regole:
 * - ogni feature è disegnata solo dal tile che contiene il suo primo punto,
 *   così i bundle possono ripetere la stessa way su più tile senza duplicati;
 * - le parti dentro il DEM locale sono ritagliate via: lì comanda OSM locale,
 *   che è più preciso e già collaudato. Lo streaming serve a estendere il mondo;
 * - i ponti usano `prepareRoadElevations`, quindi grafica e fisica leggono la
 *   stessa quota anche fuori dal bbox locale.
 */
export class StreamedWorld {
  private readonly tiles = new Map<string, StreamedTile>();
  private readonly localBounds: LocalBounds;
  private enabled: boolean;

  constructor(private readonly options: StreamedWorldOptions) {
    this.localBounds = options.heights.bounds;
    this.enabled = options.enabled ?? true;
  }

  get stats(): StreamedWorldStats {
    let roads = 0;
    let buildings = 0;
    for (const tile of this.tiles.values()) {
      roads += tile.roads.length;
      buildings += tile.buildings.length;
    }
    return { tiles: this.tiles.size, roads, buildings, enabled: this.enabled };
  }

  addTile(tile: WorldDataTile): void {
    const key = tileKey(tile.tile);
    if (this.tiles.has(key)) return;

    const roads: Road[] = [];
    for (const feature of tile.roads) {
      if (!ownsFeature(feature.points, tile.tile)) continue;
      const points = feature.points.map(projectGeoPoint);
      for (const run of clipPolylineOutsideBounds(points, this.localBounds)) {
        if (run.length < 2) continue;
        roads.push(roadFromFeature(feature, run));
      }
    }

    const buildings: Building[] = [];
    for (const feature of tile.buildings) {
      if (!ownsFeature(feature.points, tile.tile)) continue;
      const building = buildingFromFeature(feature);
      if (!building || overlaps(building.bounds, this.localBounds)) continue;
      buildings.push(building);
    }

    const entry: StreamedTile = {
      key,
      tile,
      roads,
      buildings,
      group: null,
      roadIndex: null,
      windowMaterial: null,
    };
    this.tiles.set(key, entry);
    if (this.enabled) this.attach(entry);
  }

  removeTile(tile: WorldTileCoordinate): void {
    const key = tileKey(tile);
    const entry = this.tiles.get(key);
    if (!entry) return;
    this.detach(entry);
    disposeGroup(entry.group);
    this.tiles.delete(key);
  }

  /** Accende o spegne tutto lo streaming senza perdere i tile già scaricati. */
  setEnabled(enabled: boolean): void {
    if (this.enabled === enabled) return;
    this.enabled = enabled;
    for (const entry of this.tiles.values()) {
      if (enabled) this.attach(entry);
      else this.detach(entry);
    }
  }

  isOnRoad(x: number, z: number, reach = 1): boolean {
    for (const index of this.options.roadIndexes) {
      if (index.isOnRoad(x, z, reach)) return true;
    }
    return false;
  }

  dispose(): void {
    for (const entry of this.tiles.values()) {
      this.detach(entry);
      disposeGroup(entry.group);
    }
    this.tiles.clear();
  }

  private attach(entry: StreamedTile): void {
    if (!entry.group) this.build(entry);
    if (!entry.group || !entry.roadIndex) return;
    if (entry.group.parent !== this.options.scene) this.options.scene.add(entry.group);
    if (!this.options.roadIndexes.includes(entry.roadIndex)) {
      this.options.roadIndexes.push(entry.roadIndex);
    }
    for (const building of entry.buildings) this.options.buildings.add(building);
  }

  private detach(entry: StreamedTile): void {
    if (entry.group?.parent === this.options.scene) this.options.scene.remove(entry.group);
    if (entry.roadIndex) {
      const index = this.options.roadIndexes.indexOf(entry.roadIndex);
      if (index >= 0) this.options.roadIndexes.splice(index, 1);
    }
    if (entry.buildings.length) this.options.buildings.remove(entry.buildings);
  }

  private build(entry: StreamedTile): void {
    if (entry.roads.length === 0 && entry.buildings.length === 0) return;
    prepareRoadElevations(entry.roads, this.options.heights);

    const osm: OsmData = {
      generatedAt: '',
      attribution: entry.tile.attribution,
      stats: {},
      places: [],
      roads: entry.roads,
      buildings: entry.buildings,
      areas: [],
      waterways: [],
    };

    const group = new THREE.Group();
    group.name = `streamed-world-${entry.key}`;
    if (entry.roads.length) {
      entry.roadIndex = new RoadIndex(entry.roads, this.options.heights, roadPolyline);
      const roads = buildRoads(
        osm,
        this.options.heights,
        this.options.renderer,
        entry.roadIndex,
        undefined,
        this.options.kit ?? null,
      );
      roads.group.name = `streamed-roads-${entry.key}`;
      group.add(roads.group);
    }
    if (entry.buildings.length) {
      const buildings = buildBuildings(osm, this.options.heights, this.options.renderer, {
        detail: this.options.detail,
      });
      buildings.group.name = `streamed-buildings-${entry.key}`;
      const windowMaterial = buildings.group.userData.windowGlowMaterial;
      if (windowMaterial instanceof THREE.MeshStandardMaterial) entry.windowMaterial = windowMaterial;
      group.add(buildings.group);
    }
    entry.group = group;
  }
}

/** Il tile che possiede la feature: quello del suo primo punto. */
export function ownsFeature(points: readonly GeoPoint[], tile: WorldTileCoordinate): boolean {
  const first = points[0];
  if (!first) return false;
  const owner = tileAt(first.lat, first.lon, tile.z);
  return owner.x === tile.x && owner.y === tile.y && owner.z === tile.z;
}

export function projectGeoPoint(point: GeoPoint): Pt {
  return latLonToWorld(point.lat, point.lon);
}

export function roadFromFeature(feature: GeoRoadFeature, points: Pt[]): Road {
  const road: Road = {
    type: feature.type,
    name: feature.name ?? '',
    width: feature.width,
    paved: feature.paved,
    points,
    bounds: boundsOf(points),
    // Fuori dal paese non ci sono marciapiedi: senza questa maschera
    // `buildRoads` ne disegnerebbe uno per tutta la strada.
    walkSpans: points.map(() => false),
    surface: feature.surface ?? (feature.paved ? 'asphalt' : 'dirt'),
  };
  if (feature.bridge !== undefined) road.bridge = feature.bridge;
  if (feature.tunnel !== undefined) road.tunnel = feature.tunnel;
  if (feature.layer !== undefined) road.layer = feature.layer;
  if (feature.lanes !== undefined) road.lanes = feature.lanes;
  if (feature.oneway !== undefined) road.oneway = feature.oneway;
  if (feature.maxspeed !== undefined) road.maxspeed = feature.maxspeed;
  return road;
}

export function buildingFromFeature(feature: GeoBuildingFeature): Building | null {
  const points = feature.points.map(projectGeoPoint);
  if (points.length < 3) return null;
  const area = ringArea(points);
  if (area < 6) return null;
  return { height: feature.height, points, bounds: boundsOf(points), area };
}

/**
 * Ritaglia una polilinea fuori da un rettangolo, restituendo i tratti esterni.
 *
 * Serve al confine del DEM locale: una strada che entra nel bbox non deve
 * essere disegnata due volte (OSM locale + bundle). I tratti interni si
 * scartano, quelli esterni restano attaccati al bordo.
 */
export function clipPolylineOutsideBounds(
  points: readonly Pt[],
  bounds: LocalBounds,
): Pt[][] {
  if (points.length < 2) return [];
  const runs: Pt[][] = [];
  let run: Pt[] = [];
  const flush = (): void => {
    if (run.length >= 2) runs.push(run);
    run = [];
  };

  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    const cuts = [0, ...boundaryCrossings(a, b, bounds), 1].sort((x, y) => x - y);
    for (let k = 1; k < cuts.length; k++) {
      const t0 = cuts[k - 1]!;
      const t1 = cuts[k]!;
      if (t1 - t0 < 1e-9) continue;
      const p0 = lerp(a, b, t0);
      const p1 = lerp(a, b, t1);
      const mid = lerp(a, b, (t0 + t1) * 0.5);
      if (!insideBounds(mid, bounds)) {
        if (run.length === 0 || !samePoint(run[run.length - 1]!, p0)) run.push(p0);
        run.push(p1);
      } else {
        flush();
      }
    }
  }
  flush();
  return runs;
}

function boundaryCrossings(a: Pt, b: Pt, bounds: LocalBounds): number[] {
  const out: number[] = [];
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const add = (t: number, x: number, z: number): void => {
    if (t <= 1e-9 || t >= 1 - 1e-9) return;
    if (x < bounds.minX - 1e-6 || x > bounds.maxX + 1e-6) return;
    if (z < bounds.minZ - 1e-6 || z > bounds.maxZ + 1e-6) return;
    if (!out.some((value) => Math.abs(value - t) < 1e-9)) out.push(t);
  };
  if (Math.abs(dx) > 1e-9) {
    for (const x of [bounds.minX, bounds.maxX]) {
      const t = (x - a.x) / dx;
      add(t, x, a.z + dz * t);
    }
  }
  if (Math.abs(dz) > 1e-9) {
    for (const z of [bounds.minZ, bounds.maxZ]) {
      const t = (z - a.z) / dz;
      add(t, a.x + dx * t, z);
    }
  }
  return out;
}

function insideBounds(point: Pt, bounds: LocalBounds): boolean {
  return (
    point.x >= bounds.minX &&
    point.x <= bounds.maxX &&
    point.z >= bounds.minZ &&
    point.z <= bounds.maxZ
  );
}

function overlaps(a: LocalBounds, b: LocalBounds): boolean {
  return a.minX <= b.maxX && a.maxX >= b.minX && a.minZ <= b.maxZ && a.maxZ >= b.minZ;
}

function lerp(a: Pt, b: Pt, t: number): Pt {
  return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t };
}

function samePoint(a: Pt, b: Pt): boolean {
  return Math.abs(a.x - b.x) < 1e-6 && Math.abs(a.z - b.z) < 1e-6;
}

function ringArea(points: readonly Pt[]): number {
  let area = 0;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    area += (points[j]!.x + points[i]!.x) * (points[j]!.z - points[i]!.z);
  }
  return Math.abs(area / 2);
}

function disposeGroup(group: THREE.Group | null): void {
  if (!group) return;
  const materials = new Set<THREE.Material>();
  group.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    object.geometry.dispose();
    const material = object.material;
    for (const item of Array.isArray(material) ? material : [material]) materials.add(item);
  });
  for (const material of materials) {
    if (material instanceof THREE.MeshStandardMaterial) releaseWindowGlowMaterial(material);
    material.dispose();
  }
  group.removeFromParent();
}

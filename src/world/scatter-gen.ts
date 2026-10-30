import { pointInPolygon, type Pt } from '../geo/geo';
import type { CanopyField } from '../geo/canopy';
import type { Heightfield } from '../geo/elevation';
import { mulberry32 } from '../geo/geo';
import type { Area, BuildingIndex, OsmData, RoadIndex } from '../geo/osm';
import { insidePaved, type PavedArea } from './paved';

export const SCATTER_CELL_SIZE = 48;

export type ScatterKind = 'broadleaf' | 'olive' | 'cypress' | 'poplar' | 'shrub' | 'rock';

export interface ScatterInstance {
  kind: ScatterKind;
  x: number;
  y: number;
  z: number;
  scale: number;
  rotation: number;
  variation: number;
}

export function scatterCollisionRadius(kind: ScatterKind, scale: number): number | null {
  // I cespugli non hanno collider: l'auto ci passa in mezzo e li piega, mentre
  // un albero resta un ostacolo solido. Prima un cespuglio da 0,62 m fermava
  // l'auto come un muro invisibile, che è il contrario di un sottobosco.
  const radius =
    kind === 'broadleaf' ? 0.29 :
    kind === 'olive' ? 0.34 :
    kind === 'cypress' ? 0.2 :
    kind === 'poplar' ? 0.24 :
    null;
  return radius === null ? null : radius * scale;
}

export interface ScatterSources {
  osm: OsmData;
  heights: Heightfield;
  roads: RoadIndex;
  buildings: BuildingIndex;
  canopy?: CanopyField | null;
  paved?: readonly PavedArea[];
  seed?: number;
  treeDensity?: number;
  shrubDensity?: number;
}

type Cover = 'wood' | 'orchard' | 'park' | 'scrub' | 'crop' | 'meadow';

const WOOD_KINDS = new Set(['wood', 'forest']);
const ORCHARD_KINDS = new Set(['orchard']);
const SCRUB_KINDS = new Set(['scrub', 'heath']);
const CROP_KINDS = new Set(['farmland', 'farm', 'vineyard', 'allotments']);
const CELL_METERS = SCATTER_CELL_SIZE;
const NATURAL_CANDIDATES = 64;
const WATERWAY_REACH = 22;

function key(x: number, z: number): string {
  return `${x},${z}`;
}

function hash(seed: number, x: number, z: number, salt: number): number {
  let value = Math.imul(x | 0, 0x9e3779b1) ^ Math.imul(z | 0, 0x85ebca77) ^ Math.imul(seed | 0, 0xc2b2ae3d) ^ salt;
  value = Math.imul(value ^ (value >>> 16), 0x7feb352d);
  value = Math.imul(value ^ (value >>> 15), 0x846ca68b);
  return ((value ^ (value >>> 16)) >>> 0) / 0x1_0000_0000;
}

function segmentDistance(x: number, z: number, a: Pt, b: Pt): number {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const length2 = dx * dx + dz * dz;
  const t = length2 === 0 ? 0 : Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / length2));
  return Math.hypot(x - (a.x + dx * t), z - (a.z + dz * t));
}

function areaCover(kind: string): Cover | null {
  if (WOOD_KINDS.has(kind)) return 'wood';
  if (ORCHARD_KINDS.has(kind)) return 'orchard';
  if (kind === 'park') return 'park';
  if (SCRUB_KINDS.has(kind)) return 'scrub';
  if (CROP_KINDS.has(kind)) return 'crop';
  return null;
}

function smooth(value: number): number {
  const t = Math.max(0, Math.min(1, value));
  return t * t * (3 - 2 * t);
}

function valueNoise(x: number, z: number, seed: number): number {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const tx = smooth(x - ix);
  const tz = smooth(z - iz);
  const a = hash(seed, ix, iz, 17);
  const b = hash(seed, ix + 1, iz, 17);
  const c = hash(seed, ix, iz + 1, 17);
  const d = hash(seed, ix + 1, iz + 1, 17);
  const top = a + (b - a) * tx;
  const bottom = c + (d - c) * tx;
  return top + (bottom - top) * tz;
}

export class ScatterGenerator {
  private readonly seed: number;
  private readonly treeDensity: number;
  private readonly shrubDensity: number;
  private readonly canopy: CanopyField | null;
  private readonly paved: readonly PavedArea[];
  private readonly areaCells = new Map<string, Area[]>();
  private readonly largeAreas: Area[] = [];
  private readonly waterCells = new Map<string, { a: Pt; b: Pt }[]>();
  private readonly largeWaterSegments: { a: Pt; b: Pt }[] = [];

  constructor(private readonly sources: ScatterSources) {
    this.seed = sources.seed ?? 0x51ca77e2;
    this.treeDensity = Math.max(0, Math.min(2, sources.treeDensity ?? 1));
    this.shrubDensity = Math.max(0, Math.min(2, sources.shrubDensity ?? 1));
    this.canopy = sources.canopy ?? null;
    this.paved = sources.paved ?? [];
    this.indexAreas(sources.osm.areas);
    this.indexWaterways(sources.osm);
  }

  /** Generates a cell independently of generation order for stable streaming. */
  generateCell(cellX: number, cellZ: number): ScatterInstance[] {
    const rng = mulberry32(hash(this.seed, cellX, cellZ, 0x4f1bbcdc) * 0xffff_ffff);
    const instances: ScatterInstance[] = [];
    const originX = cellX * CELL_METERS;
    const originZ = cellZ * CELL_METERS;
    const gridSide = Math.sqrt(NATURAL_CANDIDATES);
    const stride = CELL_METERS / gridSide;

    for (let iz = 0; iz < gridSide; iz++) {
      for (let ix = 0; ix < gridSide; ix++) {
        const x = originX + (ix + 0.18 + rng() * 0.64) * stride;
        const z = originZ + (iz + 0.18 + rng() * 0.64) * stride;
        const cover = this.coverAt(x, z);
        const canopyHeight = this.canopyHeightAt(x, z);
        const slope = this.sources.heights.slopeAt(x, z);
        const onWater = this.nearWaterway(x, z);
        const treeChance = this.treeChance(cover, canopyHeight);

        if (slope < 34 && rng() < treeChance * this.treeDensity) {
          this.addTree(instances, x, z, cover, canopyHeight, onWater, false, rng);
        }

        const shrubChance =
          cover === 'scrub' ? 0.42 : cover === 'wood' ? 0.16 : cover === 'orchard' ? 0.1 : cover === 'crop' ? 0.04 : 0.055;
        if (slope < 38 && rng() < shrubChance * this.shrubDensity) {
          this.addSmallObject(instances, 'shrub', x, z, 0.55 + rng() * 0.8, rng);
        }

        // Sassi: un accento su pendii e macchia, non un campo di pietre. Al 12%
        // su ogni candidato di un pendio, l'erba spariva dietro migliaia di
        // massi bassi e il versante sembrava una frana.
        const rockChance = slope > 22 ? 0.03 : cover === 'scrub' ? 0.008 : 0.0015;
        if (slope < 55 && rng() < rockChance) {
          this.addSmallObject(instances, 'rock', x, z, 0.3 + rng() * 0.75, rng);
        }
      }
    }

    this.addRoadsideTrees(instances, cellX, cellZ, rng);
    this.addRoadsideShrubs(instances, cellX, cellZ, rng);
    return instances;
  }

  movementFactorAt(x: number, z: number): number {
    const cover = this.coverAt(x, z);
    const canopyHeight = this.canopyHeightAt(x, z);
    if (cover === 'wood') return canopyHeight !== null && canopyHeight < 2 ? 0.9 : 0.68;
    if (cover === 'scrub') return 0.58;
    if (cover === 'orchard') return 0.78;
    if (cover === 'crop') return 0.82;
    if (canopyHeight !== null && canopyHeight >= 2) return 0.74;
    return 0.9;
  }

  private indexAreas(areas: readonly Area[]): void {
    for (const area of areas) {
      if (!areaCover(area.kind)) continue;
      const minX = Math.floor(area.bounds.minX / CELL_METERS);
      const maxX = Math.floor(area.bounds.maxX / CELL_METERS);
      const minZ = Math.floor(area.bounds.minZ / CELL_METERS);
      const maxZ = Math.floor(area.bounds.maxZ / CELL_METERS);
      const cellCount = (maxX - minX + 1) * (maxZ - minZ + 1);
      if (cellCount > 4096) {
        this.largeAreas.push(area);
        continue;
      }
      for (let x = minX; x <= maxX; x++) {
        for (let z = minZ; z <= maxZ; z++) {
          const cellKey = key(x, z);
          const list = this.areaCells.get(cellKey);
          if (list) list.push(area);
          else this.areaCells.set(cellKey, [area]);
        }
      }
    }
  }

  private indexWaterways(osm: OsmData): void {
    for (const waterway of osm.waterways) {
      for (let i = 1; i < waterway.points.length; i++) {
        const a = waterway.points[i - 1]!;
        const b = waterway.points[i]!;
        const minX = Math.floor((Math.min(a.x, b.x) - WATERWAY_REACH) / CELL_METERS);
        const maxX = Math.floor((Math.max(a.x, b.x) + WATERWAY_REACH) / CELL_METERS);
        const minZ = Math.floor((Math.min(a.z, b.z) - WATERWAY_REACH) / CELL_METERS);
        const maxZ = Math.floor((Math.max(a.z, b.z) + WATERWAY_REACH) / CELL_METERS);
        if ((maxX - minX + 1) * (maxZ - minZ + 1) > 4096) {
          this.largeWaterSegments.push({ a, b });
          continue;
        }
        for (let x = minX; x <= maxX; x++) {
          for (let z = minZ; z <= maxZ; z++) {
            const cellKey = key(x, z);
            const list = this.waterCells.get(cellKey);
            if (list) list.push({ a, b });
            else this.waterCells.set(cellKey, [{ a, b }]);
          }
        }
      }
    }
  }

  private coverAt(x: number, z: number): Cover {
    const cellX = Math.floor(x / CELL_METERS);
    const cellZ = Math.floor(z / CELL_METERS);
    const candidates = [...(this.areaCells.get(key(cellX, cellZ)) ?? []), ...this.largeAreas];
    let selected: Cover | null = null;
    for (const area of candidates) {
      if (
        x < area.bounds.minX ||
        x > area.bounds.maxX ||
        z < area.bounds.minZ ||
        z > area.bounds.maxZ ||
        !pointInPolygon(x, z, area.points)
      ) {
        continue;
      }
      const cover = areaCover(area.kind);
      if (cover === 'wood' || cover === 'orchard' || cover === 'scrub' || cover === 'park') selected = cover;
      else if (!selected && cover === 'crop') selected = cover;
    }
    if (selected) return selected;

    const seed = this.seed ^ 0x2c1b3c6d;
    const broad = valueNoise(x / 420, z / 420, seed);
    const fine = valueNoise(x / 125, z / 125, seed ^ 0x165667b1);
    if (broad > 0.76 && fine > 0.35) return 'wood';
    if (broad > 0.67) return 'scrub';
    return fine > 0.78 ? 'crop' : 'meadow';
  }

  private canopyHeightAt(x: number, z: number): number | null {
    return this.canopy?.covers(x, z) ? this.canopy.heightAt(x, z) : null;
  }

  private treeChance(cover: Cover, canopyHeight: number | null): number {
    let chance =
      cover === 'wood' ? 0.34 :
      cover === 'orchard' ? 0.7 :
      cover === 'park' ? 0.2 :
      cover === 'scrub' ? 0.045 :
      cover === 'crop' ? 0.004 :
      0.008;
    if (canopyHeight !== null) {
      if (canopyHeight < 2) return 0;
      chance *= Math.min(1.25, canopyHeight / 8);
    }
    return chance;
  }

  private nearWaterway(x: number, z: number): boolean {
    const cellX = Math.floor(x / CELL_METERS);
    const cellZ = Math.floor(z / CELL_METERS);
    const near = (segments: readonly { a: Pt; b: Pt }[]): boolean => {
      for (const segment of segments) {
        if (segmentDistance(x, z, segment.a, segment.b) <= WATERWAY_REACH) return true;
      }
      return false;
    };
    if (near(this.largeWaterSegments)) return true;
    for (let ix = cellX - 1; ix <= cellX + 1; ix++) {
      for (let iz = cellZ - 1; iz <= cellZ + 1; iz++) {
        if (near(this.waterCells.get(key(ix, iz)) ?? [])) return true;
      }
    }
    return false;
  }

  private addRoadsideTrees(
    instances: ScatterInstance[],
    cellX: number,
    cellZ: number,
    rng: () => number,
  ): void {
    const centerX = (cellX + 0.5) * CELL_METERS;
    const centerZ = (cellZ + 0.5) * CELL_METERS;
    this.sources.roads.forEachSegmentNear(centerX, centerZ, CELL_METERS, (segment) => {
      const dx = segment.bx - segment.ax;
      const dz = segment.bz - segment.az;
      const length = Math.hypot(dx, dz);
      if (length < 8) return;
      const spacing = 26;
      const phase = hash(this.seed, segment.id, segment.road, 0x2b992ddf) * spacing;
      const steps = Math.ceil(length / spacing);
      for (let step = 0; step < steps; step++) {
        const distance = phase + step * spacing;
        if (distance > length) continue;
        const t = distance / length;
        const x = segment.ax + dx * t;
        const z = segment.az + dz * t;
        const nx = -dz / length;
        const nz = dx / length;
        for (const side of [-1, 1]) {
          const chance = Math.min(0.82, 0.36 * this.treeDensity);
          if (hash(this.seed, segment.id, step, side * 0x45d9f3b) > chance) continue;
          const offset = segment.w + 4.5 + hash(this.seed, segment.id, step, side * 0x27d4eb2d) * 5;
          const px = x + nx * side * offset;
          const pz = z + nz * side * offset;
          if (Math.floor(px / CELL_METERS) !== cellX || Math.floor(pz / CELL_METERS) !== cellZ) continue;
          const cover = this.coverAt(px, pz);
          this.addTree(instances, px, pz, cover, this.canopyHeightAt(px, pz), this.nearWaterway(px, pz), true, rng);
        }
      }
    });
  }

  private addRoadsideShrubs(
    instances: ScatterInstance[],
    cellX: number,
    cellZ: number,
    rng: () => number,
  ): void {
    if (this.shrubDensity <= 0) return;
    const centerX = (cellX + 0.5) * CELL_METERS;
    const centerZ = (cellZ + 0.5) * CELL_METERS;
    this.sources.roads.forEachSegmentNear(centerX, centerZ, CELL_METERS, (segment) => {
      const dx = segment.bx - segment.ax;
      const dz = segment.bz - segment.az;
      const length = Math.hypot(dx, dz);
      if (length < 8) return;
      const spacing = 7;
      const phase = hash(this.seed, segment.id, segment.road, 0x6d2b79f5) * spacing;
      const steps = Math.ceil(length / spacing);
      for (let step = 0; step < steps; step++) {
        const distance = phase + step * spacing;
        if (distance > length) continue;
        const t = distance / length;
        const x = segment.ax + dx * t;
        const z = segment.az + dz * t;
        const nx = -dz / length;
        const nz = dx / length;
        for (const side of [-1, 1]) {
          const offsetNoise = hash(this.seed, segment.id, step, side * 0x4cf5ad43);
          const px = x + nx * side * (segment.w + 1.8 + offsetNoise * 2.8);
          const pz = z + nz * side * (segment.w + 1.8 + offsetNoise * 2.8);
          if (Math.floor(px / CELL_METERS) !== cellX || Math.floor(pz / CELL_METERS) !== cellZ) continue;
          const cover = this.coverAt(px, pz);
          if (cover === 'wood' || cover === 'orchard' || cover === 'park') continue;
          const chance = Math.min(0.7, (cover === 'scrub' ? 0.58 : cover === 'crop' ? 0.12 : 0.3) * this.shrubDensity);
          if (hash(this.seed, segment.id, step, side * 0x27d4eb2d) >= chance) continue;
          this.addSmallObject(instances, 'shrub', px, pz, 0.7 + rng() * 0.85, rng);
        }
      }
    });
  }

  private addTree(
    instances: ScatterInstance[],
    x: number,
    z: number,
    cover: Cover,
    canopyHeight: number | null,
    nearWater: boolean,
    roadside: boolean,
    rng: () => number,
  ): void {
    if (this.treeDensity <= 0) return;
    if (this.sources.roads.isOnRoad(x, z, 2.2)) return;
    if (this.sources.buildings.hitsCircle(x, z, 2.4)) return;
    if (insidePaved(x, z, this.paved)) return;
    const slope = this.sources.heights.slopeAt(x, z);
    if (slope > (roadside ? 38 : 34)) return;
    if (canopyHeight !== null && canopyHeight < 2 && !roadside) return;

    const kind: ScatterKind =
      nearWater && rng() < 0.7 ? 'poplar' :
      cover === 'orchard' ? 'olive' :
      cover === 'park' && rng() < 0.12 ? 'cypress' :
      cover === 'wood' && rng() < 0.04 ? 'cypress' :
      'broadleaf';
    const nominalHeight =
      kind === 'olive' ? 5.8 :
      kind === 'cypress' ? 10.2 :
      kind === 'poplar' ? 12.5 :
      8.6;
    let scale = (0.82 + rng() * 0.38) * this.treeDensity ** 0.08;
    if (canopyHeight !== null && canopyHeight >= 3) {
      scale = Math.max(0.55, Math.min(1.75, canopyHeight / nominalHeight));
    }
    this.push(instances, kind, x, z, scale, rng);
  }

  private addSmallObject(
    instances: ScatterInstance[],
    kind: 'shrub' | 'rock',
    x: number,
    z: number,
    scale: number,
    rng: () => number,
  ): void {
    if (this.sources.roads.isOnRoad(x, z, kind === 'rock' ? 1.2 : 1.8)) return;
    if (this.sources.buildings.hitsCircle(x, z, 1.1)) return;
    if (insidePaved(x, z, this.paved)) return;
    this.push(instances, kind, x, z, scale, rng);
  }

  private push(
    instances: ScatterInstance[],
    kind: ScatterKind,
    x: number,
    z: number,
    scale: number,
    rng: () => number,
  ): void {
    instances.push({
      kind,
      x,
      y: this.sources.heights.heightAt(x, z),
      z,
      scale,
      rotation: rng() * Math.PI * 2,
      variation: Math.floor(rng() * 4),
    });
  }
}

import { distanceToSegment2, pointInPolygon } from '../geo/geo';
import type { Heightfield } from '../geo/elevation';
import type { Area, Building, BuildingIndex, RoadIndex, RoadSegment } from '../geo/osm';
import { COVER_MEADOW, COVER_WOOD, coverClass, type CoverClass } from './ground-mask';
import { insidePaved, pavedBounds, type PavedArea } from './paved';

/**
 * Fotografia locale del terreno per piantare una cella.
 *
 * `GroundMask` rasterizzava l'intero disco (0,5 m di passo) a ogni
 * ricostruzione: 70-90 ms di blocco ogni 15-18 m, cioè lo scatto che si vedeva
 * guidando. Per una cella da 12-16 m serve una frazione di quella griglia, e
 * soprattutto serve **una volta sola**, non a ogni movimento.
 *
 * Qui si prendono i segmenti di strada, gli edifici, le aree e le superfici
 * lastricate che intersecano il cerchio della cella (una query spaziale) e poi
 * ogni punto si risolve con aritmetica locale: nessun `isOnRoad` (6,7 µs per
 * chiamata, perché scandisce celle da 140 m) e nessun array temporaneo.
 *
 * Le regole sono le stesse della maschera: strada allargata, marciapiede,
 * piazza, impronta degli edifici e pendio oltre 30° bloccano la vegetazione;
 * la copertura del suolo segue le aree OSM con la priorità di `coverClass`.
 */
const VERGE_FULL = 6.4;

/**
 * Indice spaziale delle aree OSM, costruito una volta.
 *
 * `LocalGround.prepare` filtra per cerchio: senza indice ogni cella dovrebbe
 * scorrere tutte le ~1.400 aree della mappa. Con le celle da 200 m la lista si
 * riduce a poche decine di poligoni.
 */
export class AreaLookup {
  private readonly cells = new Map<number, Area[]>();
  private source: readonly Area[] | null = null;
  private readonly scratch: Area[] = [];

  constructor(private readonly size = 200) {}

  refresh(areas: readonly Area[]): void {
    if (this.source === areas) return;
    this.source = areas;
    this.cells.clear();
    for (const area of areas) {
      const b = area.bounds;
      const c0 = Math.floor(b.minX / this.size);
      const c1 = Math.floor(b.maxX / this.size);
      const d0 = Math.floor(b.minZ / this.size);
      const d1 = Math.floor(b.maxZ / this.size);
      for (let cx = c0; cx <= c1; cx++) {
        for (let cz = d0; cz <= d1; cz++) {
          const key = (cx + 32768) * 65536 + (cz + 32768);
          const list = this.cells.get(key);
          if (list) list.push(area);
          else this.cells.set(key, [area]);
        }
      }
    }
  }

  /** Aree che possono intersecare il cerchio (array riusato: non conservarlo). */
  near(x: number, z: number, radius: number): Area[] {
    this.scratch.length = 0;
    const c0 = Math.floor((x - radius) / this.size);
    const c1 = Math.floor((x + radius) / this.size);
    const d0 = Math.floor((z - radius) / this.size);
    const d1 = Math.floor((z + radius) / this.size);
    const r = radius + 8;
    for (let cx = c0; cx <= c1; cx++) {
      for (let cz = d0; cz <= d1; cz++) {
        const list = this.cells.get((cx + 32768) * 65536 + (cz + 32768));
        if (!list) continue;
        for (const area of list) {
          if (this.scratch.includes(area)) continue;
          const b = area.bounds;
          if (b.maxX < x - r || b.minX > x + r || b.maxZ < z - r || b.minZ > z + r) continue;
          this.scratch.push(area);
        }
      }
    }
    return this.scratch;
  }
}

export class LocalGround {
  private segments: RoadSegment[] = [];
  private buildings: Building[] = [];
  private areas: Area[] = [];
  private paved: PavedArea[] = [];
  private heights!: Heightfield;
  private roads!: RoadIndex;
  private buildingIndex!: BuildingIndex;
  private cx = 0;
  private cz = 0;
  private radius = 0;

  /** Collega gli indici del mondo (possono cambiare quando arrivano tile). */
  bind(heights: Heightfield, roads: RoadIndex, buildings: BuildingIndex): void {
    this.heights = heights;
    this.roads = roads;
    this.buildingIndex = buildings;
    this.segments.length = 0;
    this.buildings = [];
  }

  /** Prende tutto ciò che può toccare il cerchio (x, z, radius). */
  prepare(x: number, z: number, radius: number, areas: readonly Area[], paved: readonly PavedArea[]): void {
    this.cx = x;
    this.cz = z;
    this.radius = radius;
    this.segments.length = 0;
    // `forEachSegmentNear` deduplica i segmenti indicizzati su più celle
    this.roads.forEachSegmentNear(x, z, radius + 4, (segment) => {
      this.segments.push(segment);
    });
    this.buildings = this.buildingIndex.near(x, z);
    this.areas.length = 0;
    const r = radius + 8;
    for (const area of areas) {
      const b = area.bounds;
      if (b.maxX < x - r || b.minX > x + r || b.maxZ < z - r || b.minZ > z + r) continue;
      this.areas.push(area);
    }
    this.paved.length = 0;
    for (const area of paved) {
      const b = pavedBounds(area);
      if (b.maxX < x - r || b.minX > x + r || b.maxZ < z - r || b.minZ > z + r) continue;
      this.paved.push(area);
    }
  }

  /** Segmenti di strada nel cerchio preparato (per campionare i cigli). */
  get roadSegments(): readonly RoadSegment[] {
    return this.segments;
  }

  height(x: number, z: number): number {
    return this.heights.heightAt(x, z);
  }

  /** Pendenza in gradi dal gradiente a 0,7 m. */
  slope(x: number, z: number): number {
    const step = 0.7;
    const gx = (this.heights.heightAt(x + step, z) - this.heights.heightAt(x - step, z)) / (2 * step);
    const gz = (this.heights.heightAt(x, z + step) - this.heights.heightAt(x, z - step)) / (2 * step);
    return (Math.atan(Math.hypot(gx, gz)) * 180) / Math.PI;
  }

  /** Distanza dal ciglio della strada più vicina, saturata a 6,4 m. */
  roadDistance(x: number, z: number): number {
    let best = VERGE_FULL;
    for (const s of this.segments) {
      if (x < s.minX - VERGE_FULL - s.w || x > s.maxX + VERGE_FULL + s.w) continue;
      if (z < s.minZ - VERGE_FULL - s.w || z > s.maxZ + VERGE_FULL + s.w) continue;
      const d = distanceToSegment2(x, z, s.ax, s.az, s.bx, s.bz) - s.w;
      if (d < best) best = d;
    }
    return best;
  }

  /** Sul marciapiede (o sul cordolo): l'erba non cresce sulle lastre. */
  onSidewalk(x: number, z: number): boolean {
    for (const s of this.segments) {
      if (s.walk <= 0) continue;
      if (x < s.minX - s.w - s.walk || x > s.maxX + s.w + s.walk) continue;
      if (z < s.minZ - s.w - s.walk || z > s.maxZ + s.w + s.walk) continue;
      const d = distanceToSegment2(x, z, s.ax, s.az, s.bx, s.bz);
      if (d > s.w && d <= s.w + s.walk + 0.1) return true;
    }
    return false;
  }

  /** true se il punto è dentro una carreggiata (con tolleranza). */
  onRoad(x: number, z: number, tolerance = 0): boolean {
    for (const s of this.segments) {
      if (x < s.minX - s.w - tolerance || x > s.maxX + s.w + tolerance) continue;
      if (z < s.minZ - s.w - tolerance || z > s.maxZ + s.w + tolerance) continue;
      if (distanceToSegment2(x, z, s.ax, s.az, s.bx, s.bz) <= s.w + tolerance) return true;
    }
    return false;
  }

  /** true se il cerchio tocca un edificio (impronta o bordo). */
  onBuilding(x: number, z: number, radius = 0): boolean {
    for (const b of this.buildings) {
      if (x < b.bounds.minX - radius || x > b.bounds.maxX + radius) continue;
      if (z < b.bounds.minZ - radius || z > b.bounds.maxZ + radius) continue;
      if (pointInPolygon(x, z, b.points)) return true;
      for (let i = 0, j = b.points.length - 1; i < b.points.length; j = i++) {
        const a = b.points[i]!;
        const c = b.points[j]!;
        if (distanceToSegment2(x, z, c.x, c.z, a.x, a.z) < radius) return true;
      }
    }
    return false;
  }

  /** Piazza, sagrato e altre superfici lastricate. */
  onPaved(x: number, z: number): boolean {
    return this.paved.length > 0 && insidePaved(x, z, this.paved);
  }

  /** Erba/sottobosco può crescere qui? (strada, marciapiede, lastre, casa) */
  free(x: number, z: number, roadTolerance = 0, buildingRadius = 0): boolean {
    if (this.onSidewalk(x, z)) return false;
    if (this.onRoad(x, z, roadTolerance)) return false;
    if (this.onBuilding(x, z, buildingRadius)) return false;
    if (this.onPaved(x, z)) return false;
    return true;
  }

  /** Copertura del suolo nel punto (la più specifica vince, come la maschera). */
  cover(x: number, z: number): CoverClass {
    let best = COVER_MEADOW;
    let bestPriority = 0;
    for (const area of this.areas) {
      const b = area.bounds;
      if (x < b.minX || x > b.maxX || z < b.minZ || z > b.maxZ) continue;
      const cls = coverClass(area.kind);
      if (cls === COVER_MEADOW) continue;
      const priority = cls === COVER_WOOD ? 3 : cls === 2 ? 2 : 1;
      if (priority <= bestPriority) continue;
      if (!pointInPolygon(x, z, area.points)) continue;
      best = cls;
      bestPriority = priority;
    }
    return best;
  }

  /** Distanza dal centro del cerchio preparato (per diagnostica). */
  distanceFromCentre(x: number, z: number): number {
    return Math.hypot(x - this.cx, z - this.cz);
  }

  get preparedRadius(): number {
    return this.radius;
  }
}

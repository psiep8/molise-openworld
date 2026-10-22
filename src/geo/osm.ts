import { latLonToWorld } from '../config';
import { boundsOf, distanceToSegment2, pointInPolygon, type Bounds, type Pt } from './geo';

/**
 * Quote dei piani stradali sopra il DEM, condivise da chi disegna le strade e
 * da chi ci cammina sopra. Se cambiano qui cambiano ovunque.
 */
export const ROAD_LIFT = 0.2;
export const DIRT_LIFT = 0.12;
export const CURB_HEIGHT = 0.18;

/** Micro-offset per strada: evita lo z-fighting dei nastri negli incroci. */
export function roadLift(index: number, paved: boolean): number {
  return (paved ? ROAD_LIFT : DIRT_LIFT) + (index % 7) * 0.004;
}

interface RawOsm {
  generatedAt: string;
  attribution: string;
  stats: Record<string, number>;
  places: { n: string; k: string; lat: number; lon: number }[];
  roads: { t: string; n?: string; c: [number, number][] }[];
  buildings: { h: number; c: [number, number][] }[];
  areas: { k: string; c: [number, number][] }[];
  waterways: { t: string; c: [number, number][] }[];
}

export interface Place {
  name: string;
  kind: string;
  x: number;
  z: number;
}

export interface Road {
  type: string;
  name: string;
  width: number;
  paved: boolean;
  points: Pt[];
  bounds: Bounds;
}

export interface Building {
  height: number;
  points: Pt[];
  bounds: Bounds;
  area: number;
}

export interface Area {
  kind: string;
  points: Pt[];
  bounds: Bounds;
}

export interface Waterway {
  type: string;
  points: Pt[];
}

export interface OsmData {
  generatedAt: string;
  attribution: string;
  stats: Record<string, number>;
  places: Place[];
  roads: Road[];
  buildings: Building[];
  areas: Area[];
  waterways: Waterway[];
}

const ROAD_WIDTHS: Record<string, number> = {
  motorway: 9,
  trunk: 8.5,
  primary: 8,
  secondary: 7,
  tertiary: 6.2,
  unclassified: 5.4,
  residential: 5.2,
  living_street: 4.6,
  service: 3.6,
  track: 3,
  road: 4.5,
  pedestrian: 4.5,
  footway: 1.6,
  path: 1.4,
  cycleway: 2,
  bridleway: 1.8,
};

const DIRT_ROADS = new Set(['track', 'path', 'footway', 'bridleway']);

export function roadWidth(type: string): number {
  return ROAD_WIDTHS[type] ?? 4.5;
}

export function roadSurface(type: string): 'asphalt' | 'dirt' {
  return DIRT_ROADS.has(type) ? 'dirt' : 'asphalt';
}

export const AREA_COLORS: Record<string, number> = {
  wood: 0x3f5a34,
  forest: 0x3f5a34,
  scrub: 0x6b7c45,
  water: 0x3f6f86,
  grassland: 0x7c8f52,
  meadow: 0x86995a,
  residential: 0x8d8677,
  industrial: 0x8a8378,
  quarry: 0x9a948a,
  vineyard: 0x6f7f3f,
  orchard: 0x5f7a42,
  farmyard: 0x8b8064,
  park: 0x5c7a45,
  pitch: 0x6a7d52,
};

function project(coords: [number, number][]): Pt[] {
  return coords.map(([lat, lon]) => {
    const p = latLonToWorld(lat, lon);
    return { x: p.x, z: p.z };
  });
}

function ringArea(points: Pt[]): number {
  let a = 0;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    a += (points[j].x + points[i].x) * (points[j].z - points[i].z);
  }
  return Math.abs(a / 2);
}

/**
 * Altezza minima per classe di superficie.
 *
 * Il generatore dei dati, quando OSM non ha `height` né `building:levels`,
 * assegna 2,8–4,2 m alle impronte sotto i 45 m²: nel gioco diventano case di un
 * piano con il portone che sembra interrato. In un centro molisano una casa è
 * di due o tre piani; i garage restano bassi.
 */
function minBuildingHeight(area: number, height: number): number {
  if (area < 24) return Math.max(height, 3.4);
  if (area < 70) return Math.max(height, 6.4);
  if (area < 160) return Math.max(height, 7.6);
  return Math.max(height, 8.6);
}

export async function loadOsm(base = './geo/'): Promise<OsmData> {
  const res = await fetch(`${base}osm.json`);
  if (!res.ok) throw new Error(`osm.json: HTTP ${res.status} (esegui "npm run geo")`);
  const raw = (await res.json()) as RawOsm;

  const roads: Road[] = raw.roads.map((r) => {
    const points = project(r.c);
    return {
      type: r.t,
      name: r.n ?? '',
      width: roadWidth(r.t),
      paved: roadSurface(r.t) === 'asphalt',
      points,
      bounds: boundsOf(points),
    };
  });

  const buildings: Building[] = raw.buildings.map((b) => {
    const points = project(b.c);
    const area = ringArea(points);
    return { height: minBuildingHeight(area, b.h), points, bounds: boundsOf(points), area };
  });

  const areas: Area[] = raw.areas.map((a) => {
    const points = project(a.c);
    return { kind: a.k, points, bounds: boundsOf(points) };
  });

  const waterways: Waterway[] = raw.waterways.map((w) => ({
    type: w.t,
    points: project(w.c),
  }));

  const places: Place[] = raw.places.map((p) => {
    const w = latLonToWorld(p.lat, p.lon);
    return { name: p.n, kind: p.k, x: w.x, z: w.z };
  });

  return {
    generatedAt: raw.generatedAt,
    attribution: raw.attribution,
    stats: raw.stats,
    places,
    roads,
    buildings,
    areas,
    waterways,
  };
}

/** Indice spaziale delle strade: serve alla fisica (on/off-road) e allo spawn. */
export class RoadIndex {
  private readonly cell = 140;
  private readonly grid = new Map<
    number,
    { ax: number; az: number; bx: number; bz: number; w: number; lift: number; paved: boolean; walk: number; road: number }[]
  >();
  private readonly roads: Road[];

  constructor(roads: Road[]) {
    this.roads = roads;
    for (const [index, road] of roads.entries()) {
      const half = road.width / 2;
      const lift = roadLift(index, road.paved);
      const walk = road.paved ? (road.width >= 6 ? 1.8 : 1.45) : 0;
      for (let i = 1; i < road.points.length; i++) {
        const a = road.points[i - 1];
        const b = road.points[i];
        const seg = { ax: a.x, az: a.z, bx: b.x, bz: b.z, w: half, lift, paved: road.paved, walk, road: index };
        const minX = Math.min(a.x, b.x) - half;
        const maxX = Math.max(a.x, b.x) + half;
        const minZ = Math.min(a.z, b.z) - half;
        const maxZ = Math.max(a.z, b.z) + half;
        for (let cx = Math.floor(minX / this.cell); cx <= Math.floor(maxX / this.cell); cx++) {
          for (let cz = Math.floor(minZ / this.cell); cz <= Math.floor(maxZ / this.cell); cz++) {
            const key = this.key(cx, cz);
            let list = this.grid.get(key);
            if (!list) {
              list = [];
              this.grid.set(key, list);
            }
            list.push(seg);
          }
        }
      }
    }
  }

  private key(cx: number, cz: number): number {
    return (cx + 4096) * 8192 + (cz + 4096);
  }

  /**
   * true se il punto è su una strada (asfalto o sterrato), con un po' di
   * tolleranza. `except` esclude una strada: serve ai marciapiedi, che non
   * devono interrompersi sul bordo della propria carreggiata.
   */
  isOnRoad(x: number, z: number, tolerance = 0.8, except = -1): boolean {
    const cx = Math.floor(x / this.cell);
    const cz = Math.floor(z / this.cell);
    for (let ix = cx - 1; ix <= cx + 1; ix++) {
      for (let iz = cz - 1; iz <= cz + 1; iz++) {
        const list = this.grid.get(this.key(ix, iz));
        if (!list) continue;
        for (const s of list) {
          if (s.road === except) continue;
          if (distanceToSegment2(x, z, s.ax, s.az, s.bx, s.bz) <= s.w + tolerance) return true;
        }
      }
    }
    return false;
  }

  /**
   * Dislivello del piano calpestabile rispetto al DEM: asfalto (0,20 m),
   * marciapiede (asfalto + cordolo) oppure 0 sul prato.
   *
   * Giocatore e auto usano questa quota: prima il giocatore camminava 20 cm
   * sotto il manto stradale e sembrava di affondare nella sabbia.
   */
  surfaceOffset(x: number, z: number): number {
    const cx = Math.floor(x / this.cell);
    const cz = Math.floor(z / this.cell);
    let asphalt = -1;
    let walk = -1;
    let walkRoad = -1;
    for (let ix = cx - 1; ix <= cx + 1; ix++) {
      for (let iz = cz - 1; iz <= cz + 1; iz++) {
        const list = this.grid.get(this.key(ix, iz));
        if (!list) continue;
        for (const s of list) {
          const d = distanceToSegment2(x, z, s.ax, s.az, s.bx, s.bz);
          if (d <= s.w) {
            if (s.lift > asphalt) asphalt = s.lift;
          } else if (s.paved && s.walk > 0 && d <= s.w + s.walk) {
            const top = s.lift + CURB_HEIGHT;
            if (top > walk) {
              walk = top;
              walkRoad = s.road;
            }
          }
        }
      }
    }
    // l'asfalto vince sul marciapiede: ai bordi degli incroci i due nastri si
    // sovrappongono e il manto stradale è quello che si vede
    if (asphalt >= 0) return asphalt;
    if (walk < 0) return 0;
    // il marciapiede si interrompe agli incroci: entro 40 cm dall'asfalto di
    // un'altra strada non c'è pavimentazione, si cammina sul terreno
    for (let ix = cx - 1; ix <= cx + 1; ix++) {
      for (let iz = cz - 1; iz <= cz + 1; iz++) {
        const list = this.grid.get(this.key(ix, iz));
        if (!list) continue;
        for (const s of list) {
          if (s.road === walkRoad) continue;
          if (distanceToSegment2(x, z, s.ax, s.az, s.bx, s.bz) <= s.w + 0.4) return 0;
        }
      }
    }
    return walk;
  }

  /** Punto stradale più vicino, per far comparire auto e giocatore in strada. */
  nearest(x: number, z: number): { x: number; z: number; road: Road } | null {
    let best: { x: number; z: number; road: Road; d: number } | null = null;
    for (const road of this.roads) {
      if (!road.paved) continue;
      for (const p of road.points) {
        const d = Math.hypot(p.x - x, p.z - z);
        if (!best || d < best.d) best = { x: p.x, z: p.z, road, d };
      }
    }
    return best ? { x: best.x, z: best.z, road: best.road } : null;
  }
}

/** Indice spaziale degli edifici per le collisioni (e per non piantarci alberi dentro). */
export class BuildingIndex {
  private readonly cell = 90;
  private readonly grid = new Map<number, Building[]>();
  readonly all: Building[];

  constructor(buildings: Building[]) {
    this.all = buildings;
    for (const b of buildings) this.index(b);
  }

  private index(b: Building): void {
    for (let cx = Math.floor(b.bounds.minX / this.cell); cx <= Math.floor(b.bounds.maxX / this.cell); cx++) {
      for (let cz = Math.floor(b.bounds.minZ / this.cell); cz <= Math.floor(b.bounds.maxZ / this.cell); cz++) {
        const key = (cx + 4096) * 8192 + (cz + 4096);
        let list = this.grid.get(key);
        if (!list) {
          list = [];
          this.grid.set(key, list);
        }
        list.push(b);
      }
    }
  }

  /**
   * Aggiunge un'impronta costruita fuori dai dati OSM (per ora la chiesa).
   * Serve perché alberi, cespugli, erba e giocatore la trattino come una casa.
   */
  add(building: Building): void {
    this.all.push(building);
    this.index(building);
  }

  near(x: number, z: number): Building[] {
    const cx = Math.floor(x / this.cell);
    const cz = Math.floor(z / this.cell);
    const out: Building[] = [];
    for (let ix = cx - 1; ix <= cx + 1; ix++) {
      for (let iz = cz - 1; iz <= cz + 1; iz++) {
        const list = this.grid.get((ix + 4096) * 8192 + (iz + 4096));
        if (list) out.push(...list);
      }
    }
    return out;
  }

  /**
   * Spinge un cerchio (giocatore/auto) fuori dalle impronte degli edifici.
   * Restituisce la nuova posizione e se c'è stata una collisione.
   */
  resolveCircle(x: number, z: number, radius: number): { x: number; z: number; hit: boolean } {
    let px = x;
    let pz = z;
    let hit = false;
    for (const b of this.near(x, z)) {
      if (
        px < b.bounds.minX - radius ||
        px > b.bounds.maxX + radius ||
        pz < b.bounds.minZ - radius ||
        pz > b.bounds.maxZ + radius
      ) {
        continue;
      }
      const inside = pointInPolygon(px, pz, b.points);
      let closestDist = Infinity;
      let cx = 0;
      let cz = 0;
      for (let i = 0, j = b.points.length - 1; i < b.points.length; j = i++) {
        const a = b.points[i];
        const c = b.points[j];
        const abx = c.x - a.x;
        const abz = c.z - a.z;
        const len2 = abx * abx + abz * abz || 1e-6;
        let t = ((px - a.x) * abx + (pz - a.z) * abz) / len2;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const qx = a.x + abx * t;
        const qz = a.z + abz * t;
        const d = Math.hypot(px - qx, pz - qz);
        if (d < closestDist) {
          closestDist = d;
          cx = qx;
          cz = qz;
        }
      }
      if (inside || closestDist < radius) {
        const dx = px - cx;
        const dz = pz - cz;
        const len = Math.hypot(dx, dz) || 1;
        const push = inside ? closestDist + radius : radius - closestDist;
        px += (dx / len) * push;
        pz += (dz / len) * push;
        hit = true;
      }
    }
    return { x: px, z: pz, hit };
  }
}

import { latLonToWorld } from '../config';
import type { Heightfield } from './elevation';
import { boundsOf, distanceToSegment2, pointInPolygon, type Bounds, type Pt } from './geo';

/**
 * Quote dei piani stradali sopra il DEM, condivise da chi disegna le strade e
 * da chi ci cammina sopra. Se cambiano qui cambiano ovunque.
 */
export const ROAD_LIFT = 0.2;
export const DIRT_LIFT = 0.12;
export const CURB_HEIGHT = 0.18;
/** Fascia di ghiaia ai bordi delle strade di campagna (m). */
export const SHOULDER_WIDTH = 0.8;

/** Micro-offset per strada: evita lo z-fighting dei nastri negli incroci. */
export function roadLift(index: number, paved: boolean): number {
  return (paved ? ROAD_LIFT : DIRT_LIFT) + (index % 7) * 0.004;
}

interface RawOsm {
  generatedAt: string;
  attribution: string;
  stats: Record<string, number>;
  places: { n: string; k: string; lat: number; lon: number }[];
  roads: {
    t: string;
    n?: string;
    c: [number, number][];
    /** ponte */
    b?: 1;
    /** galleria */
    u?: 1;
    /** layer OSM */
    y?: number;
    /** corsie */
    ln?: number;
    /** superficie normalizzata */
    sf?: string;
    /** una corsia: 1 nel verso del way, -1 nel verso opposto */
    ow?: 1 | -1;
    ms?: number;
    wd?: number;
    r?: string;
  }[];
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
  /** Ponte carrabile: la carreggiata sta sopra il DEM. */
  bridge?: boolean;
  /** Galleria: il piano stradale non è quello del DEM soprastante. */
  tunnel?: boolean;
  /** Ordine verticale OSM (utile per incroci ponte/strada). */
  layer?: number;
  /** Numero di corsie dichiarato; undefined = non taggato. */
  lanes?: number;
  /** Superficie normalizzata (`asphalt`, `gravel`, `stone`, …). */
  surface?: string;
  /** Senso unico: 1 nel verso del way, -1 nel verso opposto. */
  oneway?: 1 | -1;
  maxspeed?: number;
  ref?: string;
  /** Larghezza presa dal tag OSM invece che dalla classe. */
  tagWidth?: number;
  /**
   * Quota assoluta dei punti sul piano stradale per ponti/gallerie. È
   * riempita da `prepareRoadElevations` e letta sia dalla grafica sia da
   * `groundAt`, così non esistono due verità diverse.
   */
  elevations?: number[];
  /**
   * Un valore per punto: il marciapiede esiste solo dove la strada attraversa
   * il costruito. In campagna la provinciale non ha cordoli né lastre, e la
   * fisica deve saperlo (altrimenti auto e giocatore galleggiano su un
   * marciapiede invisibile). Lo riempie `markTownSidewalks`. Se manca, il
   * marciapiede vale per tutta la strada (comportamento storico).
   */
  walkSpans?: boolean[];
}

/**
 * Segna, punto per punto, dove una strada asfaltata ha il marciapiede.
 *
 * Il criterio è lo stesso delle strisce e dei lampioni: il marciapiede è un
 * fatto urbano, non un accessorio della carreggiata. Prima nasceva su ogni
 * strada asfaltata della mappa, comprese le provinciali in mezzo ai campi, e
 * il risultato erano cordoli in aperta campagna (difetto annotato nel piano
 * di realismo).
 */
export function markTownSidewalks(roads: Road[], buildings: BuildingIndex): void {
  // Griglia dei centri degli edifici: conta quanti edifici ci sono entro 46 m
  // da ogni punto della strada. Non basta "una casa vicina": un casale isolato
  // in mezzo ai campi non è un marciapiede. Servono almeno 4 edifici, cioè un
  // fronte urbano vero (in paese ce ne sono decine).
  const cell = 48;
  const radius = 46;
  const minBuildings = 4;
  const grid = new Map<number, { x: number; z: number }[]>();
  const key = (cx: number, cz: number): number => (cx + 4096) * 8192 + (cz + 4096);
  for (const b of buildings.all) {
    const x = (b.bounds.minX + b.bounds.maxX) * 0.5;
    const z = (b.bounds.minZ + b.bounds.maxZ) * 0.5;
    const k = key(Math.floor(x / cell), Math.floor(z / cell));
    const list = grid.get(k);
    if (list) list.push({ x, z });
    else grid.set(k, [{ x, z }]);
  }

  for (const road of roads) {
    if (!road.paved) continue;
    const covered = road.points.map((p) => {
      const cx = Math.floor(p.x / cell);
      const cz = Math.floor(p.z / cell);
      let count = 0;
      for (let ix = cx - 1; ix <= cx + 1 && count < minBuildings; ix++) {
        for (let iz = cz - 1; iz <= cz + 1 && count < minBuildings; iz++) {
          const list = grid.get(key(ix, iz));
          if (!list) continue;
          for (const b of list) {
            if ((b.x - p.x) ** 2 + (b.z - p.z) ** 2 <= radius * radius) count++;
            if (count >= minBuildings) break;
          }
        }
      }
      return count >= minBuildings;
    });

    // Un marciapiede non nasce e muore a ogni casa: si allarga di un punto e
    // si chiudono le buche di uno o due punti, così il nastro resta continuo
    // lungo la via del paese invece di spezzarsi in frammenti.
    const spans = covered.slice();
    const spacing = (i: number): number =>
      i <= 0 || i >= road.points.length
        ? Number.POSITIVE_INFINITY
        : Math.hypot(
            road.points[i].x - road.points[i - 1].x,
            road.points[i].z - road.points[i - 1].z,
          );
    for (let i = 0; i < covered.length; i++) {
      if (!covered[i]) continue;
      // allarga di un punto solo se i due punti sono vicini: nei dati veri il
      // ricampionamento è a pochi metri, ma un test o un tratto OSM rado non
      // deve trascinarsi il marciapiede per cento metri
      if (i > 0 && spacing(i) <= 18) spans[i - 1] = true;
      if (i + 1 < spans.length && spacing(i + 1) <= 18) spans[i + 1] = true;
    }
    let last = -1;
    for (let i = 0; i < spans.length; i++) {
      if (spans[i]) {
        if (last >= 0 && i - last <= 3) for (let j = last + 1; j < i; j++) spans[j] = true;
        last = i;
      }
    }
    road.walkSpans = spans;
  }
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
    const surface = r.sf ?? (roadSurface(r.t) === 'asphalt' ? 'asphalt' : 'dirt');
    // Il tag `width` è più preciso della classe, ma un valore assurdo non deve
    // deformare la mappa: si accetta solo una forbice plausibile.
    const tagWidth = r.wd && r.wd >= 2 && r.wd <= 14 ? r.wd : undefined;
    return {
      type: r.t,
      name: r.n ?? '',
      // Senza `width`, le corsie dichiarate sono un indizio migliore della
      // sola classe: una provinciale a due corsie non è larga come un vicolo.
      width: tagWidth ?? (r.ln && r.ln >= 2 ? Math.max(roadWidth(r.t), r.ln * 2.75 + 0.8) : roadWidth(r.t)),
      paved: surface !== 'dirt' && surface !== 'gravel' && surface !== 'grass' && surface !== 'other',
      surface,
      tagWidth,
      bridge: r.b === 1,
      tunnel: r.u === 1,
      layer: r.y,
      lanes: r.ln,
      oneway: r.ow,
      maxspeed: r.ms,
      ref: r.r,
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

export const BRIDGE_CLEARANCE = 0.28;

/**
 * Quota del piano stradale per ponti e gallerie.
 *
 * OSM dice *che* un tratto è un ponte, non a che quota sta il impalcato. Il
 * DEM ai due imbocchi è invece affidabile: la campata viene interpolata fra le
 * due testate, con un filo di franco. È la stessa quota usata dal nastro
 * stradale e da `groundAt`, quindi l'auto non attraversa più il vuoto sotto il
 * ponte né "scala" il terreno del torrente.
 */
export function prepareRoadElevations(roads: Road[], heights: Heightfield): void {
  for (const road of roads) {
    if (!road.bridge && !road.tunnel) {
      road.elevations = undefined;
      continue;
    }
    // Le gallerie non hanno ancora un foro scavato nel terreno: fino a quando
    // non c'è il portale, il piano stradale resta quello del DEM (la strada si
    // vede in superficie) invece di far sprofondare il giocatore nel monte.
    if (road.tunnel && !road.bridge) {
      road.elevations = undefined;
      continue;
    }
    const n = road.points.length;
    if (n < 2) continue;
    const first = road.points[0]!;
    const last = road.points[n - 1]!;
    const h0 = heights.heightAt(first.x, first.z);
    const h1 = heights.heightAt(last.x, last.z);
    const clearance = road.bridge ? BRIDGE_CLEARANCE : 0;
    const out = new Array<number>(n);
    let travelled = 0;
    const lengths = new Array<number>(n).fill(0);
    for (let i = 1; i < n; i++) {
      travelled += Math.hypot(road.points[i]!.x - road.points[i - 1]!.x, road.points[i]!.z - road.points[i - 1]!.z);
      lengths[i] = travelled;
    }
    const total = travelled || 1;
    for (let i = 0; i < n; i++) {
      const t = lengths[i]! / total;
      // Campata rettilinea: la stessa interpolazione è usata dal nastro
      // grafico, quindi non ci sono due quote diverse a metà ponte.
      out[i] = h0 + (h1 - h0) * t + clearance;
    }
    road.elevations = out;
  }
}

/** Quota interpolata del piano stradale preparato, per un punto del way. */
export function roadElevationAt(road: Road, index: number, t: number): number | undefined {
  const e = road.elevations;
  if (!e) return undefined;
  const a = e[Math.max(0, Math.min(e.length - 1, index))]!;
  const b = e[Math.max(0, Math.min(e.length - 1, index + 1))]!;
  return a + (b - a) * t;
}

/**
 * Segmento stradale indicizzato.
 *
 * L'AABB è già gonfiato della semilarghezza: le query possono scartare un
 * segmento con quattro confronti prima di calcolare la distanza vera. In un
 * centro storico la griglia contiene centinaia di segmenti per cella e questo
 * scarto è la differenza fra 6 secondi e 40 ms di ricostruzione dell'erba.
 */
interface RoadSegment {
  id: number;
  ax: number;
  az: number;
  bx: number;
  bz: number;
  w: number;
  lift: number;
  paved: boolean;
  surface: string;
  lanes: number;
  walk: number;
  road: number;
  index: number;
  bridge: boolean;
  tunnel: boolean;
  /** quota assoluta delle due testate, solo per ponti/gallerie */
  elevA?: number;
  elevB?: number;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

/** Piano calpestabile restituito dall'indice stradale. */
export interface RoadSurfaceSample {
  y: number;
  /** y - terreno: serve al sobbalzo del cordolo e alla camera */
  lift: number;
  kind: 'road' | 'shoulder' | 'sidewalk' | 'bridge' | 'tunnel';
  road: number;
  paved: boolean;
  surface: string;
}

/** Indice spaziale delle strade: serve alla fisica (on/off-road) e allo spawn. */
export class RoadIndex {
  private readonly cell = 140;
  private readonly grid = new Map<number, RoadSegment[]>();
  private readonly roads: Road[];

  constructor(roads: Road[], heights?: Heightfield) {
    this.roads = roads;
    let nextId = 0;
    for (const [index, road] of roads.entries()) {
      const half = road.width / 2;
      const lift = roadLift(index, road.paved);
      // Stessa larghezza del nastro in `roads.ts`: 1,45 m sulle strade larghe
      // e 1,15 m nei vicoli. Se qui restasse 1,8/1,45 il giocatore camminerebbe
      // 35 cm fuori dal marciapiede visibile.
      const walkWidth = road.paved ? (road.width >= 6 ? 1.45 : 1.15) : 0;
      for (let i = 1; i < road.points.length; i++) {
        const a = road.points[i - 1];
        const b = road.points[i];
        // marciapiede solo nel costruito: la fisica deve combaciare col nastro
        const walk = road.walkSpans
          ? road.walkSpans[i - 1] || road.walkSpans[i]
            ? walkWidth
            : 0
          : walkWidth;
        const minX = Math.min(a.x, b.x) - half;
        const maxX = Math.max(a.x, b.x) + half;
        const minZ = Math.min(a.z, b.z) - half;
        const maxZ = Math.max(a.z, b.z) + half;
        const bridge = road.bridge === true;
        const tunnel = road.tunnel === true;
        const elevA = road.elevations?.[i - 1] ?? (heights ? heights.heightAt(a.x, a.z) : undefined);
        const elevB = road.elevations?.[i] ?? (heights ? heights.heightAt(b.x, b.z) : undefined);
        const seg: RoadSegment = {
          id: nextId++,
          ax: a.x,
          az: a.z,
          bx: b.x,
          bz: b.z,
          w: half,
          lift,
          paved: road.paved,
          surface: road.surface ?? (road.paved ? 'asphalt' : 'dirt'),
          lanes: road.lanes ?? (road.width >= 6.5 ? 2 : 1),
          walk,
          road: index,
          index: i - 1,
          bridge,
          tunnel,
          // La galleria non ha ancora un foro nel terreno: solo il ponte usa
          // una quota diversa dal DEM. Per la galleria il nastro resta a terra.
          elevA: bridge ? elevA : undefined,
          elevB: bridge ? elevB : undefined,
          minX,
          maxX,
          minZ,
          maxZ,
        };
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

  /**
   * Visita una volta sola i segmenti che possono stare entro `radius` dal
   * punto. La griglia duplica i segmenti su più celle, quindi il `Set` evita
   * di contarli (e campionarli) due volte.
   */
  forEachSegmentNear(
    x: number,
    z: number,
    radius: number,
    visit: (segment: RoadSegment) => void,
  ): void {
    const seen = new Set<number>();
    const cx0 = Math.floor((x - radius) / this.cell);
    const cx1 = Math.floor((x + radius) / this.cell);
    const cz0 = Math.floor((z - radius) / this.cell);
    const cz1 = Math.floor((z + radius) / this.cell);
    for (let cx = cx0; cx <= cx1; cx++) {
      for (let cz = cz0; cz <= cz1; cz++) {
        const list = this.grid.get(this.key(cx, cz));
        if (!list) continue;
        for (const s of list) {
          if (seen.has(s.id)) continue;
          seen.add(s.id);
          if (
            s.maxX < x - radius ||
            s.minX > x + radius ||
            s.maxZ < z - radius ||
            s.minZ > z + radius
          ) {
            continue;
          }
          visit(s);
        }
      }
    }
  }

  /**
   * Campiona i due cigli delle strade entro `radius`, a passo `spacing`.
   *
   * L'erba di bordo veniva prima cercata per rifiuto casuale nel disco: la
   * fascia utile è larga meno di mezzo metro, quindi servivano ~190.000
   * tentativi per 4.200 ciuffi. Qui il costo è proporzionale ai metri di
   * strada, non all'area del disco.
   */
  forEachRoadEdge(
    x: number,
    z: number,
    radius: number,
    spacing: number,
    visit: (px: number, pz: number) => void,
  ): void {
    const r2 = radius * radius;
    const offset = 0.18;
    this.forEachSegmentNear(x, z, radius + 2, (s) => {
      const dx = s.bx - s.ax;
      const dz = s.bz - s.az;
      const len = Math.hypot(dx, dz);
      if (len < 1e-3) return;
      // normale al segmento: il ciglio sta a ±(semilarghezza + 18 cm)
      const nx = -dz / len;
      const nz = dx / len;
      const steps = Math.max(1, Math.ceil(len / spacing));
      const side = s.w + offset;
      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const px = s.ax + dx * t;
        const pz = s.az + dz * t;
        for (let k = -1; k <= 1; k += 2) {
          const ex = px + nx * side * k;
          const ez = pz + nz * side * k;
          const ddx = ex - x;
          const ddz = ez - z;
          if (ddx * ddx + ddz * ddz > r2) continue;
          visit(ex, ez);
        }
      }
    });
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
          // scarto sull'AABB prima della distanza vera (che è molto più cara)
          if (
            x < s.minX - tolerance ||
            x > s.maxX + tolerance ||
            z < s.minZ - tolerance ||
            z > s.maxZ + tolerance
          ) {
            continue;
          }
          if (distanceToSegment2(x, z, s.ax, s.az, s.bx, s.bz) <= s.w + tolerance) return true;
        }
      }
    }
    return false;
  }

  /**
   * Distanza (m) dal ciglio della strada più vicina: 0 sul ciglio, negativa
   * dentro la carreggiata, `Infinity` se non ci sono strade vicine.
   */
  distanceFromRoad(x: number, z: number): number {
    const cx = Math.floor(x / this.cell);
    const cz = Math.floor(z / this.cell);
    let best = Infinity;
    for (let ix = cx - 1; ix <= cx + 1; ix++) {
      for (let iz = cz - 1; iz <= cz + 1; iz++) {
        const list = this.grid.get(this.key(ix, iz));
        if (!list) continue;
        for (const s of list) {
          // `best` è la distanza dal ciglio, non dal segmento: l'AABB va
          // allargato di best + semilarghezza, altrimenti si scarta una strada
          // che potrebbe ancora migliorare il risultato.
          const reach = best + s.w;
          if (
            x < s.minX - reach ||
            x > s.maxX + reach ||
            z < s.minZ - reach ||
            z > s.maxZ + reach
          ) {
            continue;
          }
          const d = distanceToSegment2(x, z, s.ax, s.az, s.bx, s.bz) - s.w;
          if (d < best) best = d;
        }
      }
    }
    return best;
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
    // spalla in ghiaia delle provinciali: 5 cm sotto il manto, 80 cm larga
    let shoulder = -1;
    for (let ix = cx - 1; ix <= cx + 1; ix++) {
      for (let iz = cz - 1; iz <= cz + 1; iz++) {
        const list = this.grid.get(this.key(ix, iz));
        if (!list) continue;
        for (const s of list) {
          // la spalla esiste anche dove non c'è marciapiede (`s.walk` vale 0)
          const reach = Math.max(s.walk, SHOULDER_WIDTH);
          if (
            x < s.minX - reach ||
            x > s.maxX + reach ||
            z < s.minZ - reach ||
            z > s.maxZ + reach
          ) {
            continue;
          }
          const d = distanceToSegment2(x, z, s.ax, s.az, s.bx, s.bz);
          if (d <= s.w) {
            if (s.lift > asphalt) asphalt = s.lift;
          } else if (s.paved && s.walk > 0 && d <= s.w + s.walk) {
            const top = s.lift + CURB_HEIGHT;
            if (top > walk) {
              walk = top;
              walkRoad = s.road;
            }
          } else if (s.paved && s.walk === 0 && d <= s.w + SHOULDER_WIDTH) {
            // fuori dal paese niente marciapiede, ma la spalla in ghiaia
            // esiste anche per le ruote: senza, l'auto affondava di 15 cm
            // appena usciva dall'asfalto
            const top = s.lift - 0.05;
            if (top > shoulder) shoulder = top;
          }
        }
      }
    }
    // l'asfalto vince sul marciapiede: ai bordi degli incroci i due nastri si
    // sovrappongono e il manto stradale è quello che si vede
    if (asphalt >= 0) return asphalt;
    if (walk < 0) return shoulder >= 0 ? shoulder : 0;
    // il marciapiede si interrompe agli incroci: entro 40 cm dall'asfalto di
    // un'altra strada non c'è pavimentazione, si cammina sul terreno
    for (let ix = cx - 1; ix <= cx + 1; ix++) {
      for (let iz = cz - 1; iz <= cz + 1; iz++) {
        const list = this.grid.get(this.key(ix, iz));
        if (!list) continue;
        for (const s of list) {
          if (s.road === walkRoad) continue;
          if (x < s.minX - 0.4 || x > s.maxX + 0.4 || z < s.minZ - 0.4 || z > s.maxZ + 0.4) continue;
          if (distanceToSegment2(x, z, s.ax, s.az, s.bx, s.bz) <= s.w + 0.4) return 0;
        }
      }
    }
    return walk;
  }

  /**
   * Piano calpestabile con quota assoluta, ponte compreso.
   *
   * `surfaceOffset` restituisce solo il dislivello rispetto al DEM; qui serve
   * la quota vera perché un ponte non può essere `altezza DEM + 20 cm`: il
   * fiume sotto è decine di metri più in basso. La stessa funzione alimenta
   * `groundAt`, l'auto, il giocatore, i pedoni e la pioggia.
   */
  sampleSurface(x: number, z: number, terrain: number): RoadSurfaceSample | null {
    const cx = Math.floor(x / this.cell);
    const cz = Math.floor(z / this.cell);
    let best: RoadSurfaceSample | null = null;
    let bestRank = -1;
    let bestY = -Infinity;
    const consider = (sample: RoadSurfaceSample, rank: number): void => {
      // La priorità è la superficie (carreggiata > marciapiede > spalla), non
      // la quota: il marciapiede sta 18 cm sopra l'asfalto ma non deve
      // "vincere" quando il punto è ancora in carreggiata.
      if (rank > bestRank || (rank === bestRank && sample.y > bestY + 0.001)) {
        best = sample;
        bestRank = rank;
        bestY = sample.y;
      }
    };
    for (let ix = cx - 1; ix <= cx + 1; ix++) {
      for (let iz = cz - 1; iz <= cz + 1; iz++) {
        const list = this.grid.get(this.key(ix, iz));
        if (!list) continue;
        for (const s of list) {
          const maxReach = Math.max(s.walk, SHOULDER_WIDTH);
          if (
            x < s.minX - maxReach ||
            x > s.maxX + maxReach ||
            z < s.minZ - maxReach ||
            z > s.maxZ + maxReach
          ) {
            continue;
          }
          const dx = s.bx - s.ax;
          const dz = s.bz - s.az;
          const len2 = dx * dx + dz * dz || 1e-6;
          const t = Math.max(0, Math.min(1, ((x - s.ax) * dx + (z - s.az) * dz) / len2));
          const qx = s.ax + dx * t;
          const qz = s.az + dz * t;
          const d = Math.hypot(x - qx, z - qz);
          if (d > s.w + maxReach) continue;

          if (d <= s.w) {
            const deck =
              s.elevA !== undefined && s.elevB !== undefined
                ? s.elevA + (s.elevB - s.elevA) * t + s.lift
                : terrain + s.lift;
            consider(
              {
                y: deck,
                lift: deck - terrain,
                kind: s.bridge ? 'bridge' : s.tunnel ? 'tunnel' : 'road',
                road: s.road,
                paved: s.paved,
                surface: s.surface,
              },
              s.bridge ? 5 : s.tunnel ? 4 : 3,
            );
            continue;
          }
          if (s.paved && s.walk > 0 && d <= s.w + s.walk) {
            consider(
              {
                y: terrain + s.lift + CURB_HEIGHT,
                lift: s.lift + CURB_HEIGHT,
                kind: 'sidewalk',
                road: s.road,
                paved: true,
                surface: s.surface,
              },
              2,
            );
            continue;
          }
          if (s.paved && s.walk === 0 && d <= s.w + SHOULDER_WIDTH) {
            consider(
              {
                y: terrain + s.lift - 0.05,
                lift: s.lift - 0.05,
                kind: 'shoulder',
                road: s.road,
                paved: true,
                surface: s.surface,
              },
              1,
            );
          }
        }
      }
    }
    return best;
  }

  /** Strada più vicina che insiste sul punto, per il rendering/guardrail. */
  roadAt(x: number, z: number, reach = 3): Road | null {
    let bestD = Infinity;
    let best: Road | null = null;
    this.forEachSegmentNear(x, z, reach, (s) => {
      const d = distanceToSegment2(x, z, s.ax, s.az, s.bx, s.bz);
      if (d <= s.w + reach && d < bestD) {
        bestD = d;
        best = this.roads[s.road] ?? null;
      }
    });
    return best;
  }

  /**
   * Segmento di strada più vicino, entro `reach` metri.
   *
   * Serve all'autopilota: la polilinea intera costringerebbe a scandire ogni
   * punto di ogni via, mentre la griglia trova il tratto giusto in una manciata
   * di celle.
   */
  nearestSegment(
    x: number,
    z: number,
    reach = 24,
  ): { ax: number; az: number; bx: number; bz: number; w: number; road: number } | null {
    let bestD = Infinity;
    let best: RoadSegment | null = null;
    this.forEachSegmentNear(x, z, reach, (s) => {
      const d = distanceToSegment2(x, z, s.ax, s.az, s.bx, s.bz);
      if (d < bestD) {
        bestD = d;
        best = s;
      }
    });
    if (!best) return null;
    const seg: RoadSegment = best;
    return { ax: seg.ax, az: seg.az, bx: seg.bx, bz: seg.bz, w: seg.w, road: seg.road };
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
   * true se il cerchio tocca un edificio.
   *
   * Variante senza allocazioni di `resolveCircle`: la ricostruzione dell'erba
   * la chiama centinaia di migliaia di volte e `near()` creava un array (con
   * spread) a ogni tentativo. Qui si esce al primo edificio colpito.
   */
  hitsCircle(x: number, z: number, radius: number): boolean {
    const cx = Math.floor(x / this.cell);
    const cz = Math.floor(z / this.cell);
    for (let ix = cx - 1; ix <= cx + 1; ix++) {
      for (let iz = cz - 1; iz <= cz + 1; iz++) {
        const list = this.grid.get((ix + 4096) * 8192 + (iz + 4096));
        if (!list) continue;
        for (const b of list) {
          if (
            x < b.bounds.minX - radius ||
            x > b.bounds.maxX + radius ||
            z < b.bounds.minZ - radius ||
            z > b.bounds.maxZ + radius
          ) {
            continue;
          }
          if (pointInPolygon(x, z, b.points)) return true;
          for (let i = 0, j = b.points.length - 1; i < b.points.length; j = i++) {
            const a = b.points[i]!;
            const c = b.points[j]!;
            if (distanceToSegment2(x, z, c.x, c.z, a.x, a.z) < radius) return true;
          }
        }
      }
    }
    return false;
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

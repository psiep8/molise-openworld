import { HOME, latLonToWorld, VILLAGES, WORLD } from '../config';
import type { Heightfield } from '../geo/elevation';
import type { Pt } from '../geo/geo';
import type { OsmData } from '../geo/osm';
import { OPEN_WORLD_IMAGERY, type TileProvider } from '../world/imagery';
import { SatelliteBasemap, SatelliteTiles } from './satellite';
import { clusterByRadius, minimapMeters } from './map-scale';

interface MapRoad {
  pts: number[];
  width: number;
  paved: boolean;
  /** tag OSM (`primary`, `residential`, `track`…): decide la gerarchia */
  type: string;
  name: string;
  /** 0 principale, 1 secondaria, 2 locale, 3 sterrata/sentiero */
  rank: number;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

interface MapArea {
  pts: number[];
  color: string;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

interface MapBuilding {
  pts: number[];
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

interface MapWater {
  pts: number[];
  /** 0 fiume, 1 torrente/canale, 2 fosso */
  rank: number;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

// Palette cartografica della minimappa vettoriale: le stesse tinte del
// paesaggio 3D (bosco scuro, prato oliva, coltivo giallastro, acqua blu), con
// alpha alto abbastanza da leggersi sul fondo scuro.
const AREA_FILL: Record<string, string> = {
  wood: 'rgba(54, 80, 46, 0.95)',
  forest: 'rgba(54, 80, 46, 0.95)',
  scrub: 'rgba(78, 95, 58, 0.85)',
  meadow: 'rgba(112, 126, 78, 0.7)',
  grassland: 'rgba(112, 126, 78, 0.7)',
  farmland: 'rgba(132, 119, 72, 0.72)',
  farm: 'rgba(132, 119, 72, 0.72)',
  allotments: 'rgba(118, 118, 66, 0.72)',
  water: 'rgba(56, 104, 120, 0.96)',
  residential: 'rgba(122, 112, 94, 0.6)',
  industrial: 'rgba(118, 112, 102, 0.6)',
  quarry: 'rgba(128, 122, 111, 0.7)',
  vineyard: 'rgba(98, 110, 58, 0.72)',
  orchard: 'rgba(88, 105, 60, 0.72)',
  park: 'rgba(76, 100, 58, 0.7)',
};

const DIRT = '#b99d74';

/** Stile per classe: più la strada è importante, più è chiara e spessa. */
const ROAD_STYLE = [
  { fill: '#f7efdb', casing: 'rgba(16, 19, 15, 0.88)', width: 6.0 },
  { fill: '#e8ddc0', casing: 'rgba(18, 21, 17, 0.8)', width: 4.4 },
  { fill: '#d5c8aa', casing: 'rgba(22, 25, 19, 0.68)', width: 3.0 },
  { fill: '#b99d74', casing: 'rgba(26, 27, 20, 0.5)', width: 1.6 },
] as const;

/** Classifica la strada per la gerarchia visiva della mappa. */
function roadRank(road: { type?: string; width: number; paved: boolean }): number {
  const type = (road.type ?? '').toLowerCase();
  if (/(motorway|trunk|primary)/.test(type)) return 0;
  if (/(secondary|tertiary)/.test(type)) return 1;
  if (/(residential|unclassified|living_street|service)/.test(type)) return 2;
  if (/(track|path|footway|cycleway|bridleway|steps|pedestrian)/.test(type)) return 3;
  // senza tag utili decide la larghezza misurata sul campo
  if (road.width >= 6) return 0;
  if (road.width >= 4.5) return 1;
  return road.paved ? 2 : 3;
}

function packRoads(osm: OsmData): MapRoad[] {
  return osm.roads.map((r) => {
    const pts: number[] = [];
    for (let i = 0; i < r.points.length; i += 3) {
      pts.push(r.points[i].x, r.points[i].z);
    }
    const last = r.points[r.points.length - 1];
    pts.push(last.x, last.z);
    return {
      pts,
      width: r.width,
      paved: r.paved,
      type: r.type,
      name: r.name,
      rank: roadRank(r),
      minX: r.bounds.minX,
      maxX: r.bounds.maxX,
      minZ: r.bounds.minZ,
      maxZ: r.bounds.maxZ,
    };
  });
}

function packAreas(osm: OsmData): MapArea[] {
  const out: MapArea[] = [];
  for (const a of osm.areas) {
    const color = AREA_FILL[a.kind];
    if (!color) continue;
    const pts: number[] = [];
    for (const p of a.points) pts.push(p.x, p.z);
    out.push({ pts, color, ...a.bounds });
  }
  return out;
}

function packBuildings(osm: OsmData): MapBuilding[] {
  const out: MapBuilding[] = [];
  for (const building of osm.buildings) {
    if (building.points.length < 3) continue;
    const pts: number[] = [];
    for (const p of building.points) pts.push(p.x, p.z);
    out.push({ pts, ...building.bounds });
  }
  return out;
}

/** Fiume, torrente o semplice fosso: decide spessore e priorità a scala larga. */
function waterRank(type: string): number {
  const t = type.toLowerCase();
  if (/(river|stream|canal)/.test(t)) return /river/.test(t) ? 0 : 1;
  return 2;
}

/**
 * Corsi d'acqua come linee.
 *
 * Le aree d'acqua OSM coprono laghi e tratti larghi, ma il Biferno e i suoi
 * affluenti sono quasi tutti mappati come `waterway` lineari: senza queste
 * linee la valle era solo una distesa verde e non si capiva da che parte
 * scende l'acqua — che è il primo riferimento per orientarsi in campagna.
 */
function packWaterways(osm: OsmData): MapWater[] {
  const out: MapWater[] = [];
  for (const w of osm.waterways) {
    if (w.points.length < 2) continue;
    const pts: number[] = [];
    let minX = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let minZ = Number.POSITIVE_INFINITY;
    let maxZ = Number.NEGATIVE_INFINITY;
    for (const p of w.points) {
      pts.push(p.x, p.z);
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.z < minZ) minZ = p.z;
      if (p.z > maxZ) maxZ = p.z;
    }
    out.push({ pts, rank: waterRank(w.type), minX, maxX, minZ, maxZ });
  }
  return out;
}

export interface MapView {
  x: number;
  z: number;
  yaw: number;
}

/** Livelli attivabili dalla legenda della mappa (F15). */
export type MapLayer = 'roads' | 'areas' | 'buildings' | 'pois' | 'labels';

/** Luogo lontano da indicare sul bordo della minimappa (km e direzione). */
export interface MapTarget {
  name: string;
  x: number;
  z: number;
}

export interface MinimapOptions {
  /** 'walk' a piedi, 'drive' in auto: cambia la scala automatica */
  mode?: 'walk' | 'drive';
  /** velocità in m/s: apre la scala in auto */
  speed?: number;
  /** moltiplicatore manuale della scala (rotella sopra la minimappa) */
  zoomFactor?: number;
  /** salta lo smorzamento (primo disegno) */
  snap?: boolean;
  /** destinazioni fuori dal mondo da mostrare come frecce sul bordo */
  targets?: readonly MapTarget[];
}

export class MapRenderer {
  private readonly roads: MapRoad[];
  private readonly areas: MapArea[];
  private readonly buildings: MapBuilding[];
  private readonly waterways: MapWater[];
  private staticMap: HTMLCanvasElement | null = null;
  private staticKey = '';
  private readonly mapScale: number;
  private readonly mapPad = 48;
  /** livelli visibili: la mappa vettoriale confusa si può alleggerire */
  private readonly layers: Record<MapLayer, boolean> = {
    roads: true,
    areas: true,
    buildings: true,
    pois: true,
    labels: true,
  };
  /** rettangoli delle etichette già scritte: niente sovrapposizioni */
  private readonly labelBoxes: { x: number; y: number; w: number; h: number }[] = [];
  readonly satTiles: SatelliteTiles;
  readonly satMap: SatelliteBasemap;
  /** attribuzione del provider, obbligatoria quando si usano tile esterne */
  get imageryAttribution(): string {
    return this.satTiles.attribution;
  }

  get imageryName(): string {
    return this.satTiles.name;
  }

  get layerState(): Record<MapLayer, boolean> {
    return { ...this.layers };
  }

  /** Accende/spegne un livello e rigenera le basi precalcolate. */
  setLayer(layer: MapLayer, on: boolean): void {
    if (this.layers[layer] === on) return;
    this.layers[layer] = on;
    this.staticMap = null;
    this.staticKey = '';
    this.buildStatic();
    this.invalidateBigMap();
  }
  /**
   * true = foto satellite, false = mappa vettoriale.
   *
   * La minimappa parte dalla mappa vettoriale: il mosaico locale più fine è
   * 4096 px sull'intera area di gioco (~3,4 m/px) e a 380 m di scala veniva
   * ingrandito quasi sei volte, quindi sfocato e con i colori della foto
   * Sentinel. La cartografia vettoriale è disegnata alla risoluzione del
   * canvas, resta nitida a ogni zoom e mostra strade, case, boschi e acqua.
   * `V` riporta la foto, che resta utile per riconoscere i campi dall'alto.
   */
  radar = false;
  /** Chiamata quando arrivano nuove tile: il gioco ridisegna le mappe. */
  onUpdate?: () => void;
  /** Base statica della mappa grande (satellite + strade), riusata a ogni frame. */
  private bigBase: HTMLCanvasElement | null = null;
  private bigBaseKey = '';
  /** ombreggiatura del rilievo, calcolata una volta dal DEM */
  private hillshadeCanvas: HTMLCanvasElement | null = null;

  constructor(
    osm: OsmData,
    provider: TileProvider = OPEN_WORLD_IMAGERY,
    private readonly heights?: Heightfield,
  ) {
    this.roads = packRoads(osm);
    this.areas = packAreas(osm);
    this.buildings = packBuildings(osm);
    this.waterways = packWaterways(osm);
    this.mapScale = (1600 - this.mapPad * 2) / WORLD.width;
    this.buildStatic();
    this.satTiles = new SatelliteTiles(provider, () => this.onUpdate?.());
    // solo il mosaico grande invalida la base: le tile del radar non c'entrano
    this.satMap = new SatelliteBasemap(provider, () => {
      this.invalidateBigMap();
      this.onUpdate?.();
    });
  }

  private buildStatic(): void {
    const key = `${this.layers.roads}|${this.layers.areas}|${this.layers.buildings}`;
    if (this.staticMap && this.staticKey === key) return;
    const w = 1600;
    const h = Math.ceil(WORLD.height * this.mapScale + this.mapPad * 2);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.fillStyle = '#16201b';
    ctx.fillRect(0, 0, w, h);

    // Rilievo: ombreggiatura leggera dal DEM, in coordinate pixel e sotto la
    // carta. Dà l'orientamento delle valli senza colorare la mappa.
    if (this.layers.areas && this.heights) {
      const shade = this.buildHillshade();
      if (shade) {
        ctx.save();
        ctx.globalAlpha = 0.5;
        ctx.globalCompositeOperation = 'soft-light';
        ctx.drawImage(
          shade,
          this.mapPad,
          this.mapPad,
          WORLD.width * this.mapScale,
          WORLD.height * this.mapScale,
        );
        ctx.restore();
      }
    }

    ctx.save();
    ctx.translate(this.mapPad, this.mapPad);
    ctx.scale(this.mapScale, this.mapScale);
    ctx.translate(WORLD.halfWidth, WORLD.halfHeight);
    const minLine = 2.2 / this.mapScale;

    if (this.layers.areas) {
      for (const a of this.areas) {
        ctx.beginPath();
        for (let i = 0; i < a.pts.length; i += 2) {
          const x = a.pts[i];
          const z = a.pts[i + 1];
          if (i === 0) ctx.moveTo(x, z);
          else ctx.lineTo(x, z);
        }
        ctx.closePath();
        ctx.fillStyle = a.color;
        ctx.fill();
      }
    }

    // Acqua lineare (Biferno, torrenti, fossi): sotto le strade e sopra le
    // aree, così i campi restano leggibili ma la rete idrica dà l'orientamento.
    if (this.layers.areas && this.waterways.length > 0) {
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      for (const w of this.waterways) {
        ctx.beginPath();
        for (let i = 0; i < w.pts.length; i += 2) {
          const x = w.pts[i];
          const z = w.pts[i + 1];
          if (i === 0) ctx.moveTo(x, z);
          else ctx.lineTo(x, z);
        }
        const width = w.rank === 0 ? 18 : w.rank === 1 ? 9 : 4.5;
        ctx.lineWidth = Math.max(width, minLine * 0.9);
        ctx.strokeStyle = w.rank === 0 ? 'rgba(92, 150, 172, 0.95)' : 'rgba(86, 140, 160, 0.72)';
        ctx.globalAlpha = w.rank === 2 ? 0.55 : 0.9;
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }

    // Impronte degli edifici: presenti ma tenui. A scala grande un paese pieno
    // di blocchi scuri diventa rumore e nasconde le strade (era la mappa
    // "confusionaria").
    if (this.layers.buildings) {
      ctx.fillStyle = 'rgba(206, 194, 168, 0.52)';
      ctx.strokeStyle = 'rgba(32, 34, 26, 0.42)';
      ctx.lineWidth = Math.max(0.35, 0.4 / this.mapScale);
      for (const b of this.buildings) {
        ctx.beginPath();
        for (let i = 0; i < b.pts.length; i += 2) {
          const x = b.pts[i]!;
          const z = b.pts[i + 1]!;
          if (i === 0) ctx.moveTo(x, z);
          else ctx.lineTo(x, z);
        }
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      }
    }

    if (this.layers.roads) {
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      // Due passate: prima tutte le cornici, poi tutti i riempimenti. Con una
      // passata sola la cornice di una strada copriva il riempimento della
      // vicina e agli incroci restavano delle tacche scure.
      for (const r of this.roads) {
        const style = ROAD_STYLE[r.rank] ?? ROAD_STYLE[2]!;
        ctx.beginPath();
        for (let i = 0; i < r.pts.length; i += 2) {
          const x = r.pts[i];
          const z = r.pts[i + 1];
          if (i === 0) ctx.moveTo(x, z);
          else ctx.lineTo(x, z);
        }
        ctx.lineWidth = Math.max(r.width, minLine * (r.paved ? 1 : 0.8)) + Math.max(1.4, 1.2 / this.mapScale);
        ctx.strokeStyle = style.casing;
        ctx.globalAlpha = r.rank >= 3 ? 0.5 : 0.9;
        ctx.setLineDash(r.rank >= 3 ? [12, 9] : []);
        ctx.stroke();
      }
      for (const r of this.roads) {
        const style = ROAD_STYLE[r.rank] ?? ROAD_STYLE[2]!;
        ctx.beginPath();
        for (let i = 0; i < r.pts.length; i += 2) {
          const x = r.pts[i];
          const z = r.pts[i + 1];
          if (i === 0) ctx.moveTo(x, z);
          else ctx.lineTo(x, z);
        }
        ctx.lineWidth = Math.max(r.width, minLine * (r.paved ? 1 : 0.75));
        ctx.strokeStyle = r.rank >= 3 ? DIRT : style.fill;
        ctx.globalAlpha = r.rank >= 3 ? 0.72 : r.paved ? 0.97 : 0.8;
        ctx.setLineDash(r.rank >= 3 ? [12, 9] : []);
        ctx.stroke();
      }
      ctx.setLineDash([]);
    }
    ctx.globalAlpha = 1;
    ctx.restore();
    this.staticMap = canvas;
    this.staticKey = key;
  }

  /**
   * Ombreggiatura del rilievo a bassa risoluzione (320 px di lato lungo).
   *
   * Campionare il DEM a ogni pixel della mappa sarebbe costoso e inutile: il
   * rilievo è liscio, quindi una griglia grossa viene ingrandita con smoothing
   * e resta credibile. Luce da nord-ovest, contrasto basso.
   */
  private buildHillshade(): HTMLCanvasElement | null {
    if (this.hillshadeCanvas) return this.hillshadeCanvas;
    const heights = this.heights;
    if (!heights) return null;
    const width = 320;
    const height = Math.max(1, Math.round((width * WORLD.height) / WORLD.width));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    const image = ctx.createImageData(width, height);
    const stepX = WORLD.width / width;
    const stepZ = WORLD.height / height;
    // luce da nord-ovest, la convenzione cartografica
    const lx = -0.52;
    const ly = 0.74;
    const lz = -0.42;
    const llen = Math.hypot(lx, ly, lz) || 1;
    for (let y = 0; y < height; y++) {
      const wz = -WORLD.halfHeight + (y + 0.5) * stepZ;
      for (let x = 0; x < width; x++) {
        const wx = -WORLD.halfWidth + (x + 0.5) * stepX;
        const hx = heights.heightAt(wx + stepX, wz) - heights.heightAt(wx - stepX, wz);
        const hz = heights.heightAt(wx, wz + stepZ) - heights.heightAt(wx, wz - stepZ);
        const nx = -hx;
        const ny = 2 * stepX;
        const nz = -hz;
        const nlen = Math.hypot(nx, ny, nz) || 1;
        const dot = (nx * lx + ny * ly + nz * lz) / (nlen * llen);
        // 0,5 = pianura, 1 = versante in luce, 0 = versante in ombra
        const shade = Math.max(0, Math.min(1, 0.52 + 0.48 * dot));
        const value = Math.round(255 * shade);
        const i = (y * width + x) * 4;
        image.data[i] = value;
        image.data[i + 1] = value;
        image.data[i + 2] = value;
        image.data[i + 3] = 210;
      }
    }
    ctx.putImageData(image, 0, 0);
    this.hillshadeCanvas = canvas;
    return canvas;
  }

  private toStaticScreen(x: number, z: number, placement: { dx: number; dy: number; s: number }): { x: number; y: number } {
    const px = (x + WORLD.halfWidth) * this.mapScale + this.mapPad;
    const py = (z + WORLD.halfHeight) * this.mapScale + this.mapPad;
    return { x: placement.dx + px * placement.s, y: placement.dy + py * placement.s };
  }

  /**
   * Strade sopra la foto: cornice scura + gerarchia di spessori.
   *
   * Prima erano tutte della stessa larghezza e dello stesso bianco: sulla
   * foto diventavano un reticolo uniforme in cui non si distingueva una
   * provinciale da una strada di campagna.
   */
  private paintBigRoads(
    ctx: CanvasRenderingContext2D,
    placement: { dx: number; dy: number; s: number },
    dpr: number,
    satellite: boolean,
  ): void {
    if (!this.layers.roads) return;
    const unit = this.mapScale * placement.s;
    const minLine = 0.7 * dpr;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const r of this.roads) {
      const style = ROAD_STYLE[r.rank] ?? ROAD_STYLE[2]!;
      const width = Math.max(minLine, (r.rank >= 3 ? Math.min(r.width, 2.6) : r.width) * unit);
      ctx.beginPath();
      const a = this.toStaticScreen(r.pts[0]!, r.pts[1]!, placement);
      ctx.moveTo(a.x, a.y);
      for (let i = 2; i < r.pts.length; i += 2) {
        const p = this.toStaticScreen(r.pts[i]!, r.pts[i + 1]!, placement);
        ctx.lineTo(p.x, p.y);
      }
      ctx.lineWidth = width + (r.rank >= 3 ? 0.7 * dpr : 1.6 * dpr);
      ctx.strokeStyle = satellite ? 'rgba(9, 12, 9, 0.7)' : style.casing;
      ctx.setLineDash(r.rank >= 3 ? [4 * dpr, 3 * dpr] : []);
      ctx.stroke();
    }
    for (const r of this.roads) {
      const style = ROAD_STYLE[r.rank] ?? ROAD_STYLE[2]!;
      const width = Math.max(minLine, (r.rank >= 3 ? Math.min(r.width, 2.6) : r.width) * unit);
      ctx.beginPath();
      const a = this.toStaticScreen(r.pts[0]!, r.pts[1]!, placement);
      ctx.moveTo(a.x, a.y);
      for (let i = 2; i < r.pts.length; i += 2) {
        const p = this.toStaticScreen(r.pts[i]!, r.pts[i + 1]!, placement);
        ctx.lineTo(p.x, p.y);
      }
      ctx.lineWidth = width;
      ctx.strokeStyle = satellite
        ? r.rank >= 3
          ? 'rgba(214, 190, 146, 0.5)'
          : r.rank === 0
            ? 'rgba(255, 248, 226, 0.92)'
            : 'rgba(255, 246, 220, 0.72)'
        : r.rank >= 3
          ? DIRT
          : style.fill;
      ctx.globalAlpha = r.rank >= 3 ? 0.8 : 1;
      ctx.setLineDash(r.rank >= 3 ? [4 * dpr, 3 * dpr] : []);
      ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
  }

  /** Geometria della mappa grande nel canvas (usata anche per i click). */
  private placementFor(canvas: HTMLCanvasElement, map: HTMLCanvasElement): { dx: number; dy: number; s: number } {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const s = Math.min((canvas.width - 80 * dpr) / map.width, (canvas.height - 80 * dpr) / map.height);
    return { dx: (canvas.width - map.width * s) / 2, dy: (canvas.height - map.height * s) / 2, s };
  }

  /** Da un click sulla mappa grande alle coordinate del mondo (metri). */
  worldFromBigMap(canvas: HTMLCanvasElement, clientX: number, clientY: number): Pt | null {
    const map = this.staticMap;
    if (!map) return null;
    const rect = canvas.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return null;
    const px = (clientX - rect.left) * (canvas.width / rect.width);
    const py = (clientY - rect.top) * (canvas.height / rect.height);
    const { dx, dy, s } = this.placementFor(canvas, map);
    const staticX = (px - dx) / s;
    const staticY = (py - dy) / s;
    return {
      x: (staticX - this.mapPad) / this.mapScale - WORLD.halfWidth,
      z: (staticY - this.mapPad) / this.mapScale - WORLD.halfHeight,
    };
  }

  /** Traccia una polilinea proiettata sul canvas (percorso). */
  private traceRoute(
    ctx: CanvasRenderingContext2D,
    route: Pt[],
    project: (x: number, z: number) => { x: number; y: number },
  ): void {
    ctx.beginPath();
    const first = project(route[0].x, route[0].z);
    ctx.moveTo(first.x, first.y);
    for (let i = 1; i < route.length; i++) {
      const p = project(route[i].x, route[i].z);
      ctx.lineTo(p.x, p.y);
    }
  }

  /** Spillo della destinazione. */
  private drawPin(ctx: CanvasRenderingContext2D, x: number, y: number, s: number): void {
    ctx.save();
    ctx.translate(x, y);
    ctx.beginPath();
    ctx.arc(0, -s * 1.1, s * 0.72, 0, Math.PI * 2);
    ctx.fillStyle = '#4ad7ff';
    ctx.fill();
    ctx.strokeStyle = '#0a1418';
    ctx.lineWidth = Math.max(1.2, s * 0.22);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-s * 0.42, -s * 0.72);
    ctx.lineTo(0, 0);
    ctx.lineTo(s * 0.42, -s * 0.72);
    ctx.closePath();
    ctx.fillStyle = '#4ad7ff';
    ctx.fill();
    ctx.restore();
  }

  /** Icona "casa" per Palata. */
  private drawHome(ctx: CanvasRenderingContext2D, x: number, y: number, s: number): void {
    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = '#ffd479';
    ctx.strokeStyle = '#2a2118';
    ctx.lineWidth = Math.max(1, s * 0.14);
    ctx.beginPath();
    ctx.moveTo(0, -s * 0.9);
    ctx.lineTo(s * 0.85, -s * 0.05);
    ctx.lineTo(s * 0.55, -s * 0.05);
    ctx.lineTo(s * 0.55, s * 0.75);
    ctx.lineTo(-s * 0.55, s * 0.75);
    ctx.lineTo(-s * 0.55, -s * 0.05);
    ctx.lineTo(-s * 0.85, -s * 0.05);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  /** Segnalibro della casa/garage scelta dal giocatore. */
  private drawGarage(ctx: CanvasRenderingContext2D, x: number, y: number, s: number): void {
    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = '#8ef0b0';
    ctx.strokeStyle = '#0c2016';
    ctx.lineWidth = Math.max(1, s * 0.16);
    ctx.beginPath();
    ctx.moveTo(0, -s * 0.95);
    ctx.lineTo(s * 0.82, -s * 0.2);
    ctx.lineTo(s * 0.52, -s * 0.2);
    ctx.lineTo(s * 0.52, s * 0.72);
    ctx.lineTo(-s * 0.52, s * 0.72);
    ctx.lineTo(-s * 0.52, -s * 0.2);
    ctx.lineTo(-s * 0.82, -s * 0.2);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    // bandierina: distingue il garage dalla casa di Palata
    ctx.beginPath();
    ctx.moveTo(s * 0.5, -s * 0.95);
    ctx.lineTo(s * 0.5, -s * 1.6);
    ctx.lineTo(s * 1.05, -s * 1.33);
    ctx.closePath();
    ctx.fillStyle = '#ffd479';
    ctx.fill();
    ctx.restore();
  }

  /** Marker di un'attività: rombo pieno; anello tratteggiato se da verificare. */
  private drawVenue(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    s: number,
    color: string,
    status: string,
  ): void {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(Math.PI / 4);
    ctx.fillStyle = color;
    ctx.strokeStyle = 'rgba(8, 14, 12, 0.9)';
    ctx.lineWidth = Math.max(1, s * 0.22);
    ctx.fillRect(-s * 0.62, -s * 0.62, s * 1.24, s * 1.24);
    ctx.strokeRect(-s * 0.62, -s * 0.62, s * 1.24, s * 1.24);
    ctx.restore();
    if (status !== 'verified') {
      ctx.save();
      ctx.beginPath();
      ctx.arc(x, y, s * 1.35, 0, Math.PI * 2);
      ctx.setLineDash([s * 0.35, s * 0.35]);
      ctx.strokeStyle = 'rgba(255, 244, 226, 0.75)';
      ctx.lineWidth = Math.max(1, s * 0.18);
      ctx.stroke();
      ctx.restore();
    }
  }

  /** Scala corrente della minimappa in metri di lato (smorzata nel tempo). */
  minimapMeters = 380;

  /**
   * Scala ideale: a piedi si guarda vicino (~300 m), in auto si apre con la
   * velocità (240 m da fermo, ~660 m a 100 km/h) così a 90 km/h si vede la
   * curva dopo invece di scoprirla a metà. La mappa vera e propria insegue
   * questo valore con uno smorzamento, quindi non salta di scala.
   */
  private targetMeters(options: MinimapOptions): number {
    return minimapMeters(options.mode ?? 'drive', options.speed ?? 0, options.zoomFactor ?? 1);
  }

  /**
   * Porta il canvas della minimappa alla densità dello schermo.
   *
   * Era fissato a 640 px per 320 CSS: su un pannello a 3× il disegno veniva
   * ingrandito e sembrava sgranato. Ora segue il devicePixelRatio (cap 2,5) e
   * resta nitido anche sulla mappa grande.
   */
  private resizeSquare(canvas: HTMLCanvasElement): number {
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    const cssSize = canvas.clientWidth || 320;
    const side = Math.max(320, Math.round(cssSize * dpr));
    if (canvas.width !== side || canvas.height !== side) {
      canvas.width = side;
      canvas.height = side;
    }
    return side;
  }

  private overlaps(box: { x: number; y: number; w: number; h: number }): boolean {
    for (const other of this.labelBoxes) {
      if (
        box.x < other.x + other.w &&
        box.x + box.w > other.x &&
        box.y < other.y + other.h &&
        box.y + box.h > other.y
      ) {
        return true;
      }
    }
    return false;
  }

  /**
   * Etichetta con alone e controllo collisioni: se lo spazio è già occupato la
   * scarta invece di sovrapporla. È la parte che rende leggibile la mappa
   * vettoriale (prima i nomi si stampavano uno sopra l'altro).
   */
  private drawLabel(
    ctx: CanvasRenderingContext2D,
    text: string,
    x: number,
    y: number,
    sizePx: number,
    font: string,
    color: string,
    align: CanvasTextAlign = 'center',
  ): boolean {
    ctx.font = font;
    ctx.textAlign = align;
    ctx.textBaseline = 'middle';
    const width = ctx.measureText(text).width;
    const padding = Math.max(2, sizePx * 0.25);
    const height = sizePx * 1.2;
    const left = align === 'center' ? x - width / 2 : align === 'right' ? x - width : x;
    const box = {
      x: left - padding,
      y: y - height / 2 - padding,
      w: width + padding * 2,
      h: height + padding * 2,
    };
    if (this.overlaps(box)) return false;
    this.labelBoxes.push(box);
    ctx.lineWidth = Math.max(2, sizePx * 0.24);
    ctx.strokeStyle = 'rgba(8, 12, 10, 0.88)';
    ctx.strokeText(text, x, y);
    ctx.fillStyle = color;
    ctx.fillText(text, x, y);
    return true;
  }

  /** Etichetta ruotata lungo la strada (nomi delle vie sulla mappa grande). */
  private drawStreetLabel(
    ctx: CanvasRenderingContext2D,
    text: string,
    x: number,
    y: number,
    angle: number,
    sizePx: number,
    color: string,
  ): boolean {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.font = `600 ${sizePx}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const width = ctx.measureText(text).width;
    const height = sizePx * 1.2;
    const cos = Math.abs(Math.cos(angle));
    const sin = Math.abs(Math.sin(angle));
    const bw = width * cos + height * sin;
    const bh = width * sin + height * cos;
    const box = { x: x - bw / 2 - 3, y: y - bh / 2 - 3, w: bw + 6, h: bh + 6 };
    if (this.overlaps(box)) {
      ctx.restore();
      return false;
    }
    this.labelBoxes.push(box);
    ctx.lineWidth = Math.max(2, sizePx * 0.26);
    ctx.strokeStyle = 'rgba(8, 12, 10, 0.9)';
    ctx.strokeText(text, 0, 0);
    ctx.fillStyle = color;
    ctx.fillText(text, 0, 0);
    ctx.restore();
    return true;
  }

  /** Minimappa locale (nord in alto), con scala automatica. */
  drawMinimap(
    canvas: HTMLCanvasElement,
    view: MapView,
    car?: { x: number; z: number },
    route?: Pt[],
    garage?: { x: number; z: number } | null,
    venues?: readonly { x: number; z: number; name: string; color: string; status: string }[],
    options: MinimapOptions = {},
  ): void {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const size = this.resizeSquare(canvas);
    this.labelBoxes.length = 0;
    const target = this.targetMeters(options);
    this.minimapMeters = options.snap
      ? target
      : this.minimapMeters + (target - this.minimapMeters) * 0.16;
    const viewMeters = this.minimapMeters;
    const k = size / viewMeters;
    const cx = size / 2;
    const cy = size / 2;
    const u = size / 440;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, size, size);
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, size / 2 - 3, 0, Math.PI * 2);
    ctx.clip();
    // Due modi: cartografia vettoriale (default) o radar con tile vere, che
    // sceglie lo zoom per avere 1 pixel di tile ≈ 1 pixel di canvas. Prima il
    // radar non esisteva sulla minimappa e la foto era solo nella mappa
    // grande, dove però il mosaico Sentinel resta la sorgente giusta.
    // Fondo carta: verde-oliva scuro, non nero. Con il nero le aree
    // semitrasparenti (boschi, prati) sparivano e la mappa sembrava vuota.
    const half = viewMeters / 2;
    // Radar: tile vere con lo zoom scelto per la scala corrente. Se le tile
    // non sono configurate (mosaico locale) o si è offline, resta il vettore.
    const satellite = this.radar && this.satTiles.usesTiles;
    if (satellite) {
      this.satTiles.draw(ctx, size, view, viewMeters);
      // velo leggero: la foto da sola nasconde cordoli e incroci
      ctx.fillStyle = 'rgba(8, 13, 10, 0.26)';
      ctx.fillRect(0, 0, size, size);
    } else {
      // fondo carta: verde-oliva scuro, non nero
      ctx.fillStyle = '#2b3423';
      ctx.fillRect(0, 0, size, size);
    }

    if (this.layers.areas && !satellite) {
      for (const a of this.areas) {
      if (a.maxX < view.x - half || a.minX > view.x + half || a.maxZ < view.z - half || a.minZ > view.z + half) continue;
      ctx.beginPath();
      for (let i = 0; i < a.pts.length; i += 2) {
        const px = cx + (a.pts[i] - view.x) * k;
        const py = cy + (a.pts[i + 1] - view.z) * k;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
        ctx.closePath();
        ctx.fillStyle = a.color;
        ctx.fill();
      }
    }

    // Corsi d'acqua: a scala larga restano i fiumi, avvicinandosi compaiono
    // torrenti e fossi. Come per le strade, il dettaglio cresce con lo zoom.
    if (this.layers.areas && !satellite && this.waterways.length > 0) {
      const waterLimit = viewMeters > 520 ? 0 : viewMeters > 330 ? 1 : 2;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      for (const w of this.waterways) {
        if (w.rank > waterLimit) continue;
        if (w.maxX < view.x - half || w.minX > view.x + half || w.maxZ < view.z - half || w.minZ > view.z + half) continue;
        ctx.beginPath();
        for (let i = 0; i < w.pts.length; i += 2) {
          const px = cx + (w.pts[i] - view.x) * k;
          const py = cy + (w.pts[i + 1] - view.z) * k;
          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.lineWidth = (w.rank === 0 ? 2.6 : w.rank === 1 ? 1.7 : 1.1) * u;
        ctx.strokeStyle = w.rank === 0 ? 'rgba(132, 196, 214, 0.92)' : 'rgba(120, 176, 194, 0.72)';
        ctx.stroke();
      }
    }

    // Edifici solo quando si guarda da vicino: a scala larga sono rumore.
    // Tinta tenue: riempiti a piena opacità il paese diventava un blocco
    // beige unico e le vie ci scomparivano dentro.
    if (this.layers.buildings && !satellite && viewMeters < 340) {
      ctx.fillStyle = 'rgba(214, 202, 175, 0.46)';
      ctx.strokeStyle = 'rgba(24, 26, 20, 0.42)';
      ctx.lineWidth = Math.max(0.7, 0.7 * u);
      for (const b of this.buildings) {
        if (b.maxX < view.x - half || b.minX > view.x + half || b.maxZ < view.z - half || b.minZ > view.z + half) continue;
        ctx.beginPath();
        for (let i = 0; i < b.pts.length; i += 2) {
          const px = cx + (b.pts[i]! - view.x) * k;
          const py = cy + (b.pts[i + 1]! - view.z) * k;
          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      }
    }

    // Gerarchia stradale + LOD: a scala larga restano le principali, avvicinandosi
    // compaiono secondarie, locali e sterrate. Due passate (cornice, poi
    // riempimento) per non spezzare gli incroci.
    const rankLimit = viewMeters > 520 ? 1 : viewMeters > 330 ? 2 : 3;
    if (this.layers.roads) {
      const visible = this.roads.filter(
        (r) =>
          r.rank <= rankLimit &&
          !(r.maxX < view.x - half || r.minX > view.x + half || r.maxZ < view.z - half || r.minZ > view.z + half),
      );
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      for (const r of visible) {
        const style = ROAD_STYLE[r.rank] ?? ROAD_STYLE[2]!;
        const width = Math.max(1, style.width * (satellite ? 1.15 : 1)) * u;
        ctx.beginPath();
        for (let i = 0; i < r.pts.length; i += 2) {
          const px = cx + (r.pts[i] - view.x) * k;
          const py = cy + (r.pts[i + 1] - view.z) * k;
          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.lineWidth = width + (r.rank >= 3 ? 1 * u : 2.4 * u);
        ctx.strokeStyle = r.rank >= 3 ? 'rgba(24, 26, 18, 0.45)' : style.casing;
        ctx.setLineDash(r.rank >= 3 ? [5 * u, 4 * u] : []);
        ctx.stroke();
      }
      for (const r of visible) {
        const style = ROAD_STYLE[r.rank] ?? ROAD_STYLE[2]!;
        const width = Math.max(1, style.width) * u;
        ctx.beginPath();
        for (let i = 0; i < r.pts.length; i += 2) {
          const px = cx + (r.pts[i] - view.x) * k;
          const py = cy + (r.pts[i + 1] - view.z) * k;
          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.lineWidth = width;
        ctx.strokeStyle = r.rank >= 3 ? DIRT : style.fill;
        ctx.globalAlpha = r.rank >= 3 ? 0.75 : 1;
        ctx.setLineDash(r.rank >= 3 ? [5 * u, 4 * u] : []);
        ctx.stroke();
      }
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
    }

    if (route && route.length > 1) {
      const project = (x: number, z: number): { x: number; y: number } => ({ x: cx + (x - view.x) * k, y: cy + (z - view.z) * k });
      this.traceRoute(ctx, route, project);
      ctx.strokeStyle = 'rgba(6, 14, 18, 0.85)';
      ctx.lineWidth = 7 * u;
      ctx.stroke();
      this.traceRoute(ctx, route, project);
      ctx.strokeStyle = '#4ad7ff';
      ctx.lineWidth = 3.4 * u;
      ctx.stroke();
      const end = project(route[route.length - 1].x, route[route.length - 1].z);
      if (Math.hypot(end.x - cx, end.y - cy) < size / 2 - 8) this.drawPin(ctx, end.x, end.y, 6 * u);
    }

    if (car) {
      const dx = cx + (car.x - view.x) * k;
      const dy = cy + (car.z - view.z) * k;
      if (Math.hypot(dx - cx, dy - cy) < size / 2) {
        ctx.fillStyle = '#f0c674';
        ctx.beginPath();
        ctx.arc(dx, dy, 3.4 * u, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    if (garage) {
      const gx = cx + (garage.x - view.x) * k;
      const gy = cy + (garage.z - view.z) * k;
      if (Math.hypot(gx - cx, gy - cy) < size / 2 - 12) {
        this.drawGarage(ctx, gx, gy, 7 * u);
      }
    }

    if (this.layers.pois) {
      for (const venue of venues ?? []) {
        const vx = cx + (venue.x - view.x) * k;
        const vy = cy + (venue.z - view.z) * k;
        if (Math.hypot(vx - cx, vy - cy) > size / 2 - 10) continue;
        this.drawVenue(ctx, vx, vy, 4.2 * u, venue.color, venue.status);
      }
    }

    // Nomi dei paesi con collisioni: prima i centri abitati (priorità), poi
    // le attività solo da vicino. Senza controllo si sovrapponevano e la
    // mappa diventava illeggibile proprio dove serviva orientarsi.
    if (this.layers.labels) {
      for (const v of VILLAGES) {
        const w = latLonToWorld(v.lat, v.lon);
        const px = cx + (w.x - view.x) * k;
        const py = cy + (w.z - view.z) * k;
        if (Math.hypot(px - cx, py - cy) > size / 2 - 16) continue;
        this.drawLabel(ctx, v.name, px, py + 3 * u, 12 * u, `600 ${12 * u}px system-ui, sans-serif`, '#f3e7cf');
      }
    }
    if (this.layers.pois && viewMeters < 300) {
      for (const venue of venues ?? []) {
        const vx = cx + (venue.x - view.x) * k;
        const vy = cy + (venue.z - view.z) * k;
        if (Math.hypot(vx - cx, vy - cy) > size / 2 - 14) continue;
        this.drawLabel(
          ctx,
          venue.name,
          vx,
          vy - 8 * u,
          10 * u,
          `600 ${10 * u}px system-ui, sans-serif`,
          'rgba(255, 244, 226, 0.92)',
        );
      }
    }

    // Nomi delle vie quando si è dentro il paese: ruotati lungo la strada e
    // con lo stesso controllo di collisione dei paesi (che hanno la priorità,
    // essendo disegnati prima). Due al massimo: sulla minimappa circolare tre
    // nomi coprono già mezza mappa.
    if (this.layers.labels && this.layers.roads && viewMeters < 300) {
      let placed = 0;
      for (const r of this.roads) {
        if (placed >= 2) break;
        if (r.rank > 2 || r.name.length < 3) continue;
        if (!/[a-zà-ù]/i.test(r.name)) continue;
        if (r.maxX < view.x - half || r.minX > view.x + half || r.maxZ < view.z - half || r.minZ > view.z + half) continue;
        const mid = Math.floor(r.pts.length / 4) * 2;
        const ax = r.pts[mid];
        const az = r.pts[mid + 1];
        const bx = r.pts[mid + 2] ?? ax;
        const bz = r.pts[mid + 3] ?? az;
        if (ax === undefined || az === undefined) continue;
        const pa = { x: cx + (ax - view.x) * k, y: cy + (az - view.z) * k };
        const pb = { x: cx + (bx - view.x) * k, y: cy + (bz - view.z) * k };
        let angle = Math.atan2(pb.y - pa.y, pb.x - pa.x);
        if (Math.abs(angle) > Math.PI / 2) angle += Math.PI;
        if (this.drawStreetLabel(
          ctx,
          r.name,
          (pa.x + pb.x) / 2,
          (pa.y + pb.y) / 2,
          angle,
          9.2 * u,
          'rgba(240, 232, 214, 0.86)',
        )) {
          placed++;
        }
      }
    }

    // giocatore: freccia con ombra, bordo bianco e alone, leggibile sia sul
    // vettore sia sulla foto
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(-view.yaw);
    ctx.shadowColor = 'rgba(0, 0, 0, 0.55)';
    ctx.shadowBlur = 6 * u;
    ctx.shadowOffsetY = 2 * u;
    ctx.beginPath();
    ctx.moveTo(0, -9 * u);
    ctx.lineTo(6 * u, 7 * u);
    ctx.lineTo(0, 4 * u);
    ctx.lineTo(-6 * u, 7 * u);
    ctx.closePath();
    ctx.fillStyle = '#ff6b4a';
    ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;
    ctx.strokeStyle = '#fff4e2';
    ctx.lineWidth = 1.6 * u;
    ctx.stroke();
    ctx.restore();

    // destinazioni lontane: freccia sul bordo + chilometri. Si disegnano dalla
    // più vicina alla più lontana e si salta chi finirebbe sopra un'etichetta
    // già scritta: Termoli, San Salvo e Vasto stanno quasi sulla stessa
    // direzione e tre nomi sovrapposti non si leggono.
    const sorted = [...(options.targets ?? [])]
      .map((t) => ({ t, dx: t.x - view.x, dz: t.z - view.z }))
      .map((e) => ({ ...e, distance: Math.hypot(e.dx, e.dz) }))
      .filter((e) => e.distance >= size / 2 / k)
      .sort((a, b) => a.distance - b.distance);
    const used: number[] = [];
    for (const e of sorted) {
      const angle = Math.atan2(e.dz, e.dx);
      if (used.some((a) => Math.abs(((a - angle + Math.PI * 3) % (Math.PI * 2)) - Math.PI) < 0.42)) continue;
      used.push(angle);
      this.drawEdgeTarget(ctx, cx, cy, size / 2 - 6, angle, e.t.name, e.distance, u);
    }

    this.drawScaleBar(ctx, cx, cy, size / 2 - 3, viewMeters, u);
    // attribuzione quando si mostra la foto: obbligatoria per i provider
    if (satellite) {
      ctx.font = `500 ${8 * u}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';
      ctx.fillStyle = 'rgba(255, 244, 226, 0.55)';
      ctx.fillText(`© ${this.satTiles.name}`, cx, cy + size / 2 - 12 * u);
    }
    ctx.restore();

    // anello esterno: cornice del radar
    ctx.beginPath();
    ctx.arc(cx, cy, size / 2 - 2, 0, Math.PI * 2);
    ctx.lineWidth = Math.max(2, size * 0.009);
    ctx.strokeStyle = 'rgba(12, 18, 14, 0.9)';
    ctx.stroke();
  }

  /** Freccia+nome di una destinazione fuori dall'inquadratura. */
  private drawEdgeTarget(
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    radius: number,
    angle: number,
    name: string,
    distance: number,
    u: number,
  ): void {
    const px = cx + Math.cos(angle) * (radius - 10 * u);
    const py = cy + Math.sin(angle) * (radius - 10 * u);
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(angle);
    ctx.beginPath();
    ctx.moveTo(7 * u, 0);
    ctx.lineTo(-3 * u, -4.6 * u);
    ctx.lineTo(-3 * u, 4.6 * u);
    ctx.closePath();
    ctx.fillStyle = 'rgba(255, 244, 226, 0.92)';
    ctx.strokeStyle = 'rgba(8, 12, 10, 0.85)';
    ctx.lineWidth = 1.2 * u;
    ctx.fill();
    ctx.stroke();
    ctx.restore();

    const km = distance >= 10_000 ? `${Math.round(distance / 1000)} km` : `${(distance / 1000).toFixed(1)} km`;
    const label = `${name} ${km}`;
    const tx = cx + Math.cos(angle) * (radius - 48 * u);
    const ty = cy + Math.sin(angle) * (radius - 48 * u);
    ctx.font = `600 ${9.5 * u}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.lineWidth = 3 * u;
    ctx.strokeStyle = 'rgba(8, 12, 10, 0.85)';
    ctx.strokeText(label, tx, ty + 3);
    ctx.fillStyle = 'rgba(255, 244, 226, 0.92)';
    ctx.fillText(label, tx, ty + 3);
    ctx.font = `600 ${11 * u}px system-ui, sans-serif`;
  }

  /** Barra di scala: dice a colpo d'occhio quanti metri copre la minimappa. */
  private drawScaleBar(
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    radius: number,
    viewMeters: number,
    u: number,
  ): void {
    const steps = [50, 100, 200, 250, 500, 1000];
    const maxPx = radius * 0.55;
    let meters = steps[steps.length - 1]!;
    for (const step of steps) {
      if ((step / viewMeters) * radius * 2 <= maxPx) {
        meters = step;
        break;
      }
    }
    const px = (meters / viewMeters) * radius * 2;
    const x = cx - px / 2;
    const y = cy + radius * 0.72;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + px, y);
    ctx.strokeStyle = 'rgba(8, 12, 10, 0.75)';
    ctx.lineWidth = 4 * u;
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + px, y);
    ctx.strokeStyle = 'rgba(255, 244, 226, 0.85)';
    ctx.lineWidth = 1.6 * u;
    ctx.stroke();
    ctx.font = `600 ${9 * u}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.lineWidth = 3 * u;
    ctx.strokeStyle = 'rgba(8, 12, 10, 0.85)';
    const text = meters >= 1000 ? `${meters / 1000} km` : `${meters} m`;
    ctx.strokeText(text, cx, y - 5 * u);
    ctx.fillStyle = 'rgba(255, 244, 226, 0.9)';
    ctx.fillText(text, cx, y - 5 * u);
  }

  /** Luogo abitato più vicino, per l'etichetta sotto la minimappa. */
  placeAt(x: number, z: number): { name: string; distance: number } {
    let best = { name: 'Campagna', distance: Number.POSITIVE_INFINITY };
    for (const v of VILLAGES) {
      const w = latLonToWorld(v.lat, v.lon);
      const d = Math.hypot(x - w.x, z - w.z);
      if (d < best.distance) best = { name: v.name, distance: d };
    }
    return best;
  }

  /** Da chiamare quando cambiano le tile satellite: la base va rigenerata. */
  invalidateBigMap(): void {
    this.bigBaseKey = '';
  }

  /** Mappa grande: satellite + overlay vettoriale, o mappa vettoriale notturna. */
  drawBigMap(
    canvas: HTMLCanvasElement,
    view: MapView,
    car?: { x: number; z: number },
    route?: Pt[],
    garage?: { x: number; z: number } | null,
    venues?: readonly { x: number; z: number; name: string; color: string; status: string }[],
  ): void {
    const ctx = canvas.getContext('2d');
    const map = this.staticMap;
    if (!ctx || !map) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const cw = canvas.clientWidth || window.innerWidth;
    const ch = canvas.clientHeight || window.innerHeight;
    if (canvas.width !== Math.floor(cw * dpr) || canvas.height !== Math.floor(ch * dpr)) {
      canvas.width = Math.floor(cw * dpr);
      canvas.height = Math.floor(ch * dpr);
    }
    if (cw < 2 || ch < 2) return;

    const { dx, dy, s } = this.placementFor(canvas, map);
    const placement = { dx, dy, s };
    const useSat = this.radar && this.satMap.ready;

    // La base (satellite + 1090 strade) è invariante: ridisegnarla a 10 Hz
    // costava decine di millisecondi a ogni frame con la mappa aperta. Qui
    // viene rasterizzata una volta sola e poi copiata; sopra si muovono solo
    // i marker, l'itinerario e il giocatore.
    const key = `${canvas.width}x${canvas.height}:${useSat ? 1 : 0}`;
    if (key !== this.bigBaseKey || !this.bigBase) {
      const base = this.bigBase ?? document.createElement('canvas');
      base.width = canvas.width;
      base.height = canvas.height;
      const bctx = base.getContext('2d');
      if (!bctx) return;
      bctx.setTransform(1, 0, 0, 1, 0, 0);
      bctx.fillStyle = '#0c1210';
      bctx.fillRect(0, 0, base.width, base.height);
      if (useSat) {
        bctx.drawImage(
          this.satMap.canvas,
          dx + this.mapPad * s,
          dy + this.mapPad * s,
          WORLD.width * this.mapScale * s,
          WORLD.height * this.mapScale * s,
        );
        // leggera velatura per rendere leggibili strade e nomi
        bctx.fillStyle = 'rgba(10, 16, 12, 0.18)';
        bctx.fillRect(dx, dy, map.width * s, map.height * s);
        this.paintBigRoads(bctx, placement, dpr, true);
      } else {
        bctx.drawImage(map, dx, dy, map.width * s, map.height * s);
      }
      this.bigBase = base;
      this.bigBaseKey = key;
    }

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(this.bigBase, 0, 0);
    this.labelBoxes.length = 0;

    if (route && route.length > 1) {
      const project = (x: number, z: number): { x: number; y: number } => this.toStaticScreen(x, z, placement);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      this.traceRoute(ctx, route, project);
      ctx.strokeStyle = 'rgba(6, 14, 18, 0.9)';
      ctx.lineWidth = 10 * dpr;
      ctx.stroke();
      this.traceRoute(ctx, route, project);
      ctx.strokeStyle = '#4ad7ff';
      ctx.lineWidth = 5 * dpr;
      ctx.stroke();
      // frecce di marcia: dicono da che parte si va, non solo dove si passa
      this.drawRouteArrows(ctx, route, project, 150 * dpr, 3.6 * dpr);
      const end = project(route[route.length - 1].x, route[route.length - 1].z);
      this.drawPin(ctx, end.x, end.y, 10 * dpr);
    }

    // Nomi dei paesi: i centri abitati hanno la priorità, le vie arrivano dopo
    // e solo se trovano spazio.
    for (const v of VILLAGES) {
      const w = latLonToWorld(v.lat, v.lon);
      const p = this.toStaticScreen(w.x, w.z, placement);
      const isHome = v.name === HOME.name;
      if (isHome) {
        this.drawHome(ctx, p.x, p.y - 6 * dpr, 7 * dpr);
      } else {
        ctx.fillStyle = '#ff6b4a';
        ctx.beginPath();
        ctx.arc(p.x, p.y - 1 * dpr, 3.4 * dpr, 0, Math.PI * 2);
        ctx.fill();
      }
      const label = isHome ? `${v.name} · casa` : v.name;
      if (this.layers.labels) {
        this.drawLabel(
          ctx,
          label,
          p.x,
          p.y - 16 * dpr,
          15 * dpr,
          `600 ${15 * dpr}px system-ui, sans-serif`,
          isHome ? '#ffd479' : '#f3e7cf',
        );
      }
    }

    // Nomi delle vie principali, ruotati lungo la strada.
    if (this.layers.labels && this.layers.roads) {
      let placed = 0;
      for (const r of this.roads) {
        if (placed >= 14) break;
        if (r.rank > 1 || r.name.length < 3) continue;
        if (!/[a-zà-ù]/i.test(r.name)) continue;
        const mid = Math.floor(r.pts.length / 4) * 2;
        const ax = r.pts[mid];
        const az = r.pts[mid + 1];
        const bx = r.pts[mid + 2] ?? ax;
        const bz = r.pts[mid + 3] ?? az;
        if (ax === undefined || az === undefined) continue;
        const a = this.toStaticScreen(ax, az, placement);
        const b = this.toStaticScreen(bx, bz, placement);
        const angle = Math.atan2(b.y - a.y, b.x - a.x);
        if (this.drawStreetLabel(ctx, r.name, (a.x + b.x) / 2, (a.y + b.y) / 2, angle, 11 * dpr, 'rgba(244, 236, 218, 0.9)')) {
          placed++;
        }
      }
    }

    if (garage) {
      const p = this.toStaticScreen(garage.x, garage.z, placement);
      this.drawGarage(ctx, p.x, p.y - 4 * dpr, 9 * dpr);
      ctx.font = `600 ${13 * dpr}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.lineWidth = 4 * dpr;
      ctx.strokeStyle = 'rgba(8, 12, 10, 0.9)';
      ctx.strokeText('Garage', p.x, p.y + 22 * dpr);
      ctx.fillStyle = '#8ef0b0';
      ctx.fillText('Garage', p.x, p.y + 22 * dpr);
      ctx.font = `600 ${15 * dpr}px system-ui, sans-serif`;
    }

    if (this.layers.pois) this.drawVenueClusters(ctx, venues ?? [], placement, dpr);

    if (car) {
      const p = this.toStaticScreen(car.x, car.z, placement);
      ctx.fillStyle = '#f0c674';
      ctx.beginPath();
      ctx.arc(p.x, p.y, 5 * dpr, 0, Math.PI * 2);
      ctx.fill();
    }

    const pp = this.toStaticScreen(view.x, view.z, placement);
    ctx.save();
    ctx.translate(pp.x, pp.y);
    ctx.rotate(-view.yaw);
    ctx.shadowColor = 'rgba(0, 0, 0, 0.6)';
    ctx.shadowBlur = 10 * dpr;
    ctx.shadowOffsetY = 3 * dpr;
    ctx.beginPath();
    ctx.moveTo(0, -12 * dpr);
    ctx.lineTo(8 * dpr, 9 * dpr);
    ctx.lineTo(0, 5 * dpr);
    ctx.lineTo(-8 * dpr, 9 * dpr);
    ctx.closePath();
    ctx.fillStyle = '#ff6b4a';
    ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;
    ctx.strokeStyle = '#fff4e2';
    ctx.lineWidth = 2 * dpr;
    ctx.stroke();
    ctx.restore();
  }

  /**
   * POI sulla mappa grande, raggruppati quando si sovrappongono.
   *
   * A scala regionale l'intera valle sta in ~1600 px: le nove attività di
   * Palata cadono entro una trentina di pixel e i loro rombi da 15 px
   * diventavano una macchia sola, con le etichette che si scartavano a
   * vicenda e restava scritto un nome su nove. Qui si disegna un solo badge
   * con il numero; quando i POI sono abbastanza distanti tornano i simboli
   * singoli con il nome.
   */
  private drawVenueClusters(
    ctx: CanvasRenderingContext2D,
    venues: readonly { x: number; z: number; name: string; color: string; status: string }[],
    placement: { dx: number; dy: number; s: number },
    dpr: number,
  ): void {
    if (venues.length === 0) return;
    const points = venues.map((v) => this.toStaticScreen(v.x, v.z, placement));
    const groups = clusterByRadius(points, 22 * dpr);
    for (const group of groups) {
      const head = group[0]!;
      const p = points[head]!;
      if (group.length === 1) {
        const venue = venues[head]!;
        this.drawVenue(ctx, p.x, p.y - 4 * dpr, 6 * dpr, venue.color, venue.status);
        if (this.layers.labels) {
          this.drawLabel(
            ctx,
            venue.name,
            p.x,
            p.y - 15 * dpr,
            11 * dpr,
            `600 ${11 * dpr}px system-ui, sans-serif`,
            '#f3e7cf',
          );
        }
        continue;
      }
      this.drawVenueCluster(ctx, p.x, p.y, 9 * dpr, group.length);
      // etichetta sotto il badge: sopra c'è quasi sempre il nome del paese
      if (this.layers.labels) {
        this.drawLabel(
          ctx,
          `${group.length} POI`,
          p.x,
          p.y + 17 * dpr,
          10 * dpr,
          `600 ${10 * dpr}px system-ui, sans-serif`,
          'rgba(243, 231, 207, 0.92)',
        );
      }
    }
  }

  /** Badge di un gruppo di POI: cerchio chiaro con il numero dentro. */
  private drawVenueCluster(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    s: number,
    count: number,
  ): void {
    ctx.save();
    ctx.translate(x, y);
    ctx.beginPath();
    ctx.arc(0, 0, s, 0, Math.PI * 2);
    ctx.fillStyle = '#e7dcc2';
    ctx.fill();
    ctx.lineWidth = Math.max(1.4, s * 0.22);
    ctx.strokeStyle = 'rgba(8, 14, 12, 0.92)';
    ctx.stroke();
    ctx.fillStyle = '#14180f';
    ctx.font = `700 ${s * 0.95}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(count), 0, s * 0.05);
    ctx.restore();
  }

  /** Frecce lungo l'itinerario: una ogni `spacing` px, orientate sul tratto. */
  private drawRouteArrows(
    ctx: CanvasRenderingContext2D,
    route: Pt[],
    project: (x: number, z: number) => { x: number; y: number },
    spacing: number,
    sizePx: number,
  ): void {
    let carry = spacing * 0.5;
    for (let i = 1; i < route.length; i++) {
      const a = project(route[i - 1]!.x, route[i - 1]!.z);
      const b = project(route[i]!.x, route[i]!.z);
      const seg = Math.hypot(b.x - a.x, b.y - a.y);
      if (seg < 0.001) continue;
      const angle = Math.atan2(b.y - a.y, b.x - a.x);
      let t = carry;
      while (t < seg) {
        const x = a.x + (b.x - a.x) * (t / seg);
        const y = a.y + (b.y - a.y) * (t / seg);
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(angle);
        ctx.beginPath();
        ctx.moveTo(sizePx, 0);
        ctx.lineTo(-sizePx, -sizePx * 0.9);
        ctx.lineTo(-sizePx, sizePx * 0.9);
        ctx.closePath();
        ctx.fillStyle = 'rgba(8, 18, 22, 0.85)';
        ctx.fill();
        ctx.restore();
        t += spacing;
      }
      carry = t - seg;
    }
  }
}

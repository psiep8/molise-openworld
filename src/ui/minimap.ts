import { CENTER_LAT, HOME, latLonToWorld, VILLAGES, WORLD } from '../config';
import { clamp, type Pt } from '../geo/geo';
import type { OsmData } from '../geo/osm';
import { ESRI_WORLD_IMAGERY, type TileProvider } from '../world/imagery';
import { SatelliteBasemap, SatelliteTiles } from './satellite';
import { minimapMeters } from './map-scale';

interface MapRoad {
  pts: number[];
  width: number;
  paved: boolean;
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

const AREA_FILL: Record<string, string> = {
  wood: 'rgba(46, 66, 39, 0.55)',
  forest: 'rgba(46, 66, 39, 0.55)',
  scrub: 'rgba(69, 82, 47, 0.4)',
  meadow: 'rgba(105, 116, 66, 0.28)',
  grassland: 'rgba(105, 116, 66, 0.28)',
  water: 'rgba(47, 83, 96, 0.85)',
  residential: 'rgba(92, 88, 78, 0.35)',
  industrial: 'rgba(92, 88, 78, 0.35)',
  quarry: 'rgba(110, 105, 96, 0.4)',
  vineyard: 'rgba(86, 96, 48, 0.35)',
  orchard: 'rgba(76, 92, 52, 0.35)',
  park: 'rgba(66, 88, 50, 0.35)',
};

const ASPHALT = '#d7d0bd';
const DIRT = '#95866a';

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

export interface MapView {
  x: number;
  z: number;
  yaw: number;
}

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
  private staticMap: HTMLCanvasElement | null = null;
  private readonly mapScale: number;
  private readonly mapPad = 48;
  readonly satTiles: SatelliteTiles;
  readonly satMap: SatelliteBasemap;
  /** true = radar satellite, false = mappa vettoriale notturna */
  radar = true;
  /** Chiamata quando arrivano nuove tile: il gioco ridisegna le mappe. */
  onUpdate?: () => void;
  /** Base statica della mappa grande (satellite + strade), riusata a ogni frame. */
  private bigBase: HTMLCanvasElement | null = null;
  private bigBaseKey = '';

  constructor(osm: OsmData, provider: TileProvider = ESRI_WORLD_IMAGERY) {
    this.roads = packRoads(osm);
    this.areas = packAreas(osm);
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
    const w = 1600;
    const h = Math.ceil(WORLD.height * this.mapScale + this.mapPad * 2);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.fillStyle = '#16201b';
    ctx.fillRect(0, 0, w, h);

    ctx.save();
    ctx.translate(this.mapPad, this.mapPad);
    ctx.scale(this.mapScale, this.mapScale);
    ctx.translate(WORLD.halfWidth, WORLD.halfHeight);
    const minLine = 2.2 / this.mapScale;

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

    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const r of this.roads) {
      ctx.beginPath();
      for (let i = 0; i < r.pts.length; i += 2) {
        const x = r.pts[i];
        const z = r.pts[i + 1];
        if (i === 0) ctx.moveTo(x, z);
        else ctx.lineTo(x, z);
      }
      ctx.lineWidth = Math.max(r.width, minLine * (r.paved ? 1 : 0.8));
      ctx.strokeStyle = r.paved ? ASPHALT : DIRT;
      ctx.globalAlpha = r.paved ? 0.95 : 0.75;
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.restore();
    this.staticMap = canvas;
  }

  private toStaticScreen(x: number, z: number, placement: { dx: number; dy: number; s: number }): { x: number; y: number } {
    const px = (x + WORLD.halfWidth) * this.mapScale + this.mapPad;
    const py = (z + WORLD.halfHeight) * this.mapScale + this.mapPad;
    return { x: placement.dx + px * placement.s, y: placement.dy + py * placement.s };
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
    const size = canvas.width;
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
    ctx.fillStyle = this.radar ? '#26301f' : '#16201b';
    ctx.fillRect(0, 0, size, size);

    if (this.radar) {
      // zoom delle tile scelto perché un pixel di tile copra ~un pixel di
      // canvas: a 300 m la z17 mostrava pixel grandi e la strada sembrava
      // sfocata, a 200 m serviva la z18
      const mpp = viewMeters / size;
      const ideal = Math.log2((156543.03392 * Math.cos((CENTER_LAT * Math.PI) / 180)) / mpp);
      this.satTiles.draw(ctx, size, view, viewMeters, clamp(Math.round(ideal), 14, 18));
    }

    const half = viewMeters / 2;
    if (!this.radar) {
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

    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const r of this.roads) {
      if (r.maxX < view.x - half || r.minX > view.x + half || r.maxZ < view.z - half || r.minZ > view.z + half) continue;
      ctx.beginPath();
      for (let i = 0; i < r.pts.length; i += 2) {
        const px = cx + (r.pts[i] - view.x) * k;
        const py = cy + (r.pts[i + 1] - view.z) * k;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      if (this.radar) {
        // sopra la foto aerea bastano poche strade evidenziate
        ctx.lineWidth = Math.max(1.1, r.width * k * 0.55) * u;
        ctx.strokeStyle = r.paved ? 'rgba(255, 246, 219, 0.72)' : 'rgba(226, 202, 154, 0.5)';
        ctx.globalAlpha = 0.8;
      } else {
        ctx.lineWidth = Math.max(1, r.paved ? 2.6 : 1.2) * u;
        ctx.strokeStyle = r.paved ? ASPHALT : DIRT;
        ctx.globalAlpha = r.paved ? 0.95 : 0.7;
      }
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

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

    for (const venue of venues ?? []) {
      const vx = cx + (venue.x - view.x) * k;
      const vy = cy + (venue.z - view.z) * k;
      if (Math.hypot(vx - cx, vy - cy) > size / 2 - 10) continue;
      this.drawVenue(ctx, vx, vy, 4.2 * u, venue.color, venue.status);
    }

    // nomi dei paesi vicini (dentro il ritaglio circolare)
    ctx.font = `600 ${11 * u}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    for (const v of VILLAGES) {
      const w = latLonToWorld(v.lat, v.lon);
      const px = cx + (w.x - view.x) * k;
      const py = cy + (w.z - view.z) * k;
      if (Math.hypot(px - cx, py - cy) > size / 2 - 16) continue;
      ctx.lineWidth = 3 * u;
      ctx.strokeStyle = 'rgba(8, 12, 10, 0.85)';
      ctx.strokeText(v.name, px, py + 3);
      ctx.fillStyle = '#f3e7cf';
      ctx.fillText(v.name, px, py + 3);
    }

    // giocatore
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(-view.yaw);
    ctx.beginPath();
    ctx.moveTo(0, -9 * u);
    ctx.lineTo(6 * u, 7 * u);
    ctx.lineTo(0, 4 * u);
    ctx.lineTo(-6 * u, 7 * u);
    ctx.closePath();
    ctx.fillStyle = '#ff6b4a';
    ctx.fill();
    ctx.strokeStyle = '#1a1512';
    ctx.lineWidth = 1.4;
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
        bctx.lineCap = 'round';
        bctx.lineJoin = 'round';
        for (const r of this.roads) {
          const a = this.toStaticScreen(r.pts[0], r.pts[1], placement);
          bctx.beginPath();
          bctx.moveTo(a.x, a.y);
          for (let i = 2; i < r.pts.length; i += 2) {
            const p = this.toStaticScreen(r.pts[i], r.pts[i + 1], placement);
            bctx.lineTo(p.x, p.y);
          }
          bctx.lineWidth = Math.max(0.8 * dpr, r.width * this.mapScale * s * 0.9);
          bctx.strokeStyle = r.paved ? 'rgba(255, 246, 220, 0.75)' : 'rgba(224, 199, 152, 0.45)';
          bctx.stroke();
        }
      } else {
        bctx.drawImage(map, dx, dy, map.width * s, map.height * s);
      }
      this.bigBase = base;
      this.bigBaseKey = key;
    }

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(this.bigBase, 0, 0);

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
      const end = project(route[route.length - 1].x, route[route.length - 1].z);
      this.drawPin(ctx, end.x, end.y, 10 * dpr);
    }

    ctx.font = `600 ${15 * dpr}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
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
      ctx.lineWidth = 4 * dpr;
      ctx.strokeStyle = 'rgba(8, 12, 10, 0.9)';
      ctx.strokeText(label, p.x, p.y - 16 * dpr);
      ctx.fillStyle = isHome ? '#ffd479' : '#f3e7cf';
      ctx.fillText(label, p.x, p.y - 16 * dpr);
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

    for (const venue of venues ?? []) {
      const p = this.toStaticScreen(venue.x, venue.z, placement);
      this.drawVenue(ctx, p.x, p.y - 4 * dpr, 6 * dpr, venue.color, venue.status);
      ctx.font = `600 ${11 * dpr}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.lineWidth = 3.5 * dpr;
      ctx.strokeStyle = 'rgba(8, 12, 10, 0.9)';
      ctx.strokeText(venue.name, p.x, p.y - 15 * dpr);
      ctx.fillStyle = '#f3e7cf';
      ctx.fillText(venue.name, p.x, p.y - 15 * dpr);
    }
    ctx.font = `600 ${15 * dpr}px system-ui, sans-serif`;

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
    ctx.beginPath();
    ctx.moveTo(0, -12 * dpr);
    ctx.lineTo(8 * dpr, 9 * dpr);
    ctx.lineTo(0, 5 * dpr);
    ctx.lineTo(-8 * dpr, 9 * dpr);
    ctx.closePath();
    ctx.fillStyle = '#ff6b4a';
    ctx.fill();
    ctx.strokeStyle = '#fff4e2';
    ctx.lineWidth = 2 * dpr;
    ctx.stroke();
    ctx.restore();
  }
}

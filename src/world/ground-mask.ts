import { distanceToSegment2, pointInPolygon } from '../geo/geo';
import type { Heightfield } from '../geo/elevation';
import type { BuildingIndex, RoadIndex } from '../geo/osm';
import { insidePaved, pavedBounds, type PavedArea } from './paved';

/**
 * Maschera locale del terreno per la vegetazione.
 *
 * Il campo d'erba veniva riempito per rifiuto casuale: si estraeva un punto nel
 * disco da 40 m e si scartava se cadeva su strada, edificio o pendio. In un
 * centro storico l'accettazione scende sotto il 20% e servivano quasi 500.000
 * query (ognuna con 9 celle spaziali) per 82.000 ciuffi: ~6,7 s di blocco a
 * ogni ricostruzione, cioè ogni 18 m di cammino.
 *
 * Qui la stessa informazione viene rasterizzata una volta sola su una griglia
 * da 0,5 m. Le query successive sono un accesso a un array: il costo scende a
 * poche decine di millisecondi e la distribuzione dei ciuffi è più uniforme
 * (stratificata per cella) invece che a chiazze casuali.
 */
const CELL = 0.5;
/** Oltre questa distanza dal ciglio l'erba è alta quanto in campo aperto. */
const VERGE_FULL = 6.4;
/** 0…255 sulla distanza dal ciglio: 40 unità per metro (6,375 m a fondo scala). */
const ROAD_DIST_SCALE = 40;

export class GroundMask {
  readonly n: number;
  originX = 0;
  originZ = 0;
  private readonly blocked: Uint8Array;
  private readonly road: Uint8Array;
  private heights: Float32Array = new Float32Array(0);

  constructor(private readonly radius: number) {
    this.n = Math.ceil((radius * 2) / CELL);
    this.blocked = new Uint8Array(this.n * this.n);
    this.road = new Uint8Array(this.n * this.n);
  }

  get cellSize(): number {
    return CELL;
  }

  /** Costruisce la maschera intorno a (cx, cz). */
  build(
    cx: number,
    cz: number,
    heights: Heightfield,
    roads: RoadIndex,
    buildings: BuildingIndex,
    roadTolerance: number,
    buildingRadius: number,
    paved: readonly PavedArea[] = [],
  ): void {
    const n = this.n;
    const ox = cx - this.radius;
    const oz = cz - this.radius;
    this.originX = ox;
    this.originZ = oz;
    this.blocked.fill(0);
    this.road.fill(255);

    // quote ai vertici della griglia: servono per pendenza e quota dei ciuffi
    const h = new Float32Array((n + 1) * (n + 1));
    for (let j = 0; j <= n; j++) {
      const pz = oz + j * CELL;
      for (let i = 0; i <= n; i++) {
        h[j * (n + 1) + i] = heights.heightAt(ox + i * CELL, pz);
      }
    }
    this.heights = h;

    const blocked = this.blocked;
    const road = this.road;

    // pendenza dal gradiente della griglia (1 m), non da slopeAt per cella
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const h00 = h[j * (n + 1) + i]!;
        const h10 = h[j * (n + 1) + i + 1]!;
        const h01 = h[(j + 1) * (n + 1) + i]!;
        const h11 = h[(j + 1) * (n + 1) + i + 1]!;
        const gx = (h10 + h11 - h00 - h01) / (2 * CELL);
        const gz = (h01 + h11 - h00 - h10) / (2 * CELL);
        const slope = (Math.atan(Math.hypot(gx, gz)) * 180) / Math.PI;
        if (slope > 30) blocked[j * n + i] = 1;
      }
    }

    // strade: marca la carreggiata allargata e conserva la distanza dal ciglio
    roads.forEachSegmentNear(cx, cz, this.radius + VERGE_FULL + 6, (s) => {
      const reach = s.w + VERGE_FULL;
      const i0 = Math.max(0, Math.floor((s.minX - reach - ox) / CELL));
      const i1 = Math.min(n - 1, Math.floor((s.maxX + reach - ox) / CELL));
      const j0 = Math.max(0, Math.floor((s.minZ - reach - oz) / CELL));
      const j1 = Math.min(n - 1, Math.floor((s.maxZ + reach - oz) / CELL));
      for (let j = j0; j <= j1; j++) {
        const pz = oz + (j + 0.5) * CELL;
        for (let i = i0; i <= i1; i++) {
          const px = ox + (i + 0.5) * CELL;
          const d = distanceToSegment2(px, pz, s.ax, s.az, s.bx, s.bz) - s.w;
          const k = j * n + i;
          if (d <= roadTolerance + CELL * 0.5) blocked[k] = 1;
          if (d <= VERGE_FULL) {
            const v = Math.max(0, Math.min(255, Math.round(d * ROAD_DIST_SCALE)));
            if (v < road[k]!) road[k] = v;
          }
        }
      }
    });

    // piazza e sagrato: lastre battute, l'erba non ci cresce sopra
    for (const area of paved) {
      const pb = pavedBounds(area);
      const i0 = Math.max(0, Math.floor((pb.minX - ox) / CELL));
      const i1 = Math.min(n - 1, Math.floor((pb.maxX - ox) / CELL));
      const j0 = Math.max(0, Math.floor((pb.minZ - oz) / CELL));
      const j1 = Math.min(n - 1, Math.floor((pb.maxZ - oz) / CELL));
      for (let j = j0; j <= j1; j++) {
        const pz = oz + (j + 0.5) * CELL;
        for (let i = i0; i <= i1; i++) {
          const px = ox + (i + 0.5) * CELL;
          if (insidePaved(px, pz, [area])) blocked[j * n + i] = 1;
        }
      }
    }

    // edifici: stessa regola di `hitsCircle`, ma testata solo sulle celle
    // dell'impronta invece di rifare la ricerca spaziale per ogni cella
    for (const b of buildings.near(cx, cz)) {
      const i0 = Math.max(0, Math.floor((b.bounds.minX - buildingRadius - ox) / CELL));
      const i1 = Math.min(n - 1, Math.floor((b.bounds.maxX + buildingRadius - ox) / CELL));
      const j0 = Math.max(0, Math.floor((b.bounds.minZ - buildingRadius - oz) / CELL));
      const j1 = Math.min(n - 1, Math.floor((b.bounds.maxZ + buildingRadius - oz) / CELL));
      for (let j = j0; j <= j1; j++) {
        const pz = oz + (j + 0.5) * CELL;
        for (let i = i0; i <= i1; i++) {
          const k = j * n + i;
          if (blocked[k]) continue;
          const px = ox + (i + 0.5) * CELL;
          if (px < b.bounds.minX - buildingRadius || px > b.bounds.maxX + buildingRadius) continue;
          if (pz < b.bounds.minZ - buildingRadius || pz > b.bounds.maxZ + buildingRadius) continue;
          if (pointInPolygon(px, pz, b.points)) {
            blocked[k] = 1;
            continue;
          }
          for (let e = 0, p = b.points.length - 1; e < b.points.length; p = e++) {
            const a = b.points[e]!;
            const c = b.points[p]!;
            if (distanceToSegment2(px, pz, c.x, c.z, a.x, a.z) < buildingRadius) {
              blocked[k] = 1;
              break;
            }
          }
        }
      }
    }
  }

  isBlocked(i: number, j: number): boolean {
    return this.blocked[j * this.n + i] === 1;
  }

  /** Distanza dal ciglio della strada più vicina (m), saturata a ~6,4 m. */
  roadDistance(i: number, j: number): number {
    return this.road[j * this.n + i]! / ROAD_DIST_SCALE;
  }

  /** Quota interpolata dalla griglia, per non chiamare heightAt a ogni ciuffo. */
  heightAt(x: number, z: number): number {
    const n = this.n;
    const fx = (x - this.originX) / CELL;
    const fz = (z - this.originZ) / CELL;
    const i = Math.max(0, Math.min(n - 1, Math.floor(fx)));
    const j = Math.max(0, Math.min(n - 1, Math.floor(fz)));
    const tx = Math.max(0, Math.min(1, fx - i));
    const tz = Math.max(0, Math.min(1, fz - j));
    const s = n + 1;
    const h00 = this.heights[j * s + i]!;
    const h10 = this.heights[j * s + i + 1]!;
    const h01 = this.heights[(j + 1) * s + i]!;
    const h11 = this.heights[(j + 1) * s + i + 1]!;
    return (h00 * (1 - tx) + h10 * tx) * (1 - tz) + (h01 * (1 - tx) + h11 * tx) * tz;
  }
}

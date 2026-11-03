import * as THREE from 'three';
import { START } from '../config';
import type { Heightfield } from '../geo/elevation';
import { roadLift, type OsmData, type Road, type RoadIndex } from '../geo/osm';
import { ROAD_PROFILE, sidewalkWidthForRoad } from './road-profile';
import { roadPolyline } from './roads';
import { shortestFitFactor, slopeFrame, stableChoice } from './paving';
import type { WorldAsset, WorldKit, WorldSpot } from './worldkit';

/**
 * Arredo stradale GLB: marciapiedi e cordoli.
 *
 * Il manto d'asfalto resta quello procedurale di `world/roads.ts`: è l'unica
 * superficie con quota, fisica e collisioni coerenti. I moduli fotogrammetrici
 * **sono** la superficie visibile del marciapiede nei tratti urbani: lastre
 * sottili (10 triangoli per i moduli a/b) appoggiate 3 cm sopra il nastro
 * procedurale, così non c'è z-fighting e il piede non balla.
 *
 * Regole:
 *  - solo strade asfaltate con `walkSpans` (marciapiede OSM) e fuori da ponti;
 *  - **una sola variante per via**, scelta da un hash stabile di indice e nome:
 *    prima si alternavano modulo-a/modulo-b lungo la stessa strada e la
 *    pavimentazione cambiava ogni 10 m ("spezzettato");
 *  - moduli accostati lungo la tangente, su entrambi i lati, con
 *    sovrapposizione del 2% del modulo corrente;
 *  - nessun modulo cavalca un incrocio: si campiona l'intera campata;
 *  - **piano stradale, non pitch per asse**: la pendenza longitudinale e quella
 *    traversale danno `slopeX/slopeZ`, quindi i moduli seguono la strada anche
 *    quando corre lungo X (era il caso che restava orizzontale e affondava);
 *  - **niente buchi in salita**: il vecchio taglio a 12° è sparito; su curve
 *    strette il modulo si accorcia finché resta entro 2 cm dal profilo;
 *  - quota dal profilo stradale (DEM + velo asfalto + cordolo + 3 cm);
 *  - tetto per preset (`quality.roadside`), prima le strade più vicine al via.
 */

export interface RoadsideDiagnostics {
  /** moduli effettivamente piazzati (marciapiedi + cordoli) */
  modules: number;
  /** buchi fra due moduli consecutivi, oltre 5 cm */
  gaps: number;
  /** sovrapposizioni oltre il 6% della campata (il 2% è voluto, in curva) */
  overlaps: number;
  /** moduli la cui superficie si scosta dal profilo stradale oltre 2 cm */
  quoteErrors: number;
  /** campate saltate perché cadevano su un incrocio */
  junctionSkips: number;
  /** campate saltate perché fuori dal costruito */
  skipped: number;
}

export interface RoadsideResult {
  group: THREE.Group;
  sidewalks: number;
  curbs: number;
  diagnostics: RoadsideDiagnostics;
  /**
   * Spot piazzati, esposti per la diagnosi e i test: il gioco non li rilegge
   * (la scena è già costruita da `instances`).
   */
  spots: { sidewalks: readonly WorldSpot[]; curbs: readonly WorldSpot[] };
}

interface PolylineSampler {
  points: { x: number; z: number }[];
  cumulative: number[];
  length: number;
  at(s: number): { x: number; z: number; tx: number; tz: number };
}

/** Asse lungo del modulo: i pack mescolano pezzi lunghi su X e su Z. */
function lengthAxis(asset: WorldAsset): 'x' | 'z' {
  return asset.size.x >= asset.size.z ? 'x' : 'z';
}

/** Rotazione che porta l'asse lungo locale sulla tangente `(tx, tz)`. */
function yawFor(asset: WorldAsset, tx: number, tz: number): number {
  return lengthAxis(asset) === 'x' ? Math.atan2(-tz, tx) : Math.atan2(tx, tz);
}

function moduleLength(asset: WorldAsset): number {
  return Math.max(0.5, Math.max(asset.size.x, asset.size.z));
}

function makeSampler(points: readonly { x: number; z: number }[]): PolylineSampler | null {
  if (points.length < 2) return null;
  const cumulative = [0];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    cumulative.push(cumulative[i - 1]! + Math.hypot(b.x - a.x, b.z - a.z));
  }
  const length = cumulative[cumulative.length - 1]!;
  if (!(length > 1)) return null;
  return {
    points: points.map((p) => ({ x: p.x, z: p.z })),
    cumulative,
    length,
    at(s: number) {
      const distance = Math.max(0, Math.min(length, s));
      let lo = 0;
      let hi = cumulative.length - 1;
      while (lo < hi - 1) {
        const mid = (lo + hi) >> 1;
        if (cumulative[mid]! <= distance) lo = mid;
        else hi = mid;
      }
      const a = points[lo]!;
      const b = points[hi]!;
      const seg = cumulative[hi]! - cumulative[lo]! || 1;
      const t = Math.max(0, Math.min(1, (distance - cumulative[lo]!) / seg));
      return {
        x: a.x + (b.x - a.x) * t,
        z: a.z + (b.z - a.z) * t,
        tx: (b.x - a.x) / seg,
        tz: (b.z - a.z) / seg,
      };
    },
  };
}

/**
 * Vero se il punto è nel tratto urbano della strada (marciapiede procedurale).
 * La maschera è calcolata sui nodi OSM: si riporta sul punto grafico più vicino.
 */
function inTown(road: Road, x: number, z: number): boolean {
  const spans = road.walkSpans;
  if (!spans || spans.length === 0) return false;
  let best = Infinity;
  let index = 0;
  for (let i = 0; i < road.points.length; i++) {
    const p = road.points[i]!;
    const d = (p.x - x) ** 2 + (p.z - z) ** 2;
    if (d < best) {
      best = d;
      index = i;
    }
  }
  return spans[index] === true;
}

function roadPriority(road: Road): number {
  const points = roadPolyline(road);
  if (points.length === 0) return Infinity;
  let best = Infinity;
  for (const point of points) {
    best = Math.min(best, Math.hypot(point.x - START.x, point.z - START.z));
  }
  return best;
}

export function buildRoadsideKit(
  osm: OsmData,
  heights: Heightfield,
  roads: RoadIndex,
  kit: WorldKit,
  budget: number,
): RoadsideResult {
  const group = new THREE.Group();
  group.name = 'roadside-kit';
  const total = Math.max(0, Math.round(budget));
  // Solo le varianti leggere: i moduli a/b sono lastre da 10 triangoli, i
  // cordoli modulari da 216–1.080. Gli scan da 11.000–19.000 triangoli a
  // lastra restano fuori: con centinaia di moduli sarebbero milioni di
  // triangoli per un marciapiede.
  const light = (asset: WorldAsset): boolean => asset.triangles <= 1_500;
  const sidewalkAssets: WorldAsset[] = kit.variants('sidewalk').filter(light);
  const curbAssets: WorldAsset[] = kit.variants('curb').filter(light);
  const diagnostics: RoadsideDiagnostics = {
    modules: 0,
    gaps: 0,
    overlaps: 0,
    quoteErrors: 0,
    junctionSkips: 0,
    skipped: 0,
  };
  if (total === 0 || (sidewalkAssets.length === 0 && curbAssets.length === 0)) {
    return { group, sidewalks: 0, curbs: 0, diagnostics, spots: { sidewalks: [], curbs: [] } };
  }

  const sidewalkSpots: WorldSpot[] = [];
  const curbSpots: WorldSpot[] = [];
  // I cordoli sono economici e fanno la continuità; i marciapiedi fotogrammetrici
  // costano 11k triangoli l'uno, quindi si prendono circa un terzo del budget.
  const curbCap = curbAssets.length > 0 ? Math.ceil(total * 0.45) : 0;
  const sidewalkCap = sidewalkAssets.length > 0 ? total - curbCap : 0;

  // Prima le strade urbane più vicine al punto di partenza: con un budget basso
  // il paese resta completo invece di avere moduli sparsi a 2 km.
  const ordered = osm.roads
    .map((road, index) => ({ road, index, priority: roadPriority(road) }))
    .filter(
      ({ road }) =>
        road.paved &&
        road.width >= 4 &&
        road.points.length >= 2 &&
        !road.bridge &&
        !road.tunnel &&
        road.walkSpans?.some(Boolean) === true,
    )
    .sort((a, b) => a.priority - b.priority);

  /**
   * Accosta moduli lungo un lato del marciapiede.
   *
   * L'inizio del modulo successivo è `fine precedente − 2% della lunghezza
   * nuova`: così due varianti qualsiasi restano in continuità.
   */
  const laySide = (
    road: Road,
    index: number,
    sampler: PolylineSampler,
    side: 1 | -1,
    asset: WorldAsset,
    variant: number,
    spots: WorldSpot[],
    cap: number,
    role: 'sidewalk' | 'curb',
  ): void => {
    if (spots.length >= cap) return;
    const walkWidth = role === 'sidewalk' ? sidewalkWidthForRoad(road.width) : 0;
    const lateral =
      role === 'sidewalk'
        ? road.width / 2 + ROAD_PROFILE.curbWidth + walkWidth / 2
        : road.width / 2 + ROAD_PROFILE.curbWidth / 2;
    const acrossTarget = role === 'sidewalk' ? walkWidth : ROAD_PROFILE.curbWidth;
    const surfaceAt = (s: number, offset = lateral): number => {
      const p = sampler.at(s);
      const x = p.x - p.tz * side * offset;
      const z = p.z + p.tx * side * offset;
      return heights.heightAt(x, z) + roadLift(index, road.paved) + ROAD_PROFILE.curbHeight + 0.03;
    };

    const baseLength = moduleLength(asset);
    const longX = lengthAxis(asset) === 'x';
    const acrossSize = longX ? asset.size.z : asset.size.x;
    const across = acrossTarget / Math.max(0.01, acrossSize);

    let start = 0;
    let previousEnd: number | null = null;
    const maxModules = Math.ceil(sampler.length / 0.5) + 4;
    for (let guard = 0; guard < maxModules && spots.length < cap; guard++) {
      // 2 cm fissi, non il 2% del modulo: sui pezzi accorciati il 2% nominale
      // diventava un accavallamento di decine di centimetri e z-fighting.
      if (previousEnd !== null) start = Math.max(0, previousEnd - 0.02);
      if (start >= sampler.length - 0.05) break;

      // Curva o saliscendi stretto: accorcia il modulo (fino a 20%) invece di
      // saltarlo. Prima si scartavano le campate con pendenza > 12° e restava
      // un buco esattamente dove la strada saliva.
      const factor = shortestFitFactor(baseLength, 0.015, (d) => surfaceAt(start + d));
      const length = Math.max(0.4, baseLength * factor);
      const endS = start + length;
      if (endS > sampler.length + 0.05) break;
      const centerS = start + length / 2;
      const point = sampler.at(centerS);

      // Un modulo lungo 8–12 m non può passare sopra un incrocio solo perché
      // il suo centro è libero: si controllano inizio, quarti, centro e fine.
      let junction = false;
      for (const t of [0, 0.25, 0.5, 0.75, 1]) {
        const q = sampler.at(start + length * t);
        const qx = q.x - q.tz * side * lateral;
        const qz = q.z + q.tx * side * lateral;
        if (roads.isOnRoad(qx, qz, 0.35, index)) {
          junction = true;
          break;
        }
      }
      const first = sampler.at(start);
      const last = sampler.at(endS);
      const town =
        inTown(road, first.x, first.z) &&
        inTown(road, point.x, point.z) &&
        inTown(road, last.x, last.z);
      if (!town) {
        diagnostics.skipped++;
        previousEnd = endS;
        continue;
      }
      if (junction) {
        diagnostics.junctionSkips++;
        previousEnd = endS;
        continue;
      }

      const x = point.x - point.tz * side * lateral;
      const z = point.z + point.tx * side * lateral;
      const surfaceStart = surfaceAt(start);
      const surfaceEnd = surfaceAt(endS);
      const surfaceCenter = surfaceAt(centerS);
      const surfaceInner = surfaceAt(centerS, lateral - acrossTarget / 2);
      const surfaceOuter = surfaceAt(centerS, lateral + acrossTarget / 2);
      // Piano della strada: pendenza lungo la tangente e traversale. Da qui
      // slopeX/slopeZ, che valgono per qualunque orientamento del modulo.
      const frame = slopeFrame(
        (surfaceEnd - surfaceStart) / length,
        (surfaceOuter - surfaceInner) / Math.max(0.2, acrossTarget),
        point.tx,
        point.tz,
      );

      if (previousEnd !== null) {
        const overlap = previousEnd - start;
        if (overlap < -0.05) diagnostics.gaps++;
        else if (overlap > length * 0.06) diagnostics.overlaps++;
      }
      // Il modulo è una corda: se il centro si scosta dal profilo oltre 2 cm
      // la campata non è più "appoggiata" alla strada.
      if (Math.abs(surfaceCenter - (surfaceStart + surfaceEnd) / 2) > 0.02) {
        diagnostics.quoteErrors++;
      }

      spots.push({
        x,
        y: surfaceCenter - asset.size.y,
        z,
        yaw: yawFor(asset, point.tx, point.tz),
        slopeX: frame.slopeX,
        slopeZ: frame.slopeZ,
        scale: 1,
        scaleX: longX ? length / baseLength : across,
        scaleZ: longX ? across : length / baseLength,
        variant,
      });
      diagnostics.modules++;
      previousEnd = endS;
    }
  };

  for (const { road, index } of ordered) {
    if (sidewalkSpots.length >= sidewalkCap && curbSpots.length >= curbCap) break;
    const sampler = makeSampler(roadPolyline(road));
    if (!sampler) continue;
    // Una variante per via, sempre la stessa per tutti i moduli: prima
    // `laid % assets.length` alternava le pavimentazioni lungo la strada.
    const seed = [index, road.name?.length ?? 0, Math.round(road.width * 10), sampler.length];
    const sidewalkVariant = stableChoice(seed, sidewalkAssets.length);
    const curbVariant = stableChoice(seed, curbAssets.length);
    const sidewalk = sidewalkAssets[sidewalkVariant];
    const curb = curbAssets[curbVariant];
    if (!sidewalk && !curb) continue;
    for (const side of [1, -1] as const) {
      if (sidewalk) {
        laySide(
          road,
          index,
          sampler,
          side,
          sidewalk,
          sidewalkVariant,
          sidewalkSpots,
          sidewalkCap,
          'sidewalk',
        );
      }
      if (curb) {
        laySide(road, index, sampler, side, curb, curbVariant, curbSpots, curbCap, 'curb');
      }
    }
  }

  if (sidewalkSpots.length) {
    group.add(kit.instances('sidewalk', sidewalkSpots, { castShadow: true, variants: sidewalkAssets }));
  }
  if (curbSpots.length) {
    group.add(kit.instances('curb', curbSpots, { castShadow: true, variants: curbAssets }));
  }

  return {
    group,
    sidewalks: sidewalkSpots.length,
    curbs: curbSpots.length,
    diagnostics,
    spots: { sidewalks: sidewalkSpots, curbs: curbSpots },
  };
}

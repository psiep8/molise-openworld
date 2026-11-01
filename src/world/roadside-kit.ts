import * as THREE from 'three';
import { START } from '../config';
import type { Heightfield } from '../geo/elevation';
import { roadLift, type OsmData, type Road, type RoadIndex } from '../geo/osm';
import {
  ROAD_PROFILE,
  sidewalkWidthForRoad,
} from './road-profile';
import { roadPolyline } from './roads';
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
 *  - moduli accostati lungo la tangente, su entrambi i lati, con
 *    sovrapposizione del **2% della variante corrente**: con varianti di
 *    lunghezza diversa (1,15 m / 2 m / 8 m) un passo calcolato sulla lunghezza
 *    del modulo precedente lasciava buchi di decine di centimetri;
 *  - nessun modulo cavalca un incrocio: si campiona l'intera campata e non
 *    solo il centro, altrimenti un pezzo da 12 m attraversava la via laterale;
 *  - larghezza del modulo scalata alla larghezza reale del marciapiede;
 *  - quota dal profilo stradale condiviso (DEM + velo asfalto + cordolo + 3 cm),
 *    non dal DEM nudo: era quello che li faceva sprofondare sotto il nastro;
 *  - inclinazione longitudinale dal DEM ai due estremi: su un saliscendi un
 *    modulo orizzontale affonda da un lato e vola dall'altro;
 *  - tetto per preset (`quality.roadside`), prima le strade più vicine al via.
 */

export interface RoadsideDiagnostics {
  /** moduli effettivamente piazzati (marciapiedi + cordoli) */
  modules: number;
  /** buchi fra due moduli consecutivi, oltre 5 cm */
  gaps: number;
  /** sovrapposizioni oltre il 6% della campata (il 2% è voluto, in curva) */
  overlaps: number;
  /** moduli con la superficie fuori quota di oltre 1 cm */
  quoteErrors: number;
  /** campate saltate perché cadevano su un incrocio */
  junctionSkips: number;
  /** campate saltate per pendenza o perché fuori dal costruito */
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
   * Accosta moduli lungo un lato del marciapiede procedurale.
   *
   * L'inizio del modulo successivo è `fine precedente − 2% della lunghezza
   * nuova`: così due varianti qualsiasi restano in continuità, mentre il vecchio
   * passo `0,98 × lunghezza precedente` apriva un buco ogni volta che il modulo
   * dopo era più corto (le lastre del pack vanno da 1,15 a 12 m).
   */
  const laySide = (
    road: Road,
    index: number,
    sampler: PolylineSampler,
    side: 1 | -1,
    assets: readonly WorldAsset[],
    spots: WorldSpot[],
    cap: number,
    role: 'sidewalk' | 'curb',
  ): void => {
    if (assets.length === 0 || spots.length >= cap) return;
    const walkWidth = role === 'sidewalk' ? sidewalkWidthForRoad(road.width) : 0;
    const offset =
      role === 'sidewalk'
        ? road.width / 2 + ROAD_PROFILE.curbWidth + walkWidth / 2
        : road.width / 2 + ROAD_PROFILE.curbWidth / 2;
    let start = 0;
    let previousEnd: number | null = null;
    let laid = 0;
    const maxModules = Math.ceil(sampler.length / 0.5) + 4;
    for (let guard = 0; guard < maxModules && spots.length < cap; guard++) {
      const asset = role === 'curb' ? assets[0]! : assets[laid % assets.length]!;
      const length = moduleLength(asset);
      // 2% di sovrapposizione sulla variante corrente: in curva i due moduli
      // rettilinei si compenetrano invece di aprire un cuneo, e con lunghezze
      // diverse non si apre un buco.
      if (previousEnd !== null) start = Math.max(0, previousEnd - length * 0.02);
      const endS = start + length;
      if (endS > sampler.length) break;
      const centerS = start + length / 2;
      const point = sampler.at(centerS);
      const x = point.x - point.tz * side * offset;
      const z = point.z + point.tx * side * offset;

      // Un modulo lungo 8–12 m non può passare sopra un incrocio solo perché
      // il suo centro è libero: si controllano inizio, quarti, centro e fine
      // sulla linea del marciapiede. Prima bastava il centro, e le lastre
      // attraversavano le vie laterali come un ponte.
      let junction = false;
      for (const t of [0, 0.25, 0.5, 0.75, 1]) {
        const q = sampler.at(start + length * t);
        const qx = q.x - q.tz * side * offset;
        const qz = q.z + q.tx * side * offset;
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
      const slope = heights.slopeAt(x, z);
      if (!town || slope > 12) {
        diagnostics.skipped++;
        previousEnd = endS;
        continue;
      }
      if (junction) {
        diagnostics.junctionSkips++;
        previousEnd = endS;
        continue;
      }

      const longX = lengthAxis(asset) === 'x';
      const acrossSize = longX ? asset.size.z : asset.size.x;
      const targetAcross = role === 'sidewalk' ? walkWidth : ROAD_PROFILE.curbWidth;
      const across = targetAcross / Math.max(0.01, acrossSize);
      const surface =
        heights.heightAt(x, z) +
        roadLift(index, road.paved) +
        ROAD_PROFILE.curbHeight +
        0.03;
      // inclinazione lungo la campata: gli estremi seguono il DEM, altrimenti
      // su un saliscendi del 6% il modulo resta orizzontale e affonda di 35 cm
      const half = length / 2;
      const hBack = heights.heightAt(x - point.tx * half, z - point.tz * half);
      const hFore = heights.heightAt(x + point.tx * half, z + point.tz * half);
      const grade = Math.atan2(hFore - hBack, length);
      const pitch = longX ? grade : -grade;

      if (previousEnd !== null) {
        const overlap = previousEnd - start;
        if (overlap < -0.05) diagnostics.gaps++;
        else if (overlap > length * 0.06) diagnostics.overlaps++;
      }
      const y = surface - asset.size.y;
      if (Math.abs(y + asset.size.y - surface) > 0.01) diagnostics.quoteErrors++;

      spots.push({
        x,
        y,
        z,
        yaw: yawFor(asset, point.tx, point.tz),
        pitch,
        pitchAxis: longX ? 'z' : 'x',
        scale: 1,
        scaleX: longX ? 1 : across,
        scaleZ: longX ? across : 1,
        variant: assets.indexOf(asset),
      });
      diagnostics.modules++;
      laid++;
      previousEnd = endS;
    }
  };

  for (const { road, index } of ordered) {
    if (sidewalkSpots.length >= sidewalkCap && curbSpots.length >= curbCap) break;
    const sampler = makeSampler(roadPolyline(road));
    if (!sampler) continue;
    for (const side of [1, -1] as const) {
      laySide(road, index, sampler, side, sidewalkAssets, sidewalkSpots, sidewalkCap, 'sidewalk');
      laySide(road, index, sampler, side, curbAssets, curbSpots, curbCap, 'curb');
    }
  }

  // `variants` esplicito: gli spot numerano l'elenco filtrato, ma senza questo
  // `instances` rilegge tutte le varianti del ruolo e i moduli leggeri (indice
  // 0/1) diventano gli scan pesanti da 11.000 triangoli.
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

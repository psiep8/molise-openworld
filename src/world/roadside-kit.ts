import * as THREE from 'three';
import { START } from '../config';
import type { Heightfield } from '../geo/elevation';
import type { OsmData, Road, RoadIndex } from '../geo/osm';
import {
  ROAD_PROFILE,
  sidewalkWidthForRoad,
} from './road-profile';
import { roadPolyline } from './roads';
import type { WorldAsset, WorldKit, WorldSpot } from './worldkit';

/**
 * Arredo stradale GLB: marciapiedi e cordoli.
 *
 * Il manto d'asfalto, il marciapiede e il cordolo del paese restano quelli
 * procedurali di `world/roads.ts`: sono l'unica superficie con quota, fisica e
 * collisioni coerenti. Questi moduli fotogrammetrici **rivestono** quel nastro
 * nei tratti urbani, modulo dopo modulo senza buchi, alla stessa quota del
 * marciapiede procedurale (18 cm sopra la carreggiata).
 *
 * Prima erano piazzati a caso ogni 18–44 m anche fuori dal paese: sembravano
 * lastre cadute in mezzo al campo. Ora:
 *  - solo strade asfaltate con `walkSpans` (marciapiede OSM) e fuori da ponti;
 *  - moduli accostati lungo tangente, su entrambi i lati, con sovrapposizione
 *    del 2% per non lasciare fessure in curva;
 *  - quota dal profilo stradale condiviso, non dal DEM nudo;
 *  - tetto per preset (`quality.roadside`), prima le strade più vicine al via.
 */

export interface RoadsideResult {
  group: THREE.Group;
  sidewalks: number;
  curbs: number;
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
  const sidewalkAssets = kit
    .variants('sidewalk')
    .filter((asset) => moduleLength(asset) >= 4);
  const curbAssets = kit
    .variants('curb')
    .filter((asset) => moduleLength(asset) >= 2);
  if (total === 0 || (sidewalkAssets.length === 0 && curbAssets.length === 0)) {
    return { group, sidewalks: 0, curbs: 0 };
  }

  const sidewalkSpots: WorldSpot[] = [];
  const curbSpots: WorldSpot[] = [];
  // I cordoli sono economici e fanno la continuità; i marciapiedi fotogrammetrici
  // costano 11k triangoli l'uno, quindi si prendono circa un terzo del budget.
  const curbCap = curbAssets.length > 0 ? Math.ceil(total * 0.68) : 0;
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
   * Accosta moduli lungo un lato del marciapiede procedurale. Il passo è la
   * lunghezza del modulo meno il 2%: in curva due moduli rettilinei devono
   * compenetrarsi, non aprire un cuneo.
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
    let s = Math.max(2, moduleLength(assets[0]!) * 0.5);
    // Il ciclo avanza sempre di almeno un modulo: niente rischio di stallo.
    while (s < sampler.length && spots.length < cap) {
      const asset = assets[spots.length % assets.length]!;
      const length = moduleLength(asset);
      const point = sampler.at(s);
      const x = point.x - point.tz * side * offset;
      const z = point.z + point.tx * side * offset;
      if (inTown(road, point.x, point.z) && !roads.isOnRoad(x, z, 0.35, index)) {
        const slope = heights.slopeAt(x, z);
        if (slope <= 12) {
          // La base del modulo va interrata quanto basta perché la sua
          // superficie cada a 18 cm dall'asfalto, la stessa quota che legge la
          // fisica (`sampleRoadProfile`): niente marciapiedi sospesi.
          spots.push({
            x,
            y:
              heights.heightAt(x, z) +
              ROAD_PROFILE.curbHeight -
              asset.size.y +
              0.004,
            z,
            yaw: yawFor(asset, point.tx, point.tz),
            scale: 1,
            variant: assets.indexOf(asset),
          });
        }
      }
      s += Math.max(0.5, length * 0.98);
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

  if (sidewalkSpots.length) group.add(kit.instances('sidewalk', sidewalkSpots, { castShadow: true }));
  if (curbSpots.length) group.add(kit.instances('curb', curbSpots, { castShadow: true }));

  return { group, sidewalks: sidewalkSpots.length, curbs: curbSpots.length };
}

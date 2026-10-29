import * as THREE from 'three';
import { START } from '../config';
import type { Heightfield } from '../geo/elevation';
import { mulberry32 } from '../geo/geo';
import type { OsmData, Road, RoadIndex } from '../geo/osm';
import { roadPolyline } from './roads';
import type { WorldAsset, WorldKit, WorldSpot } from './worldkit';

/**
 * Arredo stradale GLB: marciapiedi e cordoli.
 *
 * Il manto d'asfalto, il marciapiede e il cordolo del paese restano quelli
 * procedurali di `world/roads.ts`: sono l'unica superficie con quota, fisica e
 * collisioni coerenti. Questi moduli fotogrammetrici si aggiungono **fuori dal
 * costruito**, dove il nastro procedurale non arriva, e danno al ciglio della
 * provinciale la materia che il terreno da solo non ha.
 *
 * Regole:
 *  - solo strade asfaltate larghe almeno 4 m e fuori dai tratti con marciapiede
 *    procedurale (`walkSpans`), per non sovrapporre due superfici;
 *  - il modulo segue la tangente della spline, quindi in curva resta accostato;
 *  - niente collisione: un cordolo alto 15 cm non deve fermare l'auto, e il
 *    marciapiede è già calpestabile;
 *  - tetto per preset (`quality.roadside`), metà moduli per ruolo.
 */

export interface RoadsideResult {
  group: THREE.Group;
  sidewalks: number;
  curbs: number;
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

function moduleWidth(asset: WorldAsset): number {
  return Math.max(0.1, Math.min(asset.size.x, asset.size.z));
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
  const sidewalkAssets = kit.variants('sidewalk');
  const curbAssets = kit.variants('curb');
  if (total === 0 || (sidewalkAssets.length === 0 && curbAssets.length === 0)) {
    return { group, sidewalks: 0, curbs: 0 };
  }

  const sidewalkSpots: WorldSpot[] = [];
  const curbSpots: WorldSpot[] = [];
  const sidewalkCap = sidewalkAssets.length > 0 ? Math.ceil(total * 0.5) : 0;
  const curbCap = curbAssets.length > 0 ? total - sidewalkCap : 0;
  const rng = mulberry32(0x5d31);
  const fromHome = (x: number, z: number): number => Math.hypot(x - START.x, z - START.z);

  /**
   * Cammina lungo una strada e piazza un modulo ogni `gap` metri. `side` si
   * alterna per non creare un muro continuo da un lato solo.
   */
  const lay = (
    road: Road,
    index: number,
    assets: readonly WorldAsset[],
    spots: WorldSpot[],
    cap: number,
    role: 'sidewalk' | 'curb',
  ): void => {
    if (assets.length === 0 || spots.length >= cap) return;
    const pts = roadPolyline(road);
    if (pts.length < 2) return;
    // parte dopo i primi metri: un modulo che spunta da un incrocio sembra un
    // pezzo caduto, non un marciapiede
    let since = 18 + rng() * 26;
    for (let i = 1; i < pts.length && spots.length < cap; i++) {
      const a = pts[i - 1]!;
      const b = pts[i]!;
      const seg = Math.hypot(b.x - a.x, b.z - a.z);
      if (seg < 1e-3) continue;
      since += seg;
      if (since < 18) continue;
      const asset = assets[Math.floor(rng() * assets.length)]!;
      const length = moduleLength(asset);
      if (since < length) continue;
      since = 0;

      const tx = (b.x - a.x) / seg;
      const tz = (b.z - a.z) / seg;
      // un modulo ogni tanto, non un cordolo continuo: due lati alternati
      const side = rng() < 0.5 ? 1 : -1;
      const offset =
        role === 'sidewalk'
          ? road.width / 2 + 0.45 + moduleWidth(asset) / 2
          : road.width / 2 + 0.12 + moduleWidth(asset) / 2;
      const x = b.x - tz * side * offset;
      const z = b.z + tx * side * offset;

      if (inTown(road, x, z)) continue;
      const distance = fromHome(x, z);
      if (distance < 140 || distance > 1900) continue;
      // non finire dentro un'altra strada (incrocio, svincolo)
      if (roads.isOnRoad(x, z, 1.1, index)) continue;
      if (heights.slopeAt(x, z) > 16) continue;

      spots.push({
        x,
        y: heights.heightAt(x, z) + (role === 'sidewalk' ? 0.035 : 0.015),
        z,
        yaw: yawFor(asset, tx, tz),
        scale: 1,
        variant: assets.indexOf(asset),
      });
    }
  };

  for (let index = 0; index < osm.roads.length; index++) {
    if (sidewalkSpots.length >= sidewalkCap && curbSpots.length >= curbCap) break;
    const road = osm.roads[index]!;
    if (!road.paved || road.width < 4 || road.points.length < 2 || road.bridge || road.tunnel) continue;
    // un lato per volta: il lato opposto lo copre il modulo successivo
    lay(road, index, sidewalkAssets, sidewalkSpots, sidewalkCap, 'sidewalk');
    lay(road, index, curbAssets, curbSpots, curbCap, 'curb');
  }

  if (sidewalkSpots.length) group.add(kit.instances('sidewalk', sidewalkSpots, { castShadow: true }));
  if (curbSpots.length) group.add(kit.instances('curb', curbSpots, { castShadow: true }));

  return { group, sidewalks: sidewalkSpots.length, curbs: curbSpots.length };
}

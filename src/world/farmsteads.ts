import * as THREE from 'three';
import { START } from '../config';
import type { Heightfield } from '../geo/elevation';
import { boundsOf, mulberry32, type Pt } from '../geo/geo';
import type { Building, BuildingIndex, OsmData, RoadIndex } from '../geo/osm';
import type { QualityLevel } from '../gfx/quality';
import type { CityKit, KitSpot } from './citykit';

/**
 * Casali di campagna.
 *
 * Il paese resta fatto dalle case vere di OSM. Fuori, dove OSM non mappa
 * altro che qualche rudere, il vuoto si riempie con i modelli low-poly del
 * bungalow pack: un casale, una rimessa e qualche ulivo o albero da frutto,
 * messi lungo le strade di campagna a 15–30 m dal ciglio. A quella distanza la
 * sagoma conta più del dettaglio, e il low-poly non si distingue.
 *
 * Ogni casale e ogni rimessa entra nell'indice delle collisioni **prima** che
 * vegetazione, erba e alberi vengano costruiti: così nessuno ci cresce dentro
 * e il giocatore non ci passa attraverso. La posizione è deterministica
 * (`mulberry32`), quindi il mondo è lo stesso a ogni avvio.
 */

const HOUSE_LIMIT: Record<QualityLevel, number> = { low: 5, medium: 11, high: 18, ultra: 24 };
const SHED_LIMIT: Record<QualityLevel, number> = { low: 3, medium: 7, high: 12, ultra: 16 };
const TREE_LIMIT: Record<QualityLevel, number> = { low: 10, medium: 26, high: 46, ultra: 64 };

/** Fascia attorno a Palata in cui non si costruisce: il paese ha già le sue case. */
const INNER_RADIUS = 260;
const OUTER_RADIUS = 2300;
/** Distanza minima fra due casali, per non farne un villaggio. */
const FARMSTEAD_GAP = 105;
/** Distanza minima da un corso d'acqua. */
const WATER_GAP = 22;
/** Dislivello massimo sotto l'impronta: oltre, la casa galleggerebbe. */
const MAX_FOOTPRINT_RISE = 0.9;

function rotatedRect(
  cx: number,
  cz: number,
  width: number,
  depth: number,
  yaw: number,
  shrink = 0.9,
): Pt[] {
  const hw = (width * shrink) / 2;
  const hd = (depth * shrink) / 2;
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  const corner = (x: number, z: number): Pt => ({
    x: cx + x * c + z * s,
    z: cz - x * s + z * c,
  });
  return [corner(-hw, -hd), corner(hw, -hd), corner(hw, hd), corner(-hw, hd)];
}

function footprint(points: Pt[], height: number): Building {
  const bounds = boundsOf(points);
  return {
    height,
    points,
    bounds,
    area: Math.max(1, (bounds.maxX - bounds.minX) * (bounds.maxZ - bounds.minZ)),
  };
}

function groundRange(heights: Heightfield, points: readonly Pt[]): { min: number; max: number } {
  let min = heights.heightAt(points[0]!.x, points[0]!.z);
  let max = min;
  for (let i = 1; i < points.length; i++) {
    const h = heights.heightAt(points[i]!.x, points[i]!.z);
    if (h < min) min = h;
    if (h > max) max = h;
  }
  return { min, max };
}

function distanceToWaterways(osm: OsmData, x: number, z: number, limit: number): number {
  const limit2 = limit * limit;
  let best = limit2;
  for (const water of osm.waterways) {
    for (const p of water.points) {
      const dx = p.x - x;
      const dz = p.z - z;
      const d2 = dx * dx + dz * dz;
      if (d2 < best) best = d2;
    }
  }
  return Math.sqrt(best);
}

/** Estrae una variante di albero con pesi: ulivi e frutteti davanti, aceri rari. */
function pickTreeVariant(kit: CityKit, rng: () => number, quality: QualityLevel): number {
  const assets = kit.variants('tree-country');
  if (assets.length === 0) return 0;
  const weights: number[] = assets.map((asset) => {
    switch (asset.slug) {
      case 'olive-tree':
        return 34;
      case 'apple-tree':
        return 20;
      case 'birch-tree':
        return 16;
      case 'lineside-pine':
        return 14;
      case 'arborvitae-conifer':
        return 12;
      case 'autumn-maple':
        // 88k triangoli: solo sui preset alti e con parsimonia
        return quality === 'high' || quality === 'ultra' ? 4 : 0;
      default:
        return 10;
    }
  });
  const total = weights.reduce((sum, w) => sum + w, 0);
  if (total <= 0) return 0;
  let roll = rng() * total;
  for (let i = 0; i < weights.length; i++) {
    roll -= weights[i]!;
    if (roll <= 0) return i;
  }
  return weights.length - 1;
}

function treeSpot(
  kit: CityKit,
  rng: () => number,
  quality: QualityLevel,
  x: number,
  z: number,
  y: number,
  scale: number,
): KitSpot {
  return {
    x,
    y,
    z,
    yaw: rng() * Math.PI * 2,
    scale,
    variant: pickTreeVariant(kit, rng, quality),
  };
}

export interface FarmsteadResult {
  group: THREE.Group;
  houses: number;
  sheds: number;
  trees: number;
}

/**
 * Pone i casali lungo le strade di campagna. Va chiamata **prima** di
 * `buildBuildings` e `buildVegetation`, così le impronte entrano subito
 * nell'indice e il resto del mondo le rispetta.
 */
export function buildFarmsteads(
  osm: OsmData,
  heights: Heightfield,
  roads: RoadIndex,
  buildings: BuildingIndex,
  kit: CityKit,
  quality: QualityLevel,
): FarmsteadResult {
  const group = new THREE.Group();
  group.name = 'farmsteads';

  const houses = kit.variants('house');
  const sheds = kit.variants('shed');
  const countryTrees = kit.variants('tree-country');
  if (houses.length === 0) return { group, houses: 0, sheds: 0, trees: 0 };

  const rng = mulberry32(0x5eed1a);
  const houseLimit = HOUSE_LIMIT[quality];
  const shedLimit = SHED_LIMIT[quality];
  const treeLimit = TREE_LIMIT[quality];

  const houseSpots: KitSpot[] = [];
  const shedSpots: KitSpot[] = [];
  const treeSpots: KitSpot[] = [];
  const placed: { x: number; z: number }[] = [];

  const farEnough = (x: number, z: number): boolean => {
    for (const p of placed) {
      if (Math.hypot(p.x - x, p.z - z) < FARMSTEAD_GAP) return false;
    }
    return true;
  };

  const clearOfWorld = (x: number, z: number, radius: number): boolean => {
    if (Math.hypot(x - START.x, z - START.z) > OUTER_RADIUS) return false;
    if (roads.isOnRoad(x, z, radius + 2.5)) return false;
    if (buildings.hitsCircle(x, z, radius + 2)) return false;
    if (distanceToWaterways(osm, x, z, WATER_GAP) < WATER_GAP) return false;
    return true;
  };

  // ---------------------------------------------------------------------------
  // 1. Casali lungo le strade
  // ---------------------------------------------------------------------------
  for (const road of osm.roads) {
    if (houseSpots.length >= houseLimit) break;
    if (road.points.length < 2) continue;
    const step = 210 + rng() * 150;
    let since = step * (0.35 + rng() * 0.8);

    for (let i = 1; i < road.points.length && houseSpots.length < houseLimit; i++) {
      const a = road.points[i - 1]!;
      const b = road.points[i]!;
      const seg = Math.hypot(b.x - a.x, b.z - a.z);
      if (seg < 1e-3) continue;
      since += seg;
      if (since < step) continue;
      since = 0;

      const tx = (b.x - a.x) / seg;
      const tz = (b.z - a.z) / seg;
      const side = rng() < 0.5 ? 1 : -1;
      const setBack = road.width / 2 + 13 + rng() * 15;
      const x = b.x - tz * side * setBack;
      const z = b.z + tx * side * setBack;
      const fromStart = Math.hypot(x - START.x, z - START.z);
      if (fromStart < INNER_RADIUS) continue;
      if (!farEnough(x, z)) continue;

      const variant = Math.floor(rng() * houses.length);
      const asset = houses[variant]!;
      const scale = 0.92 + rng() * 0.18;
      const width = asset.size.x * scale;
      const depth = asset.size.z * scale;
      const yaw = Math.atan2(tx, tz) + (rng() < 0.5 ? 0 : Math.PI) + (rng() - 0.5) * 0.22;
      const pad = Math.max(width, depth) / 2;
      if (!clearOfWorld(x, z, pad)) continue;

      const points = rotatedRect(x, z, width, depth, yaw);
      const ground = groundRange(heights, points);
      if (ground.max - ground.min > MAX_FOOTPRINT_RISE) continue;
      if (heights.slopeAt(x, z) > 9) continue;

      const y = ground.min - 0.06;
      houseSpots.push({ x, y, z, yaw, scale, variant });
      placed.push({ x, z });
      buildings.add(footprint(points, asset.size.y * scale));

      // -----------------------------------------------------------------------
      // 2. Rimessa accanto al casale
      // -----------------------------------------------------------------------
      if (sheds.length > 0 && shedSpots.length < shedLimit && rng() < 0.72) {
        const shedVariant = Math.floor(rng() * sheds.length);
        const shedAsset = sheds[shedVariant]!;
        const shedScale = 0.9 + rng() * 0.15;
        const shedW = shedAsset.size.x * shedScale;
        const shedD = shedAsset.size.z * shedScale;
        const lateral = (width / 2 + shedW / 2 + 2.6 + rng() * 2.2) * (rng() < 0.5 ? 1 : -1);
        const back = (depth / 2 - shedD / 2 - 1.2) * (rng() < 0.5 ? 1 : -1);
        const c = Math.cos(yaw);
        const s = Math.sin(yaw);
        const sx = x + lateral * c + back * s;
        const sz = z - lateral * s + back * c;
        const shedPoints = rotatedRect(sx, sz, shedW, shedD, yaw + (rng() - 0.5) * 0.12);
        const shedGround = groundRange(heights, shedPoints);
        if (
          shedGround.max - shedGround.min <= MAX_FOOTPRINT_RISE &&
          heights.slopeAt(sx, sz) <= 11 &&
          !roads.isOnRoad(sx, sz, Math.max(shedW, shedD) / 2 + 1.5) &&
          !buildings.hitsCircle(sx, sz, 0.1) &&
          distanceToWaterways(osm, sx, sz, WATER_GAP) >= WATER_GAP
        ) {
          shedSpots.push({
            x: sx,
            y: shedGround.min - 0.05,
            z: sz,
            yaw: yaw + (rng() - 0.5) * 0.12,
            scale: shedScale,
            variant: shedVariant,
          });
          buildings.add(footprint(shedPoints, shedAsset.size.y * shedScale));
        }
      }

      // -----------------------------------------------------------------------
      // 3. Ulivi e alberi da frutto attorno al casale
      // -----------------------------------------------------------------------
      if (countryTrees.length > 0) {
        const wanted = 2 + Math.floor(rng() * 4);
        for (let n = 0; n < wanted && treeSpots.length < treeLimit; n++) {
          const angle = rng() * Math.PI * 2;
          const radius = 8 + rng() * 16;
          const tx2 = x + Math.cos(angle) * radius;
          const tz2 = z + Math.sin(angle) * radius;
          if (
            roads.isOnRoad(tx2, tz2, 1.2) ||
            buildings.hitsCircle(tx2, tz2, 1.6) ||
            heights.slopeAt(tx2, tz2) > 20
          ) {
            continue;
          }
          treeSpots.push(
            treeSpot(kit, rng, quality, tx2, tz2, heights.heightAt(tx2, tz2), 0.85 + rng() * 0.5),
          );
        }
      }
    }
  }

  // ---------------------------------------------------------------------------
  // 4. Alberi sparsi lungo i bordi delle strade di campagna
  //
  // Non sono filari: in Molise gli ulivi stanno a gruppi irregolari. Qui si
  // mettono solo dove c'è spazio, fuori dal paese e lontano dalle case.
  // ---------------------------------------------------------------------------
  if (countryTrees.length > 0) {
    for (const road of osm.roads) {
      if (treeSpots.length >= treeLimit) break;
      let since = 20 + rng() * 40;
      for (let i = 1; i < road.points.length && treeSpots.length < treeLimit; i++) {
        const a = road.points[i - 1]!;
        const b = road.points[i]!;
        const seg = Math.hypot(b.x - a.x, b.z - a.z);
        if (seg < 1e-3) continue;
        since += seg;
        if (since < 48) continue;
        since = 0;
        if (rng() > 0.42) continue;

        const tx = (b.x - a.x) / seg;
        const tz = (b.z - a.z) / seg;
        const side = rng() < 0.5 ? 1 : -1;
        const off = road.width / 2 + 5 + rng() * 9;
        const x = b.x - tz * side * off;
        const z = b.z + tx * side * off;
        if (Math.hypot(x - START.x, z - START.z) < INNER_RADIUS) continue;
        if (Math.hypot(x - START.x, z - START.z) > OUTER_RADIUS) continue;
        if (roads.isOnRoad(x, z, 1.1) || buildings.hitsCircle(x, z, 2)) continue;
        if (heights.slopeAt(x, z) > 24) continue;
        if (!farEnough(x, z)) continue;

        treeSpots.push(treeSpot(kit, rng, quality, x, z, heights.heightAt(x, z), 0.8 + rng() * 0.55));
      }
    }
  }

  // ---------------------------------------------------------------------------
  // 5. Istanze
  // ---------------------------------------------------------------------------
  if (houseSpots.length) {
    group.add(kit.instances('house', houseSpots, { castShadow: true, receiveShadow: true }));
  }
  if (shedSpots.length) {
    group.add(kit.instances('shed', shedSpots, { castShadow: true, receiveShadow: true }));
  }
  if (treeSpots.length) {
    group.add(kit.instances('tree-country', treeSpots, { castShadow: true, receiveShadow: true }));
  }

  return {
    group,
    houses: houseSpots.length,
    sheds: shedSpots.length,
    trees: treeSpots.length,
  };
}

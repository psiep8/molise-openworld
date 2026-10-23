import * as THREE from 'three';
import { START } from '../config';
import type { Heightfield } from '../geo/elevation';
import { mulberry32 } from '../geo/geo';
import { roadLift, type BuildingIndex, type OsmData, type RoadIndex } from '../geo/osm';
import type { QualityLevel } from '../gfx/quality';
import type { CityKit } from './citykit';

/**
 * Arredo "di strada" del kit: alberi con griglia e auto in sosta.
 *
 * Non è un arredo a caso: gli alberi stanno sul marciapiede, dentro il paese e
 * a distanza regolare (~26 m), come i filari veri; le auto stanno sulla fascia
 * di sosta a filo del marciapiede, girate nel senso di marcia, e solo dove la
 * strada è abbastanza larga. Fuori dal paese non si pianta niente: in campagna
 * ci pensa già `vegetation.ts`.
 *
 * Tutto è deterministico (`mulberry32` con seed fisso) e limitato dal preset
 * grafico: sono modelli da 24k–65k triangoli, non card.
 */

const TREE_LIMIT: Record<QualityLevel, number> = { low: 0, medium: 10, high: 22, ultra: 32 };
const CAR_LIMIT: Record<QualityLevel, number> = { low: 4, medium: 10, high: 18, ultra: 24 };
const TREE_RADIUS = 760;
const CAR_RADIUS = 560;

/** Tinte plausibili per una berlina in un paese: niente colori da showroom. */
const CAR_COLORS = [
  0xe8e6e1, 0xb9bcc0, 0x8f9498, 0x4a4e52, 0x24272a, 0x7c1f22, 0x1d3a5f, 0x2c4a3a, 0xb7a98c,
  0x5c5148, 0xd9d4c6, 0x3c3f44,
];

export interface CityPropsResult {
  group: THREE.Group;
  trees: number;
  cars: number;
}

export function buildCityProps(
  osm: OsmData,
  heights: Heightfield,
  roads: RoadIndex,
  buildings: BuildingIndex,
  kit: CityKit,
  quality: QualityLevel,
): CityPropsResult {
  const group = new THREE.Group();
  group.name = 'city-props';
  const rng = mulberry32(0x9c17);
  const treeLimit = TREE_LIMIT[quality];
  const carLimit = CAR_LIMIT[quality];
  const treeSpots: { x: number; y: number; z: number; yaw: number; scale: number }[] = [];
  const carSpots: { x: number; y: number; z: number; yaw: number; color: number }[] = [];

  const inTown = (x: number, z: number): boolean => {
    for (const building of buildings.near(x, z)) {
      if (
        x > building.bounds.minX - 30 &&
        x < building.bounds.maxX + 30 &&
        z > building.bounds.minZ - 30 &&
        z < building.bounds.maxZ + 30
      ) {
        return true;
      }
    }
    return false;
  };

  for (const [roadIndex, road] of osm.roads.entries()) {
    if (!road.paved || road.width < 4) continue;
    const walkWidth = road.width >= 6 ? 1.8 : 1.45;
    let sinceTree = 0;
    let sinceCar = 0;

    for (let i = 1; i < road.points.length; i++) {
      const a = road.points[i - 1];
      const b = road.points[i];
      const seg = Math.hypot(b.x - a.x, b.z - a.z);
      if (seg < 1e-3) continue;
      sinceTree += seg;
      sinceCar += seg;
      const tx = (b.x - a.x) / seg;
      const tz = (b.z - a.z) / seg;

      if (treeSpots.length < treeLimit && sinceTree >= 26) {
        sinceTree = 0;
        if (inTown(b.x, b.z) && Math.hypot(b.x - START.x, b.z - START.z) <= TREE_RADIUS) {
          const side = rng() < 0.5 ? 1 : -1;
          const off = road.width / 2 + 0.22 + Math.min(0.8, walkWidth / 2);
          const x = b.x - tz * side * off;
          const z = b.z + tx * side * off;
          if (
            !roads.isOnRoad(x, z, 0.6, roadIndex) &&
            !buildings.hitsCircle(x, z, 1.6) &&
            heights.slopeAt(x, z) <= 12 &&
            treeSpots.every((t) => Math.hypot(t.x - x, t.z - z) > 6)
          ) {
            treeSpots.push({
              x,
              y: heights.heightAt(x, z),
              z,
              yaw: rng() * Math.PI * 2,
              scale: 0.88 + rng() * 0.22,
            });
          }
        }
      }

      if (carSpots.length < carLimit && sinceCar >= 28) {
        sinceCar = 0;
        if (Math.hypot(b.x - START.x, b.z - START.z) > CAR_RADIUS) continue;
        // senso di marcia scelto per strada: la sosta sta sulla destra
        const forward = ((roadIndex + Math.floor(i / 12)) % 2 === 0 ? 1 : -1) as 1 | -1;
        const fx = tx * forward;
        const fz = tz * forward;
        // destra rispetto al verso: (fz, -fx)
        // 1,15 m dal bordo: la carrozzeria (2,07 m) resta dentro l'asfalto
        const x = b.x + fz * (road.width / 2 - 1.15);
        const z = b.z - fx * (road.width / 2 - 1.15);
        if (
          Math.hypot(x - START.x, z - START.z) < 9 ||
          roads.isOnRoad(x, z, 0.5, roadIndex) ||
          buildings.hitsCircle(x, z, 1.3) ||
          heights.slopeAt(x, z) > 9 ||
          treeSpots.some((t) => Math.hypot(t.x - x, t.z - z) < 2.6)
        ) {
          continue;
        }
        carSpots.push({
          x,
          y: heights.heightAt(x, z) + roadLift(roadIndex, true),
          z,
          yaw: Math.atan2(fx, fz),
          color: CAR_COLORS[Math.floor(rng() * CAR_COLORS.length)],
        });
      }
    }
  }

  if (treeSpots.length && kit.has('tree-street')) {
    group.add(kit.instances('tree-street', treeSpots, { castShadow: true, receiveShadow: true }));
  }
  if (carSpots.length && kit.has('car')) {
    group.add(kit.instances('car', carSpots, { castShadow: true, receiveShadow: true, tintPaint: true }));
  }
  return { group, trees: treeSpots.length, cars: carSpots.length };
}

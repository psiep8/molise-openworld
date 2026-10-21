import * as THREE from 'three';
import { TREES_MAX } from '../config';
import type { Heightfield } from '../geo/elevation';
import { mulberry32, pointInPolygon } from '../geo/geo';
import type { BuildingIndex, OsmData, RoadIndex } from '../geo/osm';

const TREE_KINDS = new Set(['wood', 'forest', 'scrub', 'orchard', 'park']);
const FOLIAGE_COLORS = [0x3d5a30, 0x476a37, 0x526f3b, 0x3a512c, 0x5c7440];

export function buildVegetation(
  osm: OsmData,
  heights: Heightfield,
  roads: RoadIndex,
  buildings: BuildingIndex,
): { group: THREE.Group; count: number } {
  const rng = mulberry32(0x5eed);
  const placements: { x: number; y: number; z: number; s: number; rot: number; color: number }[] = [];

  for (const area of osm.areas) {
    if (!TREE_KINDS.has(area.kind)) continue;
    const b = area.bounds;
    const step = area.kind === 'orchard' ? 18 : 25;
    for (let z = b.minZ; z <= b.maxZ; z += step) {
      for (let x = b.minX; x <= b.maxX; x += step) {
        if (placements.length >= TREES_MAX) break;
        const px = x + (rng() - 0.5) * step * 0.9;
        const pz = z + (rng() - 0.5) * step * 0.9;
        if (!pointInPolygon(px, pz, area.points)) continue;
        if (heights.slopeAt(px, pz) > 34) continue;
        if (roads.isOnRoad(px, pz, 1.6)) continue;
        if (buildings.near(px, pz).length > 0) continue;
        placements.push({
          x: px,
          y: heights.heightAt(px, pz),
          z: pz,
          s: 0.72 + rng() * 0.75,
          rot: rng() * Math.PI * 2,
          color: FOLIAGE_COLORS[Math.floor(rng() * FOLIAGE_COLORS.length)],
        });
      }
    }
  }

  const group = new THREE.Group();
  group.name = 'vegetation';
  if (placements.length === 0) return { group, count: 0 };

  const trunkGeo = new THREE.CylinderGeometry(0.16, 0.3, 2.1, 5);
  trunkGeo.translate(0, 1.05, 0);
  const crownGeo = new THREE.IcosahedronGeometry(1.85, 0);
  crownGeo.scale(1, 1.35, 1);
  crownGeo.translate(0, 3.15, 0);

  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x5b4632, roughness: 1, flatShading: true });
  const crownMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, flatShading: true });

  const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, placements.length);
  const crowns = new THREE.InstancedMesh(crownGeo, crownMat, placements.length);
  trunks.castShadow = true;
  crowns.castShadow = true;
  crowns.receiveShadow = false;

  const dummy = new THREE.Object3D();
  const color = new THREE.Color();
  placements.forEach((p, i) => {
    dummy.position.set(p.x, p.y - 0.15, p.z);
    dummy.rotation.set(0, p.rot, 0);
    dummy.scale.setScalar(p.s);
    dummy.updateMatrix();
    trunks.setMatrixAt(i, dummy.matrix);
    crowns.setMatrixAt(i, dummy.matrix);
    color.setHex(p.color).multiplyScalar(0.9 + (i % 17) / 90);
    crowns.setColorAt(i, color);
  });
  trunks.instanceMatrix.needsUpdate = true;
  crowns.instanceMatrix.needsUpdate = true;
  if (crowns.instanceColor) crowns.instanceColor.needsUpdate = true;

  group.add(trunks, crowns);
  return { group, count: placements.length };
}

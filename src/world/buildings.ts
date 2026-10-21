import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Heightfield } from '../geo/elevation';
import { hashInt, type Pt } from '../geo/geo';
import type { Building, OsmData } from '../geo/osm';

const WALL_COLORS = [0xd9cbb1, 0xe7ddc6, 0xcdbb9a, 0xd8c3a4, 0xe3d6bb, 0xc2b197, 0xd2c2a8, 0xe9dfcc];
const ROOF_COLORS = [0x9c5b3f, 0xaa6a4a, 0x8c4f38, 0xb3765a, 0x8f5a42];

function applyColor(geometry: THREE.BufferGeometry, color: THREE.Color): void {
  const count = geometry.attributes.position.count;
  const array = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    array[i * 3] = color.r;
    array[i * 3 + 1] = color.g;
    array[i * 3 + 2] = color.b;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(array, 3));
}

function centroid(points: Pt[]): Pt {
  let x = 0;
  let z = 0;
  for (const p of points) {
    x += p.x;
    z += p.z;
  }
  return { x: x / points.length, z: z / points.length };
}

function buildOne(b: Building, heights: Heightfield, seed: number): { wall: THREE.BufferGeometry; roof: THREE.BufferGeometry } {
  const c = centroid(b.points);
  const base = heights.heightAt(c.x, c.z) - 0.7;
  const shape = new THREE.Shape(b.points.map((p) => new THREE.Vector2(p.x, -p.z)));
  const wall = new THREE.ExtrudeGeometry(shape, { depth: b.height, bevelEnabled: false, steps: 1 });
  wall.rotateX(-Math.PI / 2);
  wall.translate(0, base, 0);

  // tetto piatto in laterizio, con un filo di sporto
  const overhang = 1.045;
  const roofShape = new THREE.Shape(
    b.points.map((p) => new THREE.Vector2(c.x + (p.x - c.x) * overhang, -(c.z + (p.z - c.z) * overhang))),
  );
  const roof = new THREE.ShapeGeometry(roofShape);
  roof.rotateX(-Math.PI / 2);
  roof.translate(0, base + b.height + 0.05, 0);

  const wallColor = new THREE.Color(WALL_COLORS[hashInt(seed, 3) % WALL_COLORS.length]);
  const roofColor = new THREE.Color(ROOF_COLORS[hashInt(seed, 11) % ROOF_COLORS.length]);
  const shade = 0.92 + (hashInt(seed, 5) % 100) / 700;
  wallColor.multiplyScalar(shade);
  roofColor.multiplyScalar(shade);
  applyColor(wall, wallColor);
  applyColor(roof, roofColor);

  return { wall, roof };
}

/**
 * Edifici estrusi dalle impronte OSM (altezza da tag o stimata).
 * Due sole mesh (muri + tetti) tenute separate anche per l'ombra.
 */
export function buildBuildings(osm: OsmData, heights: Heightfield): { group: THREE.Group; count: number } {
  const group = new THREE.Group();
  group.name = 'buildings';
  const walls: THREE.BufferGeometry[] = [];
  const roofs: THREE.BufferGeometry[] = [];

  osm.buildings.forEach((b, i) => {
    if (b.points.length < 3 || b.area < 6) return;
    try {
      const out = buildOne(b, heights, i * 31 + Math.round(b.height * 10));
      walls.push(out.wall);
      roofs.push(out.roof);
    } catch {
      // geometria degenere: la saltiamo
    }
  });

  const wallMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.96, metalness: 0 });
  const roofMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0 });

  if (walls.length) {
    const merged = mergeGeometries(walls, false);
    if (merged) {
      const mesh = new THREE.Mesh(merged, wallMat);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);
    }
  }
  if (roofs.length) {
    const merged = mergeGeometries(roofs, false);
    if (merged) {
      const mesh = new THREE.Mesh(merged, roofMat);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);
    }
  }

  for (const g of walls) g.dispose();
  for (const g of roofs) g.dispose();

  return { group, count: walls.length };
}

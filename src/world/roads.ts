import * as THREE from 'three';
import { COLORS } from '../config';
import type { Heightfield } from '../geo/elevation';
import { hashInt, type Pt } from '../geo/geo';
import type { OsmData } from '../geo/osm';

interface RibbonArrays {
  positions: number[];
  normals: number[];
  colors: number[];
  indices: number[];
}

const emptyRibbon = (): RibbonArrays => ({ positions: [], normals: [], colors: [], indices: [] });

/** Ricampiona una polilinea a passi regolari (metri). */
export function resample(points: Pt[], step: number): Pt[] {
  if (points.length < 2) return points.slice();
  const out: Pt[] = [points[0]];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    if (len < 1e-4) continue;
    const n = Math.max(1, Math.ceil(len / step));
    for (let k = 1; k <= n; k++) {
      const t = k / n;
      out.push({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t });
    }
  }
  return out;
}

function pushRibbon(
  target: RibbonArrays,
  pts: Pt[],
  width: number,
  lift: number,
  color: THREE.Color,
  heights: Heightfield,
  shade: number,
): void {
  if (pts.length < 2) return;
  const base = target.positions.length / 3;
  for (let i = 0; i < pts.length; i++) {
    const prev = pts[Math.max(0, i - 1)];
    const next = pts[Math.min(pts.length - 1, i + 1)];
    let tx = next.x - prev.x;
    let tz = next.z - prev.z;
    const len = Math.hypot(tx, tz) || 1;
    tx /= len;
    tz /= len;
    // perpendicolare in pianta
    const px = -tz;
    const pz = tx;
    const half = width / 2;
    const h = heights.heightAt(pts[i].x, pts[i].z) + lift;
    const n = heights.normalAt(pts[i].x, pts[i].z, 5);
    const nl = Math.hypot(n.x, n.y, n.z) || 1;

    for (const side of [-1, 1]) {
      target.positions.push(pts[i].x + px * half * side, h, pts[i].z + pz * half * side);
      target.normals.push(n.x / nl, n.y / nl, n.z / nl);
      target.colors.push(color.r * shade, color.g * shade, color.b * shade);
    }
    if (i > 0) {
      const a = base + (i - 1) * 2;
      target.indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
}

function toGeometry(a: RibbonArrays): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(a.positions, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(a.normals, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(a.colors, 3));
  g.setIndex(a.positions.length / 3 > 65000 ? new THREE.Uint32BufferAttribute(a.indices, 1) : new THREE.Uint16BufferAttribute(a.indices, 1));
  g.computeBoundingSphere();
  return g;
}

/**
 * Strade come nastri drappeggiati sul DEM. Due mesh (asfalto/sterrato) per
 * limitare le draw call, con leggera variazione di tono per non sembrare finto.
 */
export function buildRoads(osm: OsmData, heights: Heightfield): THREE.Group {
  const group = new THREE.Group();
  group.name = 'roads';
  const asphalt = emptyRibbon();
  const dirt = emptyRibbon();
  const asphaltColor = new THREE.Color(COLORS.asphalt);
  const dirtColor = new THREE.Color(COLORS.dirt);

  osm.roads.forEach((road, idx) => {
    const pts = resample(road.points, road.paved ? 7 : 6);
    const isDirt = !road.paved;
    const target = isDirt ? dirt : asphalt;
    const base = isDirt ? dirtColor : asphaltColor;
    const color = base.clone().multiplyScalar(0.86 + (hashInt(idx, 7) % 100) / 400);
    // micro offset per evitare z-fighting negli incroci
    const lift = (isDirt ? 0.12 : 0.2) + (idx % 7) * 0.004;
    pushRibbon(target, pts, road.width, lift, color, heights, 1);
  });

  const asphaltMat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.94,
    metalness: 0,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  const dirtMat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 1,
    metalness: 0,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });

  if (asphalt.indices.length) {
    const mesh = new THREE.Mesh(toGeometry(asphalt), asphaltMat);
    mesh.name = 'asphalt';
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  if (dirt.indices.length) {
    const mesh = new THREE.Mesh(toGeometry(dirt), dirtMat);
    mesh.name = 'dirt-roads';
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  return group;
}

/** Fiumi/torrenti come nastri azzurri; laghi e invasi come poligoni piatti. */
export function buildWater(osm: OsmData, heights: Heightfield): THREE.Group {
  const group = new THREE.Group();
  group.name = 'water';
  const ribbons = emptyRibbon();
  const waterColor = new THREE.Color(COLORS.water);

  for (const w of osm.waterways) {
    const width = w.type === 'river' ? 5 : w.type === 'canal' ? 3.2 : 2.2;
    pushRibbon(ribbons, resample(w.points, 8), width, 0.08, waterColor, heights, 1);
  }

  const ribbonMat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.24,
    metalness: 0.15,
    transparent: true,
    opacity: 0.9,
    side: THREE.DoubleSide,
  });
  if (ribbons.indices.length) {
    const mesh = new THREE.Mesh(toGeometry(ribbons), ribbonMat);
    mesh.name = 'streams';
    group.add(mesh);
  }

  const polygonGeoms: THREE.BufferGeometry[] = [];
  for (const area of osm.areas) {
    if (area.kind !== 'water' || area.points.length < 3) continue;
    let top = -Infinity;
    for (const p of area.points) top = Math.max(top, heights.heightAt(p.x, p.z));
    const shape = new THREE.Shape(area.points.map((p) => new THREE.Vector2(p.x, -p.z)));
    const g = new THREE.ShapeGeometry(shape);
    g.rotateX(-Math.PI / 2);
    g.translate(0, top + 0.12, 0);
    polygonGeoms.push(g);
  }
  if (polygonGeoms.length) {
    const merged = mergeSimple(polygonGeoms);
    const mesh = new THREE.Mesh(
      merged,
      new THREE.MeshStandardMaterial({
        color: COLORS.water,
        roughness: 0.2,
        metalness: 0.2,
        transparent: true,
        opacity: 0.92,
      }),
    );
    mesh.name = 'water-areas';
    group.add(mesh);
  }
  return group;
}

function mergeSimple(geometries: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  let offset = 0;
  for (const g of geometries) {
    const pos = g.attributes.position as THREE.BufferAttribute;
    const nor = g.attributes.normal as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      positions.push(pos.getX(i), pos.getY(i), pos.getZ(i));
      normals.push(nor.getX(i), nor.getY(i), nor.getZ(i));
    }
    const idx = g.index;
    if (idx) {
      for (let i = 0; i < idx.count; i++) indices.push(idx.getX(i) + offset);
    } else {
      for (let i = 0; i < pos.count; i++) indices.push(i + offset);
    }
    offset += pos.count;
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  out.setIndex(offset > 65000 ? new THREE.Uint32BufferAttribute(indices, 1) : new THREE.Uint16BufferAttribute(indices, 1));
  out.computeBoundingSphere();
  return out;
}

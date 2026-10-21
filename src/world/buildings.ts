import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Heightfield } from '../geo/elevation';
import { hashInt, type Pt } from '../geo/geo';
import type { Building, OsmData } from '../geo/osm';
import { clamp } from '../geo/geo';
import { pbr } from '../gfx/textures';
import { facadeTexture } from './surface-textures';
import { planHipRoof, type HipRoofPlan, type Pt3 } from './roof';

const WALL_COLORS = [0xd9cbb1, 0xe7ddc6, 0xcdbb9a, 0xd8c3a4, 0xe3d6bb, 0xc2b197, 0xd2c2a8, 0xe9dfcc];
/**
 * Tinte chiare: il colore dei coppi arriva dalla texture CC0, qui si varia solo
 * la luminosità/calore per casa, senza scurire il laterizio.
 */
const ROOF_COLORS = [0xffffff, 0xf2e8df, 0xe8dbd0, 0xf7eee6, 0xdfd2c7];

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

/**
 * Geometria del tetto a padiglione: una falda per lato più il colmo.
 * Il verso delle facce viene corretto in base alla normale, così vale per
 * impronte OSM con orientamento orario o antiorario.
 */
function buildHipGeometry(plan: HipRoofPlan, tile = 2.7): THREE.BufferGeometry {
  const positions: number[] = [];
  const uvs: number[] = [];

  const pushTri = (
    a: Pt3,
    b: Pt3,
    c: Pt3,
    ua: [number, number],
    ub: [number, number],
    uc: [number, number],
  ): void => {
    // componente y della normale: deve guardare in alto
    const ny = (b.z - a.z) * (c.x - a.x) - (b.x - a.x) * (c.z - a.z);
    const verts = ny < 0 ? [a, c, b] : [a, b, c];
    const uv = ny < 0 ? [ua, uc, ub] : [ua, ub, uc];
    for (let i = 0; i < 3; i++) {
      positions.push(verts[i].x, verts[i].y, verts[i].z);
      uvs.push(uv[i][0], uv[i][1]);
    }
  };

  let uCursor = 0;
  for (const slope of plan.slopes) {
    const [a, b, c, d] = slope.corners;
    const u0 = uCursor / tile;
    const u1 = (uCursor + slope.eaveLength) / tile;
    const v1 = slope.slopeLength / tile;
    pushTri(a, b, c, [u0, 0], [u1, 0], [u1, v1]);
    pushTri(a, c, d, [u0, 0], [u1, v1], [u0, v1]);
    uCursor += slope.eaveLength;
  }

  // colmo: superficie piana triangolata con l'utility di Three.js
  const ring2 = plan.ridgeRing.map((p) => new THREE.Vector2(p.x, -p.z));
  const uvFor = (p: { x: number; z: number }): [number, number] => [p.x / tile, p.z / tile];
  const at = (p: { x: number; z: number }): Pt3 => ({ x: p.x, y: plan.ridgeY, z: p.z });
  for (const [i, j, k] of THREE.ShapeUtils.triangulateShape(ring2, [])) {
    const pi = plan.ridgeRing[i];
    const pj = plan.ridgeRing[j];
    const pk = plan.ridgeRing[k];
    pushTri(at(pi), at(pj), at(pk), uvFor(pi), uvFor(pj), uvFor(pk));
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.computeVertexNormals();
  return geometry;
}

function buildOne(b: Building, heights: Heightfield, seed: number): { wall: THREE.BufferGeometry; roof: THREE.BufferGeometry } {
  const c = centroid(b.points);
  const base = heights.heightAt(c.x, c.z) - 0.7;
  const shape = new THREE.Shape(b.points.map((p) => new THREE.Vector2(p.x, -p.z)));
  const wall = new THREE.ExtrudeGeometry(shape, { depth: b.height, bevelEnabled: false, steps: 1 });
  wall.rotateX(-Math.PI / 2);
  wall.translate(0, base, 0);

  // ExtrudeGeometry usa v = 1 - altezza: la negazione raddrizza la finestra
  const wallUv = wall.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < wallUv.count; i++) wallUv.setY(i, -wallUv.getY(i));
  wallUv.needsUpdate = true;

  // tetto a falde con sporto; se l'impronta è troppo irregolare resta piatto
  const overhang = 1.045;
  const footprint = b.points.map((p) => ({
    x: c.x + (p.x - c.x) * overhang,
    z: c.z + (p.z - c.z) * overhang,
  }));
  const roofTop = base + b.height + 0.05;
  const rise = clamp(Math.sqrt(Math.max(4, b.area)) * 0.16, 1, 3.2);
  const plan = planHipRoof(footprint, roofTop, rise);
  let roof: THREE.BufferGeometry;
  if (plan) {
    roof = buildHipGeometry(plan);
  } else {
    const roofShape = new THREE.Shape(footprint.map((p) => new THREE.Vector2(p.x, -p.z)));
    // non indicizzato come le falde: mergeGeometries esige attributi compatibili
    roof = new THREE.ShapeGeometry(roofShape).toNonIndexed();
    roof.rotateX(-Math.PI / 2);
    roof.translate(0, roofTop, 0);
  }

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
export function buildBuildings(
  osm: OsmData,
  heights: Heightfield,
  renderer: THREE.WebGLRenderer,
): { group: THREE.Group; count: number } {
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

  const facade = facadeTexture();
  facade.repeat.set(0.3, 0.3);
  // alza la prima fila di finestre di ~0,9 m dal suolo
  facade.offset.set(0, -0.28);
  // Normal e roughness reali dell'intonaco, indipendenti dal disegno della
  // facciata: un tile ogni ~2 m sulle UV metriche del muro.
  const plaster = pbr(renderer, 'plaster', { color: false, repeat: 0.5 });
  // Le UV delle falde sono già in unità di 2,7 m: repeat 2 → un tile ogni ~1,35 m
  const tiles = pbr(renderer, 'rooftiles', { repeat: 2, normal: true, rough: true });
  const wallMat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    map: facade,
    ...plaster,
    normalScale: new THREE.Vector2(0.5, 0.5),
    roughness: 1,
    metalness: 0,
    envMapIntensity: 0.45,
  });
  const roofMat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    ...tiles,
    normalScale: new THREE.Vector2(1.1, 1.1),
    roughness: 1,
    metalness: 0,
    envMapIntensity: 0.6,
  });

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

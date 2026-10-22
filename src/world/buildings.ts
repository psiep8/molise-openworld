import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Heightfield } from '../geo/elevation';
import { hashInt, type Pt } from '../geo/geo';
import type { Building, OsmData } from '../geo/osm';
import { clamp } from '../geo/geo';
import { pbr } from '../gfx/textures';
import { facadeNormalTexture, facadeTexture } from './surface-textures';
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

/** Box colorato e non indicizzato, così si fonde con le altre decorazioni. */
function solidBox(
  w: number,
  h: number,
  d: number,
  x: number,
  y: number,
  z: number,
  color: THREE.Color,
  rotY = 0,
): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d).toNonIndexed();
  if (rotY) g.rotateY(rotY);
  g.translate(x, y, z);
  applyColor(g, color);
  return g;
}

/**
 * Fascia orizzontale (cornicione) lungo il perimetro dell'impronta: facce
 * esterne più il filo superiore, che è quello che disegna l'ombra sulla facciata.
 * Costruita a mano perché ExtrudeGeometry non è indicizzata e non si fonderebbe
 * con i box delle decorazioni.
 */
function bandGeometry(
  points: Pt[],
  center: Pt,
  scale: number,
  y0: number,
  y1: number,
  color: THREE.Color,
): THREE.BufferGeometry {
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const ring = points.map((p) => ({
    x: center.x + (p.x - center.x) * scale,
    z: center.z + (p.z - center.z) * scale,
  }));
  const inner = points.map((p) => ({
    x: center.x + (p.x - center.x) * (scale - 0.035),
    z: center.z + (p.z - center.z) * (scale - 0.035),
  }));

  const tri = (
    ax: number,
    ay: number,
    az: number,
    bx: number,
    by: number,
    bz: number,
    cx: number,
    cy: number,
    cz: number,
    nx: number,
    ny: number,
    nz: number,
    u0: number,
    u1: number,
    u2: number,
  ): void => {
    positions.push(ax, ay, az, bx, by, bz, cx, cy, cz);
    normals.push(nx, ny, nz, nx, ny, nz, nx, ny, nz);
    uvs.push(u0, 0, u1, 1, u2, 0.5);
  };

  let travelled = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    const ia = inner[i];
    const ib = inner[(i + 1) % ring.length];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const len = Math.hypot(dx, dz);
    if (len < 1e-3) continue;
    // normale esterna dell'edge, con il verso corretto rispetto al centro
    let nx = dz / len;
    let nz = -dx / len;
    const mx = (a.x + b.x) / 2 - center.x;
    const mz = (a.z + b.z) / 2 - center.z;
    if (nx * mx + nz * mz < 0) {
      nx = -nx;
      nz = -nz;
    }
    const u0 = travelled / 4;
    const u1 = (travelled + len) / 4;
    // parete esterna
    tri(a.x, y0, a.z, b.x, y0, b.z, b.x, y1, b.z, nx, 0, nz, u0, u1, u1);
    tri(a.x, y0, a.z, b.x, y1, b.z, a.x, y1, a.z, nx, 0, nz, u0, u1, u0);
    // filo superiore, verso l'interno
    tri(a.x, y1, a.z, b.x, y1, b.z, ib.x, y1, ib.z, 0, 1, 0, u0, u1, u1);
    tri(a.x, y1, a.z, ib.x, y1, ib.z, ia.x, y1, ia.z, 0, 1, 0, u0, u1, u0);
    travelled += len;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  applyColor(geometry, color);
  return geometry;
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

interface BuildingParts {
  wall: THREE.BufferGeometry;
  roof: THREE.BufferGeometry;
  base: THREE.BufferGeometry;
  trim: THREE.BufferGeometry[];
}

function buildOne(b: Building, heights: Heightfield, seed: number): BuildingParts {
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
  let ridgeY = roofTop;
  if (plan) {
    roof = buildHipGeometry(plan);
    ridgeY = plan.ridgeY;
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

  // zoccolo in pietra: fascia di ~0,5 m sopra il terreno, leggermente a sporto.
  // Senza, le case sembrano scatole appoggiate sull'erba.
  const plinth = b.points.map((p) => ({
    x: c.x + (p.x - c.x) * 1.02,
    z: c.z + (p.z - c.z) * 1.02,
  }));
  const plinthShape = new THREE.Shape(plinth.map((p) => new THREE.Vector2(p.x, -p.z)));
  const plinthGeo = new THREE.ExtrudeGeometry(plinthShape, { depth: 1.15, bevelEnabled: false, steps: 1 });
  plinthGeo.rotateX(-Math.PI / 2);
  plinthGeo.translate(0, base, 0);
  applyColor(plinthGeo, new THREE.Color(0x8f8579).multiplyScalar(0.9 + (hashInt(seed, 13) % 60) / 400));

  // ---------------------------------------------------------------------------
  // decorazioni: cornicione, comignolo, pluviali, balcone
  // ---------------------------------------------------------------------------
  const trim: THREE.BufferGeometry[] = [];
  const stone = new THREE.Color(0xe9e1cf).multiplyScalar(0.94 + (hashInt(seed, 7) % 60) / 500);
  const eaveY = base + b.height + 0.02;

  // cornicione sotto la gronda: 24 cm di aggetto, quello che disegna l'ombra
  trim.push(bandGeometry(b.points, c, 1.035, eaveY - 0.3, eaveY - 0.04, stone));

  const chimneyColor = wallColor.clone().multiplyScalar(0.98);
  if (hashInt(seed, 17) % 10 < 7) {
    // camino largo e basso: i primi erano troppo stretti e sembravano antenne
    const width = 0.8 + (hashInt(seed, 19) % 40) / 130;
    const dx = ((hashInt(seed, 23) % 60) - 30) / 100;
    const dz = ((hashInt(seed, 29) % 60) - 30) / 100;
    const top = ridgeY + 0.55;
    const bottom = ridgeY - 1.6;
    trim.push(solidBox(width, top - bottom, width, c.x + dx, (top + bottom) / 2, c.z + dz, chimneyColor));
    // cappello del comignolo
    trim.push(solidBox(width * 1.35, 0.1, width * 1.35, c.x + dx, top + 0.05, c.z + dz, new THREE.Color(0x9c9285)));
  }

  if (hashInt(seed, 31) % 10 < 6) {
    // due pluviali ai vertici più esterni in x: bastano a rompere il muro liscio
    let left = b.points[0];
    let right = b.points[0];
    for (const p of b.points) {
      if (p.x < left.x) left = p;
      if (p.x > right.x) right = p;
    }
    const pipeTop = eaveY - 0.35;
    const pipeBottom = base + 0.35;
    const zinc = new THREE.Color(0x8e908d);
    for (const p of [left, right]) {
      trim.push(solidBox(0.1, pipeTop - pipeBottom, 0.1, p.x, (pipeTop + pipeBottom) / 2, p.z, zinc));
    }
  }

  // balconi solo sulle case a due piani con facciata abbastanza lunga
  if (b.area > 85 && b.height >= 6.2 && hashInt(seed, 37) % 3 < 2) {
    let best: { a: Pt; b: Pt; len: number } | null = null;
    for (let i = 0; i < b.points.length; i++) {
      const a = b.points[i];
      const p = b.points[(i + 1) % b.points.length];
      const len = Math.hypot(p.x - a.x, p.z - a.z);
      if (!best || len > best.len) best = { a, b: p, len };
    }
    if (best && best.len > 4) {
      const ex = (best.b.x - best.a.x) / best.len;
      const ez = (best.b.z - best.a.z) / best.len;
      let nx = ez;
      let nz = -ex;
      const mx = (best.a.x + best.b.x) / 2;
      const mz = (best.a.z + best.b.z) / 2;
      if (nx * (mx - c.x) + nz * (mz - c.z) < 0) {
        nx = -nx;
        nz = -nz;
      }
      const angle = Math.atan2(-ez, ex);
      const slabW = best.len * 0.55;
      const depth = 0.95;
      const y = base + b.height * 0.46;
      const px = mx + nx * (depth / 2 + 0.05);
      const pz = mz + nz * (depth / 2 + 0.05);
      trim.push(solidBox(slabW, 0.14, depth, px, y, pz, stone, angle));
      const iron = new THREE.Color(0x35393b);
      // corrimano e barre verticali
      const railY = y + 1.0;
      const railX = mx + nx * (depth + 0.02);
      const railZ = mz + nz * (depth + 0.02);
      trim.push(solidBox(slabW, 0.06, 0.06, railX, railY, railZ, iron, angle));
      for (let k = 0; k <= 6; k++) {
        const t = k / 6 - 0.5;
        const bx = mx + ex * slabW * t + nx * (depth + 0.02);
        const bz = mz + ez * slabW * t + nz * (depth + 0.02);
        trim.push(solidBox(0.035, 1.0, 0.035, bx, y + 0.5, bz, iron, angle));
      }
    }
  }

  return { wall, roof, base: plinthGeo, trim };
}

/**
 * Edifici estrusi dalle impronte OSM (altezza da tag o stimata).
 * Muri e tetti in due mesh, decorazioni in una terza, tutte con materiali
 * condivisi: poche draw call anche con migliaia di case.
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
  const bases: THREE.BufferGeometry[] = [];
  const trims: THREE.BufferGeometry[] = [];

  osm.buildings.forEach((b, i) => {
    if (b.points.length < 3 || b.area < 6) return;
    try {
      const out = buildOne(b, heights, i * 31 + Math.round(b.height * 10));
      walls.push(out.wall);
      roofs.push(out.roof);
      bases.push(out.base);
      for (const t of out.trim) trims.push(t);
    } catch {
      // geometria degenere: la saltiamo
    }
  });

  const facade = facadeTexture();
  facade.repeat.set(0.3, 0.3);
  // alza la prima fila di finestre di ~0,9 m dal suolo
  facade.offset.set(0, -0.28);
  // Normal delle finestre: stesso disegno e stesso transform della mappa colore,
  // così il vano risulta incassato e il davanzale a sporto.
  const facadeNormals = facadeNormalTexture();
  facadeNormals.repeat.copy(facade.repeat);
  facadeNormals.offset.copy(facade.offset);
  // Grana dell'intonaco per rough/normal a distanza ravvicinata
  const plaster = pbr(renderer, 'plaster', { color: false, repeat: 0.5 });
  // Le UV delle falde sono già in unità di 2,7 m: repeat 2 → un tile ogni ~1,35 m
  const tiles = pbr(renderer, 'rooftiles', { repeat: 2, normal: true, rough: true });
  const wallMat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    map: facade,
    normalMap: facadeNormals,
    normalScale: new THREE.Vector2(1.1, 1.1),
    roughnessMap: plaster.roughnessMap,
    roughness: 1,
    metalness: 0,
    envMapIntensity: 0.4,
  });
  const roofMat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    ...tiles,
    normalScale: new THREE.Vector2(1.1, 1.1),
    roughness: 1,
    metalness: 0,
    envMapIntensity: 0.6,
  });
  const trimMat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    normalMap: plaster.normalMap,
    roughnessMap: plaster.roughnessMap,
    normalScale: new THREE.Vector2(0.6, 0.6),
    roughness: 0.92,
    metalness: 0,
    envMapIntensity: 0.35,
    // le fasce sono costruite a mano: il culling non deve mangiarsele
    side: THREE.DoubleSide,
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
  if (bases.length) {
    const merged = mergeGeometries(bases, false);
    if (merged) {
      const mesh = new THREE.Mesh(
        merged,
        new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.96, metalness: 0, envMapIntensity: 0.3 }),
      );
      mesh.name = 'plinths';
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);
    }
  }
  if (trims.length) {
    const merged = mergeGeometries(trims, false);
    if (merged) {
      const mesh = new THREE.Mesh(merged, trimMat);
      mesh.name = 'building-trim';
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);
    }
  }

  for (const g of walls) g.dispose();
  for (const g of roofs) g.dispose();
  for (const g of bases) g.dispose();
  for (const g of trims) g.dispose();

  return { group, count: walls.length };
}

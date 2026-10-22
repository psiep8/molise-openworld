import * as THREE from 'three';
import { COLORS } from '../config';
import { pbr, waterNormals } from '../gfx/textures';
import { registerScroll } from '../gfx/wind';
import type { Heightfield } from '../geo/elevation';
import { clamp, hashInt, type Pt } from '../geo/geo';
import type { OsmData, RoadIndex } from '../geo/osm';

interface RibbonArrays {
  positions: number[];
  normals: number[];
  colors: number[];
  uvs: number[];
  indices: number[];
}

const emptyRibbon = (): RibbonArrays => ({ positions: [], normals: [], colors: [], uvs: [], indices: [] });

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

/**
 * Smussa gli angoli secchi di una polilinea (versione mirata di Chaikin):
 * solo dove la curva gira più di `thresholdDeg`, il vertice diventa due punti
 * a 35% della lunghezza dei lati. Le strade OSM hanno spesso svolte a 90°
 * disegnate con un vertice solo, che nei nastri diventa una cuspide.
 */
export function roundCorners(points: Pt[], thresholdDeg = 22): Pt[] {
  if (points.length < 3) return points.slice();
  const out: Pt[] = [points[0]];
  for (let i = 1; i < points.length - 1; i++) {
    const a = points[i - 1];
    const b = points[i];
    const c = points[i + 1];
    const ux = b.x - a.x;
    const uz = b.z - a.z;
    const vx = c.x - b.x;
    const vz = c.z - b.z;
    const lu = Math.hypot(ux, uz);
    const lv = Math.hypot(vx, vz);
    if (lu < 1e-3 || lv < 1e-3) {
      out.push(b);
      continue;
    }
    const cosine = clamp((ux * vx + uz * vz) / (lu * lv), -1, 1);
    const turn = (Math.acos(cosine) * 180) / Math.PI;
    if (turn < thresholdDeg) {
      out.push(b);
      continue;
    }
    const cut = Math.min(lu, lv) * 0.35;
    out.push({ x: b.x - (ux / lu) * cut, z: b.z - (uz / lu) * cut });
    out.push({ x: b.x + (vx / lv) * cut, z: b.z + (vz / lv) * cut });
  }
  out.push(points[points.length - 1]);
  return out;
}

/**
 * Spinge una polilinea a pezzi, saltando i tratti in cui `blocked` è vero.
 * Serve ai marciapiedi: davanti agli incroci si interrompono invece di
 * attraversare l'altra strada con una striscia di cemento.
 */
function pushRuns(
  target: RibbonArrays,
  line: Pt[],
  width: number,
  lift: number,
  color: THREE.Color,
  heights: Heightfield,
  blocked: (x: number, z: number) => boolean,
): void {
  let run: Pt[] = [];
  const flush = (): void => {
    if (run.length >= 2) pushRibbon(target, run, width, lift, color, heights, 1);
    run = [];
  };
  for (const p of line) {
    if (blocked(p.x, p.z)) flush();
    else run.push(p);
  }
  flush();
}

/**
 * Tratteggio al centro della carreggiata: di ogni tratto disegna solo il 45%
 * centrale, così la linea si interrompe come sull'asfalto vero.
 */
function pushDashes(
  target: RibbonArrays,
  pts: Pt[],
  width: number,
  lift: number,
  color: THREE.Color,
  heights: Heightfield,
): void {
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const dash: Pt[] = [
      { x: a.x + (b.x - a.x) * 0.28, z: a.z + (b.z - a.z) * 0.28 },
      { x: a.x + (b.x - a.x) * 0.72, z: a.z + (b.z - a.z) * 0.72 },
    ];
    pushRibbon(target, dash, width, lift, color, heights, 1);
  }
}

/** Sposta una polilinea di `offset` metri lungo la perpendicolare (negativo = sinistra). */
function offsetPolyline(points: Pt[], offset: number): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i < points.length; i++) {
    const prev = points[Math.max(0, i - 1)];
    const next = points[Math.min(points.length - 1, i + 1)];
    let tx = next.x - prev.x;
    let tz = next.z - prev.z;
    const len = Math.hypot(tx, tz) || 1;
    tx /= len;
    tz /= len;
    out.push({ x: points[i].x - tz * offset, z: points[i].z + tx * offset });
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
  let travelled = 0;
  for (let i = 0; i < pts.length; i++) {
    if (i > 0) travelled += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z);
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
      // u attraversa la carreggiata, v scorre lungo la strada (~6 m per tile)
      target.uvs.push(side < 0 ? 0 : 1, travelled / 6);
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
  g.setAttribute('uv', new THREE.Float32BufferAttribute(a.uvs, 2));
  g.setIndex(a.positions.length / 3 > 65000 ? new THREE.Uint32BufferAttribute(a.indices, 1) : new THREE.Uint16BufferAttribute(a.indices, 1));
  g.computeBoundingSphere();
  return g;
}

/**
 * Strade come nastri drappeggiati sul DEM. Due mesh (asfalto/sterrato) per
 * limitare le draw call, con leggera variazione di tono per non sembrare finto.
 *
 * Le mappe colore sono texture PBR CC0: il vertex color resta un tint quasi
 * bianco (variazione per strada), perché il colore dell'asfalto arriva dalla
 * texture e non va moltiplicato una seconda volta.
 */
export function buildRoads(
  osm: OsmData,
  heights: Heightfield,
  renderer: THREE.WebGLRenderer,
  roadIndex?: RoadIndex,
): THREE.Group {
  const group = new THREE.Group();
  group.name = 'roads';
  const asphalt = emptyRibbon();
  const dirt = emptyRibbon();
  const pavement = emptyRibbon();
  const markings = emptyRibbon();
  const asphaltColor = new THREE.Color(0xffffff);
  const dirtColor = new THREE.Color(0xf6efe6);
  const pavementColor = new THREE.Color(0x8b9294);
  const markingColor = new THREE.Color(0xf4f2e8);

  osm.roads.forEach((road, idx) => {
    // angoli smussati prima di drappeggiare: le cuspidi nei nastri si vedono
    const pts = roundCorners(resample(road.points, road.paved ? 7 : 6), road.paved ? 24 : 30);
    const isDirt = !road.paved;
    const target = isDirt ? dirt : asphalt;
    const base = isDirt ? dirtColor : asphaltColor;
    const color = base.clone().multiplyScalar(0.9 + (hashInt(idx, 7) % 100) / 500);
    // micro offset per evitare z-fighting negli incroci
    const lift = (isDirt ? 0.12 : 0.2) + (idx % 7) * 0.004;
    pushRibbon(target, pts, road.width, lift, color, heights, 1);
    // tratteggio di mezzeria sulle carreggiate larghe
    if (!isDirt && road.width >= 5.4) {
      pushDashes(markings, pts, 0.14, lift + 0.012, markingColor, heights);
    }

    // Solo le strade asfaltate hanno marciapiede e cordolo: le sterrate no.
    if (isDirt) return;
    const walkWidth = road.width >= 6 ? 1.5 : 1.2;
    const walkLift = lift + 0.035;
    const curbLift = lift + 0.06;
    for (const side of [-1, 1]) {
      // marciapiede accostato al bordo carreggiata, interrotto agli incroci
      const walkLine = offsetPolyline(pts, side * (road.width / 2 + walkWidth / 2));
      pushRuns(pavement, walkLine, walkWidth, walkLift, pavementColor, heights, (x, z) =>
        roadIndex ? roadIndex.isOnRoad(x, z, 0.4) : false,
      );
      // cordolo: filo di cemento appena fuori dall'asfalto
      const curbLine = offsetPolyline(pts, side * (road.width / 2 + 0.45));
      pushRuns(pavement, curbLine, 0.25, curbLift, pavementColor, heights, (x, z) =>
        roadIndex ? roadIndex.isOnRoad(x, z, 0.3) : false,
      );
    }
  });

  // un tile ogni ~3 m: le UV dei nastri scorrono già in metri (6 m per tile)
  const asphaltPbr = pbr(renderer, 'asphalt', { repeat: 2, normal: true, rough: true });
  const dirtPbr = pbr(renderer, 'gravel', { repeat: 2, normal: true, rough: true });
  const asphaltMat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    ...asphaltPbr,
    normalScale: new THREE.Vector2(0.9, 0.9),
    roughness: 1,
    metalness: 0,
    envMapIntensity: 0.55,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  const dirtMat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    ...dirtPbr,
    normalScale: new THREE.Vector2(1, 1),
    roughness: 1,
    metalness: 0,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  // marciapiedi e cordoli in cemento: tinta quasi bianca, colore dalla texture
  const concretePbr = pbr(renderer, 'concrete', { repeat: 2, normal: true, rough: true });
  const pavementMat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    ...concretePbr,
    normalScale: new THREE.Vector2(0.7, 0.7),
    roughness: 1,
    metalness: 0,
    envMapIntensity: 0.45,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -3,
    polygonOffsetUnits: -3,
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
  if (pavement.indices.length) {
    const mesh = new THREE.Mesh(toGeometry(pavement), pavementMat);
    mesh.name = 'sidewalks';
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  if (markings.indices.length) {
    const markingMat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.9,
      metalness: 0,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4,
    });
    const mesh = new THREE.Mesh(toGeometry(markings), markingMat);
    mesh.name = 'road-markings';
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  return group;
}

/**
 * Fiumi/torrenti come nastri; laghi e invasi come poligoni piatti.
 *
 * L'acqua usa normali fotografiche che scorrono: i nastri hanno UV metriche
 * (2,5 m per tile trasversale, ~3 m lungo il corso) e scorrono veloci, i laghi
 * usano un tiling di 6 m e un movimento lento, così la superficie non sembra
 * una lastra di vetro.
 */
export function buildWater(osm: OsmData, heights: Heightfield, renderer: THREE.WebGLRenderer): THREE.Group {
  const group = new THREE.Group();
  group.name = 'water';
  const ribbons = emptyRibbon();
  const waterColor = new THREE.Color(0xffffff);

  for (const w of osm.waterways) {
    const width = w.type === 'river' ? 5 : w.type === 'canal' ? 3.2 : 2.2;
    pushRibbon(ribbons, roundCorners(resample(w.points, 8), 30), width, 0.08, waterColor, heights, 1);
  }

  const streamNormals = waterNormals(renderer, 2, 2);
  registerScroll(streamNormals, 0.02, 0.11);
  const ribbonMat = new THREE.MeshPhysicalMaterial({
    vertexColors: true,
    normalMap: streamNormals,
    normalScale: new THREE.Vector2(0.55, 0.55),
    roughness: 0.12,
    metalness: 0.05,
    clearcoat: 1,
    clearcoatRoughness: 0.08,
    ior: 1.33,
    transparent: true,
    opacity: 0.78,
    envMapIntensity: 1.1,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -4,
    polygonOffsetUnits: -4,
  });
  if (ribbons.indices.length) {
    const mesh = new THREE.Mesh(toGeometry(ribbons), ribbonMat);
    mesh.name = 'streams';
    mesh.receiveShadow = true;
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
    // UV metriche: un tile di normali ogni 6 m, indipendenti dalla forma del lago
    const position = merged.attributes.position as THREE.BufferAttribute;
    const uvs = new Float32Array(position.count * 2);
    for (let i = 0; i < position.count; i++) {
      uvs[i * 2] = position.getX(i) / 6;
      uvs[i * 2 + 1] = position.getZ(i) / 6;
    }
    merged.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    const lakeNormals = waterNormals(renderer, 1, 1);
    registerScroll(lakeNormals, 0.006, 0.013);
    const mesh = new THREE.Mesh(
      merged,
      new THREE.MeshPhysicalMaterial({
        color: COLORS.water,
        normalMap: lakeNormals,
        normalScale: new THREE.Vector2(0.4, 0.4),
        roughness: 0.08,
        metalness: 0.08,
        clearcoat: 1,
        clearcoatRoughness: 0.05,
        ior: 1.33,
        transparent: true,
        opacity: 0.82,
        envMapIntensity: 1.2,
        polygonOffset: true,
        polygonOffsetFactor: -4,
        polygonOffsetUnits: -4,
      }),
    );
    mesh.name = 'water-areas';
    mesh.receiveShadow = true;
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

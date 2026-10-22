import * as THREE from 'three';
import { COLORS } from '../config';
import { pbr, waterNormals } from '../gfx/textures';
import { registerScroll } from '../gfx/wind';
import type { Heightfield } from '../geo/elevation';
import { clamp, hashInt, type Pt } from '../geo/geo';
import type { BuildingIndex, OsmData, RoadIndex } from '../geo/osm';

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
 * Smussamento vero delle curve (media pesata di Laplace, estremi fissi).
 *
 * `roundCorners` spezza solo i vertici secchi lasciando segmenti dritti tra
 * loro: sulle strade OSM, ricampionate a 7 m, restano comunque zig-zag e
 * controradius che a occhio si vedono come una spezzata. Due passate spostano
 * ogni punto verso la media dei vicini: la polilinea diventa un arco continuo
 * con raggio di curvatura confrontabile con quello vero (10-40 m).
 *
 * Gli estremi restano fermi per non staccare le strade dagli incroci.
 */
export function smoothPolyline(points: Pt[], passes = 2, strength = 0.55): Pt[] {
  if (points.length < 3) return points.slice();
  let current = points.slice();
  for (let pass = 0; pass < passes; pass++) {
    const next = current.slice();
    for (let i = 1; i < current.length - 1; i++) {
      const a = current[i - 1];
      const b = current[i];
      const c = current[i + 1];
      next[i] = {
        x: b.x + ((a.x + c.x) / 2 - b.x) * strength,
        z: b.z + ((a.z + c.z) / 2 - b.z) * strength,
      };
    }
    current = next;
  }
  return current;
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

/**
 * Faccia verticale del cordolo: quad dritti lungo il bordo del manto stradale.
 * È questo pezzo che fa leggere il marciapiede come rialzato — senza, la
 * pavimentazione resta un nastro piatto incollato all'asfalto.
 * `outward` vale +1 quando il lato esterno è quello a offset positivo.
 */
function pushCurbWall(
  target: RibbonArrays,
  pts: Pt[],
  yBottom: number,
  yTop: number,
  outward: number,
  color: THREE.Color,
  heights: Heightfield,
  blocked: (x: number, z: number) => boolean,
): void {
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const mx = (a.x + b.x) / 2;
    const mz = (a.z + b.z) / 2;
    if (blocked(a.x, a.z) && blocked(b.x, b.z)) continue;
    if (blocked(mx, mz)) continue;
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const len = Math.hypot(dx, dz);
    if (len < 1e-3) continue;
    // la faccia guarda verso la carreggiata, cioè contro il lato del marciapiede
    const nx = (dz / len) * outward;
    const nz = (-dx / len) * outward;
    const ha = heights.heightAt(a.x, a.z);
    const hb = heights.heightAt(b.x, b.z);
    const base = target.positions.length / 3;
    const quad: [Pt, number][] = [
      [a, ha],
      [a, ha],
      [b, hb],
      [b, hb],
    ];
    const tops = [yBottom, yTop, yBottom, yTop];
    for (let k = 0; k < 4; k++) {
      const [p, h] = quad[k];
      target.positions.push(p.x, h + tops[k], p.z);
      target.normals.push(nx, 0, nz);
      target.colors.push(color.r, color.g, color.b);
      target.uvs.push(k % 2 === 0 ? 0 : 1, tops[k]);
    }
    // verso delle facce coerente con la normale (altrimenti spariscono col culling)
    if (outward > 0) target.indices.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
    else target.indices.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
  }
}

/**
 * Attraversamento pedonale: barre bianche trasversali alla carreggiata.
 * `at` è il punto centrale, `tx/tz` il versante della strada.
 */
function pushZebra(
  target: RibbonArrays,
  at: Pt,
  tx: number,
  tz: number,
  width: number,
  lift: number,
  color: THREE.Color,
  heights: Heightfield,
): void {
  const px = -tz;
  const pz = tx;
  const bars = 7;
  const barW = 0.42;
  const gap = 0.46;
  const span = bars * barW + (bars - 1) * gap;
  const halfRoad = (width * 0.86) / 2;
  for (let i = 0; i < bars; i++) {
    const along = -span / 2 + i * (barW + gap) + barW / 2;
    const cx = at.x + tx * along;
    const cz = at.z + tz * along;
    const line: Pt[] = [
      { x: cx - px * halfRoad, z: cz - pz * halfRoad },
      { x: cx + px * halfRoad, z: cz + pz * halfRoad },
    ];
    pushRibbon(target, line, 0.42, lift, color, heights, 1);
  }
}

/**
 * Linea di arresto prima dell'attraversamento: una banda piena sulla sola
 * corsia di marcia (metà carreggiata, lato destro rispetto al verso).
 */
function pushStopLine(
  target: RibbonArrays,
  at: Pt,
  tx: number,
  tz: number,
  width: number,
  lift: number,
  color: THREE.Color,
  heights: Heightfield,
): void {
  const px = -tz;
  const pz = tx;
  const back = 1.35;
  const line: Pt[] = [
    { x: at.x - tx * back - px * (width * 0.04), z: at.z - tz * back - pz * (width * 0.04) },
    { x: at.x - tx * back - px * (width * 0.46), z: at.z - tz * back - pz * (width * 0.46) },
  ];
  pushRibbon(target, line, 0.4, lift, color, heights, 1);
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
 * Usura dell'asfalto, tutta nello shader del materiale.
 *
 * Le UV dei nastri sono metriche e comode: `u` attraversa la carreggiata
 * (0 = bordo sinistro, 1 = bordo destro), `v` scorre lungo la strada. Le auto
 * vere consumano due bande strette dove passano le ruote: lì l'asfalto è più
 * scuro e più liscio (più riflesso), mentre il centro corsia resta più chiaro
 * per la polvere. Sopra ci va un rumore a bassa frequenza in coordinate mondo,
 * così la ripetizione della texture non si legge e ogni tratto ha le sue
 * macchie. `uRoadWet` (0..1) scurisce e lucida tutto quando piove.
 */
function applyRoadWear(material: THREE.MeshStandardMaterial): void {
  const wet = { value: 0 };
  (material.userData as { roadWet?: { value: number } }).roadWet = wet;

  material.onBeforeCompile = (shader) => {
    shader.uniforms.uRoadWet = wet;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
varying vec2 vRoadUv;
varying vec3 vRoadWorld;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
vRoadUv = uv;
vRoadWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;`,
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
varying vec2 vRoadUv;
varying vec3 vRoadWorld;
uniform float uRoadWet;

// profilo delle due tracce di ruote: gaussiane strette a u = 0.30 e 0.70
float wheelTracks(float u) {
  float a = (u - 0.30) / 0.085;
  float b = (u - 0.70) / 0.085;
  return clamp(exp(-a * a) + exp(-b * b), 0.0, 1.0);
}

// hash e rumore di valore, per rattoppi e crepe in coordinate mondo
float roadHash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float roadNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = roadHash(i);
  float b = roadHash(i + vec2(1.0, 0.0));
  float c = roadHash(i + vec2(0.0, 1.0));
  float d = roadHash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

// calcolate in <map_fragment> e riusate in <roughnessmap_fragment>
float roadToppa;
float roadCrack;`,
      )
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
{
  float tread = wheelTracks(vRoadUv.x);
  float centre = exp(-pow((vRoadUv.x - 0.5) / 0.14, 2.0));
  // macchie ogni 20-35 m: coordinate mondo, così non seguono la strada
  vec2 cell = floor(vRoadWorld.xz * 0.03);
  float blotch = fract(sin(dot(cell, vec2(12.9898, 78.233))) * 43758.5453);
  diffuseColor.rgb *= mix(1.0, 0.78, tread);
  diffuseColor.rgb *= mix(1.0, 1.05, centre);
  diffuseColor.rgb *= 0.92 + 0.16 * blotch;

  // rattoppi: in poche celle di 7 x 9 m c'e' una toppa rettangolare di
  // catrame, col bordo dritto come quando la ruspa taglia l'asfalto
  vec2 pgrid = vRoadWorld.xz / vec2(7.0, 9.0);
  vec2 pid = floor(pgrid);
  vec2 pf = fract(pgrid);
  float ph = roadHash(pid);
  vec2 plo = vec2(roadHash(pid + 1.7), roadHash(pid + 3.9)) * 0.55 + 0.12;
  vec2 phi = plo + vec2(0.18 + roadHash(pid + 5.3) * 0.28, 0.16 + roadHash(pid + 7.1) * 0.26);
  float pbox = step(plo.x, pf.x) * step(pf.x, phi.x) * step(plo.y, pf.y) * step(pf.y, phi.y);
  roadToppa = step(ph, 0.16) * pbox;
  diffuseColor.rgb *= mix(1.0, 0.74, roadToppa);

  // crepe: dove il rumore attraversa lo 0,5 resta una linea sottile
  float cr = abs(roadNoise(vRoadWorld.xz * 0.42) - 0.5);
  roadCrack = (1.0 - smoothstep(0.0, 0.035, cr)) * 0.55;
  diffuseColor.rgb *= 1.0 - roadCrack * 0.38;
  // bagnato: asfalto scuro, come dopo un temporale
  diffuseColor.rgb *= mix(1.0, 0.60, uRoadWet);
}`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
{
  // le tracce sono lucide (gomma consumata), il bagnato lucida tutto
  roughnessFactor = clamp(roughnessFactor - 0.24 * wheelTracks(vRoadUv.x), 0.18, 1.0);
  // il catrame della toppa e' piu' liscio, la crepe piu' ruvida
  roughnessFactor = mix(roughnessFactor, 0.55, roadToppa * 0.45);
  roughnessFactor = mix(roughnessFactor, 0.98, roadCrack * 0.5);
  roughnessFactor = mix(roughnessFactor, 0.12, uRoadWet);
}`,
      );
  };
  material.customProgramCacheKey = () => 'road-wear-v3';
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
  buildings?: BuildingIndex,
): { group: THREE.Group; lamps: { x: number; z: number; yaw: number }[] } {
  const group = new THREE.Group();
  group.name = 'roads';
  const asphalt = emptyRibbon();
  const dirt = emptyRibbon();
  const pavement = emptyRibbon();
  const markings = emptyRibbon();
  const asphaltColor = new THREE.Color(0xffffff);
  const dirtColor = new THREE.Color(0xf6efe6);
  const pavementColor = new THREE.Color(0x8b9294);
  const curbColor = new THREE.Color(0xb9bcbb);
  const markingColor = new THREE.Color(0xf4f2e8);
  /** punti in cui piantare un lampione: bordo strada dentro/attorno al paese */
  const lamps: { x: number; z: number; yaw: number }[] = [];

  osm.roads.forEach((road, idx) => {
    // angoli smussati, poi due passate di media pesata: senza lo smussamento
    // vero l'asfalto resta una spezzata con cuspidi a ogni vertice OSM
    const pts = smoothPolyline(
      roundCorners(resample(road.points, road.paved ? 7 : 6), road.paved ? 24 : 30),
      2,
      0.55,
    );
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
    const walkWidth = road.width >= 6 ? 1.8 : 1.45;
    // cordolo a 18 cm (altezza da marciapiede italiano): è lo scalino che si
    // sente sotto il piede e che stacca la pavimentazione dall'asfalto
    const curbTop = lift + 0.18;
    const walkLift = curbTop + 0.005;
    const blockedWalk = (x: number, z: number): boolean => (roadIndex ? roadIndex.isOnRoad(x, z, 0.4) : false);
    for (const side of [-1, 1]) {
      // marciapiede accostato al bordo carreggiata, interrotto agli incroci
      const walkLine = offsetPolyline(pts, side * (road.width / 2 + walkWidth / 2));
      pushRuns(pavement, walkLine, walkWidth, walkLift, pavementColor, heights, blockedWalk);
      // cordolo: fascia chiara in cima al rialzo, poi la faccia verticale
      const curbLine = offsetPolyline(pts, side * (road.width / 2 + 0.14));
      pushRuns(pavement, curbLine, 0.28, curbTop, curbColor, heights, blockedWalk);
      pushCurbWall(
        pavement,
        offsetPolyline(pts, side * (road.width / 2 + 0.005)),
        lift - 0.02,
        0.18,
        side,
        curbColor,
        heights,
        blockedWalk,
      );
    }

    // attraversamenti pedonali e lampioni solo dove ci sono case a ridosso
    if (!buildings) return;
    let sinceCross = 0;
    let sinceLamp = 0;
    for (let i = 1; i < pts.length - 1; i++) {
      const a = pts[i - 1];
      const b = pts[i];
      const seg = Math.hypot(b.x - a.x, b.z - a.z);
      sinceCross += seg;
      sinceLamp += seg;
      const near = buildings.near(b.x, b.z);
      let built = false;
      for (const bd of near) {
        if (
          b.x > bd.bounds.minX - 26 &&
          b.x < bd.bounds.maxX + 26 &&
          b.z > bd.bounds.minZ - 26 &&
          b.z < bd.bounds.maxZ + 26
        ) {
          built = true;
          break;
        }
      }
      if (!built) continue;
      let tx = b.x - a.x;
      let tz = b.z - a.z;
      const tl = Math.hypot(tx, tz) || 1;
      tx /= tl;
      tz /= tl;

      // un attraversamento ogni ~70 m, ma solo su tratti abbastanza dritti
      if (sinceCross > 70 && i + 1 < pts.length) {
        const c = pts[i + 1];
        let ux = c.x - b.x;
        let uz = c.z - b.z;
        const ul = Math.hypot(ux, uz) || 1;
        ux /= ul;
        uz /= ul;
        if (tx * ux + tz * uz > 0.93) {
          pushZebra(markings, b, tx, tz, road.width, lift + 0.011, markingColor, heights);
          pushStopLine(markings, b, tx, tz, road.width, lift + 0.011, markingColor, heights);
          sinceCross = 0;
        }
      }
      // lampioni ogni ~32 m: due file ai lati, quello che rende un paese un paese
      if (sinceLamp > 32) {
        const side = lamps.length % 2 === 0 ? 1 : -1;
        const off = road.width / 2 + walkWidth + 0.35;
        lamps.push({
          x: b.x - tz * side * off,
          z: b.z + tx * side * off,
          // il braccio del lampione punta verso la carreggiata
          yaw: Math.atan2(tz * side, -tx * side),
        });
        sinceLamp = 0;
      }
    }
  });

  // un tile ogni ~3 m: le UV dei nastri scorrono già in metri (6 m per tile)
  const asphaltPbr = pbr(renderer, 'asphalt', { repeat: 2, normal: true, rough: true });
  const dirtPbr = pbr(renderer, 'gravel', { repeat: 2, normal: true, rough: true });
  const asphaltMat = new THREE.MeshStandardMaterial({
    // la texture CC0 è chiara (serve a mostrare la grana): la tinta scura la dà
    // il materiale, altrimenti l'asfalto sembra cemento chiaro
    color: 0x8b8f92,
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
  applyRoadWear(asphaltMat);
  const dirtMat = new THREE.MeshStandardMaterial({
    color: 0xb9a68a,
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
  return { group, lamps };
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

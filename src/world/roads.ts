import * as THREE from 'three';
import { COLORS } from '../config';
import { pbr, waterNormals } from '../gfx/textures';
import { registerScroll } from '../gfx/wind';
import type { Heightfield } from '../geo/elevation';
import { boundsOf, clamp, hashInt, mulberry32, wrapAngle, type Pt } from '../geo/geo';
import { CURB_HEIGHT, roadLift, type BuildingIndex, type OsmData, type Road, type RoadIndex } from '../geo/osm';
import type { CityKit } from './citykit';
import {
  createRoadProfile,
  ROAD_PROFILE,
  ruralProfilePoints,
  sidewalkWidthForRoad,
} from './road-profile';

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

export function medianWaterLevel(elevations: readonly number[]): number {
  if (elevations.length === 0 || elevations.some((value) => !Number.isFinite(value))) {
    throw new RangeError('Le quote del livello dell’acqua devono essere finite e non vuote');
  }
  const sorted = [...elevations].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1]! + sorted[middle]!) / 2
    : sorted[middle]!;
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
 * Catmull-Rom **centripeta** campionata a passo regolare.
 *
 * È il passaggio che mancava per avere curve da videogioco invece che da
 * spezzata OSM: la polilinea ricampionata e smussata resta fatta di segmenti
 * dritti con una piccola cuspide a ogni vertice, e in auto si sente. La spline
 * passa esattamente per i punti dati (a differenza della media pesata) e la
 * parametrizzazione centripeta evita i cappi che una Catmull-Rom uniforme fa
 * nei tornanti stretti.
 */
/**
 * Semplificazione di Douglas–Peucker.
 *
 * La spline campiona ogni 2,5 m anche lungo un rettilineo di provincia: sono
 * punti che non aggiungono forma ma pagano due triangoli a testa su ogni
 * nastro (asfalto, spalle, banchine, strisce). Qui restano solo i punti che
 * stanno più di `tolerance` metri dalla corda fra i due estremi: su una curva
 * da 30 m di raggio si perdono le corde sotto i 6 m, cioè nulla che si veda.
 */
export function simplifyPolyline(points: Pt[], tolerance = 0.15): Pt[] {
  if (points.length < 3 || !(tolerance > 0)) return points.slice();
  const tol2 = tolerance * tolerance;
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length) {
    const [first, last] = stack.pop()!;
    const a = points[first]!;
    const b = points[last]!;
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const len2 = dx * dx + dz * dz;
    let worst = -1;
    let worstIndex = -1;
    for (let i = first + 1; i < last; i++) {
      const p = points[i]!;
      let d2: number;
      if (len2 < 1e-9) {
        d2 = (p.x - a.x) * (p.x - a.x) + (p.z - a.z) * (p.z - a.z);
      } else {
        const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / len2));
        const qx = a.x + dx * t;
        const qz = a.z + dz * t;
        d2 = (p.x - qx) * (p.x - qx) + (p.z - qz) * (p.z - qz);
      }
      if (d2 > worst) {
        worst = d2;
        worstIndex = i;
      }
    }
    if (worst > tol2 && worstIndex >= 0) {
      keep[worstIndex] = 1;
      stack.push([first, worstIndex], [worstIndex, last]);
    }
  }
  const out: Pt[] = [];
  for (let i = 0; i < points.length; i++) if (keep[i]) out.push(points[i]!);
  return out;
}

export function splineThrough(points: Pt[], step = 5): Pt[] {
  if (points.length < 3) return points.slice();
  const out: Pt[] = [points[0]!];
  // parametrizzazione centripeta: distanza^0.5 fra i nodi
  const knot = (a: Pt, b: Pt): number => Math.max(1e-4, Math.sqrt(Math.hypot(b.x - a.x, b.z - a.z)));
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(0, i - 1)]!;
    const p1 = points[i]!;
    const p2 = points[i + 1]!;
    const p3 = points[Math.min(points.length - 1, i + 2)]!;
    const len = Math.hypot(p2.x - p1.x, p2.z - p1.z);
    const n = Math.max(1, Math.ceil(len / step));
    const t0 = 0;
    const t1 = t0 + knot(p0, p1);
    const t2 = t1 + knot(p1, p2);
    const t3 = t2 + knot(p2, p3);
    for (let k = 1; k <= n; k++) {
      const t = t1 + ((t2 - t1) * k) / n;
      const a1 = lerpPt(p0, p1, (t1 - t) / (t1 - t0), (t - t0) / (t1 - t0));
      const a2 = lerpPt(p1, p2, (t2 - t) / (t2 - t1), (t - t1) / (t2 - t1));
      const a3 = lerpPt(p2, p3, (t3 - t) / (t3 - t2), (t - t2) / (t3 - t2));
      const b1 = lerpPt(a1, a2, (t2 - t) / (t2 - t0), (t - t0) / (t2 - t0));
      const b2 = lerpPt(a2, a3, (t3 - t) / (t3 - t1), (t - t1) / (t3 - t1));
      out.push(lerpPt(b1, b2, (t2 - t) / (t2 - t1), (t - t1) / (t2 - t1)));
    }
  }
  return out;
}

const lerpPt = (a: Pt, b: Pt, wa: number, wb: number): Pt => ({
  x: a.x * wa + b.x * wb,
  z: a.z * wa + b.z * wb,
});

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
  allowed: (index: number) => boolean = () => true,
): void {
  let run: Pt[] = [];
  const flush = (): void => {
    if (run.length >= 2) pushRibbon(target, run, width, lift, color, heights, 1);
    run = [];
  };
  for (let i = 0; i < line.length; i++) {
    const p = line[i];
    if (!allowed(i) || blocked(p.x, p.z)) flush();
    else run.push(p);
  }
  flush();
}

/**
 * Tratteggio al centro della carreggiata: di ogni tratto disegna solo il 45%
 * centrale, così la linea si interrompe come sull'asfalto vero.
 *
 * `blocked` salta i trattini che finirebbero dentro un altro incrocio: la
 * mezzeria di una via non attraversa la carreggiata che la incrocia.
 */
function pushDashes(
  target: RibbonArrays,
  pts: Pt[],
  width: number,
  lift: number,
  color: THREE.Color,
  heights: Heightfield,
  blocked: (x: number, z: number) => boolean = () => false,
): void {
  // Tratteggio misurato in metri, non in "una frazione di ogni segmento": la
  // spline campiona ogni 2,5 m, quindi il vecchio 28–72% produceva trattini da
  // 1,1 m con pause da 1,4 m — una scala a pioli, non la mezzeria di una
  // provinciale. Qui: 3 m pieni ogni 7,5 m, come sull'asfalto vero.
  const DASH = 3;
  const PERIOD = 7.5;
  let travelled = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i]!;
    const b = pts[i + 1]!;
    const seg = Math.hypot(b.x - a.x, b.z - a.z);
    if (seg < 1e-3) continue;
    let s = 0;
    while (s < seg) {
      const phase = (travelled + s) % PERIOD;
      if (phase >= DASH) {
        s += PERIOD - phase;
        continue;
      }
      const end = Math.min(seg, s + (DASH - phase));
      const p0 = lerpPt(a, b, 1 - s / seg, s / seg);
      const p1 = lerpPt(a, b, 1 - end / seg, end / seg);
      if (!blocked(p0.x, p0.z) && !blocked(p1.x, p1.z)) {
        pushRibbon(target, [p0, p1], width, lift, color, heights, 1);
      }
      s = end;
    }
    travelled += seg;
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
  elevations?: number[],
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
    const n = heights.normalAt(pts[i].x, pts[i].z, 5);
    const nl = Math.hypot(n.x, n.y, n.z) || 1;

    for (const side of [-1, 1]) {
      // ogni bordo segue il terreno *sotto di sé*: con la quota unica del
      // centrolinea, su un pendio trasversale il lato in salita sprofondava
      // nell'asfalto e quello in discesa restava sospeso
      const ex = pts[i].x + px * half * side;
      const ez = pts[i].z + pz * half * side;
      if (elevations) {
        // ponte: il bordo segue l'impalcato, non il fondovalle sotto
        const h = (elevations[i] ?? elevations[elevations.length - 1] ?? 0) + lift;
        target.positions.push(ex, h, ez);
        target.normals.push(0, 1, 0);
      } else {
        const h = heights.heightAt(ex, ez) + lift;
        target.positions.push(ex, h, ez);
        target.normals.push(n.x / nl, n.y / nl, n.z / nl);
      }
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
 * Quota dell'impalcato per la polilinea già ricampionata.
 *
 * `prepareRoadElevations` ha lasciato una quota per ogni punto OSM; qui si
 * interpola sulla lunghezza della linea grafica. Il nastro e `groundAt`
 * leggono la stessa campata, quindi la ruota non affonda né resta a mezz'aria.
 */
export function bridgeElevations(road: Road, pts: Pt[]): number[] | null {
  const e = road.elevations;
  if (!e || e.length < 2) return null;
  let total = 0;
  const cum = new Array<number>(pts.length).fill(0);
  for (let i = 1; i < pts.length; i++) {
    total += Math.hypot(pts[i]!.x - pts[i - 1]!.x, pts[i]!.z - pts[i - 1]!.z);
    cum[i] = total;
  }
  const first = e[0]!;
  const last = e[e.length - 1]!;
  return cum.map((d) => first + (last - first) * (total > 1e-3 ? d / total : 0));
}

/** Sponde verticali in cemento dell'impalcato, sotto il bordo del ponte. */
function pushBridgeFascia(
  target: RibbonArrays,
  pts: Pt[],
  width: number,
  elevations: number[],
  lift: number,
  color: THREE.Color,
): void {
  if (pts.length < 2) return;
  for (const side of [-1, 1]) {
    const base = target.positions.length / 3;
    for (let i = 0; i < pts.length; i++) {
      const prev = pts[Math.max(0, i - 1)]!;
      const next = pts[Math.min(pts.length - 1, i + 1)]!;
      let tx = next.x - prev.x;
      let tz = next.z - prev.z;
      const len = Math.hypot(tx, tz) || 1;
      tx /= len;
      tz /= len;
      const px = -tz;
      const pz = tx;
      const x = pts[i]!.x + px * (width / 2) * side;
      const z = pts[i]!.z + pz * (width / 2) * side;
      const top = (elevations[i] ?? 0) + lift;
      const bottom = top - 1.05;
      const nx = px * side;
      const nz = pz * side;
      target.positions.push(x, bottom, z, x, top, z);
      target.normals.push(nx, 0, nz, nx, 0, nz);
      target.colors.push(color.r, color.g, color.b, color.r, color.g, color.b);
      target.uvs.push(0, bottom / 2, 0, top / 2);
      if (i > 0) {
        const a = base + (i - 1) * 2;
        target.indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }
  }
}

function pushTunnelLiner(
  target: RibbonArrays,
  pts: Pt[],
  width: number,
  elevations: number[],
  lift: number,
  color: THREE.Color,
): void {
  if (pts.length < 2) return;
  const sections = 16;
  const halfWidth = width / 2 + 1.8;
  const springHeight = 3.2;
  const archHeight = 2.4;
  const profile: { lateral: number; height: number; nx: number; ny: number }[] = [
    { lateral: halfWidth, height: 0, nx: 1, ny: 0 },
    { lateral: halfWidth, height: springHeight, nx: 1, ny: 0 },
  ];
  for (let j = 1; j < sections; j++) {
    const angle = (Math.PI * j) / sections;
    profile.push({
      lateral: Math.cos(angle) * halfWidth,
      height: springHeight + Math.sin(angle) * archHeight,
      nx: Math.cos(angle),
      ny: Math.sin(angle),
    });
  }
  profile.push(
    { lateral: -halfWidth, height: springHeight, nx: -1, ny: 0 },
    { lateral: -halfWidth, height: 0, nx: -1, ny: 0 },
  );
  const base = target.positions.length / 3;
  let travelled = 0;
  for (let i = 0; i < pts.length; i++) {
    if (i > 0) travelled += Math.hypot(pts[i]!.x - pts[i - 1]!.x, pts[i]!.z - pts[i - 1]!.z);
    const previous = pts[Math.max(0, i - 1)]!;
    const next = pts[Math.min(pts.length - 1, i + 1)]!;
    let tx = next.x - previous.x;
    let tz = next.z - previous.z;
    const length = Math.hypot(tx, tz) || 1;
    tx /= length;
    tz /= length;
    const px = -tz;
    const pz = tx;
    const centerY = (elevations[i] ?? 0) + lift;
    for (let j = 0; j < profile.length; j++) {
      const section = profile[j]!;
      target.positions.push(pts[i]!.x + px * section.lateral, centerY + section.height, pts[i]!.z + pz * section.lateral);
      target.normals.push(px * section.nx, section.ny, pz * section.nx);
      target.colors.push(color.r, color.g, color.b);
      target.uvs.push(j / profile.length, travelled / 5);
      if (i > 0 && j < profile.length - 1) {
        const a = base + (i - 1) * profile.length + j;
        const b = base + i * profile.length + j;
        target.indices.push(a, b, a + 1, a + 1, b, b + 1);
      }
    }
  }
}

function pushRuralVerge(
  target: RibbonArrays,
  pts: Pt[],
  width: number,
  lift: number,
  color: THREE.Color,
  heights: Heightfield,
  blocked: (x: number, z: number) => boolean,
  allowed: (index: number) => boolean,
): void {
  const profile = createRoadProfile({ width, paved: true });
  const stations = ruralProfilePoints(profile, lift);
  if (stations.length < 2) return;
  const across = stations.length;
  for (const side of [-1, 1]) {
    const base = target.positions.length / 3;
    for (let i = 0; i < pts.length; i++) {
      const previous = pts[Math.max(0, i - 1)]!;
      const next = pts[Math.min(pts.length - 1, i + 1)]!;
      let tx = next.x - previous.x;
      let tz = next.z - previous.z;
      const length = Math.hypot(tx, tz) || 1;
      tx /= length;
      tz /= length;
      const px = -tz * side;
      const pz = tx * side;
      for (let j = 0; j < across; j++) {
        const station = stations[j]!;
        const x = pts[i]!.x + px * station.distance;
        const z = pts[i]!.z + pz * station.distance;
        const y = heights.heightAt(x, z) + station.offset;
        // il cavo del ciglione è appena più in ombra dell'erba intorno: una
        // striscia al 18% di nero sembrava un tubo interrato
        const tint = j === 1 ? 0.92 : j === 2 ? 0.97 : 1;
        target.positions.push(x, y, z);
        target.normals.push(px * 0.16, 0.98, pz * 0.16);
        target.colors.push(color.r * tint, color.g * tint, color.b * tint);
        target.uvs.push(j / (across - 1), i * 0.45);
      }
      if (i === 0 || !allowed(i - 1) || !allowed(i) || blocked(pts[i]!.x, pts[i]!.z)) continue;
      const previousRow = base + (i - 1) * across;
      const currentRow = base + i * across;
      for (let j = 0; j < across - 1; j++) {
        const a = previousRow + j;
        const b = currentRow + j;
        target.indices.push(a, a + 1, b, a + 1, b + 1, b);
      }
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
  allowed: (index: number) => boolean = () => true,
): void {
  for (let i = 0; i < pts.length - 1; i++) {
    if (!allowed(i) || !allowed(i + 1)) continue;
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

/**
 * Vero incrocio: il punto sta anche su un'altra strada (esclusa `own`).
 * Le strisce e lo stop si mettono solo qui; sui tratti dritti non ci sono.
 */
export function isRealJunction(roads: RoadIndex | undefined, at: Pt, own: number): boolean {
  // tolleranza 2 m voleva dire "incrocio" anche per una via che passa a due
  // metri di distanza: da lì nascevano stop e zebre in mezzo al nulla. Un
  // incrocio vero ha il punto dentro l'altra carreggiata.
  return roads ? roads.isOnRoad(at.x, at.z, 0.5, own) : false;
}

/**
 * "Dare precedenza": fila di triangoli col vertice verso chi arriva, sulla
 * sola corsia di marcia. In Italia il segnale a terra non è una banda piena
 * come lo stop: è questa fila di punte, ed è quello che distingue una via
 * secondaria da una provinciale.
 *
 * Restituisce i triangoli in coordinate di pianta: il chiamante li appoggia
 * al terreno. Puro, così si può testare la geometria senza scena 3D.
 */
export function giveWayTriangles(at: Pt, tx: number, tz: number, width: number, count = 4): Pt[][] {
  const px = -tz;
  const pz = tx;
  const lane = width * 0.42;
  const step = lane / count;
  const out: Pt[][] = [];
  for (let i = 0; i < count; i++) {
    const lat = width * 0.04 + step * (i + 0.5);
    const cx = at.x - px * lat;
    const cz = at.z - pz * lat;
    const half = step * 0.42;
    const base = 0.05;
    const apex = 0.95;
    out.push([
      { x: cx - px * half + tx * base, z: cz - pz * half + tz * base },
      { x: cx + px * half + tx * base, z: cz + pz * half + tz * base },
      { x: cx - tx * apex, z: cz - tz * apex },
    ]);
  }
  return out;
}

/**
 * Segmento dell'altra strada che passa per l'incrocio: serve a sapere con che
 * via si ha a che fare (larghezza e direzione del suo cordolo).
 */
interface Crossing {
  x: number;
  z: number;
  /** direzione della strada che attraversa */
  dx: number;
  dz: number;
  /** semilarghezza dell'asfalto */
  half: number;
}

function crossingAt(roads: RoadIndex, at: Pt, own: number, reach = 9): Crossing | null {
  let best: Crossing | null = null;
  let bestD = Infinity;
  roads.forEachSegmentNear(at.x, at.z, reach, (s) => {
    if (s.road === own) return;
    // punto del segmento più vicino all'incrocio
    const ex = s.bx - s.ax;
    const ez = s.bz - s.az;
    const len2 = ex * ex + ez * ez || 1;
    const k = clamp(((at.x - s.ax) * ex + (at.z - s.az) * ez) / len2, 0, 1);
    const px = s.ax + ex * k;
    const pz = s.az + ez * k;
    const d = Math.hypot(px - at.x, pz - at.z);
    if (d > s.w + 1.4 || d >= bestD) return;
    const len = Math.sqrt(len2);
    bestD = d;
    best = { x: px, z: pz, dx: ex / len, dz: ez / len, half: s.w };
  });
  return best;
}

/** Triangolo pieno appoggiato al terreno (punte del dare precedenza). */
function pushTriangle(
  target: RibbonArrays,
  tri: Pt[],
  lift: number,
  color: THREE.Color,
  heights: Heightfield,
): void {
  if (tri.length < 3) return;
  const base = target.positions.length / 3;
  for (const p of tri) {
    target.positions.push(p.x, heights.heightAt(p.x, p.z) + lift, p.z);
    target.normals.push(0, 1, 0);
    target.colors.push(color.r, color.g, color.b);
    target.uvs.push(0, 0);
  }
  target.indices.push(base, base + 1, base + 2);
}

/**
 * Freccia di direzione dritta nella corsia di marcia: gambo sottile e punta
 * a triangolo. Le frecce vere stanno 10-20 m prima dell'incrocio, sulla corsia
 * che le riguarda, non al centro della strada.
 */
function pushStraightArrow(
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
  const lat = width * 0.26;
  // nella corsia di marcia (a destra del verso), non in quella opposta
  const cx = at.x + px * lat;
  const cz = at.z + pz * lat;
  // punta verso l'incrocio: prima era disegnata al contrario e sulla corsia
  // di chi arriva, una delle ragioni per cui gli incroci sembravano casuali
  const shaft: Pt[] = [
    { x: cx - tx * 2.6, z: cz - tz * 2.6 },
    { x: cx + tx * 0.1, z: cz + tz * 0.1 },
  ];
  pushRibbon(target, shaft, 0.18, lift, color, heights, 1);
  pushTriangle(
    target,
    [
      { x: cx - px * 0.28 + tx * 0.15, z: cz - pz * 0.28 + tz * 0.15 },
      { x: cx + px * 0.28 + tx * 0.15, z: cz + pz * 0.28 + tz * 0.15 },
      { x: cx + tx * 1.15, z: cz + tz * 1.15 },
    ],
    lift,
    color,
    heights,
  );
}

/**
 * Raccordo d'angolo tra due cordoli: quarto d'arco che sostituisce lo spigolo
 * vivo dove la via secondaria sbocca sulla principale.
 *
 * `p1`/`u` sono un punto e la direzione del cordolo della prima strada,
 * `p2`/`v` quelli della seconda; `center` è il punto d'incrocio delle due
 * centerline, serve solo a scegliere verso quale lato curvare. Restituisce i
 * punti dell'arco (Bezier quadratica con controllo sullo spigolo) oppure null
 * se le due strade sono quasi parallele.
 */
export function filletCorner(
  p1: Pt,
  u: Pt,
  p2: Pt,
  v: Pt,
  center: Pt,
  radius = 0.9,
  steps = 6,
): Pt[] | null {
  const den = u.x * v.z - u.z * v.x;
  if (Math.abs(den) < 0.25) return null;
  const dx = p2.x - p1.x;
  const dz = p2.z - p1.z;
  const t = (dx * v.z - dz * v.x) / den;
  const corner = { x: p1.x + u.x * t, z: p1.z + u.z * t };
  const toCenterX = center.x - corner.x;
  const toCenterZ = center.z - corner.z;
  const along1 = Math.sign(toCenterX * u.x + toCenterZ * u.z) || -1;
  const along2 = Math.sign(toCenterX * v.x + toCenterZ * v.z) || -1;
  const s = { x: corner.x + u.x * along1 * radius, z: corner.z + u.z * along1 * radius };
  const e = { x: corner.x + v.x * along2 * radius, z: corner.z + v.z * along2 * radius };
  const out: Pt[] = [];
  for (let i = 0; i <= steps; i++) {
    const k = i / steps;
    const a = (1 - k) * (1 - k);
    const b = 2 * (1 - k) * k;
    const c = k * k;
    out.push({
      x: a * s.x + b * corner.x + c * e.x,
      z: a * s.z + b * corner.z + c * e.z,
    });
  }
  return out;
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
 * Vernice consumata: la segnaletica orizzontale non è mai nuova a parte il
 * giorno dopo la posa. Nello shader, in coordinate mondo, il bianco perde
 * pezzi dove passa il rumore: chiazze di asfalto che riaffiorano e tinta
 * sporca, senza cambiare la geometria.
 */
function applyPaintWear(material: THREE.MeshStandardMaterial): void {
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vPaintWorld;')
      .replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\nvPaintWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;',
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
varying vec3 vPaintWorld;

float paintHash(vec2 p) {
  p = fract(p * vec2(127.1, 311.7));
  p += dot(p, p + 34.23);
  return fract(p.x * p.y);
}

float paintNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(paintHash(i), paintHash(i + vec2(1.0, 0.0)), f.x),
             mix(paintHash(i + vec2(0.0, 1.0)), paintHash(i + vec2(1.0, 1.0)), f.x), f.y);
}`,
      )
      .replace(
        '#include <clipping_planes_fragment>',
        `#include <clipping_planes_fragment>
{
  // due scale di rumore: le macchie larghe sono usura, quelle fini il bordo
  // sgranato della vernice che si stacca
  float wear = paintNoise(vPaintWorld.xz * 1.9) * 0.66 + paintNoise(vPaintWorld.xz * 6.3) * 0.34;
  if (wear < 0.24) discard;
  // il bianco sporco di polvere, con la tinta che varia da striscia a striscia
  diffuseColor.rgb *= 0.84 + 0.22 * paintNoise(vPaintWorld.xz * 1.1);
}`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
roughnessFactor = clamp(roughnessFactor + 0.12 * paintNoise(vPaintWorld.xz * 1.9), 0.35, 1.0);`,
      );
  };
  material.customProgramCacheKey = () => 'paint-wear-v1';
}

/**
 * Strade come nastri drappeggiati sul DEM. Due mesh (asfalto/sterrato) per
 * limitare le draw call, con leggera variazione di tono per non sembrare finto.
 *
 * Le mappe colore sono texture PBR CC0: il vertex color resta un tint quasi
 * bianco (variazione per strada), perché il colore dell'asfalto arriva dalla
 * texture e non va moltiplicato una seconda volta.
 */
/**
 * La polilinea grafica di una strada: ricampionata, con gli angoli smussati e
 * passata per la spline centripeta.
 *
 * È la strada che si vede. Tutto ciò che deve appoggiarsi all'asfalto — cordoli,
 * marciapiedi e guardrail — deve usare questa, non i nodi OSM grezzi: su una
 * provinciale con un nodo ogni 800 m il nastro segue una curva, mentre i nodi
 * grezzi tirano una corda che se ne stacca anche di 18 m.
 */
export function roadPolyline(road: Road): Pt[] {
  return splineThrough(
    roundCorners(
      smoothPolyline(resample(road.points, road.paved ? 7 : 6), 2, 0.55),
      road.paved ? 24 : 30,
    ),
    road.paved ? 2.5 : 3,
  );
}

function streetLampYaw(lamp: Pt, osm: OsmData): number {
  let bestDistance = Infinity;
  let yaw = 0;
  for (const road of osm.roads) {
    if (!road.paved) continue;
    for (let i = 1; i < road.points.length; i++) {
      const a = road.points[i - 1]!;
      const b = road.points[i]!;
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const length2 = dx * dx + dz * dz;
      if (length2 < 1e-6) continue;
      const t = clamp(((lamp.x - a.x) * dx + (lamp.z - a.z) * dz) / length2, 0, 1);
      const qx = a.x + dx * t;
      const qz = a.z + dz * t;
      const distance = Math.hypot(lamp.x - qx, lamp.z - qz);
      if (distance >= bestDistance) continue;
      bestDistance = distance;
      yaw = Math.atan2(qx - lamp.x, qz - lamp.z);
    }
  }
  return yaw;
}

function roadAt(osm: OsmData, point: Pt): { tx: number; tz: number; width: number; lift: number } | null {
  let bestDistance = 12;
  let best: { tx: number; tz: number; width: number; lift: number } | null = null;
  for (const [index, road] of osm.roads.entries()) {
    if (!road.paved) continue;
    for (let i = 1; i < road.points.length; i++) {
      const a = road.points[i - 1]!;
      const b = road.points[i]!;
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const length2 = dx * dx + dz * dz;
      if (length2 < 1e-6) continue;
      const t = clamp(((point.x - a.x) * dx + (point.z - a.z) * dz) / length2, 0, 1);
      const qx = a.x + dx * t;
      const qz = a.z + dz * t;
      const distance = Math.hypot(point.x - qx, point.z - qz);
      if (distance >= bestDistance) continue;
      const length = Math.sqrt(length2);
      bestDistance = distance;
      best = { tx: dx / length, tz: dz / length, width: road.width, lift: roadLift(index, road.paved) };
    }
  }
  return best;
}

const PROCEDURAL_ROAD_LENGTH = 50_000;
const PROCEDURAL_ROAD_STEP = 60;

/** Continues an open OSM endpoint by steering gently along generated contours. */
export function createContourRoadExtension(
  road: Road,
  atStart: boolean,
  heights: Heightfield,
  length = PROCEDURAL_ROAD_LENGTH,
): Road {
  const points = road.points;
  const endpoint = atStart ? points[0] : points[points.length - 1];
  const adjacent = atStart ? points[1] : points[points.length - 2];
  if (!endpoint || !adjacent) throw new Error('continuazione stradale: way senza due punti');

  let heading = Math.atan2(endpoint.z - adjacent.z, endpoint.x - adjacent.x);
  const seed = hashInt(Math.round(endpoint.x) ^ Math.imul(Math.round(endpoint.z), 31), atStart ? 0x51 : 0xa7);
  const random = mulberry32(seed);
  const extension: Pt[] = [{ x: endpoint.x, z: endpoint.z }];
  const sampleStep = 12;

  for (let distance = PROCEDURAL_ROAD_STEP; distance <= length; distance += PROCEDURAL_ROAD_STEP) {
    const previous = extension[extension.length - 1]!;
    const gx =
      (heights.heightAt(previous.x + sampleStep, previous.z) -
        heights.heightAt(previous.x - sampleStep, previous.z)) /
      (2 * sampleStep);
    const gz =
      (heights.heightAt(previous.x, previous.z + sampleStep) -
        heights.heightAt(previous.x, previous.z - sampleStep)) /
      (2 * sampleStep);
    if (Math.hypot(gx, gz) > 1e-4) {
      let contourHeading = Math.atan2(-gx, gz);
      if (Math.cos(contourHeading - heading) < 0) contourHeading = wrapAngle(contourHeading + Math.PI);
      const contourTurn = clamp(wrapAngle(contourHeading - heading) * 0.18, -0.045, 0.045);
      heading += contourTurn;
    }
    heading += (random() - 0.5) * 0.012;
    extension.push({
      x: previous.x + Math.cos(heading) * PROCEDURAL_ROAD_STEP,
      z: previous.z + Math.sin(heading) * PROCEDURAL_ROAD_STEP,
    });
  }

  return {
    ...road,
    name: road.name ? `${road.name} (procedurale)` : 'Strada panoramica',
    points: extension,
    bounds: boundsOf(extension),
    bridge: undefined,
    tunnel: undefined,
    elevations: undefined,
    walkSpans: undefined,
  };
}

/**
 * Adds long deterministic continuations where OSM ways meet the DEM boundary.
 * The graph and rendered ribbon consume the same generated roads.
 */
export function extendBoundaryRoads(osm: OsmData, heights: Heightfield): number {
  const { originX, originZ, nx, nz, step } = heights.meta;
  const minX = originX;
  const maxX = originX + (nx - 1) * step;
  const minZ = originZ;
  const maxZ = originZ + (nz - 1) * step;
  const candidates: { road: Road; atStart: boolean; edgeDistance: number; priority: number }[] = [];
  const priority: Record<string, number> = {
    motorway: 0,
    trunk: 1,
    primary: 2,
    secondary: 3,
    tertiary: 4,
    unclassified: 5,
    residential: 6,
  };

  for (const road of osm.roads) {
    if (road.points.length < 2 || road.width < 3.8) continue;
    for (const atStart of [true, false]) {
      const endpoint = atStart ? road.points[0]! : road.points[road.points.length - 1]!;
      const edgeDistance = Math.min(endpoint.x - minX, maxX - endpoint.x, endpoint.z - minZ, maxZ - endpoint.z);
      if (edgeDistance < 0 || edgeDistance > 120) continue;
      candidates.push({
        road,
        atStart,
        edgeDistance,
        priority: priority[road.type] ?? (road.paved ? 7 : 8),
      });
    }
  }

  candidates.sort((a, b) => a.priority - b.priority || a.edgeDistance - b.edgeDistance);
  const accepted: Pt[] = [];
  const extensions: Road[] = [];
  for (const candidate of candidates) {
    const endpoint = candidate.atStart
      ? candidate.road.points[0]!
      : candidate.road.points[candidate.road.points.length - 1]!;
    if (accepted.some((point) => Math.hypot(point.x - endpoint.x, point.z - endpoint.z) < 150)) continue;
    accepted.push(endpoint);
    extensions.push(createContourRoadExtension(candidate.road, candidate.atStart, heights));
    if (extensions.length >= 12) break;
  }
  osm.roads.push(...extensions);
  return extensions.length;
}

export function buildRoads(
  osm: OsmData,
  heights: Heightfield,
  renderer: THREE.WebGLRenderer,
  roadIndex?: RoadIndex,
  buildings?: BuildingIndex,
  kit?: CityKit | null,
): { group: THREE.Group; lamps: { x: number; z: number; yaw: number }[] } {
  const group = new THREE.Group();
  group.name = 'roads';
  const asphalt = emptyRibbon();
  const dirt = emptyRibbon();
  // marciapiede e cordolo separati: il kit ha una texture per le lastre e una
  // per il granito del cordolo, e vanno dosate con repeat diversi
  const walkway = emptyRibbon();
  const kerb = emptyRibbon();
  const markings = emptyRibbon();
  // spalla in ghiaia delle strade di campagna: senza, il bordo dell'asfalto
  // cade a picco sull'erba e si vede il taglio
  const shoulder = emptyRibbon();
  const verges = emptyRibbon();
  const tunnelLiners = emptyRibbon();
  const asphaltColor = new THREE.Color(0xffffff);
  const dirtColor = new THREE.Color(0xf6efe6);
  // ghiaia compattata, non cemento: il moltiplicatore 2,35 schiariva la mappa
  // d'asfalto fino al bianco e la spalla leggeva come una rampa di cemento
  // accanto a ogni provinciale. Un filo più chiara dell'asfalto basta.
  const shoulderColor = new THREE.Color(1.24, 1.16, 0.98);
  // ciglione erboso: la stessa famiglia di verdi del tappeto d'erba, così il
  // raccordo col prato non è una fascia marrone
  const vergeColor = new THREE.Color(0x939c6b);
  const tunnelColor = new THREE.Color(0x4b4a43);
  const kitWalkMat = kit?.material('sidewalk', 'footway_flags', { repeat: [0.55, 0.5], white: true }) ?? null;
  const kitKerbMat = kit?.material('sidewalk', 'granite_kerb', { repeat: [1, 2], white: true }) ?? null;
  const kitAsphaltMat =
    kit?.material('road-surface', 'asphalt_slab', { repeat: [0.55, 0.5], white: true, wet: true }) ?? null;
  // con le texture del kit il colore per vertice deve restare bianco: la tinta
  // arriva dalla foto, non da un secondo colore moltiplicato sopra
  const pavementColor = new THREE.Color(kitWalkMat ? 0xffffff : 0x9c9a92);
  // cordolo in cemento consumato, non in plastica bianca: a 0xd9d6cc il
  // marciapiede diventava una striscia luminosa che tagliava il paese
  const curbColor = new THREE.Color(kitKerbMat ? 0xffffff : 0xb9b3a6);
  const markingColor = new THREE.Color(0xf4f2e8);
  /** punti in cui piantare un lampione: bordo strada dentro/attorno al paese */
  const lamps: { x: number; z: number; yaw: number }[] = [];

  osm.roads.forEach((road, idx) => {
    // angoli smussati, poi spline centripeta: l'asfalto passa per i nodi OSM
    // ma senza le cuspidi che facevano "scattare" il volante. Per i nastri si
    // tolgono i punti ridondanti (Douglas–Peucker, 15 cm): la fisica continua
    // a leggere la spline fitta, quindi il guardrail e l'auto non cambiano.
    const pts = simplifyPolyline(roadPolyline(road), road.paved ? 0.15 : 0.22);
    const isDirt = !road.paved;
    const target = isDirt ? dirt : asphalt;
    const base = isDirt ? dirtColor : asphaltColor;
    const color = base.clone().multiplyScalar(0.97 + (hashInt(idx, 7) % 60) / 1000);
    // micro offset per evitare z-fighting negli incroci (condiviso con la fisica)
    const lift = roadLift(idx, road.paved);
    // lato dei lampioni scelto una volta per strada, non a ogni palo
    const lampSide = hashInt(idx, 13) % 2 === 0 ? 1 : -1;
    const deck = road.bridge ? bridgeElevations(road, pts) : null;
    if (deck) {
      // Il ponte è un impalcato sospeso: niente marciapiede né spalla a terra.
      pushRibbon(target, pts, road.width, lift, color, heights, 1, deck);
      pushBridgeFascia(kerb, pts, road.width, deck, lift, curbColor);
      return;
    }
    if (road.tunnel) {
      const tunnelDeck = bridgeElevations(road, pts);
      if (tunnelDeck) {
        pushRibbon(target, pts, road.width, lift, color, heights, 1, tunnelDeck);
        pushTunnelLiner(tunnelLiners, pts, road.width, tunnelDeck, lift, tunnelColor);
        return;
      }
    }
    pushRibbon(target, pts, road.width, lift, color, heights, 1);
    // Punto che sta su un'ALTRA strada: è l'incrocio. Qui non vanno cordoli,
    // marciapiedi né strisce, altrimenti restano delle righe chiare in mezzo
    // alla carreggiata (era il difetto visibile a ridosso degli incroci).
    const onJunction = (x: number, z: number): boolean =>
      roadIndex ? roadIndex.isOnRoad(x, z, 0.35, idx) : false;
    // tratteggio di mezzeria sulle carreggiate larghe
    if (!isDirt && road.width >= 5.4) {
      pushDashes(markings, pts, 0.14, lift + 0.012, markingColor, heights, onJunction);
    }

    // Solo le strade asfaltate hanno marciapiede e cordolo: le sterrate no.
    if (isDirt) {
      // ...ma anche lo sterrato è un nastro rialzato di 12 cm: senza il bordo
      // verticale, sul pendio si vede il vuoto sotto il manto
      for (const side of [-1, 1]) {
        pushCurbWall(
          dirt,
          offsetPolyline(pts, side * (road.width / 2)),
          0,
          lift,
          -side,
          color,
          heights,
          () => false,
        );
      }
      return;
    }
    // marciapiede stretto da centro storico: 1,45/1,15 m. A 1,8 m sembrava un
    // marciapiede americano e mangiava la carreggiata nelle vie del paese.
    const walkWidth = sidewalkWidthForRoad(road.width);
    // cordolo a 18 cm (altezza da marciapiede italiano): è lo scalino che si
    // sente sotto il piede e che stacca la pavimentazione dall'asfalto
    const curbTop = lift + CURB_HEIGHT;
    const walkLift = curbTop + 0.005;
    // La larghezza del marciapiede conta: fermare il nastro solo quando il
    // centro è dentro l'altra strada lasciava sporgere mezzo marciapiede
    // nell'incrocio (le "lingue" chiare viste in paese). Si esclude la strada
    // corrente e ci si ferma un metro buono prima del ciglio dell'altra.
    const blockedWalk = (x: number, z: number): boolean =>
      roadIndex ? roadIndex.isOnRoad(x, z, walkWidth * 0.55 + 0.25, idx) : false;
    // il cordolo parte dal bordo dell'asfalto e occupa 22 cm; il marciapiede
    // inizia dove finisce il cordolo, così nessuno dei due copre l'altro
    const curbWidth = ROAD_PROFILE.curbWidth;
    // marciapiede e cordolo solo nel costruito: in campagna la provinciale
    // resta asfalto nudo con il suo ciglio di ghiaia. I punti sono ricampionati
    // e smussati, quindi la maschera (calcolata sui punti OSM) si riporta qui
    // prendendo il punto originale più vicino.
    const spans = road.walkSpans;
    const town = spans
      ? pts.map((p) => {
          let best = Infinity;
          let bestIndex = 0;
          for (let k = 0; k < road.points.length; k++) {
            const q = road.points[k];
            const d = (q.x - p.x) * (q.x - p.x) + (q.z - p.z) * (q.z - p.z);
            if (d < best) {
              best = d;
              bestIndex = k;
            }
          }
          return spans[bestIndex] === true;
        })
      : null;
    // Senza maschera (strade dei tile streamed, che non passano da
    // `markTownSidewalks`) non si inventa un paese: niente marciapiedi. Il
    // vecchio default `true` lastricava di cordoli ogni strada di campagna.
    const inTown = (index: number): boolean =>
      town ? town[Math.min(Math.max(index, 0), town.length - 1)] === true : false;
    for (const side of [-1, 1]) {
      // cordolo: fascia chiara in cima al rialzo. Si interrompe all'incrocio
      // (prima ci passava sopra, disegnando una striscia grigia di traverso).
      const curbLine = offsetPolyline(pts, side * (road.width / 2 + curbWidth / 2));
      pushRuns(kerb, curbLine, curbWidth, curbTop, curbColor, heights, onJunction, inTown);
      // faccia verticale del cordolo, a filo dell'asfalto
      pushCurbWall(
        kerb,
        offsetPolyline(pts, side * (road.width / 2 + 0.005)),
        lift,
        lift + CURB_HEIGHT,
        side,
        curbColor,
        heights,
        onJunction,
        inTown,
      );
      // marciapiede accostato al cordolo, interrotto agli incroci veri
      const walkLine = offsetPolyline(pts, side * (road.width / 2 + curbWidth + walkWidth / 2));
      pushRuns(walkway, walkLine, walkWidth, walkLift, pavementColor, heights, blockedWalk, inTown);
      // bordo esterno del marciapiede: chiude il nastro sul lato verso il prato
      pushCurbWall(
        kerb,
        offsetPolyline(pts, side * (road.width / 2 + curbWidth + walkWidth)),
        0,
        walkLift,
        -side,
        curbColor,
        heights,
        blockedWalk,
        inTown,
      );
    }

    // --- margine di campagna: linea bianca di bordo e spalla in ghiaia ------
    // Fuori dal costruito una provinciale ha la linea di margine e un filo di
    // ghiaia prima dell'erba. Dentro il paese ci pensa il cordolo.
    const rural = (index: number): boolean => !inTown(index);
    if (road.width >= 5) {
      for (const side of [-1, 1]) {
        pushRuns(
          markings,
          offsetPolyline(pts, side * (road.width / 2 - 0.26)),
          0.11,
          lift + 0.012,
          markingColor,
          heights,
          onJunction,
          rural,
        );
      }
    }
    if (road.width >= 3.6) {
      for (const side of [-1, 1]) {
        pushRuns(
          shoulder,
          offsetPolyline(pts, side * (road.width / 2 + ROAD_PROFILE.shoulderWidth / 2)),
          ROAD_PROFILE.shoulderWidth,
          lift - ROAD_PROFILE.shoulderDrop,
          shoulderColor,
          heights,
          onJunction,
          rural,
        );
      }
    }
    if (road.width >= 3.6) {
      pushRuralVerge(verges, pts, road.width, lift, vergeColor, heights, onJunction, rural);
    }

    // attraversamenti, stop e lampioni: gli incroci valgono anche in campagna
    if (!roadIndex) return;
    let sinceCross = 0;
    let sinceLamp = 0;
    // dentro l'area dell'incrocio si passa su più punti ricampionati: senza
    // questo stato la linea di arresto veniva disegnata una volta per punto
    let inJunction = false;
    for (let i = 1; i < pts.length - 1; i++) {
      const a = pts[i - 1];
      const b = pts[i];
      const seg = Math.hypot(b.x - a.x, b.z - a.z);
      sinceCross += seg;
      sinceLamp += seg;
      let tx = b.x - a.x;
      let tz = b.z - a.z;
      const tl = Math.hypot(tx, tz) || 1;
      tx /= tl;
      tz /= tl;

      // "costruito" serve sia alle strisce sia alle zebre: si calcola una volta
      const built = buildings
        ? buildings.near(b.x, b.z).some(
            (bd) =>
              b.x > bd.bounds.minX - 26 &&
              b.x < bd.bounds.maxX + 26 &&
              b.z > bd.bounds.minZ - 26 &&
              b.z < bd.bounds.maxZ + 26,
          )
        : false;

      // linea di arresto a OGNI incrocio, arretrata quel tanto che basta per
      // non finire sopra la carreggiata che attraversa
      const junction = isRealJunction(roadIndex, b, idx);
      const enters = junction && !inJunction;
      inJunction = junction;
      let zebraHere = false;
      if (enters) {
        const cross = crossingAt(roadIndex, b, idx);
        // una via secondaria davanti a una più larga ha il "dare precedenza":
        // punte a terra invece della banda piena dello stop
        const minor = cross !== null && cross.half + 0.35 < road.width * 0.5;

        // attraversamento pedonale solo sulla via principale, su un tratto
        // dritto e non a ogni incrocio: prima la zebra e lo stop venivano
        // disegnati nello stesso punto e sembravano due strisce sovrapposte
        if (
          cross &&
          built &&
          !minor &&
          sinceCross > 60 &&
          i + 1 < pts.length &&
          !(osm.crossings?.length)
        ) {
          const c = pts[i + 1];
          let ux = c.x - b.x;
          let uz = c.z - b.z;
          const ul = Math.hypot(ux, uz) || 1;
          ux /= ul;
          uz /= ul;
          zebraHere = tx * ux + tz * uz > 0.93;
        }

        if (minor && cross && !(osm.controls?.length)) {
          const gwAt = { x: b.x - tx * (cross.half + 0.9), z: b.z - tz * (cross.half + 0.9) };
          if (!onJunction(gwAt.x, gwAt.z)) {
            for (const tri of giveWayTriangles(gwAt, tx, tz, road.width)) {
              pushTriangle(markings, tri, lift + 0.011, markingColor, heights);
            }
          }
        } else if (!zebraHere && !(osm.controls?.length)) {
          // arretrata oltre la carreggiata che attraversa: a 4,3 m fissi su un
          // incrocio largo lo stop cadeva dentro l'altra strada
          const back = cross ? cross.half + 1.5 : 4.3;
          const at = { x: b.x - tx * back, z: b.z - tz * back };
          if (!onJunction(at.x, at.z)) {
            pushStopLine(markings, at, tx, tz, road.width, lift + 0.011, markingColor, heights);
            // freccia dritta dietro lo stop, solo su strade larghe: prima
            // finiva sopra la linea e sulla corsia opposta
            if (road.width >= 6.2) {
              const arrowAt = { x: b.x - tx * (back + 3.4), z: b.z - tz * (back + 3.4) };
              if (!onJunction(arrowAt.x, arrowAt.z)) {
                pushStraightArrow(
                  markings,
                  arrowAt,
                  tx,
                  tz,
                  road.width,
                  lift + 0.011,
                  markingColor,
                  heights,
                );
              }
            }
          }
        }

        // --- raccordo del cordolo -------------------------------------------------
        // In paese il cordolo si interrompeva a squadro sull'asfalto: quattro
        // spigoli vivi al posto dei quarti d'arco che ha un incrocio vero.
        if (cross && inTown(i) && road.width >= 4) {
          const ownCurb = road.width / 2 + 0.11;
          const crossCurb = cross.half + 0.11;
          const pOwnX = -tz;
          const pOwnZ = tx;
          const pCrossX = -cross.dz;
          const pCrossZ = cross.dx;
          for (const s2 of [-1, 1]) {
            const p1 = { x: b.x + pOwnX * s2 * ownCurb, z: b.z + pOwnZ * s2 * ownCurb };
            for (const s1 of [-1, 1]) {
              const p2 = {
                x: cross.x + pCrossX * s1 * crossCurb,
                z: cross.z + pCrossZ * s1 * crossCurb,
              };
              const arc = filletCorner(p1, { x: tx, z: tz }, p2, { x: cross.dx, z: cross.dz }, b);
              if (!arc) continue;
              // l'arco deve restare nell'angolo, non attraversare la carreggiata
              const mid = arc[Math.floor(arc.length / 2)]!;
              if (Math.hypot(mid.x - b.x, mid.z - b.z) > ownCurb + crossCurb + 1.6) continue;
              // e nessun punto può finire dentro l'asfalto dell'altra via: era
              // questa la "striscia di marciapiede" chiara di traverso
              // all'incrocio (un quarto d'arco costruito dal lato sbagliato)
              let onAsphalt = false;
              for (const p of arc) {
                if (roadIndex?.isOnRoad(p.x, p.z, -0.15)) {
                  onAsphalt = true;
                  break;
                }
              }
              if (onAsphalt) continue;
              pushRibbon(kerb, arc, 0.22, curbTop, curbColor, heights, 1);
            }
          }
        }
      }

      // il resto (zebra e lampioni) solo dove ci sono case a ridosso
      if (!built) continue;

      // attraversamento: zebra verso l'incrocio, stop dietro la zebra.
      // Prima zebra e stop erano allo stesso punto e si sovrapponevano.
      if (zebraHere) {
        const crossing = crossingAt(roadIndex, b, idx);
        if (crossing) {
          const zAt = {
            x: b.x - tx * (crossing.half + 2.9),
            z: b.z - tz * (crossing.half + 2.9),
          };
          const sAt = {
            x: b.x - tx * (crossing.half + 5.6),
            z: b.z - tz * (crossing.half + 5.6),
          };
          if (!onJunction(zAt.x, zAt.z) && !onJunction(sAt.x, sAt.z)) {
            pushZebra(markings, zAt, tx, tz, road.width, lift + 0.011, markingColor, heights);
            pushStopLine(markings, sAt, tx, tz, road.width, lift + 0.011, markingColor, heights);
            if (road.width >= 6.2) {
              const aAt = {
                x: b.x - tx * (crossing.half + 9.2),
                z: b.z - tz * (crossing.half + 9.2),
              };
              if (!onJunction(aAt.x, aAt.z)) {
                pushStraightArrow(
                  markings,
                  aAt,
                  tx,
                  tz,
                  road.width,
                  lift + 0.011,
                  markingColor,
                  heights,
                );
              }
            }
            sinceCross = 0;
          }
        }
      }
      // Lampioni ogni ~34 m, tutti sullo stesso lato della via: alternarli a
      // ogni palo dava una fila a zig-zag che non esiste in nessun paese.
      // Solo in strade larghe abbastanza e solo dentro il costruito.
      if (sinceLamp > 34 && road.width >= 4.6) {
        const side = lampSide;
        const off = road.width / 2 + walkWidth + 0.35;
        const lampX = b.x - tz * side * off;
        const lampZ = b.z + tx * side * off;
        // all'incrocio la perpendicolare può cadere sulla carreggiata che
        // attraversa: un lampione in mezzo all'asfalto era uno dei pali
        // "casuali" che si vedevano in paese. Niente palo su strada o dentro
        // un muro.
        if (roadIndex?.isOnRoad(lampX, lampZ, 0.3, idx)) continue;
        if (buildings?.hitsCircle(lampX, lampZ, 0.35)) continue;
        lamps.push({
          x: lampX,
          z: lampZ,
          // il braccio del lampione punta verso la carreggiata
          yaw: Math.atan2(tz * side, -tx * side),
        });
        sinceLamp = 0;
      }
    }
  });

  for (const control of osm.controls ?? []) {
    const road = roadAt(osm, control);
    if (!road) continue;
    if (control.kind === 'stop') {
      pushStopLine(markings, control, road.tx, road.tz, road.width, road.lift + 0.011, markingColor, heights);
    } else {
      for (const triangle of giveWayTriangles(control, road.tx, road.tz, road.width)) {
        pushTriangle(markings, triangle, road.lift + 0.011, markingColor, heights);
      }
    }
  }
  for (const crossing of osm.crossings ?? []) {
    const road = roadAt(osm, crossing);
    if (road) pushZebra(markings, crossing, road.tx, road.tz, road.width, road.lift + 0.011, markingColor, heights);
  }

  // un tile ogni ~3 m: le UV dei nastri scorrono già in metri (6 m per tile)
  const asphaltPbr = pbr(renderer, 'asphalt', { repeat: 2, normal: true, rough: true });
  const dirtPbr = pbr(renderer, 'gravel', { repeat: 2, normal: true, rough: true });
  // La ghiaia del kit è marrone scuro: sulla spalla leggeva come una striscia
  // di fango. La grana dell'asfalto, schiarita dal vertex color, dà il grigio
  // sabbia di una banchina consumata.
  const shoulderPbr = pbr(renderer, 'asphalt', { repeat: 2, normal: true, rough: true });
  if (kitAsphaltMat) {
    kitAsphaltMat.vertexColors = true;
    kitAsphaltMat.side = THREE.DoubleSide;
    // l'asfalto del kit è fotografato scuro: alzato di un filo legge come
    // asfalto consumato e non come pece nera, soprattutto con il sole basso
    kitAsphaltMat.color.setRGB(1.4, 1.4, 1.4);
    kitAsphaltMat.envMapIntensity = 0.55;
    kitAsphaltMat.polygonOffset = true;
    kitAsphaltMat.polygonOffsetFactor = -2;
    kitAsphaltMat.polygonOffsetUnits = -2;
    kitAsphaltMat.normalScale = new THREE.Vector2(0.85, 0.85);
    kitAsphaltMat.needsUpdate = true;
  }
  const asphaltMat = kitAsphaltMat ?? new THREE.MeshStandardMaterial({
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
  if (!kitAsphaltMat) applyRoadWear(asphaltMat);
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
  // spalla in ghiaia: stessa grana dello sterrato, tinta sabbia compatta
  const shoulderMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    vertexColors: true,
    ...shoulderPbr,
    normalScale: new THREE.Vector2(0.45, 0.45),
    roughness: 1,
    metalness: 0,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -3,
    polygonOffsetUnits: -3,
  });
  // marciapiedi e cordoli in cemento: tinta quasi bianca, colore dalla texture
  const concretePbr = pbr(renderer, 'concrete', { repeat: 2, normal: true, rough: true });
  const fallbackPavement = (): THREE.MeshStandardMaterial =>
    new THREE.MeshStandardMaterial({
      vertexColors: true,
      color: 0xb6b1a6,
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
  const pavementMat = kitWalkMat ?? fallbackPavement();
  const kerbMat = kitKerbMat ?? fallbackPavement();
  if (kitWalkMat) {
    kitWalkMat.vertexColors = true;
    kitWalkMat.side = THREE.DoubleSide;
    kitWalkMat.polygonOffset = true;
    kitWalkMat.polygonOffsetFactor = -3;
    kitWalkMat.polygonOffsetUnits = -3;
    kitWalkMat.needsUpdate = true;
  }
  if (kitKerbMat) {
    kitKerbMat.vertexColors = true;
    kitKerbMat.side = THREE.DoubleSide;
    kitKerbMat.polygonOffset = true;
    kitKerbMat.polygonOffsetFactor = -3;
    kitKerbMat.polygonOffsetUnits = -3;
    kitKerbMat.needsUpdate = true;
  }

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
  if (shoulder.indices.length) {
    const mesh = new THREE.Mesh(toGeometry(shoulder), shoulderMat);
    mesh.name = 'road-shoulders';
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  if (verges.indices.length) {
    const material = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      vertexColors: true,
      roughness: 1,
      metalness: 0,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(toGeometry(verges), material);
    mesh.name = 'rural-road-banks';
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  if (tunnelLiners.indices.length) {
    const material = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      vertexColors: true,
      roughness: 0.96,
      metalness: 0,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(toGeometry(tunnelLiners), material);
    mesh.name = 'tunnel-interiors';
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  if (walkway.indices.length) {
    const mesh = new THREE.Mesh(toGeometry(walkway), pavementMat);
    mesh.name = 'sidewalks';
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  if (kerb.indices.length) {
    const mesh = new THREE.Mesh(toGeometry(kerb), kerbMat);
    mesh.name = 'curbs';
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
    applyPaintWear(markingMat);
    const mesh = new THREE.Mesh(toGeometry(markings), markingMat);
    mesh.name = 'road-markings';
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  const mappedLamps = osm.streetLamps?.map((lamp) => ({
    ...lamp,
    yaw: streetLampYaw(lamp, osm),
  }));
  return { group, lamps: mappedLamps?.length ? mappedLamps : lamps };
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
    const waterLevel = medianWaterLevel(area.points.map((p) => heights.heightAt(p.x, p.z)));
    const shape = new THREE.Shape(area.points.map((p) => new THREE.Vector2(p.x, -p.z)));
    const g = new THREE.ShapeGeometry(shape);
    g.rotateX(-Math.PI / 2);
    g.translate(0, waterLevel + 0.12, 0);
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

#!/usr/bin/env node
/** Analisi una tantum per scegliere le pose fisse del banco prova. */
import { readFileSync } from 'node:fs';

const j = JSON.parse(readFileSync(new URL('../public/geo/osm.json', import.meta.url)));
const meta = JSON.parse(readFileSync(new URL('../public/geo/heights.json', import.meta.url)));
const bin = readFileSync(new URL('../public/geo/heights.bin', import.meta.url));
const data = new Int16Array(bin.buffer, bin.byteOffset, bin.byteLength / 2);

const BBOX = { latMin: 41.815, latMax: 41.925, lonMin: 14.69, lonMax: 14.86 };
const CENTER_LAT = (BBOX.latMin + BBOX.latMax) / 2;
const CENTER_LON = (BBOX.lonMin + BBOX.lonMax) / 2;
const rad = Math.PI / 180;
const MPLAT = 111132.92 - 559.82 * Math.cos(2 * CENTER_LAT * rad) + 1.175 * Math.cos(4 * CENTER_LAT * rad) - 0.0023 * Math.cos(6 * CENTER_LAT * rad);
const MPLON = 111412.84 * Math.cos(CENTER_LAT * rad) - 93.5 * Math.cos(3 * CENTER_LAT * rad) + 0.118 * Math.cos(5 * CENTER_LAT * rad);
const toWorld = (lat, lon) => ({ x: (lon - CENTER_LON) * MPLON, z: -(lat - CENTER_LAT) * MPLAT });
const START = toWorld(41.8905, 14.7854);
const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

const { nx, nz, originX, originZ, step } = meta;
function heightAt(x, z) {
  const fx = Math.max(0, Math.min(nx - 1e-9, (x - originX) / step));
  const fz = Math.max(0, Math.min(nz - 1e-9, (z - originZ) / step));
  const ix = Math.floor(fx), iz = Math.floor(fz);
  const tx = fx - ix, tz = fz - iz;
  const ix1 = Math.min(nx - 1, ix + 1), iz1 = Math.min(nz - 1, iz + 1);
  const a = data[iz * nx + ix] / 10, b = data[iz * nx + ix1] / 10;
  const c = data[iz1 * nx + ix] / 10, d = data[iz1 * nx + ix1] / 10;
  return (a * (1 - tx) + b * tx) * (1 - tz) + (c * (1 - tx) + d * tx) * tz;
}
function slopeAt(x, z) {
  const e = 2;
  const dx = heightAt(x + e, z) - heightAt(x - e, z);
  const dz = heightAt(x, z + e) - heightAt(x, z - e);
  return (Math.atan(Math.hypot(dx, dz) / (2 * e)) * 180) / Math.PI;
}

// --- indice spaziale semplice per strade e case -----------------------------
const CELL = 50;
const grid = new Map();
const key = (cx, cz) => cx * 100000 + cz;
function gridAdd(x, z, item) {
  const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL);
  const k = key(cx, cz);
  let list = grid.get(k);
  if (!list) { list = []; grid.set(k, list); }
  list.push(item);
}
const roadSegs = [];
for (const r of j.roads) {
  const pts = r.c.map(([lat, lon]) => toWorld(lat, lon));
  const half = ({ motorway: 4.5, trunk: 4.25, primary: 4, secondary: 3.5, tertiary: 3.1, unclassified: 2.7, residential: 2.6, living_street: 2.3, service: 1.8, track: 1.5, road: 2.25, pedestrian: 2.25, footway: 0.8, path: 0.7, cycleway: 1, bridleway: 0.9 }[r.t] ?? 2.25);
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const seg = { a, b, half };
    roadSegs.push(seg);
    gridAdd((a.x + b.x) / 2, (a.z + b.z) / 2, { kind: 'road', seg });
  }
}
const buildingPolys = j.buildings.map((b) => b.c.map(([lat, lon]) => toWorld(lat, lon)));
for (const poly of buildingPolys) {
  const cx = poly.reduce((s, p) => s + p.x, 0) / poly.length;
  const cz = poly.reduce((s, p) => s + p.z, 0) / poly.length;
  gridAdd(cx, cz, { kind: 'building', poly, cx, cz });
}

function segDist(px, pz, a, b) {
  const dx = b.x - a.x, dz = b.z - a.z;
  const len2 = dx * dx + dz * dz;
  let t = len2 > 0 ? ((px - a.x) * dx + (pz - a.z) * dz) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (a.x + t * dx), pz - (a.z + t * dz));
}
function ringDist(px, pz, poly) {
  let min = Infinity;
  for (let i = 0; i < poly.length; i++) {
    min = Math.min(min, segDist(px, pz, poly[i], poly[(i + 1) % poly.length]));
  }
  return min;
}
function clearance(x, z) {
  const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL);
  let road = Infinity, building = Infinity;
  for (let ix = cx - 2; ix <= cx + 2; ix++) {
    for (let iz = cz - 2; iz <= cz + 2; iz++) {
      const list = grid.get(key(ix, iz));
      if (!list) continue;
      for (const item of list) {
        if (item.kind === 'road') {
          road = Math.min(road, segDist(x, z, item.seg.a, item.seg.b) - item.seg.half);
        } else {
          building = Math.min(building, ringDist(x, z, item.poly));
        }
      }
    }
  }
  return { road, building };
}
function isOnRoad(x, z, tol = 1.6) {
  const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL);
  for (let ix = cx - 2; ix <= cx + 2; ix++) {
    for (let iz = cz - 2; iz <= cz + 2; iz++) {
      const list = grid.get(key(ix, iz));
      if (!list) continue;
      for (const item of list) {
        if (item.kind === 'road' && segDist(x, z, item.seg.a, item.seg.b) <= item.seg.half + tol) return true;
      }
    }
  }
  return false;
}
function hitsBuilding(x, z, r = 1.6) {
  const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL);
  for (let ix = cx - 2; ix <= cx + 2; ix++) {
    for (let iz = cz - 2; iz <= cz + 2; iz++) {
      const list = grid.get(key(ix, iz));
      if (!list) continue;
      for (const item of list) {
        if (item.kind === 'building' && ringDist(x, z, item.poly) <= r) return true;
      }
    }
  }
  return false;
}

// --- 1. chiesa: replica di findChurchSpot -----------------------------------
function churchSpot() {
  for (const radius of [34, 42, 52, 64, 78, 92, 108, 128, 150, 175, 205, 240]) {
    for (let i = 0; i < 32; i++) {
      const angle = (i / 32) * Math.PI * 2 + radius * 0.17;
      const x = START.x + Math.cos(angle) * radius;
      const z = START.z + Math.sin(angle) * radius;
      if (slopeAt(x, z) > 14) continue;
      const yaw = Math.atan2(START.x - x, START.z - z);
      let clear = true;
      const cos = Math.cos(yaw), sin = Math.sin(yaw);
      for (let ix = 0; ix < 5 && clear; ix++) {
        for (let iz = 0; iz < 5 && clear; iz++) {
          const lx = (ix / 4 - 0.5) * 2 * 7.4;
          const lz = (iz / 4 - 0.5) * 2 * 10.4;
          const wx = x + lx * cos + lz * sin;
          const wz = z - lx * sin + lz * cos;
          if (isOnRoad(wx, wz, 1.6) || hitsBuilding(wx, wz, 1.6)) clear = false;
        }
      }
      if (clear) return { x, z, yaw };
    }
  }
  return null;
}
const church = churchSpot();
console.log('church spot', church, church ? 'height ' + heightAt(church.x, church.z).toFixed(1) : '');
if (church) {
  const local = (lx, lz) => ({
    x: church.x + lx * Math.cos(church.yaw) + lz * Math.sin(church.yaw),
    z: church.z - lx * Math.sin(church.yaw) + lz * Math.cos(church.yaw),
  });
  for (const lz of [16, 20, 24, 28]) {
    const p = local(0, lz);
    console.log(`piazza cam local z=${lz}`, p, 'clear', clearance(p.x, p.z), 'slope', slopeAt(p.x, p.z).toFixed(1));
  }
}

// --- 2. crinale aperto ------------------------------------------------------
const points = [];
const R0 = 350, R1 = 2000;
for (let a = 0; a < 360; a += 2) {
  const ang = (a / 360) * Math.PI * 2;
  for (let rr = R0; rr <= R1; rr += 25) {
    const x = START.x + Math.cos(ang) * rr;
    const z = START.z + Math.sin(ang) * rr;
    points.push({ x, z, y: heightAt(x, z), rr, ang });
  }
}
let best = [];
for (const p of points) {
  const c = clearance(p.x, p.z);
  if (c.road < 12 || c.building < 35) continue;
  if (slopeAt(p.x, p.z) > 9) continue;
  // prominenza: quanto spicca sul terreno medio a 60 m
  let sum = 0, n = 0;
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * Math.PI * 2;
    sum += heightAt(p.x + Math.cos(a) * 60, p.z + Math.sin(a) * 60); n++;
  }
  const prom = p.y - sum / n;
  if (prom < 1.5) continue;
  best.push({ ...p, prom: +prom.toFixed(2), road: +c.road.toFixed(1), building: +c.building.toFixed(1), slope: +slopeAt(p.x, p.z).toFixed(1) });
}
best.sort((a, b) => b.y - a.y);
console.log('top open hilltops');
for (const b of best.slice(0, 12)) console.log(JSON.stringify({ x: +b.x.toFixed(1), z: +b.z.toFixed(1), y: +b.y.toFixed(1), rr: b.rr, prom: b.prom, road: b.road, building: b.building, slope: b.slope }));

// 3. strada di campagna: ricalcola con il punto esatto e la pendenza
const candidates = [];
for (const r of j.roads) {
  const pts = r.c.map(([lat, lon]) => toWorld(lat, lon));
  if (pts.length < 4) continue;
  if (!['unclassified', 'tertiary', 'secondary', 'primary'].includes(r.t)) continue;
  let b = null;
  for (let i = 0; i < pts.length - 1; i++) {
    const len = dist(pts[i], pts[i + 1]);
    if (!b || len > b.len) b = { p: pts[i], q: pts[i + 1], len, i };
  }
  if (!b || b.len < 25) continue;
  const mid = { x: (b.p.x + b.q.x) / 2, z: (b.p.z + b.q.z) / 2 };
  const d = dist(mid, START);
  if (d < 250 || d > 1300) continue;
  const yaw = Math.atan2(-(b.q.x - b.p.x), -(b.q.z - b.p.z));
  const rx = Math.cos(yaw), rz = -Math.sin(yaw);
  const hc = heightAt(mid.x, mid.z);
  const hr = heightAt(mid.x + rx * 10, mid.z + rz * 10);
  const hl = heightAt(mid.x - rx * 10, mid.z - rz * 10);
  const hf = heightAt(mid.x - Math.sin(yaw) * 40, mid.z - Math.cos(yaw) * 40);
  const hb = heightAt(mid.x + Math.sin(yaw) * 40, mid.z + Math.cos(yaw) * 40);
  candidates.push({ type: r.t, name: r.n ?? '', d: Math.round(d), mid, yaw, lateral: +(hr - hl).toFixed(2), longSlope: +(hf - hb).toFixed(2), elev: +hc.toFixed(1), segLen: +b.len.toFixed(1), clear: clearance(mid.x, mid.z) });
}
candidates.sort((a, b) => Math.abs(b.lateral) - Math.abs(a.lateral));
console.log('top lateral-slope roads');
for (const c of candidates.slice(0, 8)) console.log(JSON.stringify(c));

#!/usr/bin/env node
/**
 * Copertura del suolo per la Fase A del piano realismo.
 *
 * Fonti:
 *  - ESA WorldCover 10 m 2021 v200 (CC BY 4.0) — classi standard:
 *    10 alberi, 20 arbusti, 30 prato, 40 coltivi, 50 costruito, 60 suolo nudo,
 *    70 neve, 80 acqua, 90 zone umide, 95 mangrovie, 100 muschio.
 *  - OpenStreetMap (ODbL 1.0) — le aree OSM hanno bordi più precisi e vincono
 *    su WorldCover dove esistono.
 *  - DEM locale (`heights.bin`) — pendenza per la roccia e per la direzione
 *    dei solchi.
 *
 * Output (NON versionato: è un'opera derivata, si rigenera con questo script):
 *  - public/geo/landcover/<cx>_<cz>.png   456×456 RGBA8, 2 m/px
 *      R = coltivo secco/stoppie, G = prato, B = sottobosco, A = roccia/terra
 *  - public/geo/landcover/base.png         mappa globale a 12 m/px (fallback lontano)
 *  - public/geo/landcover/fields.png       direzione dei solchi + parcella, 12 m/px
 *  - public/geo/landcover/parcels.json     confini di campo a 4 m (muretti nel gioco)
 *  - public/geo/landcover/preview.png      anteprima a colori per il controllo umano
 *  - public/geo/landcover/meta.json        legenda, griglia, statistiche
 *
 *   npm run landcover
 *   npm run landcover -- --force
 *
 * Senza questi file il gioco parte lo stesso: `src/world/terrain.ts` usa il
 * percorso vecchio (erba/roccia) e il shader ha comunque un dettaglio
 * procedurale di riserva.
 */
import { mkdir, writeFile, readFile, access } from 'node:fs/promises';
import path from 'node:path';
import { fromFile } from 'geotiff';
import { PNG } from 'pngjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const GEO_DIR = path.join(ROOT, 'public', 'geo');
const OUT_DIR = path.join(GEO_DIR, 'landcover');
const CACHE_DIR = path.join(ROOT, '.geo-cache', 'worldcover');
const FORCE = process.argv.includes('--force');

// ---------------------------------------------------------------------------
// geodesia — deve restare identica a src/config.ts e scripts/fetch-geodata.mjs
// ---------------------------------------------------------------------------
const BBOX = {
  latMin: 41.815,
  latMax: 41.925,
  lonMin: 14.69,
  lonMax: 14.86,
};
const CENTER_LAT = (BBOX.latMin + BBOX.latMax) / 2;
const CENTER_LON = (BBOX.lonMin + BBOX.lonMax) / 2;
const RAD = Math.PI / 180;
const M_PER_DEG_LAT =
  111132.92 -
  559.82 * Math.cos(2 * CENTER_LAT * RAD) +
  1.175 * Math.cos(4 * CENTER_LAT * RAD) -
  0.0023 * Math.cos(6 * CENTER_LAT * RAD);
const M_PER_DEG_LON =
  111412.84 * Math.cos(CENTER_LAT * RAD) -
  93.5 * Math.cos(3 * CENTER_LAT * RAD) +
  0.118 * Math.cos(5 * CENTER_LAT * RAD);

const WORLD_WIDTH = (BBOX.lonMax - BBOX.lonMin) * M_PER_DEG_LON;
const WORLD_HEIGHT = (BBOX.latMax - BBOX.latMin) * M_PER_DEG_LAT;
const HALF_WIDTH = WORLD_WIDTH / 2;
const HALF_HEIGHT = WORLD_HEIGHT / 2;

const CHUNK_SIZE = 912;
const CHUNK_PIXELS = 456; // 912 / 2 m
const BASE_MPP = 12;

const TILE = 'N39E012';
const TILE_URL =
  `https://esa-worldcover.s3.eu-central-1.amazonaws.com/v200/2021/map/` +
  `ESA_WorldCover_10m_2021_v200_${TILE}_Map.tif`;

const log = (...a) => console.log('[landcover]', ...a);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const smoothstep = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
const hash2 = (x, y, seed = 0) => {
  let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1) ^ Math.imul(seed | 0, 0x9e3779b9);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
};

async function exists(file) {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

function latLonToWorld(lat, lon) {
  return {
    x: (lon - CENTER_LON) * M_PER_DEG_LON,
    z: -(lat - CENTER_LAT) * M_PER_DEG_LAT,
  };
}

function worldToLatLon(x, z) {
  return {
    lat: CENTER_LAT - z / M_PER_DEG_LAT,
    lon: CENTER_LON + x / M_PER_DEG_LON,
  };
}

/** Bilineare su un canale di un array con passo `stride` (0..255). */
function sampleChannel(arr, w, h, x, y, channel, stride) {
  const fx = clamp(x, 0, w - 1.0001);
  const fy = clamp(y, 0, h - 1.0001);
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const x1 = Math.min(x0 + 1, w - 1);
  const y1 = Math.min(y0 + 1, h - 1);
  const tx = fx - x0;
  const ty = fy - y0;
  const a = arr[(y0 * w + x0) * stride + channel];
  const b = arr[(y0 * w + x1) * stride + channel];
  const c = arr[(y1 * w + x0) * stride + channel];
  const d = arr[(y1 * w + x1) * stride + channel];
  return lerp(lerp(a, b, tx), lerp(c, d, tx), ty) / 255;
}

function sampleRoadDistance(arr, w, h, x, y) {
  return sampleChannel(arr, w, h, x, y, 0, 1) * 8; // 0..8 m
}

// ---------------------------------------------------------------------------
// WorldCover
// ---------------------------------------------------------------------------
const WC_WEIGHTS = {
  10: [0, 0, 1, 0],
  20: [0, 0.25, 0.75, 0],
  30: [0, 1, 0, 0],
  40: [1, 0, 0, 0],
  50: [0.15, 0.15, 0, 0.7],
  60: [0, 0, 0, 1],
  70: [0, 0, 0, 0],
  80: [0, 0, 0, 0],
  90: [0, 0.7, 0.2, 0.1],
  95: [0, 0, 1, 0],
  100: [0, 1, 0, 0],
};
const WC_STRENGTH = { 10: 1, 20: 1, 30: 1, 40: 1, 50: 0.35, 60: 1, 70: 0, 80: 0, 90: 0.8, 95: 1, 100: 1 };

function normalized(weights, strength) {
  const sum = weights[0] + weights[1] + weights[2] + weights[3];
  if (sum <= 0.0001 || strength <= 0) return [0, 0, 0, 0];
  return weights.map((v) => (v / sum) * strength);
}

async function ensureWorldCover() {
  const name = `ESA_WorldCover_10m_2021_v200_${TILE}_Map.tif`;
  const file = path.join(CACHE_DIR, name);
  if (!FORCE && (await exists(file))) {
    log(`WorldCover già in cache: ${path.relative(ROOT, file)}`);
    return file;
  }
  await mkdir(CACHE_DIR, { recursive: true });
  log(`scarico ${name} (~41 MB)…`);
  const res = await fetch(TILE_URL);
  if (!res.ok) throw new Error(`WorldCover: HTTP ${res.status} ${res.statusText}`);
  const buf = Buffer.from(await res.arrayBuffer());
  await writeFile(file, buf);
  log(`salvato ${(buf.length / 1e6).toFixed(1)} MB`);
  return file;
}

async function readWorldCover(file) {
  const tiff = await fromFile(file);
  const image = await tiff.getImage();
  const [lon0, lat0, lon1, lat1] = image.getBoundingBox();
  const [rx, ry] = image.getResolution();
  const resX = Math.abs(rx);
  const resY = Math.abs(ry);
  if (!(lon1 > BBOX.lonMin && lon0 < BBOX.lonMax && lat1 > BBOX.latMin && lat0 < BBOX.latMax)) {
    throw new Error(`il riquadro ${TILE} non copre il bbox del gioco`);
  }
  const x0 = Math.floor((BBOX.lonMin - lon0) / resX);
  const x1 = Math.ceil((BBOX.lonMax - lon0) / resX);
  const y0 = Math.floor((lat1 - BBOX.latMax) / resY);
  const y1 = Math.ceil((lat1 - BBOX.latMin) / resY);
  log(`finestra WorldCover ${x1 - x0}×${y1 - y0} px (10 m/px)`);
  const rasters = await image.readRasters({ window: [x0, y0, x1, y1], samples: [0] });
  return {
    data: rasters[0],
    width: rasters.width,
    height: rasters.height,
    lon0,
    lat1,
    resX,
    resY,
    x0,
    y0,
  };
}

function buildWorldCoverGrid(wc, heights) {
  const { nx, nz, originX, originZ, step } = heights;
  const classes = new Uint8Array(nx * nz);
  for (let j = 0; j < nz; j++) {
    const z = originZ + j * step;
    for (let i = 0; i < nx; i++) {
      const x = originX + i * step;
      const { lat, lon } = worldToLatLon(x, z);
      const px = Math.round((lon - wc.lon0) / wc.resX - wc.x0);
      const py = Math.round((wc.lat1 - lat) / wc.resY - wc.y0);
      classes[j * nx + i] = wc.data[clamp(py, 0, wc.height - 1) * wc.width + clamp(px, 0, wc.width - 1)];
    }
  }
  return classes;
}

function buildWorldCoverWeights(classes) {
  const weights = new Uint8Array(classes.length * 4);
  for (let i = 0; i < classes.length; i++) {
    const cls = classes[i];
    const w = normalized(WC_WEIGHTS[cls] ?? [0, 1, 0, 0], WC_STRENGTH[cls] ?? 1);
    const k = i * 4;
    weights[k] = Math.round(w[0] * 255);
    weights[k + 1] = Math.round(w[1] * 255);
    weights[k + 2] = Math.round(w[2] * 255);
    weights[k + 3] = Math.round(w[3] * 255);
  }
  return weights;
}

// ---------------------------------------------------------------------------
// pendenza dal DEM
// ---------------------------------------------------------------------------
async function buildSlope(heights) {
  const { nx, nz, originX, originZ, step } = heights;
  const buf = await readFile(path.join(GEO_DIR, 'heights.bin'));
  const dm = new Int16Array(buf.buffer, buf.byteOffset, buf.length >> 1);
  const slope = new Uint8Array(nx * nz);
  const h = (ix, iz) => dm[clamp(iz, 0, nz - 1) * nx + clamp(ix, 0, nx - 1)] / 10;
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const gx = (h(i + 1, j) - h(i - 1, j)) / (2 * step);
      const gz = (h(i, j + 1) - h(i, j - 1)) / (2 * step);
      const deg = (Math.atan(Math.hypot(gx, gz)) * 180) / Math.PI;
      slope[j * nx + i] = Math.round(clamp(deg, 0, 90));
    }
  }
  return slope;
}

// ---------------------------------------------------------------------------
// OSM: classi delle aree e distanza dalle strade
// ---------------------------------------------------------------------------
const AREA_CLASS = {
  wood: 1,
  forest: 1,
  park: 1,
  scrub: 2,
  meadow: 3,
  grassland: 3,
  pitch: 3,
  orchard: 4,
  vineyard: 4,
  farmyard: 5,
  industrial: 5,
  quarry: 5,
  residential: 6,
  water: 7,
};

const OSM_WEIGHTS = {
  1: { w: [0, 0, 1, 0], s: 1 },
  2: { w: [0, 0.3, 0.7, 0], s: 1 },
  3: { w: [0, 1, 0, 0], s: 1 },
  4: { w: [0.35, 0.65, 0, 0], s: 1 },
  5: { w: [0.2, 0.1, 0, 0.7], s: 0.5 },
  6: { w: [0.15, 0.25, 0, 0.6], s: 0.3 },
  7: { w: [0, 0, 0, 0], s: 0 },
};

function rasterizePolygon(grid, nx, nz, originX, originZ, cell, points, value) {
  let zMin = Infinity;
  let zMax = -Infinity;
  for (const p of points) {
    if (p.z < zMin) zMin = p.z;
    if (p.z > zMax) zMax = p.z;
  }
  const j0 = Math.max(0, Math.floor((zMin - originZ) / cell));
  const j1 = Math.min(nz - 1, Math.floor((zMax - originZ) / cell));
  const xs = [];
  for (let j = j0; j <= j1; j++) {
    const z = originZ + (j + 0.5) * cell;
    xs.length = 0;
    for (let k = 0, l = points.length - 1; k < points.length; l = k++) {
      const a = points[l];
      const b = points[k];
      if ((a.z <= z && b.z > z) || (b.z <= z && a.z > z)) {
        const t = (z - a.z) / (b.z - a.z);
        xs.push(a.x + (b.x - a.x) * t);
      }
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const i0 = Math.max(0, Math.ceil((xs[k] - originX) / cell - 0.5));
      const i1 = Math.min(nx - 1, Math.floor((xs[k + 1] - originX) / cell - 0.5));
      for (let i = i0; i <= i1; i++) grid[j * nx + i] = value;
    }
  }
}

function segmentDistance(px, pz, ax, az, bx, bz) {
  const dx = bx - ax;
  const dz = bz - az;
  const len2 = dx * dx + dz * dz;
  let t = len2 > 1e-9 ? ((px - ax) * dx + (pz - az) * dz) / len2 : 0;
  t = clamp(t, 0, 1);
  return Math.hypot(px - (ax + dx * t), pz - (az + dz * t));
}

function buildOsmRasters(osm, nx, nz, originX, originZ, cell) {
  const classes = new Uint8Array(nx * nz);
  const areas = [];
  for (const a of osm.areas) {
    const cls = AREA_CLASS[a.k];
    if (!cls) continue;
    const points = a.c.map(([lat, lon]) => latLonToWorld(lat, lon));
    areas.push({ cls, points });
  }
  areas.sort((a, b) => a.cls - b.cls);
  for (const a of areas) rasterizePolygon(classes, nx, nz, originX, originZ, cell, a.points, a.cls);

  const distance = new Uint8Array(nx * nz).fill(255);
  for (const road of osm.roads) {
    for (let k = 0; k + 1 < road.c.length; k++) {
      const a = latLonToWorld(road.c[k][0], road.c[k][1]);
      const b = latLonToWorld(road.c[k + 1][0], road.c[k + 1][1]);
      const minX = Math.min(a.x, b.x) - 8;
      const maxX = Math.max(a.x, b.x) + 8;
      const minZ = Math.min(a.z, b.z) - 8;
      const maxZ = Math.max(a.z, b.z) + 8;
      const i0 = Math.max(0, Math.floor((minX - originX) / cell));
      const i1 = Math.min(nx - 1, Math.floor((maxX - originX) / cell));
      const j0 = Math.max(0, Math.floor((minZ - originZ) / cell));
      const j1 = Math.min(nz - 1, Math.floor((maxZ - originZ) / cell));
      for (let j = j0; j <= j1; j++) {
        const z = originZ + (j + 0.5) * cell;
        for (let i = i0; i <= i1; i++) {
          const x = originX + (i + 0.5) * cell;
          const d = segmentDistance(x, z, a.x, a.z, b.x, b.z);
          if (d >= 8) continue;
          const q = Math.round((d / 8) * 255);
          const idx = j * nx + i;
          if (q < distance[idx]) distance[idx] = q;
        }
      }
    }
  }
  return { classes, distance };
}

// ---------------------------------------------------------------------------
// fusione a 4 m/px: WorldCover + OSM + pendenza + strade
// ---------------------------------------------------------------------------
function buildWorldWeights(heights, wcWeights, slope, osmClasses, roadDistance, nx, nz, originX, originZ, cell) {
  const weights = new Uint8Array(nx * nz * 4);
  const h = heights;
  const sx = 1 / cell;
  for (let j = 0; j < nz; j++) {
    const z = originZ + (j + 0.5) * cell;
    const hz = (z - h.originZ) / h.step;
    for (let i = 0; i < nx; i++) {
      const x = originX + (i + 0.5) * cell;
      const hx = (x - h.originX) / h.step;

      let r = sampleChannel(wcWeights, h.nx, h.nz, hx, hz, 0, 4);
      let g = sampleChannel(wcWeights, h.nx, h.nz, hx, hz, 1, 4);
      let b = sampleChannel(wcWeights, h.nx, h.nz, hx, hz, 2, 4);
      let a = sampleChannel(wcWeights, h.nx, h.nz, hx, hz, 3, 4);
      let sum = r + g + b + a;
      let strength = sum;
      if (sum > 0.0001) {
        r /= sum;
        g /= sum;
        b /= sum;
        a /= sum;
      } else {
        r = 0;
        g = 1;
        b = 0;
        a = 0;
      }

      const cls = osmClasses[j * nx + i];
      if (cls) {
        const o = OSM_WEIGHTS[cls];
        const t = cls === 7 ? 1 : 0.92;
        r = lerp(r, o.w[0], t);
        g = lerp(g, o.w[1], t);
        b = lerp(b, o.w[2], t);
        a = lerp(a, o.w[3], t);
        strength = lerp(strength, o.s, t);
      }

      const deg = sampleChannel(slope, h.nx, h.nz, hx, hz, 0, 1) * 90;
      const rock = smoothstep(18, 36, deg);
      if (rock > 0.001) {
        r = lerp(r, 0, rock * 0.8);
        g = lerp(g, 0, rock * 0.8);
        b = lerp(b, 0, rock * 0.8);
        a = lerp(a, 1, rock * 0.8);
        strength = Math.max(strength, rock * 0.9);
      }

      const dist = sampleRoadDistance(
        roadDistance,
        nx,
        nz,
        (x - originX) / cell - 0.5,
        (z - originZ) / cell - 0.5,
      );
      const shoulder = 1 - smoothstep(1.6, 4.2, dist);
      if (shoulder > 0.001) {
        const k = shoulder * 0.55;
        r = lerp(r, 0.14, k);
        g = lerp(g, 0.1, k);
        b = lerp(b, 0.07, k);
        a = lerp(a, 0.7, k);
        strength = Math.max(strength, shoulder * 0.7);
      }

      const norm = r + g + b + a;
      if (norm > 0.0001) {
        r /= norm;
        g /= norm;
        b /= norm;
        a /= norm;
      }
      const k = (j * nx + i) * 4;
      weights[k] = Math.round(clamp(r * strength, 0, 1) * 255);
      weights[k + 1] = Math.round(clamp(g * strength, 0, 1) * 255);
      weights[k + 2] = Math.round(clamp(b * strength, 0, 1) * 255);
      weights[k + 3] = Math.round(clamp(a * strength, 0, 1) * 255);
    }
  }
  return weights;
}

function sampleWorldWeights(weights, nx, nz, originX, originZ, cell, x, z, out, k) {
  const fx = (x - originX) / cell - 0.5;
  const fz = (z - originZ) / cell - 0.5;
  out[k] = sampleChannel(weights, nx, nz, fx, fz, 0, 4);
  out[k + 1] = sampleChannel(weights, nx, nz, fx, fz, 1, 4);
  out[k + 2] = sampleChannel(weights, nx, nz, fx, fz, 2, 4);
  out[k + 3] = sampleChannel(weights, nx, nz, fx, fz, 3, 4);
}

// ---------------------------------------------------------------------------
// parcellizzazione dei campi (direzione dei solchi)
// ---------------------------------------------------------------------------
const FIELD_CELL = 190;

function buildFieldSeeds(heightGrid, slope, nx, nz, originX, originZ, step) {
  const cols = Math.ceil(WORLD_WIDTH / FIELD_CELL);
  const rows = Math.ceil(WORLD_HEIGHT / FIELD_CELL);
  const seeds = new Array(cols * rows);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = -HALF_WIDTH + (c + 0.5 + (hash2(c, r, 1) - 0.5) * 0.76) * FIELD_CELL;
      const z = -HALF_HEIGHT + (r + 0.5 + (hash2(c, r, 2) - 0.5) * 0.76) * FIELD_CELL;
      const hx = (x - originX) / step;
      const hz = (z - originZ) / step;
      const deg = sampleChannel(slope, nx, nz, hx, hz, 0, 1) * 90;
      const hAt = (ix, iz) => heightGrid[clamp(iz, 0, nz - 1) * nx + clamp(ix, 0, nx - 1)] / 10;
      const gx = (hAt(Math.floor(hx) + 1, Math.floor(hz)) - hAt(Math.floor(hx) - 1, Math.floor(hz))) / (2 * step);
      const gz = (hAt(Math.floor(hx), Math.floor(hz) + 1) - hAt(Math.floor(hx), Math.floor(hz) - 1)) / (2 * step);
      let angle = hash2(c, r, 3) * Math.PI * 2;
      if (deg > 4 && hash2(c, r, 4) < 0.7) {
        // solchi di contorno: perpendicolari alla massima pendenza
        angle = Math.atan2(gx, -gz) + (hash2(c, r, 5) - 0.5) * 0.6;
      }
      const plough = hash2(c, r, 6) < 0.55 ? 1 : 0.15;
      seeds[r * cols + c] = { x, z, angle, plough };
    }
  }
  return { seeds, cols, rows };
}

function nearestSeed(fields, x, z) {
  const c = Math.floor((x + HALF_WIDTH) / FIELD_CELL);
  const r = Math.floor((z + HALF_HEIGHT) / FIELD_CELL);
  let best = null;
  let bestD = Infinity;
  for (let rr = r - 1; rr <= r + 1; rr++) {
    if (rr < 0 || rr >= fields.rows) continue;
    for (let cc = c - 1; cc <= c + 1; cc++) {
      if (cc < 0 || cc >= fields.cols) continue;
      const s = fields.seeds[rr * fields.cols + cc];
      if (!s) continue;
      const d = (s.x - x) * (s.x - x) + (s.z - z) * (s.z - z);
      if (d < bestD) {
        bestD = d;
        best = s;
      }
    }
  }
  return best;
}

function fieldStrengthAt(osmClasses, nx4, nz4, originX4, originZ4, cell, wcClassAt, x, z) {
  const i = clamp(Math.floor((x - originX4) / cell), 0, nx4 - 1);
  const j = clamp(Math.floor((z - originZ4) / cell), 0, nz4 - 1);
  const cls = osmClasses[j * nx4 + i];
  if (cls === 4) return 1; // uliveto/vigneto
  if (cls === 3) return 0.35; // prato/piazza
  if (cls) return 0; // bosco, arbusti, costruito, acqua
  const wc = wcClassAt(x, z);
  if (wc === 40) return 1;
  if (wc === 30) return 0.3;
  if (wc === 20) return 0.15;
  return 0;
}

function buildFieldTexture(fields, heights, slope, wcClasses, osmClasses, nx4, nz4, originX4, originZ4, cell, width, height) {
  const png = new PNG({ width, height });
  const { nx, nz, originX, originZ } = heights;
  const wcAt = (x, z) => {
    const hx = clamp(Math.floor((x - originX) / heights.step), 0, nx - 1);
    const hz = clamp(Math.floor((z - originZ) / heights.step), 0, nz - 1);
    return wcClasses[hz * nx + hx];
  };
  for (let j = 0; j < height; j++) {
    const z = -HALF_HEIGHT + (j + 0.5) * (WORLD_HEIGHT / height);
    for (let i = 0; i < width; i++) {
      const x = -HALF_WIDTH + (i + 0.5) * (WORLD_WIDTH / width);
      const k = (j * width + i) * 4;
      const strength = fieldStrengthAt(osmClasses, nx4, nz4, originX4, originZ4, cell, wcAt, x, z);
      const seed = nearestSeed(fields, x, z);
      if (!seed) {
        png.data[k] = 128;
        png.data[k + 1] = 255;
        png.data[k + 2] = 0;
        png.data[k + 3] = 0;
        continue;
      }
      png.data[k] = Math.round((Math.cos(seed.angle) * 0.5 + 0.5) * 255);
      png.data[k + 1] = Math.round((Math.sin(seed.angle) * 0.5 + 0.5) * 255);
      png.data[k + 2] = Math.round(seed.plough * 255);
      png.data[k + 3] = Math.round(strength * 255);
    }
  }
  return png;
}

// ---------------------------------------------------------------------------
// PNG dei chunk
// ---------------------------------------------------------------------------
async function writeChunk(cx, cz, weights, nx4, nz4, originX4, originZ4, cell) {
  const size = CHUNK_PIXELS;
  const halo = 2;
  const rawSize = size + halo * 2;
  const raw = new Float32Array(rawSize * rawSize * 4);
  const x0 = cx * CHUNK_SIZE;
  const z0 = cz * CHUNK_SIZE;
  for (let j = -halo; j < size + halo; j++) {
    const z = z0 + (j + 0.5) * 2;
    for (let i = -halo; i < size + halo; i++) {
      const x = x0 + (i + 0.5) * 2;
      const k = ((j + halo) * rawSize + (i + halo)) * 4;
      sampleWorldWeights(weights, nx4, nz4, originX4, originZ4, cell, x, z, raw, k);
    }
  }

  const png = new PNG({ width: size, height: size });
  const w = [1, 2, 1];
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const k = (j * size + i) * 4;
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let dj = -1; dj <= 1; dj++) {
        for (let di = -1; di <= 1; di++) {
          const wt = w[dj + 1] * w[di + 1];
          const q = (((j + halo + dj) * rawSize + (i + halo + di)) * 4);
          r += raw[q] * wt;
          g += raw[q + 1] * wt;
          b += raw[q + 2] * wt;
          a += raw[q + 3] * wt;
        }
      }
      const r0 = r / 16;
      const g0 = g / 16;
      const b0 = b / 16;
      const a0 = a / 16;
      const sum = r0 + g0 + b0 + a0;
      if (sum > 0.0001) {
        // stesso formato di base.png: RGB = pesi normalizzati, A = valido,
        // roccia = 1 - (R+G+B). Serve perché Canvas2D azzera l'RGB con alfa=0.
        png.data[k] = Math.round(clamp(r0 / sum, 0, 1) * 255);
        png.data[k + 1] = Math.round(clamp(g0 / sum, 0, 1) * 255);
        png.data[k + 2] = Math.round(clamp(b0 / sum, 0, 1) * 255);
        png.data[k + 3] = 255;
      } else {
        png.data[k] = 0;
        png.data[k + 1] = 0;
        png.data[k + 2] = 0;
        png.data[k + 3] = 0;
      }
    }
  }
  const file = path.join(OUT_DIR, `${cx}_${cz}.png`);
  await writeFile(file, PNG.sync.write(png, { colorType: 6 }));
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------
async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  const heights = JSON.parse(await readFile(path.join(GEO_DIR, 'heights.json'), 'utf8'));
  const osm = JSON.parse(await readFile(path.join(GEO_DIR, 'osm.json'), 'utf8'));

  const tile = await ensureWorldCover();
  const wc = await readWorldCover(tile);
  const wcClasses = buildWorldCoverGrid(wc, heights);
  const wcWeights = buildWorldCoverWeights(wcClasses);
  log('griglia WorldCover 10 m pronta');

  const slope = await buildSlope(heights);
  log('pendenza DEM pronta');

  const CELL4 = 4;
  const nx4 = Math.ceil(WORLD_WIDTH / CELL4);
  const nz4 = Math.ceil(WORLD_HEIGHT / CELL4);
  const originX4 = -HALF_WIDTH;
  const originZ4 = -HALF_HEIGHT;
  const osmRasters = buildOsmRasters(osm, nx4, nz4, originX4, originZ4, CELL4);
  log(`OSM rasterizzato a ${CELL4} m/px (${nx4}×${nz4})`);

  const weights = buildWorldWeights(
    heights,
    wcWeights,
    slope,
    osmRasters.classes,
    osmRasters.distance,
    nx4,
    nz4,
    originX4,
    originZ4,
    CELL4,
  );
  log('fusione WorldCover + OSM + pendenza + strade pronta');

  // mappa globale di riserva (12 m/px)
  const baseW = Math.ceil(WORLD_WIDTH / BASE_MPP);
  const baseH = Math.ceil(WORLD_HEIGHT / BASE_MPP);
  const base = new PNG({ width: baseW, height: baseH });
  const tmp = [0, 0, 0, 0];
  for (let j = 0; j < baseH; j++) {
    const z = -HALF_HEIGHT + (j + 0.5) * BASE_MPP;
    for (let i = 0; i < baseW; i++) {
      const k = (j * baseW + i) * 4;
      const x = -HALF_WIDTH + (i + 0.5) * BASE_MPP;
      // `sampleWorldWeights` restituisce 0..1. Il PNG non può portare quattro
      // pesi in RGBA: Canvas2D premoltiplica l'alfa e butta via l'RGB dove
      // alfa=0. Quindi A diventa un flag di validità (255) e la roccia è il
      // resto normalizzato 1 - (R+G+B). Fuori copertura resta A=0, RGB=0.
      sampleWorldWeights(weights, nx4, nz4, originX4, originZ4, CELL4, x, z, tmp, 0);
      const sum = tmp[0] + tmp[1] + tmp[2] + tmp[3];
      if (sum > 0.0001) {
        base.data[k] = Math.round(clamp(tmp[0] / sum, 0, 1) * 255);
        base.data[k + 1] = Math.round(clamp(tmp[1] / sum, 0, 1) * 255);
        base.data[k + 2] = Math.round(clamp(tmp[2] / sum, 0, 1) * 255);
        base.data[k + 3] = 255;
      } else {
        base.data[k] = 0;
        base.data[k + 1] = 0;
        base.data[k + 2] = 0;
        base.data[k + 3] = 0;
      }
    }
  }
  await writeFile(path.join(OUT_DIR, 'base.png'), PNG.sync.write(base, { colorType: 6 }));
  log(`base.png ${baseW}×${baseH}`);

  // direzione dei solchi
  const heightBuf = await readFile(path.join(GEO_DIR, 'heights.bin'));
  const heightDm = new Int16Array(heightBuf.buffer, heightBuf.byteOffset, heightBuf.length >> 1);
  const fields = buildFieldSeeds(heightDm, slope, heights.nx, heights.nz, heights.originX, heights.originZ, heights.step);
  const fieldPng = buildFieldTexture(
    fields,
    heights,
    slope,
    wcClasses,
    osmRasters.classes,
    nx4,
    nz4,
    originX4,
    originZ4,
    CELL4,
    baseW,
    baseH,
  );
  await writeFile(path.join(OUT_DIR, 'fields.png'), PNG.sync.write(fieldPng, { colorType: 6 }));
  log(`fields.png ${baseW}×${baseH}`);

  // ---------------------------------------------------------------------
  // confini di campo → parcels.json
  //
  // Dove la classe di copertura cambia tra due celle della griglia fusa
  // (4 m/px) e il salto è netto, c'è un confine dappezzamento: nei poligoni
  // OSM il confine lo segna OSM, fuori dai poligoni lo segnala solo
  // WorldCover. Il gioco ci piazza i muretti (src/world/field-boundaries.ts).
  //
  // Due filtri a monte: niente confini entro 5,5 m dalle strade (ci pensano
  // i muretti di strada di dry-stone.ts) né dentro i centri abitati; un
  // assottigliamento deterministico per classe tiene il numero di segmenti
  // sotto il cap di istanze del gioco, con copertura uniforme invece di
  // tagliare la scansione a un angolo della mappa.
  // ---------------------------------------------------------------------
  // Assottigliamento per blocchi di 64 m, non per segmento: il muro si
  // tiene per tratti continui (la scelta è «questo pezzo di confine sì,
  // quello accanto no»), altrimenti uscirebbero mozziconi ogni 4 m.
  const PARCEL_KEEP = { w: 0.02, f: 0.015 };
  const PARCEL_KEEP_CELL = 64;

  function dominantClass(w, k) {
    const r = w[k] / 255;
    const g = w[k + 1] / 255;
    const b = w[k + 2] / 255;
    const a = w[k + 3] / 255;
    const sum = r + g + b + a;
    if (sum < 0.05) return -1;
    let m = r;
    let cls = 0;
    if (g > m) { m = g; cls = 1; }
    if (b > m) { m = b; cls = 2; }
    if (a > m) { m = a; cls = 3; }
    return m / sum > 0.45 ? cls : -1;
  }

  // classe dominante per cella, calcolata una volta (la griglia è 10,8 M di celle)
  const dom = new Int8Array(nx4 * nz4);
  for (let n = 0; n < dom.length; n++) dom[n] = dominantClass(weights, n * 4);
  const domAt = (ci, cj) => (ci < 0 || cj < 0 || ci >= nx4 || cj >= nz4 ? -1 : dom[cj * nx4 + ci]);

  const parcelW = [];
  const parcelF = [];
  let skipRoad = 0;
  let skipTown = 0;
  let skipIsland = 0;
  for (let j = 0; j < nz4; j++) {
    for (let i = 0; i < nx4; i++) {
      const ca = dom[j * nx4 + i];
      if (ca < 0) continue;
      for (const [ni, nj, d] of [
        [i + 1, j, 0],
        [i, j + 1, 1],
      ]) {
        if (ni >= nx4 || nj >= nz4) continue;
        const cb = dom[nj * nx4 + ni];
        if (cb < 0 || ca === cb) continue;
        const k = (j * nx4 + i) * 4;
        const k2 = (nj * nx4 + ni) * 4;
        const l1 =
          (Math.abs(weights[k] - weights[k2]) +
            Math.abs(weights[k + 1] - weights[k2 + 1]) +
            Math.abs(weights[k + 2] - weights[k2 + 2]) +
            Math.abs(weights[k + 3] - weights[k2 + 3])) /
          255;
        if (l1 <= 0.4) continue;
        // almeno uno dei due lati deve proseguire oltre la cella: se no è
        // un isolotto di un pixel, e un muretto chiuso attorno a un pixel
        // sembra un errore, non un confine
        const contA = d === 0 ? domAt(i - 1, j) === ca : domAt(i, j - 1) === ca;
        const contB = d === 0 ? domAt(i + 2, j) === cb : domAt(i, j + 2) === cb;
        if (!contA && !contB) {
          skipIsland++;
          continue;
        }
        const di = sampleRoadDistance(osmRasters.distance, nx4, nz4, i, j);
        const dj = sampleRoadDistance(osmRasters.distance, nx4, nz4, ni, nj);
        if (di < 5.5 || dj < 5.5) {
          skipRoad++;
          continue;
        }
        if (osmRasters.classes[j * nx4 + i] === 6 || osmRasters.classes[nj * nx4 + ni] === 6) {
          skipTown++;
          continue;
        }
        const type = ca === 2 || cb === 2 ? 'w' : 'f';
        const bx = Math.floor((originX4 + i * CELL4) / PARCEL_KEEP_CELL);
        const bz = Math.floor((originZ4 + j * CELL4) / PARCEL_KEEP_CELL);
        if (hash2(bx, bz, type === 'w' ? 31 : 37) >= PARCEL_KEEP[type]) continue;
        if (type === 'w') parcelW.push(i, j, d);
        else parcelF.push(i, j, d);
      }
    }
  }
  await writeFile(
    path.join(OUT_DIR, 'parcels.json'),
    JSON.stringify({
      generatedAt: new Date().toISOString(),
      source: 'fusione landcover 4 m/px (WorldCover + OSM + pendenza)',
      cell: CELL4,
      originX: originX4,
      originZ: originZ4,
      w: parcelW,
      f: parcelF,
    }),
  );
  log(
    `parcels.json: ${parcelW.length / 3} confini con bosco, ${parcelF.length / 3} confini tra campi ` +
      `(scartati ${skipRoad} vicino a strade, ${skipTown} in centro abitato, ${skipIsland} isolotti)`,
  );

  // anteprima leggibile: classi + strade + casa
  const preview = new PNG({ width: baseW, height: baseH });
  const colors = [
    [196, 160, 82], // R coltivo
    [92, 124, 64], // G prato
    [48, 72, 42], // B bosco
    [140, 134, 120], // A roccia
  ];
  for (let j = 0; j < baseH; j++) {
    const z = -HALF_HEIGHT + (j + 0.5) * BASE_MPP;
    for (let i = 0; i < baseW; i++) {
      const x = -HALF_WIDTH + (i + 0.5) * BASE_MPP;
      const k = (j * baseW + i) * 4;
      const r = base.data[k] / 255;
      const g = base.data[k + 1] / 255;
      const b = base.data[k + 2] / 255;
      // A è il flag di validità: la roccia è il resto della normalizzazione
      const a = base.data[k + 3] > 127 ? Math.max(0, 1 - r - g - b) : 0;
      const sum = r + g + b + a;
      let rr = 110;
      let gg = 120;
      let bb = 105;
      if (sum > 0.001) {
        rr = (colors[0][0] * r + colors[1][0] * g + colors[2][0] * b + colors[3][0] * a) / sum;
        gg = (colors[0][1] * r + colors[1][1] * g + colors[2][1] * b + colors[3][1] * a) / sum;
        bb = (colors[0][2] * r + colors[1][2] * g + colors[2][2] * b + colors[3][2] * a) / sum;
      }
      const dist = sampleRoadDistance(
        osmRasters.distance,
        nx4,
        nz4,
        (x - originX4) / CELL4 - 0.5,
        (z - originZ4) / CELL4 - 0.5,
      );
      if (dist < 4) {
        rr = 62;
        gg = 62;
        bb = 64;
      }
      preview.data[k] = Math.round(rr);
      preview.data[k + 1] = Math.round(gg);
      preview.data[k + 2] = Math.round(bb);
      preview.data[k + 3] = 255;
    }
  }
  const home = latLonToWorld(41.8905, 14.7854);
  const hx = Math.round(((home.x + HALF_WIDTH) / WORLD_WIDTH) * baseW);
  const hz = Math.round(((home.z + HALF_HEIGHT) / WORLD_HEIGHT) * baseH);
  for (let dj = -3; dj <= 3; dj++) {
    for (let di = -3; di <= 3; di++) {
      const i = hx + di;
      const j = hz + dj;
      if (i < 0 || j < 0 || i >= baseW || j >= baseH) continue;
      const k = (j * baseW + i) * 4;
      preview.data[k] = 255;
      preview.data[k + 1] = 255;
      preview.data[k + 2] = 255;
      preview.data[k + 3] = 255;
    }
  }
  await writeFile(path.join(OUT_DIR, 'preview.png'), PNG.sync.write(preview, { colorType: 6 }));
  log('preview.png (Palata è il puntino bianco)');

  // chunk 456×456 a 2 m/px
  const cxMin = Math.floor(-HALF_WIDTH / CHUNK_SIZE);
  const cxMax = Math.floor((HALF_WIDTH - 1e-6) / CHUNK_SIZE);
  const czMin = Math.floor(-HALF_HEIGHT / CHUNK_SIZE);
  const czMax = Math.floor((HALF_HEIGHT - 1e-6) / CHUNK_SIZE);
  let written = 0;
  let skipped = 0;
  for (let cz = czMin; cz <= czMax; cz++) {
    for (let cx = cxMin; cx <= cxMax; cx++) {
      const file = path.join(OUT_DIR, `${cx}_${cz}.png`);
      if (!FORCE && (await exists(file))) {
        skipped++;
        continue;
      }
      await writeChunk(cx, cz, weights, nx4, nz4, originX4, originZ4, CELL4);
      written++;
      if (written % 20 === 0) log(`chunk ${written} scritti…`);
    }
  }
  log(`chunk: ${written} scritti, ${skipped} già presenti (${cxMax - cxMin + 1}×${czMax - czMin + 1})`);

  const meta = {
    generatedAt: new Date().toISOString(),
    source: 'ESA WorldCover 10m 2021 v200 + OpenStreetMap + DEM locale',
    license: 'CC BY 4.0 (WorldCover); ODbL 1.0 (OpenStreetMap)',
    worldCoverUrl: TILE_URL,
    bbox: BBOX,
    world: { width: WORLD_WIDTH, height: WORLD_HEIGHT, halfWidth: HALF_WIDTH, halfHeight: HALF_HEIGHT },
    chunk: {
      size: CHUNK_SIZE,
      pixels: CHUNK_PIXELS,
      metersPerPixel: CHUNK_SIZE / CHUNK_PIXELS,
      cxMin,
      cxMax,
      czMin,
      czMax,
    },
    base: { file: 'base.png', width: baseW, height: baseH, metersPerPixel: BASE_MPP },
    fields: { file: 'fields.png', width: baseW, height: baseH, metersPerPixel: BASE_MPP },
    parcels: {
      file: 'parcels.json',
      cell: CELL4,
      wood: parcelW.length / 3,
      field: parcelF.length / 3,
    },
    legend: {
      r: 'coltivo secco/stoppie',
      g: 'prato',
      b: 'sottobosco',
      a: 'roccia/terra nuda',
      fields: 'RG = direzione solchi, B = aratura, A = forza del campo',
    },
    stats: {
      chunks: (cxMax - cxMin + 1) * (czMax - czMin + 1),
      written,
      skipped,
    },
  };
  await writeFile(path.join(OUT_DIR, 'meta.json'), JSON.stringify(meta, null, 2));
  log('meta.json scritto');
  log('fatto');
}

main().catch((err) => {
  console.error('[landcover] errore:', err.message);
  process.exit(1);
});

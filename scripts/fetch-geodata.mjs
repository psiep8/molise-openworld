#!/usr/bin/env node
/**
 * Scarica e pre-processa i dati geografici del mondo di gioco.
 *
 * Fonti (tutte aperte o gratuite con attribuzione):
 *  - OpenStreetMap / Overpass API  -> strade, edifici, aree, corsi d'acqua, toponimi (ODbL)
 *  - AWS Terrain Tiles (Terrarium) -> DEM SRTM/Copernicus/... (dominio pubblico / CC)
 *
 * Output (committati nel repo, così il gioco funziona offline):
 *  - public/geo/osm.json      dati vettoriali semplificati
 *  - public/geo/heights.bin   griglia di elevazione Int16 (decimetri)
 *  - public/geo/heights.json  metadati della griglia
 *
 * Uso: npm run geo [-- --skip-dem] [-- --skip-osm]
 */
import { mkdir, writeFile, readFile, access } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { PNG } from 'pngjs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const OUT_DIR = path.join(ROOT, 'public', 'geo');
const CACHE_DIR = path.join(ROOT, '.geo-cache');

const BBOX = {
  latMin: 41.815,
  latMax: 41.925,
  lonMin: 14.69,
  lonMax: 14.86,
};
const CENTER_LAT = (BBOX.latMin + BBOX.latMax) / 2;
const CENTER_LON = (BBOX.lonMin + BBOX.lonMax) / 2;

// ---------------------------------------------------------------------------
// geodesia (stessa matematica di src/geo/geo.ts)
// ---------------------------------------------------------------------------
const M_PER_DEG_LAT =
  111132.92 -
  559.82 * Math.cos((2 * CENTER_LAT * Math.PI) / 180) +
  1.175 * Math.cos((4 * CENTER_LAT * Math.PI) / 180) -
  0.0023 * Math.cos((6 * CENTER_LAT * Math.PI) / 180);
const M_PER_DEG_LON =
  111412.84 * Math.cos((CENTER_LAT * Math.PI) / 180) -
  93.5 * Math.cos((3 * CENTER_LAT * Math.PI) / 180) +
  0.118 * Math.cos((5 * CENTER_LAT * Math.PI) / 180);

const WORLD_WIDTH = (BBOX.lonMax - BBOX.lonMin) * M_PER_DEG_LON;
const WORLD_HEIGHT = (BBOX.latMax - BBOX.latMin) * M_PER_DEG_LAT;
const HEIGHT_STEP = 10; // metri per campione

const log = (...a) => console.log('[geo]', ...a);

async function exists(p) {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// DEM
// ---------------------------------------------------------------------------
const DEM_ZOOM = 14;
const TILE_PX = 256;

function mercatorPx(lat, lon, zoom) {
  const scale = TILE_PX * 2 ** zoom;
  const latRad = (lat * Math.PI) / 180;
  const x = ((lon + 180) / 360) * scale;
  const y = ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * scale;
  return { x, y };
}

async function downloadDemTile(z, x, y) {
  const dir = path.join(CACHE_DIR, 'dem', String(z), String(x));
  const file = path.join(dir, `${y}.png`);
  if (await exists(file)) return pngRead(file);
  await mkdir(dir, { recursive: true });
  const url = `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`;
  const buf = await fetchWithRetry(url, { label: `dem ${z}/${x}/${y}` });
  await writeFile(file, buf);
  return pngRead(file);
}

function pngRead(file) {
  return readFile(file).then((buf) => PNG.sync.read(buf));
}

async function fetchWithRetry(url, { label = url, tries = 4, init } = {}) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, init);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return Buffer.from(await res.arrayBuffer());
    } catch (err) {
      lastErr = err;
      const wait = 800 * (i + 1);
      log(`${label}: tentativo ${i + 1} fallito (${err.message}), riprovo tra ${wait}ms`);
      await new Promise((r) => setTimeout(r, wait));
    }
  }
  throw lastErr;
}

/** Compone un mosaico di tile Terrarium e ricampiona una griglia regolare in metri locali. */
async function buildHeightmap() {
  const nw = mercatorPx(BBOX.latMax, BBOX.lonMin, DEM_ZOOM);
  const se = mercatorPx(BBOX.latMin, BBOX.lonMax, DEM_ZOOM);
  const tx0 = Math.floor(nw.x / TILE_PX) - 1;
  const ty0 = Math.floor(nw.y / TILE_PX) - 1;
  const tx1 = Math.floor(se.x / TILE_PX) + 1;
  const ty1 = Math.floor(se.y / TILE_PX) + 1;
  const cols = tx1 - tx0 + 1;
  const rows = ty1 - ty0 + 1;
  log(`DEM z${DEM_ZOOM}: ${cols}x${rows} tile (${cols * rows})`);

  const mosaicW = cols * TILE_PX;
  const mosaicH = rows * TILE_PX;
  const highs = new Float32Array(mosaicW * mosaicH);

  let done = 0;
  for (let ty = ty0; ty <= ty1; ty++) {
    for (let tx = tx0; tx <= tx1; tx++) {
      const png = await downloadDemTile(DEM_ZOOM, tx, ty);
      const ox = (tx - tx0) * TILE_PX;
      const oy = (ty - ty0) * TILE_PX;
      for (let py = 0; py < TILE_PX; py++) {
        for (let px = 0; px < TILE_PX; px++) {
          const i = (py * TILE_PX + px) * 4;
          const r = png.data[i];
          const g = png.data[i + 1];
          const b = png.data[i + 2];
          const h = r * 256 + g + b / 256 - 32768;
          highs[(oy + py) * mosaicW + ox + px] = h;
        }
      }
      done++;
      if (done % 8 === 0 || done === cols * rows) {
        log(`DEM ${done}/${cols * rows}`);
      }
    }
  }

  const nx = Math.floor(WORLD_WIDTH / HEIGHT_STEP) + 1;
  const nz = Math.floor(WORLD_HEIGHT / HEIGHT_STEP) + 1;
  const data = new Int16Array(nx * nz);
  let min = Infinity;
  let max = -Infinity;
  const originX = -((nx - 1) * HEIGHT_STEP) / 2;
  const originZ = -((nz - 1) * HEIGHT_STEP) / 2;

  for (let j = 0; j < nz; j++) {
    const z = originZ + j * HEIGHT_STEP;
    const lat = CENTER_LAT - z / M_PER_DEG_LAT;
    for (let i = 0; i < nx; i++) {
      const x = originX + i * HEIGHT_STEP;
      const lon = CENTER_LON + x / M_PER_DEG_LON;
      const p = mercatorPx(lat, lon, DEM_ZOOM);
      const maxX = mosaicW - 1;
      const maxY = mosaicH - 1;
      const gx = Math.min(Math.max(p.x - tx0 * TILE_PX, 0), maxX - 1e-6);
      const gy = Math.min(Math.max(p.y - ty0 * TILE_PX, 0), maxY - 1e-6);
      const x0 = Math.floor(gx);
      const y0 = Math.floor(gy);
      const fx = gx - x0;
      const fy = gy - y0;
      const h00 = highs[y0 * mosaicW + x0];
      const h10 = highs[y0 * mosaicW + x0 + 1];
      const h01 = highs[(y0 + 1) * mosaicW + x0];
      const h11 = highs[(y0 + 1) * mosaicW + x0 + 1];
      const h =
        h00 * (1 - fx) * (1 - fy) + h10 * fx * (1 - fy) + h01 * (1 - fx) * fy + h11 * fx * fy;
      const q = Math.round(h * 10); // decimetri
      const clamped = Math.max(-500, Math.min(32000, q));
      data[j * nx + i] = clamped;
      if (h < min) min = h;
      if (h > max) max = h;
    }
  }

  const meta = {
    source: 'AWS Terrain Tiles (Terrarium) z14 — SRTM, Copernicus DEM, NASADEM',
    license: 'Public domain / CC-BY (vedi registry.opendata.aws/terrain-tiles)',
    attribution: 'Elevazione: © AWS Open Data Terrain Tiles',
    encoding: 'int16-le, decimetri',
    step: HEIGHT_STEP,
    nx,
    nz,
    originX,
    originZ,
    lat: CENTER_LAT,
    lon: CENTER_LON,
    metersPerDegLat: M_PER_DEG_LAT,
    metersPerDegLon: M_PER_DEG_LON,
    minElevation: Math.round(min),
    maxElevation: Math.round(max),
    generatedAt: new Date().toISOString(),
  };

  await writeFile(path.join(OUT_DIR, 'heights.bin'), Buffer.from(data.buffer));
  await writeFile(path.join(OUT_DIR, 'heights.json'), JSON.stringify(meta, null, 2));
  log(
    `heightmap ${nx}x${nz} (${(data.byteLength / 1e6).toFixed(1)} MB), quota ${meta.minElevation}..${meta.maxElevation} m`,
  );
}

// ---------------------------------------------------------------------------
// OSM
// ---------------------------------------------------------------------------
const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.openstreetmap.fr/api/interpreter',
  'https://overpass.osm.jp/api/interpreter',
];

const ROAD_RE =
  '^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|service|track|road|footway|path|cycleway|pedestrian|bridleway)$';
const AREA_KINDS = [
  ['natural', 'wood'],
  ['natural', 'scrub'],
  ['natural', 'water'],
  ['natural', 'grassland'],
  ['landuse', 'forest'],
  ['landuse', 'meadow'],
  ['landuse', 'residential'],
  ['landuse', 'industrial'],
  ['landuse', 'quarry'],
  ['landuse', 'vineyard'],
  ['landuse', 'orchard'],
  ['landuse', 'farmyard'],
  ['leisure', 'park'],
  ['leisure', 'pitch'],
];

function overpassQuery(bb) {
  const areaLines = AREA_KINDS.map(([k, v]) => `  way["${k}"="${v}"](${bb});`).join('\n');
  return `[out:json][timeout:120][maxsize:536870912];
(
  way["highway"~"${ROAD_RE}"](${bb});
  way["building"](${bb});
  relation["building"](${bb});
  way["waterway"~"^(river|stream|canal|ditch)$"](${bb});
${areaLines}
);
out geom;
(
  node["place"~"^(village|town|hamlet|locality)$"](${bb});
);
out;`;
}

function bboxString(b) {
  return `${b.latMin},${b.lonMin},${b.latMax},${b.lonMax}`;
}

/** Il bbox grande mette in crisi Overpass: lo spezziamo in 2x2 con un filo di overlap. */
function splitBbox(b, cols = 2, rows = 2) {
  const out = [];
  const dLat = (b.latMax - b.latMin) / rows;
  const dLon = (b.lonMax - b.lonMin) / cols;
  const pad = 0.0005;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      out.push({
        latMin: b.latMin + r * dLat - pad,
        latMax: b.latMin + (r + 1) * dLat + pad,
        lonMin: b.lonMin + c * dLon - pad,
        lonMax: b.lonMin + (c + 1) * dLon + pad,
      });
    }
  }
  return out;
}

async function fetchOverpassPart(part, label, rotate = 0) {
  const query = overpassQuery(bboxString(part));
  let lastErr;
  void rotate;
  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      log(`Overpass ${label} via ${new URL(endpoint).host}`);
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'molise-openworld/0.1 (open-data demo; contact: psiep8)',
        },
        body: new URLSearchParams({ data: query }),
        signal: AbortSignal.timeout(60000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      log(`  ${label}: ${json.elements.length} elementi`);
      return json;
    } catch (err) {
      lastErr = err;
      log(`  ${label} fallito su ${new URL(endpoint).host}: ${err.message}`);
    }
  }
  throw lastErr;
}

async function fetchOverpass() {
  // Riquadri piccoli: le query grandi vanno in timeout sui server pubblici.
  const parts = splitBbox(BBOX, 4, 4);
  const merged = new Map();
  const failed = [];
  for (let i = 0; i < parts.length; i++) {
    try {
      const json = await fetchOverpassPart(parts[i], `parte ${i + 1}/${parts.length}`, i);
      for (const el of json.elements) merged.set(`${el.type}/${el.id}`, el);
    } catch (err) {
      log(`  parte ${i + 1} rinviata: ${err.message}`);
      failed.push(i);
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
  // secondo giro per i riquadri falliti
  for (const i of failed) {
    try {
      await new Promise((r) => setTimeout(r, 4000));
      const json = await fetchOverpassPart(parts[i], `parte ${i + 1}/${parts.length} (ritento)`, 3);
      for (const el of json.elements) merged.set(`${el.type}/${el.id}`, el);
    } catch (err) {
      log(`  parte ${i + 1} persa: ${err.message}`);
    }
  }
  log(`Overpass: ${merged.size} elementi unici`);
  if (merged.size === 0) throw new Error('Overpass non ha restituito nulla');
  return { elements: [...merged.values()] };
}

const round6 = (n) => Math.round(n * 1e6) / 1e6;

function polyArea(pts) {
  let a = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    a += (pts[j][0] + pts[i][0]) * (pts[j][1] - pts[i][1]);
  }
  return Math.abs(a / 2);
}

function hashHeight(seed, area) {
  const r = Math.abs(Math.sin(seed * 12.9898) * 43758.5453) % 1;
  if (area < 45) return 2.8 + r * 1.4;
  if (area < 110) return 4.6 + r * 1.8;
  if (area < 260) return 5.8 + r * 2.4;
  if (area < 600) return 7 + r * 3.5;
  return 8 + r * 6;
}

function wayCoords(el) {
  if (el.type === 'way' && el.geometry) {
    return el.geometry.filter((p) => p && typeof p.lat === 'number').map((p) => [round6(p.lat), round6(p.lon)]);
  }
  return null;
}

function relationOuters(el) {
  const outers = [];
  for (const m of el.members ?? []) {
    if (m.type !== 'way' || m.role === 'inner' || !m.geometry) continue;
    const pts = m.geometry.filter((p) => p && typeof p.lat === 'number').map((p) => [round6(p.lat), round6(p.lon)]);
    if (pts.length >= 4) outers.push(pts);
  }
  return outers;
}

function processOsm(json) {
  const places = [];
  const roads = [];
  const buildings = [];
  const areas = [];
  const waterways = [];

  for (const el of json.elements) {
    const tags = el.tags ?? {};
    if (el.type === 'node' && tags.place) {
      places.push({ n: tags.name ?? '', k: tags.place, lat: round6(el.lat), lon: round6(el.lon) });
      continue;
    }
    if (tags.highway) {
      const c = wayCoords(el);
      if (!c || c.length < 2) continue;
      roads.push({ t: tags.highway, n: tags.name, c });
      continue;
    }
    if (tags.waterway) {
      const c = wayCoords(el);
      if (!c || c.length < 2) continue;
      waterways.push({ t: tags.waterway, c });
      continue;
    }
    if (tags.building) {
      const polys = el.type === 'relation' ? relationOuters(el) : [wayCoords(el)].filter(Boolean);
      for (const c of polys) {
        if (!c || c.length < 4) continue;
        const area = polyArea(c);
        const levelH = tags['building:levels'] ? parseFloat(tags['building:levels']) * 3.1 : 0;
        const tagH = tags.height ? parseFloat(String(tags.height).replace(',', '.')) : 0;
        const h = tagH || levelH || hashHeight(el.id * 0.37, area);
        buildings.push({ h: Math.max(2.4, Math.min(40, Math.round(h * 10) / 10)), c });
      }
      continue;
    }
    const areaKind = AREA_KINDS.find(([k, v]) => tags[k] === v);
    if (areaKind) {
      const polys = el.type === 'relation' ? relationOuters(el) : [wayCoords(el)].filter(Boolean);
      for (const c of polys) {
        if (!c || c.length < 4) continue;
        areas.push({ k: areaKind[1], c });
      }
    }
  }

  // tieni solo i toponimi utili (i locality extra sono rumore sulla mappa)
  const usefulPlaces = places.filter((p) => p.k !== 'locality' || p.n);
  const stats = {
    places: usefulPlaces.length,
    roads: roads.length,
    roadPoints: roads.reduce((s, r) => s + r.c.length, 0),
    buildings: buildings.length,
    areas: areas.length,
    waterways: waterways.length,
  };

  return {
    generatedAt: new Date().toISOString(),
    bbox: BBOX,
    center: { lat: CENTER_LAT, lon: CENTER_LON },
    attribution: '© OpenStreetMap contributors (ODbL 1.0) — https://www.openstreetmap.org/copyright',
    stats,
    places: usefulPlaces,
    roads,
    buildings,
    areas,
    waterways,
  };
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------
const args = new Set(process.argv.slice(2));

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  log(
    `area ${(WORLD_WIDTH / 1000).toFixed(1)} x ${(WORLD_HEIGHT / 1000).toFixed(1)} km — centro ${CENTER_LAT.toFixed(5)}, ${CENTER_LON.toFixed(5)}`,
  );

  if (!args.has('--skip-osm')) {
    const json = await fetchOverpass();
    const processed = processOsm(json);
    log('OSM:', JSON.stringify(processed.stats));
    await writeFile(path.join(OUT_DIR, 'osm.json'), JSON.stringify(processed));
  }

  if (!args.has('--skip-dem')) {
    await buildHeightmap();
  }
  log('fatto.');
}

main().catch((err) => {
  console.error('[geo] errore fatale:', err);
  process.exit(1);
});

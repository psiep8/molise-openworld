#!/usr/bin/env node
/**
 * Censimento delle immagini stradali (street-level) disponibili sui cinque
 * comuni, per decidere se valga la pena usarle come texture delle facciate.
 *
 * Non scarica le immagini: conta quante ce ne sono e quante strade OSM hanno una
 * foto entro 50 m. Due fonti, entrambe con licenza aperta:
 *
 *  - Panoramax: federazione aperta (API STAC pubblica), **nessuna registrazione**;
 *  - Mapillary: CC BY-SA, serve un token gratuito del developer dashboard.
 *
 * Uso:
 *   npm run streets                      # solo Panoramax, senza account
 *   MAPILLARY_TOKEN=... npm run streets  # Panoramax + Mapillary
 *
 * Token Mapillary gratuito: https://www.mapillary.com/dashboard/developers
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const TOKEN = process.env.MAPILLARY_TOKEN;
const API = 'https://graph.mapillary.com/images';
const PANO_API = 'https://api.panoramax.xyz/api/search';
const BBOX = { latMin: 41.815, latMax: 41.925, lonMin: 14.69, lonMax: 14.86 };
const NEAR_METERS = 50;
const PAGE_LIMIT = 2000;
const MAX_PAGES = 3;
/**
 * Dal 16/1/2026 l'API accetta bbox più piccoli di 0,01° per lato: il bbox dei
 * cinque comuni (0,11° × 0,17°) va quindi diviso in riquadri.
 * https://www.mapillary.com/developer/api-documentation (changelog)
 */
const TILE_DEG = 0.009;
const MAX_REQUESTS = 400;

const log = (...a) => console.log('[street]', ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --- proiezione locale, identica a src/config.ts ---------------------------
const rad = Math.PI / 180;
const CENTER_LAT = (BBOX.latMin + BBOX.latMax) / 2;
const CENTER_LON = (BBOX.lonMin + BBOX.lonMax) / 2;
const METERS_PER_DEG_LAT =
  111132.92 - 559.82 * Math.cos(2 * CENTER_LAT * rad) + 1.175 * Math.cos(4 * CENTER_LAT * rad);
const METERS_PER_DEG_LON = 111412.84 * Math.cos(CENTER_LAT * rad) - 93.5 * Math.cos(3 * CENTER_LAT * rad);

const toWorld = (lat, lon) => ({
  x: (lon - CENTER_LON) * METERS_PER_DEG_LON,
  z: -(lat - CENTER_LAT) * METERS_PER_DEG_LAT,
});

const VILLAGES = [
  { name: 'Palata', lat: 41.8905, lon: 14.7854 },
  { name: 'Montecilfone', lat: 41.9025, lon: 14.8364 },
  { name: 'Acquaviva Collecroce', lat: 41.8676, lon: 14.7468 },
  { name: 'Tavenna', lat: 41.9086, lon: 14.7625 },
  { name: 'Castelmauro', lat: 41.8291, lon: 14.7103 },
];

let requests = 0;

async function fetchPage(tile, after) {
  const params = new URLSearchParams({
    bbox: `${tile.lonMin},${tile.latMin},${tile.lonMax},${tile.latMax}`,
    fields: 'id,computed_geometry',
    limit: String(PAGE_LIMIT),
  });
  if (after) params.set('after', after);

  for (let attempt = 0; attempt < 3; attempt++) {
    requests++;
    const res = await fetch(`${API}?${params}`, { headers: { Authorization: `OAuth ${TOKEN}` } });
    if (res.ok) return res.json();
    if (res.status === 429 || res.status >= 500) {
      await sleep(1500 * (attempt + 1));
      continue;
    }
    const body = await res.text().catch(() => '');
    throw new Error(`Mapillary HTTP ${res.status} ${body.slice(0, 160)}`);
  }
  throw new Error('Mapillary: riquadro fallito tre volte (rate limit?)');
}

async function collectImages() {
  const latSteps = Math.ceil((BBOX.latMax - BBOX.latMin) / TILE_DEG);
  const lonSteps = Math.ceil((BBOX.lonMax - BBOX.lonMin) / TILE_DEG);
  const tiles = latSteps * lonSteps;
  log(`bbox diviso in ${latSteps}×${lonSteps} = ${tiles} riquadri da ${TILE_DEG}° (limite API < 0,01°)`);

  const seen = new Set();
  const points = [];
  let truncated = false;

  outer: for (let i = 0; i < latSteps; i++) {
    for (let j = 0; j < lonSteps; j++) {
      const tile = {
        latMin: BBOX.latMin + i * TILE_DEG,
        latMax: Math.min(BBOX.latMax, BBOX.latMin + (i + 1) * TILE_DEG),
        lonMin: BBOX.lonMin + j * TILE_DEG,
        lonMax: Math.min(BBOX.lonMax, BBOX.lonMin + (j + 1) * TILE_DEG),
      };
      let after;
      for (let page = 0; page < MAX_PAGES; page++) {
        if (requests >= MAX_REQUESTS) {
          truncated = true;
          log(`stop a ${MAX_REQUESTS} richieste: censimento parziale`);
          break outer;
        }
        const data = await fetchPage(tile, after);
        for (const img of data.data ?? []) {
          if (!img.id || seen.has(img.id)) continue;
          seen.add(img.id);
          const geom = img.computed_geometry;
          if (!geom || geom.type !== 'Point') continue;
          const [lon, lat] = geom.coordinates;
          points.push(toWorld(lat, lon));
        }
        after = data.paging?.next ? data.paging.cursors?.after : undefined;
        if (!after) break;
      }
    }
  }

  return { points, tiles, truncated };
}

/** Campiona le strade OSM ogni 40 m: una foto entro 50 m conta come copertura. */
function roadSamples() {
  const raw = JSON.parse(readFileSync(path.join(ROOT, 'public', 'geo', 'osm.json'), 'utf8'));
  const samples = [];
  for (const road of raw.roads ?? []) {
    let travelled = 0;
    for (let i = 1; i < road.c.length; i++) {
      const a = toWorld(road.c[i - 1][0], road.c[i - 1][1]);
      const b = toWorld(road.c[i][0], road.c[i][1]);
      const seg = Math.hypot(b.x - a.x, b.z - a.z);
      if (seg < 0.5) continue;
      while (travelled <= seg) {
        const t = travelled / seg;
        samples.push({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t });
        travelled += 40;
      }
      travelled -= seg;
    }
  }
  return samples;
}

function coverage(samples, images, radius = NEAR_METERS) {
  const cell = radius;
  const grid = new Map();
  const key = (cx, cz) => `${cx}:${cz}`;
  for (const p of images) {
    const k = key(Math.floor(p.x / cell), Math.floor(p.z / cell));
    const list = grid.get(k);
    if (list) list.push(p);
    else grid.set(k, [p]);
  }
  let covered = 0;
  for (const s of samples) {
    const cx = Math.floor(s.x / cell);
    const cz = Math.floor(s.z / cell);
    let hit = false;
    for (let ix = cx - 1; ix <= cx + 1 && !hit; ix++) {
      for (let iz = cz - 1; iz <= cz + 1 && !hit; iz++) {
        for (const p of grid.get(key(ix, iz)) ?? []) {
          if (Math.hypot(p.x - s.x, p.z - s.z) <= radius) {
            hit = true;
            break;
          }
        }
      }
    }
    if (hit) covered++;
  }
  return { covered, total: samples.length, pct: samples.length ? (covered / samples.length) * 100 : 0 };
}

/**
 * Panoramax federato: nessun token, nessuna registrazione.
 * Risponde con feature vuote se non ci sono foto nell'area.
 */
async function panoramaxImages() {
  const params = new URLSearchParams({
    bbox: `${BBOX.lonMin},${BBOX.latMin},${BBOX.lonMax},${BBOX.latMax}`,
    limit: '1000',
  });
  const res = await fetch(`${PANO_API}?${params}`);
  if (!res.ok) throw new Error(`Panoramax HTTP ${res.status}`);
  const data = await res.json();
  const points = [];
  for (const f of data.features ?? []) {
    const c = f.geometry?.coordinates;
    if (!Array.isArray(c) || c.length < 2) continue;
    points.push(toWorld(c[1], c[0]));
  }
  return points;
}

try {
  log('cerco foto stradali nel bbox dei cinque comuni…');

  let panoPoints = [];
  try {
    panoPoints = await panoramaxImages();
    log(`Panoramax (nessuna registrazione): ${panoPoints.length} immagini nel bbox`);
  } catch (err) {
    log('Panoramax non raggiungibile:', err instanceof Error ? err.message : String(err));
  }
  if (panoPoints.length > 0) {
    const panoSamples = roadSamples();
    const panoCover = coverage(panoSamples, panoPoints);
    log(`  copertura Panoramax: ${panoCover.covered}/${panoCover.total} campioni (${panoCover.pct.toFixed(1)}%)`);
  } else {
    log('  → nessuna foto Panoramax qui: da sola non basta.');
  }

  if (!TOKEN) {
    log('Mapillary non interrogato: MAPILLARY_TOKEN non impostato.');
    log('  Token gratuito: https://www.mapillary.com/dashboard/developers');
    log('  Poi: MAPILLARY_TOKEN=... npm run streets');
    process.exit(0);
  }

  log('interrogo Mapillary…');
  const { points, tiles, truncated } = await collectImages();
  log(`immagini trovate: ${points.length} (${tiles} riquadri, ${requests} richieste${truncated ? ', censimento parziale' : ''})`);
  if (points.length === 0) {
    log('NESSUN dato street-level in quest’area: le foto non sono una strada percorribile qui.');
    log('Conviene investire su facciate procedurali e tetti (già implementati).');
    process.exit(0);
  }

  const samples = roadSamples();
  const total = coverage(samples, points);
  log(`strade campionate ogni 40 m: ${total.total}`);
  log(`con una foto entro ${NEAR_METERS} m: ${total.covered} (${total.pct.toFixed(1)}%)`);

  for (const v of VILLAGES) {
    const c = toWorld(v.lat, v.lon);
    const near = points.filter((p) => Math.hypot(p.x - c.x, p.z - c.z) <= 1500).length;
    log(`  ${v.name}: ${near} immagini entro 1,5 km dal centro`);
  }

  if (total.pct < 25) {
    log('Copertura bassa: le facciate fotografate sarebbero un mosaico di buchi.');
  } else {
    log('Copertura sufficiente per provare a proiettare le facciate sulle impronte OSM.');
  }
} catch (err) {
  console.error('[street] errore:', err instanceof Error ? err.message : String(err));
  process.exit(1);
}

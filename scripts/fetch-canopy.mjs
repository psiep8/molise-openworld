#!/usr/bin/env node
/**
 * Ritaglia l'altezza della chioma (ETH Global Canopy Height 2020, 10 m) sul
 * bbox di gioco e la salva in una griglia compatta allineata al mondo locale.
 *
 * Fonte: Lang, Jetz, Schindler, Wegner (2023), CC BY 4.0.
 * Il GeoTIFF globale da 3° è ~116 MB: viene scaricato una volta in
 * `.geo-cache/canopy/` e non entra nel repository.
 *
 * Output:
 *  - public/geo/canopy.bin   Uint8, metri (0 = nessuna chioma)
 *  - public/geo/canopy.json  metadati e attribuzione
 *
 * Uso: npm run canopy
 */
import { mkdir, readFile, writeFile, access } from 'node:fs/promises';
import path from 'node:path';
import { fromFile } from 'geotiff';

const ROOT = path.resolve(import.meta.dirname, '..');
const OUT_DIR = path.join(ROOT, 'public', 'geo');
const CACHE_DIR = path.join(ROOT, '.geo-cache', 'canopy');
const HEIGHT_STEP = 5;
const CANOPY_STEP = 10;

// Stesso bbox/proiezione di scripts/fetch-geodata.mjs.
const BBOX = { latMin: 41.815, latMax: 41.925, lonMin: 14.69, lonMax: 14.86 };
const CENTER_LAT = (BBOX.latMin + BBOX.latMax) / 2;
const CENTER_LON = (BBOX.lonMin + BBOX.lonMax) / 2;
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

const TILE =
  'https://libdrive.ethz.ch/index.php/s/cO8or7iOe5dT2Rt/download?path=%2F3deg_cogs&files=ETH_GlobalCanopyHeight_10m_2020_N39E012_Map.tif';
const TILE_NAME = 'ETH_GlobalCanopyHeight_10m_2020_N39E012_Map.tif';

const log = (...a) => console.log('[canopy]', ...a);

async function exists(p) {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

async function downloadTile() {
  const file = path.join(CACHE_DIR, TILE_NAME);
  if (await exists(file)) return file;
  await mkdir(CACHE_DIR, { recursive: true });
  log('scarico il tile ETH da 116 MB (una volta sola)…');
  const res = await fetch(TILE, { signal: AbortSignal.timeout(900_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  await writeFile(file, buf);
  log(`salvato ${(buf.length / 1e6).toFixed(1)} MB in ${path.relative(ROOT, file)}`);
  return file;
}

function lonToPixel(lon, bbox, width) {
  return ((lon - bbox[0]) / (bbox[2] - bbox[0])) * width;
}

function latToPixel(lat, bbox, height) {
  return ((bbox[3] - lat) / (bbox[3] - bbox[1])) * height;
}

async function main() {
  // La griglia deve essere allineata al heightfield (step 5 m), così il gioco
  // può campionare entrambi con la stessa origine e la stessa formula.
  const heightMeta = JSON.parse(await readFile(path.join(OUT_DIR, 'heights.json'), 'utf8'));
  const nx = Math.floor((heightMeta.nx - 1) / (CANOPY_STEP / HEIGHT_STEP)) + 1;
  const nz = Math.floor((heightMeta.nz - 1) / (CANOPY_STEP / HEIGHT_STEP)) + 1;
  const originX = heightMeta.originX;
  const originZ = heightMeta.originZ;
  const step = CANOPY_STEP;
  const data = new Uint8Array(nx * nz);

  const file = await downloadTile();
  const tiff = await fromFile(file);
  const image = await tiff.getImage();
  const bbox = image.getBoundingBox();
  const [width, height] = image.getWidth() ? [image.getWidth(), image.getHeight()] : [0, 0];
  if (!width || !height) throw new Error('GeoTIFF senza dimensioni');
  log(`tile ${width}x${height}, bbox ${bbox.map((v) => v.toFixed(3)).join(', ')}`);

  // Finestra esatta del bbox di gioco, ricampionata sui nodi del mondo locale.
  const x0 = Math.max(0, Math.floor(lonToPixel(BBOX.lonMin, bbox, width)));
  const x1 = Math.min(width, Math.ceil(lonToPixel(BBOX.lonMax, bbox, width)));
  const y0 = Math.max(0, Math.floor(latToPixel(BBOX.latMax, bbox, height)));
  const y1 = Math.min(height, Math.ceil(latToPixel(BBOX.latMin, bbox, height)));
  log(`finestra ${x1 - x0}x${y1 - y0} px → griglia ${nx}x${nz}`);

  const rasters = await image.readRasters({
    window: [x0, y0, x1, y1],
    width: nx,
    height: nz,
    resampleMethod: 'bilinear',
  });
  const values = rasters[0];
  let max = 0;
  let treeCells = 0;
  for (let i = 0; i < nx * nz; i++) {
    const v = Number(values[i]);
    // 255 è il nodata del prodotto; 0 = nessun albero. I valori 1-3 m sono
    // arbusti/colture e non devono diventare alberi da 2 m.
    const m = Number.isFinite(v) && v >= 1 && v < 100 ? Math.min(100, Math.round(v)) : 0;
    data[i] = m;
    if (m > max) max = m;
    if (m >= 5) treeCells++;
  }

  const meta = {
    source: 'ETH Global Canopy Height 2020 (Lang et al., 2023), 10 m',
    license: 'CC BY 4.0',
    attribution:
      'Canopy height: Lang, N., Jetz, W., Schindler, K., & Wegner, J. D. (2023). A high-resolution canopy height model of the Earth. Nature Ecology & Evolution. ETH Zurich — CC BY 4.0',
    encoding: 'uint8, metri (0 = nessuna chioma)',
    step,
    nx,
    nz,
    originX,
    originZ,
    lat: CENTER_LAT,
    lon: CENTER_LON,
    metersPerDegLat: M_PER_DEG_LAT,
    metersPerDegLon: M_PER_DEG_LON,
    minHeight: 0,
    maxHeight: max,
    treeCells,
    generatedAt: new Date().toISOString(),
  };
  await writeFile(path.join(OUT_DIR, 'canopy.bin'), data);
  await writeFile(path.join(OUT_DIR, 'canopy.json'), JSON.stringify(meta, null, 2));
  log(
    `canopy ${nx}x${nz} (${(data.byteLength / 1e6).toFixed(2)} MB), max ${max} m, ${treeCells} celle con alberi`,
  );
}

main().catch((err) => {
  console.error('[canopy] errore:', err);
  process.exit(1);
});

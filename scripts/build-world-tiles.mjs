#!/usr/bin/env node
/**
 * Genera i bundle geografici XYZ (schemaVersion 2) da un estratto OSM.
 *
 * Perché offline: il client non deve interrogare Overpass né altri servizi
 * pubblici a runtime. Si scarica un estratto una volta, si converte in tile e
 * si serve come file statici `{z}/{x}/{y}.json`.
 *
 * Ingresso: `.osm.pbf` (letto dal decoder del progetto, senza dipendenze) oppure
 * OSM XML (`.osm`). Su un estratto regionale il PBF va sempre accompagnato da
 * `--bbox`: senza filtro si terrebbero in memoria decine di milioni di nodi.
 *
 *   node scripts/build-world-tiles.mjs --input sud.osm.pbf \
 *     --bbox 41.70,14.55,42.00,15.05 --out public/world-tiles
 *
 * Il tile che possiede una feature è quello del suo **primo punto**, la stessa
 * regola di `ownsFeature` nel client: così i bundle possono contenere la stessa
 * way su più tile senza che venga disegnata due volte.
 *
 * Schema v2: oltre a strade ed edifici scrive aree (acqua, abitato, cave),
 * copertura del suolo (boschi, prati, coltivi), POI dai nodi con tag e
 * semafori mappati (`highway=traffic_signals`). Il client accetta anche i
 * vecchi bundle v1 (senza questi elenchi).
 *
 * Con `--dem` aggiunge anche la griglia di quota Terrarium (`elevation`,
 * decimetri interi): il client la usa per il terreno oltre il DEM locale.
 */
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { PNG } from 'pngjs';
import { decodeOsmPbf } from './lib/osm-pbf.mjs';

/** Larghezza di carreggiata per classe, in metri (come `roadWidth` del client). */
const ROAD_WIDTH = {
  motorway: 12,
  motorway_link: 7,
  trunk: 11,
  trunk_link: 7,
  primary: 9.5,
  primary_link: 6.5,
  secondary: 8.5,
  secondary_link: 6,
  tertiary: 7.5,
  tertiary_link: 5.5,
  unclassified: 6,
  residential: 5.5,
  living_street: 5,
  service: 4,
  track: 3.5,
  path: 2.5,
  footway: 2.5,
  cycleway: 2.5,
  bridleway: 2.5,
};

/** Tag OSM che diventano superfici. `landcover` = tinta del terreno. */
const AREA_KINDS = {
  'natural=water': { kind: 'water', landcover: false },
  'waterway=riverbank': { kind: 'water', landcover: false },
  'landuse=reservoir': { kind: 'water', landcover: false },
  'landuse=basin': { kind: 'water', landcover: false },
  'landuse=residential': { kind: 'residential', landcover: false },
  'landuse=industrial': { kind: 'industrial', landcover: false },
  'landuse=cemetery': { kind: 'cemetery', landcover: false },
  'landuse=quarry': { kind: 'quarry', landcover: false },
  'natural=wood': { kind: 'wood', landcover: true },
  'landuse=forest': { kind: 'forest', landcover: true },
  'natural=scrub': { kind: 'scrub', landcover: true },
  'natural=heath': { kind: 'heath', landcover: true },
  'natural=grassland': { kind: 'grassland', landcover: true },
  'landuse=meadow': { kind: 'meadow', landcover: true },
  'landuse=farmland': { kind: 'farmland', landcover: true },
  'landuse=orchard': { kind: 'orchard', landcover: true },
  'landuse=vineyard': { kind: 'vineyard', landcover: true },
  'leisure=park': { kind: 'park', landcover: true },
  'natural=beach': { kind: 'beach', landcover: true },
};
const POI_TAGS = ['amenity', 'tourism', 'shop', 'historic', 'leisure', 'place'];
/** Arredo minuto e impianti: non sono luoghi, riempiono solo il tile di rumore. */
const POI_SKIP = new Set([
  'waste_basket',
  'bench',
  'shelter',
  'bicycle_parking',
  'parking_space',
  'vending_machine',
  'parcel_locker',
  'utility_pole',
]);

function areaKind(tags) {
  for (const key of ['natural', 'landuse', 'leisure', 'waterway']) {
    const value = tags[key];
    if (!value) continue;
    const found = AREA_KINDS[`${key}=${value}`];
    if (found) return found;
  }
  return null;
}

function poiKind(tags) {
  for (const key of POI_TAGS) {
    const value = tags[key];
    if (!value || POI_SKIP.has(value)) continue;
    return value;
  }
  return null;
}

const PAVED_SURFACES = new Set(['asphalt', 'concrete', 'concrete:plates', 'paved', 'paving_stones', 'cobblestone']);
const UNPAVED_SURFACES = new Set(['unpaved', 'gravel', 'fine_gravel', 'dirt', 'earth', 'grass', 'ground', 'sand']);
const UNPAVED_CLASSES = new Set(['track', 'path', 'footway', 'cycleway', 'bridleway']);

/** Coordinate geografiche di un nodo. */
function tileAt(lat, lon, z) {
  const n = 2 ** z;
  const x = Math.floor(((lon + 180) / 360) * n);
  const latRad = (lat * Math.PI) / 180;
  const y = Math.floor(((1 - Math.asinh(Math.tan(latRad)) / Math.PI) / 2) * n);
  return { z, x: ((x % n) + n) % n, y: Math.max(0, Math.min(n - 1, y)) };
}

/** Limiti geografici di un tile XYZ. */
function tileBounds(tile) {
  const n = 2 ** tile.z;
  const latAt = (y) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n))) * 180) / Math.PI;
  return {
    minLon: (tile.x / n) * 360 - 180,
    maxLon: ((tile.x + 1) / n) * 360 - 180,
    maxLat: latAt(tile.y),
    minLat: latAt(tile.y + 1),
  };
}

/** Pixel Web Mercator (scala tile × 256) di un punto. */
function mercatorPx(lat, lon, z) {
  const scale = 256 * 2 ** z;
  const latRad = (lat * Math.PI) / 180;
  return {
    x: ((lon + 180) / 360) * scale,
    y: ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * scale,
  };
}

const TERRARIUM_URL = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium';
const DEM_ATTRIBUTION = 'Elevazione: © AWS Open Data Terrain Tiles (Terrarium)';

/** Quota in metri di un pixel Terrarium (r·256 + g + b/256 − 32768). */
export function terrariumHeight(r, g, b) {
  return r * 256 + g + b / 256 - 32768;
}

async function exists(file) {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

/**
 * Legge una tile Terrarium dalla cache locale e, solo se manca, la scarica.
 *
 * La cache è la stessa di `fetch-geodata.mjs` (`.geo-cache/dem/z/x/y.png`),
 * così chi ha già rigenerato il DEM del mondo non riscarica nulla.
 */
async function loadDemTile(z, x, y, cacheDir, fetchImpl) {
  const file = path.join(cacheDir, String(z), String(x), `${y}.png`);
  let buf;
  if (await exists(file)) {
    buf = await readFile(file);
  } else {
    const url = `${TERRARIUM_URL}/${z}/${x}/${y}.png`;
    const res = await fetchImpl(url);
    if (!res.ok) throw new Error(`DEM ${z}/${x}/${y}: HTTP ${res.status} (${url})`);
    buf = Buffer.from(await res.arrayBuffer());
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, buf);
  }
  const png = PNG.sync.read(buf);
  const values = new Float32Array(png.width * png.height);
  for (let py = 0; py < png.height; py++) {
    for (let px = 0; px < png.width; px++) {
      const i = (py * png.width + px) * 4;
      values[py * png.width + px] = terrariumHeight(png.data[i], png.data[i + 1], png.data[i + 2]);
    }
  }
  return { width: png.width, height: png.height, values };
}

/**
 * Griglia DEM regolare per un tile: `size × size` campioni bilineari sui pixel
 * Terrarium, riga 0 a nord. I valori sono decimetri interi, come li vuole
 * `parseWorldDataTile` nel client.
 */
export function elevationGridForTile(tile, sampleHeight, size = 65) {
  if (!Number.isInteger(size) || size < 2 || size > 1024) {
    throw new Error(`demSamples non valido: ${size}`);
  }
  const bounds = tileBounds(tile);
  const values = [];
  for (let row = 0; row < size; row++) {
    const lat = bounds.maxLat + ((bounds.minLat - bounds.maxLat) * row) / (size - 1);
    for (let col = 0; col < size; col++) {
      const lon = bounds.minLon + ((bounds.maxLon - bounds.minLon) * col) / (size - 1);
      const metres = sampleHeight(lat, lon);
      if (!Number.isFinite(metres)) throw new Error(`quota DEM non finita a ${lat},${lon}`);
      values.push(Math.max(-32768, Math.min(32767, Math.round(metres * 10))));
    }
  }
  return {
    minLon: bounds.minLon,
    maxLon: bounds.maxLon,
    minLat: bounds.minLat,
    maxLat: bounds.maxLat,
    width: size,
    height: size,
    encoding: 'int16-decimeters',
    values,
  };
}

/**
 * Aggiunge `elevation` a ogni bundle. Il mosaico Terrarium copre il tile con
 * le tile del livello `demZoom` che lo contengono: si compone una volta per
 * tile di uscita e si campiona in bilineare.
 */
export async function attachElevation(tiles, options = {}) {
  const demZoom = options.demZoom ?? 15;
  const size = options.demSamples ?? 65;
  const cacheDir = options.demCache ?? path.join('.geo-cache', 'dem');
  const fetchImpl = options.fetch ?? fetch;
  const log = options.log ?? (() => {});
  const cache = new Map();
  let done = 0;

  for (const bundle of tiles.values()) {
    const bounds = tileBounds(bundle.tile);
    const nw = mercatorPx(bounds.maxLat, bounds.minLon, demZoom);
    const se = mercatorPx(bounds.minLat, bounds.maxLon, demZoom);
    const tx0 = Math.floor(nw.x / 256);
    const ty0 = Math.floor(nw.y / 256);
    const tx1 = Math.floor(se.x / 256);
    const ty1 = Math.floor(se.y / 256);
    const cols = tx1 - tx0 + 1;
    const rows = ty1 - ty0 + 1;
    const mosaic = new Float32Array(cols * 256 * rows * 256);

    for (let ty = ty0; ty <= ty1; ty++) {
      for (let tx = tx0; tx <= tx1; tx++) {
        const key = `${demZoom}/${tx}/${ty}`;
        let dem = cache.get(key);
        if (!dem) {
          dem = await loadDemTile(demZoom, tx, ty, cacheDir, fetchImpl);
          cache.set(key, dem);
        }
        const ox = (tx - tx0) * 256;
        const oy = (ty - ty0) * 256;
        for (let py = 0; py < dem.height; py++) {
          for (let px = 0; px < dem.width; px++) {
            mosaic[(oy + py) * (cols * 256) + ox + px] = dem.values[py * dem.width + px];
          }
        }
      }
    }

    const mosaicWidth = cols * 256;
    const mosaicHeight = rows * 256;
    const sampleHeight = (lat, lon) => {
      const p = mercatorPx(lat, lon, demZoom);
      const gx = Math.max(0, Math.min(mosaicWidth - 1 - 1e-6, p.x - tx0 * 256));
      const gy = Math.max(0, Math.min(mosaicHeight - 1 - 1e-6, p.y - ty0 * 256));
      const x0 = Math.floor(gx);
      const y0 = Math.floor(gy);
      const fx = gx - x0;
      const fy = gy - y0;
      const h00 = mosaic[y0 * mosaicWidth + x0];
      const h10 = mosaic[y0 * mosaicWidth + x0 + 1];
      const h01 = mosaic[(y0 + 1) * mosaicWidth + x0];
      const h11 = mosaic[(y0 + 1) * mosaicWidth + x0 + 1];
      return h00 * (1 - fx) * (1 - fy) + h10 * fx * (1 - fy) + h01 * (1 - fx) * fy + h11 * fx * fy;
    };

    bundle.elevation = elevationGridForTile(bundle.tile, sampleHeight, size);
    if (!bundle.attribution.includes(DEM_ATTRIBUTION)) {
      bundle.attribution = `${bundle.attribution} · ${DEM_ATTRIBUTION}`;
    }
    done++;
    if (done % 10 === 0) log(`DEM ${done}/${tiles.size}`);
  }
  return tiles;
}

function decodeEntities(value) {
  return value.replace(/&(amp|lt|gt|quot|apos);/g, (_, entity) => {
    switch (entity) {
      case 'amp':
        return '&';
      case 'lt':
        return '<';
      case 'gt':
        return '>';
      case 'quot':
        return '"';
      default:
        return "'";
    }
  });
}

function attributes(text) {
  const out = {};
  const re = /([\w:-]+)\s*=\s*"([^"]*)"/g;
  let match;
  while ((match = re.exec(text))) out[match[1]] = decodeEntities(match[2]);
  return out;
}

/**
 * Lettura dell'OSM XML. Basta un tokenizzatore: il file è generato da tool che
 * scrivono XML ben formato, e servono solo nodi, way e tag.
 */
export function parseOsmXml(xml) {
  const nodes = new Map();
  const taggedNodes = [];
  const nodeRe = /<node\b([^>]*?)\/?>/g;
  let match;
  while ((match = nodeRe.exec(xml))) {
    const a = attributes(match[1]);
    const id = Number(a.id);
    const lat = Number(a.lat);
    const lon = Number(a.lon);
    if (Number.isFinite(id) && Number.isFinite(lat) && Number.isFinite(lon)) {
      nodes.set(id, { lat, lon });
    }
  }

  // nodi con tag (POI): nell'XML hanno figli <tag>, non sono self-closing
  const nodeBlockRe = /<node\b([^>]*)>([\s\S]*?)<\/node>/g;
  while ((match = nodeBlockRe.exec(xml))) {
    const a = attributes(match[1]);
    const id = Number(a.id);
    const lat = Number(a.lat);
    const lon = Number(a.lon);
    if (!Number.isFinite(id) || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const tags = {};
    const tagRe = /<tag\b([^>]*?)\/?>/g;
    let tag;
    while ((tag = tagRe.exec(match[2]))) {
      const t = attributes(tag[1]);
      if (t.k) tags[t.k] = t.v ?? '';
    }
    if (Object.keys(tags).length > 0) taggedNodes.push({ id, tags, lat, lon });
  }

  const ways = [];
  const wayRe = /<way\b([^>]*)>([\s\S]*?)<\/way>/g;
  while ((match = wayRe.exec(xml))) {
    const head = attributes(match[1]);
    const body = match[2];
    const refs = [];
    const ndRe = /<nd\b([^>]*?)\/?>/g;
    let nd;
    while ((nd = ndRe.exec(body))) {
      const ref = Number(attributes(nd[1]).ref);
      if (Number.isFinite(ref)) refs.push(ref);
    }
    const tags = {};
    const tagRe = /<tag\b([^>]*?)\/?>/g;
    let tag;
    while ((tag = tagRe.exec(body))) {
      const t = attributes(tag[1]);
      if (t.k) tags[t.k] = t.v ?? '';
    }
    const id = Number(head.id);
    if (Number.isFinite(id) && refs.length >= 2) ways.push({ id, tags, refs });
  }
  return { nodes, ways, taggedNodes };
}

function inside(point, bbox) {
  return (
    point.lat >= bbox.minLat &&
    point.lat <= bbox.maxLat &&
    point.lon >= bbox.minLon &&
    point.lon <= bbox.maxLon
  );
}

/** Area approssimata del ring in m²: serve solo a scartare gli sliver. */
function ringArea(points) {
  const latScale = 111_132;
  const lonScale = 111_320 * Math.cos((points[0].lat * Math.PI) / 180);
  let area = 0;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[j];
    const b = points[i];
    area += (a.lon - b.lon) * lonScale * ((a.lat + b.lat) / 2) * latScale;
  }
  return Math.abs(area / 2);
}

function buildingHeight(tags) {
  const declared = Number(String(tags.height ?? '').replace(',', '.'));
  if (Number.isFinite(declared) && declared > 0) {
    return Math.round(Math.min(40, Math.max(2.4, declared)) * 10) / 10;
  }
  const levels = Number(String(tags['building:levels'] ?? '').replace(',', '.'));
  if (Number.isFinite(levels) && levels > 0) {
    return Math.round(Math.min(40, Math.max(2.4, levels * 3.1)) * 10) / 10;
  }
  // casa molisana tipica: due piani sopra la strada
  return 6.3;
}

function roadFeature(way, points) {
  const tags = way.tags;
  const type = tags.highway;
  const surface = tags.surface;
  const paved = surface
    ? PAVED_SURFACES.has(surface)
      ? true
      : UNPAVED_SURFACES.has(surface)
        ? false
        : !UNPAVED_CLASSES.has(type)
    : !UNPAVED_CLASSES.has(type);
  const feature = {
    id: `way/${way.id}`,
    type,
    width: ROAD_WIDTH[type],
    paved,
    surface: surface ?? (paved ? 'asphalt' : 'dirt'),
    points,
  };
  if (tags.name) feature.name = tags.name;
  if (tags.bridge === 'yes' || tags.bridge === 'viaduct') feature.bridge = true;
  if (tags.tunnel === 'yes') feature.tunnel = true;
  if (Number.isFinite(Number(tags.layer))) feature.layer = Number(tags.layer);
  if (Number.isFinite(Number(tags.lanes))) feature.lanes = Number(tags.lanes);
  if (tags.oneway === '-1') feature.oneway = -1;
  else if (tags.oneway === 'yes' || tags.oneway === '1' || tags.oneway === 'true') feature.oneway = 1;
  const maxspeed = Number(String(tags.maxspeed ?? '').replace(/[^\d.]/g, ''));
  if (Number.isFinite(maxspeed) && maxspeed > 0) feature.maxspeed = maxspeed;
  return feature;
}

/** Costruisce i bundle in memoria: `Map<'z/x/y', bundle>`. */
export function buildTiles(extract, options = {}) {
  const zoom = options.zoom ?? 14;
  if (!Number.isInteger(zoom) || zoom < 1 || zoom > 18) throw new Error(`zoom non valido: ${zoom}`);
  const attribution = options.attribution;
  if (typeof attribution !== 'string' || attribution.trim() === '') {
    throw new Error('attribuzione obbligatoria (dati OSM: ODbL)');
  }
  const bbox = options.bbox ?? null;
  const tiles = new Map();

  const tileFor = (point) => {
    const tile = tileAt(point.lat, point.lon, zoom);
    const key = `${tile.z}/${tile.x}/${tile.y}`;
    let bundle = tiles.get(key);
    if (!bundle) {
      bundle = {
        schemaVersion: 2,
        tile,
        attribution,
        roads: [],
        buildings: [],
        areas: [],
        landcover: [],
        pois: [],
        signals: [],
      };
      tiles.set(key, bundle);
    }
    return bundle;
  };

  const coordsOf = (way) => {
    const points = [];
    for (const ref of way.refs) {
      const node = extract.nodes.get(ref);
      if (!node) return null;
      points.push({ lat: node.lat, lon: node.lon });
    }
    return points;
  };

  for (const way of extract.ways) {
    const tags = way.tags;
    const isBuilding = Boolean(tags.building) && tags.building !== 'no';
    const isRoad = Boolean(tags.highway) && ROAD_WIDTH[tags.highway] !== undefined;
    const area = areaKind(tags);
    if (!isBuilding && !isRoad && !area) continue;
    const points = coordsOf(way);
    if (!points) continue;

    if (isBuilding) {
      if (points.length < 4) continue;
      const first = points[0];
      const last = points[points.length - 1];
      if (first.lat !== last.lat || first.lon !== last.lon) continue;
      points.pop();
      if (points.length < 3 || ringArea(points) < 6) continue;
      if (bbox && !inside(first, bbox)) continue;
      tileFor(first).buildings.push({
        id: `way/${way.id}`,
        height: buildingHeight(tags),
        points,
      });
    } else if (isRoad) {
      if (bbox && !inside(points[0], bbox)) continue;
      tileFor(points[0]).roads.push(roadFeature(way, points));
    } else if (area) {
      if (points.length < 4) continue;
      const first = points[0];
      const last = points[points.length - 1];
      if (first.lat !== last.lat || first.lon !== last.lon) continue;
      points.pop();
      if (points.length < 3 || ringArea(points) < 6) continue;
      // le superfici grandi possono entrare nel bbox con un angolo: si tengono
      // se almeno un vertice è dentro, l'owner resta il tile del primo punto
      if (bbox && !points.some((point) => inside(point, bbox))) continue;
      const feature = { id: `way/${way.id}`, kind: area.kind, points };
      if (tags.name) feature.name = tags.name;
      const bundle = tileFor(first);
      (area.landcover ? bundle.landcover : bundle.areas).push(feature);
    }
  }

  for (const node of extract.taggedNodes ?? []) {
    const point = { lat: node.lat, lon: node.lon };
    if (bbox && !inside(point, bbox)) continue;
    if (node.tags.highway === 'traffic_signals') {
      const direction = node.tags['traffic_signals:direction'] ?? node.tags.direction;
      const feature = { id: `node/${node.id}`, lat: node.lat, lon: node.lon };
      if (direction === 'forward' || direction === 'backward' || direction === 'both') {
        feature.direction = direction;
      }
      tileFor(point).signals.push(feature);
      continue;
    }
    const kind = poiKind(node.tags);
    if (!kind) continue;
    const feature = { id: `node/${node.id}`, kind, lat: node.lat, lon: node.lon };
    if (node.tags.name) feature.name = node.tags.name;
    tileFor(point).pois.push(feature);
  }

  return tiles;
}

/** Scrive `outDir/{z}/{x}/{y}.json`. */
export async function writeTiles(tiles, outDir) {
  let files = 0;
  let bytes = 0;
  for (const [key, bundle] of tiles) {
    const body = JSON.stringify(bundle);
    const target = path.join(outDir, `${key}.json`);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, body);
    files++;
    bytes += Buffer.byteLength(body);
  }
  return { files, bytes };
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const name = arg.slice(2);
    const value = argv[i + 1];
    if (value === undefined || value.startsWith('--')) args[name] = true;
    else {
      args[name] = value;
      i++;
    }
  }
  return args;
}

/** `bbox` allargato di `margin` gradi: i nodi ai bordi servono alle way che entrano. */
function expandBbox(bbox, margin) {
  return {
    minLat: bbox.minLat - margin,
    maxLat: bbox.maxLat + margin,
    minLon: bbox.minLon - margin,
    maxLon: bbox.maxLon + margin,
  };
}

/** Vecchia forma di `buildTiles`: accetta anche `readExtract` nei test. */
export function readExtract(file, bbox = null) {
  if (!String(file).endsWith('.pbf')) return parseOsmXml(readFileSync(file, 'utf8'));
  const keep = bbox ? expandBbox(bbox, 0.02) : null;
  return decodeOsmPbf(readFileSync(file), {
    keepNode: keep ? (point) => inside(point, keep) : undefined,
    keepWay: (tags, refs, nodes) => {
      const useful =
        (Boolean(tags.building) && tags.building !== 'no') ||
        Boolean(tags.highway) ||
        areaKind(tags) !== null;
      if (!useful) return false;
      if (!bbox) return true;
      // senza almeno un nodo tenuto la way è fuori dall'area: scartarla subito
      return refs.some((ref) => nodes.has(ref));
    },
    keepTaggedNode: (tags) => poiKind(tags) !== null || tags.highway === 'traffic_signals',
  });
}

function parseBbox(text) {
  const parts = String(text).split(',').map(Number);
  if (parts.length !== 4 || parts.some((value) => !Number.isFinite(value))) {
    throw new Error('--bbox vuole minLat,minLon,maxLat,maxLon');
  }
  return { minLat: parts[0], minLon: parts[1], maxLat: parts[2], maxLon: parts[3] };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.input || args.input === true) {
    console.error('Uso: node scripts/build-world-tiles.mjs --input estratto.osm [--out public/world-tiles] [--zoom 14] [--bbox minLat,minLon,maxLat,maxLon] [--dem] [--dem-samples 65] [--dem-zoom 15] [--dem-cache .geo-cache/dem]');
    process.exitCode = 1;
    return;
  }
  const bbox = args.bbox ? parseBbox(args.bbox) : null;
  if (String(args.input).endsWith('.pbf') && !bbox) {
    console.warn('PBF senza --bbox: si terranno in memoria tutti i nodi dell\'estratto.');
  }
  const extract = readExtract(args.input, bbox);
  const options = {
    zoom: args.zoom ? Number(args.zoom) : 14,
    attribution: typeof args.attribution === 'string' ? args.attribution : '© OpenStreetMap contributors (ODbL)',
    bbox,
  };
  const tiles = buildTiles(extract, options);
  if (args.dem) {
    await attachElevation(tiles, {
      demZoom: args['dem-zoom'] ? Number(args['dem-zoom']) : 15,
      demSamples: args['dem-samples'] ? Number(args['dem-samples']) : 65,
      demCache: typeof args['dem-cache'] === 'string' ? args['dem-cache'] : path.join('.geo-cache', 'dem'),
      log: (message) => console.log(message),
    });
  }
  const outDir = typeof args.out === 'string' ? args.out : path.join('public', 'world-tiles');
  const result = await writeTiles(tiles, outDir);
  const sum = (field) => [...tiles.values()].reduce((total, tile) => total + tile[field].length, 0);
  const roads = sum('roads');
  const buildings = sum('buildings');
  const areas = sum('areas');
  const landcover = sum('landcover');
  const pois = sum('pois');
  const signals = sum('signals');
  console.log(
    `nodi ${extract.nodes.size} · way ${extract.ways.length} · strade ${roads} · edifici ${buildings} · aree ${areas} · landcover ${landcover} · POI ${pois} · semafori ${signals}`,
  );
  if (extract.blocks !== undefined) console.log(`blocchi PBF ${extract.blocks}`);
  console.log(`scritti ${result.files} tile (${(result.bytes / 1024 / 1024).toFixed(1)} MB) in ${outDir}`);
  console.log('Servi la cartella come statica e imposta VITE_OPEN_WORLD_DATA_TILE_URL.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}

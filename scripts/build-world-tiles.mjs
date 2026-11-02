#!/usr/bin/env node
/**
 * Genera i bundle geografici XYZ (schemaVersion 1) da un estratto OSM.
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
 * Solo strade e edifici: aree, copertura del suolo e POI richiedono lo schema
 * v2 e il supporto di rendering, che arriveranno dopo.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
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
  return { nodes, ways };
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
      bundle = { schemaVersion: 1, tile, attribution, roads: [], buildings: [] };
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
    if (!isBuilding && !isRoad) continue;
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
    } else {
      if (bbox && !inside(points[0], bbox)) continue;
      tileFor(points[0]).roads.push(roadFeature(way, points));
    }
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
        (Boolean(tags.building) && tags.building !== 'no') || Boolean(tags.highway);
      if (!useful) return false;
      if (!bbox) return true;
      // senza almeno un nodo tenuto la way è fuori dall'area: scartarla subito
      return refs.some((ref) => nodes.has(ref));
    },
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
    console.error('Uso: node scripts/build-world-tiles.mjs --input estratto.osm [--out public/world-tiles] [--zoom 14] [--bbox minLat,minLon,maxLat,maxLon]');
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
  const outDir = typeof args.out === 'string' ? args.out : path.join('public', 'world-tiles');
  const result = await writeTiles(tiles, outDir);
  const roads = [...tiles.values()].reduce((sum, tile) => sum + tile.roads.length, 0);
  const buildings = [...tiles.values()].reduce((sum, tile) => sum + tile.buildings.length, 0);
  console.log(
    `nodi ${extract.nodes.size} · way ${extract.ways.length} · strade ${roads} · edifici ${buildings}`,
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

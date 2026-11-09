#!/usr/bin/env node
/**
 * Server statico dei bundle XYZ generati da `build-world-tiles.mjs`.
 *
 * A differenza di `serve-demo-world-tiles.mjs` (dati sintetici) questo serve
 * una cartella vera, di solito `.geo-cache/palata-tiles` o `public/world-tiles`:
 *
 *   node scripts/serve-world-tiles.mjs --dir .geo-cache/palata-tiles --port 5181
 *
 * Poi in `.env.local`:
 *   VITE_OPEN_WORLD_DATA_TILE_URL=http://127.0.0.1:5181/{z}/{x}/{y}.json
 *   VITE_OPEN_WORLD_DATA_ATTRIBUTION=© OpenStreetMap contributors (ODbL) · Elevazione: © AWS Open Data Terrain Tiles (Terrarium)
 *
 * CORS è aperto perché il gioco gira su un'altra porta (5173): in produzione
 * i tile vanno serviti dallo stesso host o da un CDN con gli stessi header.
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const DEFAULT_ATTRIBUTION =
  '© OpenStreetMap contributors (ODbL) · Elevazione: © AWS Open Data Terrain Tiles (Terrarium)';

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

export function tilePath(dir, url) {
  const match = /^\/(\d+)\/(\d+)\/(\d+)\.json$/.exec(url ?? '');
  if (!match) return null;
  // i tre numeri compongono il percorso: niente traversal, niente query
  return path.join(dir, match[1], match[2], `${match[3]}.json`);
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  const directory = path.resolve(arg('dir', path.join('public', 'world-tiles')));
  const port = Number(arg('port', 5181));
  const host = arg('host', '127.0.0.1');
  const attribution = arg('attribution', DEFAULT_ATTRIBUTION);

  const server = createServer(async (request, response) => {
    response.setHeader('Access-Control-Allow-Origin', '*');
    response.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    response.setHeader('Cache-Control', 'no-store');
    if (request.method === 'OPTIONS') {
      response.writeHead(204).end();
      return;
    }
    const file = tilePath(directory, request.url);
    if (!file) {
      response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('not found');
      return;
    }
    try {
      const body = await readFile(file);
      response.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': body.length,
      });
      response.end(body);
    } catch {
      response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('tile not found');
    }
  });

  server.listen(port, host, () => {
    console.log(`Bundle XYZ su http://${host}:${port}/{z}/{x}/{y}.json`);
    console.log(`Cartella: ${directory}`);
    console.log('');
    console.log('In .env.local:');
    console.log(`VITE_OPEN_WORLD_DATA_TILE_URL=http://${host}:${port}/{z}/{x}/{y}.json`);
    console.log(`VITE_OPEN_WORLD_DATA_ATTRIBUTION=${attribution}`);
  });
}

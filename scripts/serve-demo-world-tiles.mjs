#!/usr/bin/env node
/**
 * Server locale dei bundle geografici XYZ per provare lo streaming.
 *
 * Non usa dati reali: serve un tile sintetico appena a nord del bbox di
 * Palata, con una strada, un incrocio e quattro case. Serve a verificare
 * rendering, collisioni e quota del piano stradale senza dipendere da un
 * endpoint esterno. Gli altri tile rispondono vuoti, così il gestore non
 * riempie la console di 404.
 *
 * Uso:
 *   npm run world:demo
 *   npm run dev:demo
 */
import { createServer } from 'node:http';

const PORT = Number(process.env.DEMO_WORLD_PORT || 5180);
const ATTRIBUTION = 'Demo sintetica locale (nessun dato geografico reale)';
const ZOOM = 14;
/**
 * Il punto sta appena dentro il bbox locale (latMax = 41.925): così il
 * giocatore vede la satellite imagery vera, mentre strada e case sintetiche
 * cominciano subito fuori dal bbox e vengono disegnate dallo streaming.
 */
const DEMO_LAT = 41.9237;
const DEMO_LON = 14.7975;

function tileAt(lat, lon, z) {
  const n = 2 ** z;
  const x = Math.floor(((lon + 180) / 360) * n);
  const latRad = (lat * Math.PI) / 180;
  const y = Math.floor(((1 - Math.asinh(Math.tan(latRad)) / Math.PI) / 2) * n);
  return { z, x, y };
}

const DEMO_TILE = tileAt(DEMO_LAT, DEMO_LON, ZOOM);

function demoRoad(id, name, type, width, points) {
  return {
    id,
    type,
    name,
    width,
    paved: true,
    surface: 'asphalt',
    points: points.map(([lat, lon]) => ({ lat, lon })),
  };
}

function demoBuilding(id, height, south, west, dLat, dLon) {
  return {
    id,
    height,
    points: [
      { lat: south, lon: west },
      { lat: south, lon: west + dLon },
      { lat: south + dLat, lon: west + dLon },
      { lat: south + dLat, lon: west },
    ],
  };
}

function bundle(tile) {
  const demo = tile.z === DEMO_TILE.z && tile.x === DEMO_TILE.x && tile.y === DEMO_TILE.y;
  return {
    schemaVersion: 1,
    tile,
    attribution: ATTRIBUTION,
    roads: demo
      ? [
          demoRoad('demo/main', 'Via dello Streaming', 'secondary', 7, [
            [41.9254, 14.7975],
            [41.927, 14.7975],
            [41.929, 14.7976],
            [41.931, 14.7977],
            [41.934, 14.7982],
          ]),
          demoRoad('demo/cross', 'Via del Tile', 'residential', 5.4, [
            [41.927, 14.7895],
            [41.927, 14.793],
            [41.927, 14.7975],
            [41.927, 14.8015],
            [41.927, 14.8055],
          ]),
        ]
      : [],
    buildings: demo
      ? [
          demoBuilding('demo/house-1', 7.5, 41.9258, 14.79475, 0.00009, 0.00013),
          demoBuilding('demo/house-2', 6.2, 41.9258, 14.79825, 0.00008, 0.00014),
          demoBuilding('demo/house-3', 8.4, 41.9272, 14.79505, 0.0001, 0.00012),
          demoBuilding('demo/house-4', 5.8, 41.9272, 14.79845, 0.00009, 0.00015),
        ]
      : [],
  };
}

const server = createServer((request, response) => {
  response.setHeader('Access-Control-Allow-Origin', '*');
  response.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  response.setHeader('Cache-Control', 'no-store');
  if (request.method === 'OPTIONS') {
    response.writeHead(204).end();
    return;
  }
  const match = /^\/(\d+)\/(\d+)\/(\d+)\.json$/.exec(request.url ?? '');
  if (!match) {
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('not found');
    return;
  }
  const tile = { z: Number(match[1]), x: Number(match[2]), y: Number(match[3]) };
  const body = JSON.stringify(bundle(tile));
  response.writeHead(200, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  response.end(body);
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Bundle demo su http://127.0.0.1:${PORT}/{z}/{x}/{y}.json`);
  console.log(`Tile con strada e case: ${DEMO_TILE.z}/${DEMO_TILE.x}/${DEMO_TILE.y}`);
  console.log('');
  console.log('In un altro terminale:');
  console.log('  npm run dev:demo');
  console.log('');
  console.log('Poi apri:');
  console.log(
    '  http://127.0.0.1:5173/?quality=ultra&autostart=walk&at=41.9237,14.7975',
  );
});

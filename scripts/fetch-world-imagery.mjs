#!/usr/bin/env node
/**
 * Scarica una immagine satellitare unica per tutto il mondo di gioco.
 *
 * Perché: le tile Esri in streaming arrivano solo per i chunk vicini (ogni
 * chunk a zoom 18 richiede ~100 richieste), quindi i campi lontani restavano
 * verdi e sfocati. Qui si prende un solo mosaico Sentinel-2 cloudless (CC BY
 * 4.0, EOX) che copre esattamente il bbox del gioco e lo si salva in
 * `public/geo/world-imagery.jpg`: il gioco lo carica come <img> e ne ritaglia
 * un pezzo per ogni chunk, senza dipendere dallo streaming.
 *
 * Licenza: Sentinel-2 cloudless 2025, © EOX IT Services GmbH, CC BY 4.0,
 * contiene dati Copernicus Sentinel modificati. Vedi ATTRIBUTION.md.
 *
 * Uso: npm run geo:imagery
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

// stessi limiti di src/config.ts (BBOX)
const BBOX = { latMin: 41.815, latMax: 41.925, lonMin: 14.69, lonMax: 14.86 };
// il mondo è più largo che alto: circa 14,1 km per 12,2 km
const METERS_PER_DEG_LAT = 111070.7307022502;
const METERS_PER_DEG_LON = 83019.14918391156;
const HD = process.argv.includes('--hd');
const WIDTH = HD ? 4096 : 2048;
const HEIGHT = Math.round(
  (WIDTH * (BBOX.latMax - BBOX.latMin) * METERS_PER_DEG_LAT) /
    ((BBOX.lonMax - BBOX.lonMin) * METERS_PER_DEG_LON),
);
const NAME = HD ? 'world-imagery-hd' : 'world-imagery';

const ROOT = path.resolve(import.meta.dirname, '..');
const OUT_DIR = path.join(ROOT, 'public', 'geo');

const url =
  'https://tiles.maps.eox.at/wms?service=WMS&version=1.1.1&request=GetMap' +
  '&layers=s2cloudless-2025' +
  `&bbox=${BBOX.lonMin},${BBOX.latMin},${BBOX.lonMax},${BBOX.latMax}` +
  '&srs=EPSG:4326' +
  `&width=${WIDTH}&height=${HEIGHT}` +
  '&format=image/jpeg&styles=';

console.log(`[geo] scarico il mosaico Sentinel-2 ${WIDTH}x${HEIGHT}…`);
const res = await fetch(url);
if (!res.ok) throw new Error(`WMS: HTTP ${res.status}`);
const buf = Buffer.from(await res.arrayBuffer());
if (buf.length < 20_000) throw new Error(`immagine troppo piccola (${buf.length} byte): il WMS ha risposto un errore?`);
if (buf[0] !== 0xff || buf[1] !== 0xd8) throw new Error('la risposta non è un JPEG');

await mkdir(OUT_DIR, { recursive: true });
await writeFile(path.join(OUT_DIR, `${NAME}.jpg`), buf);
await writeFile(
  path.join(OUT_DIR, `${NAME}.json`),
  JSON.stringify(
    {
      width: WIDTH,
      height: HEIGHT,
      bbox: BBOX,
      attribution: 'Sentinel-2 cloudless 2025 — © EOX IT Services GmbH, CC BY 4.0; contiene dati Copernicus Sentinel modificati',
      source: 'https://s2maps.eu',
      generatedAt: new Date().toISOString(),
    },
    null,
    2,
  ),
);
console.log(`[geo] ${NAME}.jpg: ${(buf.length / 1024).toFixed(0)} KB`);

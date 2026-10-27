#!/usr/bin/env node
/**
 * Controllo dei dati geografici prima di dire che "la mappa è a posto".
 * Non modifica nulla: legge heights/osm/canopy/landcover e stampa i numeri che
 * contano per il gioco (copertura, km di strada, ponti, pendenze assurde).
 *
 * Uso: npm run geo:audit
 */
import { readFile, access } from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const GEO = path.join(ROOT, 'public', 'geo');

const exists = async (p) => {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
};

const num = (v, digits = 2) => Number(v).toFixed(digits);
const km = (m) => `${num(m / 1000, 1)} km`;

async function main() {
  const heightsMeta = JSON.parse(await readFile(path.join(GEO, 'heights.json'), 'utf8'));
  const heightBuf = await readFile(path.join(GEO, 'heights.bin'));
  const heights = new Int16Array(heightBuf.buffer, heightBuf.byteOffset, heightBuf.byteLength / 2);
  const osm = JSON.parse(await readFile(path.join(GEO, 'osm.json'), 'utf8'));

  const metersLat = heightsMeta.metersPerDegLat;
  const metersLon = heightsMeta.metersPerDegLon;
  const worldWidth = (heightsMeta.nx - 1) * heightsMeta.step;
  const worldHeight = (heightsMeta.nz - 1) * heightsMeta.step;
  const latMin = heightsMeta.lat - worldHeight / 2 / metersLat;
  const latMax = heightsMeta.lat + worldHeight / 2 / metersLat;
  const lonMin = heightsMeta.lon - worldWidth / 2 / metersLon;
  const lonMax = heightsMeta.lon + worldWidth / 2 / metersLon;
  const project = ([lat, lon]) => ({
    x: (lon - heightsMeta.lon) * metersLon,
    z: -(lat - heightsMeta.lat) * metersLat,
  });
  const sampleHeight = (x, z) => {
    const i = Math.max(0, Math.min(heightsMeta.nx - 1, Math.round((x - heightsMeta.originX) / heightsMeta.step)));
    const j = Math.max(0, Math.min(heightsMeta.nz - 1, Math.round((z - heightsMeta.originZ) / heightsMeta.step)));
    return heights[j * heightsMeta.nx + i] / 10;
  };

  console.log('\n=== Copertura DEM ===');
  console.log(
    `griglia ${heightsMeta.nx}x${heightsMeta.nz} · passo ${heightsMeta.step} m · ` +
      `${heightsMeta.minElevation}–${heightsMeta.maxElevation} m`,
  );
  console.log(`bbox ${num(latMin, 4)}–${num(latMax, 4)} N, ${num(lonMin, 4)}–${num(lonMax, 4)} E`);
  console.log(
    `origine locale (${num(heightsMeta.originX)}, ${num(heightsMeta.originZ)}) · ` +
      `${heights.length} campioni (${(heightBuf.byteLength / 1e6).toFixed(1)} MB)`,
  );

  const byType = new Map();
  const bySurface = new Map();
  let paved = 0;
  let dirt = 0;
  let taggedLanes = 0;
  let taggedWidth = 0;
  let taggedSurface = 0;
  let bridges = 0;
  let tunnels = 0;
  let total = 0;
  let steep = 0;
  let verySteep = 0;
  let outOfBounds = 0;

  for (const road of osm.roads) {
    byType.set(road.t, (byType.get(road.t) ?? 0) + 1);
    const surface = road.sf ?? (road.t === 'track' || road.t === 'path' ? 'dirt' : 'asphalt');
    bySurface.set(surface, (bySurface.get(surface) ?? 0) + 1);
    if (road.ln) taggedLanes++;
    if (road.wd) taggedWidth++;
    if (road.sf) taggedSurface++;
    if (road.b) bridges++;
    if (road.u) tunnels++;
    let prev = null;
    for (const ll of road.c) {
      const p = project(ll);
      if (
        Math.abs(p.x) > heightsMeta.nx * heightsMeta.step * 0.5 ||
        Math.abs(p.z) > heightsMeta.nz * heightsMeta.step * 0.5
      ) {
        outOfBounds++;
        break;
      }
      if (prev) {
        const len = Math.hypot(p.x - prev.x, p.z - prev.z);
        total += len;
        if (!road.b && !road.u && len > 1) {
          const grade = Math.abs(sampleHeight(p.x, p.z) - sampleHeight(prev.x, prev.z)) / len;
          if (grade > 0.18) steep += len;
          if (grade > 0.35) verySteep += len;
        }
      }
      prev = p;
    }
    const isDirt = ['track', 'path', 'footway', 'cycleway', 'bridleway', 'steps'].includes(road.t);
    if (isDirt) dirt += 1;
    else paved += 1;
  }

  console.log('\n=== Strade OSM ===');
  console.log(
    `${osm.roads.length} way · ${km(total)} · ${paved} asfaltate · ${dirt} sterrate/pedonali · ` +
      `${bridges} ponti · ${tunnels} gallerie`,
  );
  console.log(
    `tag: ${taggedLanes} corsie · ${taggedWidth} larghezze · ${taggedSurface} superfici · ` +
      `${outOfBounds} way fuori bbox`,
  );
  console.log(
    `pendenze DEM: ${km(steep)} oltre il 18% · ${km(verySteep)} oltre il 35% ` +
      `(se crescono molto, il DEM/road matching va controllato)`,
  );
  const topTypes = [...byType.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  console.log('classi: ' + topTypes.map(([k, v]) => `${k} ${v}`).join(' · '));
  const topSurfaces = [...bySurface.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  console.log('superfici: ' + topSurfaces.map(([k, v]) => `${k} ${v}`).join(' · '));

  console.log('\n=== Luoghi ===');
  // I primi della risposta OSM non sono i più utili: interessa soprattutto
  // verificare che Palata e i paesi del bbox cadano dove ci si aspetta.
  const placesByDistance = osm.places
    .map((place) => ({ place, p: project([place.lat, place.lon]) }))
    .sort((a, b) => Math.hypot(a.p.x, a.p.z) - Math.hypot(b.p.x, b.p.z));
  for (const { place, p } of placesByDistance.slice(0, 12)) {
    console.log(`${place.n || '(senza nome)'} [${place.k}] → x ${num(p.x)}, z ${num(p.z)}`);
  }

  const canopyPath = path.join(GEO, 'canopy.json');
  console.log('\n=== Chiome e copertura ===');
  if (await exists(canopyPath)) {
    const meta = JSON.parse(await readFile(canopyPath, 'utf8'));
    console.log(
      `canopy ${meta.nx}x${meta.nz} · passo ${meta.step} m · max ${meta.maxHeight} m · ` +
        `${meta.treeCells} celle ≥5 m · ${meta.license}`,
    );
  } else {
    console.log('canopy assente: la vegetazione usa il fallback OSM');
  }
  const lcMeta = path.join(GEO, 'landcover', 'meta.json');
  if (await exists(lcMeta)) {
    const meta = JSON.parse(await readFile(lcMeta, 'utf8'));
    console.log(`landcover ${meta.chunk?.size ?? '?'} m/chunk · fonte ${meta.source} · ${meta.license}`);
  } else {
    console.log('landcover assente: si rigenera con npm run landcover');
  }

  console.log('\n=== Ponti/gallerie da controllare a mano ===');
  const bridgeWays = osm.roads.filter((r) => r.b);
  const tunnelWays = osm.roads.filter((r) => r.u);
  if (!bridgeWays.length && !tunnelWays.length) console.log('nessun ponte o galleria taggato nel bbox');
  for (const road of bridgeWays.slice(0, 8)) {
    const p = project(road.c[Math.floor(road.c.length / 2)]);
    console.log(
      `ponte ${road.n || road.t} · ${road.c.length} punti · ` +
        `x ${num(p.x)}, z ${num(p.z)} · layer ${road.y ?? 0}`,
    );
  }
  if (bridgeWays.length > 8) console.log(`… altri ${bridgeWays.length - 8} ponti`);
  for (const road of tunnelWays) {
    const p = project(road.c[Math.floor(road.c.length / 2)]);
    console.log(
      `galleria ${road.n || road.t} · ${road.c.length} punti · ` +
        `x ${num(p.x)}, z ${num(p.z)} · layer ${road.y ?? 0}`,
    );
  }
}

main().catch((err) => {
  console.error('[geo:audit] errore:', err);
  process.exit(1);
});

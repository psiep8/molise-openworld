#!/usr/bin/env node
/**
 * Acquisizione degli asset 3D del catalogo threejsassets.com.
 *
 * Perché questo script e non un download manuale: gli asset del tier FREE sono
 * gratuiti per l'uso (anche commerciale) ma NON ridistribuibili, e il sito
 * espone un'API ufficiale con chiave personale. Lo script scarica **solo** la
 * lista curata qui sotto, una richiesta alla volta, e tiene i file fuori da git
 * (vedi `.gitignore`): è l'unico modo per rispettare la licenza e restare
 * riproducibili su una macchina nuova, esattamente come `npm run textures`.
 *
 * Uso:
 *   # 1. account gratuito su threejsassets.com → Account → API key (tja_live_…)
 *   # 2. metti la chiave in `.env.local` (ignorato da git):
 *   #    THREEJSASSETS_KEY=tja_live_xxxxxxxx
 *   npm run kit                 # scarica gli asset mancanti + manifest
 *   npm run kit -- --list       # elenca i free del pack (nessuna chiave)
 *   npm run kit -- --index      # indicizza i GLB già in public/citykit/ (senza rete)
 *   npm run kit -- --force      # riscarica tutto
 *   npm run kit -- --only=realistic-sidewalk-01,hedgerow-run
 *
 * Cosa NON facciamo: nessun download di massa del catalogo (la licenza vieta
 * mirror/bulk-export). La lista è quella che il motore usa davvero.
 */
import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const API = 'https://threejsassets.com/api/v1';
const PACK = 'realistic-city';
const OUT_DIR = path.resolve('public/citykit');
const DRACO_SRC = path.resolve('node_modules/three/examples/jsm/libs/draco/gltf');
const DRACO_DST = path.resolve('public/draco');

/**
 * Lista curata del **Realistic City** (tier free): gli asset fotorealistici in
 * scala reale che hanno un senso in un paese molisano. Restano fuori brownstone,
 * skyscraper, canale e metropolitana perché non esistono a Palata e
 * romperebbero la coerenza del mondo.
 *
 * `role` è il contratto col motore (`src/world/citykit.ts`): il codice cerca il
 * ruolo, non il nome del file.
 */
const WANTED = [
  { slug: 'realistic-road-straight-01', role: 'road-surface', note: 'asfalto fotografico + segnaletica, per i nastri OSM' },
  { slug: 'realistic-road-intersection-01', role: 'road-junction', note: 'incrocio: usura e patch nelle zone di giunzione' },
  { slug: 'realistic-sidewalk-01', role: 'sidewalk', note: 'lastre in cemento + cordolo in granito, per marciapiedi OSM' },
  { slug: 'realistic-plaza-paving-01', role: 'plaza', note: 'pavimentazione della piazza' },
  { slug: 'realistic-street-tree-01', role: 'tree-street', note: 'albero di strada con chioma volumetrica' },
  { slug: 'realistic-park-tree-01', role: 'tree-park', note: 'albero da parco/bosco' },
  { slug: 'realistic-street-lamp-01', role: 'lamp', note: 'lampione stradale' },
  { slug: 'realistic-traffic-light-01', role: 'traffic-light', note: 'semaforo' },
  { slug: 'realistic-street-sign-01', role: 'sign', note: 'segnaletica verticale' },
  { slug: 'realistic-bench-01', role: 'bench', note: 'panchina' },
  { slug: 'realistic-trash-bin-01', role: 'bin', note: 'cestino' },
  { slug: 'realistic-car-sedan-01', role: 'car', note: 'berlina: auto parcheggiate e traffico' },
  { slug: 'realistic-rock-boulder-01', role: 'boulder', note: 'massi per scarpate e muretti a secco' },
];

/**
 * Seconda lista: modelli **low-poly** degli altri pack gratuiti, presi solo per
 * quello che al Realistic City manca. Sono oggetti piccoli e senza dettagli
 * leggibili da vicino (siepe, canneto, rovo, masso, relitto): la sagoma è
 * quella giusta e il costo è 0,4–2k triangoli l'una, quindi non spostano la resa
 * e non pesano.
 */
const SCENERY = [
  { slug: 'hedgerow-run', role: 'hedge', name: 'Hedgerow Run', note: 'siepi lungo le strade di campagna' },
  { slug: 'bush-round-01', role: 'bush', name: 'Bush Round 01', note: 'rovi e cespugli ai bordi delle siepi' },
  { slug: 'cattail-reed-clump', role: 'reed', name: 'Cattail Reed Clump', note: 'canneti lungo i torrenti' },
  { slug: 'mossy-boulder', role: 'rock', name: 'Mossy Boulder', note: 'massi muschiosi sui pendii' },
  { slug: 'moraine-boulder', role: 'rock', name: 'Moraine Boulder', note: 'massi di morena' },
  { slug: 'railway-rock-cluster', role: 'rock', name: 'Railway Rock Cluster', note: 'pietraie basse' },
  { slug: 'wrecked-car', role: 'wreck', name: 'Wrecked Car', note: 'relitto abbandonato fuori paese' },
];

/**
 * Berline low-poly per alternare le auto in sosta: il davanti è a +Z (i fari
 * rossi stanno a -Z), quindi si usano con lo stesso yaw della berlina del kit
 * Realistic City. Sono varianti di un solo ruolo (`car-lowpoly`).
 */
const LOWPOLY_CARS = [
  { slug: 'paris-car-01', role: 'car-lowpoly', name: 'Paris Car 01', note: 'utilitaria low-poly in sosta' },
  { slug: 'family-sedan', role: 'car-lowpoly', name: 'Family Sedan', note: 'berlina low-poly in sosta' },
  { slug: 'pastel-sedan', role: 'car-lowpoly', name: 'Pastel Sedan', note: 'berlina low-poly in sosta' },
  { slug: 'white-sports-convertible', role: 'car-lowpoly', name: 'White Sports Convertible', note: 'due posti low-poly in sosta' },
];

/**
 * Campagna: case coloniche, rimesse e alberi da frutto/ulivi.
 *
 * Le case di Palata restano quelle vere di OSM: questi modelli servono **solo
 * fuori dal paese**, sparsi lungo le strade di campagna, dove una sagoma
 * low-poly a 30 m non si distingue da una masseria. Ogni casale viene
 * registrato nell'indice delle collisioni, quindi il giocatore non ci passa
 * attraverso e vegetazione ed erba non ci crescono dentro.
 */
const RURAL = [
  { slug: 'farmhouse', role: 'house', name: 'Farmhouse', note: 'casale di campagna' },
  { slug: 'bungalow-house', role: 'house', name: 'Bungalow House', note: 'casa bassa con veranda' },
  { slug: 'two-story-house', role: 'house', name: 'Two Story House', note: 'casa a due piani' },
  { slug: 'ranch-house', role: 'house', name: 'Ranch House', note: 'casa di pietra a un piano' },
  { slug: 'home-cottage-01', role: 'house', name: 'Home Cottage 01', note: 'cottage piccolo' },
  { slug: 'home-thatched-house-01', role: 'house', name: 'Home Thatched House 01', note: 'casa dal tetto di paglia' },
  { slug: 'garden-shed', role: 'shed', name: 'Garden Shed', note: 'rimessa da attrezzi' },
  { slug: 'garage', role: 'shed', name: 'Garage', note: 'garage di campagna' },
];

/** Alberi da campo: ulivi, frutteti e conifere, tutti con base a y = 0. */
const COUNTRY_TREES = [
  { slug: 'olive-tree', role: 'tree-country', name: 'Olive Tree', note: 'ulivo' },
  { slug: 'apple-tree', role: 'tree-country', name: 'Apple Tree', note: 'melo da frutto' },
  { slug: 'birch-tree', role: 'tree-country', name: 'Birch Tree', note: 'betulla' },
  { slug: 'lineside-pine', role: 'tree-country', name: 'Lineside Pine', note: 'pino di bordo strada' },
  { slug: 'arborvitae-conifer', role: 'tree-country', name: 'Arborvitae Conifer', note: 'conifera da giardino' },
  { slug: 'autumn-maple', role: 'tree-country', name: 'Autumn Maple', note: 'acero in autunno' },
];

const CURATED = [...WANTED, ...SCENERY, ...LOWPOLY_CARS, ...RURAL, ...COUNTRY_TREES];

const args = process.argv.slice(2);
const has = (flag) => args.includes(flag);
const value = (name) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
};

const force = has('--force');
const listOnly = has('--list');
// `--index` serve a chi scarica i free a mano dal sito (senza chiave API):
// mette i .glb in public/citykit/ e questo modo scrive il manifest senza rete.
const indexOnly = has('--index');
const only = (value('only') ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

async function loadEnvFiles() {
  for (const name of ['.env.local', '.env']) {
    let text;
    try {
      text = await readFile(name, 'utf8');
    } catch {
      continue;
    }
    for (const line of text.split(/\r?\n/)) {
      if (!line || line.trimStart().startsWith('#')) continue;
      const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
      if (!m) continue;
      if (process.env[m[1]] === undefined) {
        process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
      }
    }
  }
}

async function api(pathname, key) {
  const res = await fetch(`${API}${pathname}`, {
    headers: key ? { Authorization: `Bearer ${key}` } : {},
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const err = body?.error;
    throw new Error(`${res.status} ${err?.code ?? res.statusText}${err?.message ? ` — ${err.message}` : ''}`.trim());
  }
  return body;
}

function human(bytes) {
  if (bytes >= 1048576) return `${(bytes / 1048576).toFixed(2)} MB`;
  return `${Math.round(bytes / 1024)} KB`;
}

function humanize(slug) {
  return slug
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

async function readJson(file) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Metadati letti dal GLB stesso, senza dipendenze e senza rete: magic `glTF`,
 * chunk JSON, somma degli indici delle primitive triangolari. Serve per
 * indicizzare anche gli asset che non stanno nel catalogo di un singolo pack.
 */
function glbInfo(buffer) {
  if (buffer.length < 20 || buffer.subarray(0, 4).toString('ascii') !== 'glTF') return null;
  let json;
  try {
    const jsonLen = buffer.readUInt32LE(12);
    json = JSON.parse(buffer.subarray(20, 20 + jsonLen).toString('utf8'));
  } catch {
    return null;
  }
  let triangles = 0;
  for (const mesh of json.meshes ?? []) {
    for (const primitive of mesh.primitives ?? []) {
      if ((primitive.mode ?? 4) !== 4) continue;
      const accessor =
        primitive.indices !== undefined
          ? json.accessors?.[primitive.indices]
          : json.accessors?.[primitive.attributes?.POSITION];
      if (accessor?.count) triangles += accessor.count / 3;
    }
  }
  return {
    triangles: Math.round(triangles),
    meshes: (json.meshes ?? []).length,
    materials: (json.materials ?? []).length,
    images: (json.images ?? []).length,
  };
}

async function listFree() {
  const pack = (await api(`/catalog/packs/${PACK}`)).data;
  const free = pack.assets.filter((a) => a.tier === 'free');
  const wanted = new Set(CURATED.map((w) => w.slug));
  console.log(`\n${pack.name} — ${free.length} asset nel tier free (${pack.assets.length} totali)\n`);
  for (const a of free) {
    const mark = wanted.has(a.slug) ? '✓' : ' ';
    console.log(`  ${mark} ${a.slug.padEnd(34)} ${String(a.triangles).padStart(7)} tri  ${human(a.file_size_bytes).padStart(9)}  ${a.category}`);
  }
  const missing = WANTED.filter((w) => !free.some((a) => a.slug === w.slug));
  if (missing.length) {
    console.log(`\n⚠ nel catalogo non risultano più free: ${missing.map((m) => m.slug).join(', ')}`);
  }
  console.log(
    `\n${WANTED.length} asset del pack + ${SCENERY.length + LOWPOLY_CARS.length} modelli low-poly degli altri pack.` +
      `\nNessun file toccato (--list).\n`,
  );
}

async function copyDecoders() {
  const files = ['draco_decoder.js', 'draco_decoder.wasm', 'draco_wasm_wrapper.js'];
  await mkdir(DRACO_DST, { recursive: true });
  for (const file of files) {
    try {
      await stat(path.join(DRACO_DST, file));
    } catch {
      await copyFile(path.join(DRACO_SRC, file), path.join(DRACO_DST, file));
    }
  }
}

async function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

async function writeOutputs(manifest) {
  manifest.sort((a, b) => a.role.localeCompare(b.role) || a.slug.localeCompare(b.slug));

  await writeFile(
    path.join(OUT_DIR, 'manifest.json'),
    `${JSON.stringify(
      {
        version: 1,
        source: 'https://threejsassets.com',
        pack: `${PACK} + low-poly free packs`,
        packUrl: 'https://threejsassets.com/packs',
        license: 'Free Commercial License (threejsassets.com)',
        licenseUrl: 'https://threejsassets.com/license#free-asset-license',
        note: 'File NON ridistribuibili: restano fuori dal repository. Rigenerabili con `npm run kit`.',
        generatedAt: new Date().toISOString(),
        assets: manifest,
      },
      null,
      2,
    )}\n`,
  );

  await writeFile(
    path.join(OUT_DIR, 'NOTICE.md'),
    [
      '# City kit — provenienza e licenza',
      '',
      'Modelli 3D da <https://threejsassets.com>: pack **Realistic City** (tier free)',
      'per strade, arredo urbano e veicoli, più modelli **low-poly** degli altri pack',
      'gratuiti per siepi, canneti, rovi, massi e relitti.',
      '',
      '- Licenza: **Free Commercial License** — uso in prodotti, anche commerciali, senza obbligo di attribuzione.',
      '- Vietata la ridistribuzione dei file: questa cartella è in `.gitignore` e **non** va pubblicata',
      '  come asset pack, mirror o dataset.',
      '- Rigenerazione: `npm run kit` (richiede `THREEJSASSETS_KEY` in `.env.local`) oppure',
      '  `npm run kit -- --index` sui file scaricati a mano.',
      '- Catalogo usato: `public/citykit/manifest.json`.',
      '',
      '## Asset',
      '',
      '| Ruolo | Asset | Triangoli |',
      '| --- | --- | --- |',
      ...manifest.map((a) => `| ${a.role} | [${a.name}](${a.url}) | ${a.triangles} |`),
      '',
      'Licenza completa: <https://threejsassets.com/license>.',
      '',
    ].join('\n'),
  );

  await copyDecoders();
}

/**
 * Indicizzazione offline: guarda cosa c'è in `public/citykit/`, tiene solo i
 * GLB della lista curata, ne legge i metadati dal file e riscrive manifest e
 * NOTICE. Non serve né rete né chiave: è il percorso di chi scarica a mano.
 */
async function indexManual() {
  await mkdir(OUT_DIR, { recursive: true });
  const previous = (await readJson(path.join(OUT_DIR, 'manifest.json')))?.assets ?? [];
  const previousBySlug = new Map(previous.map((a) => [a.slug, a]));

  let files = [];
  try {
    files = (await readdir(OUT_DIR)).filter((name) => name.endsWith('.glb')).sort();
  } catch {
    /* cartella vuota */
  }
  const present = new Map(files.map((name) => [name.slice(0, -4), name]));
  const manifest = [];
  const missing = [];

  for (const want of CURATED) {
    const file = present.get(want.slug);
    if (!file) {
      missing.push(want.slug);
      continue;
    }
    const buffer = await readFile(path.join(OUT_DIR, file));
    const info = glbInfo(buffer);
    if (!info) {
      missing.push(`${want.slug} (non è un GLB)`);
      continue;
    }
    const prev = previousBySlug.get(want.slug);
    manifest.push({
      slug: want.slug,
      name: want.name ?? prev?.name ?? humanize(want.slug),
      role: want.role,
      note: want.note,
      category: prev?.category ?? 'scenery',
      triangles: info.triangles || prev?.triangles || 0,
      bytes: buffer.length,
      sha256: await sha256(buffer),
      version: prev?.version ?? null,
      url: prev?.url ?? `https://threejsassets.com/assets/${want.slug}`,
    });
    console.log(`  ✓ ${want.slug.padEnd(34)} ${String(info.triangles).padStart(7)} tri  ${human(buffer.length).padStart(9)}`);
  }

  if (!manifest.length) {
    console.error(
      `\nNessun GLB in public/citykit/.\nScarica gli asset free da https://threejsassets.com ` +
        `(pulsante Download, file <slug>.glb) e rilancia: npm run kit -- --index\n`,
    );
    process.exitCode = 1;
    return;
  }

  await writeOutputs(manifest);
  console.log(`\nIndicizzati ${manifest.length}/${CURATED.length} asset del kit.`);
  if (missing.length) console.log(`File assenti (restano fuori dal manifest): ${missing.join(', ')}`);
  const curatedFiles = new Set(CURATED.map((w) => `${w.slug}.glb`));
  const unused = files.filter((name) => !curatedFiles.has(name));
  if (unused.length) console.log(`${unused.length} altri GLB in public/citykit/ non sono usati dal motore.`);
  console.log('Riavvia `npm run dev`: il motore carica il kit quando trova il manifest.\n');
}

async function main() {
  await loadEnvFiles();

  if (listOnly) {
    await listFree();
    return;
  }

  if (indexOnly) {
    await indexManual();
    return;
  }

  const key = process.env.THREEJSASSETS_KEY ?? process.env.TJA_API_KEY ?? '';
  if (!key) {
    console.error(
      [
        '',
        'Manca la chiave API (tja_live_…).',
        '',
        '  1. crea un account gratuito su https://threejsassets.com',
        '  2. Account → API key → crea una chiave con scope catalog:read + downloads:read',
        '  3. scrivi in .env.local (già ignorato da git):',
        '       THREEJSASSETS_KEY=tja_live_xxxxxxxx',
        '  4. rilancia: npm run kit',
        '',
        `  Vuoi solo vedere cosa c'è nel tier free?  npm run kit -- --list`,
        `  Hai già i file?                            npm run kit -- --index`,
        '',
      ].join('\n'),
    );
    process.exitCode = 1;
    return;
  }

  const me = (await api('/me', key)).data;
  console.log(
    `Chiave ok: ${me.account?.email ?? 'account'} · ${me.entitlements?.asset_count ?? '?'} asset scaricabili ` +
      `(${me.entitlements?.pack_count ?? 0} pack)`,
  );

  const catalog = (await api(`/catalog/packs/${PACK}`)).data;
  const bySlug = new Map(catalog.assets.map((a) => [a.slug, a]));

  await mkdir(OUT_DIR, { recursive: true });
  const previous = (await readJson(path.join(OUT_DIR, 'manifest.json')))?.assets ?? [];
  const previousBySlug = new Map(previous.map((a) => [a.slug, a]));

  const selected = CURATED.filter((w) => (only.length ? only.includes(w.slug) : true));
  const manifest = [];
  let downloaded = 0;
  let skipped = 0;
  const failed = [];

  for (const want of selected) {
    const meta = bySlug.get(want.slug);
    if (meta && meta.tier !== 'free') {
      failed.push(`${want.slug}: nel frattempo è diventato premium, salto`);
      continue;
    }

    const file = path.join(OUT_DIR, `${want.slug}.glb`);
    const prev = previousBySlug.get(want.slug);
    const expected = meta?.file_size_bytes ?? prev?.bytes;
    if (!force && prev && expected) {
      try {
        const info = await stat(file);
        if (info.size === expected) {
          manifest.push({ ...prev, role: want.role, note: want.note });
          skipped++;
          continue;
        }
      } catch {
        /* file mancante: si riscarica */
      }
    }

    process.stdout.write(`  ↓ ${want.slug} … `);
    try {
      const res = await fetch(`${API}/assets/${want.slug}/download?edition=glb`, {
        headers: { Authorization: `Bearer ${key}` },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        const err = body?.error;
        throw new Error(`${res.status} ${err?.code ?? res.statusText}${err?.message ? ` — ${err.message}` : ''}`);
      }
      const buffer = Buffer.from(await res.arrayBuffer());
      const info = glbInfo(buffer);
      if (!info) throw new Error('non è un GLB valido');
      if (buffer.length < 1024) throw new Error(`file sospetto: ${buffer.length} byte`);

      const part = `${file}.part`;
      await writeFile(part, buffer);
      await rename(part, file);

      manifest.push({
        slug: want.slug,
        name: meta?.name ?? want.name ?? prev?.name ?? humanize(want.slug),
        role: want.role,
        note: want.note,
        category: meta?.category ?? prev?.category ?? 'scenery',
        triangles: info.triangles || meta?.triangles || prev?.triangles || 0,
        bytes: buffer.length,
        sha256: await sha256(buffer),
        version: meta?.version ?? prev?.version ?? null,
        url: meta?.url ?? `https://threejsassets.com/assets/${want.slug}`,
      });
      downloaded++;
      console.log(human(buffer.length));
    } catch (error) {
      await rm(`${file}.part`, { force: true });
      const message = error instanceof Error ? error.message : String(error);
      console.log(`✗ ${message}`);
      failed.push(`${want.slug}: ${message}`);
    }

    // Le API hanno un budget più stretto per i download: una alla volta, con pausa.
    await new Promise((r) => setTimeout(r, 700));
  }

  // Chi non è stato selezionato ma era già su disco resta nel manifest: così un
  // `--only=` non cancella la cronologia degli altri asset.
  for (const prev of previous) {
    if (!manifest.some((a) => a.slug === prev.slug)) manifest.push(prev);
  }

  await writeOutputs(manifest);

  console.log(
    `\nScaricati ${downloaded}, già presenti ${skipped}${failed.length ? `, falliti ${failed.length}` : ''}.` +
      `\nManifest: public/citykit/manifest.json · decodificatore Draco in public/draco/.`,
  );
  for (const f of failed) console.error(`  ✗ ${f}`);
  if (failed.length) process.exitCode = 1;
  if (downloaded || skipped)
    console.log('Riavvia `npm run dev`: il motore carica il kit quando trova il manifest.\n');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

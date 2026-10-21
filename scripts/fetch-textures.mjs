#!/usr/bin/env node
/**
 * Scarica le texture PBR usate dal gioco da fonti CC0:
 *
 *  - Poly Haven  → superfici (asfalto, sterrato, intonaco, coppi, erba, roccia,
 *                  corteccia, cemento per i marciapiedi)
 *  - ambientCG   → foglie con mappa Opacity (leaf card per le chiome)
 *  - three.js    → normali dell'acqua (usate da examples/webgl_shaders_ocean)
 *
 * Le immagini finiscono in `public/textures/<nome>/` con nomi stabili
 * (`color.jpg`, `normal.jpg`, `rough.jpg`, `opacity.jpg`) e vengono servite da
 * Vite come asset statici. Lo script è idempotente: salta i file già presenti.
 *
 *   node scripts/fetch-textures.mjs            # scarica solo ciò che manca
 *   node scripts/fetch-textures.mjs --force    # riscarica tutto
 *
 * Provenienza e licenze sono scritte in `public/textures/ATTRIBUTION.md`.
 */
import { mkdir, writeFile, stat, readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';

const execFileAsync = promisify(execFile);
const ROOT = path.resolve(import.meta.dirname, '..');
const OUT = path.join(ROOT, 'public', 'textures');
const FORCE = process.argv.includes('--force');
const SIZE = '1k';

/** chiave locale → slug Poly Haven */
const ASSETS = {
  asphalt: 'asphalt_02',
  gravel: 'gravel_road',
  plaster: 'plastered_wall',
  rooftiles: 'clay_roof_tiles_02',
  grass: 'aerial_grass_rock',
  rock: 'rock_face',
  bark: 'bark_brown_02',
  concrete: 'concrete_floor',
};

/** mappa Poly Haven → nome file locale */
const MAPS = {
  Diffuse: 'color',
  nor_gl: 'normal',
  Rough: 'rough',
  AO: 'ao',
};

/**
 * ambientCG: fogli con alpha reale per le chiome degli alberi.
 * Il pacchetto ZIP contiene `_Opacity.jpg` (scala di grigi) che diventa la
 * `alphaMap` del materiale: senza quella, una texture foglia è solo un riquadro verde.
 */
const LEAF = {
  id: 'Leaf003',
  zip: 'https://ambientcg.com/get?file=Leaf003_1K-JPG.zip',
  files: {
    'Leaf003_1K-JPG_Color': 'color',
    'Leaf003_1K-JPG_NormalGL': 'normal',
    'Leaf003_1K-JPG_Roughness': 'rough',
    'Leaf003_1K-JPG_Opacity': 'opacity',
    'Leaf003_1K-JPG_AmbientOcclusion': 'ao',
  },
};

/** Normali dell'acqua: file singolo dalla repo three.js (licenza MIT). */
const WATER_NORMALS = [
  'https://raw.githubusercontent.com/mrdoob/three.js/r186/examples/textures/waternormals.jpg',
  'https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/textures/waternormals.jpg',
];

const log = (...a) => console.log('[textures]', ...a);

async function exists(file) {
  try {
    await stat(file);
    return true;
  } catch {
    return false;
  }
}

async function download(url, file) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} — ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  await writeFile(file, buf);
  return buf.length;
}

/** Scompatta uno ZIP (usa `unzip` se c'è, altrimenti `tar` di Windows). */
async function unzip(zipFile, destDir) {
  try {
    await execFileAsync('unzip', ['-o', '-q', zipFile, '-d', destDir]);
  } catch {
    await execFileAsync('tar', ['-xf', zipFile, '-C', destDir]);
  }
}

async function fetchPolyhaven(lines) {
  let bytes = 0;
  let files = 0;
  for (const [key, slug] of Object.entries(ASSETS)) {
    log(`asset ${slug}`);
    const res = await fetch(`https://api.polyhaven.com/files/${slug}`);
    if (!res.ok) throw new Error(`API ${res.status} per ${slug}`);
    const data = await res.json();
    const dir = path.join(OUT, key);
    await mkdir(dir, { recursive: true });

    for (const [mapName, role] of Object.entries(MAPS)) {
      const entry = data[mapName]?.[SIZE]?.jpg?.url;
      if (!entry) {
        log(`  ${mapName}: non disponibile a ${SIZE}, salto`);
        continue;
      }
      const file = path.join(dir, `${role}.jpg`);
      if (!FORCE && (await exists(file))) {
        log(`  ${role}.jpg già presente`);
        continue;
      }
      const size = await download(entry, file);
      bytes += size;
      files++;
      log(`  ${role}.jpg  ${(size / 1024).toFixed(0)} KB`);
    }

    lines.push(
      `| ${key} | [${slug}](https://polyhaven.com/a/${slug}) | CC0 1.0 | https://dl.polyhaven.org/file/ph-assets/Textures/jpg/${SIZE}/${slug}/ |`,
    );
  }
  return { bytes, files };
}

async function fetchLeaf() {
  const dir = path.join(OUT, 'foliage');
  const first = path.join(dir, 'color.jpg');
  if (!FORCE && (await exists(first))) {
    log('foliage già presente');
    return { bytes: 0, files: 0 };
  }
  await mkdir(dir, { recursive: true });
  const tmp = path.join(OUT, '.tmp-leaf');
  await mkdir(tmp, { recursive: true });
  log(`scarico ${LEAF.id} (ambientCG)`);
  const zipFile = path.join(tmp, `${LEAF.id}.zip`);
  const bytes = await download(LEAF.zip, zipFile);
  await unzip(zipFile, tmp);

  let files = 0;
  for (const [stem, role] of Object.entries(LEAF.files)) {
    const src = path.join(tmp, `${stem}.jpg`);
    if (!(await exists(src))) {
      log(`  ${stem}.jpg non trovato nello zip, salto`);
      continue;
    }
    await writeFile(path.join(dir, `${role}.jpg`), await readFile(src));
    files++;
    log(`  ${role}.jpg`);
  }
  return { bytes, files };
}

async function fetchWaterNormals() {
  const dir = path.join(OUT, 'water');
  const file = path.join(dir, 'normals.jpg');
  if (!FORCE && (await exists(file))) {
    log('water/normals.jpg già presente');
    return { bytes: 0, files: 0 };
  }
  await mkdir(dir, { recursive: true });
  for (const url of WATER_NORMALS) {
    try {
      const size = await download(url, file);
      log(`water/normals.jpg  ${(size / 1024).toFixed(0)} KB (${url.includes('r186') ? 'r186' : 'dev'})`);
      return { bytes: size, files: 1 };
    } catch (err) {
      log(`  impossibile da ${url}: ${err.message}`);
    }
  }
  throw new Error('normali dell\'acqua non disponibili');
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const lines = [
    '# Texture — provenienza e licenze',
    '',
    'Tutte le immagini di questa cartella sono rilasciate con licenza **CC0 1.0**',
    '(pubblico dominio) o con licenza permessiva equivalente: si possono usare,',
    "modificare e ridistribuire senza attribuzione obbligatoria. L'attribuzione",
    'è comunque riportata qui sotto per trasparenza.',
    '',
    'Scaricate con `node scripts/fetch-textures.mjs` (1K JPG, mappe diffuse,',
    'normal GL, roughness, ambient occlusion e opacity dove presente).',
    '',
    '| cartella | asset | licenza | fonte |',
    '| --- | --- | --- | --- |',
  ];

  const a = await fetchPolyhaven(lines);
  const b = await fetchLeaf();
  const c = await fetchWaterNormals();

  lines.push(
    `| foliage | [${LEAF.id}](https://ambientcg.com/a/${LEAF.id.toLowerCase()}) | CC0 1.0 | https://ambientcg.com/get?file=${LEAF.id}_1K-JPG.zip |`,
    '| water | [waternormals.jpg](https://github.com/mrdoob/three.js/blob/dev/examples/textures/waternormals.jpg) | MIT | three.js examples |',
  );

  const bytes = a.bytes + b.bytes + c.bytes;
  const files = a.files + b.files + c.files;
  lines.push('', `Totale scaricato in questa esecuzione: ${(bytes / 1e6).toFixed(1)} MB (${files} file).`, '');
  await writeFile(path.join(OUT, 'ATTRIBUTION.md'), lines.join('\n'));
  log(`fatto: ${files} file, ${(bytes / 1e6).toFixed(1)} MB`);
}

main().catch((err) => {
  console.error('[textures] errore:', err.message);
  process.exit(1);
});

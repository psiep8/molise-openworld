#!/usr/bin/env node
/**
 * Importa i corpi, le teste e i capelli umani forniti dall'utente.
 *
 * I GLB originali stanno in `incoming-glb/characters/` (ignorata da git, ~190 MB).
 * Qui vengono copiati in `public/characters/` con uno slug stabile e descritti in
 * `public/characters/manifest.json`: dimensioni, unità, licenza e autore.
 *
 * I modelli Sketchfab arrivano in unità e orientamenti diversi (un corpo in
 * centimetri, uno in decimetri, le teste con il wrapper Sketchfab ruotato). NON
 * li riscaliamo nel file: il manifest dichiara l'altezza desiderata (`fitHeight`)
 * e il laboratorio (`characters.html`) normalizza al caricamento con un Box3.
 * Così un aggiornamento dell'asset non richiede di riscrivere il GLB e i file
 * restano identici all'originale dell'autore.
 *
 *   node scripts/import-characters.mjs
 *   node scripts/import-characters.mjs --check
 *
 * I GLB non sono versionati (come le auto): chi clona fornisce gli originali.
 * Il manifest sì, con autori e licenze CC BY 4.0.
 */
import { access, copyFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const SRC = path.join(ROOT, 'incoming-glb/characters');
const DST = path.join(ROOT, 'public/characters');
const MANIFEST = path.join(DST, 'manifest.json');
const checkOnly = process.argv.includes('--check');

/**
 * `fitHeight`: altezza visibile a cui il modello viene portato (metri).
 * `ground`: appoggia il punto più basso a y=0 (corpi) invece di centrare (teste).
 */
const MODELS = [
  {
    slug: 'donna-corpo',
    file: 'female_body_base_mesh.glb',
    title: 'Female body base mesh',
    author: 'gus_thewise',
    source: 'https://skfb.ly/orzAs',
    license: 'CC BY 4.0',
    kind: 'body',
    sex: 'donna',
    fitHeight: 1.68,
    ground: true,
  },
  {
    slug: 'uomo-corpo',
    file: 'male_body.glb',
    title: 'Male Body',
    author: 'Alexander Antipov',
    source: 'https://skfb.ly/6zuQA',
    license: 'CC BY 4.0',
    kind: 'body',
    sex: 'uomo',
    fitHeight: 1.8,
    ground: true,
  },
  {
    slug: 'coppia-basemesh',
    file: 'male_and_female_basemeshes_-_3d_study_pack.glb',
    title: 'Male and Female Basemeshes - 3D Study Pack',
    author: 'ronildo.facanha',
    source: 'https://skfb.ly/p86JI',
    license: 'CC BY 4.0',
    kind: 'body-pair',
    fitHeight: 1.78,
    ground: true,
  },
  {
    slug: 'testa-donna',
    file: 'female_head_sculpt.glb',
    title: 'Female Head Sculpt',
    author: 'Aconear',
    source: 'https://skfb.ly/oGBKK',
    license: 'CC BY 4.0',
    kind: 'head',
    sex: 'donna',
    fitHeight: 0.26,
    ground: false,
  },
  {
    slug: 'testa-uomo',
    file: 'realistic_male_head.glb',
    title: 'Realistic Male head',
    author: 'Ouail',
    source: 'https://skfb.ly/oNoGX',
    license: 'CC BY 4.0',
    kind: 'head',
    sex: 'uomo',
    fitHeight: 0.27,
    ground: false,
  },
  {
    slug: 'capelli-pack',
    file: 'hair_pack_part_2.glb',
    title: 'Hair Pack (part 2)',
    author: 'rendysix',
    source: 'https://skfb.ly/pENtH',
    license: 'CC BY 4.0',
    kind: 'hair',
    fitHeight: 0.32,
    ground: false,
  },
  {
    slug: 'capelli-uomo-lowpoly',
    file: 'free_male_fashion_hair_collection_01_lowpoly.glb',
    title: 'FREE Male Fashion Hair collection 01 lowpoly',
    author: 'Vincent Freelance',
    source: 'https://skfb.ly/oVrKr',
    license: 'CC BY 4.0',
    kind: 'hair',
    sex: 'uomo',
    fitHeight: 0.3,
    ground: false,
  },
];

async function sha256(file) {
  const buffer = await readFile(file);
  return createHash('sha256').update(buffer).digest('hex');
}

async function main() {
  await mkdir(DST, { recursive: true });
  const entries = [];

  for (const model of MODELS) {
    const src = path.join(SRC, model.file);
    const dst = path.join(DST, model.file);
    let exists = true;
    try {
      await access(src);
    } catch {
      exists = false;
    }
    let bytes = 0;
    let hash = '';
    if (exists) {
      bytes = (await stat(src)).size;
      hash = await sha256(src);
      if (!checkOnly) await copyFile(src, dst);
    }
    entries.push({
      slug: model.slug,
      file: model.file,
      title: model.title,
      author: model.author,
      source: model.source,
      license: model.license,
      kind: model.kind,
      ...(model.sex ? { sex: model.sex } : {}),
      fitHeight: model.fitHeight,
      ground: model.ground,
      bytes,
      sha256: hash,
      available: exists,
      usage:
        model.kind === 'body' || model.kind === 'body-pair'
          ? 'Scultura statica: non ha skin/scheletro, non può essere animata senza rigging.'
          : 'Accessorio statico da mostrare o agganciare alla testa del rig Mixamo.',
    });
  }

  const manifest = {
    version: 1,
    note:
      'Modelli Sketchfab dell\'utente, licenza CC BY 4.0. I GLB non sono versionati: ' +
      'rigenerare con `node scripts/import-characters.mjs` dagli originali in incoming-glb/characters/.',
    models: entries,
  };

  if (checkOnly) {
    for (const model of entries) {
      if (!model.available) throw new Error(`manca ${path.join(SRC, model.file)}`);
      try {
        await access(path.join(DST, model.file));
      } catch {
        throw new Error(`manca ${path.join(DST, model.file)}: esegui l'import`);
      }
    }
    console.log(`ok: ${entries.length} personaggi presenti in ${path.relative(ROOT, DST)}`);
    return;
  }

  await writeFile(MANIFEST, JSON.stringify(manifest, null, 2) + '\n');
  console.log(`scritti ${entries.length} modelli in ${path.relative(ROOT, DST)}`);
  for (const model of entries) {
    console.log(`  ${model.slug.padEnd(22)} ${(model.bytes / 1024 / 1024).toFixed(1).padStart(6)} MB`);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});

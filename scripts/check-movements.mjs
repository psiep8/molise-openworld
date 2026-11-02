#!/usr/bin/env node
/**
 * Valida tutti i movimenti Posecode del progetto.
 *
 * Non controlla solo la sintassi: misura anche la "cucitura" del loop. Per un
 * ciclo (camminata, corsa, respiro) il campione a fine timeline deve combaciare
 * con quello a inizio timeline, altrimenti a ogni giro il personaggio scatta.
 *
 *   node scripts/check-movements.mjs
 */
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import * as THREE from 'three';
import { parse } from 'posecode-parser';
import { buildMannequin, buildTimeline } from 'posecode-render';

const ROOT = path.resolve(import.meta.dirname, '..');
const DIR = path.join(ROOT, 'src/posecode/movements');

const QUAT = new THREE.Quaternion();
const EULER = new THREE.Euler();

function poseSnapshot(timeline, mannequin, t) {
  const local = new Map();
  timeline.sample(t, mannequin.bones);
  for (const [id, bone] of mannequin.bones) {
    // il timeline scrive euler locali: leggiamo quelli, non le matrici mondo
    local.set(id, { x: bone.rotation.x, y: bone.rotation.y, z: bone.rotation.z });
  }
  return local;
}

function maxAngleDelta(a, b) {
  let max = 0;
  for (const [id, ea] of a) {
    const eb = b.get(id);
    if (!eb) continue;
    QUAT.setFromEuler(EULER.set(ea.x, ea.y, ea.z, 'XYZ'));
    const qa = QUAT.clone();
    QUAT.setFromEuler(EULER.set(eb.x, eb.y, eb.z, 'XYZ'));
    max = Math.max(max, (qa.angleTo(QUAT) * 180) / Math.PI);
  }
  return max;
}

const files = (await readdir(DIR)).filter((f) => f.endsWith('.posecode')).sort();
let failed = false;
console.log(`Posecode: ${files.length} movimenti\n`);

for (const file of files) {
  const source = await readFile(path.join(DIR, file), 'utf8');
  const { ir, errors, warnings } = parse(source);
  const name = file.replace(/\.posecode$/, '');
  if (!ir || errors.length > 0) {
    failed = true;
    console.log(`✗ ${name}`);
    for (const error of errors) console.log(`    errore: ${error.message ?? error}`);
    continue;
  }

  const timeline = buildTimeline(ir);
  const mannequin = buildMannequin();
  const first = poseSnapshot(timeline, mannequin, 0);
  const last = poseSnapshot(timeline, mannequin, Math.max(0, timeline.duration - 0.001));
  const seam = maxAngleDelta(first, last);
  const looped = ir.repeat > 1 || /walk|run|idle/i.test(name);
  const badSeam = looped && seam > 2.5;

  console.log(
    `${badSeam ? '✗' : '✓'} ${name.padEnd(18)} ${timeline.segments.length} fasi, ` +
      `${timeline.duration.toFixed(2)}s, repeat ${ir.repeat}, cucitura ${seam.toFixed(2)}°`,
  );
  for (const warning of warnings) {
    console.log(`    avviso: ${typeof warning === 'string' ? warning : JSON.stringify(warning)}`);
  }
  if (timeline.segments.length === 0) {
    failed = true;
    console.log('    errore: nessuna fase');
  }
  if (badSeam) {
    failed = true;
    console.log('    errore: il loop non torna alla posa iniziale');
  }
}

if (failed) process.exitCode = 1;
else console.log('\nTutti i movimenti sono validi.');

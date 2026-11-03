#!/usr/bin/env node
/**
 * Audit e ottimizzazione offline dei GLB dei personaggi.
 *
 * Non scarica, non crea rig, non trasferisce pesi e non cambia licenze.
 * Serve a fermare un asset prima che entri nel gioco: verifica scheletro,
 * texture, materiali e budget; `optimize` applica solo trasformazioni
 * conservative e richiede sempre un file di output separato.
 *
 *   node scripts/character-assets.mjs audit <file.glb> [--strict]
 *   node scripts/character-assets.mjs optimize <input.glb> --out <output.glb>
 *
 * Nota: l'ottimizzazione non cambia la licenza dell'asset né autorizza la
 * ridistribuzione di clip o rig di terzi.
 */
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { dedup, getBounds, resample, weld } from '@gltf-transform/functions';

const IO = new NodeIO();
// Le 52 ossa richieste dallo scheletro RPM (stringa normalizzata).
// Se l'asset non le ha tutte, le clip attuali non possono essere applicate
// senza buchi o artefatti.
const REQUIRED_BONES = [
  'hips', 'spine', 'spine1', 'spine2', 'neck', 'head',
  'leftshoulder', 'leftarm', 'leftforearm', 'lefthand',
  'rightshoulder', 'rightarm', 'rightforearm', 'righthand',
  'leftupleg', 'leftleg', 'leftfoot', 'lefttoebase',
  'rightupleg', 'rightleg', 'rightfoot', 'righttoebase',
  'lefthandindex1', 'lefthandindex2', 'lefthandindex3',
  'lefthandmiddle1', 'lefthandmiddle2', 'lefthandmiddle3',
  'lefthandpinky1', 'lefthandpinky2', 'lefthandpinky3',
  'lefthandring1', 'lefthandring2', 'lefthandring3',
  'lefthandthumb1', 'lefthandthumb2', 'lefthandthumb3',
  'righthandindex1', 'righthandindex2', 'righthandindex3',
  'righthandmiddle1', 'righthandmiddle2', 'righthandmiddle3',
  'righthandpinky1', 'righthandpinky2', 'righthandpinky3',
  'righthandring1', 'righthandring2', 'righthandring3',
  'righthandthumb1', 'righthandthumb2', 'righthandthumb3',
];
const EXPECTED_MATERIALS = ['skin', 'eye', 'hair', 'top', 'bottom', 'shoes'];
const MAX_FILE_BYTES = 15 * 1024 * 1024;

function boneKey(name) {
  return (name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function bytes(value) {
  return `${(value / 1024 / 1024).toFixed(2)} MB`;
}

function usage() {
  console.error(`Uso:
  node scripts/character-assets.mjs audit <file.glb> [--strict]
  node scripts/character-assets.mjs optimize <input.glb> --out <output.glb>`);
}

async function readDocument(file) {
  try {
    return await IO.read(file);
  } catch (error) {
    throw new Error(`impossibile leggere ${file}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function primitiveStats(mesh) {
  let vertices = 0;
  let triangles = 0;
  for (const primitive of mesh.listPrimitives()) {
    const position = primitive.getAttribute('POSITION');
    const indices = primitive.getIndices();
    vertices += position?.getCount() ?? 0;
    triangles += indices ? Math.round(indices.getCount() / 3) : Math.round((position?.getCount() ?? 0) / 3);
  }
  return { vertices, triangles };
}

async function audit(file, strict = false) {
  const info = await stat(file);
  const doc = await readDocument(file);
  const root = doc.getRoot();
  const scenes = root.listScenes();
  const skins = root.listSkins();
  const joints = skins.flatMap((skin) => skin.listJoints());
  const names = new Set(joints.map((joint) => boneKey(joint.getName())));
  const skinnedNodes = root.listNodes().filter((node) => node.getSkin());
  const materials = root.listMaterials();
  const textures = root.listTextures();
  const meshes = root.listMeshes();
  const totals = meshes.reduce((sum, mesh) => {
    const current = primitiveStats(mesh);
    return { vertices: sum.vertices + current.vertices, triangles: sum.triangles + current.triangles };
  }, { vertices: 0, triangles: 0 });
  const bounds = scenes[0] ? getBounds(scenes[0]) : null;
  const materialNames = materials.map((material) => material.getName().toLowerCase());
  const normalizedMaterials = materialNames.map((name) => EXPECTED_MATERIALS.find((key) => name.includes(key)));
  const missingBones = REQUIRED_BONES.filter((bone) => !names.has(bone));
  const errors = [];
  const warnings = [];

  if (!skinnedNodes.length) errors.push('nessuna mesh con skin: il personaggio non è animabile');
  if (!skins.length) errors.push('nessuno skin nel GLB');
  if (joints.length < 52) errors.push(`scheletro troppo corto: ${joints.length} ossa (richieste almeno 52 per le clip attuali)`);
  if (missingBones.length) errors.push(`ossa mancanti: ${missingBones.join(', ')}`);
  if (!textures.length) errors.push('nessuna texture: un personaggio completo deve avere almeno l’albedo');
  if (info.size > MAX_FILE_BYTES) errors.push(`file troppo grande: ${bytes(info.size)} (budget ${bytes(MAX_FILE_BYTES)})`);
  if (!materials.some((material) => material.getBaseColorTexture())) warnings.push('nessun materiale con base color texture');
  if (!materials.some((material) => material.getNormalTexture())) warnings.push('nessun materiale con normal map');
  if (!normalizedMaterials.some(Boolean)) {
    warnings.push(`materiali non separati (${materialNames.join(', ') || 'nessuno'}); attesi: ${EXPECTED_MATERIALS.join(', ')}`);
  }
  if (bounds && Math.abs(bounds.min[1]) > 0.02) warnings.push(`minY ${bounds.min[1].toFixed(3)} m: il modello non è appoggiato a terra`);
  if (totals.triangles > 40000) warnings.push(`LOD0 pesante: ${totals.triangles} triangoli (riferimento hero 25–40k)`);

  console.log(`\n${file}`);
  console.log(`  ${bytes(info.size)} · ${totals.vertices} vertici · ${totals.triangles} triangoli · ${joints.length} ossa · ${skins.length} skin`);
  console.log(`  mesh: ${meshes.length} · materiali: ${materials.length} · texture: ${textures.length}`);
  if (bounds) {
    const height = bounds.max[1] - bounds.min[1];
    console.log(`  bounds Y: ${bounds.min[1].toFixed(3)} → ${bounds.max[1].toFixed(3)} m (altezza ${height.toFixed(3)} m)`);
  }
  console.log(`  materiali: ${materials.map((material) => material.getName()).join(', ') || '—'}`);
  if (missingBones.length) console.log(`  ossa mancanti: ${missingBones.join(', ')}`);
  for (const warning of warnings) console.log(`  ATTENZIONE: ${warning}`);
  for (const error of errors) console.log(`  ERRORE: ${error}`);

  const failed = errors.length > 0 || (strict && warnings.length > 0);
  console.log(failed ? '  ESITO: NO-GO' : '  ESITO: OK');
  if (failed) process.exitCode = 1;
  return { errors, warnings };
}

function linkNormalMaps(doc) {
  const root = doc.getRoot();
  const normal = root.listTextures().find((texture) => /normal/i.test(texture.getName()));
  if (!normal) return 0;
  let linked = 0;
  for (const material of root.listMaterials()) {
    if (material.getNormalTexture()) continue;
    material.setNormalTexture(normal);
    linked++;
  }
  return linked;
}

async function optimize(input, output) {
  if (!input || !output) {
    usage();
    throw new Error('servono input e --out');
  }
  if (path.resolve(input) === path.resolve(output)) {
    throw new Error('l’output non può coincidere con l’input: conserva l’originale');
  }
  const before = (await stat(input)).size;
  const doc = await readDocument(input);
  // Il materiale RPM è unlit e non referenzia la normal map embedded. La
  // colleghiamo esplicitamente; `prune` non è incluso perché può eliminare
  // proprio le texture non ancora referenziate dal materiale.
  const linkedNormals = linkNormalMaps(doc);
  await doc.transform(
    dedup(),
    weld({ tolerance: 0.0001 }),
    resample(),
  );
  await IO.write(output, doc);
  const after = (await stat(output)).size;
  console.log(`\n${input} → ${output}`);
  console.log(`  ${bytes(before)} → ${bytes(after)} (${((1 - after / before) * 100).toFixed(1)}% in meno)`);
  if (linkedNormals) console.log(`  Normal map collegate: ${linkedNormals} materiale/i.`);
  console.log('  Trasformazioni: dedup, weld, resample. Nessun rig, LOD o KTX2 è stato creato.');
  console.log('  Verifica la licenza del file prima di aggiungerlo al repository pubblico.');
}

async function main() {
  const args = process.argv.slice(2);
  const command = args.shift();
  if (!command) {
    usage();
    process.exitCode = 2;
    return;
  }
  if (command === 'audit') {
    const strict = args.includes('--strict');
    const files = args.filter((arg) => !arg.startsWith('--'));
    if (!files.length) {
      usage();
      process.exitCode = 2;
      return;
    }
    for (const file of files) await audit(file, strict);
    return;
  }
  if (command === 'optimize') {
    const outIndex = args.indexOf('--out');
    if (outIndex < 0 || !args[outIndex + 1]) {
      usage();
      process.exitCode = 2;
      return;
    }
    const input = args.find((arg, index) => !arg.startsWith('--') && index !== outIndex + 1);
    await optimize(input, args[outIndex + 1]);
    return;
  }
  usage();
  process.exitCode = 2;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

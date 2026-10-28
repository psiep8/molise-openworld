import fs from 'node:fs';
import path from 'node:path';

const CARS = path.join(process.cwd(), 'public', 'cars');

function readGlbJson(file) {
  const buffer = fs.readFileSync(file);
  let offset = 12;
  while (offset < buffer.length) {
    const length = buffer.readUInt32LE(offset);
    const type = buffer.readUInt32LE(offset + 4);
    const chunk = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === 0x4e4f534a) return JSON.parse(chunk.toString('utf8'));
    offset += 8 + length + ((4 - (length % 4)) % 4);
  }
  return null;
}

const puntoJson = readGlbJson(path.join(CARS, '2011_fiat_punto.glb'));
console.log('=== FIAT PUNTO MATERIALS & MESHES ===');
puntoJson.meshes?.forEach((m, idx) => {
  const matIdx = m.primitives?.[0]?.material;
  const mat = matIdx !== undefined ? puntoJson.materials?.[matIdx]?.name : 'no-mat';
  console.log(`mesh[${idx}]: "${m.name}" -> mat: "${mat}"`);
});

const novulariJson = readGlbJson(path.join(CARS, 'audi_novulari.glb'));
console.log('=== AUDI NOVULARI MATERIALS & MESHES ===');
novulariJson.meshes?.forEach((m, idx) => {
  const matIdx = m.primitives?.[0]?.material;
  const mat = matIdx !== undefined ? novulariJson.materials?.[matIdx]?.name : 'no-mat';
  console.log(`mesh[${idx}]: "${m.name}" -> mat: "${mat}"`);
});

const saloonJson = readGlbJson(path.join(CARS, 'bmw_inspired_1930s_saloon_car.glb'));
console.log('=== BMW SALOON MATERIALS & MESHES ===');
saloonJson.meshes?.forEach((m, idx) => {
  const matIdx = m.primitives?.[0]?.material;
  const mat = matIdx !== undefined ? saloonJson.materials?.[matIdx]?.name : 'no-mat';
  console.log(`mesh[${idx}]: "${m.name}" -> mat: "${mat}"`);
});

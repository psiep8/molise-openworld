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

const f500 = readGlbJson(path.join(CARS, 'fiat_500.glb'));
console.log('=== FIAT 500 (2007) MESHES & MATS ===');
f500.meshes?.forEach((m, i) => {
  const matIdx = m.primitives[0].material;
  const mat = f500.materials[matIdx];
  console.log(`mesh[${i}] "${m.name}": matIdx=${matIdx} ("${mat.name}")`);
});

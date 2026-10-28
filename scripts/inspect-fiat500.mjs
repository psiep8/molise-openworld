import fs from 'node:fs';
import path from 'node:path';

const CARS = path.join(process.cwd(), 'public', 'cars');

function readGlb(file) {
  const buffer = fs.readFileSync(file);
  let offset = 12;
  let json = null;
  let binBuffer = null;
  while (offset < buffer.length) {
    const length = buffer.readUInt32LE(offset);
    const type = buffer.readUInt32LE(offset + 4);
    const chunk = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === 0x4e4f534a) json = JSON.parse(chunk.toString('utf8'));
    else if (type === 0x004e4942) binBuffer = chunk;
    offset += 8 + length + ((4 - (length % 4)) % 4);
  }
  return { json, binBuffer };
}

const glb = readGlb(path.join(CARS, 'fiat_500.glb'));
const { json } = glb;

console.log('=== FIAT 500 NODES & MESHES ===');
json.nodes.forEach((n, i) => {
  if (n.mesh !== undefined) {
    const m = json.meshes[n.mesh];
    const acc = json.accessors[m.primitives[0].attributes.POSITION];
    console.log(`node[${i}] "${n.name}" -> mesh[${n.mesh}] "${m.name}" min=[${acc.min.map(v=>+v.toFixed(2))}] max=[${acc.max.map(v=>+v.toFixed(2))}]`);
  }
});

import fs from 'node:fs';
import path from 'node:path';

const CARS = path.join(process.cwd(), 'public', 'cars');

function readGlb(file) {
  const buffer = fs.readFileSync(file);
  let offset = 12;
  let json = null;
  while (offset < buffer.length) {
    const length = buffer.readUInt32LE(offset);
    const type = buffer.readUInt32LE(offset + 4);
    const chunk = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === 0x4e4f534a) json = JSON.parse(chunk.toString('utf8'));
    offset += 8 + length + ((4 - (length % 4)) % 4);
  }
  return json;
}

const p = readGlb(path.join(CARS, 'mistery_porsche.glb'));
for (const idx of [91, 97, 105, 107]) {
  const n = p.nodes[idx];
  const m = p.meshes[n.mesh];
  const mat = p.materials[m.primitives[0].material];
  console.log(`node[${idx}] "${n.name}" -> mesh: "${m.name}", material: "${mat?.name}"`);
}

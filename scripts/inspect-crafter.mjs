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

const c = readGlb(path.join(CARS, 'volkswagen_crafter.glb'));
for (const idx of [422, 423, 424, 425, 426, 427, 428, 429, 430, 432, 434, 436, 437, 438, 439]) {
  const n = c.nodes[idx];
  const m = n.mesh !== undefined ? c.meshes[n.mesh]?.name : '';
  console.log(`crafter node[${idx}] "${n.name}" mesh="${m}" ch=${JSON.stringify(n.children)}`);
}

const cy = readGlb(path.join(CARS, 'm_cyberster.glb'));
console.log('=== CYBERSTER MESHES ===');
cy.meshes.forEach((m, i) => {
  console.log(`cy mesh[${i}] "${m.name}" prims=${m.primitives?.length} mat=${cy.materials?.[m.primitives[0]?.material]?.name}`);
});

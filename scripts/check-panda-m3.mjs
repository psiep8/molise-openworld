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

const panda = readGlb(path.join(CARS, 'fiat_panda_4x4.glb'));
panda.nodes.forEach((n, i) => {
  if (n.mesh !== undefined) {
    const acc = panda.accessors[panda.meshes[n.mesh].primitives[0].attributes.POSITION];
    console.log(`panda node[${i}] "${n.name}": minX=${acc.min[0].toFixed(1)}, maxX=${acc.max[0].toFixed(1)}, minY=${acc.min[1].toFixed(1)}, maxY=${acc.max[1].toFixed(1)}`);
  }
});

const m3 = readGlb(path.join(CARS, 'bmw_m3_sedan_topaz_blue_car.glb'));
m3.nodes.forEach((n, i) => {
  if (n.mesh !== undefined) {
    const acc = m3.accessors[m3.meshes[n.mesh].primitives[0].attributes.POSITION];
    if (/light|front|head|faro|calandre|grill/i.test(n.name)) {
      console.log(`m3 node[${i}] "${n.name}": minX=${acc.min[0].toFixed(1)}, maxX=${acc.max[0].toFixed(1)}`);
    }
  }
});

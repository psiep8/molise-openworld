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

function inspectSpecific(file) {
  const json = readGlb(path.join(CARS, file));
  console.log(`\n============================ ${file} ============================`);
  console.log('Meshes:');
  json.meshes.forEach((m, i) => {
    const prim = m.primitives[0];
    const acc = json.accessors[prim.attributes.POSITION];
    const mat = json.materials?.[prim.material]?.name || '';
    const span = [(acc.max[0]-acc.min[0]).toFixed(2), (acc.max[1]-acc.min[1]).toFixed(2), (acc.max[2]-acc.min[2]).toFixed(2)];
    const center = [((acc.max[0]+acc.min[0])/2).toFixed(2), ((acc.max[1]+acc.min[1])/2).toFixed(2), ((acc.max[2]+acc.min[2])/2).toFixed(2)];
    if (/tire|tyre|rim|wheel|ruota|pneu|roda/i.test(m.name + ' ' + mat)) {
      console.log(`  [mesh ${i}] "${m.name}" mat="${mat}" span=[${span}] center=[${center}]`);
    }
  });

  console.log('Nodes matching wheel/tire/rim/ruota:');
  json.nodes.forEach((n, i) => {
    if (/tire|tyre|rim|wheel|ruota|pneu|roda/i.test(n.name || '')) {
      console.log(`  [node ${i}] "${n.name}" mesh=${n.mesh} ch=[${n.children || ''}]`);
    }
  });
}

for (const f of [
  '2011_fiat_punto.glb',
  'audi_novulari.glb',
  'bmw_inspired_1930s_saloon_car.glb',
  'lamborgini_revolto.glb',
  'm_cyberster.glb',
  'fiat_500_abarth.glb',
  'volkswagen_crafter.glb',
  '2021_bmw_m4_competition.glb',
  'ferrari_f1_2019.glb'
]) {
  inspectSpecific(f);
}

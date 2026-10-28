import fs from 'node:fs';
import path from 'node:path';

const CARS = path.join(process.cwd(), 'public', 'cars');
const manifest = JSON.parse(fs.readFileSync(path.join(CARS, 'manifest.json'), 'utf8'));

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

// Check orientations: Uno, Panda, M3 Sedan, Abarth
for (const slug of ['fiat-uno-1994', 'fiat-panda-4x4', 'bmw-m3-sedan', 'fiat-500-abarth', 'porsche-911-mistery', 'volkswagen-crafter', 'bmw-m4-competition-2021']) {
  const car = manifest.cars.find(c => c.slug === slug);
  const json = readGlb(path.join(CARS, car.file));
  console.log(`\n=================== ${slug} (yaw=${car.yaw}, declared_len=${car.length}) ===================`);
  
  // Find min/max for each mesh
  let overallMin = [Infinity, Infinity, Infinity];
  let overallMax = [-Infinity, -Infinity, -Infinity];

  json.nodes.forEach((n, i) => {
    if (n.mesh !== undefined) {
      const mesh = json.meshes[n.mesh];
      const acc = json.accessors[mesh.primitives[0].attributes.POSITION];
      if (acc && acc.min && acc.max) {
        for (let k = 0; k < 3; k++) {
          overallMin[k] = Math.min(overallMin[k], acc.min[k]);
          overallMax[k] = Math.max(overallMax[k], acc.max[k]);
        }
      }
    }
  });

  const span = [
    overallMax[0] - overallMin[0],
    overallMax[1] - overallMin[1],
    overallMax[2] - overallMin[2]
  ];
  console.log(`Raw bounds span: X=${span[0].toFixed(2)}, Y=${span[1].toFixed(2)}, Z=${span[2].toFixed(2)}`);
  console.log(`Raw min: [${overallMin.map(v=>+v.toFixed(2))}], max: [${overallMax.map(v=>+v.toFixed(2))}]`);
}

import fs from 'node:fs';
import path from 'node:path';

const CARS = path.join(process.cwd(), 'public', 'cars');
const manifest = JSON.parse(fs.readFileSync(path.join(CARS, 'manifest.json'), 'utf8'));

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

const targetSlugs = [
  'fiat-500-abarth',
  'fiat-multipla-1998',
  'fiat-uno-1994',
  'lamborghini-revuelto',
  'land-rover-defender',
  'mg-cyberster-2025',
  'porsche-911-mistery',
  'seat-leon-cupra-race',
  'tesla-cybertruck',
  'aston-martin-db11',
  'fiat-panda-4x4',
  'honda-civic-rs',
  'volkswagen-crafter',
  'volkswagen-golf-gti-2025',
  'audi-r8-2010',
  'audi-r8-2023',
  'fiat-punto-2011',
  'bmw-m4-competition-2021',
  'audi-novulari',
  'bmw-1930s-saloon',
  'bmw-m3-sedan',
  'cupra-terramar',
  'ferrari-f1-2019',
  'ferrari-laferrari',
  'fiat-500'
];

for (const slug of targetSlugs) {
  const entry = manifest.cars.find(c => c.slug === slug);
  if (!entry) {
    console.log('NOT FOUND:', slug);
    continue;
  }
  const glbPath = path.join(CARS, entry.file);
  const json = readGlbJson(glbPath);
  if (!json) continue;

  console.log(`\n================== ${slug} (yaw: ${entry.yaw}, length: ${entry.length}) ==================`);
  
  // Inspect nodes that have wheel/tire/rim/ruota in their name or mesh name
  const wheelNodes = [];
  json.nodes?.forEach((n, idx) => {
    const name = n.name || '';
    const meshName = n.mesh !== undefined ? json.meshes?.[n.mesh]?.name : '';
    const isWheel = /wheel|ruota|tire|tyre|rim/i.test(name) || /wheel|ruota|tire|tyre|rim/i.test(meshName || '');
    if (isWheel) {
      wheelNodes.push({ idx, name, meshName, translation: n.translation, rotation: n.rotation, scale: n.scale });
    }
  });

  console.log(`Found ${wheelNodes.length} wheel/tire/rim nodes:`);
  for (const wn of wheelNodes.slice(0, 15)) {
    console.log(`  [${wn.idx}] node: "${wn.name}" | mesh: "${wn.meshName}" | t: ${JSON.stringify(wn.translation)}`);
  }
  if (wheelNodes.length > 15) {
    console.log(`  ... and ${wheelNodes.length - 15} more`);
  }
}

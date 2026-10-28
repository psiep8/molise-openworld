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

function dumpCar(slug) {
  const entry = manifest.cars.find(c => c.slug === slug);
  if (!entry) return;
  const json = readGlbJson(path.join(CARS, entry.file));
  console.log(`\n=== ${slug} (yaw=${entry.yaw}, length=${entry.length}, hide=${JSON.stringify(entry.hide)}) ===`);
  json.nodes?.forEach((n, i) => {
    const mStr = n.mesh !== undefined ? ` mesh=${n.mesh}("${json.meshes?.[n.mesh]?.name}")` : '';
    const chStr = n.children ? ` ch=[${n.children.join(',')}]` : '';
    const tStr = n.translation ? ` t=${JSON.stringify(n.translation.map(v => +v.toFixed(3)))}` : '';
    const rStr = n.rotation ? ` r=${JSON.stringify(n.rotation.map(v => +v.toFixed(3)))}` : '';
    console.log(`  node[${i}]: "${n.name}"${mStr}${chStr}${tStr}${rStr}`);
  });
}

const list = ['fiat-punto-2011', 'audi-novulari', 'bmw-1930s-saloon', 'fiat-panda-4x4', 'fiat-uno-1994', 'bmw-m3-sedan'];
for (const slug of list) {
  dumpCar(slug);
}

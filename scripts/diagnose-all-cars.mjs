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

const WHEEL_TAG = /(?:wheel|ruota)[-_ ]?(fl|fr|rl|rr|lf|rf|lr|bl|br)(?![a-z0-9])/i;
const TIRE_TAG = /(?:^|[-_ .#])(?:tire|tyre|rim)[-_ ]?(fl|fr|rl|rr|lf|rf|lr|bl|br)(?![a-z0-9])/i;
const FRONT_WORDS = /(?:front|anteriore|avantreno)[-_ ]?(left|right|sinistra|destra)[-_ ]?(?:wheel|ruota)/i;
const REAR_WORDS = /(?:rear|retro|posteriore)[-_ ]?(left|right|sinistra|destra)[-_ ]?(?:wheel|ruota)/i;
const BRAKE_PART = /caliper|pinza|brakes?\b|freno/i;

function tagFromName(name) {
  if (/(?:^|[-_ ])front[-_ ]?wheel$/i.test(name)) return 'fl';
  if (/(?:^|[-_ ])rear[-_ ]?wheel$/i.test(name)) return 'rl';
  if (/(?:^|[-_ ])(?:front|anteriore)[-_ ]?weel$/i.test(name)) return 'fl';
  if (/(?:^|[-_ ])(?:rear|back|posteriore)[-_ ]?weel$/i.test(name)) return 'rl';
  const direct = WHEEL_TAG.exec(name);
  if (direct) return direct[1].toLowerCase();
  const tire = TIRE_TAG.exec(name);
  if (tire) return tire[1].toLowerCase();
  const front = FRONT_WORDS.exec(name);
  if (front) return front[1].toLowerCase().startsWith('l') || front[1].toLowerCase().startsWith('s') ? 'fl' : 'fr';
  const rear = REAR_WORDS.exec(name);
  if (rear) return rear[1].toLowerCase().startsWith('l') || rear[1].toLowerCase().startsWith('s') ? 'rl' : 'rr';
  return null;
}

for (const car of manifest.cars) {
  const filePath = path.join(CARS, car.file);
  if (!fs.existsSync(filePath)) {
    console.log(`[MISSING] ${car.slug}`);
    continue;
  }
  const json = readGlbJson(filePath);
  if (!json) continue;

  const declared = [];
  json.nodes?.forEach((n, i) => {
    const tag = tagFromName(n.name || '');
    if (tag && !BRAKE_PART.test(n.name || '')) {
      declared.push({ nodeIdx: i, name: n.name, tag });
    }
  });

  // Check transparent materials
  const transparentMats = [];
  const whiteMats = [];
  json.materials?.forEach((m, i) => {
    if (m.alphaMode === 'BLEND' || (m.pbrMetallicRoughness?.baseColorFactor && m.pbrMetallicRoughness.baseColorFactor[3] < 0.95)) {
      transparentMats.push(m.name || `mat_${i}`);
    }
    const color = m.pbrMetallicRoughness?.baseColorFactor;
    if (color && color[0] > 0.9 && color[1] > 0.9 && color[2] > 0.9 && !m.pbrMetallicRoughness?.baseColorTexture) {
      whiteMats.push(m.name || `mat_${i}`);
    }
  });

  console.log(`=== ${car.slug} ===`);
  console.log(`  file: ${car.file}, yaw: ${car.yaw}`);
  console.log(`  declared wheel nodes (${declared.length}):`, declared.map(d => `${d.name}->${d.tag}`).join(', ') || 'NONE');
  if (transparentMats.length) console.log(`  transparent materials (${transparentMats.length}):`, transparentMats.join(', '));
  if (whiteMats.length) console.log(`  plain white materials (${whiteMats.length}):`, whiteMats.join(', '));
}

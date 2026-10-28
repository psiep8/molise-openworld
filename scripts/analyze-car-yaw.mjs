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

function multiply(a, b) {
  const out = new Array(16).fill(0);
  for (let c = 0; c < 4; c++)
    for (let r = 0; r < 4; r++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) sum += a[k * 4 + r] * b[c * 4 + k];
      out[c * 4 + r] = sum;
    }
  return out;
}
function fromTRS(node) {
  const [tx, ty, tz] = node.translation ?? [0, 0, 0];
  const [qx, qy, qz, qw] = node.rotation ?? [0, 0, 0, 1];
  const [sx, sy, sz] = node.scale ?? [1, 1, 1];
  const x2 = qx + qx, y2 = qy + qy, z2 = qz + qz;
  const xx = qx * x2, xy = qx * y2, xz = qx * z2;
  const yy = qy * y2, yz = qy * z2, zz = qz * z2;
  const wx = qw * x2, wy = qw * y2, wz = qw * z2;
  return [
    (1 - (yy + zz)) * sx, (xy + wz) * sx, (xz - wy) * sx, 0,
    (xy - wz) * sy, (1 - (xx + zz)) * sy, (yz + wx) * sy, 0,
    (xz + wy) * sz, (yz - wx) * sz, (1 - (xx + yy)) * sz, 0,
    tx, ty, tz, 1,
  ];
}
const nodeMatrix = (n) => (Array.isArray(n.matrix) ? n.matrix.slice() : fromTRS(n));
const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const transformPoint = (m, p) => [
  m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
  m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
  m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14],
];

const FRONT = /(head|faro|front|avant|anterior|hl_|drl|windscreen|windshield|parabrezza)/i;
const REAR = /(tail|rear|back|posterior|stop|fanal|lunotto|trunk|boot)/i;
const FRONT_WHEEL = /(?:^|[\s_-])(front|f|anteriore|avant)/i;
const REAR_WHEEL = /(?:^|[\s_-])(rear|r|posteriore|back)/i;
const WHEELISH = /wheel|ruota|tire|tyre|rim|pneu/i;

for (const car of manifest.cars) {
  const file = path.join(CARS, car.file);
  if (!fs.existsSync(file)) { console.log(`${car.slug}: MISSING`); continue; }
  const json = readGlbJson(file);
  if (!json) continue;

  const world = new Map();
  const walk = (idx, parent) => {
    const m = multiply(parent, nodeMatrix(json.nodes[idx]));
    world.set(idx, m);
    (json.nodes[idx].children ?? []).forEach((c) => walk(c, m));
  };
  (json.scenes?.[0]?.nodes ?? [0]).forEach((r) => walk(r, IDENTITY));

  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  json.nodes.forEach((n, i) => {
    if (n.mesh === undefined) return;
    const acc = json.accessors[json.meshes[n.mesh].primitives[0].attributes.POSITION];
    if (!acc?.min) return;
    const m = world.get(i);
    if (!m) return;
    for (let c = 0; c < 8; c++) {
      const p = [c & 1 ? acc.max[0] : acc.min[0], c & 2 ? acc.max[1] : acc.min[1], c & 4 ? acc.max[2] : acc.min[2]];
      const w = transformPoint(m, p);
      for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], w[k]); max[k] = Math.max(max[k], w[k]); }
    }
  });
  const span = [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
  const longAxis = span[0] >= span[2] ? 'X' : 'Z';

  // front/rear witness points: declared wheel names and light names
  const frontPts = [];
  const rearPts = [];
  const lightFront = [];
  const lightRear = [];
  json.nodes.forEach((n, i) => {
    const name = n.name;
    const m = world.get(i);
    if (!name || !m) return;
    const pos = [m[12], m[13], m[14]];
    if (WHEELISH.test(name)) {
      if (FRONT_WHEEL.test(name) && !REAR_WHEEL.test(name)) frontPts.push(pos);
      else if (REAR_WHEEL.test(name) && !FRONT_WHEEL.test(name)) rearPts.push(pos);
    } else if (n.mesh !== undefined) {
      const mats = (json.meshes[n.mesh].primitives ?? [])
        .map((p) => json.materials?.[p.material]?.name ?? '')
        .join(' ');
      const hay = `${name} ${mats}`;
      if (REAR.test(hay)) lightRear.push(pos);
      else if (FRONT.test(hay)) lightFront.push(pos);
    }
  });
  const avgAxis = (pts, axis) => (pts.length ? pts.reduce((a, p) => a + p[axis], 0) / pts.length : null);
  const axisIdx = longAxis === 'X' ? 0 : 2;

  const wheelNose = frontPts.length && rearPts.length
    ? Math.sign(avgAxis(frontPts, axisIdx) - avgAxis(rearPts, axisIdx)) : 0;
  const lightNose = lightFront.length && lightRear.length
    ? Math.sign(avgAxis(lightFront, axisIdx) - avgAxis(lightRear, axisIdx)) : 0;
  const nose = wheelNose || lightNose || 0;

  const noseVec = longAxis === 'X' ? [nose, 0, 0] : [0, 0, nose];
  let suggested = null;
  if (nose !== 0) {
    if (longAxis === 'Z') suggested = nose > 0 ? 0 : 180;
    else suggested = nose > 0 ? -90 : 90;
  }

  console.log(
    `${car.slug.padEnd(26)} span=[${span[0].toFixed(2).padStart(6)},${span[1].toFixed(2).padStart(6)},${span[2].toFixed(2).padStart(6)}]` +
    ` long=${longAxis} yaw=${String(car.yaw ?? 0).padStart(4)}` +
    ` nose(x${frontPts.length}/l${lightFront.length},r${rearPts.length}/l${lightRear.length})=` +
    `${noseVec[0] ? (noseVec[0] > 0 ? '+X' : '-X') : noseVec[2] ? (noseVec[2] > 0 ? '+Z' : '-Z') : '??'}` +
    ` -> yaw ${suggested === null ? '??' : suggested}`,
  );
}

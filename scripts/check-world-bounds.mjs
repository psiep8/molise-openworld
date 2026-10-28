import fs from 'node:fs';
import path from 'node:path';

const CARS = path.join(process.cwd(), 'public', 'cars');
const manifest = JSON.parse(fs.readFileSync(path.join(CARS, 'manifest.json'), 'utf8'));

function multiply(a, b) {
  const out = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) sum += a[k * 4 + r] * b[c * 4 + k];
      out[c * 4 + r] = sum;
    }
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

const nodeMatrix = (node) => (Array.isArray(node.matrix) ? node.matrix.slice() : fromTRS(node));

function transformPoint(m, p) {
  return [
    m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
    m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
    m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14],
  ];
}

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

const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

for (const slug of ['fiat-uno-1994', 'fiat-panda-4x4', 'bmw-m3-sedan', 'fiat-500-abarth', 'fiat-punto-2011', 'audi-novulari', 'bmw-1930s-saloon', 'lamborghini-revuelto']) {
  const car = manifest.cars.find(c => c.slug === slug);
  const json = readGlb(path.join(CARS, car.file));
  
  const nodeWorldMatrices = new Map();
  function calcWorld(idx, parentMat) {
    const n = json.nodes[idx];
    const mat = multiply(parentMat, nodeMatrix(n));
    nodeWorldMatrices.set(idx, mat);
    n.children?.forEach(c => calcWorld(c, mat));
  }
  (json.scenes?.[0]?.nodes || [0]).forEach(root => calcWorld(root, IDENTITY));

  const totalMin = [Infinity, Infinity, Infinity];
  const totalMax = [-Infinity, -Infinity, -Infinity];
  json.nodes.forEach((n, idx) => {
    if (n.mesh !== undefined) {
      const mesh = json.meshes[n.mesh];
      const acc = json.accessors[mesh.primitives[0].attributes.POSITION];
      if (!acc) return;
      const mat = nodeWorldMatrices.get(idx);
      for (let corner = 0; corner < 8; corner++) {
        const p = [
          corner & 1 ? acc.max[0] : acc.min[0],
          corner & 2 ? acc.max[1] : acc.min[1],
          corner & 4 ? acc.max[2] : acc.min[2],
        ];
        const w = transformPoint(mat, p);
        for (let k = 0; k < 3; k++) {
          totalMin[k] = Math.min(totalMin[k], w[k]);
          totalMax[k] = Math.max(totalMax[k], w[k]);
        }
      }
    }
  });

  const span = [totalMax[0] - totalMin[0], totalMax[1] - totalMin[1], totalMax[2] - totalMin[2]];
  console.log(`${slug.padEnd(25)} span: X=${span[0].toFixed(2).padStart(8)}, Y=${span[1].toFixed(2).padStart(8)}, Z=${span[2].toFixed(2).padStart(8)} | current yaw=${car.yaw}`);
}

/**
 * Controllo geometrico dei GLB delle auto.
 *
 * I file in `public/cars/` non sono versionati e arrivano da fonti diverse:
 * unità di misura, orientamento e pezzi staccati sono i tre modi in cui un
 * modello "sembra a posto" e poi in gioco è lungo il doppio, appoggiato su un
 * fianco o circondato da sportelli fantasma. Qui si legge solo la testa del
 * GLB (JSON + accessor POSITION), si compone la gerarchia dei nodi e si misura
 * l'ingombro vero, senza Three.js e senza browser.
 *
 * Uso: `npm run check:cars` (oppure `VERBOSE=1 npm run check:cars` per l'elenco
 * dei nodi).
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const CARS = path.join(ROOT, 'public', 'cars');
const manifest = JSON.parse(fs.readFileSync(path.join(CARS, 'manifest.json'), 'utf8'));

const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

/** Prodotto di due matrici 4x4 in ordine colonna (come glTF). */
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
  const x2 = qx + qx;
  const y2 = qy + qy;
  const z2 = qz + qz;
  const xx = qx * x2;
  const xy = qx * y2;
  const xz = qx * z2;
  const yy = qy * y2;
  const yz = qy * z2;
  const zz = qz * z2;
  const wx = qw * x2;
  const wy = qw * y2;
  const wz = qw * z2;
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
  if (buffer.readUInt32LE(0) !== 0x46546c67) throw new Error('non è un GLB');
  const version = buffer.readUInt32LE(4);
  let offset = 12;
  let json = null;
  while (offset < buffer.length) {
    const length = buffer.readUInt32LE(offset);
    const type = buffer.readUInt32LE(offset + 4);
    const chunk = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === 0x4e4f534a) json = JSON.parse(chunk.toString('utf8'));
    offset += 8 + length + ((4 - (length % 4)) % 4);
  }
  if (!json) throw new Error('GLB senza chunk JSON');
  return { version, json, bytes: buffer.length };
}

/**
 * Bounding box di ogni primitiva, già in coordinate modello, più i nomi dei
 * pezzi nascosti dal manifest. Il box per primitiva serve a distinguere il
 * corpo dell'auto dai pezzi staccati che molti kit lasciano di fianco.
 */
function collectParts(glb, hide = []) {
  const { json } = glb;
  const hidden = hide.map((h) => h.toLowerCase());
  const parts = [];
  let hiddenPrimitives = 0;

  const visit = (nodeIndex, parent, hiddenBelow) => {
    const node = json.nodes?.[nodeIndex];
    if (!node) return;
    const name = (node.name ?? '').toLowerCase();
    const isHidden = hiddenBelow || hidden.some((h) => name.includes(h));
    const matrix = multiply(parent, nodeMatrix(node));
    if (node.mesh !== undefined) {
      const mesh = json.meshes?.[node.mesh];
      for (const primitive of mesh?.primitives ?? []) {
        const accessor = json.accessors?.[primitive.attributes?.POSITION];
        if (!accessor?.min || !accessor?.max) continue;
        if (isHidden) {
          hiddenPrimitives++;
          continue;
        }
        const min = [Infinity, Infinity, Infinity];
        const max = [-Infinity, -Infinity, -Infinity];
        for (let corner = 0; corner < 8; corner++) {
          const p = [
            corner & 1 ? accessor.max[0] : accessor.min[0],
            corner & 2 ? accessor.max[1] : accessor.min[1],
            corner & 4 ? accessor.max[2] : accessor.min[2],
          ];
          const w = transformPoint(matrix, p);
          for (let k = 0; k < 3; k++) {
            min[k] = Math.min(min[k], w[k]);
            max[k] = Math.max(max[k], w[k]);
          }
        }
        parts.push({
          name: node.name ?? mesh?.name ?? '?',
          min,
          max,
          center: [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2],
        });
      }
    }
    for (const child of node.children ?? []) visit(child, matrix, isHidden);
  };

  const roots = json.scenes?.[0]?.nodes ?? [];
  for (const root of roots) visit(root, IDENTITY, false);
  return { parts, hiddenPrimitives };
}

/**
 * Box che contiene solo le parti vicine al centro del modello.
 *
 * La distanza si misura con la mediana degli scarti (MAD) e non con la media:
 * un kit con due sportelli parcheggiati di fianco sposterebbe la media e
 * farebbe sembrare "staccate" le ruote vere. Il MAD resta fedele al corpo
 * finché i pezzi fuori posto sono pochi, che è sempre il caso di un asset.
 */
function bodyBox(parts) {
  if (!parts.length) return null;
  const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
  const cx = median(parts.map((p) => p.center[0]));
  const cz = median(parts.map((p) => p.center[2]));
  const devX = median(parts.map((p) => Math.abs(p.center[0] - cx)));
  const devZ = median(parts.map((p) => Math.abs(p.center[2] - cz)));
  const limitX = Math.max(devX * 3.2, 1.4);
  const limitZ = Math.max(devZ * 3.2, 1.4);
  const near = parts.filter(
    (p) => Math.abs(p.center[0] - cx) <= limitX && Math.abs(p.center[2] - cz) <= limitZ,
  );
  const far = parts.filter((p) => !near.includes(p));
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const part of near) {
    for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k], part.min[k]);
      max[k] = Math.max(max[k], part.max[k]);
    }
  }
  return { min, max, near, far };
}

/** Unità del modello rispetto ai metri dichiarati nella scheda. */
function scaleLabel(unit) {
  if (Math.abs(unit - 1) < 0.12) return 'metri';
  if (Math.abs(unit - 100) < 12) return 'cm';
  if (unit > 1) return `${unit.toFixed(1)}×`;
  return `1:${(1 / unit).toFixed(1)}`;
}

const pad = (v, n) => String(v).padEnd(n);
let failures = 0;
const rows = [];

for (const car of manifest.cars) {
  const file = path.join(CARS, car.file);
  if (!fs.existsSync(file)) {
    rows.push({ car, missing: true });
    failures++;
    continue;
  }
  let box;
  let hiddenPrimitives = 0;
  let partCount = 0;
  try {
    const glb = readGlb(file);
    const collected = collectParts(glb, car.hide ?? []);
    hiddenPrimitives = collected.hiddenPrimitives;
    partCount = collected.parts.length;
    box = bodyBox(collected.parts);
  } catch (err) {
    console.log(`✗ ${car.slug}: ${err.message}`);
    failures++;
    continue;
  }
  if (!box) {
    console.log(`✗ ${car.slug}: nessuna geometria`);
    failures++;
    continue;
  }

  // yaw del manifest porta il muso verso +Z: l'ingombro va letto sugli assi
  // ruotati, altrimenti una macchina a 90° sembra larga quanto è lunga
  const rad = ((car.yaw ?? 0) * Math.PI) / 180;
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (let k = 0; k < 8; k++) {
    const x = k & 1 ? box.max[0] : box.min[0];
    const z = k & 4 ? box.max[2] : box.min[2];
    const rx = x * c + z * s;
    const rz = -x * s + z * c;
    minX = Math.min(minX, rx);
    maxX = Math.max(maxX, rx);
    minZ = Math.min(minZ, rz);
    maxZ = Math.max(maxZ, rz);
  }
  const length = maxZ - minZ;
  const lateral = maxX - minX;
  const height = box.max[1] - box.min[1];
  const declared = car.length;

  // la libreria normalizza la lunghezza: conta la proporzione, non l'unità
  const unit = length / declared;
  const aspectW = lateral / length;
  const aspectH = height / length;
  const moto = car.type === 'moto';
  // una moto è stretta e alta; un'auto larga circa metà della lunghezza
  const wantW = moto ? [0.3, 0.62] : [0.32, 0.6];
  const wantH = moto ? [0.45, 0.78] : [0.24, 0.46];
  const notes = [];
  if (aspectW < wantW[0] || aspectW > wantW[1]) notes.push(`larghezza ${aspectW.toFixed(2)} della lunghezza`);
  if (aspectH < wantH[0] || aspectH > wantH[1]) notes.push(`altezza ${aspectH.toFixed(2)} della lunghezza`);
  if (box.far.length > 0) notes.push(`${box.far.length} pezzi staccati`);
  // solo le proporzioni davvero impossibili contano come errore: le altre
  // restano note da leggere (un'antenna è alta, una moto non è un'auto)
  const broken = aspectW < 0.15 || aspectW > 1.05 || aspectH < 0.12 || aspectH > 1.05;
  if (broken) failures++;

  rows.push({
    car,
    ok: notes.length === 0,
    // dimensioni riportate ai metri come le vede il gioco: la libreria
    // normalizza la lunghezza, quindi conta il rapporto fra gli assi
    length: length / unit,
    width: lateral / unit,
    height: height / unit,
    unit,
    aspectW,
    aspectH,
    parts: partCount,
    hidden: hiddenPrimitives,
    far: box.far,
    all: box.near,
    notes,
  });
}

console.log('\nAuto in public/cars/ (ingombro riportato ai metri, come lo scala la libreria)\n');
console.log(
  pad('modello', 26),
  pad('lung', 8),
  pad('largh', 8),
  pad('alt', 8),
  pad('scala', 8),
  pad('pezzi', 7),
  'esito',
);
for (const row of rows) {
  if (row.missing) {
    console.log(pad(row.car.slug, 26), 'file mancante');
    continue;
  }
  console.log(
    pad(row.car.slug, 26),
    pad(row.length.toFixed(2), 8),
    pad(row.width.toFixed(2), 8),
    pad(row.height.toFixed(2), 8),
    pad(scaleLabel(row.unit), 8),
    pad(row.parts, 7),
    row.ok ? '✓' : `! ${row.notes.join('; ')}`,
  );
}

const detached = rows.filter((r) => !r.missing && r.far.length > 0);
if (detached.length) {
  console.log('\nPezzi lontani dal corpo (da nascondere nel manifest):');
  for (const r of detached) {
    const names = [...new Set(r.far.map((p) => p.name))].slice(0, 6);
    console.log(`  ${r.car.slug}: ${r.far.length} — ${names.join(', ')}${r.far.length > names.length ? '…' : ''}`);
  }
}

const hiddenReport = rows.filter((r) => !r.missing && r.hidden > 0);
if (hiddenReport.length) {
  console.log('\nPezzi già nascosti dal manifest:');
  for (const r of hiddenReport) console.log(`  ${r.car.slug}: ${r.hidden} primitive (${(r.car.hide ?? []).join(', ')})`);
}

if (process.env.VERBOSE) {
  for (const row of rows) {
    if (row.missing) continue;
    console.log(`\n${row.car.slug}: ${row.parts} primitive`);
  }
}

if (process.env.DEEP) {
  // i pezzi più laterali: quando la larghezza misurata supera i due metri è
  // quasi sempre uno di questi a stare fuori posto
  for (const row of rows) {
    if (row.missing || !row.all) continue;
    const far = [...row.all]
      .sort((a, b) => Math.abs(b.center[0]) - Math.abs(a.center[0]))
      .slice(0, 6);
    console.log(`\n${row.car.slug} — pezzi più laterali:`);
    for (const p of far) {
      console.log(
        `  ${p.name}: x ${p.min[0].toFixed(2)}…${p.max[0].toFixed(2)}  y ${p.min[1].toFixed(2)}…${p.max[1].toFixed(2)}`,
      );
    }
  }
}

console.log(
  failures === 0
    ? '\nNessun modello con proporzioni impossibili. Le note sopra sono da leggere, non da correggere per forza.\n'
    : `\n${failures} modello/i con proporzioni impossibili: controlla unità e orientamento.\n`,
);
process.exit(failures === 0 ? 0 : 1);

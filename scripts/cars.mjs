#!/usr/bin/env node
/**
 * Ripristino e controllo dei GLB delle auto di serie.
 *
 * I file in `public/cars/` non sono versionati: se il repository viene clonato
 * su un altro PC (o la cartella viene pulita) il gioco continua a funzionare con
 * le sagome procedurali, ma le auto GLB "spariscono". Questo script:
 *
 * 1. elenca quali file del manifest ci sono e quali mancano;
 * 2. con `--from <cartella>` cerca i GLB in una cartella (anche di un altro PC,
 *    disco esterno o download) e li copia qui col nome giusto, riconoscendo i
 *    nomi originali diversi (`car_Mistery_Porsche.glb`, `m_mg7.glb`, …);
 * 3. verifica che i file copiati siano GLB validi.
 *
 * Uso:
 *   node scripts/cars.mjs
 *   node scripts/cars.mjs --from "D:\\vecchio-pc\\modelli"
 *   node scripts/cars.mjs --from "D:\\vecchio-pc\\modelli" --dry-run
 *   node scripts/cars.mjs --strict          # esce 1 se manca qualche file
 *
 * Opzioni:
 *   --from <dir>   cartella da cui copiare (ricorsiva)
 *   --dry-run      mostra cosa copierebbe, senza scrivere
 *   --force        sovrascrive i file già presenti
 *   --strict       esce con codice 1 se dopo il ripristino manca qualche GLB
 *   --allow-missing  con --from non fallisce se restano file mancanti
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const CARS = path.join(ROOT, 'public', 'cars');
const MANIFEST = path.join(CARS, 'manifest.json');

const args = process.argv.slice(2);
const fromIndex = args.indexOf('--from');
const from = fromIndex >= 0 ? args[fromIndex + 1] : null;
if (fromIndex >= 0 && !from) {
  console.error('Errore: --from richiede una cartella, es. --from "D:\\modelli"');
  process.exit(2);
}
const dryRun = args.includes('--dry-run');
const force = args.includes('--force');
const strict = args.includes('--strict');
const allowMissing = args.includes('--allow-missing');

const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));

/**
 * Nomi con cui gli asset sono stati trovati nei vari PC. Il confronto è
 * normalizzato (minuscole, solo lettere e cifre), quindi `car_Mistery_Porsche`
 * combacia con `car mistery porsche` e con `carmisteryporsche`.
 */
const ALIASES = {
  'lamborghini-aventador': ['lamborghini', 'aventador'],
  'ferrari-458': ['ferrari', '458'],
  'fiat-punto': ['fiat', 'punto', 'fiatpunto'],
  'land-rover-defender': ['landrover', 'defender', 'landroverdefender'],
  'audi-r8': ['audi', 'r8', 'audir8'],
  'cupra-terramar': ['cupra', 'terramar'],
  'porsche-mystery': ['porsche', 'mistery', 'mystery', '911', 'carmisteryporsche'],
  'camaro-bumblebee': [
    'camaro',
    'bumblebee',
    'g1moviebumblebeevehiclemodeupdate',
    'bumblebeevehiclemode',
  ],
  'harley-xyn': ['harley', 'xyn', 'harledson', 'harledsonxyn', 'harleyxyn'],
  mg7: ['mg7', 'mmg7', 'mg'],
};

const GENERIC = new Set([
  'car',
  'cars',
  'auto',
  'vehicle',
  'vehicles',
  'model',
  'modello',
  'glb',
  'final',
  'update',
  'new',
  'low',
  'poly',
  'lowpoly',
  'the',
  'and',
]);

function normalize(value) {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '');
}

function words(value) {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .split(/[^a-z0-9]+/)
    .filter((word) => word && !GENERIC.has(word));
}

function scoreName(car, file) {
  const stem = path.basename(file, path.extname(file));
  const n = normalize(stem);
  const aliases = ALIASES[car.slug] ?? [];
  let best = 0;
  for (const alias of aliases) {
    const a = normalize(alias);
    if (!a) continue;
    if (n === a) best = Math.max(best, 120);
    else if (n.includes(a)) best = Math.max(best, 80 + Math.min(30, a.length));
  }
  // confronto per parole: "2023 Porsche 911 Carrera" → porsche + 911
  const carWords = new Set([...words(car.slug), ...words(car.name)]);
  const fileWords = words(stem);
  let hits = 0;
  for (const word of fileWords) {
    if (carWords.has(word)) hits++;
  }
  if (hits > 0) best = Math.max(best, 30 + hits * 12);
  return best;
}

function listGlb(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '.git') continue;
      listGlb(full, out);
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.glb')) {
      out.push(full);
    }
  }
  return out;
}

function isGlb(file) {
  try {
    const fd = fs.openSync(file, 'r');
    const header = Buffer.alloc(12);
    fs.readSync(fd, header, 0, 12, 0);
    fs.closeSync(fd);
    return (
      header.readUInt32LE(0) === 0x46546c67 &&
      header.readUInt32LE(4) === 2 &&
      header.readUInt32LE(8) > 20
    );
  } catch {
    return false;
  }
}

function human(bytes) {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} kB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const sources = from ? listGlb(path.resolve(from)) : [];
const assignments = new Map();

if (from) {
  const used = new Set();
  for (const car of manifest.cars) {
    let bestFile = null;
    let bestScore = 0;
    let tie = false;
    for (const file of sources) {
      if (used.has(file)) continue;
      const score = scoreName(car, file);
      if (score > bestScore) {
        bestScore = score;
        bestFile = file;
        tie = false;
      } else if (score > 0 && score === bestScore) {
        tie = true;
      }
    }
    if (bestFile && bestScore >= 50 && !tie) {
      assignments.set(car.slug, bestFile);
      used.add(bestFile);
    }
  }
}

const rows = [];
let missing = 0;
let invalid = 0;
let copied = 0;

for (const car of manifest.cars) {
  const target = path.join(CARS, car.file);
  const exists = fs.existsSync(target);

  if (exists && !force) {
    const size = fs.statSync(target).size;
    const valid = isGlb(target);
    rows.push({ car, status: valid ? 'presente' : 'NON VALIDO', size });
    if (!valid) invalid++;
    continue;
  }

  const source = assignments.get(car.slug);
  if (!source) {
    rows.push({ car, status: exists ? 'presente (usa --force)' : 'MANCANTE' });
    missing++;
    continue;
  }

  if (!isGlb(source)) {
    rows.push({ car, status: `sorgente non GLB: ${path.basename(source)}` });
    missing++;
    invalid++;
    continue;
  }

  const size = fs.statSync(source).size;
  if (dryRun) {
    rows.push({
      car,
      status: 'copierebbe',
      size,
      source,
    });
  } else {
    fs.copyFileSync(source, target);
    copied++;
    const valid = isGlb(target);
    rows.push({ car, status: valid ? 'copiato' : 'NON VALIDO', size, source });
    if (!valid) invalid++;
  }
}

console.log('\nAuto di serie in public/cars/\n');
const nameWidth = Math.max(10, ...rows.map((row) => row.car.name.length));
for (const row of rows) {
  const size = row.size ? ` (${human(row.size)})` : '';
  const src = row.source ? `\n    ← ${row.source}` : '';
  console.log(`  ${row.status.padEnd(24)} ${row.car.name.padEnd(nameWidth)}  ${row.car.file}${size}${src}`);
}

if (!from) {
  console.log(
    '\nPer riportare qui i GLB da un altro PC:\n' +
      '  npm run cars -- --from "D:\\\\percorso\\\\con\\\\i\\\\glb"\n' +
      'Aggiungi --dry-run per vedere solo cosa copierebbe, --force per sovrascrivere.\n',
  );
} else if (copied === 0 && !dryRun) {
  console.log('\nNessun file copiato.\n');
} else if (dryRun) {
  console.log('\nProva a vuoto: nessun file scritto.\n');
} else {
  console.log(`\nCopiati ${copied} file.\n`);
}

const unresolved = rows.filter((row) => row.status === 'MANCANTE' || row.status.startsWith('sorgente'));
if (unresolved.length > 0) {
  console.log('File ancora mancanti:');
  for (const row of unresolved) console.log(`  - ${row.car.file} (${row.car.name})`);
  console.log(
    '\nSe i GLB non esistono più su nessun PC non è possibile rigenerarli dal\n' +
      'repository: servono i file originali o una build che li conteneva. Le auto\n' +
      'importate dal giocatore sono in IndexedDB (profilo del browser), non qui.\n',
  );
}

if (invalid > 0) {
  console.log(`${invalid} file non sono GLB validi: ricontrolla la copia.\n`);
}

const failed = invalid > 0 || ((strict || (from && !allowMissing)) && missing > 0);
process.exit(failed ? 1 : 0);

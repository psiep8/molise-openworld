#!/usr/bin/env node
/**
 * Matrice A/B Alta vs Ultra (F13).
 *
 * Stessa posa, stessa ora, stesso meteo: si parte da `high` e `ultra` puliti e
 * poi si riporta **una sola** variabile di Ultra al valore di Alta. Così si
 * isola il contributo di pixelRatio, bloom, SSAO, mappa ombre, densità alberi,
 * landcover e degradazione adattiva.
 *
 * Richiede un dev server già avviato (`npm run dev`) e Chrome raggiungibile
 * (variabile `CHROME_PATH`; su Linux basta `google-chrome` nel PATH).
 *
 *   node scripts/quality-ab.mjs --url http://127.0.0.1:5173
 *
 * Le catture finiscono in `captures/quality-ab/` e il riepilogo in
 * `docs/quality-ab.md`. Senza Chrome lo script si ferma con un messaggio
 * chiaro invece di produrre un report vuoto.
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};

const BASE_URL = arg('url', 'http://127.0.0.1:5173').replace(/\/$/, '');
const OUT_DIR = path.join(ROOT, 'captures', 'quality-ab');
const REPORT = path.join(ROOT, 'docs', 'quality-ab.md');
const WAIT = Number(arg('wait', 14000));

/**
 * Ogni caso è una variabile sola. `ab` vuoto = preset puro.
 * `note` finisce nella tabella: serve a ricordare perché quel caso esiste.
 */
const CASES = [
  { id: 'alta', quality: 'high', ab: '', note: 'riferimento' },
  { id: 'ultra', quality: 'ultra', ab: '', note: 'preset di partenza' },
  { id: 'ultra-pr-1.5', quality: 'ultra', ab: 'pr:1.5', note: 'pixelRatio come Alta' },
  { id: 'ultra-bloom-0.012', quality: 'ultra', ab: 'bloom:0.012', note: 'bloom come Alta' },
  { id: 'ultra-no-ssao', quality: 'ultra', ab: 'ssao:0', note: 'senza SSAO' },
  { id: 'ultra-shadow-2048', quality: 'ultra', ab: 'shadow:2048', note: 'mappa ombre come Alta' },
  { id: 'ultra-trees-20000', quality: 'ultra', ab: 'trees:20000', note: 'alberi come Alta' },
  { id: 'ultra-landcover-1900', quality: 'ultra', ab: 'landcoverRadius:1900', note: 'landcover come Alta' },
  { id: 'ultra-sharpen-0.28', quality: 'ultra', ab: 'sharpen:0.28', note: 'nitidezza come Alta' },
];

function chromeAvailable() {
  const configured = process.env.CHROME_PATH;
  if (configured && existsSync(configured)) return configured;
  const candidates = [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ];
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

function capture(testCase, chrome) {
  const params = new URLSearchParams({ bench: '1', quality: testCase.quality, hour: '16' });
  if (testCase.ab) params.set('ab', testCase.ab);
  // `fixed=1`: niente degradazione adattiva, altrimenti la misura del caso
  // successivo dipende dagli fps del precedente.
  params.set('fixed', '1');
  const url = `${BASE_URL}/?${params.toString()}`;
  const out = path.join(OUT_DIR, `${testCase.id}.png`);
  const result = spawnSync(
    process.execPath,
    [
      path.join(ROOT, 'scripts', 'shot.mjs'),
      '--url', url,
      '--out', out,
      '--wait', String(WAIT),
      '--width', '1280',
      '--height', '800',
      '--ready', 'moliseGame',
      '--eval', 'JSON.stringify(window.__molise?.fps ?? null)',
    ],
    { encoding: 'utf8', env: { ...process.env, CHROME_PATH: chrome } },
  );
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  const fpsMatch = /\[eval\]\s+([0-9.]+|\{[^}]*\}|null)/.exec(output);
  const fps = fpsMatch ? Number(fpsMatch[1]) : Number.NaN;
  return { ...testCase, url, out, fps, ok: result.status === 0 && existsSync(out), output };
}

async function main() {
  const chrome = chromeAvailable();
  if (!chrome) {
    console.error(
      'Chrome non trovato: imposta CHROME_PATH o installa Chrome/Chromium.\n' +
        'La matrice A/B non è stata eseguita (nessuna immagine prodotta).',
    );
    process.exitCode = 2;
    return;
  }
  await mkdir(OUT_DIR, { recursive: true });
  const rows = [];
  for (const testCase of CASES) {
    console.log(`→ ${testCase.id} (${testCase.quality}${testCase.ab ? `, ${testCase.ab}` : ''})`);
    const row = capture(testCase, chrome);
    if (!row.ok) console.error(`  cattura fallita: ${row.output.split('\n').slice(-4).join(' ')}`);
    rows.push(row);
  }

  const lines = [
    '# Alta vs Ultra — matrice A/B',
    '',
    `Generato da \`scripts/quality-ab.mjs\` il ${new Date().toISOString().slice(0, 10)}.`,
    '',
    'Stessa posa del banco prova, ora 16, cielo sereno, `fixed=1` (nessuna',
    'degradazione adattiva): ogni riga cambia **una sola** variabile di Ultra',
    'rispetto al preset puro.',
    '',
    '| caso | preset | override | fps | immagine | note |',
    '| --- | --- | --- | ---: | --- | --- |',
  ];
  for (const row of rows) {
    const image = row.ok ? `[png](../captures/quality-ab/${row.id}.png)` : '—';
    lines.push(
      `| ${row.id} | ${row.quality} | \`${row.ab || '—'}\` | ${
        Number.isFinite(row.fps) ? row.fps.toFixed(1) : '—'
      } | ${image} | ${row.note} |`,
    );
  }
  lines.push(
    '',
    '## Come si legge',
    '',
    '- Se `ultra-bloom-0.012` è visivamente più pulito di `ultra`, il colpevole',
    '  sono gli aloni del bloom (era 0,02: 67% più forte di Alta).',
    '- Se `ultra-shadow-2048` è più stabile di `ultra` senza perdita evidente,',
    '  la mappa 4K non aggiunge dettaglio utile a quella distanza di camera.',
    '- Se `ultra` è più sfocato di `alta`, guardare `__molise.degraded`: la',
    '  degradazione adattiva stava spegnendo ombre e scendendo a 0,5×.',
    '- `fps` viene letto da `window.__molise.fps` a fine cattura; con',
    '  SwiftShader (headless senza GPU) i valori assoluti non sono',
    '  rappresentativi: servono solo a confrontare i casi tra loro.',
  );
  await writeFile(REPORT, `${lines.join('\n')}\n`, 'utf8');
  console.log(`report: ${REPORT}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

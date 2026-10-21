#!/usr/bin/env node
/**
 * Smoke test end-to-end con Chrome headless (WebGL via SwiftShader).
 *
 * Verifica che il gioco:
 *  1. carichi senza errori in console,
 *  2. costruisca i chunk del terreno,
 *  3. risponda ai tasti (accelera davvero),
 *  4. disegni qualcosa di non vuoto (analisi del PNG).
 *
 * Uso:  npm run preview   (in un altro terminale)
 *       npm run smoke
 */
import { spawn } from 'node:child_process';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const PORT = 9223;
const BASE_URL = process.env.SMOKE_URL ?? 'http://127.0.0.1:4173';
const CHROME =
  process.env.CHROME_PATH ??
  (existsSync('C:/Program Files/Google/Chrome/Application/chrome.exe')
    ? 'C:/Program Files/Google/Chrome/Application/chrome.exe'
    : existsSync('C:/Program Files (x86)/Google/Chrome/Application/chrome.exe')
      ? 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'
      : 'google-chrome');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log('[smoke]', ...a);

class CDP {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.handlers = new Map();
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message));
        else resolve(msg.result);
      } else if (msg.method) {
        const list = this.handlers.get(msg.method) ?? [];
        for (const h of list) h(msg.params);
      }
    });
  }

  on(method, fn) {
    const list = this.handlers.get(method) ?? [];
    list.push(fn);
    this.handlers.set(method, list);
  }

  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
}

async function waitForChrome() {
  for (let i = 0; i < 80; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      if (res.ok) return await res.json();
    } catch {
      /* non ancora pronto */
    }
    await sleep(250);
  }
  throw new Error('Chrome headless non risponde sul debug port');
}

async function newTarget(url) {
  const res = await fetch(`http://127.0.0.1:${PORT}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' });
  if (!res.ok) throw new Error(`creazione target: HTTP ${res.status}`);
  return res.json();
}

async function connect(target) {
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', () => reject(new Error('WebSocket CDP fallito')), { once: true });
  });
  return new CDP(ws);
}

function analyzePng(buffer) {
  const png = PNG.sync.read(buffer);
  let sum = 0;
  let sum2 = 0;
  let n = 0;
  const colors = new Set();
  for (let y = 0; y < png.height; y += 6) {
    for (let x = 0; x < png.width; x += 6) {
      const i = (y * png.width + x) * 4;
      const r = png.data[i];
      const g = png.data[i + 1];
      const b = png.data[i + 2];
      const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      sum += lum;
      sum2 += lum * lum;
      n++;
      colors.add(((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4));
    }
  }
  const mean = sum / n;
  const variance = sum2 / n - mean * mean;
  return { width: png.width, height: png.height, mean, variance, uniqueColors: colors.size };
}

async function main() {
  const outDir = path.join(ROOT, 'smoke');
  await mkdir(outDir, { recursive: true });
  await rm(path.join(outDir, 'profile'), { recursive: true, force: true });

  const chrome = spawn(
    CHROME,
    [
      '--headless=new',
      '--disable-gpu',
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-extensions',
      '--mute-audio',
      `--remote-debugging-port=${PORT}`,
      `--user-data-dir=${path.join(outDir, 'profile')}`,
      '--window-size=1280,800',
      'about:blank',
    ],
    { stdio: 'ignore' },
  );

  let exitCode = 1;
  try {
    await waitForChrome();
    log('Chrome pronto, apro il gioco…');
    const target = await newTarget(`${BASE_URL}/?autostart=drive`);
    const cdp = await connect(target);

    const consoleErrors = [];
    cdp.on('Runtime.consoleAPICalled', (p) => {
      if (p.type === 'error') consoleErrors.push(p.args.map((a) => a.value ?? a.description).join(' '));
    });
    cdp.on('Runtime.exceptionThrown', (p) => {
      consoleErrors.push(p.exceptionDetails.exception?.description ?? p.exceptionDetails.text);
    });
    cdp.on('Log.entryAdded', (p) => {
      if (p.entry.level === 'error') consoleErrors.push(p.entry.text);
    });

    await cdp.send('Runtime.enable');
    await cdp.send('Log.enable');
    await cdp.send('Page.enable');

    const evalJs = async (expression) => {
      const res = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
      if (res.exceptionDetails) throw new Error(res.exceptionDetails.text);
      return res.result.value;
    };

    // attesa caricamento
    let diag = null;
    for (let i = 0; i < 90; i++) {
      await sleep(500);
      diag = await evalJs('window.__molise ? JSON.parse(JSON.stringify(window.__molise)) : null').catch(() => null);
      if (diag?.ready && diag.chunks > 3) break;
    }
    if (!diag) throw new Error('window.__molise non è mai comparso');
    log('diagnostica:', JSON.stringify(diag));
    if (!diag.ready) throw new Error('il mondo non è diventato ready');
    if (diag.errors?.length) throw new Error(`errori runtime: ${diag.errors.join(' | ')}`);

    // le tile z17/z18 sono grandi: lascia al provider il tempo di consegnarle
    for (let i = 0; i < 24 && diag.textured < 1; i++) {
      await sleep(500);
      diag = await evalJs('JSON.parse(JSON.stringify(window.__molise))');
    }
    log(`texture: ${diag.textured}/${diag.chunks} chunk (dettagliate z17+: ${diag.detailed})`);

    // guida: W per 1.6s
    await cdp.send('Page.bringToFront');
    await evalJs("window.__keylog=[]; window.addEventListener('keydown', (e) => window.__keylog.push(e.code));");
    const before = { x: diag.x, z: diag.z };
    const key = { code: 'KeyW', key: 'w', windowsVirtualKeyCode: 87, nativeVirtualKeyCode: 87 };
    await cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...key });
    await cdp.send('Input.dispatchKeyEvent', { type: 'char', text: 'w', ...key });
    await sleep(1600);
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', ...key });
    await sleep(400);
    log('keydown ricevuti:', JSON.stringify(await evalJs('window.__keylog')));
    diag = await evalJs('JSON.parse(JSON.stringify(window.__molise))');
    const moved = Math.hypot(diag.x - before.x, diag.z - before.z);
    log(`spostamento con W: ${moved.toFixed(2)} m — mode=${diag.mode}, fps=${diag.fps.toFixed(1)}`);
    if (diag.mode !== 'drive') throw new Error(`modalità attesa drive, trovata ${diag.mode}`);
    if (moved < 1) throw new Error('l’auto non si è mossa con W');
    if (diag.textured < 1) throw new Error('nessun chunk con texture satellite caricata');
    if (diag.detailed < 1) throw new Error('nessun chunk in dettaglio z17+ vicino al giocatore');
    if (consoleErrors.length) throw new Error(`errori console: ${consoleErrors.slice(0, 4).join(' | ')}`);

    // screenshot pulito (senza HUD)
    await evalJs("document.getElementById('hud').style.display='none'; document.getElementById('attribution').style.display='none';");
    await sleep(600);
    const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
    const file = path.join(outDir, 'shot.png');
    await writeFile(file, Buffer.from(shot.data, 'base64'));
    const stats = analyzePng(Buffer.from(shot.data, 'base64'));
    log('screenshot:', JSON.stringify(stats));
    if (stats.variance < 120) throw new Error(`immagine troppo piatta (variance=${stats.variance.toFixed(1)})`);
    if (stats.uniqueColors < 40) throw new Error(`pochi colori distinti (${stats.uniqueColors})`);

    // fai un giro a piedi in una seconda scheda
    const walkTarget = await newTarget(`${BASE_URL}/?autostart=walk`);
    const cdp2 = await connect(walkTarget);
    await cdp2.send('Runtime.enable');
    await cdp2.send('Page.enable');
    let walkDiag = null;
    for (let i = 0; i < 80; i++) {
      await sleep(500);
      const res = await cdp2.send('Runtime.evaluate', {
        expression: 'window.__molise ? JSON.parse(JSON.stringify(window.__molise)) : null',
        returnByValue: true,
      });
      walkDiag = res.result.value;
      if (walkDiag?.ready && walkDiag.running) break;
    }
    if (!walkDiag?.running) throw new Error('la modalità a piedi non è partita');
    const walkBefore = { x: walkDiag.x, z: walkDiag.z };
    await cdp2.send('Page.bringToFront');
    await cdp2.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...key });
    await cdp2.send('Input.dispatchKeyEvent', { type: 'char', text: 'w', ...key });
    await sleep(1200);
    await cdp2.send('Input.dispatchKeyEvent', { type: 'keyUp', ...key });
    await sleep(200);
    const res = await cdp2.send('Runtime.evaluate', {
      expression: 'JSON.parse(JSON.stringify(window.__molise))',
      returnByValue: true,
    });
    walkDiag = res.result.value;
    const walked = Math.hypot(walkDiag.x - walkBefore.x, walkDiag.z - walkBefore.z);
    log(`camminata con W: ${walked.toFixed(2)} m (mode=${walkDiag.mode})`);
    if (walkDiag.mode !== 'walk') throw new Error('modalità a piedi persa');
    if (walked < 1) throw new Error('il giocatore non si è mosso a piedi');

    log('OK — nessun errore console, rendering e input funzionanti');
    exitCode = 0;
  } catch (err) {
    console.error('[smoke] FALLITO:', err.message);
  } finally {
    chrome.kill();
    await sleep(300);
  }
  process.exit(exitCode);
}

main().catch((err) => {
  console.error('[smoke] errore inatteso:', err);
  process.exit(1);
});

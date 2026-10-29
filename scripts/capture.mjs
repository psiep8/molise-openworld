#!/usr/bin/env node
/**
 * Cattura screenshot dal gioco con Chrome headless + CDP, senza dipendenze extra.
 *
 *   node scripts/capture.mjs --out captures/after --quality high
 *   node scripts/capture.mjs --out captures/after --quality high --hour 15
 *   node scripts/capture.mjs --out captures/before --quality medium --url http://127.0.0.1:4180
 *
 * Fa due scatti riproducibili:
 *   1. `spawn.png`  — vista iniziale in modalità guida (stessa posizione a ogni avvio)
 *   2. `drive.png`  — dopo aver percorso ~60 m con W (misurati, non a tempo)
 *
 * Serve un server già attivo (`npm run preview` o `npx vite preview --port 4180`).
 * Con SwiftShader il frame rate è basso: si aspetta la distanza, non i secondi.
 */
import { spawn } from 'node:child_process';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const PORT = 9224;
const CHROME =
  process.env.CHROME_PATH ??
  (existsSync('C:/Program Files/Google/Chrome/Application/chrome.exe')
    ? 'C:/Program Files/Google/Chrome/Application/chrome.exe'
    : 'google-chrome');

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const BASE_URL = arg('url', process.env.SMOKE_URL ?? 'http://127.0.0.1:4180');
const OUT = path.resolve(ROOT, arg('out', 'captures'));
const QUALITY = arg('quality', 'high');
const WIDTH = Number(arg('width', 1280));
const HEIGHT = Number(arg('height', 800));
const DISTANCE = Number(arg('distance', 60));
/** Se indicata (0…24), blocca l'ora del gioco: le catture sono confrontabili a ogni run. */
const HOUR = arg('hour', '');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log('[capture]', ...a);

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
        for (const h of this.handlers.get(msg.method) ?? []) h(msg.params);
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
  for (let i = 0; i < 100; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      if (res.ok) return res.json();
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

function analyze(buffer) {
  const png = PNG.sync.read(buffer);
  let sum = 0;
  let sum2 = 0;
  let n = 0;
  const colors = new Set();
  for (let y = 0; y < png.height; y += 4) {
    for (let x = 0; x < png.width; x += 4) {
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
  return { mean, variance: sum2 / n - mean * mean, uniqueColors: colors.size };
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const profile = path.join(OUT, 'profile');
  await rm(profile, { recursive: true, force: true });

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
      '--hide-scrollbars',
      `--remote-debugging-port=${PORT}`,
      `--user-data-dir=${profile}`,
      `--window-size=${WIDTH},${HEIGHT}`,
      'about:blank',
    ],
    { stdio: 'ignore' },
  );
  try {
    await waitForChrome();
    const target = await newTarget(`${BASE_URL}/?autostart=drive&quality=${QUALITY}`);
    const cdp = await connect(target);
    await cdp.send('Runtime.enable');
    await cdp.send('Page.enable');

    const evalJs = async (expression) => {
      const res = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
      if (res.exceptionDetails) throw new Error(res.exceptionDetails.text);
      return res.result.value;
    };

    let diag = null;
    for (let i = 0; i < 160; i++) {
      await sleep(500);
      diag = await evalJs('window.__molise ? JSON.parse(JSON.stringify(window.__molise)) : null').catch(() => null);
      if (diag?.ready && diag.covered > 2) break;
    }
    if (!diag?.ready) throw new Error('il mondo non è diventato ready');
    log(`ready: preset=${diag.quality} scala=${diag.renderScale} chunk=${diag.chunks} coperti=${diag.covered}`);

    // ora fissa: il sole predefinito segue l'orologio reale, quindi senza questo
    // due catture a distanza di ore non sono confrontabili
    if (HOUR !== '') {
      const hour = Number(HOUR);
      if (!Number.isFinite(hour) || hour < 0 || hour > 24) throw new Error(`--hour non valido: ${HOUR}`);
      await evalJs(`window.moliseGame.setManualTime(true); window.moliseGame.setManualHour(${hour}); true`);
      await sleep(2500);
      log(`ora fissa ${hour.toFixed(1)}`);
    }

    await evalJs("document.getElementById('hud').style.display='none'; const a=document.getElementById('attribution'); if(a) a.style.display='none';");
    await sleep(1500);

    const shoot = async (name) => {
      const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
      const buf = Buffer.from(shot.data, 'base64');
      await writeFile(path.join(OUT, `${name}.png`), buf);
      log(`${name}.png`, JSON.stringify(analyze(buf)));
    };

    await shoot('spawn');

    // guida in avanti finché non ha percorso la distanza richiesta
    const start = { x: diag.x, z: diag.z };
    const key = { code: 'KeyW', key: 'w', windowsVirtualKeyCode: 87, nativeVirtualKeyCode: 87 };
    await cdp.send('Page.bringToFront');
    await cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...key });
    let moved = 0;
    for (let i = 0; i < 120; i++) {
      await sleep(250);
      diag = await evalJs('JSON.parse(JSON.stringify(window.__molise))');
      moved = Math.hypot(diag.x - start.x, diag.z - start.z);
      if (moved >= DISTANCE) break;
    }
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', ...key });
    await sleep(1200);
    log(`percorsi ${moved.toFixed(1)} m`);
    await shoot('drive');
  } finally {
    chrome.kill();
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
if (isMain) {
  main().catch((err) => {
    console.error('[capture] errore:', err.message);
    process.exit(1);
  });
}

export { CDP, analyze, connect, newTarget, sleep, waitForChrome };

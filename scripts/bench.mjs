#!/usr/bin/env node
/**
 * Banco prova del piano realismo: tre pose fisse, ora fissa, meteo sereno.
 *
 *   node scripts/bench.mjs --quality medium --out captures/bench
 *   node scripts/bench.mjs --quality low --out captures/bench-low --seconds 6
 *
 * A differenza di `capture.mjs` NON forza SwiftShader: usa la GPU vera
 * (`--use-angle=d3d11`) e stampa la stringa del renderer. Se la GPU non è
 * disponibile il risultato non è valido e lo script lo dice.
 *
 * Serve un server già attivo (`npm run dev` o `npm run preview`).
 */
import { spawn } from 'node:child_process';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PNG } from 'pngjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const PORT = Number(process.env.BENCH_PORT ?? 9231);
const IS_WSL = existsSync('/mnt/c/Windows');
/**
 * Chromium installati sulla macchina. Brave ed Edge vanno benissimo: sono
 * Chromium e usano lo stesso CDP. Su WSL i percorsi Windows si raggiungono
 * da `/mnt/c/...`.
 */
const BROWSER_CANDIDATES = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/mnt/c/Program Files/Google/Chrome/Application/chrome.exe',
  '/mnt/c/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/mnt/c/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe',
  '/mnt/c/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
];
const CHROME =
  process.env.CHROME_PATH ??
  BROWSER_CANDIDATES.find((p) => existsSync(p)) ??
  (process.platform === 'win32' ? 'chrome.exe' : 'google-chrome');
const PROFILE_WSL = IS_WSL
  ? '/mnt/c/Users/peppa/AppData/Local/Temp/opencode/molise-bench-profile'
  : path.join(os.tmpdir(), 'opencode', 'molise-bench-profile');
const PROFILE_ARG = IS_WSL
  ? 'C:/Users/peppa/AppData/Local/Temp/opencode/molise-bench-profile'
  : PROFILE_WSL;

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const BASE_URL = arg('url', process.env.BENCH_URL ?? 'http://127.0.0.1:5173');
const OUT = path.resolve(ROOT, arg('out', `captures/bench-${arg('quality', 'medium')}`));
const QUALITY = arg('quality', 'medium');
const WIDTH = Number(arg('width', 1280));
const HEIGHT = Number(arg('height', 800));
const SECONDS = Number(arg('seconds', 20));
const VIEWS = arg('views', '0,1,2').split(',').map((v) => Number(v.trim()));
/** parametri extra di query, es. `--params=lcdebug=base` (solo per sonde) */
const PARAMS = arg('params', '');
/** `--poses=x:z:yaw[:pitch],...` salta la misura e fa solo scatti di prova. */
const POSES = arg('poses', '');
/** attesa dopo il teletrasporto, per lasciar cuocere le overlay locali */
const DWELL = Number(arg('dwell', 2500));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log('[bench]', ...a);

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
  for (let i = 0; i < 120; i++) {
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

function analyzePng(buffer) {
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
  return {
    width: png.width,
    height: png.height,
    mean: +mean.toFixed(2),
    variance: +(sum2 / n - mean * mean).toFixed(2),
    uniqueColors: colors.size,
  };
}

async function main() {
  await mkdir(OUT, { recursive: true });
  await rm(PROFILE_WSL, { recursive: true, force: true });
  log(`browser: ${CHROME}`);

  const chrome = spawn(
    CHROME,
    [
      '--headless=new',
      // GPU vera: niente SwiftShader, niente --disable-gpu
      '--use-angle=d3d11',
      '--ignore-gpu-blocklist',
      '--enable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-extensions',
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
      '--mute-audio',
      '--hide-scrollbars',
      `--remote-debugging-port=${PORT}`,
      `--user-data-dir=${PROFILE_ARG}`,
      `--window-size=${WIDTH},${HEIGHT}`,
      'about:blank',
    ],
    { stdio: 'ignore' },
  );

  let exitCode = 1;
  try {
    await waitForChrome();
    const url = `${BASE_URL}/?bench=1&quality=${QUALITY}${PARAMS ? `&${PARAMS}` : ''}`;
    log(`apro ${url}`);
    const target = await newTarget(url);
    const cdp = await connect(target);
    await cdp.send('Runtime.enable');
    await cdp.send('Page.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: WIDTH,
      height: HEIGHT,
      deviceScaleFactor: 1,
      mobile: false,
    });

    const errors = [];
    cdp.on('Runtime.exceptionThrown', (p) => {
      errors.push(p.exceptionDetails?.exception?.description ?? p.exceptionDetails?.text ?? 'eccezione');
    });

    const evalJs = async (expression, awaitPromise = true) => {
      const res = await cdp.send('Runtime.evaluate', {
        expression,
        returnByValue: true,
        awaitPromise,
      });
      if (res.exceptionDetails) {
        throw new Error(res.exceptionDetails.exception?.description ?? res.exceptionDetails.text);
      }
      return res.result.value;
    };

    let diag = null;
    for (let i = 0; i < 240; i++) {
      await sleep(500);
      diag = await evalJs('window.__molise ? JSON.parse(JSON.stringify(window.__molise)) : null').catch(() => null);
      if (diag?.ready) break;
    }
    if (!diag?.ready) throw new Error(`il mondo non è diventato ready (${errors.join(' | ') || 'nessun errore'})`);
    log(`GPU: ${diag.gpu}`);
    log(`preset: ${diag.quality} · scala ${diag.renderScale} · chunk ${diag.chunks}`);

    // niente HUD/attribuzione negli scatti di confronto
    await evalJs(
      "for (const id of ['hud','attribution','start','loading','venue-panel','wallet-panel','settings']) { const el=document.getElementById(id); if(el) el.style.display='none'; } true",
    );

    if (POSES) {
      const list = POSES.split(',').map((s) => s.split(':').map(Number));
      for (let n = 0; n < list.length; n++) {
        const [x, z, yaw, pitch = 0] = list[n];
        // `benchViewIndex=-1` ferma il benchTick: altrimenti riporta il focus
        // della vista fissa e i chunk della posa non si caricano mai.
        await evalJs(
          `(async()=>{const g=window.moliseGame; g.benchViewIndex=-1; g.mode='walk'; g.grass && (g.grass.group.visible=false);` +
            `g.player.spawn(${x},${z},${yaw},g.heights); g.player.pitch=${pitch}; g.player.avatar.visible=false;` +
            `g.snapWalkCamera(); await g.terrain.preload(${x},${z},Math.min(1600,g.viewRadius));` +
            `g.terrain.update(${x},${z},g.viewRadius,true); return true;})()`,
        );
        for (let i = 0; i < 60; i++) {
          const d = await evalJs('JSON.parse(JSON.stringify(window.__molise))').catch(() => null);
          if (d && (d.landcover?.pending ?? 0) === 0) break;
          await sleep(500);
        }
        await sleep(DWELL);
        const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
        const buf = Buffer.from(shot.data, 'base64');
        const file = `pose-${n}.png`;
        await writeFile(path.join(OUT, file), buf);
        log(`${file}: ${JSON.stringify(analyzePng(buf))}`);
      }
      exitCode = 0;
      return;
    }

    const results = [];
    for (const index of VIEWS) {
      const info = await evalJs(`window.moliseGame.benchView(${index})`);
      if (!info) throw new Error(`vista ${index} non disponibile`);
      log(`vista ${index}: ${info.label}`);

      // assestamento: chunk caricati e texture arrivate. Aspettare solo il
      // numero di chunk non basta: le texture satellite si decodificano dopo e
      // facevano sembrare lenta la prima misura di ogni preset.
      let prev = null;
      let stable = 0;
      for (let i = 0; i < 90; i++) {
        await sleep(500);
        const d = await evalJs('JSON.parse(JSON.stringify(window.__molise))');
        const lcPending = d.landcover?.pending ?? 0;
        const ready = d.chunks > 0 && d.textured >= d.chunks && lcPending === 0 && d.detailed === (prev?.detailed ?? d.detailed);
        if (ready && d.chunks === (prev?.chunks ?? -1)) stable++;
        else stable = 0;
        prev = d;
        if (stable >= 6) break;
      }
      log(
        `assestato: ${prev?.chunks ?? 0} chunk, ${prev?.textured ?? 0} texture, ${prev?.detailed ?? 0} dettagliati, ` +
          `copertura ${prev?.landcover?.mode ?? 'assente'} (${prev?.landcover?.local ?? 0} locali, ` +
          `${prev?.landcover?.pending ?? 0} in attesa, ${prev?.landcover?.bakes ?? 0} cotte in ` +
          `${prev?.landcover?.bakeMs ?? 0} ms)`,
      );

      await evalJs(`window.moliseGame.benchStart(${SECONDS})`);
      let result = null;
      for (let i = 0; i < (SECONDS + 20) * 4; i++) {
        await sleep(250);
        result = await evalJs('window.moliseGame.benchResult()');
        if (result) break;
      }
      if (!result) throw new Error(`misura della vista ${index} non completata`);

      const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
      const buf = Buffer.from(shot.data, 'base64');
      const file = `${info.id}.png`;
      await writeFile(path.join(OUT, file), buf);
      const pixels = analyzePng(buf);
      result.screenshot = file;
      result.pixels = pixels;
      results.push(result);
      log(
        `${info.id}: ${result.fpsAvg.toFixed(1)} fps medi · ${result.fpsMin.toFixed(1)} min · ` +
          `${result.drawCallsAvg.toFixed(0)} draw call · ${(result.trianglesAvg / 1e6).toFixed(2)} M tri · ` +
          `${result.textures} texture (~${result.textureMB.toFixed(0)} MB)`,
      );
    }

    const summary = {
      generatedAt: new Date().toISOString(),
      url: BASE_URL,
      quality: QUALITY,
      viewport: { width: WIDTH, height: HEIGHT },
      gpu: diag.gpu,
      qualityDetected: diag.quality,
      renderScale: diag.renderScale,
      landcover: diag.landcover ?? null,
      textureMBScope: 'stima delle immagini di scena (esclude i render target del post)',
      results,
      errors,
    };
    await writeFile(path.join(OUT, 'results.json'), JSON.stringify(summary, null, 2));
    log(`scritto ${path.relative(ROOT, path.join(OUT, 'results.json'))}`);
    exitCode = 0;
  } finally {
    chrome.kill();
  }
  process.exit(exitCode);
}

main().catch((err) => {
  console.error('[bench] errore:', err.message);
  process.exit(1);
});

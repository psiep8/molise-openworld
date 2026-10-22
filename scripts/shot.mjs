#!/usr/bin/env node
/**
 * Minimo: apre un URL in Chrome headless, aspetta la pagina e salva un PNG.
 *
 *   node scripts/shot.mjs --url http://127.0.0.1:4184/harness.html --out captures/body.png
 */
import { spawn } from 'node:child_process';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const PORT = Number(process.env.SHOT_PORT ?? 9333);
const CHROME =
  process.env.CHROME_PATH ??
  (existsSync('C:/Program Files/Google/Chrome/Application/chrome.exe')
    ? 'C:/Program Files/Google/Chrome/Application/chrome.exe'
    : 'google-chrome');

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};

const URL_ = arg('url', 'http://127.0.0.1:4184/harness.html');
const OUT = path.resolve(ROOT, arg('out', 'captures/shot.png'));
const WAIT = Number(arg('wait', 2500));
const WIDTH = Number(arg('width', 1280));
const HEIGHT = Number(arg('height', 800));
const HIDE = arg('hide', '');
const READY = arg('ready', '');
const EVAL = arg('eval', '');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class CDP {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message));
        else resolve(msg.result);
      }
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
}

async function main() {
  const profile = path.join(ROOT, 'captures', `shot-profile-${PORT}`);
  await rm(profile, { recursive: true, force: true });
  await mkdir(path.dirname(OUT), { recursive: true });
  const chrome = spawn(
    CHROME,
    [
      '--headless=new',
      '--disable-gpu',
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
      '--no-first-run',
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
    let list = null;
    for (let i = 0; i < 60; i++) {
      await sleep(300);
      try {
        const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
        list = await res.json();
        if (list.length) break;
      } catch {
        // chrome non ancora pronto
      }
    }
    if (!list) throw new Error('chrome non è partito');
    const target = await (
      await fetch(`http://127.0.0.1:${PORT}/json/new?${encodeURIComponent(URL_)}`, { method: 'PUT' })
    ).json();
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((r) => ws.addEventListener('open', r, { once: true }));
    const cdp = new CDP(ws);
    await cdp.send('Runtime.enable');
    await cdp.send('Page.enable');
    // log del browser: senza, una pagina bianca non dice perché è bianca
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.method === 'Runtime.consoleAPICalled') {
        const text = (msg.params.args ?? []).map((a) => a.value ?? a.description ?? '').join(' ');
        console.log('[console]', msg.params.type, text);
      } else if (msg.method === 'Runtime.exceptionThrown') {
        const d = msg.params.exceptionDetails;
        console.log('[errore]', d.text, d.exception?.description ?? d.exception?.value ?? '');
      }
    });
    await sleep(WAIT);
    if (READY) {
      for (let i = 0; i < 60; i++) {
        const res = await cdp.send('Runtime.evaluate', {
          expression: `Boolean(window.${READY})`,
          returnByValue: true,
        });
        if (res.result.value) break;
        await sleep(400);
      }
      await sleep(900);
    }
    if (HIDE) {
      await cdp.send('Runtime.evaluate', {
        expression: `document.querySelectorAll('${HIDE}').forEach((e) => (e.style.display = 'none'))`,
      });
      await sleep(400);
    }
    if (EVAL) {
      const res = await cdp.send('Runtime.evaluate', {
        expression: EVAL,
        returnByValue: true,
        awaitPromise: true,
      });
      console.log('[eval]', JSON.stringify(res.result.value ?? res.exceptionDetails?.text));
    }
    const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
    await writeFile(OUT, Buffer.from(shot.data, 'base64'));
    console.log(`salvato ${OUT}`);
    ws.close();
  } finally {
    chrome.kill();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

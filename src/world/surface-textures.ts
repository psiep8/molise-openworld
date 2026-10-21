import * as THREE from 'three';
import { mulberry32 } from '../geo/geo';

/**
 * Texture procedurali, deterministiche e senza asset esterni.
 * Sono pensate per essere moltiplicate dal vertex color della mesh:
 * restano quindi chiare (0.6–0.95) e aggiungono solo grana e giunti.
 */

function makeTexture(size: number, paint: (data: Uint8ClampedArray, rng: () => number) => void, seed: number): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas 2d non disponibile');
  const img = ctx.createImageData(size, size);
  paint(img.data, mulberry32(seed));
  ctx.putImageData(img, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = 8;
  texture.needsUpdate = true;
  return texture;
}

function makeDrawnTexture(
  size: number,
  draw: (ctx: CanvasRenderingContext2D, rng: () => number) => void,
  seed: number,
): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas 2d non disponibile');
  draw(ctx, mulberry32(seed));
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = 8;
  texture.needsUpdate = true;
  return texture;
}

const clamp255 = (v: number): number => (v < 0 ? 0 : v > 255 ? 255 : v);

function grain(data: Uint8ClampedArray, rng: () => number, base: number, spread: number): void {
  for (let i = 0; i < data.length; i += 4) {
    const n = (rng() - 0.5) * spread;
    data[i] = clamp255(base + n);
    data[i + 1] = clamp255(base + n);
    data[i + 2] = clamp255(base + n);
    data[i + 3] = 255;
  }
}

/** Asfalto: grigio scuro con aggregati chiari e qualche crepa sottile. */
export function asphaltTexture(): THREE.CanvasTexture {
  return makeTexture(
    256,
    (data, rng) => {
      grain(data, rng, 218, 30);
      for (let i = 0; i < 900; i++) {
        const x = Math.floor(rng() * 256);
        const y = Math.floor(rng() * 256);
        const k = (y * 256 + x) * 4;
        const v = 196 + rng() * 48;
        data[k] = v;
        data[k + 1] = v;
        data[k + 2] = v;
      }
      for (let c = 0; c < 7; c++) {
        let x = rng() * 256;
        let y = rng() * 256;
        for (let s = 0; s < 26; s++) {
          x += (rng() - 0.5) * 5;
          y += rng() * 3;
          const k = ((Math.floor(y) % 256) * 256 + (Math.floor(x) % 256)) * 4;
          data[k] = data[k + 1] = data[k + 2] = 172;
        }
      }
    },
    1337,
  );
}

/** Sterrato: beige con sassi e due solchi di ruota appena accennati. */
export function dirtTexture(): THREE.CanvasTexture {
  return makeTexture(
    256,
    (data, rng) => {
      grain(data, rng, 224, 30);
      for (let i = 0; i < 700; i++) {
        const x = Math.floor(rng() * 256);
        const y = Math.floor(rng() * 256);
        const k = (y * 256 + x) * 4;
        const v = 170 + rng() * 66;
        data[k] = v;
        data[k + 1] = v * 0.96;
        data[k + 2] = v * 0.88;
      }
    },
    4242,
  );
}

/** Intonaco/pietra: chiaro, con leggere fasce orizzontali. */
export function plasterTexture(): THREE.CanvasTexture {
  return makeTexture(
    128,
    (data, rng) => {
      grain(data, rng, 238, 16);
      for (let y = 0; y < 128; y++) {
        if (y % 32 !== 0) continue;
        for (let x = 0; x < 128; x++) {
          const k = (y * 128 + x) * 4;
          const v = data[k] * 0.9;
          data[k] = v;
          data[k + 1] = v;
          data[k + 2] = v;
        }
      }
    },
    777,
  );
}

/**
 * Facciata di un edificio di paese: intonaco, finestra con telaio, persiane e
 * davanzale. Il modulo è alto 1/2 di tile, quindi con repeat 0.3 copre ~3,3 m:
 * una finestra per piano, come nelle case vere.
 *
 * È moltiplicata dal vertex color del muro, perciò resta chiara e poco satura:
 * la variazione di colore fra una casa e l'altra la dà il vertex color.
 */
export function facadeTexture(): THREE.CanvasTexture {
  return makeDrawnTexture(
    128,
    (ctx, rng) => {
      // intonaco chiaro con grana
      ctx.fillStyle = '#ece7da';
      ctx.fillRect(0, 0, 128, 128);
      for (let i = 0; i < 2600; i++) {
        const v = 226 + Math.floor(rng() * 26);
        ctx.fillStyle = `rgb(${v},${v - 3},${v - 10})`;
        ctx.fillRect(Math.floor(rng() * 128), Math.floor(rng() * 128), 1, 1);
      }
      // macchie di umidità verticali, deterministiche
      for (let i = 0; i < 3; i++) {
        const x = Math.floor(rng() * 128);
        const w = 3 + Math.floor(rng() * 6);
        ctx.fillStyle = 'rgba(150, 143, 126, 0.10)';
        ctx.fillRect(x, 0, w, 128);
      }

      // cornice superiore della finestra
      ctx.fillStyle = '#ddd5c2';
      ctx.fillRect(32, 20, 64, 5);

      // davanzale
      ctx.fillStyle = '#f4efe3';
      ctx.fillRect(30, 103, 68, 7);
      ctx.fillStyle = 'rgba(110, 102, 86, 0.35)';
      ctx.fillRect(30, 110, 68, 2);

      // telaio in pietra
      ctx.fillStyle = '#f1ebdc';
      ctx.fillRect(34, 25, 60, 78);

      // vetro con riflesso obliquo
      const gradient = ctx.createLinearGradient(40, 31, 88, 97);
      gradient.addColorStop(0, '#4b5b67');
      gradient.addColorStop(0.45, '#2c3841');
      gradient.addColorStop(1, '#202a31');
      ctx.fillStyle = gradient;
      ctx.fillRect(40, 31, 48, 66);
      ctx.fillStyle = 'rgba(150, 178, 194, 0.22)';
      ctx.beginPath();
      ctx.moveTo(40, 92);
      ctx.lineTo(70, 31);
      ctx.lineTo(84, 31);
      ctx.lineTo(48, 97);
      ctx.closePath();
      ctx.fill();

      // traversa e montante
      ctx.fillStyle = '#d9d2c0';
      ctx.fillRect(62, 31, 3, 66);
      ctx.fillRect(40, 62, 48, 3);

      // persiane di legno ai lati
      for (const [x, dir] of [[22, 1], [94, -1]] as const) {
        ctx.fillStyle = '#9a8a6a';
        ctx.fillRect(dir > 0 ? x : x - 12, 26, 12, 76);
        ctx.fillStyle = 'rgba(70, 60, 42, 0.45)';
        for (let y = 29; y < 100; y += 5) ctx.fillRect(dir > 0 ? x : x - 12, y, 12, 2);
        ctx.fillStyle = 'rgba(255, 250, 235, 0.16)';
        ctx.fillRect(dir > 0 ? x : x - 12, 26, 2, 76);
      }
    },
    4127,
  );
}

/** Laterizio: file di coppi con giunti scuri. */
export function roofTileTexture(): THREE.CanvasTexture {
  return makeTexture(
    128,
    (data, rng) => {
      grain(data, rng, 232, 22);
      const row = 16;
      const col = 24;
      for (let y = 0; y < 128; y++) {
        for (let x = 0; x < 128; x++) {
          const k = (y * 128 + x) * 4;
          const rowIdx = Math.floor(y / row);
          const offset = (rowIdx % 2) * (col / 2);
          const gx = (x + offset) % col;
          const gy = y % row;
          let shade = 1;
          if (gy < 2 || gx < 2) shade = 0.72;
          else if (gy < 5 || gx < 5) shade = 0.88;
          if (gy === row - 1) shade *= 0.94;
          data[k] = clamp255(data[k] * shade);
          data[k + 1] = clamp255(data[k + 1] * shade * 0.98);
          data[k + 2] = clamp255(data[k + 2] * shade * 0.95);
        }
      }
    },
    909,
  );
}

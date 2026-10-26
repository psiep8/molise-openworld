import * as THREE from 'three';

/**
 * Normal map procedurali per i dettagli che a 1-2 m fanno la differenza:
 * pori della pelle e trama del tessuto. Sono generate su canvas (nessun asset)
 * e condivise da tutti i materiali che le usano.
 *
 * Il rilievo è ricavato da un rumore di valore: si campiona l'altezza su una
 * griglia e si converte in normale con le differenze centrali, esattamente come
 * per una normal map da heightmap.
 */

function valueNoise(size: number, seed: number, freq: number): Float32Array {
  const lattice = freq + 1;
  const grid = new Float32Array(lattice * lattice);
  let s = seed >>> 0;
  for (let i = 0; i < grid.length; i++) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    grid[i] = s / 4294967295;
  }
  const at = (x: number, y: number): number => grid[(y % lattice) * lattice + (x % lattice)];
  const smooth = (t: number): number => t * t * (3 - 2 * t);
  const out = new Float32Array(size * size);
  const scale = freq / size;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const fx = x * scale;
      const fy = y * scale;
      const ix = Math.floor(fx);
      const iy = Math.floor(fy);
      const tx = smooth(fx - ix);
      const ty = smooth(fy - iy);
      const a = at(ix, iy);
      const b = at(ix + 1, iy);
      const c = at(ix, iy + 1);
      const d = at(ix + 1, iy + 1);
      out[y * size + x] = a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty;
    }
  }
  return out;
}

function normalTexture(size: number, seed: number, freq: number, strength: number, repeat: number): THREE.CanvasTexture {
  let height = valueNoise(size, seed, freq);
  // seconda ottava: la grana fine senza cui il rilievo sembra una buccia d'arancia
  const fine = valueNoise(size, seed ^ 0x9e3779b9, Math.max(2, freq * 3));
  for (let i = 0; i < height.length; i++) height[i] = height[i] * 0.72 + fine[i] * 0.28;

  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas 2d non disponibile');
  const img = ctx.createImageData(size, size);
  const sample = (x: number, y: number): number => {
    const xx = (x + size) % size;
    const yy = (y + size) % size;
    return height[yy * size + xx];
  };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (sample(x + 1, y) - sample(x - 1, y)) * strength;
      const dy = (sample(x, y + 1) - sample(x, y - 1)) * strength;
      const len = Math.hypot(dx, dy, 1);
      const k = (y * size + x) * 4;
      img.data[k] = (-dx / len) * 127.5 + 127.5;
      img.data[k + 1] = (dy / len) * 127.5 + 127.5;
      img.data[k + 2] = (1 / len) * 127.5 + 127.5;
      img.data[k + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(repeat, repeat);
  texture.colorSpace = THREE.NoColorSpace;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  return texture;
}

let skin: THREE.CanvasTexture | null = null;
let fabric: THREE.CanvasTexture | null = null;

/** Pori e microincrespature della pelle: rompono il plasticone lucido. */
export function skinNormal(): THREE.CanvasTexture {
  skin ??= normalTexture(128, 0x5c1a, 26, 1.6, 9);
  return skin;
}

/** Trama a tela del cotone: si vede sui pantaloni e sulle maglie. */
export function fabricNormal(): THREE.CanvasTexture {
  fabric ??= normalTexture(128, 0x2f77, 18, 1.1, 14);
  return fabric;
}

/**
 * Micro-rilievo del terreno: zolle, sassi e peli d'erba sotto il metro.
 * Si campiona in coordinate mondo (rettangolo di 0,8 m, vedi terrain.ts),
 * quindi `repeat` resta 1 e il filtro è ripetuto ai bordi.
 */
let terrainMicro: THREE.CanvasTexture | null = null;
export function terrainMicroNormal(): THREE.CanvasTexture {
  terrainMicro ??= normalTexture(256, 0x7a31, 12, 1.3, 1);
  return terrainMicro;
}

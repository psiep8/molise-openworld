import * as THREE from 'three';
import { mulberry32 } from '../geo/geo';

const SIZE = 256;
const RADIUS = 6200;

function makeGrid(n: number, rng: () => number): Float32Array {
  const grid = new Float32Array(n * n);
  for (let i = 0; i < grid.length; i++) grid[i] = rng();
  return grid;
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

/** Value noise periodico: le tile del cielo devono richiudersi senza cuciture. */
function sampleGrid(grid: Float32Array, n: number, u: number, v: number): number {
  const x = u * n;
  const y = v * n;
  const x0 = Math.floor(x) % n;
  const y0 = Math.floor(y) % n;
  const x1 = (x0 + 1) % n;
  const y1 = (y0 + 1) % n;
  const tx = smooth(x - Math.floor(x));
  const ty = smooth(y - Math.floor(y));
  const a = grid[y0 * n + x0];
  const b = grid[y0 * n + x1];
  const c = grid[y1 * n + x0];
  const d = grid[y1 * n + x1];
  return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
}

function cloudAlphaMap(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas 2d non disponibile');
  const img = ctx.createImageData(SIZE, SIZE);
  const rng = mulberry32(20261021);
  const octaves = [
    { n: 6, amp: 0.5, grid: makeGrid(6, rng) },
    { n: 12, amp: 0.26, grid: makeGrid(12, rng) },
    { n: 24, amp: 0.16, grid: makeGrid(24, rng) },
    { n: 48, amp: 0.08, grid: makeGrid(48, rng) },
  ];

  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      let value = 0;
      for (const o of octaves) value += sampleGrid(o.grid, o.n, x / SIZE, y / SIZE) * o.amp;
      // più contrasto: nuvole con bordi morbidi e vuoti trasparenti
      const alpha = Math.max(0, Math.min(1, (value - 0.36) / 0.34));
      const k = (y * SIZE + x) * 4;
      const v = Math.round(alpha * 255);
      img.data[k] = v;
      img.data[k + 1] = v;
      img.data[k + 2] = v;
      img.data[k + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.repeat.set(2, 1);
  texture.colorSpace = THREE.NoColorSpace;
  texture.needsUpdate = true;
  return texture;
}

export interface CloudConditions {
  /** 0..1 */
  coverage: number;
  windX: number;
  windZ: number;
  sunElevation: number;
}

/** Cupola di nuvole procedurali, una sola draw call, segue la camera. */
export class CloudLayer {
  readonly mesh: THREE.Mesh;
  private readonly material: THREE.MeshBasicMaterial;
  private readonly dayColor = new THREE.Color(0xf2f6f8);
  private readonly duskColor = new THREE.Color(0xf3c49c);
  private readonly nightColor = new THREE.Color(0x26334a);
  private readonly tint = new THREE.Color();
  private drift = 0;

  constructor() {
    const geometry = new THREE.SphereGeometry(RADIUS, 32, 16);
    this.material = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0,
      alphaMap: cloudAlphaMap(),
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
    });
    this.mesh = new THREE.Mesh(geometry, this.material);
    this.mesh.name = 'clouds';
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
  }

  update(dt: number, camera: THREE.Camera, conditions: CloudConditions): void {
    const coverage = Math.max(0, Math.min(1, conditions.coverage));
    this.mesh.visible = coverage > 0.02;
    if (!this.mesh.visible) return;

    this.mesh.position.copy(camera.position);
    this.material.opacity = Math.min(0.92, coverage * 0.9);

    const elevation = conditions.sunElevation;
    if (elevation < -2) this.tint.copy(this.nightColor);
    else if (elevation < 14) {
      const t = Math.max(0, Math.min(1, (elevation + 2) / 16));
      this.tint.copy(this.duskColor).lerp(this.dayColor, t);
    } else this.tint.copy(this.dayColor);
    this.material.color.copy(this.tint);

    const wind = Math.hypot(conditions.windX, conditions.windZ);
    const dir = Math.atan2(conditions.windX, conditions.windZ);
    this.drift += dt * (0.0012 + Math.min(0.006, wind * 0.00025)) * (Math.cos(dir) >= 0 ? 1 : -1);
    this.mesh.rotation.y = this.drift;
  }

  setVisible(visible: boolean): void {
    this.mesh.visible = visible;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.material.alphaMap?.dispose();
    this.material.dispose();
  }
}

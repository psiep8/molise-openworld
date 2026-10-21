import * as THREE from 'three';
import { CHUNK_SIZE, TERRAIN_SEGMENTS, VIEW_RADIUS } from '../config';
import type { Heightfield } from '../geo/elevation';
import { chunkCenter, chunkIndex, chunkKey, chunkOrigin } from './chunks';
import { zoomForDistance, type ImageryStreamer } from './imagery';

interface Chunk {
  cx: number;
  cz: number;
  mesh: THREE.Mesh;
  material: THREE.MeshStandardMaterial;
  normalMap: THREE.Texture;
  /** zoom attualmente applicato alla texture (0 = nessuna) */
  textureZoom: number;
  texture?: THREE.Texture;
  loadingZoom?: number;
  hasTexture: boolean;
  disposed: boolean;
}

const NORMAL_MAP_SIZE = 128;
const NORMAL_STRENGTH = 2.6;

/**
 * Normal map ricavata dal DEM: il rilievo "fine" (muretti, fossi, crinali)
 * resta visibile anche quando la geometria è più grossolana del dato.
 * Gli assi sono in spazio tangente: X = est, Y = nord, Z = su.
 */
function buildNormalMap(hf: Heightfield, cx: number, cz: number): THREE.CanvasTexture {
  const size = NORMAL_MAP_SIZE;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas 2d non disponibile');
  const img = ctx.createImageData(size, size);
  const ox = chunkOrigin(cx);
  const oz = chunkOrigin(cz);
  const step = CHUNK_SIZE / (size - 1);
  const max = size - 1;
  const sample = (i: number, j: number): number => {
    const ii = i < 0 ? 0 : i > max ? max : i;
    const jj = j < 0 ? 0 : j > max ? max : j;
    return hf.heightAt(ox + ii * step, oz + jj * step);
  };

  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const hL = sample(i - 1, j);
      const hR = sample(i + 1, j);
      const hN = sample(i, j - 1);
      const hS = sample(i, j + 1);
      let nx = ((hL - hR) / (2 * step)) * NORMAL_STRENGTH;
      let ny = ((hS - hN) / (2 * step)) * NORMAL_STRENGTH;
      let nz = 1;
      const len = Math.hypot(nx, ny, nz) || 1;
      nx /= len;
      ny /= len;
      nz /= len;
      const k = (j * size + i) * 4;
      img.data[k] = (nx * 0.5 + 0.5) * 255;
      img.data[k + 1] = (ny * 0.5 + 0.5) * 255;
      img.data[k + 2] = (nz * 0.5 + 0.5) * 255;
      img.data[k + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

/**
 * Texture granular detail overlay per terreni: aggiunge piccoli dettagli di grana
 * che rimangono visibili anche a distanze maggiori, moltiplicati per il vertex color.
 */
function buildDetailTexture(hf: Heightfield, cx: number, cz: number): THREE.CanvasTexture {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas 2d non disponibile');
  const img = ctx.createImageData(size, size);
  const ox = chunkOrigin(cx);
  const oz = chunkOrigin(cz);
  const step = CHUNK_SIZE / (size - 1);
  const max = size - 1;
  const sample = (i: number, j: number): number => hf.heightAt(ox + i * step, oz + j * step);
  const mean = (hf.heightAt(ox, oz) + hf.heightAt(ox + CHUNK_SIZE, oz + CHUNK_SIZE)) / 2;
  const range = mean * 0.15;

  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const h = sample(i, j);
      const norm = (h - mean) / range;
      const val = (norm + 1) / 2 * 200 + 55;
      const k = (j * size + i) * 4;
      img.data[k] = val;
      img.data[k + 1] = val;
      img.data[k + 2] = val;
      img.data[k + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  return texture;
}

/**
 * Aggiunge dettaglio di grana alla mesh terrain usando vertex colors aggiuntivi
 * per simulare micro-rilievo senza impatto prestazionale enorme.
 */
function addDetailVertexColors(geometry: THREE.BufferGeometry, hf: Heightfield, cx: number, cz: number): void {
  const count = geometry.attributes.position.count;
  const colors = new THREE.InstancedBufferAttribute(new Float32Array(count * 3), 3);
  const ox = chunkOrigin(cx);
  const oz = chunkOrigin(cz);
  const step = CHUNK_SIZE / 64;
  const maxX = 64;
  const maxZ = 64;

  for (let i = 0; i < count; i++) {
    const wx = geometry.attributes.position.getX(i);
    const wz = geometry.attributes.position.getZ(i);
    const bx = Math.round((wx - ox) / step);
    const bz = Math.round((wz - oz) / step);
    const bi = (bz * maxX + bx + (bx < 0 ? maxX + bx : bx)) % (maxX * maxZ);
    const h = hf.heightAt(wx, wz);
    const norm = ((h - meanHeight) / (maxHeight * 0.15) + 1) / 2;
    colors.setXYZ(i, norm, norm, norm);
  }
  geometry.setAttribute('color', colors);
}

/**
 * Streaming del terreno a chunk: geometria dal DEM, texture satellite dal
 * provider con zoom progressivo (z15 lontano → z18 vicino) e normal map.
 * Carica al massimo N chunk per frame, ordina per distanza e libera quelli lontani.
 */
export class Terrain {
  readonly group = new THREE.Group();
  private readonly chunks = new Map<string, Chunk>();
  private readonly queue: { cx: number; cz: number; d: number }[] = [];
  private readonly heightfield: Heightfield;
  private readonly imagery: ImageryStreamer;
  private readonly maxBuildPerFrame = 2;
  private readonly maxTextureLoads = 5;
  private readonly inflight = new Set<string>();
  /** tetto dello zoom satellite, abbassato dai preset grafici più leggeri */
  private maxZoom = 18;
  private focusX = 0;
  private focusZ = 0;
  private lastCx = Number.NaN;
  private lastCz = Number.NaN;
  private lastRadius = 0;

  constructor(heightfield: Heightfield, imagery: ImageryStreamer, maxZoom = 18) {
    this.heightfield = heightfield;
    this.imagery = imagery;
    this.maxZoom = Math.max(15, Math.min(18, maxZoom));
    this.group.name = 'terrain';
  }

  /** Cambia il tetto di dettaglio a runtime (tasto G / preset qualità). */
  setMaxZoom(zoom: number): void {
    this.maxZoom = Math.max(15, Math.min(18, zoom));
  }

  get loadedChunks(): number {
    return this.chunks.size;
  }

  get texturedChunks(): number {
    let n = 0;
    for (const c of this.chunks.values()) if (c.hasTexture) n++;
    return n;
  }

  /** Chunk con texture almeno z17 (per diagnostica e smoke test). */
  get detailedChunks(): number {
    let n = 0;
    for (const c of this.chunks.values()) if (c.textureZoom >= 17) n++;
    return n;
  }

  /** Costruisce subito i chunk entro un raggio (usato dalla schermata di caricamento). */
  async preload(x: number, z: number, radius = 1600): Promise<void> {
    this.update(x, z, radius, true);
    const start = performance.now();
    while ((this.queue.length > 0 || this.inflight.size > 0) && performance.now() - start < 4500) {
      this.buildNext();
      this.tick();
      await new Promise((r) => setTimeout(r, 8));
    }
  }

  update(x: number, z: number, radius = VIEW_RADIUS, force = false): void {
    this.focusX = x;
    this.focusZ = z;
    const cx = chunkIndex(x);
    const cz = chunkIndex(z);
    if (!force && cx === this.lastCx && cz === this.lastCz && Math.abs(radius - this.lastRadius) < 1) {
      return;
    }
    this.lastCx = cx;
    this.lastCz = cz;
    this.lastRadius = radius;

    const r = Math.ceil(radius / CHUNK_SIZE);
    const wanted = new Set<string>();
    this.queue.length = 0;

    for (let ix = cx - r; ix <= cx + r; ix++) {
      for (let iz = cz - r; iz <= cz + r; iz++) {
        const dx = chunkCenter(ix) - x;
        const dz = chunkCenter(iz) - z;
        const d = Math.hypot(dx, dz);
        if (d > radius + CHUNK_SIZE * 0.5) continue;
        const key = chunkKey(ix, iz);
        wanted.add(key);
        if (!this.chunks.has(key)) {
          this.queue.push({ cx: ix, cz: iz, d });
        }
      }
    }
    this.queue.sort((a, b) => a.d - b.d);

    for (const [key, chunk] of this.chunks) {
      if (!wanted.has(key)) this.disposeChunk(chunk, key);
    }
  }

  /** Da chiamare ogni frame: costruisce qualche chunk e affina le texture vicine. */
  tick(): void {
    for (let i = 0; i < this.maxBuildPerFrame && this.queue.length > 0; i++) {
      this.buildNext();
    }

    if (this.inflight.size >= this.maxTextureLoads) return;
    const upgrades: { chunk: Chunk; d: number; zoom: number }[] = [];
    for (const chunk of this.chunks.values()) {
      if (chunk.disposed || chunk.loadingZoom !== undefined) continue;
      if (this.inflight.has(chunkKey(chunk.cx, chunk.cz))) continue;
      const d = Math.hypot(chunkCenter(chunk.cx) - this.focusX, chunkCenter(chunk.cz) - this.focusZ);
      const zoom = Math.min(this.maxZoom, zoomForDistance(d));
      if (zoom > chunk.textureZoom) upgrades.push({ chunk, d, zoom });
    }
    upgrades.sort((a, b) => a.d - b.d);
    let started = 0;
    for (const u of upgrades) {
      if (started >= 2 || this.inflight.size >= this.maxTextureLoads) break;
      this.requestTexture(u.chunk, u.zoom);
      started++;
    }
  }

  private buildNext(): void {
    const next = this.queue.shift();
    if (!next) return;
    const key = chunkKey(next.cx, next.cz);
    if (this.chunks.has(key)) return;
    const chunk = this.buildChunk(next.cx, next.cz, next.d);
    this.chunks.set(key, chunk);
    this.group.add(chunk.mesh);
  }

  private requestTexture(chunk: Chunk, zoom: number): void {
    if (chunk.disposed || chunk.loadingZoom !== undefined || chunk.textureZoom >= zoom) return;
    const key = chunkKey(chunk.cx, chunk.cz);
    if (this.inflight.has(key)) return;
    this.inflight.add(key);
    chunk.loadingZoom = zoom;

    this.imagery
      .loadChunkTexture(chunk.cx, chunk.cz, zoom)
      .then((texture) => {
        chunk.loadingZoom = undefined;
        this.inflight.delete(key);
        if (chunk.disposed || chunk.textureZoom >= zoom) {
          texture.dispose();
          return;
        }
        const previous = chunk.texture;
        chunk.texture = texture;
        chunk.textureZoom = zoom;
        chunk.material.map = texture;
        chunk.material.color.set(0xffffff);
        chunk.material.needsUpdate = true;
        chunk.hasTexture = true;
        previous?.dispose();
      })
      .catch(() => {
        chunk.loadingZoom = undefined;
        this.inflight.delete(key);
      });
  }

  private buildChunk(cx: number, cz: number, distance: number): Chunk {
    const centerX = chunkCenter(cx);
    const centerZ = chunkCenter(cz);

    const geometry = new THREE.PlaneGeometry(CHUNK_SIZE, CHUNK_SIZE, TERRAIN_SEGMENTS, TERRAIN_SEGMENTS);
    geometry.rotateX(-Math.PI / 2);
    const pos = geometry.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const wx = centerX + pos.getX(i);
      const wz = centerZ + pos.getZ(i);
      pos.setY(i, this.heightfield.heightAt(wx, wz));
    }
    pos.needsUpdate = true;
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();

    const normalMap = buildNormalMap(this.heightfield, cx, cz);
    const material = new THREE.MeshStandardMaterial({
      color: 0x6d7a50,
      roughness: 0.94,
      metalness: 0,
      normalMap,
      normalScale: new THREE.Vector2(0.9, 0.9),
    });

    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(centerX, 0, centerZ);
    mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();

    const chunk: Chunk = {
      cx,
      cz,
      mesh,
      material,
      normalMap,
      textureZoom: 0,
      hasTexture: false,
      disposed: false,
    };

    this.requestTexture(chunk, Math.min(this.maxZoom, zoomForDistance(distance)));
    return chunk;
  }

  private disposeChunk(chunk: Chunk, key: string): void {
    chunk.disposed = true;
    this.chunks.delete(key);
    this.inflight.delete(key);
    this.group.remove(chunk.mesh);
    chunk.mesh.geometry.dispose();
    chunk.material.dispose();
    chunk.normalMap.dispose();
    chunk.texture?.dispose();
  }

  dispose(): void {
    for (const [key, chunk] of this.chunks) this.disposeChunk(chunk, key);
    this.queue.length = 0;
  }
}

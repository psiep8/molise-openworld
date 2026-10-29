import * as THREE from 'three';
import { surfaceMaterial, type SurfaceWeather } from '../sim/surfaces';

const CHUNK_SIZE = 912;
const INTERNAL_FIELDS = 9;
const EXTERNAL_FIELDS = 7;

interface StoredChunk {
  data: Float32Array;
  savedAt: number;
}

/**
 * Tracce in coordinate mondo. I chunk fuori dal raggio attivo vengono salvati
 * in forma compatta e ricaricati quando il veicolo torna nella zona.
 */
export class SkidMarks {
  readonly group = new THREE.Group();
  private readonly mesh: THREE.InstancedMesh;
  private readonly max = 25_000;
  private readonly lives = new Float32Array(this.max);
  private readonly initialLives = new Float32Array(this.max);
  private readonly x = new Float32Array(this.max);
  private readonly y = new Float32Array(this.max);
  private readonly z = new Float32Array(this.max);
  private readonly yaw = new Float32Array(this.max);
  private readonly colors = new Uint32Array(this.max);
  private readonly widths = new Float32Array(this.max);
  private readonly depths = new Float32Array(this.max);
  private readonly strengths = new Float32Array(this.max);
  private readonly color = new THREE.Color();
  private readonly dummy = new THREE.Object3D();
  private readonly chunks = new Map<string, StoredChunk>();
  private visibleChunks = new Set<string>();
  private centerChunk = '';
  private cursor = 0;
  private active = 0;
  private budget = 3_000;
  private elapsed = 0;

  constructor() {
    const geometry = new THREE.PlaneGeometry(0.28, 0.9);
    geometry.rotateX(-Math.PI / 2);
    const material = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.62,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
      side: THREE.DoubleSide,
      toneMapped: false,
    });
    this.mesh = new THREE.InstancedMesh(geometry, material, this.max);
    this.mesh.name = 'skid-marks';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.count = 0;
    this.dummy.scale.setScalar(0);
    this.dummy.updateMatrix();
    for (let i = 0; i < this.max; i++) {
      this.mesh.setMatrixAt(i, this.dummy.matrix);
      this.mesh.setColorAt(i, this.color.setHex(0x3d2f20));
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    this.group.name = 'skid-marks-group';
    this.group.add(this.mesh);
  }

  get renderedCount(): number {
    return this.mesh.count;
  }

  /** Budget del preset: la memoria è riservata una volta, il rendering no. */
  setBudget(budget: number): void {
    const previous = this.budget;
    this.budget = Math.max(0, Math.min(this.max, Math.floor(budget)));
    if (previous === 0 && this.budget > 0 && this.active === 0) {
      for (const key of this.visibleChunks) {
        const stored = this.chunks.get(key);
        if (stored) this.restoreInternal(key, stored.data, Math.max(0, this.elapsed - stored.savedAt));
      }
      this.mesh.instanceMatrix.needsUpdate = true;
      if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    }
    this.mesh.count = Math.min(this.active, this.budget);
  }

  /** Mantiene visibili il chunk del veicolo e gli otto adiacenti. */
  streamAround(x: number, z: number): void {
    const chunkX = Math.floor(x / CHUNK_SIZE);
    const chunkZ = Math.floor(z / CHUNK_SIZE);
    const center = `${chunkX}:${chunkZ}`;
    if (center === this.centerChunk) return;

    this.saveVisibleChunks();
    this.clearVisibleInstances();
    this.centerChunk = center;
    this.visibleChunks = new Set<string>();
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const key = `${chunkX + dx}:${chunkZ + dz}`;
        this.visibleChunks.add(key);
        const stored = this.chunks.get(key);
        if (!stored) continue;
        const age = Math.max(0, this.elapsed - stored.savedAt);
        this.restoreInternal(key, stored.data, age);
      }
    }
    this.mesh.count = Math.min(this.active, this.budget);
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  /** Aggiunge un breve segmento in coordinate mondo; `life` è in secondi. */
  add(
    x: number,
    z: number,
    yaw: number,
    y: number,
    color = 0x3d2f20,
    intensity = 1,
    life = surfaceMaterial('dirt').skid.persistence,
    width = 0.28,
    depth = surfaceMaterial('dirt').skid.depth,
  ): void {
    if (this.budget === 0) return;
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.budget;
    this.x[i] = x;
    this.y[i] = y + Math.max(0.01, depth);
    this.z[i] = z;
    this.yaw[i] = yaw;
    this.colors[i] = color;
    this.widths[i] = width;
    this.depths[i] = depth;
    this.strengths[i] = Math.max(0, Math.min(1, intensity));
    this.lives[i] = Math.max(1, life);
    this.initialLives[i] = this.lives[i]!;
    this.write(i);
    this.active = Math.min(this.budget, this.active + 1);
    this.mesh.count = this.active;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  update(dt: number, weather: Partial<SurfaceWeather> = {}): void {
    const elapsed = Math.max(0, dt);
    const wet = Math.max(0, Math.min(1, weather.wetness ?? 0));
    const snow = Math.max(0, Math.min(1, weather.snowPack ?? 0));
    const decay = elapsed * (1 + wet * 1.5 + snow * 0.8);
    this.elapsed += decay;
    let matrixChanged = false;
    for (let i = 0; i < this.active; i++) {
      if (this.lives[i]! <= 0) continue;
      this.lives[i] = Math.max(0, this.lives[i]! - decay);
      this.write(i);
      matrixChanged = true;
    }
    if (matrixChanged) {
      this.mesh.instanceMatrix.needsUpdate = true;
      if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    }
  }

  clear(): void {
    this.chunks.clear();
    this.visibleChunks.clear();
    this.centerChunk = '';
    this.elapsed = 0;
    this.clearVisibleInstances();
  }

  /** Serializza le tracce di una zona per poterle ripristinare al rientro nel chunk. */
  serializeChunk(chunkKey: string): Float32Array {
    const activeData = this.packVisibleChunk(chunkKey);
    // Un chunk visibile senza istanze restituisce un array vuoto, che è
    // "truthy": senza il controllo sulla lunghezza si perderebbe la copia
    // salvata e il ripristino sembrerebbe non funzionare.
    if (activeData && activeData.length > 0) return this.toExternalData(activeData);
    const stored = this.chunks.get(chunkKey);
    if (!stored) return new Float32Array();
    const age = Math.max(0, this.elapsed - stored.savedAt);
    const aged = stored.data.slice();
    for (let i = 0; i + INTERNAL_FIELDS - 1 < aged.length; i += INTERNAL_FIELDS) {
      aged[i + 4] = Math.max(0, aged[i + 4]! - age);
    }
    return this.toExternalData(aged);
  }

  restoreChunk(chunkKey: string, data: Float32Array): void {
    const records: number[] = [];
    for (let i = 0; i + EXTERNAL_FIELDS - 1 < data.length; i += EXTERNAL_FIELDS) {
      const x = data[i]!;
      const y = data[i + 1]!;
      const z = data[i + 2]!;
      if (chunkKeyAt(x, z) !== chunkKey) continue;
      records.push(
        x, y, z, data[i + 3]!, data[i + 4]!, data[i + 5]!, data[i + 6]!,
        0.012, 0.8,
      );
    }
    const packed = Float32Array.from(records);
    this.chunks.set(chunkKey, { data: packed, savedAt: this.elapsed });
    if (this.visibleChunks.has(chunkKey)) this.restoreInternal(chunkKey, packed, 0);
    this.mesh.count = Math.min(this.active, this.budget);
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  private saveVisibleChunks(): void {
    const current = new Map<string, number[]>();
    for (const key of this.visibleChunks) current.set(key, []);
    for (let i = 0; i < this.active; i++) {
      if (this.lives[i]! <= 0) continue;
      const key = chunkKeyAt(this.x[i]!, this.z[i]!);
      if (this.centerChunk && !this.visibleChunks.has(key)) continue;
      if (!current.has(key)) current.set(key, []);
      const records = current.get(key);
      if (!records) continue;
      records.push(...this.packRecord(i));
    }
    for (const [key, records] of current) {
      if (records.length === 0) this.chunks.delete(key);
      else this.chunks.set(key, { data: Float32Array.from(records), savedAt: this.elapsed });
    }
  }

  private packVisibleChunk(chunkKey: string): Float32Array | null {
    if (this.centerChunk && !this.visibleChunks.has(chunkKey)) return null;
    const records: number[] = [];
    for (let i = 0; i < this.active; i++) {
      if (this.lives[i]! > 0 && chunkKeyAt(this.x[i]!, this.z[i]!) === chunkKey) {
        records.push(...this.packRecord(i));
      }
    }
    return Float32Array.from(records);
  }

  private packRecord(i: number): number[] {
    return [
      this.x[i]!, this.y[i]!, this.z[i]!, this.yaw[i]!, this.lives[i]!,
      this.colors[i]!, this.widths[i]!, this.depths[i]!, this.strengths[i]!,
    ];
  }

  private toExternalData(data: Float32Array): Float32Array {
    const records: number[] = [];
    for (let i = 0; i + INTERNAL_FIELDS - 1 < data.length; i += INTERNAL_FIELDS) {
      records.push(data[i]!, data[i + 1]!, data[i + 2]!, data[i + 3]!,
        data[i + 4]!, data[i + 5]!, data[i + 6]!);
    }
    return Float32Array.from(records);
  }

  private restoreInternal(chunkKey: string, data: Float32Array, age: number): void {
    for (let i = 0; i + INTERNAL_FIELDS - 1 < data.length; i += INTERNAL_FIELDS) {
      const x = data[i]!;
      const y = data[i + 1]!;
      const z = data[i + 2]!;
      const life = data[i + 4]! - age;
      if (life <= 0 || chunkKeyAt(x, z) !== chunkKey || this.budget === 0) continue;
      const id = this.cursor;
      this.cursor = (this.cursor + 1) % this.budget;
      this.x[id] = x;
      this.y[id] = y;
      this.z[id] = z;
      this.yaw[id] = data[i + 3]!;
      this.lives[id] = life;
      this.initialLives[id] = Math.max(life, data[i + 4]!);
      this.colors[id] = data[i + 5]!;
      this.widths[id] = data[i + 6]!;
      this.depths[id] = data[i + 7]!;
      this.strengths[id] = data[i + 8]!;
      this.write(id);
      this.active = Math.min(this.budget, this.active + 1);
    }
  }

  private clearVisibleInstances(): void {
    this.lives.fill(0);
    this.dummy.scale.setScalar(0);
    this.dummy.updateMatrix();
    for (let i = 0; i < this.active; i++) this.mesh.setMatrixAt(i, this.dummy.matrix);
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.count = 0;
    this.active = 0;
    this.cursor = 0;
  }

  private write(i: number): void {
    const life = Math.max(0, this.lives[i]! / Math.max(1, this.initialLives[i]!));
    this.dummy.position.set(this.x[i]!, this.y[i]!, this.z[i]!);
    this.dummy.rotation.set(0, this.yaw[i]!, 0);
    this.dummy.scale.set(this.widths[i]! / 0.28, 1, life);
    this.dummy.updateMatrix();
    this.mesh.setMatrixAt(i, this.dummy.matrix);
    this.mesh.setColorAt(i, this.color.setHex(this.colors[i]!)
      .multiplyScalar(this.strengths[i]! * (0.25 + life * 0.75)));
  }
}

function chunkKeyAt(x: number, z: number): string {
  return `${Math.floor(x / CHUNK_SIZE)}:${Math.floor(z / CHUNK_SIZE)}`;
}

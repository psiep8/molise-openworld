import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Heightfield } from '../geo/elevation';
import { mulberry32 } from '../geo/geo';
import type { BuildingIndex, RoadIndex } from '../geo/osm';
import { windTimeUniform } from '../gfx/wind';
import { GroundMask } from './ground-mask';

/** Raggio del tappeto d'erba intorno al giocatore (m). */
const RADIUS = 40;
const MAX_TUFTS = 82000;
/** Oltre questa distanza il campo viene ricostruito. */
const REBUILD_DISTANCE = 18;
/** Altezza del ciuffo in metri: la geometria base è alta 0,6. */
const TUFT_HEIGHT = 0.17;

/**
 * Lavoro di ricostruzione spezzato sui frame.
 *
 * La maschera e le due `InstancedMesh` si preparano subito; matrici e colori
 * vengono riempiti a piccoli blocchi, così il picco non arriva mai al loop di
 * rendering. `phase` separa i ciuffi principali dal ciglio stradale.
 */
interface GrassJob {
  x: number;
  z: number;
  density: number;
  target: number;
  edgeTarget: number;
  rng: () => number;
  mesh: THREE.InstancedMesh;
  edgeMesh: THREE.InstancedMesh;
  dummy: THREE.Object3D;
  color: THREE.Color;
  palette: number[];
  valid: number;
  perCell: number;
  acc: number;
  cursor: number;
  placed: number;
  edges: number;
  phase: 'tufts' | 'edges';
  heights: Heightfield;
  roads: RoadIndex;
  buildings: BuildingIndex;
}

/**
 * Erba a ciuffi.
 *
 * Ogni ciuffo è un quad incrociato con una texture di lame disegnata su canvas
 * e ritagliata con `alphaTest`: niente rettangoli verdi, ma fili d'erba veri
 * anche a pochi metri. Tutto sta in un `InstancedMesh` (una draw call) e
 * ondeggia nel vertex shader con il vento condiviso di `gfx/wind`.
 *
 * Il campo insegue il giocatore e si ricostruisce solo quando ci si allontana.
 */
export class GrassField {
  readonly group = new THREE.Group();
  private readonly geometry: THREE.BufferGeometry;
  private readonly material: THREE.MeshStandardMaterial;
  private readonly bladeTexture: THREE.CanvasTexture;
  private mesh: THREE.InstancedMesh | null = null;
  private edge: THREE.InstancedMesh | null = null;
  private originX = Number.NaN;
  private originZ = Number.NaN;
  private density = -1;
  /** Maschera strada/edificio/pendio riusata a ogni ricostruzione. */
  private readonly mask = new GroundMask(RADIUS);
  /** Celle della maschera libere: riempite a ogni rebuild senza allocare. */
  private readonly validCells = new Uint32Array(this.mask.n * this.mask.n);
  /** Ricostruzione in corso, spezzata sui frame. */
  private job: GrassJob | null = null;

  constructor() {
    this.geometry = GrassField.buildGeometry();
    this.bladeTexture = GrassField.buildBladeTexture();

    const uTime = windTimeUniform();
    this.material = new THREE.MeshStandardMaterial({
      map: this.bladeTexture,
      alphaTest: 0.45,
      side: THREE.DoubleSide,
      roughness: 0.95,
      metalness: 0,
      envMapIntensity: 0.45,
    });
    this.material.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = uTime;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uTime;')
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
          #ifdef USE_INSTANCING
            vec3 tuftPos = vec3( instanceMatrix[ 3 ][ 0 ], instanceMatrix[ 3 ][ 1 ], instanceMatrix[ 3 ][ 2 ] );
          #else
            vec3 tuftPos = vec3( 0.0 );
          #endif
          float tuftBend = clamp( position.y / ${TUFT_HEIGHT.toFixed(2)}, 0.0, 1.0 );
          float tuftPhase = tuftPos.x * 0.42 + tuftPos.z * 0.31;
          float tuftSway = sin( uTime * 1.9 + tuftPhase ) * 0.085 + sin( uTime * 3.4 + tuftPhase * 1.7 ) * 0.03;
          transformed.x += tuftSway * tuftBend * tuftBend;
          transformed.z += tuftSway * 0.6 * tuftBend * tuftBend;`,
        );
    };
    this.material.customProgramCacheKey = () => 'grass-wind-v1';

    this.group.name = 'grass';
    this.group.matrixAutoUpdate = false;
  }

  /** Due quad incrociati, con la base a y = 0. */
  private static buildGeometry(): THREE.BufferGeometry {
    // ciuffi più larghi: a parità di istanze coprono più suolo e il prato
    // smette di sembrare una griglia di puntini verdi
    const blade = new THREE.PlaneGeometry(0.27, TUFT_HEIGHT, 1, 1);
    blade.translate(0, TUFT_HEIGHT / 2, 0);
    const crossed = blade.clone();
    crossed.rotateY(Math.PI / 2);
    const merged = mergeGeometries([blade, crossed], false);
    crossed.dispose();
    if (!merged) return blade;
    blade.dispose();
    return merged;
  }

  /**
   * Texture dei fili d'erba: sfondo trasparente, lame affusolate di verdi
   * diversi, qualche punta secca. Serve `alphaTest`, non la trasparenza, per
   * non pagare l'ordinamento dei 5000 ciuffi.
   */
  private static buildBladeTexture(): THREE.CanvasTexture {
    const size = 256;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('canvas 2d non disponibile');
    ctx.clearRect(0, 0, size, size);
    const rng = mulberry32(0x9a55);

    const blades = 150;
    for (let i = 0; i < blades; i++) {
      const baseX = 8 + rng() * (size - 16);
      const baseY = size - 2;
      const height = size * (0.45 + rng() * 0.5);
      const lean = (rng() - 0.5) * size * 0.5;
      const tipX = baseX + lean;
      const tipY = baseY - height;
      const ctrlX = baseX + lean * 0.35;
      const ctrlY = baseY - height * 0.55;

      // verde con variazione di luminosità e punta più chiara
      const hue = 78 + rng() * 26;
      const light = 32 + rng() * 22;
      ctx.strokeStyle = `hsl(${hue.toFixed(0)} 34% ${light.toFixed(0)}%)`;
      ctx.lineCap = 'round';
      // lame sottili: con tratti spessi il ciuffo legge come una foglia, non erba
      ctx.lineWidth = 0.65 + rng() * 0.85;
      ctx.beginPath();
      ctx.moveTo(baseX, baseY);
      ctx.quadraticCurveTo(ctrlX, ctrlY, tipX, tipY);
      ctx.stroke();
    }
    // punte secche
    for (let i = 0; i < 5; i++) {
      const baseX = 10 + rng() * (size - 20);
      const baseY = size - 2;
      const tipX = baseX + (rng() - 0.5) * 30;
      const tipY = baseY - size * (0.5 + rng() * 0.35);
      ctx.strokeStyle = 'rgba(150, 132, 74, 0.85)';
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.moveTo(baseX, baseY);
      ctx.quadraticCurveTo(baseX + 6, baseY - 40, tipX, tipY);
      ctx.stroke();
    }

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
    texture.needsUpdate = true;
    return texture;
  }

  /** `density` 0…1 (dal preset grafico). Ricostruisce solo se serve. */
  update(
    x: number,
    z: number,
    heights: Heightfield,
    roads: RoadIndex,
    buildings: BuildingIndex,
    density: number,
  ): void {
    const d = Math.max(0, Math.min(1, density));
    if (d <= 0.01) {
      if (this.job) this.cancelJob();
      if (this.mesh) this.mesh.visible = false;
      if (this.edge) this.edge.visible = false;
      return;
    }
    if (this.mesh) this.mesh.visible = true;
    if (this.edge) this.edge.visible = true;

    const moved = Math.hypot(x - this.originX, z - this.originZ);
    if (this.job) {
      const stale =
        Math.abs(d - this.job.density) > 0.1 ||
        Math.hypot(x - this.job.x, z - this.job.z) > REBUILD_DISTANCE * 1.5;
      if (stale) this.cancelJob();
    }
    if (!this.job && (!this.mesh || moved > REBUILD_DISTANCE || Math.abs(d - this.density) > 0.1)) {
      this.startJob(x, z, heights, roads, buildings, d);
    }
    // La costruzione è spezzata su più frame: il picco da ~40 ms (matrici e
    // colori di 82.000 istanze) diventa un budget di 4 ms per frame. Il campo
    // vecchio resta visibile finché il nuovo non è pronto.
    if (this.job) this.stepJob(4);
    this.group.position.set(0, 0, 0);
  }

  private startJob(
    x: number,
    z: number,
    heights: Heightfield,
    roads: RoadIndex,
    buildings: BuildingIndex,
    density: number,
  ): void {
    this.originX = x;
    this.originZ = z;
    this.density = density;

    // una sola rasterizzazione di strade/edifici/pendio: le 480.000 query
    // per rifiuto casuale diventano una lookup su array
    this.mask.build(x, z, heights, roads, buildings, 2.7, 0.5);
    const n = this.mask.n;
    let valid = 0;
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        if (!this.mask.isBlocked(i, j)) this.validCells[valid++] = j * n + i;
      }
    }

    const target = Math.round(MAX_TUFTS * density);
    const mesh = new THREE.InstancedMesh(this.geometry, this.material, target);
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.frustumCulled = false;

    const edgeTarget = Math.round(4200 * density);
    const edgeMesh = new THREE.InstancedMesh(this.geometry, this.material, edgeTarget);
    edgeMesh.castShadow = false;
    edgeMesh.receiveShadow = false;
    edgeMesh.frustumCulled = false;

    this.job = {
      x,
      z,
      density,
      target,
      edgeTarget,
      rng: mulberry32(Math.round(x * 31 + z * 17) | 1),
      mesh,
      edgeMesh,
      dummy: new THREE.Object3D(),
      color: new THREE.Color(),
      palette: [0x8a9a68, 0x93a372, 0x7f9060, 0x9dab7c, 0x879669],
      valid,
      perCell: valid > 0 ? target / valid : 0,
      acc: 0,
      cursor: 0,
      placed: 0,
      edges: 0,
      phase: 'tufts',
      heights,
      roads,
      buildings,
    };
  }

  private stepJob(budgetMs: number): void {
    const job = this.job;
    if (!job) return;
    const t0 = performance.now();
    const n = this.mask.n;
    const cell = this.mask.cellSize;

    if (job.phase === 'tufts') {
      while (job.cursor < job.valid && job.placed < job.target) {
        const idx = this.validCells[job.cursor++]!;
        job.acc += job.perCell;
        let count = Math.floor(job.acc);
        job.acc -= count;
        if (count <= 0) continue;
        if (count > job.target - job.placed) count = job.target - job.placed;
        const i = idx % n;
        const j = (idx - i) / n;
        const baseX = this.mask.originX + i * cell;
        const baseZ = this.mask.originZ + j * cell;
        // lungo le strade l'erba resta corta e si allunga verso i campi: sul
        // ciglio (2,7 m) è al 55%, da 6 m in poi è piena
        const roadDist = this.mask.roadDistance(i, j);
        const verge = 0.55 + 0.45 * Math.min(1, Math.max(0, (roadDist - 2.7) / 3.3));
        for (let k = 0; k < count; k++) {
          const px = baseX + job.rng() * cell;
          const pz = baseZ + job.rng() * cell;
          const py = this.mask.heightAt(px, pz);
          job.dummy.position.set(px, py - 0.02, pz);
          job.dummy.rotation.set(0, job.rng() * Math.PI, 0);
          const scale = (0.6 + job.rng() * 0.45) * verge;
          job.dummy.scale.set(scale, scale * (0.8 + job.rng() * 0.6), scale);
          job.dummy.updateMatrix();
          job.mesh.setMatrixAt(job.placed, job.dummy.matrix);
          job.color
            .setHex(job.palette[Math.floor(job.rng() * job.palette.length)]!)
            .multiplyScalar(0.92 + job.rng() * 0.16);
          job.mesh.setColorAt(job.placed, job.color);
          job.placed++;
        }
        if ((job.cursor & 63) === 0 && performance.now() - t0 > budgetMs) return;
      }
      job.phase = 'edges';
      this.buildEdges(job);
    }

    this.commitJob(job);
  }

  /** Erba che sconfina sull'asfalto: una fascia di ~30 cm sul ciglio. */
  private buildEdges(job: GrassJob): void {
    if (job.edgeTarget <= 0) return;
    // campionamento diretto dei cigli: costo proporzionale ai metri di
    // strada, non a 190.000 tentativi casuali nel disco
    job.roads.forEachRoadEdge(job.x, job.z, RADIUS, 0.28, (ex, ez) => {
      if (job.edges >= job.edgeTarget) return;
      const px = ex + (job.rng() - 0.5) * 0.22;
      const pz = ez + (job.rng() - 0.5) * 0.22;
      // dentro un'altra carreggiata (incrocio) l'erba non cresce
      if (job.roads.isOnRoad(px, pz, -0.06)) return;
      if (job.buildings.hitsCircle(px, pz, 0.3)) return;
      if (job.heights.slopeAt(px, pz) > 30) return;
      const py = job.heights.heightAt(px, pz);
      job.dummy.position.set(px, py - 0.02, pz);
      job.dummy.rotation.set(0, job.rng() * Math.PI, 0);
      const scale = 0.55 + job.rng() * 0.4;
      job.dummy.scale.set(scale, scale * (0.9 + job.rng() * 0.5), scale);
      job.dummy.updateMatrix();
      job.edgeMesh.setMatrixAt(job.edges, job.dummy.matrix);
      // erba di bordo più secca e polverosa: è quella che prende lo sporco
      job.color.setHex(
        job.edges % 3 === 0 ? 0x9b9a6b : job.palette[Math.floor(job.rng() * job.palette.length)]!,
      );
      job.color.multiplyScalar(0.9 + job.rng() * 0.18);
      job.edgeMesh.setColorAt(job.edges, job.color);
      job.edges++;
    });
  }

  private commitJob(job: GrassJob): void {
    job.mesh.count = job.placed;
    job.mesh.instanceMatrix.needsUpdate = true;
    if (job.mesh.instanceColor) job.mesh.instanceColor.needsUpdate = true;
    job.edgeMesh.count = job.edges;
    job.edgeMesh.instanceMatrix.needsUpdate = true;
    if (job.edgeMesh.instanceColor) job.edgeMesh.instanceColor.needsUpdate = true;

    if (this.mesh) {
      this.group.remove(this.mesh);
      this.mesh.dispose();
    }
    if (this.edge) {
      this.group.remove(this.edge);
      this.edge.dispose();
    }
    this.mesh = job.mesh;
    this.edge = job.edgeMesh;
    this.group.add(job.mesh);
    this.group.add(job.edgeMesh);
    this.job = null;
  }

  private cancelJob(): void {
    const job = this.job;
    if (!job) return;
    job.mesh.dispose();
    job.edgeMesh.dispose();
    this.job = null;
  }

  dispose(): void {
    if (this.job) this.cancelJob();
    if (this.mesh) {
      this.group.remove(this.mesh);
      this.mesh.dispose();
      this.mesh = null;
    }
    if (this.edge) {
      this.group.remove(this.edge);
      this.edge.dispose();
      this.edge = null;
    }
    this.geometry.dispose();
    this.material.dispose();
    this.bladeTexture.dispose();
  }
}

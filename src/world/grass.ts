import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Heightfield } from '../geo/elevation';
import { mulberry32 } from '../geo/geo';
import type { BuildingIndex, RoadIndex } from '../geo/osm';
import { windTimeUniform } from '../gfx/wind';

/** Raggio del tappeto d'erba intorno al giocatore (m). */
const RADIUS = 40;
const MAX_TUFTS = 82000;
/** Ciuffi bassi che chiudono i buchi tra le lame alte (tappeto di base). */
const CARPET = 12000;
/** Oltre questa distanza il campo viene ricostruito. */
const REBUILD_DISTANCE = 18;
/** Altezza del ciuffo in metri: la geometria base è alta 0,6. */
const TUFT_HEIGHT = 0.17;

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
  private carpet: THREE.InstancedMesh | null = null;
  private readonly carpetGeometry: THREE.BufferGeometry;
  private readonly carpetMaterial: THREE.MeshStandardMaterial;
  private readonly carpetTexture: THREE.CanvasTexture;
  private originX = Number.NaN;
  private originZ = Number.NaN;
  private density = -1;

  constructor() {
    this.geometry = GrassField.buildGeometry();
    this.bladeTexture = GrassField.buildBladeTexture();

    // tappeto: quad orizzontali con macchie d'erba e bordo trasparente. Senza,
    // tra un ciuffo e l'altro si vede il terreno (o la foto satellite) e il
    // prato sembra un campo rasato a chiazze.
    this.carpetGeometry = new THREE.PlaneGeometry(1.45, 1.45, 1, 1).rotateX(-Math.PI / 2);
    this.carpetTexture = GrassField.buildCarpetTexture();
    this.carpetMaterial = new THREE.MeshStandardMaterial({
      map: this.carpetTexture,
      alphaTest: 0.28,
      side: THREE.DoubleSide,
      roughness: 0.98,
      metalness: 0,
      envMapIntensity: 0.4,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });

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

  /**
   * Tappeto di base: macchie di erba fitta con bordo che sfuma nel trasparente.
   * Il bordo morbido evita che i quad si leggano come piastrelle.
   */
  private static buildCarpetTexture(): THREE.CanvasTexture {
    const size = 256;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('canvas 2d non disponibile');
    ctx.clearRect(0, 0, size, size);
    const rng = mulberry32(0x77c1);
    for (let i = 0; i < 220; i++) {
      const x = rng() * size;
      const y = rng() * size;
      const r = 10 + rng() * 26;
      const g = 74 + rng() * 44;
      const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
      grad.addColorStop(0, `rgba(${(g * 0.62).toFixed(0)}, ${g.toFixed(0)}, ${(g * 0.45).toFixed(0)}, 0.95)`);
      grad.addColorStop(0.65, `rgba(${(g * 0.58).toFixed(0)}, ${(g * 0.94).toFixed(0)}, ${(g * 0.42).toFixed(0)}, 0.8)`);
      grad.addColorStop(1, 'rgba(60, 84, 40, 0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    // svuota i bordi: il quad deve fondersi col vicino, non avere un contorno
    const edge = ctx.createRadialGradient(size / 2, size / 2, size * 0.3, size / 2, size / 2, size * 0.52);
    edge.addColorStop(0, 'rgba(0,0,0,0)');
    edge.addColorStop(1, 'rgba(0,0,0,1)');
    ctx.globalCompositeOperation = 'destination-out';
    ctx.fillStyle = edge;
    ctx.fillRect(0, 0, size, size);
    ctx.globalCompositeOperation = 'source-over';

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
      if (this.mesh) this.mesh.visible = false;
      if (this.carpet) this.carpet.visible = false;
      return;
    }
    const moved = Math.hypot(x - this.originX, z - this.originZ);
    if (!this.mesh || moved > REBUILD_DISTANCE || Math.abs(d - this.density) > 0.1) {
      this.rebuild(x, z, heights, roads, buildings, d);
    }
    this.group.position.set(0, 0, 0);
  }

  private rebuild(
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

    if (this.mesh) {
      this.group.remove(this.mesh);
      this.mesh.dispose();
      this.mesh = null;
    }
    if (this.carpet) {
      this.group.remove(this.carpet);
      this.carpet.dispose();
      this.carpet = null;
    }

    const target = Math.round(MAX_TUFTS * density);
    const rng = mulberry32(Math.round(x * 31 + z * 17) | 1);
    const dummy = new THREE.Object3D();
    const color = new THREE.Color();
    const palette = [0x8a9a68, 0x93a372, 0x7f9060, 0x9dab7c, 0x879669];

    const mesh = new THREE.InstancedMesh(this.geometry, this.material, target);
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.frustumCulled = false;

    let placed = 0;
    let guard = 0;
    while (placed < target && guard < target * 6) {
      guard++;
      const angle = rng() * Math.PI * 2;
      const radius = Math.sqrt(rng()) * RADIUS;
      const px = x + Math.cos(angle) * radius;
      const pz = z + Math.sin(angle) * radius;
      if (heights.slopeAt(px, pz) > 30) continue;
      // lascia libero anche il marciapiede (1,5 m) e il cordolo: con 1,1 l'erba
      // cresceva sopra la pavimentazione e la nascondeva
      if (roads.isOnRoad(px, pz, 2.7)) continue;
      // `near()` restituisce tutto ciò che sta nella cella: in paese bocciava
      // ogni ciuffo e il prato restava a zero istanze. Qui serve il test vero.
      if (buildings.resolveCircle(px, pz, 0.35).hit) continue;

      const py = heights.heightAt(px, pz);
      dummy.position.set(px, py - 0.02, pz);
      dummy.rotation.set(0, rng() * Math.PI, 0);
      const scale = 0.6 + rng() * 0.45;
      dummy.scale.set(scale, scale * (0.8 + rng() * 0.6), scale);
      dummy.updateMatrix();
      mesh.setMatrixAt(placed, dummy.matrix);
      color.setHex(palette[Math.floor(rng() * palette.length)]).multiplyScalar(0.92 + rng() * 0.16);
      mesh.setColorAt(placed, color);
      placed++;
    }

    mesh.count = placed;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    this.mesh = mesh;
    this.group.add(mesh);

    // tappeto: stessa distribuzione, stessi scarti, ma appoggiato al pendio
    const carpetTarget = Math.round(CARPET * density);
    const carpet = new THREE.InstancedMesh(this.carpetGeometry, this.carpetMaterial, carpetTarget);
    carpet.castShadow = false;
    carpet.receiveShadow = true;
    carpet.frustumCulled = false;
    const up = new THREE.Vector3(0, 1, 0);
    const normal = new THREE.Vector3();
    const tint = [0x77894f, 0x6f814a, 0x7d8f57, 0x697c46, 0x839457];
    let carpets = 0;
    let guardCarpet = 0;
    while (carpets < carpetTarget && guardCarpet < carpetTarget * 6) {
      guardCarpet++;
      const angle = rng() * Math.PI * 2;
      const radius = Math.sqrt(rng()) * RADIUS;
      const px = x + Math.cos(angle) * radius;
      const pz = z + Math.sin(angle) * radius;
      if (heights.slopeAt(px, pz) > 30) continue;
      if (roads.isOnRoad(px, pz, 2.7)) continue;
      if (buildings.resolveCircle(px, pz, 0.35).hit) continue;
      const py = heights.heightAt(px, pz);
      const n = heights.normalAt(px, pz, 2.5);
      normal.set(n.x, n.y, n.z);
      if (normal.lengthSq() < 1e-6) normal.copy(up);
      dummy.position.set(px, py + 0.012, pz);
      dummy.quaternion.setFromUnitVectors(up, normal.normalize());
      dummy.rotateY(rng() * Math.PI * 2);
      const scale = 0.75 + rng() * 0.6;
      dummy.scale.set(scale, 1, scale);
      dummy.updateMatrix();
      carpet.setMatrixAt(carpets, dummy.matrix);
      color.setHex(tint[Math.floor(rng() * tint.length)]).multiplyScalar(0.9 + rng() * 0.2);
      carpet.setColorAt(carpets, color);
      carpets++;
    }
    carpet.count = carpets;
    carpet.instanceMatrix.needsUpdate = true;
    if (carpet.instanceColor) carpet.instanceColor.needsUpdate = true;
    this.carpet = carpet;
    this.group.add(carpet);
  }

  dispose(): void {
    if (this.mesh) {
      this.group.remove(this.mesh);
      this.mesh.dispose();
      this.mesh = null;
    }
    if (this.carpet) {
      this.group.remove(this.carpet);
      this.carpet.dispose();
      this.carpet = null;
    }
    this.geometry.dispose();
    this.material.dispose();
    this.bladeTexture.dispose();
    this.carpetGeometry.dispose();
    this.carpetMaterial.dispose();
    this.carpetTexture.dispose();
  }
}

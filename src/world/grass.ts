import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Heightfield } from '../geo/elevation';
import { mulberry32 } from '../geo/geo';
import type { BuildingIndex, RoadIndex } from '../geo/osm';
import { windTimeUniform } from '../gfx/wind';

/** Raggio del tappeto d'erba intorno al giocatore (m). */
const RADIUS = 42;
const MAX_TUFTS = 60000;
/** Oltre questa distanza il campo viene ricostruito. */
const REBUILD_DISTANCE = 16;
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
  private originX = Number.NaN;
  private originZ = Number.NaN;
  private density = -1;

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
    const blade = new THREE.PlaneGeometry(0.19, TUFT_HEIGHT, 1, 1);
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

    const blades = 96;
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
      ctx.lineWidth = 0.9 + rng() * 1.1;
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
      if (this.mesh) this.mesh.visible = false;
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
  }

  dispose(): void {
    if (this.mesh) {
      this.group.remove(this.mesh);
      this.mesh.dispose();
      this.mesh = null;
    }
    this.geometry.dispose();
    this.material.dispose();
    this.bladeTexture.dispose();
  }
}

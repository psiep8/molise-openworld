import * as THREE from 'three';
import { CSM } from 'three/addons/csm/CSM.js';

export interface CascadeOptions {
  cascades: number;
  shadowMapSize: number;
  maxFar: number;
  lightFar: number;
  lightMargin: number;
}

type LitMaterial =
  | THREE.MeshStandardMaterial
  | THREE.MeshPhysicalMaterial
  | THREE.MeshLambertMaterial
  | THREE.MeshPhongMaterial;

function isLitMaterial(material: THREE.Material): material is LitMaterial {
  return (
    (material as THREE.MeshStandardMaterial).isMeshStandardMaterial === true ||
    (material as THREE.MeshPhysicalMaterial).isMeshPhysicalMaterial === true ||
    (material as THREE.MeshLambertMaterial).isMeshLambertMaterial === true ||
    (material as THREE.MeshPhongMaterial).isMeshPhongMaterial === true
  );
}

/**
 * Ombre a cascata (CSM) con integrazione sicura nei materiali del gioco.
 *
 * L'addon di three.js sostituisce `onBeforeCompile` e le define del materiale:
 * qui la callback originale viene conservata e richiamata, altrimenti strade,
 * erba e terreno perderebbero i loro shader custom (usura, vento, dettaglio).
 * I materiali nuovi dello streaming vengono agganciati con `refresh()`.
 */
export class CascadeShadows {
  private readonly csm: CSM;
  private readonly originals = new Map<THREE.Material, THREE.Material['onBeforeCompile']>();
  private active = false;

  constructor(
    private readonly scene: THREE.Scene,
    camera: THREE.PerspectiveCamera,
    private readonly sunLight: THREE.DirectionalLight,
    options: CascadeOptions,
  ) {
    this.csm = new CSM({
      camera,
      parent: scene,
      cascades: options.cascades,
      maxFar: options.maxFar,
      mode: 'practical',
      shadowMapSize: options.shadowMapSize,
      lightDirection: new THREE.Vector3(0, -1, 0),
      lightIntensity: sunLight.intensity,
      lightNear: 1,
      lightFar: options.lightFar,
      lightMargin: options.lightMargin,
      shadowBias: -0.0002,
    });
    this.csm.fade = true;
    for (const light of this.csm.lights) {
      light.shadow.normalBias = 0.05;
      light.visible = false;
    }
    this.setEnabled(true);
  }

  get isActive(): boolean {
    return this.active;
  }

  setEnabled(enabled: boolean): void {
    if (enabled === this.active) {
      this.syncSun();
      return;
    }
    this.active = enabled;
    for (const light of this.csm.lights) light.visible = enabled;
    if (enabled) {
      this.refresh();
    } else {
      this.restoreMaterials();
    }
    this.syncSun();
  }

  /** Aggancia i materiali lit creati dopo l'attivazione (chunk in streaming). */
  refresh(): void {
    if (!this.active) return;
    this.scene.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh) return;
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const material of materials) this.setupMaterial(material);
    });
  }

  /** Da chiamare ogni frame, prima del render. */
  update(sunDirection: THREE.Vector3, color: THREE.Color, intensity: number): void {
    if (!this.active) return;
    // La direzione del sole punta verso il sole; le shadow camera guardano
    // dalla luce verso la scena, quindi il vettore va invertito.
    this.csm.lightDirection.copy(sunDirection).negate().normalize();
    for (const light of this.csm.lights) {
      light.color.copy(color);
      light.intensity = intensity;
    }
    this.csm.update();
  }

  updateFrustums(): void {
    this.csm.updateFrustums();
  }

  private syncSun(): void {
    if (this.active) {
      this.sunLight.visible = false;
      this.sunLight.castShadow = false;
    } else {
      this.sunLight.visible = true;
    }
  }

  private setupMaterial(material: THREE.Material): void {
    if (!isLitMaterial(material) || this.csm.shaders.has(material)) return;
    const original = material.onBeforeCompile;
    this.originals.set(material, original);
    this.csm.setupMaterial(material);
    const csmCompile = material.onBeforeCompile;
    material.onBeforeCompile = (shader, renderer) => {
      csmCompile.call(material, shader, renderer);
      original?.call(material, shader, renderer);
    };
    material.needsUpdate = true;
  }

  private restoreMaterials(): void {
    for (const [material, original] of this.originals) {
      if (material.defines) {
        delete material.defines.USE_CSM;
        delete material.defines.CSM_CASCADES;
        delete material.defines.CSM_FADE;
      }
      if (original) material.onBeforeCompile = original;
      else delete (material as { onBeforeCompile?: unknown }).onBeforeCompile;
      material.needsUpdate = true;
      this.csm.shaders.delete(material);
    }
    this.originals.clear();
  }

  dispose(): void {
    this.restoreMaterials();
    this.csm.remove();
    this.csm.dispose();
    this.sunLight.visible = true;
  }
}

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Heightfield } from '../geo/elevation';
import { mulberry32 } from '../geo/geo';
import type { BuildingIndex, RoadIndex } from '../geo/osm';

/** Raggio del tappeto d'erba intorno al giocatore (m). */
const RADIUS = 46;
const MAX_TUFTS = 4200;
/** Oltre questa distanza il campo viene ricostruito. */
const REBUILD_DISTANCE = 16;

/**
 * Erba procedurale a ciuffi.
 *
 * Ogni ciuffo è un quad incrociato, quindi due triangoli per lato: un solo
 * `InstancedMesh` copre migliaia di ciuffi con una draw call. Il campo insegue
 * il giocatore e si ricostruisce solo quando ci si allontana, mai ogni frame.
 */
export class GrassField {
  readonly group = new THREE.Group();
  private readonly geometry: THREE.BufferGeometry;
  private readonly material: THREE.MeshStandardMaterial;
  private mesh: THREE.InstancedMesh | null = null;
  private originX = Number.NaN;
  private originZ = Number.NaN;
  private density = -1;

  constructor() {
    this.geometry = GrassField.buildGeometry();
    this.material = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 1,
      metalness: 0,
      side: THREE.DoubleSide,
    });
    this.group.name = 'grass';
    this.group.matrixAutoUpdate = false;
  }

  private static buildGeometry(): THREE.BufferGeometry {
    const blade = new THREE.PlaneGeometry(0.42, 0.52, 1, 1);
    blade.translate(0, 0.26, 0);
    const crossed = blade.clone();
    crossed.rotateY(Math.PI / 2);
    const merged = mergeGeometries([blade, crossed], false);
    crossed.dispose();
    if (!merged) return blade;
    blade.dispose();
    return merged;
  }

  /**
   * `density` 0…1 (dal preset grafico). Ricostruisce solo se serve.
   */
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
    const palette = [0x5d7642, 0x66804a, 0x546c3c, 0x6f8a52];

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
      if (heights.slopeAt(px, pz) > 28) continue;
      if (roads.isOnRoad(px, pz, 1.1)) continue;
      if (buildings.near(px, pz).length > 0) continue;

      const py = heights.heightAt(px, pz);
      dummy.position.set(px, py - 0.02, pz);
      dummy.rotation.set(0, rng() * Math.PI, 0);
      const scale = 0.7 + rng() * 0.85;
      dummy.scale.set(scale, scale * (0.8 + rng() * 0.6), scale);
      dummy.updateMatrix();
      mesh.setMatrixAt(placed, dummy.matrix);
      color.setHex(palette[Math.floor(rng() * palette.length)]).multiplyScalar(0.85 + rng() * 0.3);
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
  }
}

import * as THREE from 'three';

/**
 * Traccia di gomma sul terreno smosso.
 *
 * L'auto che accelera o tira il freno a mano su terra/erba deve lasciare due
 * strisce scure: sono pochi quad instanziati, non decalcomanie con texture, e
 * vivono in un gruppo separato dal veicolo. Se fossero figli dell'auto si
 * sposterebbero con lei; qui restano nel mondo e si accorciano dopo qualche
 * secondo. Il costo è una draw call e 180 matrici, trascurabile.
 */
export class SkidMarks {
  readonly group = new THREE.Group();
  private readonly mesh: THREE.InstancedMesh;
  private readonly max = 180;
  private readonly lives = new Float32Array(this.max);
  private readonly x = new Float32Array(this.max);
  private readonly y = new Float32Array(this.max);
  private readonly z = new Float32Array(this.max);
  private readonly yaw = new Float32Array(this.max);
  private readonly color = new THREE.Color();
  private readonly dummy = new THREE.Object3D();
  private cursor = 0;

  constructor() {
    const geometry = new THREE.PlaneGeometry(0.28, 0.9);
    geometry.rotateX(-Math.PI / 2);
    const material = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.58,
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
    this.mesh.count = this.max;
    // tutte le istanze esistono ma sono schiacciate a zero finché non servono
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

  /** Aggiunge una striscia di 0,9 m nella posizione di mondo indicata. */
  add(x: number, z: number, yaw: number, y: number, color = 0x3d2f20): void {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.max;
    this.lives[i] = 1;
    this.x[i] = x;
    this.y[i] = y + 0.025;
    this.z[i] = z;
    this.yaw[i] = yaw;
    this.mesh.setColorAt(i, this.color.setHex(color));
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    this.write(i, 1);
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  update(dt: number): void {
    let changed = false;
    for (let i = 0; i < this.max; i++) {
      if (this.lives[i]! <= 0) continue;
      this.lives[i] = Math.max(0, this.lives[i]! - dt / 14);
      this.write(i, this.lives[i]!);
      changed = true;
    }
    if (changed) this.mesh.instanceMatrix.needsUpdate = true;
  }

  clear(): void {
    this.lives.fill(0);
    this.dummy.scale.setScalar(0);
    this.dummy.updateMatrix();
    for (let i = 0; i < this.max; i++) this.mesh.setMatrixAt(i, this.dummy.matrix);
    this.mesh.instanceMatrix.needsUpdate = true;
    this.cursor = 0;
  }

  private write(i: number, life: number): void {
    // le tracce si accorciano e sbiadiscono: la matrice scala la lunghezza
    // (l'opacità per-istanza non è supportata da MeshBasicMaterial)
    const scale = life <= 0 ? 0 : Math.max(0.1, life);
    this.dummy.position.set(this.x[i]!, this.y[i]!, this.z[i]!);
    this.dummy.rotation.set(0, this.yaw[i]!, 0);
    this.dummy.scale.set(1, 1, scale);
    this.dummy.updateMatrix();
    this.mesh.setMatrixAt(i, this.dummy.matrix);
  }
}

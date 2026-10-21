import * as THREE from 'three';

const RAIN_COUNT = 1600;
const SNOW_COUNT = 900;
const BOX = 110;
const HEIGHT = 60;

export interface PrecipitationConditions {
  /** 0..1 */
  rain: number;
  /** 0..1 */
  snow: number;
  windX: number;
  windZ: number;
}

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
const wrap = (v: number, size: number): number => {
  const half = size / 2;
  if (v > half) return v - size;
  if (v < -half) return v + size;
  return v;
};

/**
 * Pioggia e neve sintetiche intorno alla camera: nessuna texture, nessun asset.
 * I dati meteo decidono solo quanti dei pool sono visibili e quanto inclinano.
 */
export class Precipitation {
  readonly group = new THREE.Group();
  private readonly rainMesh: THREE.LineSegments;
  private readonly snowMesh: THREE.Points;
  private readonly rainPositions: Float32Array;
  private readonly snowPositions: Float32Array;
  private readonly rainOffset = new Float32Array(RAIN_COUNT * 3);
  private readonly snowOffset = new Float32Array(SNOW_COUNT * 3);
  private readonly rainSpeed = new Float32Array(RAIN_COUNT);
  private readonly snowSpeed = new Float32Array(SNOW_COUNT);
  private activeRain = 0;
  private activeSnow = 0;
  private time = 0;

  constructor() {
    this.group.name = 'precipitation';
    this.rainPositions = new Float32Array(RAIN_COUNT * 2 * 3);
    this.snowPositions = new Float32Array(SNOW_COUNT * 3);

    for (let i = 0; i < RAIN_COUNT; i++) {
      this.rainOffset[i * 3] = (Math.random() - 0.5) * BOX;
      this.rainOffset[i * 3 + 1] = Math.random() * HEIGHT;
      this.rainOffset[i * 3 + 2] = (Math.random() - 0.5) * BOX;
      this.rainSpeed[i] = 17 + Math.random() * 12;
    }
    for (let i = 0; i < SNOW_COUNT; i++) {
      this.snowOffset[i * 3] = (Math.random() - 0.5) * BOX;
      this.snowOffset[i * 3 + 1] = Math.random() * HEIGHT;
      this.snowOffset[i * 3 + 2] = (Math.random() - 0.5) * BOX;
      this.snowSpeed[i] = 1.2 + Math.random() * 1.8;
    }

    const rainGeo = new THREE.BufferGeometry();
    rainGeo.setAttribute('position', new THREE.BufferAttribute(this.rainPositions, 3));
    rainGeo.setDrawRange(0, 0);
    this.rainMesh = new THREE.LineSegments(
      rainGeo,
      new THREE.LineBasicMaterial({
        color: 0xc3d7e4,
        transparent: true,
        opacity: 0.52,
        depthWrite: false,
        fog: true,
      }),
    );
    this.rainMesh.name = 'rain';
    this.rainMesh.frustumCulled = false;
    this.rainMesh.visible = false;
    this.group.add(this.rainMesh);

    const snowGeo = new THREE.BufferGeometry();
    snowGeo.setAttribute('position', new THREE.BufferAttribute(this.snowPositions, 3));
    snowGeo.setDrawRange(0, 0);
    this.snowMesh = new THREE.Points(
      snowGeo,
      new THREE.PointsMaterial({
        color: 0xffffff,
        size: 0.16,
        transparent: true,
        opacity: 0.9,
        depthWrite: false,
        sizeAttenuation: true,
        fog: true,
      }),
    );
    this.snowMesh.name = 'snow';
    this.snowMesh.frustumCulled = false;
    this.snowMesh.visible = false;
    this.group.add(this.snowMesh);
  }

  update(dt: number, camera: THREE.Camera, conditions: PrecipitationConditions): void {
    this.time += dt;
    const rain = clamp01(conditions.rain);
    const snow = clamp01(conditions.snow);
    this.activeRain = Math.floor(RAIN_COUNT * rain);
    this.activeSnow = snow > 0.02 ? Math.floor(SNOW_COUNT * snow) : 0;

    this.rainMesh.visible = this.activeRain > 0;
    this.snowMesh.visible = this.activeSnow > 0;
    if (!this.rainMesh.visible && !this.snowMesh.visible) return;

    const cx = camera.position.x;
    const cy = camera.position.y;
    const cz = camera.position.z;

    if (this.rainMesh.visible) {
      for (let i = 0; i < this.activeRain; i++) {
        const o = i * 3;
        this.rainOffset[o + 1] -= this.rainSpeed[i] * dt;
        this.rainOffset[o] += conditions.windX * dt;
        this.rainOffset[o + 2] += conditions.windZ * dt;
        if (this.rainOffset[o + 1] < 0) {
          this.rainOffset[o + 1] += HEIGHT;
          this.rainOffset[o] = (Math.random() - 0.5) * BOX;
          this.rainOffset[o + 2] = (Math.random() - 0.5) * BOX;
        }
        this.rainOffset[o] = wrap(this.rainOffset[o], BOX);
        this.rainOffset[o + 2] = wrap(this.rainOffset[o + 2], BOX);

        const k = i * 6;
        const x = cx + this.rainOffset[o];
        const y = cy + this.rainOffset[o + 1] - 12;
        const z = cz + this.rainOffset[o + 2];
        this.rainPositions[k] = x;
        this.rainPositions[k + 1] = y;
        this.rainPositions[k + 2] = z;
        this.rainPositions[k + 3] = x + conditions.windX * 0.06;
        this.rainPositions[k + 4] = y - 1.5 - this.rainSpeed[i] * 0.03;
        this.rainPositions[k + 5] = z + conditions.windZ * 0.06;
      }
      const attr = this.rainMesh.geometry.getAttribute('position') as THREE.BufferAttribute;
      attr.needsUpdate = true;
      this.rainMesh.geometry.setDrawRange(0, this.activeRain * 2);
    }

    if (this.snowMesh.visible) {
      for (let i = 0; i < this.activeSnow; i++) {
        const o = i * 3;
        this.snowOffset[o + 1] -= this.snowSpeed[i] * dt;
        this.snowOffset[o] += conditions.windX * 0.3 * dt;
        this.snowOffset[o + 2] += conditions.windZ * 0.3 * dt;
        if (this.snowOffset[o + 1] < 0) {
          this.snowOffset[o + 1] += HEIGHT;
          this.snowOffset[o] = (Math.random() - 0.5) * BOX;
          this.snowOffset[o + 2] = (Math.random() - 0.5) * BOX;
        }
        this.snowOffset[o] = wrap(this.snowOffset[o], BOX);
        this.snowOffset[o + 2] = wrap(this.snowOffset[o + 2], BOX);

        const k = i * 3;
        this.snowPositions[k] = cx + this.snowOffset[o] + Math.sin(this.time * 1.3 + i) * 0.5;
        this.snowPositions[k + 1] = cy + this.snowOffset[o + 1] - 10;
        this.snowPositions[k + 2] = cz + this.snowOffset[o + 2];
      }
      const attr = this.snowMesh.geometry.getAttribute('position') as THREE.BufferAttribute;
      attr.needsUpdate = true;
      this.snowMesh.geometry.setDrawRange(0, this.activeSnow);
    }
  }

  clear(): void {
    this.rainMesh.visible = false;
    this.snowMesh.visible = false;
    this.activeRain = 0;
    this.activeSnow = 0;
  }

  dispose(): void {
    this.rainMesh.geometry.dispose();
    (this.rainMesh.material as THREE.Material).dispose();
    this.snowMesh.geometry.dispose();
    (this.snowMesh.material as THREE.Material).dispose();
  }
}

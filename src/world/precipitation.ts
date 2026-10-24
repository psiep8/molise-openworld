import * as THREE from 'three';

const RAIN_COUNT = 1600;
const SNOW_COUNT = 900;
const SPLASH_COUNT = 260;
const BOX = 110;
const HEIGHT = 60;
/** Quanti schizzi possono nascere in un frame: evita picchi quando piove forte. */
const SPLASH_BUDGET = 12;
/** Durata media di uno schizzo (s): serve a dosare le nascite. */
const SPLASH_LIFE = 0.55;

export interface PrecipitationConditions {
  /** 0..1 */
  rain: number;
  /** 0..1 */
  snow: number;
  windX: number;
  windZ: number;
}

export type GroundSampler = (x: number, z: number) => number;

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
const wrap = (v: number, size: number): number => {
  const half = size / 2;
  if (v > half) return v - size;
  if (v < -half) return v + size;
  return v;
};

/** Fiocco morbido: gradiente radiale, niente bordi quadrati. */
function makeFlakeTexture(): THREE.CanvasTexture {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const c = size / 2;
    const gradient = ctx.createRadialGradient(c, c, 0, c, c, c);
    gradient.addColorStop(0, 'rgba(255,255,255,1)');
    gradient.addColorStop(0.32, 'rgba(255,255,255,0.96)');
    gradient.addColorStop(0.62, 'rgba(255,255,255,0.5)');
    gradient.addColorStop(0.85, 'rgba(255,255,255,0.12)');
    gradient.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** Anello sottile per gli schizzi: il centro resta trasparente. */
function makeRingTexture(): THREE.CanvasTexture {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.translate(size / 2, size / 2);
    ctx.strokeStyle = 'rgba(255,255,255,0.95)';
    ctx.lineWidth = 3.2;
    ctx.beginPath();
    ctx.arc(0, 0, 22, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.28)';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.arc(0, 0, 14, 0, Math.PI * 2);
    ctx.stroke();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

const SNOW_VERTEX = /* glsl */ `
  attribute float aSize;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = clamp(aSize * (520.0 / max(1.0, -mv.z)), 1.0, 42.0);
    gl_Position = projectionMatrix * mv;
  }
`;

const SNOW_FRAGMENT = /* glsl */ `
  uniform sampler2D uMap;
  uniform vec3 uColor;
  uniform float uOpacity;
  void main() {
    vec4 tex = texture2D(uMap, gl_PointCoord);
    if (tex.a < 0.02) discard;
    gl_FragColor = vec4(uColor, tex.a * uOpacity);
  }
`;

const SPLASH_VERTEX = /* glsl */ `
  attribute float aLife;
  attribute float aSize;
  varying float vLife;
  void main() {
    vLife = aLife;
    if (aLife <= 0.0) {
      gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      gl_PointSize = 0.0;
      return;
    }
    float progress = 1.0 - aLife;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = clamp(aSize * (1.0 + progress * 2.4) * (240.0 / max(1.0, -mv.z)), 2.0, 26.0);
    gl_Position = projectionMatrix * mv;
  }
`;

const SPLASH_FRAGMENT = /* glsl */ `
  uniform sampler2D uMap;
  uniform vec3 uColor;
  uniform float uOpacity;
  varying float vLife;
  void main() {
    vec4 tex = texture2D(uMap, gl_PointCoord);
    if (tex.a < 0.02) discard;
    float fade = smoothstep(0.0, 0.16, vLife) * smoothstep(0.0, 0.22, 1.0 - vLife);
    gl_FragColor = vec4(uColor, tex.a * fade * uOpacity);
  }
`;

/**
 * Pioggia, neve, schizzi e foschia bassa intorno alla camera.
 *
 * Le gocce restano `LineSegments` (una draw call, zero texture): costano poco e
 * si inclinano col vento. La neve usa sprite con gradiente morbido e dimensione
 * per particella, come negli esempi `webgpu_compute_particles_snow` di Three.js,
 * ma senza compute shader: la posizione viene integrata a mano, così il sistema
 * gira anche su WebGL1.
 *
 * Gli schizzi sono anelli che nascono sul terreno vero (`GroundSampler`
 * fornito dal gioco) intorno alla camera: danno l'attimo di contatto della
 * goccia, che è la parte che manca di solito alla pioggia sintetica.
 */
export class Precipitation {
  readonly group = new THREE.Group();
  private readonly rainMesh: THREE.LineSegments;
  private readonly snowMesh: THREE.Points;
  private readonly splashMesh: THREE.Points;
  private readonly rainPositions: Float32Array;
  private readonly snowPositions: Float32Array;
  private readonly snowSizes: Float32Array;
  private readonly splashPositions: Float32Array;
  private readonly splashLife: Float32Array;
  private readonly splashSizes: Float32Array;
  private readonly rainOffset = new Float32Array(RAIN_COUNT * 3);
  private readonly snowOffset = new Float32Array(SNOW_COUNT * 3);
  private readonly rainSpeed = new Float32Array(RAIN_COUNT);
  private readonly snowSpeed = new Float32Array(SNOW_COUNT);
  private readonly snowSize = new Float32Array(SNOW_COUNT);
  private readonly snowPhase = new Float32Array(SNOW_COUNT);
  private readonly splashSize = new Float32Array(SPLASH_COUNT);
  private readonly flakeTexture = makeFlakeTexture();
  private readonly ringTexture = makeRingTexture();
  private groundAt: GroundSampler | null = null;
  private activeRain = 0;
  private activeSnow = 0;
  private time = 0;

  constructor() {
    this.group.name = 'precipitation';
    this.rainPositions = new Float32Array(RAIN_COUNT * 2 * 3);
    this.snowPositions = new Float32Array(SNOW_COUNT * 3);
    this.snowSizes = new Float32Array(SNOW_COUNT);
    this.splashPositions = new Float32Array(SPLASH_COUNT * 3);
    this.splashLife = new Float32Array(SPLASH_COUNT);
    this.splashSizes = new Float32Array(SPLASH_COUNT);

    const rand = (): number => Math.random();
    for (let i = 0; i < RAIN_COUNT; i++) {
      this.rainOffset[i * 3] = (rand() - 0.5) * BOX;
      this.rainOffset[i * 3 + 1] = rand() * HEIGHT;
      this.rainOffset[i * 3 + 2] = (rand() - 0.5) * BOX;
      this.rainSpeed[i] = 17 + rand() * 12;
    }
    for (let i = 0; i < SNOW_COUNT; i++) {
      this.snowOffset[i * 3] = (rand() - 0.5) * BOX;
      this.snowOffset[i * 3 + 1] = rand() * HEIGHT;
      this.snowOffset[i * 3 + 2] = (rand() - 0.5) * BOX;
      this.snowSpeed[i] = 1.2 + rand() * 1.8;
      this.snowSize[i] = 0.18 + rand() * 0.35;
      this.snowPhase[i] = rand() * Math.PI * 2;
      this.snowSizes[i] = this.snowSize[i];
    }
    for (let i = 0; i < SPLASH_COUNT; i++) {
      this.splashSize[i] = 0.18 + rand() * 0.3;
      this.splashSizes[i] = this.splashSize[i];
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
    snowGeo.setAttribute('aSize', new THREE.BufferAttribute(this.snowSizes, 1));
    snowGeo.setDrawRange(0, 0);
    this.snowMesh = new THREE.Points(
      snowGeo,
      new THREE.ShaderMaterial({
        uniforms: {
          uMap: { value: this.flakeTexture },
          uColor: { value: new THREE.Color(0xffffff) },
          uOpacity: { value: 0.92 },
        },
        vertexShader: SNOW_VERTEX,
        fragmentShader: SNOW_FRAGMENT,
        transparent: true,
        depthWrite: false,
        depthTest: true,
      }),
    );
    this.snowMesh.name = 'snow';
    this.snowMesh.frustumCulled = false;
    this.snowMesh.visible = false;
    this.group.add(this.snowMesh);

    const splashGeo = new THREE.BufferGeometry();
    splashGeo.setAttribute('position', new THREE.BufferAttribute(this.splashPositions, 3));
    splashGeo.setAttribute('aLife', new THREE.BufferAttribute(this.splashLife, 1));
    splashGeo.setAttribute('aSize', new THREE.BufferAttribute(this.splashSizes, 1));
    splashGeo.setDrawRange(0, SPLASH_COUNT);
    this.splashMesh = new THREE.Points(
      splashGeo,
      new THREE.ShaderMaterial({
        uniforms: {
          uMap: { value: this.ringTexture },
          uColor: { value: new THREE.Color(0xd8e8f2) },
          uOpacity: { value: 0.85 },
        },
        vertexShader: SPLASH_VERTEX,
        fragmentShader: SPLASH_FRAGMENT,
        transparent: true,
        depthWrite: false,
        depthTest: true,
      }),
    );
    this.splashMesh.name = 'rain-splashes';
    this.splashMesh.frustumCulled = false;
    this.splashMesh.visible = false;
    this.group.add(this.splashMesh);
  }

  /** Il gioco passa qui la quota del terreno: gli schizzi devono cadere a terra. */
  setGroundSampler(sample: GroundSampler | null): void {
    this.groundAt = sample;
  }

  update(dt: number, camera: THREE.Camera, conditions: PrecipitationConditions): void {
    this.time += dt;
    const rain = clamp01(conditions.rain);
    const snow = clamp01(conditions.snow);
    this.activeRain = Math.floor(RAIN_COUNT * rain);
    this.activeSnow = snow > 0.02 ? Math.floor(SNOW_COUNT * snow) : 0;

    this.rainMesh.visible = this.activeRain > 0;
    this.snowMesh.visible = this.activeSnow > 0;
    this.splashMesh.visible = rain > 0.05;
    if (!this.rainMesh.visible && !this.snowMesh.visible && !this.splashMesh.visible) return;

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
        const sway = Math.sin(this.time * 1.3 + this.snowPhase[i]!) * 0.7;
        this.snowPositions[k] = cx + this.snowOffset[o] + sway;
        this.snowPositions[k + 1] = cy + this.snowOffset[o + 1] - 10;
        this.snowPositions[k + 2] = cz + this.snowOffset[o + 2];
        this.snowSizes[i] = this.snowSize[i]! * (0.85 + Math.sin(this.time * 2.1 + this.snowPhase[i]!) * 0.15);
      }
      const pos = this.snowMesh.geometry.getAttribute('position') as THREE.BufferAttribute;
      const sizes = this.snowMesh.geometry.getAttribute('aSize') as THREE.BufferAttribute;
      pos.needsUpdate = true;
      sizes.needsUpdate = true;
      this.snowMesh.geometry.setDrawRange(0, this.activeSnow);
    }

    if (this.splashMesh.visible) this.updateSplashes(dt, cx, cy, cz, rain);
  }

  private updateSplashes(dt: number, cx: number, cy: number, cz: number, rain: number): void {
    const ground = this.groundAt;
    // A 30 m da terra una goccia che schizza non si vede: si risparmia.
    if (!ground || cy - ground(cx, cz) > 30) {
      this.splashMesh.visible = false;
      return;
    }

    const decay = dt / SPLASH_LIFE;
    for (let i = 0; i < SPLASH_COUNT; i++) {
      this.splashLife[i] = Math.max(0, this.splashLife[i]! - decay);
    }

    // respawn: il numero atteso mantiene il pool pieno per tutta la durata
    // media di uno schizzo, senza dipendere dal frame rate
    const expected = (rain * SPLASH_COUNT * dt) / SPLASH_LIFE;
    const attempts = Math.min(
      SPLASH_BUDGET,
      Math.floor(expected) + (Math.random() < expected % 1 ? 1 : 0),
    );
    let spawned = 0;
    for (let i = 0; i < SPLASH_COUNT && spawned < attempts; i++) {
      if (this.splashLife[i]! > 0) continue;
      const angle = Math.random() * Math.PI * 2;
      const radius = 2.4 + Math.sqrt(Math.random()) * 20;
      const x = cx + Math.cos(angle) * radius;
      const z = cz + Math.sin(angle) * radius;
      // il sampler restituisce già la superficie (asfalto compreso)
      const y = ground(x, z);
      this.splashPositions[i * 3] = x;
      this.splashPositions[i * 3 + 1] = y;
      this.splashPositions[i * 3 + 2] = z;
      this.splashLife[i] = 0.82 + Math.random() * 0.18;
      this.splashSizes[i] = this.splashSize[i]!;
      spawned++;
    }

    const pos = this.splashMesh.geometry.getAttribute('position') as THREE.BufferAttribute;
    const life = this.splashMesh.geometry.getAttribute('aLife') as THREE.BufferAttribute;
    const sizes = this.splashMesh.geometry.getAttribute('aSize') as THREE.BufferAttribute;
    pos.needsUpdate = true;
    life.needsUpdate = true;
    sizes.needsUpdate = true;
  }

  clear(): void {
    this.rainMesh.visible = false;
    this.snowMesh.visible = false;
    this.splashMesh.visible = false;
    this.activeRain = 0;
    this.activeSnow = 0;
    this.splashLife.fill(0);
  }

  dispose(): void {
    this.rainMesh.geometry.dispose();
    (this.rainMesh.material as THREE.Material).dispose();
    this.snowMesh.geometry.dispose();
    (this.snowMesh.material as THREE.Material).dispose();
    this.splashMesh.geometry.dispose();
    (this.splashMesh.material as THREE.Material).dispose();
    this.flakeTexture.dispose();
    this.ringTexture.dispose();
  }
}

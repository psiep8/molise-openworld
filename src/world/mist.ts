import * as THREE from 'three';
import { mulberry32 } from '../geo/geo';

/**
 * Foschia bassa a banchi.
 *
 * Ispirata a `webgpu_custom_fog` di Three.js: invece di aumentare la nebbia
 * globale (che appiattisce tutto), si mettono pochi banchi morbidi a 1–7 m dal
 * suolo, ancorati al mondo e non alla camera. All'alba, al tramonto e con
 * pioggia o nebbia riempiono le valli senza togliere dettaglio al paese.
 *
 * Sono sprite grandi (40–110 m) con una texture di gradiente morbido: 16 punti,
 * una draw call, nessun calcolo per pixel oltre al campionamento.
 */

const COUNT = 16;
/** Lato del quadrato entro cui i banchi si riciclano attorno alla camera. */
const BOX = 720;
const MIN_HEIGHT = 0.6;
const MAX_HEIGHT = 7.5;

export type GroundSampler = (x: number, z: number) => number;

const VERTEX = /* glsl */ `
  attribute float aSize;
  attribute float aPhase;
  varying float vFade;
  varying float vPhase;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    float dist = max(1.0, -mv.z);
    // niente banco addosso alla camera: sembrerebbe un lampo bianco
    vFade = smoothstep(10.0, 38.0, dist);
    vPhase = aPhase;
    gl_PointSize = clamp(aSize * (340.0 / dist), 12.0, 1600.0);
    gl_Position = projectionMatrix * mv;
  }
`;

const FRAGMENT = /* glsl */ `
  uniform sampler2D uMap;
  uniform vec3 uColor;
  uniform float uOpacity;
  varying float vFade;
  varying float vPhase;
  void main() {
    vec4 tex = texture2D(uMap, gl_PointCoord);
    if (tex.a < 0.01) discard;
    float pulse = 0.82 + 0.18 * sin(vPhase);
    gl_FragColor = vec4(uColor, tex.a * vFade * uOpacity * pulse);
  }
`;

function makeMistTexture(): THREE.CanvasTexture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    // due lobi sovrapposti: la sagoma non è un cerchio perfetto
    const draw = (cx: number, cy: number, radius: number, alpha: number): void => {
      const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
      gradient.addColorStop(0, `rgba(255,255,255,${alpha})`);
      gradient.addColorStop(0.45, `rgba(255,255,255,${alpha * 0.55})`);
      gradient.addColorStop(0.75, `rgba(255,255,255,${alpha * 0.16})`);
      gradient.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, size, size);
    };
    draw(size * 0.5, size * 0.52, size * 0.48, 0.55);
    draw(size * 0.38, size * 0.44, size * 0.36, 0.32);
    draw(size * 0.64, size * 0.58, size * 0.32, 0.28);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export class GroundMist {
  readonly group = new THREE.Group();
  private readonly mesh: THREE.Points;
  private readonly positions: Float32Array;
  private readonly sizes: Float32Array;
  private readonly phases: Float32Array;
  private readonly worldX: Float32Array;
  private readonly worldZ: Float32Array;
  private readonly heights: Float32Array;
  private readonly material: THREE.ShaderMaterial;
  private readonly texture = makeMistTexture();
  private groundAt: GroundSampler = () => 0;
  private initialized = false;
  private time = 0;

  constructor() {
    this.group.name = 'ground-mist';
    this.positions = new Float32Array(COUNT * 3);
    this.sizes = new Float32Array(COUNT);
    this.phases = new Float32Array(COUNT);
    this.worldX = new Float32Array(COUNT);
    this.worldZ = new Float32Array(COUNT);
    this.heights = new Float32Array(COUNT);

    const random = mulberry32(0x6d697374);
    for (let i = 0; i < COUNT; i++) {
      this.sizes[i] = 42 + random() * 68;
      this.phases[i] = random() * Math.PI * 2;
      this.heights[i] = MIN_HEIGHT + random() * (MAX_HEIGHT - MIN_HEIGHT);
      this.worldX[i] = (random() - 0.5) * BOX;
      this.worldZ[i] = (random() - 0.5) * BOX;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    geometry.setAttribute('aSize', new THREE.BufferAttribute(this.sizes, 1));
    geometry.setAttribute('aPhase', new THREE.BufferAttribute(this.phases, 1));
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uMap: { value: this.texture },
        uColor: { value: new THREE.Color(0xb9cbd8) },
        uOpacity: { value: 0 },
      },
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      transparent: true,
      depthWrite: false,
      depthTest: true,
    });
    this.mesh = new THREE.Points(geometry, this.material);
    this.mesh.name = 'mist-banks';
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    this.group.add(this.mesh);
  }

  setGroundSampler(sample: GroundSampler): void {
    this.groundAt = sample;
  }

  /** Colore dei banchi: va tenuto vicino a quello della nebbia di scena. */
  setColor(color: THREE.ColorRepresentation): void {
    (this.material.uniforms.uColor!.value as THREE.Color).set(color);
  }

  update(
    dt: number,
    camera: THREE.Camera,
    intensity: number,
    windX: number,
    windZ: number,
  ): void {
    this.time += dt;
    const amount = intensity < 0 ? 0 : intensity > 1 ? 1 : intensity;
    this.mesh.visible = amount > 0.03;
    if (!this.mesh.visible) return;

    this.material.uniforms.uOpacity!.value = 0.26 * amount;

    const cx = camera.position.x;
    const cz = camera.position.z;
    if (!this.initialized) {
      for (let i = 0; i < COUNT; i++) {
        this.worldX[i] = cx + this.worldX[i]!;
        this.worldZ[i] = cz + this.worldZ[i]!;
      }
      this.initialized = true;
    }

    const half = BOX / 2;
    for (let i = 0; i < COUNT; i++) {
      // deriva lenta col vento
      this.worldX[i] = this.worldX[i]! + windX * dt * 0.22;
      this.worldZ[i] = this.worldZ[i]! + windZ * dt * 0.22;

      // riciclo attorno alla camera: i banchi restano ancorati al terreno
      let dx = this.worldX[i]! - cx;
      if (dx > half) this.worldX[i] = this.worldX[i]! - BOX;
      else if (dx < -half) this.worldX[i] = this.worldX[i]! + BOX;
      let dz = this.worldZ[i]! - cz;
      if (dz > half) this.worldZ[i] = this.worldZ[i]! - BOX;
      else if (dz < -half) this.worldZ[i] = this.worldZ[i]! + BOX;

      const x = this.worldX[i]!;
      const z = this.worldZ[i]!;
      const k = i * 3;
      this.positions[k] = x;
      this.positions[k + 1] =
        this.groundAt(x, z) + this.heights[i]! + Math.sin(this.time * 0.08 + this.phases[i]!) * 0.35;
      this.positions[k + 2] = z;
    }
    (this.mesh.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
    this.texture.dispose();
  }
}

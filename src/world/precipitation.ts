import * as THREE from 'three';
import { mulberry32 } from '../geo/geo';
import type { QualityLevel } from '../gfx/quality';
import type { RoadVehicleLight } from './roads';

/**
 * Pioggia e neve a tre profondità (vicina, media, lontana).
 *
 * Le particelle non esistono più come vertici aggiornati dalla CPU: ogni
 * istanza ha solo un seme e uno strato, e lo shader calcola posizione, caduta,
 * vento e flutter a partire dal tempo. Il costo per frame è quindi un paio di
 * uniform, non 12.000 scritture di buffer.
 *
 * - **pioggia**: quad allungati lungo la velocità (una vera striscia di motion
 *   blur, non un segmento di linea), con texture sfumata e alpha che cala con
 *   la distanza. Gli strati vicini sono più grandi e più opachi, quelli lontani
 *   diventano pioviggine fine.
 * - **neve**: quad billboard con dimensione 0,5–3 cm, rotazione e flutter
 *   pseudo-curl, depth fade. Ogni fiocco ha velocità e fase proprie.
 * - **luci**: le gocce vicine si accendono nel cono di fari e lampioni (fino a
 *   quattro luci), così di notte la pioggia si vede dove c'è luce.
 * - **goccioline in camera**: overlay screen-space leggero, solo con pioggia e
 *   sui preset alti.
 */
const RAIN_MAX = 15_000;
const SNOW_MAX = 6_000;
const SPLASH_COUNT = 420;
/** Quanti schizzi possono nascere in un frame: evita picchi quando piove forte. */
const SPLASH_BUDGET = 16;
/** Durata media di uno schizzo (s): serve a dosare le nascite. */
const SPLASH_LIFE = 0.55;
const LIGHT_COUNT = 4;

export interface PrecipitationConditions {
  /** 0..1 */
  rain: number;
  /** 0..1 */
  snow: number;
  windX: number;
  windZ: number;
}

export type GroundSampler = (x: number, z: number) => number;

interface Budget {
  rain: number;
  snow: number;
}

const BUDGETS: Record<QualityLevel, Budget> = {
  minimal: { rain: 2_400, snow: 900 },
  low: { rain: 3_800, snow: 1_400 },
  medium: { rain: 6_400, snow: 2_400 },
  high: { rain: 11_000, snow: 4_200 },
  ultra: { rain: RAIN_MAX, snow: SNOW_MAX },
};

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Striscia di pioggia: nucleo luminoso, estremità sfumate, bordi morbidi. */
function makeStreakTexture(): THREE.CanvasTexture {
  const width = 16;
  const height = 128;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const image = ctx.createImageData(width, height);
    for (let y = 0; y < height; y++) {
      const v = y / (height - 1);
      // profilo verticale: appuntito alle due punte, pieno al centro
      const taper = Math.pow(Math.sin(Math.PI * v), 0.55);
      for (let x = 0; x < width; x++) {
        const u = (x / (width - 1) - 0.5) / 0.5;
        // nucleo stretto + alone: la goccia non è un rettangolo pieno
        const core = Math.exp(-u * u * 7.5);
        const halo = Math.exp(-u * u * 2.2) * 0.38;
        const alpha = Math.min(1, (core + halo) * taper);
        const i = (y * width + x) * 4;
        image.data[i] = 235;
        image.data[i + 1] = 244;
        image.data[i + 2] = 255;
        image.data[i + 3] = Math.round(alpha * 255);
      }
    }
    ctx.putImageData(image, 0, 0);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  return texture;
}

/** Fiocco morbido: gradiente radiale con un nucleo leggermente irregolare. */
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
    gradient.addColorStop(0.28, 'rgba(255,255,255,0.95)');
    gradient.addColorStop(0.58, 'rgba(255,255,255,0.55)');
    gradient.addColorStop(0.82, 'rgba(255,255,255,0.16)');
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
    ctx.lineWidth = 2.6;
    ctx.beginPath();
    ctx.arc(0, 0, 23, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.3)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(0, 0, 15, 0, Math.PI * 2);
    ctx.stroke();
    // goccioline staccate dalla corona: un anello perfetto sembra un cerchio
    // disegnato, quattro puntini irregolari lo rompono
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    for (const [x, y] of [[-24, 8], [18, -16], [22, 14], [-12, -22]] as const) {
      ctx.beginPath();
      ctx.arc(x, y, 1.6, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

const RAIN_VERTEX = /* glsl */ `
  attribute vec4 aSeed;   // xyz = posizione casuale, w = variazione
  attribute float aLayer; // 0 vicina, 1 media, 2 lontana
  uniform vec3 uCamera;
  uniform float uTime;
  uniform vec2 uWind;
  uniform float uDay;
  uniform vec3 uSkyColor;
  uniform vec3 uLightPos[${LIGHT_COUNT}];
  uniform vec3 uLightColor[${LIGHT_COUNT}];
  uniform float uLightPower[${LIGHT_COUNT}];
  uniform float uLightRange[${LIGHT_COUNT}];
  varying vec2 vUv;
  varying vec3 vColor;
  varying float vAlpha;

  float rainHash(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }

  void main() {
    float layer = aLayer;
    float boxR = layer < 0.5 ? 24.0 : (layer < 1.5 ? 58.0 : 112.0);
    float height = layer < 0.5 ? 28.0 : (layer < 1.5 ? 42.0 : 60.0);
    float speed = mix(5.0, 9.0, aSeed.w) * (layer < 0.5 ? 1.0 : layer < 1.5 ? 0.94 : 0.86);
    float shutter = mix(0.020, 0.048, rainHash(aSeed.xz * 37.0));

    // posizione nel mondo, riavvolta attorno alla camera: niente "scatola"
    // che si porta dietro le gocce quando ci si sposta
    vec2 rel = mod(aSeed.xz * boxR + uWind * uTime - uCamera.xz + boxR * 0.5, boxR) - boxR * 0.5;
    vec3 world = vec3(uCamera.x + rel.x, 0.0, uCamera.z + rel.y);
    float fall = mod(aSeed.y * height - uTime * speed, height);
    world.y = uCamera.y - 11.0 + fall;

    // la striscia è orientata lungo la velocità: in caso di vento forte pende
    vec3 velocity = vec3(uWind.x, -speed, uWind.y);
    vec3 dir = normalize(velocity);
    float len = max(0.16, speed * shutter) * (layer < 0.5 ? 1.0 : 0.9);

    vec4 mvA = viewMatrix * vec4(world - dir * (len * 0.5), 1.0);
    vec4 mvB = viewMatrix * vec4(world + dir * (len * 0.5), 1.0);
    vec2 sdir = normalize(mvB.xy - mvA.xy + vec2(1e-5));
    vec2 snrm = vec2(-sdir.y, sdir.x);
    float dist = max(0.6, -((mvA.z + mvB.z) * 0.5));
    // la larghezza cresce un filo con la distanza: sotto il pixel la goccia
    // sparirebbe e la pioggia sembrerebbe intermittente
    float width = mix(0.008, 0.018, aSeed.w) * (layer < 0.5 ? 1.25 : 1.0);
    width *= 1.0 + dist * 0.012;

    vec4 mv = mix(mvA, mvB, position.y + 0.5);
    mv.xy += snrm * position.x * width;
    gl_Position = projectionMatrix * mv;

    vUv = uv;
    // alpha per strato: vicino leggibile, lontano appena percettibile
    float layerAlpha = layer < 0.5 ? 0.62 : (layer < 1.5 ? 0.34 : 0.15);
    float depthFade = 1.0 - smoothstep(boxR * 0.48, boxR, dist);
    float nearFade = smoothstep(0.9, 2.4, dist);
    vAlpha = layerAlpha * depthFade * nearFade;

    vec3 lit = uSkyColor * (0.32 + 0.68 * uDay);
    for (int i = 0; i < ${LIGHT_COUNT}; i++) {
      float d = length(world - uLightPos[i]);
      float k = uLightPower[i] * (1.0 - smoothstep(uLightRange[i] * 0.15, uLightRange[i], d));
      lit += uLightColor[i] * k;
    }
    vColor = lit;
  }
`;

const RAIN_FRAGMENT = /* glsl */ `
  uniform sampler2D uMap;
  varying vec2 vUv;
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    vec4 tex = texture2D(uMap, vUv);
    float alpha = tex.a * vAlpha;
    if (alpha < 0.012) discard;
    gl_FragColor = vec4(vColor * tex.rgb, alpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

const SNOW_VERTEX = /* glsl */ `
  attribute vec4 aSeed;
  attribute float aLayer;
  uniform vec3 uCamera;
  uniform float uTime;
  uniform vec2 uWind;
  uniform float uDay;
  uniform vec3 uSkyColor;
  uniform vec3 uLightPos[${LIGHT_COUNT}];
  uniform vec3 uLightColor[${LIGHT_COUNT}];
  uniform float uLightPower[${LIGHT_COUNT}];
  uniform float uLightRange[${LIGHT_COUNT}];
  varying vec2 vUv;
  varying vec3 vColor;
  varying float vAlpha;

  void main() {
    float layer = aLayer;
    float boxR = layer < 0.5 ? 20.0 : (layer < 1.5 ? 54.0 : 108.0);
    float height = layer < 0.5 ? 24.0 : (layer < 1.5 ? 38.0 : 56.0);
    float speed = mix(0.8, 2.0, aSeed.w) * (layer < 0.5 ? 1.0 : 0.92);

    vec2 rel = mod(aSeed.xz * boxR + uWind * uTime - uCamera.xz + boxR * 0.5, boxR) - boxR * 0.5;
    vec3 world = vec3(uCamera.x + rel.x, 0.0, uCamera.z + rel.y);
    float fall = mod(aSeed.y * height - uTime * speed, height);
    world.y = uCamera.y - 9.0 + fall;

    // flutter pseudo-curl: due sin a frequenze diverse, fase dalla posizione
    float phase = aSeed.x * 41.0 + aSeed.z * 29.0;
    world.x += sin(uTime * 1.15 + phase) * 0.32 + sin(uTime * 2.7 + phase * 1.7) * 0.12;
    world.z += cos(uTime * 0.93 + phase * 1.3) * 0.28;

    float size = mix(0.006, 0.03, aSeed.w * aSeed.w) * (layer < 0.5 ? 1.15 : 1.0);
    float dist = max(0.6, length(uCamera - world));
    // un fiocco lontano deve restare almeno un pixel: il depth fade evita che
    // diventi una macchia, ma senza questo minimo la nevicata sparisce a 30 m
    float pxScale = size * (1.0 + dist * 0.035);

    float angle = uTime * (0.4 + aSeed.w) + phase;
    mat2 rot = mat2(cos(angle), -sin(angle), sin(angle), cos(angle));
    vec4 mv = viewMatrix * vec4(world, 1.0);
    mv.xy += rot * position.xy * pxScale;
    gl_Position = projectionMatrix * mv;

    vUv = uv;
    float layerAlpha = layer < 0.5 ? 0.95 : (layer < 1.5 ? 0.7 : 0.42);
    float depthFade = 1.0 - smoothstep(boxR * 0.4, boxR, dist);
    vAlpha = layerAlpha * depthFade * smoothstep(0.5, 1.4, dist);

    vec3 lit = uSkyColor * (0.5 + 0.5 * uDay) + vec3(0.08);
    for (int i = 0; i < ${LIGHT_COUNT}; i++) {
      float d = length(world - uLightPos[i]);
      float k = uLightPower[i] * (1.0 - smoothstep(uLightRange[i] * 0.1, uLightRange[i], d));
      lit += uLightColor[i] * k * 1.6;
    }
    vColor = lit;
  }
`;

const SNOW_FRAGMENT = /* glsl */ `
  uniform sampler2D uMap;
  varying vec2 vUv;
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    vec4 tex = texture2D(uMap, vUv);
    float alpha = tex.a * vAlpha;
    if (alpha < 0.012) discard;
    gl_FragColor = vec4(vColor * tex.rgb, alpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

const SPLASH_VERTEX = /* glsl */ `
  attribute float aLife;
  attribute float aSize;
  attribute float aPhase;
  varying float vLife;
  varying float vPhase;
  void main() {
    vLife = aLife;
    vPhase = aPhase;
    if (aLife <= 0.0) {
      gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      gl_PointSize = 0.0;
      return;
    }
    float progress = 1.0 - aLife;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = clamp(aSize * (0.7 + progress * 2.6) * (260.0 / max(1.0, -mv.z)), 2.0, 30.0);
    gl_Position = projectionMatrix * mv;
  }
`;

const SPLASH_FRAGMENT = /* glsl */ `
  uniform sampler2D uMap;
  uniform vec3 uColor;
  uniform float uOpacity;
  varying float vLife;
  varying float vPhase;
  void main() {
    // ogni schizzo usa una rotazione diversa della corona: niente anelli
    // tutti identici e sincronizzati
    vec2 uv = gl_PointCoord - 0.5;
    float c = cos(vPhase);
    float s = sin(vPhase);
    uv = mat2(c, -s, s, c) * uv + 0.5;
    vec4 tex = texture2D(uMap, uv);
    if (tex.a < 0.02) discard;
    float fade = smoothstep(0.0, 0.16, vLife) * smoothstep(0.0, 0.22, 1.0 - vLife);
    gl_FragColor = vec4(uColor, tex.a * fade * uOpacity);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

/** Vetro bagnato in camera: poche gocce, lente scivolata, niente tergicristalli. */
const DROPLET_VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const DROPLET_FRAGMENT = /* glsl */ `
  uniform float uTime;
  uniform float uRain;
  uniform float uOpacity;
  varying vec2 vUv;

  float dropHash(vec2 p) {
    p = fract(p * vec2(127.1, 311.7));
    p += dot(p, p + 41.23);
    return fract(p.x * p.y);
  }

  void main() {
    vec3 color = vec3(0.72, 0.82, 0.93);
    float alpha = 0.0;
    for (int i = 0; i < 3; i++) {
      float fi = float(i);
      float scale = 8.0 + fi * 4.0;
      vec2 grid = vUv * vec2(scale * 1.7, scale);
      vec2 id = floor(grid);
      vec2 f = fract(grid) - 0.5;
      float r = dropHash(id + fi * 31.7);
      if (r > 0.2 * uRain) continue;
      vec2 center = (vec2(dropHash(id + 1.7), dropHash(id + 9.1)) - 0.5) * 0.5;
      float slide = fract(uTime * (0.035 + 0.07 * r) + dropHash(id + 3.3));
      center.y += 0.36 - slide * 0.72;
      vec2 d = f - center;
      // corpo tondeggiante e scia verticale sottile
      float body = 1.0 - smoothstep(0.022, 0.075, length(d * vec2(1.5, 1.0)));
      float trail = (1.0 - smoothstep(0.0, 0.028, abs(d.x))) * smoothstep(0.0, 0.22, d.y) *
        (1.0 - smoothstep(0.0, 0.3, d.y));
      float drop = max(body, trail * 0.55);
      alpha += drop * (0.13 + 0.13 * r);
    }
    alpha *= uRain * uOpacity;
    if (alpha < 0.008) discard;
    gl_FragColor = vec4(color, alpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

interface PrecipitationUniforms {
  [key: string]: THREE.IUniform;
}

function makeInstancedQuad(
  seeds: Float32Array,
  layers: Float32Array,
  capacity: number,
): THREE.InstancedBufferGeometry {
  const base = new THREE.PlaneGeometry(1, 1);
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.index = base.index;
  geometry.setAttribute('position', base.attributes.position!);
  geometry.setAttribute('uv', base.attributes.uv!);
  const seed = new Float32Array(capacity * 4);
  seed.set(seeds.subarray(0, capacity * 4));
  geometry.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seed, 4));
  geometry.setAttribute('aLayer', new THREE.InstancedBufferAttribute(layers.subarray(0, capacity), 1));
  geometry.instanceCount = 0;
  return geometry;
}

export class Precipitation {
  readonly group = new THREE.Group();
  private readonly rainMesh: THREE.Mesh;
  private readonly snowMesh: THREE.Mesh;
  private readonly splashMesh: THREE.Points;
  private readonly splashPositions: Float32Array;
  private readonly splashLife: Float32Array;
  private readonly splashSizes: Float32Array;
  private readonly splashPhases: Float32Array;
  private readonly flakeTexture = makeFlakeTexture();
  private readonly ringTexture = makeRingTexture();
  private readonly streakTexture = makeStreakTexture();
  private readonly rainUniforms: PrecipitationUniforms;
  private readonly snowUniforms: PrecipitationUniforms;
  private readonly splashUniforms: PrecipitationUniforms;
  private groundAt: GroundSampler | null = null;
  private time = 0;
  private budget: Budget = BUDGETS.high;
  private activeRain = 0;
  private activeSnow = 0;
  private day = 1;
  private skyTint = new THREE.Color(0xc3d7e4);
  private readonly lightPos = Array.from({ length: LIGHT_COUNT }, () => new THREE.Vector3(0, -999, 0));
  private readonly lightColor = Array.from({ length: LIGHT_COUNT }, () => new THREE.Color(0xffffff));
  private lightPower = new Float32Array(LIGHT_COUNT);
  private lightRange = new Float32Array(LIGHT_COUNT);
  private dropletMesh: THREE.Mesh | null = null;
  private dropletUniforms: PrecipitationUniforms | null = null;
  private dropletEnabled = false;
  private rainIntensity = 0;

  constructor(quality: QualityLevel = 'high') {
    this.group.name = 'precipitation';
    this.budget = BUDGETS[quality];

    const rainSeeds = new Float32Array(RAIN_MAX * 4);
    const rainLayers = new Float32Array(RAIN_MAX);
    const snowSeeds = new Float32Array(SNOW_MAX * 4);
    const snowLayers = new Float32Array(SNOW_MAX);
    const rand = mulberry32(0x51f0a3);
    for (let i = 0; i < RAIN_MAX; i++) {
      rainSeeds[i * 4] = rand();
      rainSeeds[i * 4 + 1] = rand();
      rainSeeds[i * 4 + 2] = rand();
      rainSeeds[i * 4 + 3] = rand();
      // strati alternati: riducendo il numero restano sempre tutte e tre le
      // profondità, non solo le gocce vicine
      rainLayers[i] = i % 3;
    }
    for (let i = 0; i < SNOW_MAX; i++) {
      snowSeeds[i * 4] = rand();
      snowSeeds[i * 4 + 1] = rand();
      snowSeeds[i * 4 + 2] = rand();
      snowSeeds[i * 4 + 3] = rand();
      snowLayers[i] = i % 3;
    }

    this.rainUniforms = {
      uMap: { value: this.streakTexture },
      uCamera: { value: new THREE.Vector3() },
      uTime: { value: 0 },
      uWind: { value: new THREE.Vector2() },
      uDay: { value: 1 },
      uSkyColor: { value: this.skyTint },
      uLightPos: { value: this.lightPos },
      uLightColor: { value: this.lightColor },
      uLightPower: { value: this.lightPower },
      uLightRange: { value: this.lightRange },
    };
    this.snowUniforms = {
      uMap: { value: this.flakeTexture },
      uCamera: { value: new THREE.Vector3() },
      uTime: { value: 0 },
      uWind: { value: new THREE.Vector2() },
      uDay: { value: 1 },
      uSkyColor: { value: this.skyTint },
      uLightPos: { value: this.lightPos },
      uLightColor: { value: this.lightColor },
      uLightPower: { value: this.lightPower },
      uLightRange: { value: this.lightRange },
    };

    const rainGeometry = makeInstancedQuad(rainSeeds, rainLayers, RAIN_MAX);
    this.rainMesh = new THREE.Mesh(
      rainGeometry,
      new THREE.ShaderMaterial({
        uniforms: this.rainUniforms,
        vertexShader: RAIN_VERTEX,
        fragmentShader: RAIN_FRAGMENT,
        transparent: true,
        depthWrite: false,
        depthTest: true,
        side: THREE.DoubleSide,
        toneMapped: true,
      }),
    );
    this.rainMesh.name = 'rain';
    this.rainMesh.frustumCulled = false;
    this.rainMesh.visible = false;
    this.rainMesh.renderOrder = 3;
    this.group.add(this.rainMesh);

    const snowGeometry = makeInstancedQuad(snowSeeds, snowLayers, SNOW_MAX);
    this.snowMesh = new THREE.Mesh(
      snowGeometry,
      new THREE.ShaderMaterial({
        uniforms: this.snowUniforms,
        vertexShader: SNOW_VERTEX,
        fragmentShader: SNOW_FRAGMENT,
        transparent: true,
        depthWrite: false,
        depthTest: true,
        side: THREE.DoubleSide,
        toneMapped: true,
      }),
    );
    this.snowMesh.name = 'snow';
    this.snowMesh.frustumCulled = false;
    this.snowMesh.visible = false;
    this.snowMesh.renderOrder = 3;
    this.group.add(this.snowMesh);

    this.splashPositions = new Float32Array(SPLASH_COUNT * 3);
    this.splashLife = new Float32Array(SPLASH_COUNT);
    this.splashSizes = new Float32Array(SPLASH_COUNT);
    this.splashPhases = new Float32Array(SPLASH_COUNT);
    for (let i = 0; i < SPLASH_COUNT; i++) {
      this.splashSizes[i] = 0.16 + rand() * 0.34;
      this.splashPhases[i] = rand() * Math.PI * 2;
    }
    const splashGeo = new THREE.BufferGeometry();
    splashGeo.setAttribute('position', new THREE.BufferAttribute(this.splashPositions, 3));
    splashGeo.setAttribute('aLife', new THREE.BufferAttribute(this.splashLife, 1));
    splashGeo.setAttribute('aSize', new THREE.BufferAttribute(this.splashSizes, 1));
    splashGeo.setAttribute('aPhase', new THREE.BufferAttribute(this.splashPhases, 1));
    this.splashUniforms = {
      uMap: { value: this.ringTexture },
      uColor: { value: new THREE.Color(0xd8e8f2) },
      uOpacity: { value: 0.85 },
    };
    this.splashMesh = new THREE.Points(
      splashGeo,
      new THREE.ShaderMaterial({
        uniforms: this.splashUniforms,
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

  /** Cambia il tetto di particelle quando si passa a un altro preset. */
  setQuality(quality: QualityLevel): void {
    this.budget = BUDGETS[quality];
  }

  /** Colore del cielo e luminosità: le gocce devono stare nella scena. */
  setAmbient(skyColor: THREE.Color, day: number): void {
    // l'uniform punta a `skyTint`: copiare qui basta per tutti e due gli shader
    this.skyTint.copy(skyColor);
    this.day = clamp01(day);
  }

  /**
   * Luci che devono accendere le gocce (fari auto, lampioni). Oltre quattro
   * vengono scartate: sono le più vicine alla camera a contare.
   */
  setLights(lights: readonly RoadVehicleLight[]): void {
    let used = 0;
    for (const light of lights) {
      if (used >= LIGHT_COUNT) break;
      if (!(light.power > 0.001)) continue;
      this.lightPos[used]!.set(light.x, light.y, light.z);
      this.lightColor[used]!.setRGB(light.r, light.g, light.b);
      this.lightPower[used] = light.power;
      this.lightRange[used] = light.range;
      used++;
    }
    for (let i = used; i < LIGHT_COUNT; i++) {
      this.lightPower[i] = 0;
    }
  }

  /** Goccioline screen-space sul vetro: si aggancia alla camera una volta sola. */
  attachCamera(camera: THREE.Camera): void {
    if (this.dropletMesh) return;
    const geometry = new THREE.PlaneGeometry(2, 2);
    this.dropletUniforms = {
      uTime: { value: 0 },
      uRain: { value: 0 },
      uOpacity: { value: 0.5 },
    };
    const material = new THREE.ShaderMaterial({
      uniforms: this.dropletUniforms,
      vertexShader: DROPLET_VERTEX,
      fragmentShader: DROPLET_FRAGMENT,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      toneMapped: true,
    });
    this.dropletMesh = new THREE.Mesh(geometry, material);
    this.dropletMesh.name = 'camera-rain-droplets';
    this.dropletMesh.frustumCulled = false;
    this.dropletMesh.renderOrder = 999;
    this.dropletMesh.visible = false;
    camera.add(this.dropletMesh);
  }

  /** Goccioline sul vetro solo a high+ e solo quando piove davvero. */
  setCameraDroplets(enabled: boolean): void {
    this.dropletEnabled = enabled;
  }

  update(dt: number, camera: THREE.Camera, conditions: PrecipitationConditions): void {
    this.time += dt;
    const rain = clamp01(conditions.rain);
    const snow = clamp01(conditions.snow);
    this.rainIntensity = rain;
    this.activeRain = Math.floor(this.budget.rain * rain);
    this.activeSnow = snow > 0.02 ? Math.floor(this.budget.snow * snow) : 0;

    this.rainMesh.visible = this.activeRain > 0;
    this.snowMesh.visible = this.activeSnow > 0;
    this.splashMesh.visible = rain > 0.05;
    const dropletsOn = this.dropletEnabled && rain > 0.08;
    if (this.dropletMesh) this.dropletMesh.visible = dropletsOn;
    if (!this.rainMesh.visible && !this.snowMesh.visible && !this.splashMesh.visible && !dropletsOn) return;

    const cx = camera.position.x;
    const cy = camera.position.y;
    const cz = camera.position.z;

    if (this.rainMesh.visible) {
      (this.rainUniforms.uCamera!.value as THREE.Vector3).set(cx, cy, cz);
      (this.rainUniforms.uWind!.value as THREE.Vector2).set(conditions.windX, conditions.windZ);
      this.rainUniforms.uTime!.value = this.time;
      this.rainUniforms.uDay!.value = this.day;
      (this.rainMesh.geometry as THREE.InstancedBufferGeometry).instanceCount = this.activeRain;
    }

    if (this.snowMesh.visible) {
      (this.snowUniforms.uCamera!.value as THREE.Vector3).set(cx, cy, cz);
      (this.snowUniforms.uWind!.value as THREE.Vector2).set(conditions.windX * 0.6, conditions.windZ * 0.6);
      this.snowUniforms.uTime!.value = this.time;
      this.snowUniforms.uDay!.value = this.day;
      (this.snowMesh.geometry as THREE.InstancedBufferGeometry).instanceCount = this.activeSnow;
    }

    if (dropletsOn && this.dropletUniforms) {
      this.dropletUniforms.uTime!.value = this.time;
      this.dropletUniforms.uRain!.value = rain;
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
      const radius = 2.0 + Math.sqrt(Math.random()) * 22;
      const x = cx + Math.cos(angle) * radius;
      const z = cz + Math.sin(angle) * radius;
      // il sampler restituisce già la superficie (asfalto compreso)
      const y = ground(x, z);
      this.splashPositions[i * 3] = x;
      this.splashPositions[i * 3 + 1] = y;
      this.splashPositions[i * 3 + 2] = z;
      this.splashLife[i] = 0.82 + Math.random() * 0.18;
      this.splashSizes[i] = 0.14 + Math.random() * 0.36;
      this.splashPhases[i] = Math.random() * Math.PI * 2;
      spawned++;
    }

    const pos = this.splashMesh.geometry.getAttribute('position') as THREE.BufferAttribute;
    const life = this.splashMesh.geometry.getAttribute('aLife') as THREE.BufferAttribute;
    const sizes = this.splashMesh.geometry.getAttribute('aSize') as THREE.BufferAttribute;
    const phases = this.splashMesh.geometry.getAttribute('aPhase') as THREE.BufferAttribute;
    pos.needsUpdate = true;
    life.needsUpdate = true;
    sizes.needsUpdate = true;
    phases.needsUpdate = true;
  }

  /** Diagnostica: quante gocce sta disegnando lo shader. */
  get counts(): { rain: number; snow: number; rainIntensity: number } {
    return { rain: this.activeRain, snow: this.activeSnow, rainIntensity: this.rainIntensity };
  }

  clear(): void {
    this.rainMesh.visible = false;
    this.snowMesh.visible = false;
    this.splashMesh.visible = false;
    if (this.dropletMesh) this.dropletMesh.visible = false;
    this.activeRain = 0;
    this.activeSnow = 0;
    this.rainIntensity = 0;
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
    this.streakTexture.dispose();
    if (this.dropletMesh) {
      this.dropletMesh.geometry.dispose();
      (this.dropletMesh.material as THREE.Material).dispose();
      this.dropletMesh.removeFromParent();
      this.dropletMesh = null;
    }
  }
}

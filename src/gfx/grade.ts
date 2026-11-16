import * as THREE from 'three';
import { FullScreenQuad, Pass } from 'three/addons/postprocessing/Pass.js';

/**
 * Color grading con LUT 3D impacchettata in un atlante 2D.
 *
 * L'atlante evita `sampler3D` (che in GLSL1 costringe a cambiare versione del
 * materiale) e permette di applicare la LUT **dopo** tone mapping e conversione
 * sRGB: le alte luci non vengono schiacciate nel dominio [0,1] della LUT.
 *
 * Ogni LUT ha 32 livelli per canale, quindi 32×32×32 colori; l'atlante è
 * 1024×32 RGBA (128 KB) e quattro look costano mezzo megabyte.
 */
const LUT_SIZE = 32;

interface GradeParams {
  name: string;
  lift: readonly [number, number, number];
  gain: readonly [number, number, number];
  gamma: readonly [number, number, number];
  contrast: number;
  saturation: number;
  intensity: number;
}

export interface GradeLook {
  name: string;
  texture: THREE.DataTexture;
  intensity: number;
}

/**
 * I quattro momenti della giornata. I valori sono volutamente piccoli: il
 * grade deve togliere il grigio da videogioco, non diventare un filtro Instagram.
 */
const LOOKS: readonly GradeParams[] = [
  {
    name: 'alba',
    lift: [0.012, 0.006, 0.0],
    gain: [1.045, 0.995, 0.945],
    gamma: [1.0, 1.0, 1.0],
    contrast: 1.03,
    saturation: 1.06,
    intensity: 0.62,
  },
  {
    name: 'giorno',
    lift: [0.0, 0.0, 0.0],
    gain: [1.012, 1.0, 0.992],
    gamma: [1.0, 1.0, 1.0],
    contrast: 1.035,
    saturation: 1.025,
    intensity: 0.42,
  },
  {
    name: 'tramonto',
    lift: [0.016, 0.004, 0.006],
    gain: [1.06, 0.972, 0.922],
    gamma: [1.0, 1.0, 1.0],
    contrast: 1.05,
    saturation: 1.09,
    intensity: 0.7,
  },
  {
    name: 'notte',
    lift: [0.003, 0.007, 0.018],
    gain: [0.965, 0.99, 1.045],
    gamma: [1.0, 1.0, 1.0],
    contrast: 1.02,
    saturation: 0.9,
    intensity: 0.5,
  },
];

/** Orari dei quattro look sul quadrante 24 h (5.5 = alba, 23 = notte). */
const HOUR_KEYS = [5.5, 12, 18.5, 23, 29.5] as const;
const HOUR_LOOKS = [0, 1, 2, 3, 0] as const;

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

function gradeChannel(value: number, look: GradeParams): number {
  return (value - 0.5) * look.contrast + 0.5;
}

/** Grade in spazio display: l'input è già sRGB dopo l'OutputPass. */
function applyGrade(
  r: number,
  g: number,
  b: number,
  look: GradeParams,
): [number, number, number] {
  let red = gradeChannel(r, look);
  let green = gradeChannel(g, look);
  let blue = gradeChannel(b, look);

  const luma = 0.2126 * red + 0.7152 * green + 0.0722 * blue;
  red = luma + (red - luma) * look.saturation;
  green = luma + (green - luma) * look.saturation;
  blue = luma + (blue - luma) * look.saturation;

  const out: [number, number, number] = [red, green, blue];
  for (let i = 0; i < 3; i++) {
    const channel = clamp01(out[i]!);
    const value = Math.pow(channel, 1 / look.gamma[i]!) * look.gain[i]! + look.lift[i]!;
    out[i] = clamp01(value);
  }
  return out;
}

function createAtlas(look: GradeParams): THREE.DataTexture {
  const width = LUT_SIZE * LUT_SIZE;
  const height = LUT_SIZE;
  const data = new Uint8Array(width * height * 4);
  const denominator = LUT_SIZE - 1;

  for (let blue = 0; blue < LUT_SIZE; blue++) {
    for (let green = 0; green < LUT_SIZE; green++) {
      for (let red = 0; red < LUT_SIZE; red++) {
        const [r, g, b] = applyGrade(
          red / denominator,
          green / denominator,
          blue / denominator,
          look,
        );
        const x = blue * LUT_SIZE + red;
        const y = green;
        const index = (y * width + x) * 4;
        data[index] = Math.round(r * 255);
        data[index + 1] = Math.round(g * 255);
        data[index + 2] = Math.round(b * 255);
        data[index + 3] = 255;
      }
    }
  }

  const texture = new THREE.DataTexture(data, width, height, THREE.RGBAFormat);
  texture.name = `grade-${look.name}`;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.generateMipmaps = false;
  texture.flipY = false;
  texture.colorSpace = THREE.NoColorSpace;
  texture.needsUpdate = true;
  return texture;
}

export function createGradeLooks(): GradeLook[] {
  return LOOKS.map((look) => ({
    name: look.name,
    texture: createAtlas(look),
    intensity: look.intensity,
  }));
}

export interface GradeAtHour {
  a: number;
  b: number;
  mix: number;
  intensity: number;
}

/** Look corrente e successivo, con dissolvenza continua fra i quattro momenti. */
export function gradeAtHour(hour: number, looks: readonly GradeLook[]): GradeAtHour {
  let t = ((hour % 24) + 24) % 24;
  if (t < HOUR_KEYS[0]) t += 24;

  let index = 0;
  while (index < HOUR_KEYS.length - 2 && t > HOUR_KEYS[index + 1]!) index++;
  const start = HOUR_KEYS[index]!;
  const end = HOUR_KEYS[index + 1]!;
  const span = Math.max(1e-5, end - start);
  const mix = clamp01((t - start) / span);
  const a = HOUR_LOOKS[index]!;
  const b = HOUR_LOOKS[index + 1]!;
  const intensity = THREE.MathUtils.lerp(looks[a]!.intensity, looks[b]!.intensity, mix);
  return { a, b, mix, intensity };
}

const OUTPUT_VERTEX = /* glsl */ `
  precision highp float;
  uniform mat4 modelViewMatrix;
  uniform mat4 projectionMatrix;
  attribute vec3 position;
  attribute vec2 uv;
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const OUTPUT_FRAGMENT = /* glsl */ `
  precision highp float;

  uniform sampler2D tDiffuse;
  uniform sampler2D lutA;
  uniform sampler2D lutB;
  uniform float uMix;
  uniform float uGrade;
  uniform float lutSize;

  #include <tonemapping_pars_fragment>
  #include <colorspace_pars_fragment>

  varying vec2 vUv;

  vec3 sampleLut(sampler2D lut, vec3 color) {
    float blue = color.b * (lutSize - 1.0);
    float blue0 = floor(blue);
    float blue1 = min(blue0 + 1.0, lutSize - 1.0);
    float blueMix = blue - blue0;
    float width = lutSize * lutSize;
    vec2 uv0 = vec2(
      (blue0 * lutSize + color.r * (lutSize - 1.0) + 0.5) / width,
      (color.g * (lutSize - 1.0) + 0.5) / lutSize
    );
    vec2 uv1 = vec2(
      (blue1 * lutSize + color.r * (lutSize - 1.0) + 0.5) / width,
      (color.g * (lutSize - 1.0) + 0.5) / lutSize
    );
    return mix(texture2D(lut, uv0).rgb, texture2D(lut, uv1).rgb, blueMix);
  }

  void main() {
    gl_FragColor = texture2D(tDiffuse, vUv);

    #ifdef LINEAR_TONE_MAPPING
      gl_FragColor.rgb = LinearToneMapping(gl_FragColor.rgb);
    #elif defined(REINHARD_TONE_MAPPING)
      gl_FragColor.rgb = ReinhardToneMapping(gl_FragColor.rgb);
    #elif defined(CINEON_TONE_MAPPING)
      gl_FragColor.rgb = CineonToneMapping(gl_FragColor.rgb);
    #elif defined(ACES_FILMIC_TONE_MAPPING)
      gl_FragColor.rgb = ACESFilmicToneMapping(gl_FragColor.rgb);
    #elif defined(AGX_TONE_MAPPING)
      gl_FragColor.rgb = AgXToneMapping(gl_FragColor.rgb);
    #elif defined(NEUTRAL_TONE_MAPPING)
      gl_FragColor.rgb = NeutralToneMapping(gl_FragColor.rgb);
    #elif defined(CUSTOM_TONE_MAPPING)
      gl_FragColor.rgb = CustomToneMapping(gl_FragColor.rgb);
    #endif

    #ifdef SRGB_TRANSFER
      gl_FragColor = sRGBTransferOETF(gl_FragColor);
    #endif

    vec3 gradedA = sampleLut(lutA, gl_FragColor.rgb);
    vec3 gradedB = sampleLut(lutB, gl_FragColor.rgb);
    vec3 graded = mix(gradedA, gradedB, uMix);
    gl_FragColor.rgb = mix(gl_FragColor.rgb, graded, clamp(uGrade, 0.0, 1.0));
  }
`;

/**
 * Sostituto dell'OutputPass: fa tone mapping + sRGB e poi applica due LUT con
 * dissolvenza. Se `uGrade` è 0 il risultato è identico all'OutputPass.
 */
export class OutputGradePass extends Pass {
  readonly isOutputPass = true;
  readonly uniforms: Record<string, THREE.IUniform>;
  readonly material: THREE.RawShaderMaterial;
  private readonly looks: GradeLook[];
  private readonly fsQuad: FullScreenQuad;
  private outputColorSpace: string | null = null;
  private toneMapping: THREE.ToneMapping | null = null;
  private gradeScale = 1;
  private lookIntensity = 1;

  constructor(looks?: GradeLook[]) {
    super();
    this.looks = looks ?? createGradeLooks();
    this.uniforms = {
      tDiffuse: { value: null },
      toneMappingExposure: { value: 1 },
      lutA: { value: this.looks[0]!.texture },
      lutB: { value: this.looks[1]!.texture },
      uMix: { value: 0 },
      uGrade: { value: 1 },
      lutSize: { value: LUT_SIZE },
    };
    this.material = new THREE.RawShaderMaterial({
      name: 'OutputGradeShader',
      uniforms: this.uniforms,
      vertexShader: OUTPUT_VERTEX,
      fragmentShader: OUTPUT_FRAGMENT,
    });
    this.fsQuad = new FullScreenQuad(this.material);
  }

  setGradeAtHour(hour: number): void {
    const grade = gradeAtHour(hour, this.looks);
    this.uniforms.lutA!.value = this.looks[grade.a]!.texture;
    this.uniforms.lutB!.value = this.looks[grade.b]!.texture;
    this.uniforms.uMix!.value = grade.mix;
    this.lookIntensity = grade.intensity;
    this.applyGradeUniform();
  }

  setGrade(intensity: number): void {
    this.gradeScale = Math.min(1, Math.max(0, intensity));
    this.applyGradeUniform();
  }

  /** Il preset scala l'intensità del look; 0.62 è il riferimento di high. */
  private applyGradeUniform(): void {
    this.uniforms.uGrade!.value = clamp01(this.gradeScale * (this.lookIntensity / 0.62));
  }

  render(
    renderer: THREE.WebGLRenderer,
    writeBuffer: THREE.WebGLRenderTarget,
    readBuffer: THREE.WebGLRenderTarget,
  ): void {
    this.uniforms.tDiffuse!.value = readBuffer.texture;
    this.uniforms.toneMappingExposure!.value = renderer.toneMappingExposure;

    if (this.outputColorSpace !== renderer.outputColorSpace || this.toneMapping !== renderer.toneMapping) {
      this.outputColorSpace = renderer.outputColorSpace;
      this.toneMapping = renderer.toneMapping;
      this.material.defines = {};

      if (THREE.ColorManagement.getTransfer(this.outputColorSpace!) === THREE.SRGBTransfer) {
        this.material.defines.SRGB_TRANSFER = '';
      }
      if (this.toneMapping === THREE.LinearToneMapping) this.material.defines.LINEAR_TONE_MAPPING = '';
      else if (this.toneMapping === THREE.ReinhardToneMapping) this.material.defines.REINHARD_TONE_MAPPING = '';
      else if (this.toneMapping === THREE.CineonToneMapping) this.material.defines.CINEON_TONE_MAPPING = '';
      else if (this.toneMapping === THREE.ACESFilmicToneMapping) this.material.defines.ACES_FILMIC_TONE_MAPPING = '';
      else if (this.toneMapping === THREE.AgXToneMapping) this.material.defines.AGX_TONE_MAPPING = '';
      else if (this.toneMapping === THREE.NeutralToneMapping) this.material.defines.NEUTRAL_TONE_MAPPING = '';
      else if (this.toneMapping === THREE.CustomToneMapping) this.material.defines.CUSTOM_TONE_MAPPING = '';

      this.material.needsUpdate = true;
    }

    if (this.renderToScreen) {
      renderer.setRenderTarget(null);
      this.fsQuad.render(renderer);
    } else {
      renderer.setRenderTarget(writeBuffer);
      if (this.clear) renderer.clear(renderer.autoClearColor, renderer.autoClearDepth, renderer.autoClearStencil);
      this.fsQuad.render(renderer);
    }
  }

  dispose(): void {
    this.material.dispose();
    for (const look of this.looks) look.texture.dispose();
  }
}

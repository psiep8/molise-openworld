import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { SSAOPass } from 'three/addons/postprocessing/SSAOPass.js';
import { TemporalAAPass } from './taa';
import { OutputGradePass } from './grade';

export interface PostOptions {
  /** intensità del bloom (0 = spento) */
  bloom?: number;
  /** occlusione ambientale */
  ssao?: boolean;
  /**
   * Campioni MSAA dei render target del composer (0, 2, 4). Con TAA attivo
   * resta 0: il temporal AA sostituisce l'MSAA e costa già un render in più.
   */
  samples?: number;
  /** nitidezza (unsharp) dopo l'antialiasing, 0…1 */
  sharpen?: number;
  /** TAA (solo high/ultra; fallback su MSAA+SMAA se non disponibile) */
  taa?: boolean;
  /** intensità della LUT (0 = spenta) */
  grade?: number;
}

/**
 * Nitidezza leggera dopo l'antialiasing.
 *
 * MSAA e SMAA ammorbidiscono i bordi, ma con il resolution scaling attivo la
 * scena può sembrare sfocata. Un unsharp mask di pochi decimi di pixel
 * restituisce il dettaglio senza rimettere gli scalini, perché lavora dopo
 * l'antialiasing e su un'immagine già filtrata.
 */
const SharpenShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uAmount: { value: 0.25 },
    uTexel: { value: new THREE.Vector2(1 / 1920, 1 / 1080) },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uAmount;
    uniform vec2 uTexel;
    varying vec2 vUv;

    void main() {
      vec4 centre = texture2D(tDiffuse, vUv);
      vec3 blur = texture2D(tDiffuse, vUv + vec2(uTexel.x, 0.0)).rgb
                + texture2D(tDiffuse, vUv - vec2(uTexel.x, 0.0)).rgb
                + texture2D(tDiffuse, vUv + vec2(0.0, uTexel.y)).rgb
                + texture2D(tDiffuse, vUv - vec2(0.0, uTexel.y)).rgb;
      blur *= 0.25;
      vec3 sharp = centre.rgb + (centre.rgb - blur) * uAmount;
      gl_FragColor = vec4(clamp(sharp, 0.0, 1.0), centre.a);
    }
  `,
};

/**
 * Pipeline di post-processing pensata per un look "da videogioco":
 * TAA (high/ultra) o MSAA+SMAA, bloom morbido, SSAO, unsharp e
 * OutputGradePass (tone mapping + sRGB + LUT).
 *
 * I pass costosi si accendono solo dove il preset lo dice: su un PC debole la
 * pipeline può esistere solo per l'antialiasing, senza bloom né SSAO.
 */
export class PostPipeline {
  private readonly composer: EffectComposer;
  private readonly bloom: UnrealBloomPass | null;
  private readonly ssao: SSAOPass | null;
  private readonly smaa: SMAAPass | null;
  private readonly taa: TemporalAAPass | null;
  private readonly output: OutputPass | OutputGradePass;
  private readonly sharpen: ShaderPass;
  private enabled = true;
  private ssaoEnabled = false;
  /** intensità corrente del bloom (0 = spento), utile alla diagnostica */
  bloomStrength = 0;
  private sharpenAmount: number;

  constructor(
    private readonly renderer: THREE.WebGLRenderer,
    private readonly scene: THREE.Scene,
    private readonly camera: THREE.PerspectiveCamera,
    bloomStrength = 0.06,
    options: PostOptions = {},
  ) {
    this.composer = new EffectComposer(renderer);
    this.bloomStrength = bloomStrength;
    this.sharpenAmount = options.sharpen ?? 0.25;

    // TAA: se il contesto non è WebGL2 o il pass non si costruisce, si torna
    // al RenderPass classico senza rompere la partita.
    let taa: TemporalAAPass | null = null;
    if (options.taa === true && renderer.capabilities.isWebGL2) {
      try {
        taa = new TemporalAAPass(scene, camera);
        this.composer.addPass(taa);
      } catch (error) {
        console.warn('TAA non disponibile: fallback su RenderPass', error);
        taa = null;
      }
    }
    this.taa = taa;
    if (!taa) this.composer.addPass(new RenderPass(scene, camera));

    // MSAA sui target: è l'unico modo per avere antialiasing vero quando si
    // disegna dentro il composer. Con TAA non serve e costa banda.
    const maxSamples = taa
      ? 0
      : Math.min(
          options.samples ?? 0,
          (renderer.getContext() as WebGL2RenderingContext).getParameter?.(
            (renderer.getContext() as WebGL2RenderingContext).MAX_SAMPLES,
          ) ?? 4,
        );
    if (maxSamples > 0) {
      this.composer.renderTarget1.samples = maxSamples;
      this.composer.renderTarget2.samples = maxSamples;
    }

    if (bloomStrength > 0) {
      // soglia alta: il cielo e il sole restano fuori dal bloom, che serve solo
      // ai riflessi davvero speculari. A 3,2 il disco solare allargava un alone
      // bianco su tutto l'orizzonte (il "non si vede più nulla" in controsole).
      this.bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), bloomStrength, 0.2, 4.2);
      this.composer.addPass(this.bloom);
    } else {
      this.bloom = null;
    }

    if (options.ssao) {
      this.ssao = new SSAOPass(scene, camera, 1024, 1024, 16);
      this.ssao.kernelRadius = 0.6;
      this.ssao.minDistance = 0.002;
      this.ssao.maxDistance = 0.08;
      this.ssao.enabled = false;
      this.composer.addPass(this.ssao);
    } else {
      this.ssao = null;
    }

    // Con TAA l'antialiasing è già temporale: SMAA sarebbe un pass in più.
    if (taa) {
      this.smaa = null;
    } else {
      this.smaa = new SMAAPass();
      this.composer.addPass(this.smaa);
    }

    this.sharpen = new ShaderPass(SharpenShader);
    this.sharpen.uniforms.uAmount!.value = this.sharpenAmount;
    this.sharpen.enabled = this.sharpenAmount > 0;
    this.composer.addPass(this.sharpen);

    let output: OutputPass | OutputGradePass;
    if ((options.grade ?? 0) > 0) {
      try {
        const grade = new OutputGradePass();
        grade.setGrade(options.grade ?? 0);
        output = grade;
      } catch (error) {
        console.warn('LUT non disponibile: fallback su OutputPass', error);
        output = new OutputPass();
      }
    } else {
      output = new OutputPass();
    }
    this.output = output;
    this.composer.addPass(output);
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  /** Attiva/disattiva l'occlusione ambientale (preset alti). */
  setSSAO(enabled: boolean): void {
    this.ssaoEnabled = enabled && this.ssao !== null;
    if (this.ssao) this.ssao.enabled = this.ssaoEnabled;
  }

  get isSSAOEnabled(): boolean {
    return this.ssaoEnabled;
  }

  /** true se la pipeline contiene il pass SSAO (dipende dal preset di creazione). */
  get hasSSAO(): boolean {
    return this.ssao !== null;
  }

  /** true se il TAA è attivo (o richiesto e costruito). */
  get hasTAA(): boolean {
    return this.taa !== null;
  }

  get hasGrade(): boolean {
    return this.output instanceof OutputGradePass;
  }

  /** Intensità della LUT; 0 spegne il grade (fallback). */
  setGrade(intensity: number): void {
    if (this.output instanceof OutputGradePass) this.output.setGrade(intensity);
  }

  /** Sceglie i due look vicini all'ora corrente e la dissolvenza. */
  setGradeAtHour(hour: number): void {
    if (this.output instanceof OutputGradePass) this.output.setGradeAtHour(hour);
  }

  /** Libera i render target: serve quando si ricostruisce la pipeline. */
  dispose(): void {
    this.composer.dispose();
    this.bloom?.dispose();
    this.ssao?.dispose();
    this.smaa?.dispose();
    this.taa?.dispose();
    this.output.dispose();
  }

  setBloom(strength: number): void {
    this.bloomStrength = strength;
    if (this.bloom) {
      this.bloom.strength = strength;
      this.bloom.enabled = strength > 0;
    }
  }

  setSharpen(amount: number): void {
    this.sharpenAmount = amount;
    this.sharpen.uniforms.uAmount!.value = amount;
    this.sharpen.enabled = amount > 0;
  }

  setPixelRatio(ratio: number): void {
    this.composer.setPixelRatio(ratio);
    const size = this.renderer.getSize(new THREE.Vector2());
    this.sharpen.uniforms.uTexel!.value.set(
      1 / Math.max(1, size.x * ratio),
      1 / Math.max(1, size.y * ratio),
    );
  }

  setSize(width: number, height: number): void {
    this.composer.setSize(width, height);
    const pr = this.renderer.getPixelRatio();
    this.sharpen.uniforms.uTexel!.value.set(
      1 / Math.max(1, width * pr),
      1 / Math.max(1, height * pr),
    );
    const ssao = this.ssao;
    if (ssao) {
      ssao.width = Math.max(1, Math.floor(width * pr));
      ssao.height = Math.max(1, Math.floor(height * pr));
      ssao.setSize(ssao.width, ssao.height);
    }
  }

  render(delta = 0): void {
    if (this.enabled) this.composer.render(delta);
    else this.renderer.render(this.scene, this.camera);
  }
}

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { SSAOPass } from 'three/addons/postprocessing/SSAOPass.js';

/**
 * Pipeline di post-processing pensata per un look "da videogioco":
 * bloom morbido su cielo e superfici illuminate, SSAO per l'occlusione
 * ambientale (attivo solo sui preset alti), SMAA e OutputPass per
 * tone mapping / color space corretti.
 *
 * Tutto è opzionale: sui PC più deboli il gioco renderizza diretto.
 */
export class PostPipeline {
  private readonly composer: EffectComposer;
  private readonly bloom: UnrealBloomPass;
  private readonly ssao: SSAOPass;
  private enabled = true;
  private ssaoEnabled = false;

  constructor(
    private readonly renderer: THREE.WebGLRenderer,
    private readonly scene: THREE.Scene,
    private readonly camera: THREE.PerspectiveCamera,
    bloomStrength = 0.14,
  ) {
    this.composer = new EffectComposer(renderer);
    this.composer.addPass(new RenderPass(scene, camera));
    // threshold alto: il bloom deve accendersi solo sui riflessi del sole, non
    // sul cielo (con soglia 1.0 il cielo intero diventava un velo bianco)
    this.bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), bloomStrength, 0.28, 2.2);
    this.composer.addPass(this.bloom);

    // SSAO: raggio in metri, distanze normalizzate; pochi campioni per restare leggero
    this.ssao = new SSAOPass(scene, camera, 1024, 1024, 16);
    this.ssao.kernelRadius = 0.6;
    this.ssao.minDistance = 0.002;
    this.ssao.maxDistance = 0.08;
    this.ssao.enabled = false;
    this.composer.addPass(this.ssao);

    this.composer.addPass(new SMAAPass());
    this.composer.addPass(new OutputPass());
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  /** Attiva/disattiva l'occlusione ambientale (preset alti). */
  setSSAO(enabled: boolean): void {
    this.ssaoEnabled = enabled;
    this.ssao.enabled = enabled;
  }

  get isSSAOEnabled(): boolean {
    return this.ssaoEnabled;
  }

  setBloom(strength: number): void {
    this.bloom.strength = strength;
  }

  setPixelRatio(ratio: number): void {
    this.composer.setPixelRatio(ratio);
  }

  setSize(width: number, height: number): void {
    // EffectComposer applica già il pixel ratio a tutte le pass, bloom compreso.
    this.composer.setSize(width, height);
    // i render target dell'SSAO sono in pixel reali
    const pr = this.renderer.getPixelRatio();
    this.ssao.width = Math.max(1, Math.floor(width * pr));
    this.ssao.height = Math.max(1, Math.floor(height * pr));
    this.ssao.setSize(this.ssao.width, this.ssao.height);
  }

  render(delta = 0): void {
    if (this.enabled) this.composer.render(delta);
    else this.renderer.render(this.scene, this.camera);
  }
}

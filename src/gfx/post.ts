import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

/**
 * Pipeline di post-processing pensata per un look "da videogioco":
 * bloom morbido su cielo e superfici illuminate, antialiasing SMAA e
 * OutputPass per tone mapping / color space corretti.
 *
 * Tutto è opzionale: sui PC più deboli il gioco renderizza diretto.
 */
export class PostPipeline {
  private readonly composer: EffectComposer;
  private readonly bloom: UnrealBloomPass;
  private enabled = true;

  constructor(
    private readonly renderer: THREE.WebGLRenderer,
    private readonly scene: THREE.Scene,
    private readonly camera: THREE.PerspectiveCamera,
    bloomStrength = 0.22,
  ) {
    this.composer = new EffectComposer(renderer);
    this.composer.addPass(new RenderPass(scene, camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), bloomStrength, 0.55, 0.82);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new SMAAPass());
    this.composer.addPass(new OutputPass());
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  setBloom(strength: number): void {
    this.bloom.strength = strength;
  }

  setPixelRatio(ratio: number): void {
    this.composer.setPixelRatio(ratio);
  }

  setSize(width: number, height: number): void {
    this.composer.setSize(width, height);
    this.bloom.setSize(width, height);
  }

  render(delta = 0): void {
    if (this.enabled) this.composer.render(delta);
    else this.renderer.render(this.scene, this.camera);
  }
}

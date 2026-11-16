import * as THREE from 'three';
import { FullScreenQuad, Pass } from 'three/addons/postprocessing/Pass.js';

/**
 * TAA leggero per il gioco.
 *
 * A differenza del `TAARenderPass` di three.js (accumulo di 32 campioni solo a
 * camera ferma, senza reproiezione), qui ogni frame:
 *  1. disegna la scena in un target HDR con la proiezione jitterata di mezzo pixel;
 *  2. ricostruisce la posizione mondo dal depth;
 *  3. riproietta il frame precedente con la view-projection precedente;
 *  4. limita la storia al vicinato 3×3 per non lasciare scie sugli oggetti mobili.
 *
 * Il costo è un render della scena in più ogni frame, quindi il pass si accende
 * solo nei preset high/ultra e si spegne con il fallback `?ab=taa:0`.
 */
const JITTER: ReadonlyArray<readonly [number, number]> = [
  [0.5, 0.5],
  [-0.5, 0.5],
  [0.5, -0.5],
  [-0.5, -0.5],
  [0.25, -0.75],
  [-0.75, 0.25],
  [0.75, -0.25],
  [-0.25, 0.75],
];

const VERTEX_SHADER = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const TAA_FRAGMENT = /* glsl */ `
  uniform sampler2D tScene;
  uniform sampler2D tDepth;
  uniform sampler2D tHistory;
  uniform mat4 uInverseProjection;
  uniform mat4 uCameraWorld;
  uniform mat4 uPrevViewProjection;
  uniform vec2 uTexel;
  uniform float uHistoryWeight;
  uniform float uHasHistory;
  varying vec2 vUv;

  void main() {
    vec4 current = texture2D(tScene, vUv);
    if (uHasHistory < 0.5) {
      gl_FragColor = current;
      return;
    }

    // Depth [0,1] -> posizione vista -> mondo.
    float depth = texture2D(tDepth, vUv).x;
    vec4 clip = vec4(vUv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
    vec4 view = uInverseProjection * clip;
    view /= max(view.w, 1e-6);
    vec4 world = uCameraWorld * view;

    // Mondo -> clip del frame precedente.
    vec4 previous = uPrevViewProjection * world;
    vec2 previousUv = previous.xy / max(previous.w, 1e-6) * 0.5 + 0.5;
    bool valid = previous.w > 0.0 && depth < 0.99999 &&
      previousUv.x >= 0.0 && previousUv.x <= 1.0 &&
      previousUv.y >= 0.0 && previousUv.y <= 1.0;

    // Clamp al vicinato: elimina la scia di auto/pedoni in movimento.
    vec3 lo = current.rgb;
    vec3 hi = current.rgb;
    for (int y = -1; y <= 1; y++) {
      for (int x = -1; x <= 1; x++) {
        vec3 c = texture2D(tScene, vUv + vec2(float(x), float(y)) * uTexel).rgb;
        lo = min(lo, c);
        hi = max(hi, c);
      }
    }
    vec3 history = clamp(texture2D(tHistory, previousUv).rgb, lo, hi);
    float weight = valid ? uHistoryWeight : 0.0;
    gl_FragColor = vec4(mix(current.rgb, history, weight), current.a);
  }
`;

const COPY_FRAGMENT = /* glsl */ `
  uniform sampler2D tDiffuse;
  varying vec2 vUv;
  void main() {
    gl_FragColor = texture2D(tDiffuse, vUv);
  }
`;

export class TemporalAAPass extends Pass {
  private sceneTarget: THREE.WebGLRenderTarget | null = null;
  private historyTarget: THREE.WebGLRenderTarget | null = null;
  private width = 0;
  private height = 0;
  private frame = 0;
  private hasHistory = false;
  private readonly previousViewProjection = new THREE.Matrix4();
  private readonly currentViewProjection = new THREE.Matrix4();
  private readonly previousCameraPosition = new THREE.Vector3();

  private readonly taaMaterial = new THREE.ShaderMaterial({
    uniforms: {
      tScene: { value: null },
      tDepth: { value: null },
      tHistory: { value: null },
      uInverseProjection: { value: new THREE.Matrix4() },
      uCameraWorld: { value: new THREE.Matrix4() },
      uPrevViewProjection: { value: new THREE.Matrix4() },
      uTexel: { value: new THREE.Vector2(1 / 1280, 1 / 720) },
      uHistoryWeight: { value: 0.86 },
      uHasHistory: { value: 0 },
    },
    vertexShader: VERTEX_SHADER,
    fragmentShader: TAA_FRAGMENT,
    depthTest: false,
    depthWrite: false,
  });

  private readonly copyMaterial = new THREE.ShaderMaterial({
    uniforms: {
      tDiffuse: { value: null },
    },
    vertexShader: VERTEX_SHADER,
    fragmentShader: COPY_FRAGMENT,
    depthTest: false,
    depthWrite: false,
  });

  private readonly taaQuad = new FullScreenQuad(this.taaMaterial);
  private readonly copyQuad = new FullScreenQuad(this.copyMaterial);

  constructor(
    private readonly scene: THREE.Scene,
    private readonly camera: THREE.PerspectiveCamera,
  ) {
    super();
    this.needsSwap = true;
  }

  /** Da chiamare dopo un teletrasporto o un cambio di preset. */
  reset(): void {
    this.hasHistory = false;
  }

  setSize(): void {
    // Il composer chiama setSize solo al resize: i target si ricreano al volo
    // nel primo render con le dimensioni effettive di readBuffer.
    this.disposeTargets();
    this.width = 0;
    this.height = 0;
  }

  render(
    renderer: THREE.WebGLRenderer,
    writeBuffer: THREE.WebGLRenderTarget,
    readBuffer: THREE.WebGLRenderTarget,
  ): void {
    const width = Math.max(1, readBuffer.width);
    const height = Math.max(1, readBuffer.height);
    this.ensureTargets(width, height);
    const sceneTarget = this.sceneTarget;
    const historyTarget = this.historyTarget;
    if (!sceneTarget || !historyTarget) return;

    const jitter = JITTER[this.frame++ % JITTER.length] ?? [0, 0];
    this.camera.setViewOffset(width, height, jitter[0], jitter[1], width, height);

    renderer.setRenderTarget(sceneTarget);
    renderer.clear();
    renderer.render(this.scene, this.camera);

    const historyValid =
      this.hasHistory && this.camera.position.distanceTo(this.previousCameraPosition) < 4;
    this.currentViewProjection.multiplyMatrices(
      this.camera.projectionMatrix,
      this.camera.matrixWorldInverse,
    );

    const uniforms = this.taaMaterial.uniforms;
    uniforms.tScene.value = sceneTarget.texture;
    uniforms.tDepth.value = sceneTarget.depthTexture;
    uniforms.tHistory.value = historyTarget.texture;
    uniforms.uInverseProjection.value.copy(this.camera.projectionMatrixInverse);
    uniforms.uCameraWorld.value.copy(this.camera.matrixWorld);
    uniforms.uPrevViewProjection.value.copy(this.previousViewProjection);
    uniforms.uTexel.value.set(1 / width, 1 / height);
    uniforms.uHistoryWeight.value = 0.86;
    uniforms.uHasHistory.value = historyValid ? 1 : 0;

    this.camera.clearViewOffset();

    renderer.setRenderTarget(writeBuffer);
    this.taaQuad.render(renderer);

    // Storia del frame corrente: il prossimo frame ci si riproietta sopra.
    this.copyMaterial.uniforms.tDiffuse.value = writeBuffer.texture;
    renderer.setRenderTarget(historyTarget);
    this.copyQuad.render(renderer);

    this.previousViewProjection.copy(this.currentViewProjection);
    this.previousCameraPosition.copy(this.camera.position);
    this.hasHistory = true;
  }

  private ensureTargets(width: number, height: number): void {
    if (this.sceneTarget && this.width === width && this.height === height) return;
    this.disposeTargets();

    const common = {
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      stencilBuffer: false,
    };
    const sceneTarget = new THREE.WebGLRenderTarget(width, height, {
      ...common,
      depthBuffer: true,
    });
    sceneTarget.texture.name = 'TAA.scene';
    const depth = new THREE.DepthTexture(width, height);
    depth.format = THREE.DepthFormat;
    depth.type = THREE.UnsignedIntType;
    depth.minFilter = THREE.NearestFilter;
    depth.magFilter = THREE.NearestFilter;
    sceneTarget.depthTexture = depth;

    this.sceneTarget = sceneTarget;
    this.historyTarget = new THREE.WebGLRenderTarget(width, height, {
      ...common,
      depthBuffer: false,
    });
    this.height = height;
    this.width = width;
    this.hasHistory = false;
  }

  private disposeTargets(): void {
    this.sceneTarget?.dispose();
    this.historyTarget?.dispose();
    this.sceneTarget = null;
    this.historyTarget = null;
  }

  dispose(): void {
    this.disposeTargets();
    this.taaMaterial.dispose();
    this.copyMaterial.dispose();
  }
}

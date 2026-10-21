import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';

export interface SkyParams {
  turbidity: number;
  rayleigh: number;
  mieCoefficient: number;
  mieDirectionalG: number;
}

export interface LightingParams {
  sunColor: number;
  sunIntensity: number;
  hemiSky: number;
  hemiGround: number;
  hemiIntensity: number;
  ambientIntensity: number;
  /** luce lunare di riempimento, per non avere notti completamente nere */
  moonIntensity: number;
}

export interface SkyRig {
  sunLight: THREE.DirectionalLight;
  sunDirection: THREE.Vector3;
  /** La cupola va tenuta centrata sulla camera, altrimenti si esce dal box. */
  dome: THREE.Mesh;
  update(target: THREE.Vector3): void;
  setShadowMapSize(size: number): void;
  /** elevation in gradi sopra l'orizzonte, theta nel sistema Three.js (0 = sud, 90 = est). */
  setSun(elevationDeg: number, thetaDeg: number): void;
  setSkyParams(params: Partial<SkyParams>): void;
  setLighting(params: Partial<LightingParams>): void;
  /** Genera la luce ambientale riflessa dal cielo (IBL). Costa poco: si auto-limita. */
  updateEnvironment(renderer: THREE.WebGLRenderer, scene: THREE.Scene): void;
}

/** Pomeriggio molisano di default: sole non troppo basso, luce calda, ombre leggibili. */
export const DEFAULT_SUN = { elevation: 27, theta: 238 } as const;
export const DEFAULT_SKY: SkyParams = {
  turbidity: 5,
  rayleigh: 1.6,
  mieCoefficient: 0.004,
  mieDirectionalG: 0.82,
};
export const DEFAULT_LIGHTING: LightingParams = {
  sunColor: 0xffeed2,
  sunIntensity: 2.9,
  hemiSky: 0xa8c8ee,
  hemiGround: 0x63583f,
  hemiIntensity: 0.52,
  ambientIntensity: 0.14,
  moonIntensity: 0,
};

export function createSky(scene: THREE.Scene): SkyRig {
  const sky = new Sky();
  sky.scale.setScalar(7000);
  sky.frustumCulled = false;
  const material = sky.material as THREE.ShaderMaterial;
  const uniforms = material.uniforms;
  uniforms.turbidity.value = DEFAULT_SKY.turbidity;
  uniforms.rayleigh.value = DEFAULT_SKY.rayleigh;
  uniforms.mieCoefficient.value = DEFAULT_SKY.mieCoefficient;
  uniforms.mieDirectionalG.value = DEFAULT_SKY.mieDirectionalG;

  const sunDirection = new THREE.Vector3();
  const setSun = (elevationDeg: number, thetaDeg: number): void => {
    sunDirection.setFromSphericalCoords(
      1,
      THREE.MathUtils.degToRad(90 - elevationDeg),
      THREE.MathUtils.degToRad(thetaDeg),
    );
    uniforms.sunPosition.value.copy(sunDirection);
  };
  setSun(DEFAULT_SUN.elevation, DEFAULT_SUN.theta);
  scene.add(sky);

  // Seconda cupola, usata solo per fotografare il cielo in una cubemap PMREM.
  const envScene = new THREE.Scene();
  const envSky = new Sky();
  envSky.scale.setScalar(90); // deve stare dentro il far (100) di PMREMGenerator
  envSky.frustumCulled = false;
  envScene.add(envSky);
  let pmrem: THREE.PMREMGenerator | null = null;
  let envTarget: THREE.WebGLRenderTarget | null = null;
  const lastEnvSun = new THREE.Vector3(0, -1, 0);
  let lastEnvTime = -Infinity;

  const sunLight = new THREE.DirectionalLight(DEFAULT_LIGHTING.sunColor, DEFAULT_LIGHTING.sunIntensity);
  sunLight.castShadow = true;
  sunLight.shadow.mapSize.set(2048, 2048);
  sunLight.shadow.camera.left = -170;
  sunLight.shadow.camera.right = 170;
  sunLight.shadow.camera.top = 170;
  sunLight.shadow.camera.bottom = -170;
  sunLight.shadow.camera.near = 1;
  sunLight.shadow.camera.far = 1600;
  sunLight.shadow.bias = -0.0002;
  // 0,05 m: un normal bias grande (0,9) faceva sparire le ombre di contatto
  sunLight.shadow.normalBias = 0.05;
  scene.add(sunLight);
  scene.add(sunLight.target);

  const hemi = new THREE.HemisphereLight(DEFAULT_LIGHTING.hemiSky, DEFAULT_LIGHTING.hemiGround, DEFAULT_LIGHTING.hemiIntensity);
  scene.add(hemi);
  const ambient = new THREE.AmbientLight(0xffffff, DEFAULT_LIGHTING.ambientIntensity);
  scene.add(ambient);

  const moonLight = new THREE.DirectionalLight(0x93add2, 0);
  moonLight.castShadow = false;
  scene.add(moonLight);
  scene.add(moonLight.target);

  const update = (target: THREE.Vector3): void => {
    sunLight.target.position.copy(target);
    sunLight.position.copy(target).addScaledVector(sunDirection, 800);
    sunLight.target.updateMatrixWorld();
    sunLight.updateMatrixWorld();

    // la luna sta dalla parte opposta al sole
    moonLight.target.position.copy(target);
    moonLight.position.copy(target).addScaledVector(sunDirection, -800);
    moonLight.target.updateMatrixWorld();
    moonLight.updateMatrixWorld();
  };

  const setShadowMapSize = (size: number): void => {
    sunLight.shadow.mapSize.set(size, size);
    sunLight.shadow.map?.dispose();
    sunLight.shadow.map = null;
  };

  const setSkyParams = (params: Partial<SkyParams>): void => {
    if (params.turbidity !== undefined) uniforms.turbidity.value = params.turbidity;
    if (params.rayleigh !== undefined) uniforms.rayleigh.value = params.rayleigh;
    if (params.mieCoefficient !== undefined) uniforms.mieCoefficient.value = params.mieCoefficient;
    if (params.mieDirectionalG !== undefined) uniforms.mieDirectionalG.value = params.mieDirectionalG;
  };

  const setLighting = (params: Partial<LightingParams>): void => {
    if (params.sunColor !== undefined) sunLight.color.setHex(params.sunColor);
    if (params.sunIntensity !== undefined) sunLight.intensity = params.sunIntensity;
    if (params.hemiSky !== undefined) hemi.color.setHex(params.hemiSky);
    if (params.hemiGround !== undefined) hemi.groundColor.setHex(params.hemiGround);
    if (params.hemiIntensity !== undefined) hemi.intensity = params.hemiIntensity;
    if (params.ambientIntensity !== undefined) ambient.intensity = params.ambientIntensity;
    if (params.moonIntensity !== undefined) moonLight.intensity = params.moonIntensity;
  };

  const updateEnvironment = (renderer: THREE.WebGLRenderer, scene: THREE.Scene): void => {
    const now = performance.now();
    const sunMoved = sunDirection.dot(lastEnvSun) < 0.9995;
    // al massimo una volta al secondo, e solo se il sole si è mosso davvero
    if (envTarget && (!sunMoved || now - lastEnvTime < 1000)) return;
    lastEnvTime = now;
    lastEnvSun.copy(sunDirection);

    const src = (sky.material as THREE.ShaderMaterial).uniforms;
    const dst = (envSky.material as THREE.ShaderMaterial).uniforms;
    dst.turbidity.value = src.turbidity.value;
    dst.rayleigh.value = src.rayleigh.value;
    dst.mieCoefficient.value = src.mieCoefficient.value;
    dst.mieDirectionalG.value = src.mieDirectionalG.value;
    dst.sunPosition.value.copy(sunDirection);

    pmrem ??= new THREE.PMREMGenerator(renderer);
    envTarget?.dispose();
    envTarget = pmrem.fromScene(envScene);
    scene.environment = envTarget.texture;
    // di notte il cielo non deve illuminare: l'intensità segue l'altezza del sole
    const day = THREE.MathUtils.clamp((sunDirection.y + 0.05) / 0.4, 0, 1);
    // è questa la luce ambientale principale: emisferica e ambiente restano solo
    // un riempimento piccolo (vedi restoreDefaultAtmosphere) per non sommare due volte
    scene.environmentIntensity = 0.08 + 0.22 * day;
  };

  return {
    sunLight,
    sunDirection,
    dome: sky,
    update,
    setShadowMapSize,
    setSun,
    setSkyParams,
    setLighting,
    updateEnvironment,
  };
}

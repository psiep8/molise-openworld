import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { mulberry32 } from '../geo/geo';

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
  /** Accende/spegne la passata d'ombra del sole (degradazione automatica). */
  setShadows(enabled: boolean): void;
  /** elevation in gradi sopra l'orizzonte, theta nel sistema Three.js (0 = sud, 90 = est). */
  setSun(elevationDeg: number, thetaDeg: number): void;
  setSkyParams(params: Partial<SkyParams>): void;
  setLighting(params: Partial<LightingParams>): void;
  /** 0 = giorno, 1 = notte piena: accende stelle e luna. */
  setNightSky(amount: number): void;
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
  sunIntensity: 1.8,
  hemiSky: 0xa8c8ee,
  hemiGround: 0x63583f,
  hemiIntensity: 0.7,
  ambientIntensity: 0.18,
  moonIntensity: 0,
};

/**
 * Radianza della cupola. Lo shader Preetham lavora in unità radiometriche:
 * con l'esposizione tarata sul terreno il cielo finiva fuori scala e diventava
 * un muro bianco (la "troppa luce" del Molise). Si scala la sola cupola, così
 * il cielo resta un gradiente blu leggibile senza bruciare l'orizzonte.
 */
const SKY_RADIANCE = 0.42;

/**
 * Scala la radianza di una cupola Sky, anche quella usata per la cubemap PMREM.
 *
 * Toglie anche il disco solare analitico dello shader: era un puntino bianco
 * con un anello scuro, perché il gradiente di Preetham non sa disegnare un
 * disco di 0,5° a questa esposizione. Il sole vero è uno sprite con alone
 * (vedi `sunSprite`), morbido e con la dimensione angolare giusta.
 */
function dimSky(target: Sky): void {
  const material = target.material as THREE.ShaderMaterial;
  material.uniforms.skyRadiance = { value: SKY_RADIANCE };
  material.fragmentShader =
    'uniform float skyRadiance;\n' +
    material.fragmentShader
      .replace(
        'gl_FragColor = vec4( texColor, 1.0 );',
        'texColor *= skyRadiance;\n\t\t\tgl_FragColor = vec4( texColor, 1.0 );',
      )
      .replace(
        'vec3 sundiscColor = ( 760.0 * sundisc ) * min( vSunE * Fex, 80.0 );',
        'vec3 sundiscColor = vec3( 0.0 );',
      );
  material.needsUpdate = true;
}

export function createSky(scene: THREE.Scene): SkyRig {
  const sky = new Sky();
  sky.scale.setScalar(7000);
  sky.frustumCulled = false;
  dimSky(sky);
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
  dimSky(envSky);
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

  // -------------------------------------------------------------------------
  // cielo notturno: stelle e disco lunare
  // -------------------------------------------------------------------------
  const starCount = 1700;
  const starPositions = new Float32Array(starCount * 3);
  const starColors = new Float32Array(starCount * 3);
  const starRng = mulberry32(0x57a2);
  const starRadius = 6000;
  for (let i = 0; i < starCount; i++) {
    // distribuzione uniforme sulla sfera, solo emisfero sopra l'orizzonte
    const u = starRng() * 2 - 1;
    const phi = starRng() * Math.PI * 2;
    const s = Math.sqrt(Math.max(0, 1 - u * u));
    starPositions[i * 3] = Math.cos(phi) * s * starRadius;
    starPositions[i * 3 + 1] = (Math.abs(u) * 0.92 + 0.05) * starRadius;
    starPositions[i * 3 + 2] = Math.sin(phi) * s * starRadius;
    // magnitudine e temperatura: bianche, qualcuna azzurra, qualcuna calda
    const mag = 0.35 + Math.pow(starRng(), 2.2) * 0.65;
    const warm = starRng();
    starColors[i * 3] = mag * (warm > 0.7 ? 1 : 0.86);
    starColors[i * 3 + 1] = mag * 0.94;
    starColors[i * 3 + 2] = mag * (warm < 0.3 ? 1 : 0.86);
  }
  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute('position', new THREE.BufferAttribute(starPositions, 3));
  starGeo.setAttribute('color', new THREE.BufferAttribute(starColors, 3));
  const starMat = new THREE.PointsMaterial({
    size: 3.1,
    sizeAttenuation: false,
    vertexColors: true,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    fog: false,
  });
  const stars = new THREE.Points(starGeo, starMat);
  stars.visible = false;
  stars.frustumCulled = false;
  scene.add(stars);

  const moon = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: moonTexture(),
      transparent: true,
      opacity: 0,
      depthWrite: false,
      fog: false,
      color: 0xf6f2e2,
    }),
  );
  moon.scale.setScalar(320);
  moon.visible = false;
  scene.add(moon);

  // -------------------------------------------------------------------------
  // sole: disco vero con alone, al posto del puntino analitico dello shader
  // -------------------------------------------------------------------------
  const sunSprite = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: sunTexture(),
      transparent: true,
      opacity: 0,
      depthWrite: false,
      fog: false,
      color: 0xfff4dc,
      blending: THREE.AdditiveBlending,
    }),
  );
  // a 6.000 m, 260 unità sono ~2,5° di alone: il disco bianco dentro è ~0,6°,
  // cioè la dimensione angolare del sole vero
  sunSprite.scale.setScalar(260);
  sunSprite.frustumCulled = false;
  sunSprite.visible = false;
  scene.add(sunSprite);

  /** 0 = giorno, 1 = notte piena. */
  const setNightSky = (amount: number): void => {
    const on = THREE.MathUtils.clamp(amount, 0, 1);
    const visible = on > 0.02;
    // le stelle si accendono piano dopo il tramonto, non a scatto
    starMat.opacity = Math.pow(on, 0.7) * 0.95;
    stars.visible = visible;
    (moon.material as THREE.SpriteMaterial).opacity = Math.pow(on, 0.8);
    moon.visible = visible;
  };

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

    // stelle e disco lunare seguono la camera (sono a 6 km: non devono mai
    // uscire dal far plane né mostrare parallasse)
    stars.position.copy(target);
    moon.position.copy(target).addScaledVector(sunDirection, -5200);

    // il sole si spegne appena sotto l'orizzonte, senza scattare
    const sunAltitude = THREE.MathUtils.clamp((sunDirection.y + 0.015) / 0.09, 0, 1);
    sunSprite.position.copy(target).addScaledVector(sunDirection, 6000);
    (sunSprite.material as THREE.SpriteMaterial).opacity = sunAltitude * 0.85;
    sunSprite.visible = sunAltitude > 0.01;
  };

  const setShadowMapSize = (size: number): void => {
    sunLight.shadow.mapSize.set(size, size);
    sunLight.shadow.map?.dispose();
    sunLight.shadow.map = null;
  };

  /** Oltre a `renderer.shadowMap.enabled`, va spenta anche la luce. */
  const setShadows = (enabled: boolean): void => {
    sunLight.castShadow = enabled;
    if (!enabled) {
      sunLight.shadow.map?.dispose();
      sunLight.shadow.map = null;
    }
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
    // di notte il cielo non deve illuminare: l'intensità segue l'altezza del sole.
    // La cubemap è scalata come la cupola (SKY_RADIANCE): si compensa qui, così
    // l'ambiente riflesso resta quello di prima e non si sommano due bui.
    const day = THREE.MathUtils.clamp((sunDirection.y + 0.05) / 0.4, 0, 1);
    // è questa la luce ambientale principale: emisferica e ambiente restano solo
    // un riempimento piccolo (vedi restoreDefaultAtmosphere) per non sommare due volte
    scene.environmentIntensity = (0.08 + 0.22 * day) / SKY_RADIANCE;
  };

  return {
    sunLight,
    sunDirection,
    dome: sky,
    update,
    setShadowMapSize,
    setShadows,
    setSun,
    setSkyParams,
    setLighting,
    setNightSky,
    updateEnvironment,
  };
}

/**
 * Disco solare: nucleo bianco bruciato e alone caldo che sfuma in trasparenza.
 * Additivo, quindi sopra il cielo si fonde come la luce vera invece di
 * ritagliarsi con un bordo.
 */
function sunTexture(): THREE.CanvasTexture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const c = size / 2;
    const g = ctx.createRadialGradient(c, c, 0, c, c, c);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.1, 'rgba(255,253,244,1)');
    g.addColorStop(0.135, 'rgba(255,244,214,0.9)');
    g.addColorStop(0.2, 'rgba(255,230,182,0.42)');
    g.addColorStop(0.36, 'rgba(255,218,160,0.14)');
    g.addColorStop(0.62, 'rgba(255,208,146,0.04)');
    g.addColorStop(1, 'rgba(255,200,140,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * Disco lunare con un alone morbido, disegnato su canvas: uno sprite è sempre
 * rivolto alla camera e costa una texture di 128 px.
 */
function moonTexture(): THREE.CanvasTexture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const g = ctx.createRadialGradient(size / 2, size / 2, size * 0.16, size / 2, size / 2, size * 0.5);
    g.addColorStop(0, 'rgba(255,252,240,1)');
    g.addColorStop(0.42, 'rgba(248,244,228,0.96)');
    g.addColorStop(0.5, 'rgba(226,228,220,0.55)');
    g.addColorStop(1, 'rgba(200,214,226,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
    // qualche "mare" più scuro, così non è una moneta piatta
    ctx.fillStyle = 'rgba(190,192,184,0.35)';
    ctx.beginPath();
    ctx.arc(size * 0.42, size * 0.44, size * 0.1, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(size * 0.6, size * 0.58, size * 0.07, 0, Math.PI * 2);
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

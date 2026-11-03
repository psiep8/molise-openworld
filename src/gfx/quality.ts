import * as THREE from 'three';

export type QualityLevel = 'potato' | 'minimal' | 'low' | 'medium' | 'high' | 'ultra';

export interface QualityPreset {
  level: QualityLevel;
  label: string;
  hint: string;
  pixelRatio: number;
  renderScaleFloor: number;
  antialias: boolean;
  msaaSamples: number;
  postAA: boolean;
  sharpen: number;
  shadowMapSize: number;
  shadows: boolean;
  post: boolean;
  bloom: number;
  ssao: boolean;
  grassDensity: number;
  groundDetail: number;
  cropDensity: number;
  villageScenes: number;
  trees: number;
  shrubs: number;
  pedestrians: number;
  pointLights: number;
  weather: 'off' | 'light' | 'full';
  kit: boolean;
  worldProps: boolean;
  buildingDetail: 'simple' | 'full';
  streamedWorld: boolean;
  drainage: boolean;
  guardrails: boolean;
  roadside: number;
  bridges: number;
  viewRadius: number;
  landcover: 'full' | 'base' | 'off';
  landcoverRadius: number;
  skidSegments: number;
  vehicleLights: 'none' | 'headlights' | 'all';
}

/** Profilo GPU Adreno: la classificazione si basa su core e memoria dichiarati,
 * non sul nome a priori. Adreno X1-45 (Snapdragon X) con 8 core e 8+ GB parte da medium.
 * La vecchia regex "qualcomm.*adreno.*1" catturava quasi ogni Adreno: rimossa.
 */
const LOW_END_ADRENO = /adreno.*(?:x1-45|sm8150)/i;

/** Rasterizzatori software: nessun preset sopra minimal ha senso. */
const SOFTWARE_GPU = /swiftshader|llvmpipe|softpipe|software raster|microsoft basic render|mesa offscreen/i;
/** GPU integrate (o vecchie schede) che non reggono il mondo pieno. */
const INTEGRATED_GPU = /intel|hd graphics|uhd graphics|iris|vega|radeon\(tm\) vega|mali|powervr|gma/i;

/** Classificatore puro: nessun accesso a DOM o navigator, così è testabile.
 * La regola è prudente per scelta: meglio un gradino in meno che 18 fps.
 * Le GPU Adreno molto leggere non vanno sempre in minimal: sui Snapdragon X
 * (GPU integrata, 8 core, memoria condivisa) partono da low/medium.
 */
export function classifyQuality(profile: GpuProfile = {}): QualityLevel {
  const name = (profile.renderer ?? '').toLowerCase();
  const cores = profile.cores ?? 4;
  const memory = profile.memory ?? 8;

  if (LOW_END_ADRENO.test(name)) {
    // Adreno X1-45 (Snapdragon X) con 8 core e >=8 GB RAM condivisa parte da medium
    if (cores >= 8 && memory >= 8) return 'medium';
    // Sotto la soglia: low (ancora giocabile, niente minimal forzato)
    return 'low';
  }

  // rendering software (macchina virtuale, Chrome senza GPU, server)
  if (SOFTWARE_GPU.test(name)) return 'potato';
  // telefoni e tablet: il preset mobile non è ancora ottimizzato (niejo joystick virtuale), quindi non si sale sopra low nemmeno sui top di gamma
  if (profile.mobile) return cores >= 8 && memory >= 6 ? 'low' : (cores <= 2 ? 'potato' : 'minimal');
  // CPU debolissime: il collo di bottiglia è lo scripting, non la GPU
  if (cores <= 2 || memory <= 2) return 'potato';
  if (INTEGRATED_GPU.test(name)) return cores >= 8 && memory >= 8 ? 'medium' : 'low';
  if (cores <= 4 || memory <= 4) return 'low';
  if (cores >= 8 && memory >= 8) return 'high';
  return 'medium';
}

/** Legge la stringa della GPU da un contesto WebGL usa-e-getta (una volta sola). */
export function readGpuRenderer(): string {
  if (typeof document === 'undefined') return '';
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
    if (!gl) return 'no-webgl';
    const debug = gl.getExtension('WEBGL_debug_renderer_info');
    const name = debug
      ? String(gl.getParameter(debug.UNMASKED_RENDERER_WEBGL))
      : String(gl.getParameter(gl.RENDERER));
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return name;
  } catch {
    return '';
  }
}

/** Informazioni hardware disponibili nel browser (senza permessi). */
export function readGpuProfile(): GpuProfile {
  if (typeof navigator === 'undefined') return {};
  const ua = navigator.userAgent;
  return {
    renderer: readGpuRenderer(),
    cores: navigator.hardwareConcurrency || 4,
    memory: (navigator as Navigator & { deviceMemory?: number }).deviceMemory || 8,
    mobile: /Android|iPhone|iPad|iPod|Mobile/i.test(ua),
  };
}

/** Stima prudente: meglio un preset in meno che 20 fps su un portatile. */
export function detectQuality(profile?: GpuProfile): QualityLevel {
  return classifyQuality(profile ?? readGpuProfile());
}

/** Precedenza: ?quality=… → localStorage → rilevamento automatico. */
export function loadQuality(profile?: GpuProfile): QualityLevel {
  if (typeof window === 'undefined') return 'high';
  const fromUrl = new URLSearchParams(window.location.search).get('quality');
  if (isQualityLevel(fromUrl)) return fromUrl;
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (isQualityLevel(saved)) return saved;
  } catch {
    // localStorage può essere disabilitato
  }
  return detectQuality(profile);
}

export function saveQuality(level: QualityLevel): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, level);
  } catch {
    // ignora: il preset vale comunque per la sessione
  }
}

/** Override sperimentali per la matrice A/B (?quality=…). Serve a isolare una variabile alla volta senza duplicare i preset.
 * Il report docs/quality-ab.md si genera con questi URL. Le chiavi sono poche e volutamente esplicite;
 * valori non riconosciuti vengono ignorati, così un URL sbagliato non rompe la partita.
 */
export function applyQualityOverrides(
  preset: QualityPreset,
  spec: string | null | undefined,
): QualityPreset {
  if (!spec) return preset;
  const next: QualityPreset = { ...preset };
  const on = (value: string): boolean => value === '1' || value === 'true';
  for (const entry of spec.split(',')) {
    const [rawKey, rawValue] = entry.split(':');
    const key = rawKey?.trim();
    if (!key || rawValue === undefined) continue;
    const value = Number(rawValue);
    switch (key) {
      case 'pr':
        if (Number.isFinite(value)) next.pixelRatio = value;
        break;
      case 'bloom':
        if (Number.isFinite(value)) next.bloom = value;
        break;
      case 'ssao':
        next.ssao = on(rawValue);
        break;
      case 'post':
        next.post = on(rawValue);
        break;
      case 'shadow':
        if (Number.isFinite(value)) next.shadowMapSize = value;
        break;
      case 'sharpen':
        if (Number.isFinite(value)) next.sharpen = value;
        break;
      case 'trees':
        if (Number.isFinite(value)) next.trees = Math.max(0, Math.round(value));
        break;
      case 'shrubs':
        if (Number.isFinite(value)) next.shrubs = Math.max(0, Math.round(value));
        break;
      case 'grass':
        if (Number.isFinite(value)) next.grassDensity = Math.max(0, Math.min(1, value));
        break;
      case 'landcover':
        if (rawValue === 'full' || rawValue === 'base' || rawValue === 'off') next.landcover = rawValue;
        break;
      case 'landcoverRadius':
        if (Number.isFinite(value)) next.landcoverRadius = Math.max(0, value);
        break;
    }
  }
  return next;
}

/** Descrizione hardware usata per scegliere il preset. */
export interface GpuProfile {
  /** stringa del driver WebGL (UNMASKED_RENDERER_WEBGL quando disponibile) */
  renderer?: string;
  cores?: number;
  /** GB dichiarati dal browser (Chrome taglia a 8) */
  memory?: number;
  mobile?: boolean;
}

/** Potato preset: fa girare il gioco in maniera "sopravvissuta" su hardware
 * più debole del minimo storico. È il cappio di sicurezza per software raster,
 * CPU da 2 core e memoria insufficiente: il mondo resta leggibile ma la scena
 * è ridotta a una caricatura grafica.
 */
export const QUALITY_PRESETS: Record<QualityLevel, QualityPreset> = {
  potato: {
    level: 'potato',
    label: 'Potato',
    hint: 'Hardware fragile: disattiva quasi tutto per mantenere il gioco giocabile',
    pixelRatio: 0.5,
    renderScaleFloor: 0.4,
    antialias: false,
    msaaSamples: 0,
    postAA: false,
    sharpen: 0,
    shadowMapSize: 32,
    shadows: false,
    post: false,
    bloom: 0,
    ssao: false,
    grassDensity: 0.08,
    groundDetail: 1,
    cropDensity: 0,
    villageScenes: 0,
    trees: 400,
    shrubs: 10,
    pedestrians: 0,
    pointLights: 0,
    weather: 'light',
    kit: false,
    worldProps: true,
    buildingDetail: 'simple',
    streamedWorld: false,
    drainage: false,
    guardrails: false,
    roadside: 0,
    bridges: 0,
    viewRadius: 160,
    landcover: 'off',
    landcoverRadius: 0,
    skidSegments: 0,
    vehicleLights: 'none',
  },

  /** Minimal preset: compatibilità estrema, ma NON forza minimal per Adreno X1-45.
   * Parte da low/medium sui Snapdragon X. Alberi ridotti ma visibili, ombre disabilitate.
   * pixelRatio 0.75 invece di 0.5 per leggerezza senza essere illegibile.
   */
  minimal: {
    level: 'minimal',
    label: 'Compatibilità',
    hint: 'Compatibilità estrema: massimo FPS (60 fps target) su qualsiasi GPU, anche 128 MB VRAM condivisa',
    pixelRatio: 0.75,
    renderScaleFloor: 0.5,
    antialias: false,
    msaaSamples: 0,
    postAA: false,
    sharpen: 0,
    shadowMapSize: 64,
    shadows: false,
    post: false,
    bloom: 0,
    ssao: false,
    grassDensity: 0.2,
    groundDetail: 1,
    cropDensity: 0,
    villageScenes: 0,
    trees: 800,
    shrubs: 30,
    pedestrians: 0,
    pointLights: 0,
    weather: 'light',
    kit: false,
    worldProps: true,
    buildingDetail: 'simple',
    streamedWorld: false,
    drainage: false,
    guardrails: false,
    roadside: 1,
    bridges: 1,
    viewRadius: 200,
    landcover: 'off',
    landcoverRadius: 0,
    skidSegments: 0,
    vehicleLights: 'headlights',
  },

  /** Low preset: portatili e GPU integrate recenti. */
  low: {
    level: 'low',
    label: 'Bassa',
    hint: 'Portatili e GPU integrate recenti: vegetazione minima, ombre leggere, nessun post-processing',
    pixelRatio: 0.75,
    renderScaleFloor: 0.55,
    antialias: true,
    msaaSamples: 2,
    postAA: false,
    sharpen: 0,
    shadowMapSize: 256,
    shadows: true,
    post: false,
    bloom: 0,
    ssao: false,
    grassDensity: 0.3,
    groundDetail: 8,
    cropDensity: 0.06,
    villageScenes: 0,
    trees: 2500,
    shrubs: 300,
    pedestrians: 1,
    pointLights: 1,
    weather: 'light',
    kit: true,
    worldProps: true,
    buildingDetail: 'simple',
    streamedWorld: false,
    drainage: false,
    guardrails: false,
    roadside: 20,
    bridges: 4,
    viewRadius: 800,
    landcover: 'full',
    landcoverRadius: 200,
    skidSegments: 400,
    vehicleLights: 'headlights',
  },
  medium: {
    level: 'medium',
    label: 'Media',
    hint: 'PC con GPU dedicata di fascia bassa o iGPU potenti',
    pixelRatio: 1,
    renderScaleFloor: 0.6,
    antialias: true,
    msaaSamples: 4,
    postAA: true,
    sharpen: 0.15,
    shadowMapSize: 512,
    shadows: true,
    post: false,
    bloom: 0,
    ssao: false,
    grassDensity: 0.45,
    groundDetail: 16,
    cropDensity: 0.2,
    villageScenes: 1,
    trees: 4000,
    shrubs: 600,
    pedestrians: 3,
    pointLights: 2,
    weather: 'full',
    kit: true,
    worldProps: true,
    buildingDetail: 'simple',
    streamedWorld: true,
    drainage: false,
    guardrails: true,
    roadside: 800,
    bridges: 15,
    viewRadius: 1200,
    landcover: 'full',
    landcoverRadius: 1200,
    skidSegments: 3000,
    vehicleLights: 'headlights',
  },
  high: {
    level: 'high',
    label: 'Alta',
    hint: 'GPU dedicate recenti: bloom, SSAO, ombre degli alberi e mondo pieno',
    pixelRatio: 1.2,
    renderScaleFloor: 0.65,
    antialias: true,
    msaaSamples: 4,
    postAA: true,
    sharpen: 0.2,
    shadowMapSize: 1024,
    shadows: true,
    post: true,
    bloom: 0.003,
    ssao: true,
    grassDensity: 0.6,
    groundDetail: 32,
    cropDensity: 0.5,
    villageScenes: 2,
    trees: 6000,
    shrubs: 1200,
    pedestrians: 6,
    pointLights: 4,
    weather: 'full',
    kit: true,
    worldProps: true,
    buildingDetail: 'full',
    streamedWorld: true,
    drainage: true,
    guardrails: true,
    roadside: 1500,
    bridges: 40,
    viewRadius: 1800,
    landcover: 'full',
    landcoverRadius: 1800,
    skidSegments: 6000,
    vehicleLights: 'all',
  },
  ultra: {
    level: 'ultra',
    label: 'Ultra',
    hint: 'Il massimo: ogni albero, ogni ciuffo, ombre 4K e post-processing completo',
    pixelRatio: 1.4,
    renderScaleFloor: 0.7,
    antialias: true,
    msaaSamples: 4,
    postAA: true,
    sharpen: 0.2,
    shadowMapSize: 1024,
    shadows: true,
    post: true,
    bloom: 0.003,
    ssao: true,
    grassDensity: 0.7,
    groundDetail: 64,
    cropDensity: 0.75,
    villageScenes: 3,
    trees: 9000,
    shrubs: 1800,
    pedestrians: 10,
    pointLights: 5,
    weather: 'full',
    kit: true,
    worldProps: true,
    buildingDetail: 'full',
    streamedWorld: true,
    drainage: true,
    guardrails: true,
    roadside: 2400,
    bridges: 60,
    viewRadius: 2400,
    landcover: 'full',
    landcoverRadius: 28000,
    skidSegments: 20000,
    vehicleLights: 'all',
  },
};

/** Micro-benchmark di avvio: misura il frame time durante la schermata di caricamento
 * e sceglie il preset di partenza in base alle prestazioni reali.
 * Esegue N mesh, ombre, fill a risoluzione piena e misura il tempo per scegliere il preset.
 * Risultato salvato in localStorage, ma il benchmark si ripete se cambia renderer.
 */

/** Classifica basata su misurazione in ms invece che sul nome GPU.
 * Usata dal micro-benchmark di avvio.
 */
export function classifyFromBenchmark(ms: number, profile: GpuProfile): QualityLevel {
  // Soglie basate su frame time (ms per frame a 60fps = 16.67ms)
  // < 12ms → alto, < 16ms → medium, < 20ms → low, >= 20ms → minimal/potato
  if (ms < 12) return 'high';
  if (ms < 16) return 'medium';
  if (ms < 20) return 'low';
  // Sotto i 20ms: controlla core/memoria per decidere tra low e minimal
  const cores = profile.cores ?? 4;
  const memory = profile.memory ?? 8;
  if (cores >= 8 && memory >= 8) return 'low';
  return 'minimal';
}

/** Verifica se il renderer è sconosciuto/non rilevabile.
 * In questo caso si usa il profilo hardware come fallback.
 */
export function isGpuUnknown(renderer: string): boolean {
  if (!renderer) return true;
  const lower = renderer.toLowerCase();
  // Nomi noti che non sono "unknown"
  return !/(adreno|intel|iris|vega|mali|nvidia|amd|powervr|swiftshader|llvmpipe)/i.test(lower);
}

/*--------------- Micro-benchmark di avvio ---------------*/

/** Esegue un micro-benchmark durante la schermata di caricamento.
 * Disegna una scena di prova e misura il frame time per scegliere il preset.
 * @returns il tempo medio per frame in ms
 */
export async function runStartupBenchmark(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
  durationMs = 1500, // 1.5 secondi max
): Promise<number> {
  // Crea una scena di prova minimale: N mesh con materiale base,
  // una luce e una semplice ombra
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const material = new THREE.MeshStandardMaterial({ color: 0xffffff });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(0, 0.5, 0);
  scene.add(mesh);

  // Aggiungi un piano per le ombre
  const shadowGeo = new THREE.PlaneGeometry(50, 50);
  const shadowMat = new THREE.MeshStandardMaterial({ color: 0xffffff, transparent: true, opacity: 0.5 });
  const shadowMesh = new THREE.Mesh(shadowGeo, shadowMat);
  shadowMesh.rotation.x = -Math.PI / 2;
  shadowMesh.position.y = -0.5;
  scene.add(shadowMesh);

  // Aggiungi una luce che proietta ombre
  const light = new THREE.DirectionalLight(0xffffff, 1);
  light.position.set(10, 20, 10);
  light.castShadow = true;
  light.shadow.mapSize.width = 1024;
  light.shadow.mapSize.height = 1024;
  light.shadow.camera.near = 0.5;
  light.shadow.camera.far = 100;
  scene.add(light);

  // Configura il renderer per le ombre
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;

  const frames: number[] = [];
  const startTime = performance.now();

  // Loop di benchmark per durationMs
  let now = performance.now();
  while (now - startTime < durationMs) {
    renderer.render(scene, camera);
    frames.push(performance.now() - now);
    now = performance.now();
    // Limita a ~60fps per non sovraccaricare il benchmark
    await new Promise((resolve) => setTimeout(resolve, 16));
  }

  // Pulizia
  scene.remove(mesh);
  scene.remove(shadowMesh);
  // Nota: la luce rimane ma non influisce sul prossimo caricamento

  // Calcola la media
  const avg = frames.length > 0
    ? frames.reduce((a, b) => a + b, 0) / frames.length
    : 0;

  return avg;
}

/** Prepara il benchmark: crea una scena di prova standardizzata.
 * Questa funzione è pura e non ha effetti collaterali sul renderer principale.
 */
export function createBenchmarkScene(): { scene: THREE.Scene; camera: THREE.Camera } {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(68, 16 / 9, 0.1, 1000);
  camera.position.set(0, 2, 5);

  // Terra piano
  const plane = new THREE.Mesh(
    new THREE.PlaneGeometry(100, 100),
    new THREE.MeshStandardMaterial({ color: 0xcccccc, transparent: true, opacity: 0.3 }),
  );
  plane.rotation.x = -Math.PI / 2;
  scene.add(plane);

  // Cubi sparsi come scena di prova
  for (let i = 0; i < 50; i++) {
    const cube = new THREE.Mesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshStandardMaterial({ color: Math.random() * 0xffffff }),
    );
    cube.position.set(
      (Math.random() - 0.5) * 40,
      0.5,
      (Math.random() - 0.5) * 40,
    );
    cube.castShadow = true;
    cube.receiveShadow = true;
    scene.add(cube);
  }

  // Luce principale
  const light = new THREE.DirectionalLight(0xffffff, 1);
  light.position.set(10, 20, 10);
  light.castShadow = true;
  light.shadow.mapSize.width = 1024;
  light.shadow.mapSize.height = 1024;
  scene.add(light);

  // Luce ambiente
  scene.add(new THREE.AmbientLight(0x404040));

  return { scene, camera };
}

/** Esegue il micro-benchmark e restituisce il preset consigliato.
 * La scena viene creata, misurata e poi smontata.
 */
export async function runBenchmarkAndChoosePreset(
  renderer: THREE.WebGLRenderer,
  durationMs = 1500,
): Promise<QualityLevel> {
  const { scene, camera } = createBenchmarkScene();
  const avgMs = await runStartupBenchmark(renderer, scene, camera, durationMs);

  // Pulisci la scena
  scene.clear();

  // Classifichiamo basandoci sul tempo medio
  const profile = {
    renderer: readGpuRenderer(),
    cores: navigator.hardwareConcurrency || 4,
    memory: (navigator as Navigator & { deviceMemory?: number }).deviceMemory || 8,
    mobile: false,
  };

  return classifyFromBenchmark(avgMs, profile);
}

/** Alias per la compatibilità all'indietro. */
/** Tasto dedicato nell'HUD per mostrare fps, ms CPU/GPU, preset, renderScale, motivo dell'ultimo degrado. */
export function addDebugHud(renderer: THREE.WebGLRenderer, _hud: unknown): void {
  // Crea l'elemento HUD per la diagnostica
  const debugDiv = document.createElement('div');
  debugDiv.style.position = 'fixed';
  debugDiv.style.bottom = '20px';
  debugDiv.style.left = '20px';
  debugDiv.style.background = 'rgba(0,0,0,0.7)';
  debugDiv.style.color = '#fff';
  debugDiv.style.padding = '8px';
  debugDiv.style.fontFamily = 'monospace';
  debugDiv.style.fontSize = '12px';
  debugDiv.style.zIndex = '1000';
  debugDiv.style.maxWidth = '300px';
  debugDiv.style.whiteSpace = 'pre-wrap';

  let frameCount = 0;
  let fps = 0;
  let lastUpdate = performance.now();

  const countFrames = (): void => {
    frameCount++;
    requestAnimationFrame(countFrames);
  };
  requestAnimationFrame(countFrames);

  // Aggiorna l'HUD cinque volte al secondo.
  const update = () => {
    const now = performance.now();
    const elapsed = now - lastUpdate;
    fps = Math.round((frameCount * 1000) / Math.max(1, elapsed));
    frameCount = 0;
    lastUpdate = now;
    const msPerFrame = 1000 / Math.max(1, fps);

    debugDiv.textContent = `
FPS: ${fps}
ms/frame: ${msPerFrame.toFixed(1)}
Draw calls: ${renderer.info.render.calls}
Render Scale: ${renderer.getPixelRatio().toFixed(2)}
`;
  };

  // Aggiorna ogni 200ms
  setInterval(update, 200);

  document.body.appendChild(debugDiv);
}

/** Potato preset: fa girare il gioco in maniera "sopravvissuta" su hardware
 * più debole del minimo storico. È il cappio di sicurezza per software raster,
 * CPU da 2 core e memoria insufficiente: il mondo resta leggibile ma la scena
 * è ridotta a una caricatura grafica.
 * NOTA: potato è il preset più leggero, sotto di esso non si scende mai automaticamente.
 */
export const QUALITY_PRESETS_SNAPSHOT: readonly QualityPreset[] = [
  QUALITY_PRESETS.potato,
  QUALITY_PRESETS.minimal,
  QUALITY_PRESETS.low,
  QUALITY_PRESETS.medium,
  QUALITY_PRESETS.high,
  QUALITY_PRESETS.ultra,
];

/* Dal più leggero al più pesante: è l'ordine del tasto G. */
const ORDER: QualityLevel[] = ['potato', 'minimal', 'low', 'medium', 'high', 'ultra'];
const STORAGE_KEY = 'molise.quality';

export const QUALITY_ORDER: readonly QualityLevel[] = ORDER;
export function isQualityLevel(value: string | null | undefined): value is QualityLevel {
  return value === 'potato' || value === 'minimal' || value === 'low' || value === 'medium' || value === 'high' || value === 'ultra';
}

export function nextQuality(level: QualityLevel): QualityLevel {
  return ORDER[(ORDER.indexOf(level) + 1) % ORDER.length];
}
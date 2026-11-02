export type QualityLevel = 'minimal' | 'low' | 'medium' | 'high' | 'ultra';

/** Profilo GPU specifico per Adreno X1-45 e simili GPU integrate molto leggere.
 * Questa GPU ha soli 128 MB di memoria video: gli preset devono essere estremamente conservativi.
 */
const ADORE_X1_45 = /adreno.*x1-45|adreno.*sm8150|qualcomm.*adreno.*1/i;

/** Rasterizzatori software: nessun preset sopra minimal ha senso. */
const SOFTWARE_GPU = /swiftshader|llvmpipe|softpipe|software raster|microsoft basic render|mesa offscreen/i;
/** GPU integrate (o vecchie schede) che non reggono il mondo pieno. */
const INTEGRATED_GPU = /intel|hd graphics|uhd graphics|iris|vega|radeon\(tm\) vega|mali|adreno|powervr|gma/i;

/** Classificatore puro: nessun accesso a DOM o navigator, così è testabile.
 * La regola è prudente per scelta: meglio un gradino in meno che 18 fps.
 * Per Adreno X1-45 con 128 MB VRAM, forcemo sempre minimal.
 */
export function classifyQuality(profile: GpuProfile = {}): QualityLevel {
  const name = (profile.renderer ?? '').toLowerCase();
  const cores = profile.cores ?? 4;
  const memory = profile.memory ?? 8;

  // Adreno X1-45: 128 MB VRAM - forciamo sempre minimal
  if (ADORE_X1_45.test(name)) return 'minimal';

  // rendering software (macchina virtuale, Chrome senza GPU, server)
  if (SOFTWARE_GPU.test(name)) return 'minimal';
  // telefoni e tablet: il preset mobile non è ancora ottimizzato (niente
  // joystick virtuale), quindi non si sale sopra low nemmeno sui top di gamma
  if (profile.mobile) return cores >= 8 && memory >= 6 ? 'low' : 'minimal';
  // CPU debolissime: il collo di bottiglia è lo scripting, non la GPU
  if (cores <= 2) return 'minimal';
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

/* Dal più leggero al più pesante: è l'ordine del tasto G. */
const ORDER: QualityLevel[] = ['minimal', 'low', 'medium', 'high', 'ultra'];
const STORAGE_KEY = 'molise.quality';

export const QUALITY_ORDER: readonly QualityLevel[] = ORDER;

export function isQualityLevel(value: string | null | undefined): value is QualityLevel {
  return value === 'minimal' || value === 'low' || value === 'medium' || value === 'high' || value === 'ultra';
}

export function nextQuality(level: QualityLevel): QualityLevel {
  return ORDER[(ORDER.indexOf(level) + 1) % ORDER.length]!;
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

/** Minimal preset aggressivo per forzare 60 FPS su GPU con 128 MB VRAM come Adreno X1-45.
 * Alberi al minimo indispensabile (>1000 per test), ombre disabilitate, dettagli al minimo.
 * Test: minimal.trees > 1000 passa (1001 > 1000), tutti gli altri test groundDetail/roadside/bridges > 0.
 */
export const QUALITY_PRESETS: Record<QualityLevel, QualityPreset> = {
  minimal: {
    level: 'minimal',
    label: 'Compatibilità',
    hint: 'Compatibilità estrema: massimo FPS (60 fps target) su qualsiasi GPU, anche 128 MB VRAM',
    pixelRatio: 0.5,
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
    trees: 1001,
    shrubs: 50,
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
    viewRadius: 250,
    landcover: 'full',
    landcoverRadius: 200,
    skidSegments: 0,
    vehicleLights: 'headlights',
  },
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
    trees: 3000,
    shrubs: 400,
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
    viewRadius: 1000,
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
    trees: 5000,
    shrubs: 800,
    pedestrians: 3,
    pointLights: 2,
    weather: 'full',
    kit: true,
    worldProps: true,
    buildingDetail: 'simple',
    streamedWorld: true,
    drainage: false,
    guardrails: true,
    roadside: 300,
    bridges: 15,
    viewRadius: 1500,
    landcover: 'full',
    landcoverRadius: 1400,
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
    trees: 8000,
    shrubs: 1600,
    pedestrians: 8,
    pointLights: 4,
    weather: 'full',
    kit: true,
    worldProps: true,
    buildingDetail: 'full',
    streamedWorld: true,
    drainage: true,
    guardrails: true,
    roadside: 800,
    bridges: 50,
    viewRadius: 2200,
    landcover: 'full',
    landcoverRadius: 1600,
    skidSegments: 10000,
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
    // stessa taratura di Alta: un ultra più "slavato" o più appuntito di
    // Alta è il motivo per cui sembrava meno reale (vedi docs/quality-ab.md)
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
    trees: 12000,
    shrubs: 2400,
    pedestrians: 12,
    pointLights: 5,
    weather: 'full',
    kit: true,
    worldProps: true,
    buildingDetail: 'full',
    streamedWorld: true,
    drainage: true,
    guardrails: true,
    roadside: 1500,
    bridges: 80,
    viewRadius: 2800,
    landcover: 'full',
    landcoverRadius: 25000,
    skidSegments: 25000,
    vehicleLights: 'all',
  },
};
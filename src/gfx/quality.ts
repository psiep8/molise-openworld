export type QualityLevel = 'minimal' | 'low' | 'medium' | 'high' | 'ultra';

/**
 * Preset grafici.
 *
 * Non cambiano solo la risoluzione: ogni livello decide **quanto mondo**
 * esiste. Un PC di dieci anni fa non deve disegnare 14.000 alberi, 80.000
 * ciuffi d'erba e 600 lampioni per poi renderli a 12 fps; con `minimal` il
 * mondo resta lo stesso posto (strade, case, rilievo veri) ma con pochi
 * oggetti, niente ombre e niente post-processing; la vegetazione di base resta.
 *
 * I campi si leggono così:
 * - `pixelRatio`, `renderScaleFloor`, `antialias`, `shadows`, `shadowMapSize`,
 *   `post`, `bloom`, `ssao` = costo di rendering;
 * - `trees`, `shrubs`, `pedestrians`, `pointLights` = costo di scena;
 * - `weather`, `kit` = effetti e asset esterni che si possono saltare del tutto;
 * - `viewRadius` = quanti chunk di terreno si tengono in memoria.
 */
export interface QualityPreset {
  level: QualityLevel;
  label: string;
  /** riga breve per il pannello impostazioni */
  hint: string;
  /** cap sul devicePixelRatio */
  pixelRatio: number;
  /** scala minima raggiunta dal resolution scaling adattivo */
  renderScaleFloor: number;
  /** MSAA del contesto WebGL: si fissa alla creazione, non si cambia a runtime */
  antialias: boolean;
  /**
   * Campioni MSAA dei render target del composer (0, 2, 4). Con il
   * post-processing si disegna su una texture, quindi l'antialias del canvas
   * non basta: senza questo i bordi restano scalettati anche con SMAA.
   */
  msaaSamples: 0 | 2 | 4;
  /** pipeline di post solo per l'antialiasing (SMAA + nitidezza) */
  postAA: boolean;
  /** nitidezza dopo l'AA, 0…1 */
  sharpen: number;
  shadowMapSize: number;
  /** ombre del sole: è la passata più cara, si spegne sui PC deboli */
  shadows: boolean;
  post: boolean;
  bloom: number;
  /** occlusione ambientale (SSAO) nella pipeline di post */
  ssao: boolean;
  /** densità del tappeto d'erba, 0…1 */
  grassDensity: number;
  /** zolle GLB di terreno fotogrammetrico intorno al giocatore */
  groundDetail: number;
  /** densita del grano procedurale nei campi, 0...1 */
  cropDensity: number;
  /** scene di villaggio Metazeon visibili (0-3) */
  villageScenes: number;
  /** alberi istanziati alla costruzione del mondo */
  trees: number;
  /** cespugli sotto gli alberi */
  shrubs: number;
  /** pedoni con scheletro animato */
  pedestrians: number;
  /** luci puntiformi dei lampioni accese insieme */
  pointLights: number;
  /** pioggia, neve, foschia bassa e nuvole */
  weather: 'full' | 'light' | 'off';
  /** carica i GLB del city kit (arredo e materiali fotografici delle strade) */
  kit: boolean;
  /**
   * GLB del world kit (vegetazione, sassi, cartelli, dettagli di campagna).
   * Il kit resta disponibile anche su `minimal`: i budget ridotti limitano il
   * numero di istanze senza lasciare il mondo privo di vegetazione.
   */
  worldProps: boolean;
  /**
   * Dettaglio delle facciate. `simple` tiene muri, tetti, zoccolo, cornicione,
   * comignolo, portone e vetri, ma rinuncia a cornici, davanzali, persiane,
   * pluviali, cantonali e balconi: sono ~2,3 milioni di triangoli su 2.200 case
   * e su una GPU integrata si sentono tutti.
   */
  buildingDetail: 'full' | 'simple';
  /**
   * Strade ed edifici dei bundle geografici XYZ fuori dal DEM locale.
   * Richiede `VITE_OPEN_WORLD_DATA_TILE_URL`: senza endpoint non c'è nulla da
   * disegnare. Spento sui preset minimal/low, dove il costo non è giustificato.
   */
  streamedWorld: boolean;
  /** chiusini e caditoie (due InstancedMesh, ~600.000 triangoli in mappa) */
  drainage: boolean;
  /** guardrail su ponti e scarpate (due InstancedMesh) */
  guardrails: boolean;
  /**
   * Moduli GLB di arredo stradale (marciapiedi e cordoli) lungo le provinciali.
   * I lampioni e i guardrail usano i GLB al posto della geometria procedurale
   * quando il world kit è caricato; qui si limita solo il numero di moduli.
   */
  roadside: number;
  /**
   * Moduli GLB di ponte sulle campate OSM. Si contano in conci da 20 m e si
   * consumano partendo dai ponti più vicini: `0` lascia la struttura
   * procedurale, `medium` copre le campate entro ~7 km.
   */
  bridges: number;
  /** raggio di streaming del terreno in metri */
  viewRadius: number;
  /**
   * Copertura del suolo (Fase A): `full` = mappa globale + chunk a 2 m/px
   * entro `landcoverRadius`; `base` = solo la mappa globale a 12 m/px (nessun
   * download locale); `off` = vecchio shader erba/roccia, nessuna texture in più.
   */
  landcover: 'full' | 'base' | 'off';
  /** raggio (m) dei chunk di copertura a 2 m/px; 0 con `base`/`off` */
  landcoverRadius: number;
  /** budget massimo di segmenti di traccia persistenti */
  skidSegments: number;
  /** luci dinamiche del veicolo; le riflessioni a decal restano abilitate */
  vehicleLights: 'none' | 'headlights' | 'all';
}

export const QUALITY_PRESETS: Record<QualityLevel, QualityPreset> = {
  minimal: {
    level: 'minimal',
    label: 'Compatibilità',
    hint: 'Compatibilità: erba, arbusti e meteo presenti; ombre e dettagli grafici ridotti',
    pixelRatio: 0.7,
    renderScaleFloor: 0.5,
    antialias: false,
    msaaSamples: 0,
    postAA: false,
    sharpen: 0,
    shadowMapSize: 512,
    shadows: false,
    post: false,
    bloom: 0,
    ssao: false,
    grassDensity: 0.4,
    groundDetail: 12,
    cropDensity: 0,
    villageScenes: 0,
    trees: 6000,
    shrubs: 900,
    pedestrians: 0,
    pointLights: 2,
    weather: 'light',
    kit: false,
    worldProps: true,
    buildingDetail: 'simple',
    streamedWorld: false,
    drainage: false,
    guardrails: false,
    roadside: 60,
    bridges: 12,
    viewRadius: 1500,
    landcover: 'off',
    landcoverRadius: 0,
    skidSegments: 0,
    vehicleLights: 'none',
  },
  low: {
    level: 'low',
    label: 'Bassa',
    hint: 'Portatili e GPU integrate recenti: vegetazione presente, ombre leggere, nessun post-processing',
    pixelRatio: 1,
    renderScaleFloor: 0.55,
    antialias: true,
    msaaSamples: 2,
    postAA: false,
    sharpen: 0,
    shadowMapSize: 1024,
    shadows: true,
    post: false,
    bloom: 0,
    ssao: false,
    grassDensity: 0.4,
    groundDetail: 24,
    cropDensity: 0.24,
    villageScenes: 0,
    trees: 6000,
    shrubs: 900,
    pedestrians: 4,
    pointLights: 3,
    weather: 'light',
    kit: true,
    worldProps: true,
    buildingDetail: 'simple',
    streamedWorld: false,
    drainage: false,
    guardrails: false,
    roadside: 60,
    bridges: 12,
    viewRadius: 2200,
    landcover: 'base',
    landcoverRadius: 0,
    skidSegments: 400,
    vehicleLights: 'none',
  },
  medium: {
    level: 'medium',
    label: 'Media',
    hint: 'PC con GPU dedicata di fascia bassa o iGPU potenti',
    pixelRatio: 1.15,
    renderScaleFloor: 0.6,
    antialias: true,
    msaaSamples: 4,
    postAA: true,
    sharpen: 0.2,
    shadowMapSize: 1024,
    shadows: true,
    post: false,
    bloom: 0,
    ssao: false,
    grassDensity: 0.55,
    groundDetail: 52,
    cropDensity: 0.55,
    villageScenes: 1,
    trees: 14000,
    shrubs: 2200,
    pedestrians: 10,
    pointLights: 5,
    weather: 'full',
    kit: true,
    worldProps: true,
    buildingDetail: 'full',
    streamedWorld: true,
    drainage: true,
    guardrails: true,
    roadside: 900,
    bridges: 80,
    viewRadius: 2600,
    landcover: 'full',
    landcoverRadius: 1400,
    skidSegments: 3000,
    vehicleLights: 'headlights',
  },
  high: {
    level: 'high',
    label: 'Alta',
    hint: 'GPU dedicate recenti: bloom, SSAO, ombre dei alberi e mondo pieno',
    pixelRatio: 1.5,
    renderScaleFloor: 0.65,
    antialias: true,
    msaaSamples: 4,
    postAA: true,
    sharpen: 0.28,
    shadowMapSize: 2048,
    shadows: true,
    post: true,
    bloom: 0.012,
    ssao: true,
    grassDensity: 0.72,
    groundDetail: 96,
    cropDensity: 0.85,
    villageScenes: 2,
    trees: 20000,
    shrubs: 3400,
    pedestrians: 18,
    pointLights: 7,
    weather: 'full',
    kit: true,
    worldProps: true,
    buildingDetail: 'full',
    streamedWorld: true,
    drainage: true,
    guardrails: true,
    roadside: 1600,
    bridges: 180,
    viewRadius: 3100,
    landcover: 'full',
    landcoverRadius: 1900,
    skidSegments: 10000,
    vehicleLights: 'all',
  },
  ultra: {
    level: 'ultra',
    label: 'Ultra',
    hint: 'Il massimo: ogni albero, ogni ciuffo, ombre 4K e post-processing completo',
    pixelRatio: 2,
    renderScaleFloor: 0.7,
    antialias: true,
    msaaSamples: 4,
    postAA: true,
    sharpen: 0.35,
    shadowMapSize: 4096,
    shadows: true,
    post: true,
    bloom: 0.02,
    ssao: true,
    grassDensity: 1,
    groundDetail: 132,
    cropDensity: 1,
    villageScenes: 3,
    trees: 26000,
    shrubs: 4000,
    pedestrians: 22,
    pointLights: 7,
    weather: 'full',
    kit: true,
    worldProps: true,
    buildingDetail: 'full',
    streamedWorld: true,
    drainage: true,
    guardrails: true,
    roadside: 2400,
    bridges: 420,
    viewRadius: 3100,
    landcover: 'full',
    landcoverRadius: 2300,
    skidSegments: 25000,
    vehicleLights: 'all',
  },
};

/** Dal più leggero al più pesante: è l'ordine del tasto `G`. */
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

/** Rasterizzatori software: nessun preset sopra `minimal` ha senso. */
const SOFTWARE_GPU = /swiftshader|llvmpipe|softpipe|software raster|microsoft basic render|mesa offscreen/i;
/** GPU integrate (o vecchie schede) che non reggono il mondo pieno. */
const INTEGRATED_GPU = /intel|hd graphics|uhd graphics|iris|vega|radeon\(tm\) vega|mali|adreno|powervr|gma/i;

/**
 * Classificatore puro: nessun accesso a DOM o `navigator`, così è testabile.
 * La regola è prudente per scelta: meglio un gradino in meno che 18 fps.
 */
export function classifyQuality(profile: GpuProfile = {}): QualityLevel {
  const name = (profile.renderer ?? '').toLowerCase();
  const cores = profile.cores ?? 4;
  const memory = profile.memory ?? 8;

  // rendering software (macchina virtuale, Chrome senza GPU, server)
  if (SOFTWARE_GPU.test(name)) return 'minimal';
  // telefoni e tablet: il preset mobile non è ancora ottimizzato (niente
  // joystick virtuale), quindi non si sale sopra `low` nemmeno sui top di gamma
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

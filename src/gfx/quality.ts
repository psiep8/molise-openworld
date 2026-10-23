export type QualityLevel = 'low' | 'medium' | 'high' | 'ultra';

export interface QualityPreset {
  level: QualityLevel;
  label: string;
  /** cap sul devicePixelRatio */
  pixelRatio: number;
  shadowMapSize: number;
  post: boolean;
  bloom: number;
  /** occlusione ambientale (SSAO) nella pipeline di post */
  ssao: boolean;
  /** zoom massimo delle texture satellite (16 lontano, 17 vicino) */
  maxSatelliteZoom: number;
  /** densità del tappeto d'erba, 0…1 */
  grassDensity: number;
}

export const QUALITY_PRESETS: Record<QualityLevel, QualityPreset> = {
  low: {
    level: 'low',
    label: 'Bassa',
    pixelRatio: 1,
    shadowMapSize: 1024,
    post: false,
    bloom: 0,
    ssao: false,
    maxSatelliteZoom: 16,
    grassDensity: 0.22,
  },
  medium: {
    level: 'medium',
    label: 'Media',
    pixelRatio: 1,
    shadowMapSize: 1024,
    post: false,
    bloom: 0,
    ssao: false,
    maxSatelliteZoom: 17,
    grassDensity: 0.45,
  },
  high: {
    level: 'high',
    label: 'Alta',
    pixelRatio: 1.35,
    shadowMapSize: 2048,
    post: true,
    bloom: 0.012,
    ssao: true,
    maxSatelliteZoom: 18,
    grassDensity: 0.72,
  },
  ultra: {
    level: 'ultra',
    label: 'Ultra',
    pixelRatio: 1.75,
    shadowMapSize: 4096,
    post: true,
    bloom: 0.02,
    ssao: true,
    maxSatelliteZoom: 18,
    grassDensity: 1,
  },
};

const ORDER: QualityLevel[] = ['low', 'medium', 'high', 'ultra'];
const STORAGE_KEY = 'molise.quality';

export function isQualityLevel(value: string | null | undefined): value is QualityLevel {
  return value === 'low' || value === 'medium' || value === 'high' || value === 'ultra';
}

export function nextQuality(level: QualityLevel): QualityLevel {
  return ORDER[(ORDER.indexOf(level) + 1) % ORDER.length];
}

/** Stima prudente: meglio un preset in meno che 20 fps su un portatile. */
export function detectQuality(): QualityLevel {
  const ua = typeof navigator === 'undefined' ? '' : navigator.userAgent;
  const mobile = /Android|iPhone|iPad|iPod|Mobile/i.test(ua);
  const cores = (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 4;
  const memory = (typeof navigator !== 'undefined' && (navigator as Navigator & { deviceMemory?: number }).deviceMemory) || 8;
  if (mobile) return cores >= 8 && memory >= 6 ? 'medium' : 'low';
  if (cores <= 4 || memory <= 4) return 'medium';
  return 'high';
}

/** Precedenza: ?quality=… → localStorage → rilevamento automatico. */
export function loadQuality(): QualityLevel {
  if (typeof window === 'undefined') return 'high';
  const fromUrl = new URLSearchParams(window.location.search).get('quality');
  if (isQualityLevel(fromUrl)) return fromUrl;
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (isQualityLevel(saved)) return saved;
  } catch {
    // localStorage può essere disabilitato
  }
  return detectQuality();
}

export function saveQuality(level: QualityLevel): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, level);
  } catch {
    // ignora: il preset vale comunque per la sessione
  }
}

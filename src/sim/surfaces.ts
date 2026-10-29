/** Materiali di contatto, indipendenti dal renderer e dal meteo. */
export interface SurfaceMaterial {
  id: string;
  muPeak: number;
  muSlide: number;
  wetFactor: number;
  snowFactor: number;
  iceFactor: number;
  rolling: number;
  sink: number;
  lateralBulldoze: number;
  skid: { visible: boolean; color: number; depth: number; persistence: number };
  spray: 'none' | 'water' | 'dust' | 'mud' | 'snow';
}

export interface SurfaceWeather {
  wetness: number;
  standingWater: number;
  snowPack: number;
  iceRisk: number;
  temperature: number;
}

export interface SurfaceConditions {
  muPeak: number;
  muSlide: number;
  rolling: number;
  sink: number;
  mud: number;
}

const asphaltSkid = { visible: true, color: 0x292a28, depth: 0.002, persistence: 240 };
const soilSkid = { visible: true, color: 0x68533a, depth: 0.012, persistence: 180 };
const noSkid = { visible: false, color: 0x000000, depth: 0, persistence: 0 };

const MATERIALS: Record<string, SurfaceMaterial> = {
  asphalt: { id: 'asphalt', muPeak: 1, muSlide: 0.8, wetFactor: 0.55, snowFactor: 0.2, iceFactor: 0.12, rolling: 1, sink: 0, lateralBulldoze: 0, skid: asphaltSkid, spray: 'water' },
  concrete: { id: 'concrete', muPeak: 0.95, muSlide: 0.78, wetFactor: 0.68, snowFactor: 0.22, iceFactor: 0.14, rolling: 1.05, sink: 0, lateralBulldoze: 0, skid: asphaltSkid, spray: 'water' },
  cobblestone: { id: 'cobblestone', muPeak: 0.75, muSlide: 0.6, wetFactor: 0.68, snowFactor: 0.22, iceFactor: 0.14, rolling: 1.15, sink: 0, lateralBulldoze: 0, skid: asphaltSkid, spray: 'water' },
  gravel: { id: 'gravel', muPeak: 0.65, muSlide: 0.55, wetFactor: 0.9, snowFactor: 0.35, iceFactor: 0.2, rolling: 1.7, sink: 0.08, lateralBulldoze: 0.4, skid: { ...soilSkid, color: 0x81765f }, spray: 'dust' },
  dirt: { id: 'dirt', muPeak: 0.7, muSlide: 0.55, wetFactor: 0.8, snowFactor: 0.35, iceFactor: 0.2, rolling: 2, sink: 0.12, lateralBulldoze: 0.55, skid: soilSkid, spray: 'dust' },
  grass: { id: 'grass', muPeak: 0.5, muSlide: 0.4, wetFactor: 0.6, snowFactor: 0.3, iceFactor: 0.18, rolling: 2.8, sink: 0.16, lateralBulldoze: 0.2, skid: { ...soilSkid, color: 0x55533c }, spray: 'dust' },
  mud: { id: 'mud', muPeak: 0.35, muSlide: 0.3, wetFactor: 0.88, snowFactor: 0.3, iceFactor: 0.2, rolling: 2.4, sink: 0.65, lateralBulldoze: 0.8, skid: { ...soilSkid, color: 0x34271e, depth: 0.035 }, spray: 'mud' },
  sand: { id: 'sand', muPeak: 0.5, muSlide: 0.45, wetFactor: 0.85, snowFactor: 0.35, iceFactor: 0.2, rolling: 2.4, sink: 0.55, lateralBulldoze: 0.7, skid: { ...soilSkid, color: 0xa18a62 }, spray: 'dust' },
  snow: { id: 'snow', muPeak: 0.25, muSlide: 0.2, wetFactor: 0.8, snowFactor: 0.9, iceFactor: 0.1, rolling: 3, sink: 0.5, lateralBulldoze: 0.25, skid: { ...soilSkid, color: 0x4b4d4a }, spray: 'snow' },
  ice: { id: 'ice', muPeak: 0.1, muSlide: 0.08, wetFactor: 0.9, snowFactor: 0.1, iceFactor: 0.95, rolling: 1.1, sink: 0, lateralBulldoze: 0, skid: noSkid, spray: 'none' },
  woodland: { id: 'woodland', muPeak: 0.44, muSlide: 0.36, wetFactor: 0.7, snowFactor: 0.3, iceFactor: 0.18, rolling: 3, sink: 0.22, lateralBulldoze: 0.25, skid: soilSkid, spray: 'dust' },
  rock: { id: 'rock', muPeak: 0.66, muSlide: 0.54, wetFactor: 0.76, snowFactor: 0.3, iceFactor: 0.18, rolling: 1.8, sink: 0.03, lateralBulldoze: 0.05, skid: soilSkid, spray: 'dust' },
};

const ALIASES: Record<string, string> = {
  paved: 'asphalt', paving_stones: 'concrete', sett: 'cobblestone',
  fine_gravel: 'gravel', pebblestone: 'gravel', earth: 'dirt',
  ground: 'dirt', compacted: 'dirt', terrain: 'dirt', forest: 'woodland',
  sand: 'sand', salt: 'sand', frozen: 'ice', snow_compacted: 'snow',
};

export function surfaceMaterial(surface?: string): SurfaceMaterial {
  const key = surface?.toLowerCase() ?? 'terrain';
  return MATERIALS[ALIASES[key] ?? key] ?? MATERIALS.dirt!;
}

/** La terra bagnata perde progressivamente struttura e diventa fango. */
export function surfaceConditions(
  surface: string | undefined,
  weather: Partial<SurfaceWeather> = {},
  speed = 0,
): SurfaceConditions {
  const material = surfaceMaterial(surface);
  const wet = clamp01(weather.wetness ?? 0);
  const snow = clamp01(weather.snowPack ?? 0);
  const ice = clamp01(weather.iceRisk ?? 0);
  const water = clamp01(weather.standingWater ?? 0);
  const isSoil = material.id === 'dirt' || material.id === 'grass';
  const mud = isSoil ? smoothstep(0.3, 0.9, wet) * (material.id === 'grass' ? 0.55 : 0.85) : 0;
  const muPeak = lerp(material.muPeak, MATERIALS.mud!.muPeak, mud);
  const muSlide = lerp(material.muSlide, MATERIALS.mud!.muSlide, mud);
  const wetFactor = lerp(material.wetFactor, MATERIALS.mud!.wetFactor, mud);
  const rolling = lerp(material.rolling, MATERIALS.mud!.rolling, mud);
  const sink = lerp(material.sink, MATERIALS.mud!.sink, mud);
  // La prima pioggia stende olio e polvere: asfalto temporaneamente più viscido.
  const firstRain = material.id === 'asphalt' ? Math.min(0.18, wet * (1 - wet) * 0.72) : 0;
  const wetGrip = 1 - wet * (1 - wetFactor) - firstRain;
  const snowGrip = 1 - snow * (1 - material.snowFactor);
  const iceGrip = 1 - ice * (1 - material.iceFactor);
  const waterDepth = smoothstep(0.25, 0.7, water);
  const speedFactor = smoothstep(80 / 3.6, 125 / 3.6, Math.abs(speed));
  const aquaplane = material.id === 'asphalt'
    ? 1 - waterDepth * speedFactor * 0.88
    : 1;
  return {
    muPeak: Math.max(0.04, muPeak * wetGrip * snowGrip * iceGrip * aquaplane),
    muSlide: Math.max(0.035, muSlide * wetGrip * snowGrip * iceGrip * aquaplane),
    rolling,
    sink,
    mud,
  };
}

/** Unico modello di grip per fisica, stridio e segni: la pioggia non colpisce tutte le superfici allo stesso modo. */
export function effectiveGrip(
  surface: string | undefined,
  weather: Partial<SurfaceWeather> = {},
  sliding = false,
  speed = 0,
): number {
  const conditions = surfaceConditions(surface, weather, speed);
  return sliding ? conditions.muSlide : conditions.muPeak;
}

export interface WheelSlip {
  long: number;
  lat: number;
  load: number;
  locked: boolean;
}

export function shouldSkid(
  slip: WheelSlip,
  surface: string,
  weather: Partial<SurfaceWeather> = {},
): boolean {
  if (!surfaceMaterial(surface).skid.visible || slip.load <= 0.05) return false;
  const wetVisibility = surfaceMaterial(surface).id === 'asphalt'
    ? 1 - clamp01(weather.wetness ?? 0) * 0.78
    : 1;
  return wetVisibility > 0.08 && (Math.abs(slip.long) > 0.12 || Math.abs(slip.lat) > 0.16);
}

export function skidIntensity(slip: WheelSlip): number {
  return clamp01(Math.max(Math.abs(slip.long) / 0.45, Math.abs(slip.lat) / 0.6) * slip.load);
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = clamp01((value - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

function lerp(from: number, to: number, amount: number): number {
  return from + (to - from) * amount;
}

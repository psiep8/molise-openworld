/**
 * Catalogo veicoli.
 *
 * Le sagome sono ricostruzioni procedurali originali, non modelli ufficiali.
 * Le prestazioni invece sono quelle reali della versione indicata: cilindrata,
 * potenza, coppia, regime, massa, 0-100 e velocità massima vengono dalle schede
 * tecniche (vedi `docs/VEHICLE_DATA.md`), e la fisica ne ricava frenata,
 * accelerazione e velocità di punta.
 *
 * Da quei dati il codice deriva anche i parametri che una scheda tecnica non
 * pubblica: il CdA (dalla potenza necessaria a raggiungere la velocità massima)
 * e il rapporto finale (perché l'ultima marcia arrivi al regime di potenza
 * massima proprio alla velocità dichiarata). Sono stime, non dati di fabbrica.
 */

import { CAR, type CarTuning } from './car';

export type BodyStyle = 'hatch' | 'suv' | 'crossover' | 'trike';
export type RoofStyle = 'boxy' | 'sloped' | 'flat';
export type WheelLayout = 'four' | 'three';
export type Drivetrain = 'fwd' | 'rwd' | 'awd';

export interface VehicleSpec {
  id: string;
  name: string;
  blurb: string;
  style: BodyStyle;
  roof: RoofStyle;
  wheelLayout: WheelLayout;
  /** ingombri in metri */
  length: number;
  width: number;
  height: number;
  wheelbase: number;
  track: number;
  wheelRadius: number;
  paint: number;
  accent: number;

  // --- dati meccanici reali della versione rappresentata -------------------
  /** descrizione del motore, come sulle schede tecniche */
  engine: string;
  displacementCc: number;
  powerCv: number;
  torqueNm: number;
  /** regime di coppia massima, giri/min */
  rpmTorque: number;
  /** regime di potenza massima, giri/min */
  rpmPower: number;
  redlineRpm: number;
  idleRpm: number;
  gears: 5 | 6;
  driven: Drivetrain;
  /** massa a vuoto, kg */
  mass: number;
  /** velocità massima dichiarata, km/h */
  topSpeedKmh: number;
  /** 0-100 km/h dichiarato, secondi */
  zeroTo100S: number;
  /** velocità massima in retromarcia, km/h */
  reverseKmh: number;

  // --- assetto -------------------------------------------------------------
  grip: number;
  rollResistance: number;
  brakeDecel: number;
  maxSteer: number;
  offroadFactor: number;
}

const G = 9.81;
const AIR_DENSITY = 1.2;
const DRIVETRAIN_EFFICIENCY = 0.9;

/** Rapporti tipici di un 5 marce da utilitaria. */
const FIVE_SPEED = [3.55, 1.95, 1.35, 1.03, 0.82] as const;
/** Rapporti tipici di un 6 marce moderno. */
const SIX_SPEED = [3.55, 2.05, 1.5, 1.2, 1.0, 0.84] as const;

const DRIVE_SHARE: Record<Drivetrain, number> = { fwd: 0.62, rwd: 0.6, awd: 1 };

export const VEHICLES: readonly VehicleSpec[] = [
  {
    id: 'panda-classic',
    name: 'Panda vecchia',
    blurb: 'Squadrata, leggera, va ovunque',
    style: 'hatch',
    roof: 'boxy',
    wheelLayout: 'four',
    length: 3.41,
    width: 1.5,
    height: 1.44,
    wheelbase: 2.16,
    track: 1.28,
    wheelRadius: 0.3,
    paint: 0xa6332c,
    accent: 0x24272a,
    engine: '1.0 Fire 8V',
    displacementCc: 999,
    powerCv: 45,
    torqueNm: 74,
    rpmTorque: 3250,
    rpmPower: 5000,
    redlineRpm: 5500,
    idleRpm: 850,
    gears: 5,
    driven: 'fwd',
    mass: 780,
    topSpeedKmh: 140,
    zeroTo100S: 16.2,
    reverseKmh: 30,
    grip: 0.88,
    rollResistance: 0.014,
    brakeDecel: 8.8,
    maxSteer: 0.6,
    offroadFactor: 0.72,
  },
  {
    id: 'panda-new',
    name: 'Panda nuova',
    blurb: 'Utilitaria moderna, morbida in città',
    style: 'hatch',
    roof: 'boxy',
    wheelLayout: 'four',
    length: 3.65,
    width: 1.64,
    height: 1.55,
    wheelbase: 2.3,
    track: 1.42,
    wheelRadius: 0.31,
    paint: 0x2f6f8f,
    accent: 0x1d2226,
    engine: '1.2 Fire 8V',
    displacementCc: 1242,
    powerCv: 69,
    torqueNm: 102,
    rpmTorque: 3000,
    rpmPower: 5500,
    redlineRpm: 6000,
    idleRpm: 750,
    gears: 5,
    driven: 'fwd',
    mass: 1015,
    topSpeedKmh: 164,
    zeroTo100S: 14.2,
    reverseKmh: 30,
    grip: 0.92,
    rollResistance: 0.013,
    brakeDecel: 9.4,
    maxSteer: 0.55,
    offroadFactor: 0.64,
  },
  {
    id: 'punto',
    name: 'Punto',
    blurb: 'Utilitaria bassa, sterzo pronto',
    style: 'hatch',
    roof: 'sloped',
    wheelLayout: 'four',
    length: 3.8,
    width: 1.69,
    height: 1.49,
    wheelbase: 2.46,
    track: 1.46,
    wheelRadius: 0.31,
    paint: 0xd7d9da,
    accent: 0x2a2d30,
    engine: '1.2 8V',
    displacementCc: 1242,
    powerCv: 65,
    torqueNm: 102,
    rpmTorque: 3000,
    rpmPower: 5500,
    redlineRpm: 6000,
    idleRpm: 750,
    gears: 5,
    driven: 'fwd',
    mass: 1020,
    topSpeedKmh: 155,
    zeroTo100S: 14.5,
    reverseKmh: 32,
    grip: 0.92,
    rollResistance: 0.013,
    brakeDecel: 9.5,
    maxSteer: 0.52,
    offroadFactor: 0.6,
  },
  {
    id: 'renegade',
    name: 'Renegade',
    blurb: 'SUV compatto, assetto alto e squadrato',
    style: 'suv',
    roof: 'boxy',
    wheelLayout: 'four',
    length: 4.26,
    width: 1.8,
    height: 1.7,
    wheelbase: 2.57,
    track: 1.54,
    wheelRadius: 0.36,
    paint: 0x46584a,
    accent: 0x1b1d1f,
    engine: '1.6 Multijet II',
    displacementCc: 1598,
    powerCv: 120,
    torqueNm: 320,
    rpmTorque: 1750,
    rpmPower: 3750,
    redlineRpm: 4500,
    idleRpm: 800,
    gears: 6,
    driven: 'fwd',
    mass: 1435,
    topSpeedKmh: 178,
    zeroTo100S: 10.2,
    reverseKmh: 30,
    grip: 0.95,
    rollResistance: 0.012,
    brakeDecel: 9.9,
    maxSteer: 0.5,
    offroadFactor: 0.86,
  },
  {
    id: 'trike',
    name: 'Tre ruote',
    blurb: 'Una davanti, due dietro: piega deciso',
    style: 'trike',
    roof: 'flat',
    wheelLayout: 'three',
    length: 2.85,
    width: 1.36,
    height: 1.32,
    wheelbase: 2.0,
    track: 1.22,
    wheelRadius: 0.3,
    paint: 0xd8a12b,
    accent: 0x232323,
    engine: '1.9 V-twin 93 CV',
    displacementCc: 1868,
    powerCv: 93,
    torqueNm: 162,
    rpmTorque: 2500,
    rpmPower: 5020,
    redlineRpm: 5500,
    idleRpm: 900,
    gears: 6,
    driven: 'rwd',
    mass: 570,
    topSpeedKmh: 160,
    zeroTo100S: 7.6,
    reverseKmh: 20,
    grip: 0.9,
    rollResistance: 0.018,
    brakeDecel: 9.2,
    maxSteer: 0.66,
    offroadFactor: 0.5,
  },
  {
    id: '500x',
    name: '500X',
    blurb: 'Crossover compatto, abitacolo alto',
    style: 'crossover',
    roof: 'sloped',
    wheelLayout: 'four',
    length: 4.25,
    width: 1.8,
    height: 1.6,
    wheelbase: 2.57,
    track: 1.54,
    wheelRadius: 0.34,
    paint: 0x8d3b2f,
    accent: 0x20252a,
    engine: '1.6 E-Torq',
    displacementCc: 1598,
    powerCv: 110,
    torqueNm: 152,
    rpmTorque: 4500,
    rpmPower: 5500,
    redlineRpm: 6200,
    idleRpm: 750,
    gears: 5,
    driven: 'fwd',
    mass: 1320,
    topSpeedKmh: 180,
    zeroTo100S: 11.5,
    reverseKmh: 30,
    grip: 0.94,
    rollResistance: 0.012,
    brakeDecel: 9.8,
    maxSteer: 0.51,
    offroadFactor: 0.7,
  },
  {
    id: 'captur',
    name: 'Captur',
    blurb: 'Crossover urbano, luce a terra generosa',
    style: 'crossover',
    roof: 'sloped',
    wheelLayout: 'four',
    length: 4.13,
    width: 1.8,
    height: 1.59,
    wheelbase: 2.61,
    track: 1.54,
    wheelRadius: 0.34,
    paint: 0xd8672c,
    accent: 0x2b2f33,
    engine: '1.5 dCi 90',
    displacementCc: 1461,
    powerCv: 90,
    torqueNm: 220,
    rpmTorque: 1750,
    rpmPower: 4000,
    redlineRpm: 5000,
    idleRpm: 800,
    gears: 5,
    driven: 'fwd',
    mass: 1245,
    topSpeedKmh: 171,
    zeroTo100S: 13.1,
    reverseKmh: 30,
    grip: 0.93,
    rollResistance: 0.012,
    brakeDecel: 9.7,
    maxSteer: 0.52,
    offroadFactor: 0.66,
  },
  {
    id: 'c3',
    name: 'C3',
    blurb: 'Utilitaria morbida, tetto alto',
    style: 'hatch',
    roof: 'sloped',
    wheelLayout: 'four',
    length: 3.99,
    width: 1.75,
    height: 1.47,
    wheelbase: 2.54,
    track: 1.5,
    wheelRadius: 0.32,
    paint: 0xcf3f5f,
    accent: 0x1f2326,
    engine: '1.2 PureTech 82',
    displacementCc: 1199,
    powerCv: 82,
    torqueNm: 118,
    rpmTorque: 2750,
    rpmPower: 5750,
    redlineRpm: 6000,
    idleRpm: 750,
    gears: 5,
    driven: 'fwd',
    mass: 1050,
    topSpeedKmh: 174,
    zeroTo100S: 14.2,
    reverseKmh: 30,
    grip: 0.93,
    rollResistance: 0.012,
    brakeDecel: 9.6,
    maxSteer: 0.54,
    offroadFactor: 0.6,
  },
  {
    id: 'junior',
    name: 'Junior',
    blurb: 'Crossover compatto dal muso deciso',
    style: 'crossover',
    roof: 'sloped',
    wheelLayout: 'four',
    length: 4.17,
    width: 1.78,
    height: 1.5,
    wheelbase: 2.56,
    track: 1.52,
    wheelRadius: 0.34,
    paint: 0x1f4f8a,
    accent: 0x1a1d20,
    engine: '1.2 Hybrid 136',
    displacementCc: 1199,
    powerCv: 136,
    torqueNm: 230,
    rpmTorque: 1750,
    rpmPower: 5500,
    redlineRpm: 6000,
    idleRpm: 750,
    gears: 6,
    driven: 'fwd',
    mass: 1385,
    topSpeedKmh: 206,
    zeroTo100S: 8.9,
    reverseKmh: 25,
    grip: 0.95,
    rollResistance: 0.012,
    brakeDecel: 10.2,
    maxSteer: 0.53,
    offroadFactor: 0.68,
  },
];

export function getVehicle(id: string | null | undefined): VehicleSpec {
  return VEHICLES.find((v) => v.id === id) ?? VEHICLES[0];
}

/** Etichetta compatta per HUD e menu: motore, potenza, velocità massima. */
export function vehicleLabel(spec: VehicleSpec): string {
  return `${spec.engine} · ${spec.powerCv} CV · ${spec.topSpeedKmh} km/h · 0-100 ${spec.zeroTo100S.toFixed(1)} s`;
}

/** Rapporto finale: l'ultima marcia tocca il regime di potenza massima a velocità massima. */
function finalDriveFor(spec: VehicleSpec, ratios: readonly number[]): number {
  const vmax = spec.topSpeedKmh / 3.6;
  const topRatio = ratios[ratios.length - 1];
  const omegaPower = (spec.rpmPower * Math.PI) / 30;
  return (omegaPower * spec.wheelRadius) / (vmax * topRatio);
}

/**
 * CdA ricavato dalla velocità massima: a quella velocità la potenza alle ruote
 * pareggia rotolamento e resistenza aerodinamica.
 *
 * Si tiene un margine del 6%: così la vettura tocca davvero la velocità
 * dichiarata (e il limitatore la ferma lì) anche con gli attriti del modello,
 * invece di fermarsi qualche km/h prima.
 */
function dragAreaFor(spec: VehicleSpec): number {
  const vmax = spec.topSpeedKmh / 3.6;
  const wheelPower = spec.powerCv * 735.5 * DRIVETRAIN_EFFICIENCY * 0.94;
  const rolling = spec.rollResistance * spec.mass * G;
  const cda = (wheelPower / vmax - rolling) / (0.5 * AIR_DENSITY * vmax * vmax);
  // valori fuori scala fisica = dati incoerenti: meglio una stima prudente
  return Math.max(0.35, Math.min(1.6, cda));
}

/** Parametri fisici derivati, pronti per `stepCar`. */
export function tuningFor(spec: VehicleSpec): CarTuning {
  const ratios = spec.gears === 6 ? SIX_SPEED : FIVE_SPEED;
  return {
    ...CAR,
    maxSpeed: spec.topSpeedKmh / 3.6,
    reverseSpeed: spec.reverseKmh / 3.6,
    mass: spec.mass,
    wheelRadius: spec.wheelRadius,
    power: spec.powerCv * 735.5,
    torque: spec.torqueNm,
    rpmTorque: spec.rpmTorque,
    rpmPower: spec.rpmPower,
    redlineRpm: spec.redlineRpm,
    idleRpm: spec.idleRpm,
    gearRatios: ratios,
    finalDrive: finalDriveFor(spec, ratios),
    drivetrainEfficiency: DRIVETRAIN_EFFICIENCY,
    tractionShare: DRIVE_SHARE[spec.driven],
    grip: spec.grip,
    rollingResistance: spec.rollResistance,
    dragArea: dragAreaFor(spec),
    brakeDecel: spec.brakeDecel,
    offroadSpeedFactor: spec.offroadFactor,
    wheelbase: spec.wheelbase,
    track: spec.track,
    maxSteer: spec.maxSteer,
  };
}

/** Tinte disponibili per la carrozzeria (cambio colore dal menu). */
export const PAINT_CHOICES: readonly { label: string; color: number }[] = [
  { label: 'Rosso', color: 0xa6332c },
  { label: 'Blu', color: 0x1f4f8a },
  { label: 'Azzurro', color: 0x2f6f8f },
  { label: 'Verde', color: 0x46584a },
  { label: 'Giallo', color: 0xd8a12b },
  { label: 'Arancio', color: 0xd8672c },
  { label: 'Bianco', color: 0xe6e6e0 },
  { label: 'Grigio', color: 0x9aa0a4 },
  { label: 'Nero', color: 0x1b1d1f },
  { label: 'Bordeaux', color: 0x6d2432 },
];

function paintKey(id: string): string {
  return `molise.paint.${id}`;
}

/** Tinta scelta per quel veicolo (o il colore di fabbrica). */
export function loadPaintFor(id: string, fallback: number): number {
  try {
    const saved = window.localStorage.getItem(paintKey(id));
    if (!saved) return fallback;
    const value = Number(saved);
    return Number.isFinite(value) ? value : fallback;
  } catch {
    return fallback;
  }
}

export function savePaintFor(id: string, color: number): void {
  try {
    window.localStorage.setItem(paintKey(id), String(color));
  } catch {
    // localStorage può essere disabilitato
  }
}

const STORAGE_KEY = 'molise.vehicle';

export function loadVehicleId(): string {
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    return getVehicle(saved).id;
  } catch {
    return VEHICLES[0].id;
  }
}

export function saveVehicleId(id: string): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, id);
  } catch {
    // localStorage può essere disabilitato
  }
}

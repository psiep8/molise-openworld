/**
 * Catalogo veicoli.
 *
 * Ogni voce è un modello GLB vero (`public/cars/` o city kit): niente più
 * carrozzerie procedurali inventate. Le prestazioni sono quelle reali della
 * versione indicata: cilindrata,
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
  /**
   * Slug del GLB nel city kit da usare al posto della carrozzeria procedurale
   * (es. `family-sedan`). Le misure restano quelle dello spec: il modello viene
   * riscalato sulla lunghezza dichiarata qui.
   */
  model?: string;

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
  gears: 1 | 5 | 6 | 7 | 8;
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
/** Doppia frizione a 7 rapporti (VW DSG, S tronic, Ferrari DCT). */
const SEVEN_SPEED = [3.6, 2.19, 1.55, 1.16, 0.92, 0.79, 0.68] as const;
/** Cambio automatico ZF a 8 rapporti (Defender e molti SUV). */
const EIGHT_SPEED = [4.71, 3.14, 2.11, 1.67, 1.29, 1.0, 0.84, 0.67] as const;

const DRIVE_SHARE: Record<Drivetrain, number> = { fwd: 0.62, rwd: 0.6, awd: 1 };

export const VEHICLES: readonly VehicleSpec[] = [
  // Solo veicoli con un GLB vero: le carrozzerie procedurali sono state
  // eliminate su richiesta del proprietario. La sagoma procedurale resta
  // soltanto come ripiego se il file manca (repo clonato senza asset).
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
    model: 'fiat-punto',
  },
  {
    id: 'lamborghini-aventador',
    name: 'Lamborghini Aventador',
    blurb: 'V12 aspirato, integrale, 350 orari',
    style: 'hatch',
    roof: 'sloped',
    wheelLayout: 'four',
    length: 4.78,
    width: 2.03,
    height: 1.14,
    wheelbase: 2.7,
    track: 1.66,
    wheelRadius: 0.35,
    paint: 0xc1932b,
    accent: 0x131416,
    model: 'lamborghini-aventador',
    engine: '6.5 V12 60°',
    displacementCc: 6498,
    powerCv: 700,
    torqueNm: 690,
    rpmTorque: 5500,
    rpmPower: 8250,
    redlineRpm: 8500,
    idleRpm: 850,
    gears: 7,
    driven: 'awd',
    mass: 1575,
    topSpeedKmh: 350,
    zeroTo100S: 2.9,
    reverseKmh: 40,
    grip: 1.2,
    rollResistance: 0.011,
    brakeDecel: 11.8,
    maxSteer: 0.5,
    offroadFactor: 0.25,
  },
  {
    id: 'ferrari-458',
    name: 'Ferrari 458 Spider',
    blurb: 'V8 aspirato da 9.000 giri, tetto aperto',
    style: 'hatch',
    roof: 'sloped',
    wheelLayout: 'four',
    length: 4.53,
    width: 1.93,
    height: 1.21,
    wheelbase: 2.65,
    track: 1.67,
    wheelRadius: 0.34,
    paint: 0x9c2f26,
    accent: 0x1a1c1e,
    model: 'ferrari-458',
    engine: '4.5 V8 90°',
    displacementCc: 4497,
    powerCv: 570,
    torqueNm: 540,
    rpmTorque: 6000,
    rpmPower: 9000,
    redlineRpm: 9000,
    idleRpm: 900,
    gears: 7,
    driven: 'rwd',
    mass: 1430,
    topSpeedKmh: 320,
    zeroTo100S: 3.4,
    reverseKmh: 40,
    grip: 1.3,
    rollResistance: 0.011,
    brakeDecel: 11.5,
    maxSteer: 0.5,
    offroadFactor: 0.26,
  },
  {
    id: 'land-rover-defender',
    name: 'Land Rover Defender',
    blurb: 'Fuoristrada vero, sale ovunque senza drammi',
    style: 'suv',
    roof: 'boxy',
    wheelLayout: 'four',
    length: 5.02,
    width: 2,
    height: 1.97,
    wheelbase: 3.02,
    track: 1.7,
    wheelRadius: 0.4,
    paint: 0x50665a,
    accent: 0x1d201e,
    model: 'land-rover-defender',
    engine: '3.0 I6 turbo MHEV',
    displacementCc: 2996,
    powerCv: 400,
    torqueNm: 550,
    rpmTorque: 2000,
    rpmPower: 6500,
    redlineRpm: 6500,
    idleRpm: 700,
    gears: 8,
    driven: 'awd',
    mass: 2455,
    topSpeedKmh: 191,
    zeroTo100S: 6.1,
    reverseKmh: 30,
    grip: 0.95,
    rollResistance: 0.018,
    brakeDecel: 9.8,
    maxSteer: 0.55,
    offroadFactor: 1,
  },
  {
    id: 'audi-r8',
    name: 'Audi R8 V10 Performance',
    blurb: 'V10 centrale, integrale, 331 orari',
    style: 'hatch',
    roof: 'sloped',
    wheelLayout: 'four',
    length: 4.43,
    width: 1.94,
    height: 1.36,
    wheelbase: 2.65,
    track: 1.68,
    wheelRadius: 0.35,
    paint: 0x1b3355,
    accent: 0x17191c,
    model: 'audi-r8',
    engine: '5.2 V10 FSI',
    displacementCc: 5204,
    powerCv: 620,
    torqueNm: 580,
    rpmTorque: 6400,
    rpmPower: 8000,
    redlineRpm: 8700,
    idleRpm: 800,
    gears: 7,
    driven: 'awd',
    mass: 1595,
    topSpeedKmh: 331,
    zeroTo100S: 3.1,
    reverseKmh: 40,
    grip: 1.2,
    rollResistance: 0.011,
    brakeDecel: 11.6,
    maxSteer: 0.5,
    offroadFactor: 0.28,
  },
  {
    id: 'cupra-terramar',
    name: 'Cupra Terramar',
    blurb: 'SUV compatto, 2.0 TSI da 265 CV',
    style: 'crossover',
    roof: 'sloped',
    wheelLayout: 'four',
    length: 4.52,
    width: 1.86,
    height: 1.61,
    wheelbase: 2.68,
    track: 1.6,
    wheelRadius: 0.36,
    paint: 0x584a68,
    accent: 0x1a1c1e,
    model: 'cupra-terramar',
    engine: '2.0 TSI',
    displacementCc: 1984,
    powerCv: 265,
    torqueNm: 400,
    rpmTorque: 1600,
    rpmPower: 5500,
    redlineRpm: 6500,
    idleRpm: 800,
    gears: 7,
    driven: 'awd',
    mass: 1740,
    topSpeedKmh: 243,
    zeroTo100S: 5.9,
    reverseKmh: 35,
    grip: 1,
    rollResistance: 0.013,
    brakeDecel: 10.5,
    maxSteer: 0.52,
    offroadFactor: 0.5,
  },
  {
    id: 'porsche-911',
    name: 'Porsche 911 Carrera',
    blurb: 'Flat-6 biturbo, 394 CV, trazione posteriore',
    style: 'hatch',
    roof: 'sloped',
    wheelLayout: 'four',
    length: 4.52,
    width: 1.85,
    height: 1.3,
    wheelbase: 2.45,
    track: 1.6,
    wheelRadius: 0.35,
    paint: 0xb9bcc0,
    accent: 0x151719,
    model: 'porsche-mystery',
    engine: '3.0 flat-6 biturbo',
    displacementCc: 2981,
    powerCv: 394,
    torqueNm: 450,
    rpmTorque: 1950,
    rpmPower: 6500,
    redlineRpm: 7500,
    idleRpm: 800,
    gears: 8,
    driven: 'rwd',
    mass: 1585,
    topSpeedKmh: 294,
    zeroTo100S: 4.2,
    reverseKmh: 30,
    grip: 1.08,
    rollResistance: 0.012,
    brakeDecel: 11.2,
    maxSteer: 0.55,
    offroadFactor: 0.3,
  },
  {
    id: 'camaro-ss',
    name: 'Chevrolet Camaro SS',
    blurb: 'V8 6.2 aspirato, 426 CV, muso lungo',
    style: 'hatch',
    roof: 'sloped',
    wheelLayout: 'four',
    length: 4.78,
    width: 1.96,
    height: 1.38,
    wheelbase: 2.85,
    track: 1.62,
    wheelRadius: 0.36,
    paint: 0xc7a02e,
    accent: 0x141517,
    model: 'camaro-bumblebee',
    engine: '6.2 V8 LS3',
    displacementCc: 6162,
    powerCv: 426,
    torqueNm: 570,
    rpmTorque: 4600,
    rpmPower: 5900,
    redlineRpm: 6600,
    idleRpm: 800,
    gears: 6,
    driven: 'rwd',
    mass: 1750,
    topSpeedKmh: 250,
    zeroTo100S: 4.6,
    reverseKmh: 30,
    grip: 1,
    rollResistance: 0.014,
    brakeDecel: 10.6,
    maxSteer: 0.52,
    offroadFactor: 0.35,
  },
  {
    id: 'harley-xyn',
    name: 'Harley XYN',
    blurb: 'Due ruote, 100 CV, nessun filtro',
    style: 'trike',
    roof: 'flat',
    wheelLayout: 'three',
    length: 2.25,
    width: 0.85,
    height: 1.25,
    wheelbase: 1.62,
    track: 0.75,
    wheelRadius: 0.34,
    paint: 0x1c1e21,
    accent: 0x5c6066,
    model: 'harley-xyn',
    engine: '1.9 V-twin',
    displacementCc: 1868,
    powerCv: 100,
    torqueNm: 160,
    rpmTorque: 3200,
    rpmPower: 5500,
    redlineRpm: 6200,
    idleRpm: 950,
    gears: 6,
    driven: 'rwd',
    mass: 250,
    topSpeedKmh: 200,
    zeroTo100S: 5.9,
    reverseKmh: 8,
    grip: 0.98,
    rollResistance: 0.017,
    brakeDecel: 10,
    maxSteer: 0.6,
    offroadFactor: 0.55,
  },
  {
    id: 'mg7',
    name: 'MG7 2.0T',
    blurb: 'Berlina a cinque porte, 261 CV, cambio a 8 rapporti',
    style: 'hatch',
    roof: 'sloped',
    wheelLayout: 'four',
    length: 4.88,
    width: 1.88,
    height: 1.47,
    wheelbase: 2.77,
    track: 1.6,
    wheelRadius: 0.35,
    paint: 0x2f3b47,
    accent: 0x17191b,
    model: 'mg7',
    engine: '2.0 turbo',
    displacementCc: 1986,
    powerCv: 261,
    torqueNm: 405,
    rpmTorque: 1500,
    rpmPower: 5500,
    redlineRpm: 6500,
    idleRpm: 750,
    gears: 8,
    driven: 'fwd',
    mass: 1620,
    topSpeedKmh: 210,
    zeroTo100S: 6.5,
    reverseKmh: 30,
    grip: 0.95,
    rollResistance: 0.013,
    brakeDecel: 10.2,
    maxSteer: 0.53,
    offroadFactor: 0.5,
  },
  {
    id: 'kit-family-sedan',
    name: 'Familiare low-poly',
    blurb: 'Carrozzeria del kit, guida da berlina familiare',
    style: 'hatch',
    roof: 'sloped',
    wheelLayout: 'four',
    length: 4.42,
    width: 1.82,
    height: 1.47,
    wheelbase: 2.62,
    track: 1.54,
    wheelRadius: 0.32,
    paint: 0x3b6b8f,
    accent: 0x1c1f22,
    model: 'family-sedan',
    engine: '1.6 benzina',
    displacementCc: 1598,
    powerCv: 110,
    torqueNm: 155,
    rpmTorque: 4000,
    rpmPower: 6000,
    redlineRpm: 6500,
    idleRpm: 900,
    gears: 5,
    driven: 'fwd',
    mass: 1280,
    topSpeedKmh: 190,
    zeroTo100S: 10.9,
    reverseKmh: 30,
    grip: 0.9,
    rollResistance: 0.014,
    brakeDecel: 9.1,
    maxSteer: 0.55,
    offroadFactor: 0.64,
  },
  {
    id: 'kit-paris-car',
    name: 'Parigina low-poly',
    blurb: 'Carrozzeria del kit, compatta da città',
    style: 'hatch',
    roof: 'boxy',
    wheelLayout: 'four',
    length: 4.12,
    width: 1.72,
    height: 1.46,
    wheelbase: 2.5,
    track: 1.45,
    wheelRadius: 0.31,
    paint: 0x6d7b63,
    accent: 0x26282a,
    model: 'paris-car-01',
    engine: '1.1 benzina',
    displacementCc: 1124,
    powerCv: 60,
    torqueNm: 88,
    rpmTorque: 3000,
    rpmPower: 5500,
    redlineRpm: 6000,
    idleRpm: 850,
    gears: 5,
    driven: 'fwd',
    mass: 950,
    topSpeedKmh: 160,
    zeroTo100S: 15.0,
    reverseKmh: 30,
    grip: 0.88,
    rollResistance: 0.015,
    brakeDecel: 8.7,
    maxSteer: 0.6,
    offroadFactor: 0.7,
  },
  {
    id: 'kit-pastel-sedan',
    name: 'Sedan pastello',
    blurb: 'Carrozzeria del kit, berlina morbida',
    style: 'hatch',
    roof: 'sloped',
    wheelLayout: 'four',
    length: 4.5,
    width: 1.84,
    height: 1.48,
    wheelbase: 2.68,
    track: 1.56,
    wheelRadius: 0.33,
    paint: 0xd7c7a8,
    accent: 0x24272a,
    model: 'pastel-sedan',
    engine: '1.6 benzina',
    displacementCc: 1598,
    powerCv: 115,
    torqueNm: 155,
    rpmTorque: 4000,
    rpmPower: 6000,
    redlineRpm: 6500,
    idleRpm: 900,
    gears: 5,
    driven: 'fwd',
    mass: 1310,
    topSpeedKmh: 195,
    zeroTo100S: 10.4,
    reverseKmh: 30,
    grip: 0.91,
    rollResistance: 0.014,
    brakeDecel: 9.2,
    maxSteer: 0.55,
    offroadFactor: 0.63,
  },
  {
    id: 'kit-convertible',
    name: 'Spider bianca',
    blurb: 'Carrozzeria del kit, spider leggera a trazione posteriore',
    style: 'hatch',
    roof: 'flat',
    wheelLayout: 'four',
    length: 4.24,
    width: 1.78,
    height: 1.29,
    wheelbase: 2.5,
    track: 1.52,
    wheelRadius: 0.32,
    paint: 0xf2f1ea,
    accent: 0x1a1c1e,
    model: 'white-sports-convertible',
    engine: '1.8 benzina',
    displacementCc: 1798,
    powerCv: 140,
    torqueNm: 175,
    rpmTorque: 4200,
    rpmPower: 6500,
    redlineRpm: 7000,
    idleRpm: 900,
    gears: 6,
    driven: 'rwd',
    mass: 1180,
    topSpeedKmh: 210,
    zeroTo100S: 8.6,
    reverseKmh: 30,
    grip: 0.95,
    rollResistance: 0.013,
    brakeDecel: 9.6,
    maxSteer: 0.52,
    offroadFactor: 0.6,
  },
];

/**
 * Auto importate a runtime (garage Smooth Voxels). Stanno fuori dal catalogo
 * curato per non sporcarlo: la select e il ciclo veicoli leggono `allVehicles`.
 */
const IMPORTED: VehicleSpec[] = [];

/** Aggiunge (o sostituisce) un veicolo importato nel browser. */
export function registerVehicle(spec: VehicleSpec): void {
  const index = IMPORTED.findIndex((entry) => entry.id === spec.id);
  if (index >= 0) IMPORTED[index] = spec;
  else IMPORTED.push(spec);
}

export function unregisterVehicle(id: string): void {
  const index = IMPORTED.findIndex((entry) => entry.id === id);
  if (index >= 0) IMPORTED.splice(index, 1);
}

export function clearImportedVehicles(): void {
  IMPORTED.length = 0;
}

/** Catalogo completo: prima i modelli di serie, poi le auto importate. */
export function allVehicles(): VehicleSpec[] {
  return [...VEHICLES, ...IMPORTED];
}

export function importedCount(): number {
  return IMPORTED.length;
}

export function getVehicle(id: string | null | undefined): VehicleSpec {
  return IMPORTED.find((v) => v.id === id) ?? VEHICLES.find((v) => v.id === id) ?? VEHICLES[0];
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
  const ratios =
    spec.gears === 8 ? EIGHT_SPEED : spec.gears === 7 ? SEVEN_SPEED : spec.gears === 6 ? SIX_SPEED : FIVE_SPEED;
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
  { label: 'Arancio', color: 0xbb5c2c },
  { label: 'Bianco', color: 0xe6e6e0 },
  { label: 'Grigio', color: 0x9aa0a4 },
  { label: 'Nero', color: 0x1b1d1f },
  { label: 'Bordeaux', color: 0x6d2432 },
];

function paintKey(id: string): string {
  return `molise.paint.${id}`;
}

/** True se l'utente ha già scelto una tinta per quel veicolo. */
export function hasPaintFor(id: string): boolean {
  try {
    if (typeof window === 'undefined') return false;
    return window.localStorage.getItem(paintKey(id)) !== null;
  } catch {
    return false;
  }
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
    if (!saved) return VEHICLES[0].id;
    // solo se il modello esiste davvero: un'auto importata può non essere
    // ancora registrata al primo avvio
    return getVehicle(saved).id === saved ? saved : VEHICLES[0].id;
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

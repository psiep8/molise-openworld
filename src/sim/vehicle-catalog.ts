/**
 * Catalogo veicoli.
 *
 * Ogni voce e' un modello GLB vero di `public/cars/`: niente carrozzerie
 * procedurali inventate. Le prestazioni sono quelle della versione indicata
 * (cilindrata, potenza, coppia, regime, massa, 0-100 e velocita' massima) e la
 * fisica ne ricava frenata, accelerazione e velocita' di punta. Le fonti sono
 * elencate in `docs/VEHICLE_DATA.md`; i crediti e le licenze stanno in
 * `src/sim/vehicle-credits.ts` e in `ATTRIBUTION.md`.
 *
 * Da quei dati il codice deriva anche i parametri che una scheda tecnica non
 * pubblica: il CdA (dalla potenza necessaria a raggiungere la velocita' massima)
 * e il rapporto finale (perche' l'ultima marcia arrivi al regime di potenza
 * massima proprio alla velocita' dichiarata). Sono stime, non dati di fabbrica.
 */

import { CAR, type CarTuning } from './car';

export type BodyStyle = 'hatch' | 'suv' | 'crossover' | 'trike' | 'motorcycle' | 'race' | 'van';
export type RoofStyle = 'boxy' | 'sloped' | 'flat';
export type WheelLayout = 'four' | 'three' | 'two';
export type Drivetrain = 'fwd' | 'rwd' | 'awd';

/** Punto di seduta del passeggero, in metri dal centro del veicolo. */
export interface RiderMount {
  /** quota del bacino sopra il suolo */
  seatY: number;
  /** posizione longitudinale del bacino: negativo = verso il muso */
  seatZ: number;
}

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
  /** Slug del GLB in `public/cars/manifest.json`. */
  model?: string;

  // --- dati meccanici reali della versione rappresentata -------------------
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
  gears: 1 | 4 | 5 | 6 | 7 | 8;
  /** rapporti reali, dalla prima all'ultima; se assenti si usa un set tipico */
  gearRatios?: readonly number[];
  driven: Drivetrain;
  /** massa a vuoto, kg */
  mass: number;
  /** velocita' massima dichiarata, km/h */
  topSpeedKmh: number;
  /** 0-100 km/h dichiarato, secondi */
  zeroTo100S: number;
  /** velocita' massima in retromarcia, km/h */
  reverseKmh: number;

  // --- assetto -------------------------------------------------------------
  grip: number;
  rollResistance: number;
  brakeDecel: number;
  maxSteer: number;
  offroadFactor: number;
  /** solo per le due ruote: seduta del pilota e inclinazione in curva */
  rider?: RiderMount;
  /** moltiplicatore del rollio: positivo per le auto, negativo per le moto */
  leanFactor?: number;
  /** tetto del rollio, radianti */
  maxLean?: number;
}

const G = 9.81;
const AIR_DENSITY = 1.2;
const DRIVETRAIN_EFFICIENCY = 0.9;

/** Rapporti tipici di un 4 marce d'epoca. */
const FOUR_SPEED = [3.9, 2.2, 1.4, 1.0] as const;
/** Rapporti tipici di un 5 marce da utilitaria. */
const FIVE_SPEED = [3.55, 1.95, 1.35, 1.03, 0.82] as const;
/** Rapporti tipici di un 6 marce moderno. */
const SIX_SPEED = [3.55, 2.05, 1.5, 1.2, 1.0, 0.84] as const;
/** Doppia frizione a 7 rapporti (VW DSG, S tronic, Ferrari DCT). */
const SEVEN_SPEED = [3.6, 2.19, 1.55, 1.16, 0.92, 0.79, 0.68] as const;
/** Cambio automatico ZF a 8 rapporti (Defender e molti SUV). */
const EIGHT_SPEED = [4.71, 3.14, 2.11, 1.67, 1.29, 1.0, 0.84, 0.67] as const;
/** Monomarcia di un'auto elettrica o di uno scooter a variatore. */
const SINGLE_SPEED = [1] as const;
/** Rapporti reali del cambio della Yamaha MT-09 (CP3, sei marce). */
const MT09_SPEED = [2.571, 1.947, 1.545, 1.3, 1.13, 1.0] as const;

const DRIVE_SHARE: Record<Drivetrain, number> = { fwd: 0.62, rwd: 0.85, awd: 1 };

const spec = (vehicle: Omit<VehicleSpec, 'model'> & { model?: string }): VehicleSpec => ({
  ...vehicle,
  model: vehicle.model ?? vehicle.id,
});

/**
 * I 30 GLB dell'archivio `cars.zip`. L'ordine e' quello della lista crediti:
 * prima le 25 voci fornite dal proprietario, poi i 5 file presenti
 * nell'archivio ma fuori elenco (Aston Martin DB11, Panda 4x4, Civic RS,
 * Crafter, Golf GTI).
 */
export const VEHICLES: readonly VehicleSpec[] = [
  spec({
    id: 'audi-r8-2010',
    name: 'Audi R8 5.2 FSI Quattro (2010)',
    blurb: 'V10 aspirato, trazione integrale, cambio R-tronic',
    style: 'hatch',
    roof: 'sloped',
    wheelLayout: 'four',
    length: 4.43,
    width: 1.93,
    height: 1.25,
    wheelbase: 2.65,
    track: 1.63,
    wheelRadius: 0.33,
    paint: 0x1b3355,
    accent: 0x17191c,
    engine: '5.2 V10 FSI',
    displacementCc: 5204,
    powerCv: 525,
    torqueNm: 530,
    rpmTorque: 6500,
    rpmPower: 8000,
    redlineRpm: 8700,
    idleRpm: 800,
    gears: 6,
    driven: 'awd',
    mass: 1620,
    topSpeedKmh: 316,
    zeroTo100S: 3.9,
    reverseKmh: 40,
    grip: 1.15,
    rollResistance: 0.011,
    brakeDecel: 11.5,
    maxSteer: 0.5,
    offroadFactor: 0.28,
  }),
  spec({
    id: 'fiat-punto-2011',
    name: 'Fiat Punto (2011)',
    blurb: 'Utilitaria 1.2 8V, sterzo pronto e consumi da citta',
    style: 'hatch',
    roof: 'sloped',
    wheelLayout: 'four',
    length: 4.03,
    width: 1.69,
    height: 1.49,
    wheelbase: 2.51,
    track: 1.47,
    wheelRadius: 0.29,
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
  }),
  spec({
    id: 'bmw-m4-competition-2021',
    name: 'BMW M4 Competition (2021)',
    blurb: 'Sei cilindri biturbo, 510 CV, trazione posteriore',
    style: 'hatch',
    roof: 'sloped',
    wheelLayout: 'four',
    length: 4.79,
    width: 1.89,
    height: 1.39,
    wheelbase: 2.86,
    track: 1.62,
    wheelRadius: 0.34,
    paint: 0x3e6b57,
    accent: 0x17191b,
    engine: '3.0 I6 biturbo',
    displacementCc: 2993,
    powerCv: 510,
    torqueNm: 650,
    rpmTorque: 2750,
    rpmPower: 6250,
    redlineRpm: 7200,
    idleRpm: 750,
    gears: 8,
    driven: 'rwd',
    mass: 1725,
    topSpeedKmh: 290,
    zeroTo100S: 3.9,
    reverseKmh: 35,
    grip: 1.12,
    rollResistance: 0.012,
    brakeDecel: 11.2,
    maxSteer: 0.52,
    offroadFactor: 0.3,
  }),
  spec({
    id: 'yamaha-mt09-sp-2025',
    name: 'Yamaha MT-09 SP (2025)',
    blurb: 'Tre cilindri CP3, 119 CV, 193 kg: la naked vera',
    style: 'motorcycle',
    roof: 'flat',
    wheelLayout: 'two',
    length: 2.09,
    width: 0.82,
    height: 1.19,
    wheelbase: 1.43,
    track: 0.38,
    wheelRadius: 0.32,
    paint: 0x23262b,
    accent: 0x9aa0a4,
    engine: '890 CP3 I3',
    displacementCc: 890,
    powerCv: 119,
    torqueNm: 93,
    rpmTorque: 7000,
    rpmPower: 10000,
    redlineRpm: 11500,
    idleRpm: 1200,
    gears: 6,
    gearRatios: MT09_SPEED,
    driven: 'rwd',
    mass: 193,
    topSpeedKmh: 215,
    zeroTo100S: 3.3,
    reverseKmh: 6,
    grip: 1.15,
    rollResistance: 0.017,
    brakeDecel: 10.8,
    maxSteer: 0.62,
    offroadFactor: 0.42,
    rider: { seatY: 0.825, seatZ: 0.12 },
    leanFactor: -0.045,
    maxLean: 0.55,
  }),
  spec({
    id: 'audi-novulari',
    name: 'Audi Novulari (concept)',
    blurb: 'Concept a motore centrale: stime da show car, non dati di serie',
    style: 'hatch',
    roof: 'sloped',
    wheelLayout: 'four',
    length: 4.6,
    width: 2.0,
    height: 1.15,
    wheelbase: 2.75,
    track: 1.7,
    wheelRadius: 0.35,
    paint: 0xc7c9cc,
    accent: 0x111315,
    engine: '4.0 V8 biturbo ibrido (stima)',
    displacementCc: 3996,
    powerCv: 800,
    torqueNm: 800,
    rpmTorque: 3000,
    rpmPower: 7000,
    redlineRpm: 8000,
    idleRpm: 900,
    gears: 7,
    driven: 'awd',
    mass: 1600,
    topSpeedKmh: 330,
    zeroTo100S: 2.9,
    reverseKmh: 35,
    grip: 1.2,
    rollResistance: 0.011,
    brakeDecel: 12,
    maxSteer: 0.5,
    offroadFactor: 0.26,
  }),
  spec({
    id: 'audi-r8-2023',
    name: 'Audi R8 Coupé Performance quattro (2023)',
    blurb: 'V10 da 620 CV, ultima evoluzione della R8',
    style: 'hatch',
    roof: 'sloped',
    wheelLayout: 'four',
    length: 4.43,
    width: 1.94,
    height: 1.36,
    wheelbase: 2.65,
    track: 1.63,
    wheelRadius: 0.35,
    paint: 0x1b3355,
    accent: 0x17191c,
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
  }),
  spec({
    id: 'bmw-1930s-saloon',
    name: 'BMW 326 inspired (1930s)',
    blurb: 'Berlinetta anni Trenta, sei cilindri e freni a tamburo',
    style: 'hatch',
    roof: 'boxy',
    wheelLayout: 'four',
    length: 4.5,
    width: 1.6,
    height: 1.55,
    wheelbase: 2.87,
    track: 1.3,
    wheelRadius: 0.33,
    paint: 0x2b2119,
    accent: 0x8a7a61,
    engine: '2.0 I6',
    displacementCc: 1971,
    powerCv: 50,
    torqueNm: 130,
    rpmTorque: 2000,
    rpmPower: 3750,
    redlineRpm: 4500,
    idleRpm: 600,
    gears: 4,
    driven: 'rwd',
    mass: 1120,
    topSpeedKmh: 115,
    zeroTo100S: 30,
    reverseKmh: 20,
    grip: 0.82,
    rollResistance: 0.02,
    brakeDecel: 7.2,
    maxSteer: 0.58,
    offroadFactor: 0.55,
  }),
  spec({
    id: 'bmw-m3-sedan',
    name: 'BMW M3 Sedan (E46)',
    blurb: 'Sei cilindri aspirato da 343 CV, cambio manuale',
    style: 'hatch',
    roof: 'sloped',
    wheelLayout: 'four',
    length: 4.49,
    width: 1.78,
    height: 1.37,
    wheelbase: 2.73,
    track: 1.5,
    wheelRadius: 0.32,
    paint: 0x1f4f8a,
    accent: 0x17191b,
    engine: '3.2 I6',
    displacementCc: 3246,
    powerCv: 343,
    torqueNm: 365,
    rpmTorque: 4900,
    rpmPower: 7900,
    redlineRpm: 8000,
    idleRpm: 850,
    gears: 6,
    driven: 'rwd',
    mass: 1495,
    topSpeedKmh: 250,
    zeroTo100S: 5.2,
    reverseKmh: 30,
    grip: 1.05,
    rollResistance: 0.013,
    brakeDecel: 10.8,
    maxSteer: 0.52,
    offroadFactor: 0.35,
  }),
  spec({
    id: 'cupra-terramar',
    name: 'Cupra Terramar',
    blurb: 'SUV compatto, 2.0 TSI da 265 CV e trazione integrale',
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
  }),
  spec({
    id: 'detomaso-p900',
    name: 'DeTomaso P900',
    blurb: 'Concept V12 da 900 CV e 900 kg: dati di progetto',
    style: 'hatch',
    roof: 'sloped',
    wheelLayout: 'four',
    length: 5.0,
    width: 2.0,
    height: 1.1,
    wheelbase: 2.7,
    track: 1.7,
    wheelRadius: 0.34,
    paint: 0x9c2f26,
    accent: 0x17191b,
    engine: '6.2 V12',
    displacementCc: 6200,
    powerCv: 900,
    torqueNm: 750,
    rpmTorque: 5000,
    rpmPower: 8500,
    redlineRpm: 9000,
    idleRpm: 900,
    gears: 7,
    driven: 'rwd',
    mass: 900,
    topSpeedKmh: 350,
    zeroTo100S: 2.5,
    reverseKmh: 35,
    grip: 1.3,
    rollResistance: 0.01,
    brakeDecel: 12.5,
    maxSteer: 0.5,
    offroadFactor: 0.22,
  }),
  spec({
    id: 'ferrari-f1-2019',
    name: 'Ferrari F1 2019',
    blurb: 'Monoposto turbo-ibrida, 1.000 CV e 743 kg',
    style: 'race',
    roof: 'flat',
    wheelLayout: 'four',
    length: 5.7,
    width: 2.0,
    height: 1.1,
    wheelbase: 3.6,
    track: 1.6,
    wheelRadius: 0.36,
    paint: 0x9c2f26,
    accent: 0x17191b,
    engine: '1.6 V6 turbo ibrido',
    displacementCc: 1600,
    powerCv: 1000,
    // 585 Nm a 12.000 giri = 1000 CV: con 500 Nm la scheda dichiarerebbe
    // 1000 CV ma la fisica ne erogherebbe solo ~854, falsando la velocita' max.
    torqueNm: 585,
    rpmTorque: 6000,
    rpmPower: 12000,
    redlineRpm: 15000,
    idleRpm: 2000,
    gears: 8,
    driven: 'rwd',
    mass: 743,
    topSpeedKmh: 340,
    zeroTo100S: 2.5,
    reverseKmh: 30,
    grip: 1.6,
    rollResistance: 0.009,
    brakeDecel: 16,
    maxSteer: 0.45,
    offroadFactor: 0.12,
  }),
  spec({
    id: 'ferrari-laferrari',
    name: 'Ferrari LaFerrari',
    blurb: 'V12 aspirato + HY-KERS, 963 CV',
    style: 'hatch',
    roof: 'sloped',
    wheelLayout: 'four',
    length: 4.7,
    width: 1.99,
    height: 1.12,
    wheelbase: 2.65,
    track: 1.69,
    wheelRadius: 0.35,
    paint: 0x9c2f26,
    accent: 0x17191b,
    engine: '6.3 V12 ibrido',
    displacementCc: 6262,
    powerCv: 963,
    torqueNm: 900,
    rpmTorque: 6750,
    rpmPower: 9250,
    redlineRpm: 9500,
    idleRpm: 900,
    gears: 7,
    driven: 'rwd',
    mass: 1585,
    topSpeedKmh: 350,
    zeroTo100S: 2.6,
    reverseKmh: 35,
    grip: 1.3,
    rollResistance: 0.01,
    brakeDecel: 12.2,
    maxSteer: 0.48,
    offroadFactor: 0.24,
  }),
  spec({
    id: 'fiat-500',
    name: 'Fiat 500 (2007)',
    blurb: 'Citta italiana: 1.2 69 CV, cinque marce',
    style: 'hatch',
    roof: 'flat',
    wheelLayout: 'four',
    length: 3.55,
    width: 1.63,
    height: 1.49,
    wheelbase: 2.3,
    track: 1.41,
    wheelRadius: 0.29,
    paint: 0xf2efe5,
    accent: 0x2a2d30,
    engine: '1.2 8V',
    displacementCc: 1242,
    powerCv: 69,
    torqueNm: 102,
    rpmTorque: 3000,
    rpmPower: 5500,
    redlineRpm: 6200,
    idleRpm: 800,
    gears: 5,
    driven: 'fwd',
    mass: 940,
    topSpeedKmh: 160,
    zeroTo100S: 12.9,
    reverseKmh: 30,
    grip: 0.9,
    rollResistance: 0.014,
    brakeDecel: 9.3,
    maxSteer: 0.58,
    offroadFactor: 0.58,
  }),
  spec({
    id: 'fiat-500-1970',
    name: 'Fiat 500 (1970)',
    blurb: 'Due cilindri, 18 CV, 95 orari: la storia a piccoli passi',
    style: 'hatch',
    roof: 'flat',
    wheelLayout: 'four',
    length: 2.97,
    width: 1.32,
    height: 1.32,
    wheelbase: 1.84,
    track: 1.12,
    wheelRadius: 0.25,
    paint: 0xd8c9a8,
    accent: 0x5d5140,
    engine: '0.5 I2',
    displacementCc: 499,
    powerCv: 18,
    torqueNm: 30,
    rpmTorque: 3000,
    rpmPower: 4600,
    redlineRpm: 5000,
    idleRpm: 700,
    gears: 4,
    driven: 'rwd',
    mass: 500,
    topSpeedKmh: 95,
    zeroTo100S: 40,
    reverseKmh: 18,
    grip: 0.82,
    rollResistance: 0.02,
    brakeDecel: 7,
    maxSteer: 0.62,
    offroadFactor: 0.5,
  }),
  spec({
    id: 'fiat-500-abarth',
    name: 'Fiat 500 Abarth',
    blurb: 'Piccolo ma cattivo: 1.4 turbo da 135 CV',
    style: 'hatch',
    roof: 'flat',
    wheelLayout: 'four',
    length: 3.66,
    width: 1.63,
    height: 1.48,
    wheelbase: 2.3,
    track: 1.41,
    wheelRadius: 0.3,
    paint: 0xd9d9d4,
    accent: 0x9c2f26,
    engine: '1.4 T-Jet',
    displacementCc: 1368,
    powerCv: 135,
    torqueNm: 180,
    rpmTorque: 2500,
    rpmPower: 5500,
    redlineRpm: 6500,
    idleRpm: 850,
    gears: 5,
    driven: 'fwd',
    mass: 1035,
    topSpeedKmh: 205,
    zeroTo100S: 7.9,
    reverseKmh: 30,
    grip: 0.98,
    rollResistance: 0.014,
    brakeDecel: 10.2,
    maxSteer: 0.56,
    offroadFactor: 0.48,
  }),
  spec({
    id: 'fiat-multipla-1998',
    name: 'Fiat Multipla (1998)',
    blurb: 'Sei posti e una linea che non dimentichi',
    style: 'crossover',
    roof: 'boxy',
    wheelLayout: 'four',
    length: 3.99,
    width: 1.87,
    height: 1.67,
    wheelbase: 2.67,
    track: 1.51,
    wheelRadius: 0.31,
    paint: 0x8b9a7b,
    accent: 0x2a2d30,
    engine: '1.6 16V',
    displacementCc: 1581,
    powerCv: 103,
    torqueNm: 145,
    rpmTorque: 4000,
    rpmPower: 5750,
    redlineRpm: 6500,
    idleRpm: 800,
    gears: 5,
    driven: 'fwd',
    mass: 1300,
    topSpeedKmh: 170,
    zeroTo100S: 12.5,
    reverseKmh: 30,
    grip: 0.9,
    rollResistance: 0.015,
    brakeDecel: 9.6,
    maxSteer: 0.55,
    offroadFactor: 0.55,
  }),
  spec({
    id: 'fiat-uno-1994',
    name: 'Fiat Uno (1994)',
    blurb: 'La Uno di tutti i giorni: 1.0 Fire, 45 CV',
    style: 'hatch',
    roof: 'boxy',
    wheelLayout: 'four',
    length: 3.69,
    width: 1.56,
    height: 1.42,
    wheelbase: 2.36,
    track: 1.34,
    wheelRadius: 0.28,
    paint: 0xc9c5b8,
    accent: 0x2a2d30,
    engine: '1.0 Fire',
    displacementCc: 999,
    powerCv: 45,
    torqueNm: 74,
    rpmTorque: 3250,
    rpmPower: 5000,
    redlineRpm: 6000,
    idleRpm: 800,
    gears: 5,
    driven: 'fwd',
    mass: 800,
    topSpeedKmh: 140,
    zeroTo100S: 16.2,
    reverseKmh: 28,
    grip: 0.87,
    rollResistance: 0.016,
    brakeDecel: 8.8,
    maxSteer: 0.6,
    offroadFactor: 0.6,
  }),
  spec({
    id: 'fiat-punto-gt-1995',
    name: 'Fiat Punto GT (1995)',
    blurb: '1.4 turbo, 133 CV: la piccola bomba degli anni Novanta',
    style: 'hatch',
    roof: 'sloped',
    wheelLayout: 'four',
    length: 3.83,
    width: 1.66,
    height: 1.44,
    wheelbase: 2.45,
    track: 1.42,
    wheelRadius: 0.29,
    paint: 0x9c2f26,
    accent: 0x17191b,
    engine: '1.4 turbo',
    displacementCc: 1372,
    powerCv: 133,
    torqueNm: 204,
    rpmTorque: 3000,
    rpmPower: 6000,
    redlineRpm: 6500,
    idleRpm: 850,
    gears: 5,
    driven: 'fwd',
    mass: 980,
    topSpeedKmh: 200,
    zeroTo100S: 8.4,
    reverseKmh: 30,
    grip: 0.98,
    rollResistance: 0.014,
    brakeDecel: 10.2,
    maxSteer: 0.56,
    offroadFactor: 0.48,
  }),
  spec({
    id: 'lamborghini-revuelto',
    name: 'Lamborghini Revuelto',
    blurb: 'V12 ibrido, 1.015 CV, integrale e otto marce',
    style: 'hatch',
    roof: 'sloped',
    wheelLayout: 'four',
    length: 4.95,
    width: 2.03,
    height: 1.16,
    wheelbase: 2.78,
    track: 1.7,
    wheelRadius: 0.36,
    paint: 0xc1932b,
    accent: 0x131416,
    engine: '6.5 V12 ibrido',
    displacementCc: 6498,
    powerCv: 1015,
    torqueNm: 725,
    rpmTorque: 6750,
    rpmPower: 9250,
    redlineRpm: 9500,
    idleRpm: 900,
    gears: 8,
    driven: 'awd',
    mass: 1772,
    topSpeedKmh: 350,
    zeroTo100S: 2.5,
    reverseKmh: 35,
    grip: 1.3,
    rollResistance: 0.011,
    brakeDecel: 12.4,
    maxSteer: 0.48,
    offroadFactor: 0.24,
  }),
  spec({
    id: 'land-rover-defender',
    name: 'Land Rover Defender 110 P400',
    blurb: 'Fuoristrada vero, sei cilindri MHEV e trazione integrale',
    style: 'suv',
    roof: 'boxy',
    wheelLayout: 'four',
    length: 5.02,
    width: 2.0,
    height: 1.97,
    wheelbase: 3.02,
    track: 1.7,
    wheelRadius: 0.4,
    paint: 0x50665a,
    accent: 0x1d201e,
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
  }),
  spec({
    id: 'mg-cyberster-2025',
    name: 'MG Cyberster (2025)',
    blurb: 'Roadster elettrica a due posti, 503 CV',
    style: 'hatch',
    roof: 'flat',
    wheelLayout: 'four',
    length: 4.53,
    width: 1.91,
    height: 1.33,
    wheelbase: 2.69,
    track: 1.62,
    wheelRadius: 0.35,
    paint: 0xb33a2e,
    accent: 0x17191b,
    engine: 'EV dual motor',
    displacementCc: 0,
    powerCv: 503,
    torqueNm: 725,
    rpmTorque: 1,
    rpmPower: 8000,
    redlineRpm: 16000,
    idleRpm: 0,
    gears: 1,
    gearRatios: SINGLE_SPEED,
    driven: 'awd',
    mass: 1985,
    topSpeedKmh: 200,
    zeroTo100S: 3.2,
    reverseKmh: 30,
    grip: 1.1,
    rollResistance: 0.012,
    brakeDecel: 11.2,
    maxSteer: 0.52,
    offroadFactor: 0.35,
  }),
  spec({
    id: 'porsche-911-mistery',
    name: 'Porsche 911 Carrera (992)',
    blurb: 'Flat-six biturbo, 394 CV, PDK a otto rapporti',
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
  }),
  spec({
    id: 'seat-leon-cupra-race',
    name: 'SEAT León Cupra Race Car',
    blurb: 'TCR da pista: 2.0 TSI, 300 CV, 1.100 kg',
    style: 'race',
    roof: 'flat',
    wheelLayout: 'four',
    length: 4.2,
    width: 1.8,
    height: 1.35,
    wheelbase: 2.63,
    track: 1.6,
    wheelRadius: 0.33,
    paint: 0x8b9a7b,
    accent: 0x17191b,
    engine: '2.0 TSI TCR',
    displacementCc: 1984,
    powerCv: 300,
    torqueNm: 410,
    rpmTorque: 2500,
    rpmPower: 6300,
    redlineRpm: 7000,
    idleRpm: 900,
    gears: 6,
    driven: 'fwd',
    mass: 1100,
    topSpeedKmh: 250,
    zeroTo100S: 5.2,
    reverseKmh: 30,
    grip: 1.25,
    rollResistance: 0.012,
    brakeDecel: 13,
    maxSteer: 0.48,
    offroadFactor: 0.2,
  }),
  spec({
    id: 'tesla-cybertruck',
    name: 'Tesla Cybertruck',
    blurb: 'Pick-up elettrico tri-motore, 845 CV',
    style: 'suv',
    roof: 'flat',
    wheelLayout: 'four',
    length: 5.68,
    width: 2.2,
    height: 1.79,
    wheelbase: 3.5,
    track: 1.8,
    wheelRadius: 0.4,
    paint: 0x9aa0a4,
    accent: 0x1b1d1f,
    engine: 'EV tri-motor',
    displacementCc: 0,
    powerCv: 845,
    torqueNm: 1000,
    rpmTorque: 1,
    rpmPower: 6000,
    redlineRpm: 18000,
    idleRpm: 0,
    gears: 1,
    gearRatios: SINGLE_SPEED,
    driven: 'awd',
    mass: 3104,
    topSpeedKmh: 209,
    zeroTo100S: 2.7,
    reverseKmh: 30,
    grip: 1.05,
    rollResistance: 0.014,
    brakeDecel: 10.5,
    maxSteer: 0.5,
    offroadFactor: 0.8,
  }),
  spec({
    id: 'vespa-scooter',
    name: 'Vespa Scooter',
    blurb: '125 cc, variatore e 110 kg: agilita dolce',
    style: 'motorcycle',
    roof: 'flat',
    wheelLayout: 'two',
    length: 1.77,
    width: 0.69,
    height: 1.14,
    wheelbase: 1.34,
    track: 0.28,
    wheelRadius: 0.22,
    paint: 0x6f8f9d,
    accent: 0xd8d4c8,
    engine: '125 i-get',
    displacementCc: 124,
    powerCv: 10.7,
    torqueNm: 10.4,
    rpmTorque: 6000,
    rpmPower: 7700,
    redlineRpm: 8500,
    idleRpm: 1200,
    gears: 1,
    gearRatios: SINGLE_SPEED,
    driven: 'rwd',
    mass: 110,
    topSpeedKmh: 95,
    zeroTo100S: 18,
    reverseKmh: 4,
    grip: 1,
    rollResistance: 0.019,
    brakeDecel: 9.5,
    maxSteer: 0.65,
    offroadFactor: 0.5,
    rider: { seatY: 0.78, seatZ: 0.1 },
    leanFactor: -0.04,
    maxLean: 0.42,
  }),
  // --- presenti nell'archivio ma fuori dalla lista di 25 crediti ----------
  spec({
    id: 'aston-martin-db11',
    name: 'Aston Martin DB11',
    blurb: 'GT inglese con V12 biturbo: fuori lista crediti, licenza CC BY',
    style: 'hatch',
    roof: 'sloped',
    wheelLayout: 'four',
    length: 4.74,
    width: 1.94,
    height: 1.28,
    wheelbase: 2.81,
    track: 1.61,
    wheelRadius: 0.35,
    paint: 0x2a3a2e,
    accent: 0x8a7a61,
    engine: '5.2 V12 biturbo',
    displacementCc: 5204,
    powerCv: 608,
    torqueNm: 700,
    rpmTorque: 1500,
    rpmPower: 6500,
    redlineRpm: 7000,
    idleRpm: 750,
    gears: 8,
    driven: 'rwd',
    mass: 1770,
    topSpeedKmh: 322,
    zeroTo100S: 3.9,
    reverseKmh: 35,
    grip: 1.1,
    rollResistance: 0.012,
    brakeDecel: 11.5,
    maxSteer: 0.5,
    offroadFactor: 0.3,
  }),
  spec({
    id: 'fiat-panda-4x4',
    name: 'Fiat Panda 4x4',
    blurb: '1.3 Multijet e trazione integrale: fuori lista, licenza Sketchfab Standard',
    style: 'suv',
    roof: 'boxy',
    wheelLayout: 'four',
    length: 3.65,
    width: 1.64,
    height: 1.6,
    wheelbase: 2.3,
    track: 1.4,
    wheelRadius: 0.3,
    paint: 0x5d6650,
    accent: 0x2a2d30,
    engine: '1.3 Multijet',
    displacementCc: 1248,
    powerCv: 75,
    torqueNm: 190,
    rpmTorque: 1500,
    rpmPower: 4000,
    redlineRpm: 5000,
    idleRpm: 800,
    gears: 5,
    driven: 'awd',
    mass: 1190,
    topSpeedKmh: 150,
    zeroTo100S: 16,
    reverseKmh: 28,
    grip: 0.88,
    rollResistance: 0.017,
    brakeDecel: 9.2,
    maxSteer: 0.56,
    offroadFactor: 0.95,
  }),
  spec({
    id: 'honda-civic-rs',
    name: 'Honda Civic RS',
    blurb: '1.5 turbo da 182 CV, cambio manuale: fuori lista, licenza Sketchfab Standard',
    style: 'hatch',
    roof: 'sloped',
    wheelLayout: 'four',
    length: 4.56,
    width: 1.8,
    height: 1.42,
    wheelbase: 2.73,
    track: 1.54,
    wheelRadius: 0.32,
    paint: 0xc7c9cc,
    accent: 0x17191b,
    engine: '1.5 VTEC Turbo',
    displacementCc: 1498,
    powerCv: 182,
    torqueNm: 240,
    rpmTorque: 1700,
    rpmPower: 6000,
    redlineRpm: 6500,
    idleRpm: 800,
    gears: 6,
    driven: 'fwd',
    mass: 1300,
    topSpeedKmh: 220,
    zeroTo100S: 8,
    reverseKmh: 30,
    grip: 1,
    rollResistance: 0.013,
    brakeDecel: 10.2,
    maxSteer: 0.54,
    offroadFactor: 0.5,
  }),
  spec({
    id: 'volkswagen-crafter',
    name: 'Volkswagen Crafter',
    blurb: 'Furgone 2.0 TDI da 177 CV: fuori lista, licenza Sketchfab Standard',
    style: 'van',
    roof: 'boxy',
    wheelLayout: 'four',
    length: 5.99,
    width: 2.04,
    height: 2.6,
    wheelbase: 3.64,
    track: 1.75,
    wheelRadius: 0.36,
    paint: 0xe6e6e0,
    accent: 0x2a2d30,
    engine: '2.0 TDI',
    displacementCc: 1968,
    powerCv: 177,
    torqueNm: 410,
    rpmTorque: 1500,
    rpmPower: 3600,
    redlineRpm: 4500,
    idleRpm: 750,
    gears: 8,
    driven: 'fwd',
    mass: 2400,
    topSpeedKmh: 160,
    zeroTo100S: 12,
    reverseKmh: 25,
    grip: 0.9,
    rollResistance: 0.019,
    brakeDecel: 9.5,
    maxSteer: 0.55,
    offroadFactor: 0.6,
  }),
  spec({
    id: 'volkswagen-golf-gti-2025',
    name: 'Volkswagen Golf GTI (2025)',
    blurb: '2.0 TSI da 265 CV, DSG: fuori lista, licenza Sketchfab Standard',
    style: 'hatch',
    roof: 'sloped',
    wheelLayout: 'four',
    length: 4.29,
    width: 1.79,
    height: 1.46,
    wheelbase: 2.63,
    track: 1.54,
    wheelRadius: 0.33,
    paint: 0xc7c9cc,
    accent: 0x9c2f26,
    engine: '2.0 TSI',
    displacementCc: 1984,
    powerCv: 265,
    torqueNm: 370,
    rpmTorque: 1600,
    rpmPower: 5000,
    redlineRpm: 6800,
    idleRpm: 800,
    gears: 7,
    driven: 'fwd',
    mass: 1465,
    topSpeedKmh: 250,
    zeroTo100S: 5.9,
    reverseKmh: 30,
    grip: 1.02,
    rollResistance: 0.013,
    brakeDecel: 10.6,
    maxSteer: 0.53,
    offroadFactor: 0.45,
  }),
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

/** Etichetta compatta per HUD e menu: motore, potenza, velocita' massima. */
export function vehicleLabel(spec: VehicleSpec): string {
  const speed = spec.topSpeedKmh >= 100 ? `${spec.zeroTo100S.toFixed(1)} s` : `${spec.topSpeedKmh} km/h max`;
  return `${spec.engine} - ${spec.powerCv} CV - ${spec.topSpeedKmh} km/h - 0-100 ${speed}`;
}

/** Rapporti del cambio: quelli reali se forniti, altrimenti un set tipico. */
function ratiosFor(spec: VehicleSpec): readonly number[] {
  if (spec.gearRatios && spec.gearRatios.length > 0) return spec.gearRatios;
  if (spec.gears === 1) return SINGLE_SPEED;
  if (spec.gears === 8) return EIGHT_SPEED;
  if (spec.gears === 7) return SEVEN_SPEED;
  if (spec.gears === 6) return SIX_SPEED;
  if (spec.gears === 4) return FOUR_SPEED;
  return FIVE_SPEED;
}

/**
 * Rapporto finale: l'ultima marcia tocca il regime di potenza massima a
 * velocita' massima.
 *
 * Le elettriche hanno una sola marcia e il motore arriva al limitatore: il
 * rapporto va quindi calcolato sul regime massimo, non sul regime di potenza
 * massima (che e' molto piu' in basso). Con il regime di potenza la Cybertruck
 * resterebbe con un finale troppo corto e uno 0-100 da furgone diesel.
 */
function finalDriveFor(spec: VehicleSpec, ratios: readonly number[]): number {
  const vmax = spec.topSpeedKmh / 3.6;
  const topRatio = ratios[ratios.length - 1] ?? 1;
  const topRpm = spec.gears === 1 ? spec.redlineRpm : spec.rpmPower;
  const omegaTop = (topRpm * Math.PI) / 30;
  return (omegaTop * spec.wheelRadius) / (vmax * topRatio);
}

/**
 * CdA ricavato dalla velocita' massima: a quella velocita' la potenza alle ruote
 * pareggia rotolamento e resistenza aerodinamica.
 *
 * Si tiene un margine del 6%: cosi' la vettura tocca davvero la velocita'
 * dichiarata (e il limitatore la ferma li') anche con gli attriti del modello,
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
  const ratios = ratiosFor(spec);
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

/** True se l'utente ha gia' scelto una tinta per quel veicolo. */
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
    // localStorage puo' essere disabilitato
  }
}

const STORAGE_KEY = 'molise.vehicle';

export function loadVehicleId(): string {
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (!saved) return VEHICLES[0].id;
    // solo se il modello esiste davvero: un'auto importata puo' non essere
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
    // localStorage puo' essere disabilitato
  }
}

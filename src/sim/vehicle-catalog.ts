/**
 * Catalogo veicoli.
 *
 * Le sagome sono ricostruzioni procedurali originali, non modelli ufficiali:
 * ogni voce descrive proporzioni, carrozzeria, colore e parametri di guida.
 * I valori meccanici sono stime di gioco, non specifiche tecniche verificate.
 */

export type BodyStyle = 'hatch' | 'suv' | 'crossover' | 'trike';
export type RoofStyle = 'boxy' | 'sloped' | 'flat';
export type WheelLayout = 'four' | 'three';

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
  /** stime di gioco */
  maxSpeed: number;
  engineAccel: number;
  brakeDecel: number;
  maxSteer: number;
  offroadFactor: number;
  mass: number;
}

const BASE = {
  reverseSpeed: 8.5,
  offroadGrip: 0.58,
  dragLinear: 0.16,
  dragQuadratic: 0.0009,
  gravity: 9.81,
} as const;

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
    maxSpeed: 31,
    engineAccel: 8.6,
    brakeDecel: 18,
    maxSteer: 0.6,
    offroadFactor: 0.72,
    mass: 780,
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
    maxSpeed: 34,
    engineAccel: 9,
    brakeDecel: 19,
    maxSteer: 0.55,
    offroadFactor: 0.64,
    mass: 940,
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
    maxSpeed: 36,
    engineAccel: 9.4,
    brakeDecel: 20,
    maxSteer: 0.52,
    offroadFactor: 0.6,
    mass: 1020,
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
    maxSpeed: 38,
    engineAccel: 9.8,
    brakeDecel: 21,
    maxSteer: 0.5,
    offroadFactor: 0.86,
    mass: 1320,
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
    maxSpeed: 30,
    engineAccel: 8,
    brakeDecel: 17,
    maxSteer: 0.66,
    offroadFactor: 0.5,
    mass: 620,
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
    maxSpeed: 37,
    engineAccel: 9.6,
    brakeDecel: 20,
    maxSteer: 0.51,
    offroadFactor: 0.7,
    mass: 1270,
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
    maxSpeed: 37,
    engineAccel: 9.5,
    brakeDecel: 20,
    maxSteer: 0.52,
    offroadFactor: 0.66,
    mass: 1240,
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
    maxSpeed: 35,
    engineAccel: 9.2,
    brakeDecel: 19,
    maxSteer: 0.54,
    offroadFactor: 0.6,
    mass: 1090,
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
    maxSpeed: 39,
    engineAccel: 10,
    brakeDecel: 21,
    maxSteer: 0.53,
    offroadFactor: 0.68,
    mass: 1280,
  },
];

export function getVehicle(id: string | null | undefined): VehicleSpec {
  return VEHICLES.find((v) => v.id === id) ?? VEHICLES[0];
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

/** Parametri fisici derivati, pronti per `stepCar`. */
export function tuningFor(spec: VehicleSpec) {
  return {
    maxSpeed: spec.maxSpeed,
    reverseSpeed: BASE.reverseSpeed,
    engineAccel: spec.engineAccel,
    brakeDecel: spec.brakeDecel,
    offroadSpeedFactor: spec.offroadFactor,
    offroadGrip: BASE.offroadGrip,
    wheelbase: spec.wheelbase,
    track: spec.track,
    maxSteer: spec.maxSteer,
    dragLinear: BASE.dragLinear,
    dragQuadratic: BASE.dragQuadratic,
    gravity: BASE.gravity,
  } as const;
}

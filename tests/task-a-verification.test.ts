import { describe, expect, it } from 'vitest';
import {
  createCarState,
  stepCar,
  type CarEnv,
  type CarInput,
  type CarState,
  type CarTuning,
} from '../src/sim/car';
import { getVehicle, tuningFor, VEHICLES } from '../src/sim/vehicle-catalog';

/**
 * Verifiche quantitative del Task A: le prove esistenti dicono che il modello
 * «non fa i kart», qui si confrontano ABS/no-ABS, schemi di trazione e
 * comportamento a frame rate diversi con numeri misurabili.
 */

const road: CarEnv = { onRoad: true, groundHeight: () => 100 };
const gas: CarInput = { throttle: 1, brake: 0, steer: 0, handbrake: false };
const brake: CarInput = { throttle: 0, brake: 1, steer: 0, handbrake: false };
const coast: CarInput = { throttle: 0, brake: 0, steer: 0, handbrake: false };

function run(
  tuning: CarTuning,
  input: CarInput,
  seconds: number,
  start: CarState = createCarState(0, 0, 0),
  env: CarEnv = road,
  dt = 1 / 60,
): { state: CarState; steps: number } {
  let state = start;
  const steps = Math.round(seconds / dt);
  for (let i = 0; i < steps; i++) state = stepCar(state, input, env, dt, tuning);
  return { state, steps };
}

function stopDistance(tuning: CarTuning, env: CarEnv = road): { distance: number; maxSliding: number; absSeen: boolean } {
  let state: CarState = { ...createCarState(0, 0, 0), speed: 100 / 3.6, gear: 5 };
  const z0 = state.z;
  let t = 0;
  let maxSliding = 0;
  let absSeen = false;
  while (t < 25 && state.speed > 0.01) {
    state = stepCar(state, brake, env, 1 / 60, tuning);
    t += 1 / 60;
    maxSliding = Math.max(maxSliding, state.sliding);
    absSeen ||= state.absActive === true;
  }
  return { distance: Math.abs(state.z - z0), maxSliding, absSeen };
}

describe('Task A — frenata e ABS', () => {
  it('l’ABS interviene e lo stesso veicolo senza ABS blocca di più le ruote', () => {
    const base = tuningFor(getVehicle('fiat-punto-2011'));
    const withAbs = stopDistance({ ...base, abs: true });
    const withoutAbs = stopDistance({ ...base, abs: false });

    expect(withAbs.absSeen).toBe(true);
    expect(withoutAbs.absSeen).toBe(false);
    // Senza ABS la ruota va oltre il picco di aderenza: lo slittamento massimo
    // deve essere maggiore, non solo «diverso».
    expect(withoutAbs.maxSliding).toBeGreaterThan(withAbs.maxSliding);
    expect(withAbs.distance).toBeGreaterThan(15);
    expect(withAbs.distance).toBeLessThan(70);
    expect(withoutAbs.distance).toBeGreaterThan(15);
    expect(withoutAbs.distance).toBeLessThan(80);
  });

  it('sull’asfalto bagnato la frenata è più lunga che sull’asciutto', () => {
    const tuning = tuningFor(getVehicle('fiat-punto-2011'));
    const dry = stopDistance(tuning);
    const wet = stopDistance(tuning, {
      ...road,
      weather: { wetness: 1, standingWater: 0.55 },
    });
    expect(wet.distance).toBeGreaterThan(dry.distance * 1.1);
    expect(Number.isFinite(wet.distance)).toBe(true);
  });

  it('ogni veicolo frena in una distanza coerente con la propria decelerazione', () => {
    for (const spec of VEHICLES) {
      const tuning = tuningFor(spec);
      const measured = stopDistance(tuning).distance;
      // v² / (2a) è lo spazio ideale; il modello aggiunge rotolamento e
      // ripartizione di frenata, quindi si accetta una forchetta prudente.
      const ideal = (100 / 3.6) ** 2 / (2 * spec.brakeDecel);
      expect(measured, `${spec.name}: ${measured.toFixed(1)} m`).toBeGreaterThan(ideal * 0.6);
      expect(measured, `${spec.name}: ${measured.toFixed(1)} m`).toBeLessThan(ideal * 1.7);
    }
  });
});

describe('Task A — schemi di trazione', () => {
  it('AWD parte più forte di FWD; RWD scarica il retrotreno e non resta indietro', () => {
    const spec = VEHICLES.find((vehicle) => vehicle.id === 'ferrari-laferrari')!;
    const base = tuningFor(spec);
    const launch = (layout: 'fwd' | 'rwd' | 'awd', share: number): number => {
      const tuning: CarTuning = { ...base, drive: layout, tractionShare: share };
      return run(tuning, gas, 3).state.speed;
    };
    const fwd = launch('fwd', 0.62);
    const rwd = launch('rwd', 0.85);
    const awd = launch('awd', 1);

    expect(fwd).toBeGreaterThan(0);
    expect(rwd).toBeGreaterThan(fwd * 1.05);
    expect(awd).toBeGreaterThan(fwd * 1.05);
    expect(awd).toBeGreaterThanOrEqual(rwd * 0.99);
  });
});

describe('Task A — sterzo e stabilità', () => {
  it('a 30 km/h ogni auto chiude la curva in un raggio da auto, non da tram', () => {
    for (const spec of VEHICLES) {
      if (spec.style === 'motorcycle' || spec.style === 'trike') continue;
      const tuning = tuningFor(spec);
      let state: CarState = { ...createCarState(0, 0, 0), speed: 30 / 3.6, gear: 2 };
      let travelled = 0;
      for (let i = 0; i < 60 * 3; i++) {
        state = stepCar(state, { throttle: 0.35, brake: 0, steer: 1, handbrake: false }, road, 1 / 60, tuning);
        state = { ...state, speed: 30 / 3.6 };
        travelled += Math.abs(state.speed) / 60;
      }
      const turned = Math.abs(state.yaw);
      const radius = travelled / Math.max(0.001, turned);
      expect(radius, `${spec.name}: raggio ${radius.toFixed(1)} m`).toBeGreaterThan(4);
      expect(radius, `${spec.name}: raggio ${radius.toFixed(1)} m`).toBeLessThan(14);
    }
  });

  it('30, 60 e 144 fps restano sulla stessa traiettoria, senza divergenze', () => {
    const tuning = tuningFor(getVehicle('ferrari-laferrari'));
    // L'input è funzione del tempo, non dell'indice del frame: usare `i`
    // significherebbe confrontare una sinusoide a frequenza doppia a 60 fps e
    // attribuire alla fisica una divergenza che viene dalla prova stessa.
    const inputs = (t: number): CarInput => ({
      throttle: 0.7,
      brake: 0,
      steer: Math.sin(t * 1.6) * 0.55,
      handbrake: false,
    });
    const trace = (fps: number): CarState => {
      let state = createCarState(0, 0, 0);
      for (let i = 0; i < fps * 3; i++) state = stepCar(state, inputs(i / fps), road, 1 / fps, tuning);
      return state;
    };
    const a = trace(30);
    const b = trace(60);
    const c = trace(144);
    // I passi interni sono a 1/120 s: a 144 fps il passo esterno è più fine,
    // quindi si confronta la coerenza fisica, non l'uguaglianza bit a bit.
    expect(Math.abs(a.speed - b.speed)).toBeLessThan(Math.max(0.2, b.speed * 0.02));
    expect(Math.abs(c.speed - b.speed)).toBeLessThan(Math.max(0.2, b.speed * 0.02));
    expect(Math.abs(c.yaw - b.yaw)).toBeLessThan(0.35);
    expect(Math.abs(a.yaw - b.yaw)).toBeLessThan(0.35);
    expect(Number.isFinite(a.x + a.z + b.x + b.z + c.x + c.z)).toBe(true);
  });

  it('lasciare il gas non produce una velocità laterale fantasma', () => {
    const tuning = tuningFor(getVehicle('fiat-punto-2011'));
    const start: CarState = { ...createCarState(0, 0, 0), speed: 60 / 3.6, gear: 4 };
    const { state } = run(tuning, coast, 4, start);
    expect(Math.abs(state.vy)).toBeLessThan(0.05);
    expect(Math.abs(state.yaw)).toBeLessThan(0.05);
  });
});

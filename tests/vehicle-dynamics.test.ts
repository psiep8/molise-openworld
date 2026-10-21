import { describe, expect, it } from 'vitest';
import { createCarState, stepCar, type CarEnv, type CarInput, type CarState } from '../src/sim/car';
import { VEHICLES, tuningFor, vehicleLabel, type VehicleSpec } from '../src/sim/vehicle-catalog';

const road: CarEnv = { onRoad: true, groundHeight: () => 100 };
const grass: CarEnv = { onRoad: false, groundHeight: () => 100 };
const gas: CarInput = { throttle: 1, brake: 0, steer: 0, handbrake: false };
const coast: CarInput = { throttle: 0, brake: 0, steer: 0, handbrake: false };
const brake: CarInput = { throttle: 0, brake: 1, steer: 0, handbrake: false };

const dt = 1 / 60;

function drive(spec: VehicleSpec, input: CarInput, seconds: number, env = road, start?: CarState): CarState {
  const tuning = tuningFor(spec);
  let state = start ?? createCarState(0, 0, 0);
  for (let i = 0; i < Math.round(seconds / dt); i++) state = stepCar(state, input, env, dt, tuning);
  return state;
}

describe('prestazioni reali dei veicoli', () => {
  for (const spec of VEHICLES) {
    it(`${spec.name}: tocca la velocità massima dichiarata (${spec.topSpeedKmh} km/h) e non la supera`, () => {
      const kmh = drive(spec, gas, 150).speed * 3.6;
      expect(kmh).toBeLessThanOrEqual(spec.topSpeedKmh + 0.5);
      expect(kmh).toBeGreaterThan(spec.topSpeedKmh * 0.97);
    });

    it(`${spec.name}: lo 0-100 resta nella forchetta reale (${spec.zeroTo100S} s dichiarati)`, () => {
      const tuning = tuningFor(spec);
      let state = createCarState(0, 0, 0);
      let t = 0;
      while (t < 90 && state.speed * 3.6 < 100) {
        state = stepCar(state, gas, road, dt, tuning);
        t += dt;
      }
      expect(state.speed * 3.6).toBeGreaterThanOrEqual(100);
      // il modello non riproduce ogni perdita reale (frizione, gestione motore,
      // asfalto): ±35% sul dato di fabbrica è il compromesso dichiarato.
      expect(t).toBeGreaterThan(spec.zeroTo100S * 0.65);
      expect(t).toBeLessThan(spec.zeroTo100S * 1.35);
    });
  }

  it('nessun veicolo va oltre i 230 km/h e il tre ruote non è un missile', () => {
    for (const spec of VEHICLES) {
      expect(drive(spec, gas, 150).speed * 3.6).toBeLessThanOrEqual(230);
    }
    const trike = VEHICLES.find((v) => v.id === 'trike');
    expect(trike?.topSpeedKmh).toBeLessThan(200);
  });

  it('l’etichetta del menu riporta motore, potenza e velocità reale', () => {
    const label = vehicleLabel(VEHICLES[1]);
    expect(label).toContain('1.2 Fire 8V');
    expect(label).toContain('69 CV');
    expect(label).toContain('164 km/h');
  });
});

describe('cambio, partenza e frenata', () => {
  it('parte in prima e sale di marcia fino all’ultima', () => {
    const spec = VEHICLES[8]; // Junior, 6 marce
    const tuning = tuningFor(spec);
    let state = createCarState(0, 0, 0);
    const seen: number[] = [];
    for (let i = 0; i < 60 * 60; i++) {
      const gear = state.gear;
      state = stepCar(state, gas, road, dt, tuning);
      if (state.gear !== gear) seen.push(state.gear);
      expect(state.rpm).toBeLessThanOrEqual(spec.redlineRpm + 1);
      expect(state.rpm).toBeGreaterThanOrEqual(spec.idleRpm - 1);
    }
    expect(seen[0]).toBe(2);
    expect(seen).toEqual([2, 3, 4, 5, 6]);
    expect(state.gear).toBe(spec.gears);
  });

  it('scala marcia quando si rallenta senza frenare', () => {
    const spec = VEHICLES[7]; // C3, 5 marce
    const tuning = tuningFor(spec);
    let state = drive(spec, gas, 40);
    expect(state.gear).toBe(5);
    // a 100 km/h in quinta, lasciando il gas, il cambio deve scalare
    state = { ...state, speed: 100 / 3.6 };
    for (let i = 0; i < 60 * 20; i++) state = stepCar(state, coast, road, dt, tuning);
    expect(state.gear).toBeLessThan(5);
  });

  it('in prima il tre ruote pattina ma non si scompone', () => {
    const spec = VEHICLES[4];
    const tuning = tuningFor(spec);
    let state = createCarState(0, 0, 0);
    let spun = false;
    for (let i = 0; i < 60 * 2; i++) {
      state = stepCar(state, gas, road, dt, tuning);
      spun ||= state.wheelspin;
      expect(state.speed).toBeLessThan(spec.topSpeedKmh / 3.6);
    }
    expect(spun).toBe(true);
  });

  it('frena da 100 km/h in una distanza da auto vera', () => {
    for (const spec of VEHICLES) {
      const tuning = tuningFor(spec);
      let state: CarState = { ...createCarState(0, 0, 0), speed: 100 / 3.6, gear: 5 };
      const z0 = state.z;
      let t = 0;
      while (t < 20 && state.speed > 0.01) {
        state = stepCar(state, brake, road, dt, tuning);
        t += dt;
      }
      const distance = Math.abs(state.z - z0);
      expect(state.speed).toBe(0);
      // 100 km/h → 0: fra 30 e 55 m su asfalto asciutto
      expect(distance).toBeGreaterThan(30);
      expect(distance).toBeLessThan(55);
    }
  });

  it('da fermo il freno inserisce la retromarcia e la limita', () => {
    for (const spec of VEHICLES) {
      const tuning = tuningFor(spec);
      let state = createCarState(0, 0, 0);
      for (let i = 0; i < 60 * 8; i++) state = stepCar(state, brake, road, dt, tuning);
      expect(state.gear).toBe(-1);
      expect(state.speed).toBeLessThan(0);
      expect(Math.abs(state.speed) * 3.6).toBeLessThanOrEqual(spec.reverseKmh + 0.2);
    }
  });

  it('fuori strada va più piano che sull’asfalto', () => {
    const spec = VEHICLES[3];
    const tuning = tuningFor(spec);
    let onRoad = createCarState(0, 0, 0);
    let offRoad = createCarState(0, 0, 0);
    for (let i = 0; i < 60 * 90; i++) {
      onRoad = stepCar(onRoad, gas, road, dt, tuning);
      offRoad = stepCar(offRoad, gas, grass, dt, tuning);
    }
    expect(offRoad.speed).toBeLessThan(onRoad.speed * 0.9);
  });

  it('è deterministica a parità di input', () => {
    const a = drive(VEHICLES[3], gas, 40);
    const b = drive(VEHICLES[3], gas, 40);
    expect(a).toEqual(b);
  });
});

import { describe, expect, it } from 'vitest';
import { createCarState, speedKmh, stepCar, type CarEnv, type CarInput } from '../src/sim/car';
import { getVehicle, tuningFor } from '../src/sim/vehicle-catalog';

const flat: CarEnv = { onRoad: true, groundHeight: () => 100 };
const gas: CarInput = { throttle: 1, brake: 0, steer: 0, handbrake: false };

describe('guida credibile', () => {
  it('la Uno vecchia non arriva a 100 km/h in pochi secondi', () => {
    const tuning = tuningFor(getVehicle('fiat-uno-1994'));
    let s = createCarState(0, 0, 0);
    let t = 0;
    while (speedKmh(s.speed) < 100 && t < 60) {
      s = stepCar(s, gas, flat, 1 / 60, tuning);
      t += 1 / 60;
    }
    // scheda tecnica: 16,2 s. La simulazione deve restare vicina, non fare i kart.
    expect(t).toBeGreaterThan(11);
    expect(t).toBeLessThan(22);
  });

  it('a 50 km/h una sterzata piena non fa girare di 180° in un secondo', () => {
    const tuning = tuningFor(getVehicle('fiat-uno-1994'));
    let s = { ...createCarState(0, 0, 0), speed: 50 / 3.6 };
    for (let i = 0; i < 60; i++) s = stepCar(s, { ...gas, steer: 1 }, flat, 1 / 60, tuning);
    const deg = Math.abs(s.yaw) * (180 / Math.PI);
    // una curva tranquilla: ~20°/s, non ~190°/s
    expect(deg).toBeLessThan(50);
    expect(deg).toBeGreaterThan(8);
  });

  it('il freno a mano libera il retrotreno e produce velocità laterale', () => {
    const tuning = tuningFor(getVehicle('fiat-uno-1994'));
    const start = { ...createCarState(0, 0, 0), speed: 60 / 3.6 };
    let handbrake = start;
    let normal = start;
    for (let i = 0; i < 180; i++) {
      handbrake = stepCar(handbrake, { ...gas, steer: 1, handbrake: true }, flat, 1 / 60, tuning);
      normal = stepCar(normal, { ...gas, steer: 1, handbrake: false }, flat, 1 / 60, tuning);
    }
    expect(Math.abs(handbrake.yaw)).toBeGreaterThan(Math.PI / 2);
    expect(Math.abs(handbrake.vy)).toBeGreaterThan(Math.abs(normal.vy));
    expect(Math.abs(handbrake.vy)).toBeGreaterThan(1);
  });

  it.each([5, 30, 60, 144])('resta numericamente stabile a %s fps', (fps) => {
    const tuning = tuningFor(getVehicle('fiat-uno-1994'));
    let state = createCarState(0, 0, 0);
    for (let i = 0; i < fps * 5; i++) {
      state = stepCar(
        state,
        { throttle: 0.65, brake: 0, steer: Math.sin(i / 17) * 0.7, handbrake: false },
        { ...flat, weather: { wetness: 0.35, standingWater: 0.1 } },
        1 / fps,
        tuning,
      );
      expect(Number.isFinite(state.x + state.z + state.yaw + state.vx + state.vy + state.yawRate)).toBe(true);
    }
  });
});

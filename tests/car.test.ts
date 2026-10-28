import { describe, expect, it } from 'vitest';
import { createCarState, stepCar, type CarEnv, type CarInput } from '../src/sim/car';

const flat: CarEnv = { onRoad: true, groundHeight: () => 100 };
const grass: CarEnv = { onRoad: false, groundHeight: () => 100 };

const idle: CarInput = { throttle: 0, brake: 0, steer: 0, handbrake: false };
const gas: CarInput = { ...idle, throttle: 1 };

function run(steps: number, dt: number, env: CarEnv, start = createCarState(0, 0, 0), input = gas) {
  let state = start;
  for (let i = 0; i < steps; i++) state = stepCar(state, input, env, dt);
  return state;
}

describe('auto arcade', () => {
  it('parte da ferma e accelera verso nord (-z)', () => {
    const s = run(60, 1 / 60, flat);
    expect(s.speed).toBeGreaterThan(5);
    expect(s.z).toBeLessThan(-2);
    expect(Math.abs(s.x)).toBeLessThan(0.001);
  });

  it('frena fino a fermarsi e poi va in retromarcia', () => {
    const moving = { ...createCarState(0, 0, 0), speed: 12 };
    const braking = { ...idle, brake: 1 };
    let s = moving;
    for (let i = 0; i < 40; i++) s = stepCar(s, braking, flat, 1 / 60);
    expect(s.speed).toBeLessThan(12);
    for (let i = 0; i < 180; i++) s = stepCar(s, braking, flat, 1 / 60);
    expect(s.speed).toBeLessThan(0);
  });

  it('sterza solo in movimento e verso sinistra con input positivo', () => {
    const still = run(120, 1 / 60, flat, createCarState(0, 0, 0), { ...idle, steer: 1 });
    expect(still.yaw).toBeCloseTo(0, 9);

    const moving = { ...createCarState(0, 0, 0), speed: 10 };
    const left = run(30, 1 / 60, flat, moving, { ...idle, steer: 1 });
    const right = run(30, 1 / 60, flat, moving, { ...idle, steer: -1 });
    expect(left.yaw).toBeGreaterThan(0);
    expect(right.yaw).toBeLessThan(0);
    // sterzando a sinistra la traiettoria piega a ovest (x negativo). Con lo
    // sterzo addolcito la piega è più dolce di prima, ma il verso è quello.
    expect(left.x).toBeLessThan(-0.3);
  });

  it('fuori strada la velocità massima è più bassa', () => {
    const road = run(60 * 40, 1 / 60, flat);
    const offroad = run(60 * 40, 1 / 60, grass);
    expect(road.speed).toBeGreaterThan(offroad.speed);
    expect(offroad.speed).toBeLessThan(road.speed * 0.8);
  });

  it('ghiaia e terra limitano la velocità rispetto all’asfalto', () => {
    const asphalt = run(60 * 45, 1 / 60, { ...flat, surface: 'asphalt' });
    const gravel = run(60 * 45, 1 / 60, { ...flat, surface: 'gravel' });
    const dirt = run(60 * 45, 1 / 60, { ...flat, surface: 'dirt' });
    expect(gravel.speed).toBeLessThan(asphalt.speed);
    expect(dirt.speed).toBeLessThan(gravel.speed);
  });

  it('la minore aderenza della ghiaia riduce la risposta laterale', () => {
    const start = { ...createCarState(0, 0, 0), speed: 15 };
    const steer = { ...idle, steer: 1 };
    const asphalt = run(60, 1 / 60, { ...flat, surface: 'asphalt' }, start, steer);
    const gravel = run(60, 1 / 60, { ...flat, surface: 'gravel' }, start, steer);
    expect(gravel.yaw).toBeLessThan(asphalt.yaw);
  });

  it('la salita rallenta, la discesa accelera', () => {
    const uphill: CarEnv = {
      onRoad: true,
      groundHeight: (_x, z) => 100 + Math.max(0, -z) * 0.18,
    };
    const downhill: CarEnv = {
      onRoad: true,
      groundHeight: (_x, z) => 100 + Math.max(0, -z) * -0.18,
    };
    const start = { ...createCarState(0, 0, 0), speed: 15 };
    let up = start;
    let down = start;
    for (let i = 0; i < 120; i++) {
      up = stepCar(up, idle, uphill, 1 / 60);
      down = stepCar(down, idle, downhill, 1 / 60);
    }
    expect(up.speed).toBeLessThan(down.speed);
  });

  it('il freno a mano riduce la velocità più in fretta', () => {
    const start = { ...createCarState(0, 0, 0), speed: 20 };
    let normal = start;
    let hand = start;
    for (let i = 0; i < 60; i++) {
      normal = stepCar(normal, idle, flat, 1 / 60);
      hand = stepCar(hand, { ...idle, handbrake: true }, flat, 1 / 60);
    }
    expect(hand.speed).toBeLessThan(normal.speed);
  });

  it('non supera la velocità massima', () => {
    const s = run(60 * 60, 1 / 60, flat);
    expect(s.speed).toBeLessThanOrEqual(34.6);
  });

  it('è deterministica a parità di input', () => {
    const a = run(180, 1 / 60, flat);
    const b = run(180, 1 / 60, flat);
    expect(a).toEqual(b);
  });
});

import { describe, expect, it } from 'vitest';
import { autopilotInput, followTarget, wrapAngle } from '../src/sim/autopilot';
import type { CarState } from '../src/sim/car';

const state = (over: Partial<CarState> = {}): CarState => ({
  x: 0,
  z: 0,
  yaw: 0,
  speed: 0,
  steer: 0,
  gear: 1,
  rpm: 900,
  shiftTimer: 0,
  wheelspin: false,
  vx: 0,
  vy: 0,
  yawRate: 0,
  wheelSlip: {
    fl: { long: 0, lat: 0, load: 0.25, locked: false },
    fr: { long: 0, lat: 0, load: 0.25, locked: false },
    rl: { long: 0, lat: 0, load: 0.25, locked: false },
    rr: { long: 0, lat: 0, load: 0.25, locked: false },
  },
  sliding: 0,
  ...over,
});

/** Strada dritta lungo -z, quella che il muso guarda con yaw 0. */
const straight = { ax: 0, az: 0, bx: 0, bz: -100 };

describe('punto di inseguimento', () => {
  it('sta davanti alla macchina, lungo la strada', () => {
    const t = followTarget(straight, 0, -10, 0, 12);
    expect(t.x).toBeCloseTo(0, 6);
    expect(t.z).toBeCloseTo(-22, 6);
  });

  it('rispetta il verso di marcia anche se OSM disegna la via al contrario', () => {
    // auto che va verso +z su una via disegnata verso -z
    const t = followTarget(straight, 0, -10, Math.PI, 12);
    expect(t.z).toBeCloseTo(2, 6);
  });

  it('si aggancia alla centerline anche se l’auto è spostata di lato', () => {
    const t = followTarget(straight, 3.2, -10, 0, 12);
    expect(t.x).toBeCloseTo(0, 6);
  });
});

describe('autopilota', () => {
  it('sterza verso il punto davanti: a sinistra se è a sinistra', () => {
    // muso verso -z, punto a sinistra (-x)
    const input = autopilotInput(state({ z: 0 }), { x: -8, z: -12, cruise: 15 });
    expect(input.steer).toBeGreaterThan(0);
    expect(input.throttle).toBe(1);
  });

  it('raddrizza il volante quando è già in linea', () => {
    const input = autopilotInput(state({ z: 0, speed: 5 }), { x: 0, z: -12, cruise: 15 });
    expect(Math.abs(input.steer)).toBeLessThan(0.02);
  });

  it('in curva alza il piede invece di accelerare', () => {
    const straightInput = autopilotInput(state({ speed: 10 }), { x: 0, z: -12, cruise: 18 });
    const curveInput = autopilotInput(state({ speed: 10 }), { x: -6, z: -8, cruise: 18 });
    expect(straightInput.throttle).toBe(1);
    expect(curveInput.brake).toBeGreaterThanOrEqual(0);
    // l'errore di rotta riduce la crociera: il gas si stacca prima
    const faster = autopilotInput(state({ speed: 16 }), { x: 0, z: -12, cruise: 18 });
    const fasterCurve = autopilotInput(state({ speed: 16 }), { x: -6, z: -8, cruise: 18 });
    expect(faster.throttle).toBe(1);
    expect(fasterCurve.throttle).toBe(0);
  });


  it('rallenta PRIMA della curva guardando il punto lontano', () => {
    // il punto vicino è quasi dritto, quello lontano piega: senza anticipo
    // l'autopilota terrebbe il gas fino a essere dentro la curva
    const state10 = state({ speed: 12 });
    const near = { x: 1.5, z: -12, cruise: 18 };
    const far = { x: -10, z: -26 };
    const without = autopilotInput(state10, near);
    const withFar = autopilotInput(state10, near, far);
    expect(without.throttle).toBe(1);
    expect(withFar.throttle).toBe(0);
  });

  it('frena se è troppo veloce e si ferma se sta arretrando', () => {
    const fast = autopilotInput(state({ speed: 22 }), { x: 0, z: -12, cruise: 15 });
    expect(fast.brake).toBeGreaterThan(0);
    const reverse = autopilotInput(state({ speed: -2 }), { x: 0, z: -12, cruise: 15 });
    expect(reverse.throttle).toBe(0);
    expect(reverse.brake).toBe(1);
  });
});

describe('wrapAngle', () => {
  it('riporta gli angoli in -π…π', () => {
    expect(wrapAngle(Math.PI * 2 + 0.3)).toBeCloseTo(0.3, 9);
    expect(wrapAngle(-Math.PI * 2 - 0.3)).toBeCloseTo(-0.3, 9);
    expect(wrapAngle(Math.PI)).toBeCloseTo(Math.PI, 9);
  });
});

import { describe, expect, it } from 'vitest';
import { resolveBody, type CircleResolver } from '../src/sim/collision';

/** Muro a x = 5: tutto ciò che sta a destra viene riportato indietro. */
const wall: CircleResolver = {
  resolveCircle(x, z, radius) {
    const limit = 5 - radius;
    if (x <= limit) return { x, z, hit: false };
    return { x: limit, z, hit: true };
  },
};

const HALF_LENGTH = 1.4;
const HALF_WIDTH = 0.9;

describe('collisioni a rettangolo orientato', () => {
  it('senza ostacoli non tocca nulla', () => {
    const out = resolveBody(0, 0, 0, 20, HALF_LENGTH, HALF_WIDTH, [wall, undefined]);
    expect(out).toEqual({ x: 0, z: 0, speed: 20, hit: false, push: 0 });
  });

  it('ferma il muso prima del muro anche col centro ancora lontano', () => {
    // il muso guarda -z con yaw 0: per puntare a +x serve yaw negativo
    const headingRight = -Math.PI / 2;
    const out = resolveBody(4.5, 0, headingRight, 15, HALF_LENGTH, HALF_WIDTH, [wall]);
    expect(out.hit).toBe(true);
    // il centro arretra di quanto basta perché il muso non passi il muro
    expect(out.x).toBeLessThan(4.5);
    expect(out.x + HALF_LENGTH).toBeLessThanOrEqual(5.02);
  });

  it('copre anche i fianchi, non solo avantreno e retrotreno', () => {
    // macchina parallela al muro: nessuna sonda davanti o dietro lo tocca,
    // solo quella laterale
    const out = resolveBody(4.45, 0, 0, 10, HALF_LENGTH, HALF_WIDTH, [wall]);
    expect(out.hit).toBe(true);
    expect(out.x + HALF_WIDTH).toBeLessThanOrEqual(5.02);
  });

  it('un urto frontale toglie più velocità di uno di striscio', () => {
    const headingRight = -Math.PI / 2;
    // il muso tocca il muro quando il centro è a 5 - 1,4 = 3,6 m
    const frontal = resolveBody(4.2, 0, headingRight, 20, HALF_LENGTH, HALF_WIDTH, [wall]);
    const graze = resolveBody(3.62, 0, headingRight, 20, HALF_LENGTH, HALF_WIDTH, [wall]);
    expect(frontal.speed).toBeLessThan(graze.speed);
    expect(frontal.speed).toBeLessThan(20);
    expect(graze.speed).toBeGreaterThan(0);
  });

  it('regge resolver assenti e non produce NaN', () => {
    const out = resolveBody(0, 0, 0.3, 10, 1.2, 0.8, [null, undefined]);
    expect(out.hit).toBe(false);
    expect(Number.isFinite(out.x)).toBe(true);
    expect(Number.isFinite(out.z)).toBe(true);
  });
});

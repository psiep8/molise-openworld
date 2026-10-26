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

describe('collisioni a due cerchi', () => {
  it('senza ostacoli non tocca nulla', () => {
    const out = resolveBody(0, 0, 0, 20, 1.4, 0.9, [wall, undefined]);
    expect(out).toEqual({ x: 0, z: 0, speed: 20, hit: false, push: 0 });
  });

  it('ferma il muso prima del muro anche col centro ancora lontano', () => {
    // il muso guarda -z con yaw 0: per puntare a +x serve yaw negativo
    const headingRight = -Math.PI / 2;
    const out = resolveBody(4.5, 0, headingRight, 15, 1.4, 0.9, [wall]);
    expect(out.hit).toBe(true);
    // il centro arretra di quanto basta perché il muso non passi il muro
    expect(out.x).toBeLessThan(4.5);
    expect(out.x + 1.4 + 0.9).toBeLessThanOrEqual(5.05);
  });

  it('un urto frontale toglie più velocità di uno di striscio', () => {
    const headingRight = -Math.PI / 2;
    // il muso tocca il muro quando il centro è a 5 - 0.9 - 1.4 = 2,7 m
    const frontal = resolveBody(3.5, 0, headingRight, 20, 1.4, 0.9, [wall]);
    const graze = resolveBody(2.72, 0, headingRight, 20, 1.4, 0.9, [wall]);
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

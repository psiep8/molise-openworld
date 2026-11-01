import { describe, expect, it } from 'vitest';
import { armAxis, springArmLength, sweepArm, sweepArmCone } from '../src/gfx/camera-arm';

describe('sweepArm', () => {
  it('restituisce tutta la lunghezza quando non c’è nulla davanti', () => {
    expect(sweepArm({ x: 0, y: 2, z: 0 }, { x: 0, y: 0, z: 1 }, 6, () => false)).toBeCloseTo(6);
  });

  it('si ferma prima del muro con un margine', () => {
    const free = sweepArm(
      { x: 0, y: 2, z: 0 },
      { x: 0, y: 0, z: 1 },
      6,
      (_x, _y, z) => z >= 3,
      { clearance: 0.4, step: 0.2 },
    );
    expect(free).toBeGreaterThan(2.4);
    expect(free).toBeLessThanOrEqual(2.6);
  });

  it('non scende mai sotto la lunghezza minima, nemmeno col muro addosso', () => {
    const free = sweepArm({ x: 0, y: 2, z: 0 }, { x: 0, y: 0, z: 1 }, 4, () => true, { min: 0.7 });
    expect(free).toBeCloseTo(0.7);
  });

  it('normalizza la direzione: la lunghezza non dipende dal vettore passato', () => {
    const a = sweepArm({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }, 5, (_x, _y, z) => z > 4.5);
    const b = sweepArm({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 37 }, 5, (_x, _y, z) => z > 4.5);
    expect(a).toBeCloseTo(b);
  });

  it('con direzione nulla non produce NaN', () => {
    expect(sweepArm({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, 5, () => true)).toBeCloseTo(5);
  });
});

describe('sweepArmCone', () => {
  it('senza ostacoli restituisce la lunghezza piena', () => {
    expect(
      sweepArmCone({ x: 0, y: 2, z: 0 }, { x: 0, y: 0, z: 1 }, 6, () => false),
    ).toBeCloseTo(6);
  });

  it('vede un muro che sta di lato e ritira il braccio prima dell’occlusione', () => {
    // muro solo sul lato +x: il raggio centrale è libero, quelli inclinati no
    const allowed = sweepArmCone(
      { x: 0, y: 2, z: 0 },
      { x: 0, y: 0, z: 1 },
      6,
      (x) => x > 0.5,
      0.18,
      { step: 0.2, clearance: 0.2 },
    );
    expect(allowed).toBeLessThan(6);
    expect(allowed).toBeGreaterThan(0);
  });

  it('con apertura nulla è il raggio centrale', () => {
    const near = { x: 0, y: 2, z: 0 };
    const dir = { x: 0, y: 0, z: 1 };
    const a = sweepArmCone(near, dir, 5, (_x, _y, z) => z > 3, 0);
    const b = sweepArm(near, dir, 5, (_x, _y, z) => z > 3);
    expect(a).toBeCloseTo(b);
  });
});

describe('springArmLength', () => {
  it('accorcia verso lo spazio libero senza superarlo', () => {
    const next = springArmLength(6, 2.5, 6, 1 / 60);
    expect(next).toBeLessThan(6);
    expect(next).toBeGreaterThanOrEqual(2.5);
  });

  it('si allunga piano e non supera il limite', () => {
    const next = springArmLength(2.5, 6, 6, 1 / 60);
    expect(next).toBeGreaterThan(2.5);
    expect(next).toBeLessThanOrEqual(6);
  });

  it('accorcia più in fretta di quanto si allunghi', () => {
    const shorten = 6 - springArmLength(6, 3, 6, 1 / 60);
    const lengthen = springArmLength(3, 6, 6, 1 / 60) - 3;
    expect(shorten).toBeGreaterThan(lengthen * 2);
  });

  it('è continuo: passi piccoli, nessun teletrasporto', () => {
    let boom = 7;
    let prev = boom;
    for (let i = 0; i < 60; i++) {
      boom = springArmLength(boom, 1.2, 7, 1 / 60);
      expect(Math.abs(boom - prev)).toBeLessThan(1);
      prev = boom;
    }
    expect(boom).toBeCloseTo(1.2, 1);
  });

  it('non scende sotto il minimo e resta NaN-safe', () => {
    expect(springArmLength(7, 0, 7, 1 / 60, { min: 0.8 })).toBeGreaterThanOrEqual(0.8);
    const safe = springArmLength(Number.NaN, Number.NaN, Number.NaN, Number.NaN);
    expect(Number.isFinite(safe)).toBe(true);
  });
});

describe('armAxis', () => {
  it('restituisce direzione unitaria e lunghezza', () => {
    const axis = armAxis({ x: 0, y: 1, z: 0 }, { x: 0, y: 1, z: -4 });
    expect(axis.length).toBeCloseTo(4);
    expect(Math.hypot(axis.direction.x, axis.direction.y, axis.direction.z)).toBeCloseTo(1);
    expect(axis.direction.z).toBeCloseTo(-1);
  });

  it('con punti coincidenti non produce NaN', () => {
    const axis = armAxis({ x: 1, y: 1, z: 1 }, { x: 1, y: 1, z: 1 });
    expect(axis.length).toBe(0);
    expect(axis.direction).toEqual({ x: 0, y: 0, z: 0 });
  });
});

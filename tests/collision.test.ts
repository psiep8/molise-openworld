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

/**
 * Muro sottile a x = 5, spesso 20 cm: chi lo attraversa finisce dal lato
 * opposto e viene espulso in là. Serve a dimostrare che i sotto-passi del
 * veicolo non gli danno mai la possibilità di arrivarci.
 */
const thinWall: CircleResolver = {
  resolveCircle(x, z, radius) {
    if (x < 4.8 - radius) return { x, z, hit: false };
    if (x > 5.2 + radius) return { x, z, hit: false };
    const toLeft = x - (4.8 - radius);
    const toRight = 5.2 + radius - x;
    return toLeft < toRight ? { x: 4.8 - radius, z, hit: true } : { x: 5.2 + radius, z, hit: true };
  },
};

const HALF_LENGTH = 1.4;
const HALF_WIDTH = 0.9;

describe('collisioni a rettangolo orientato', () => {
  it('senza ostacoli non tocca nulla', () => {
    const out = resolveBody(0, 0, 0, 20, HALF_LENGTH, HALF_WIDTH, [wall, undefined]);
    expect(out).toEqual({ x: 0, z: 0, speed: 20, hit: false, push: 0, impact: 0, yawKick: 0 });
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
    // muso contro il muro: 20 m/s tutti normali
    const frontal = resolveBody(4.2, 0, headingRight, 20, HALF_LENGTH, HALF_WIDTH, [wall]);
    // auto quasi parallela al muro che lo sfiora di 10°: la velocità è per lo
    // più tangente, quindi la perdita deve essere piccola
    // yaw vicino a 0 = marcia lungo -z, cioè parallela al muro
    const graze = resolveBody(4.0, 0, -0.18, 20, HALF_LENGTH, HALF_WIDTH, [wall]);
    expect(graze.hit).toBe(true);
    expect(frontal.speed).toBeLessThan(graze.speed);
    expect(frontal.speed).toBeLessThan(1);
    expect(graze.speed).toBeGreaterThan(10);
  });

  it('la perdita di velocità cresce col quadrato della velocità normale', () => {
    const headingRight = -Math.PI / 2;
    const loss = (speed: number): number => {
      const out = resolveBody(4.2, 0, headingRight, speed, HALF_LENGTH, HALF_WIDTH, [wall]);
      return 1 - out.speed / speed;
    };
    const slow = loss(5);
    const fast = loss(10);
    const crash = loss(20);
    expect(slow).toBeLessThan(fast);
    expect(fast).toBeLessThan(crash);
    // 20 m/s frontali: quasi ferma, non un "urto di striscio"
    expect(crash).toBeGreaterThan(0.9);
  });

  it('un urto eccentrico dà impulso di imbardata, uno centrato no', () => {
    const headingRight = -Math.PI / 2;
    // muso contro il muro: entrambe le sonde anteriori toccano, coppia nulla
    const centered = resolveBody(4.2, 0, headingRight, 20, HALF_LENGTH, HALF_WIDTH, [wall]);
    // auto obliqua: solo l'angolo anteriore destro tocca, il muso gira
    const angled = resolveBody(4.15, 0.35, headingRight + 0.18, 18, HALF_LENGTH, HALF_WIDTH, [wall]);
    expect(Math.abs(centered.yawKick)).toBeLessThan(1e-6);
    expect(Math.abs(angled.yawKick)).toBeGreaterThan(0);
  });

  it('con sotto-passi da 0,2 m non attraversa un muro di 20 cm a 120 km/h', () => {
    const headingRight = -Math.PI / 2;
    const speed = 120 / 3.6;
    for (const dt of [1 / 30, 1 / 60, 1 / 144]) {
      let x = 0;
      let s = speed;
      for (let frame = 0; frame < 240 && s > 0.01; frame++) {
        const steps = Math.ceil((Math.abs(s) * dt) / 0.2);
        for (let i = 0; i < steps; i++) {
          x += s * (dt / steps);
          const out = resolveBody(x, 0, headingRight, s, HALF_LENGTH, HALF_WIDTH, [thinWall]);
          x = out.x;
          s = out.speed;
        }
      }
      // il centro deve restare dal lato di partenza (muso a contatto, non oltre)
      expect(x).toBeLessThan(4.8);
    }
  });

  it('regge resolver assenti e non produce NaN', () => {
    const out = resolveBody(0, 0, 0.3, 10, 1.2, 0.8, [null, undefined]);
    expect(out.hit).toBe(false);
    expect(Number.isFinite(out.x)).toBe(true);
    expect(Number.isFinite(out.z)).toBe(true);
  });
});

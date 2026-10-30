import { describe, expect, it } from 'vitest';
import {
  adaptGlare,
  backlightExposure,
  glareFactor,
  sunDiskStrength,
  wetRoadRoughness,
} from '../src/gfx/backlight';

describe('fattore di controsole', () => {
  it('è 1 guardando il sole e 0 a 90°', () => {
    expect(glareFactor({ x: 0, y: 0, z: -1 }, { x: 0, y: 0, z: -1 })).toBeCloseTo(1, 6);
    expect(glareFactor({ x: 0, y: 0, z: -1 }, { x: -1, y: 0, z: 0 })).toBe(0);
  });

  it('cresce avvicinandosi al disco', () => {
    let previous = -1;
    for (const angle of [90, 70, 55, 40, 25, 10, 0]) {
      const rad = (angle * Math.PI) / 180;
      const value = glareFactor({ x: 0, y: 0, z: -1 }, { x: -Math.sin(rad), y: 0, z: -Math.cos(rad) });
      expect(value).toBeGreaterThanOrEqual(previous);
      previous = value;
    }
  });

  it('non esplode con direzioni nulle', () => {
    expect(glareFactor({ x: 0, y: 0, z: 0 }, { x: 0, y: 1, z: 0 })).toBe(0);
    expect(glareFactor({ x: 0, y: 1, z: 0 }, { x: 0, y: 0, z: 0 })).toBe(0);
  });
});

describe('adattamento dell\'occhio', () => {
  it('si chiude più in fretta di quanto si riapra', () => {
    const closing = adaptGlare(0, 1, 0.2);
    const opening = 1 - adaptGlare(1, 0, 0.2);
    expect(closing).toBeGreaterThan(opening);
    expect(closing).toBeLessThan(1);
    expect(opening).toBeGreaterThan(0);
  });

  it('non supera i limiti anche con dt enormi', () => {
    expect(adaptGlare(0, 1, 10)).toBeCloseTo(1, 3);
    expect(adaptGlare(1, 0, 10)).toBeLessThan(0.01);
    expect(adaptGlare(0.5, 2, 1)).toBeLessThanOrEqual(1);
    expect(adaptGlare(0.5, -1, 1)).toBeGreaterThanOrEqual(0);
  });
});

describe('esposizione in controsole', () => {
  it('abbassa la base ma non oltre il 60%', () => {
    const base = 0.62;
    const exposed = backlightExposure(base, 1, 0, 0, 1);
    expect(exposed).toBeLessThan(base);
    expect(exposed).toBeGreaterThan(base * 0.6);
    expect(exposed).toBeGreaterThan(0.35);
  });

  it('di notte non smorza nulla', () => {
    expect(backlightExposure(0.6, 1, 0, 0, 0)).toBeCloseTo(0.6, 6);
  });

  it('pioggia e neve riducono il bagliore perché il sole è già velato', () => {
    const clear = backlightExposure(0.62, 1, 0, 0, 1);
    expect(backlightExposure(0.62, 1, 1, 0, 1)).toBeGreaterThan(clear);
    expect(backlightExposure(0.62, 1, 0, 1, 1)).toBeGreaterThan(clear);
  });
});

describe('disco solare e asfalto bagnato', () => {
  it('il disco sparisce con pioggia o neve', () => {
    expect(sunDiskStrength(0, 0, 0)).toBeCloseTo(1, 6);
    expect(sunDiskStrength(0, 1, 0)).toBe(0);
    expect(sunDiskStrength(0, 0, 1)).toBeLessThan(0.2);
    expect(sunDiskStrength(1, 0, 0)).toBeLessThan(0.3);
  });

  it('la rugosità del bagnato non scende sotto 0,22', () => {
    expect(wetRoadRoughness(0)).toBeGreaterThanOrEqual(0.22);
    expect(wetRoadRoughness(1)).toBeGreaterThanOrEqual(0.22);
    expect(wetRoadRoughness(1)).toBeGreaterThan(wetRoadRoughness(0));
  });
});

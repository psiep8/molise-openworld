import { describe, expect, it } from 'vitest';
import { effectiveGrip, shouldSkid, skidIntensity, surfaceMaterial, type WheelSlip } from '../src/sim/surfaces';

describe('materiali delle superfici', () => {
  it('mantiene differenze di aderenza tra asfalto, terra, neve e ghiaccio', () => {
    const dry = { wetness: 0, snowPack: 0, iceRisk: 0 };
    expect(effectiveGrip('asphalt', dry)).toBeGreaterThan(effectiveGrip('dirt', dry));
    expect(effectiveGrip('dirt', dry)).toBeGreaterThan(effectiveGrip('snow', dry));
    expect(effectiveGrip('snow', dry)).toBeGreaterThan(effectiveGrip('ice', dry));
  });

  it('la pioggia penalizza l’asfalto e rende la terra più deformabile', () => {
    expect(effectiveGrip('asphalt', { wetness: 1 })).toBeLessThan(effectiveGrip('asphalt', { wetness: 0 }));
    expect(surfaceMaterial('dirt').sink).toBeGreaterThan(0);
    expect(surfaceMaterial('asphalt').sink).toBe(0);
  });

  it('aquaplaning riduce rapidamente il grip su asfalto bagnato', () => {
    const grip = effectiveGrip('asphalt', { wetness: 1, standingWater: 0.9 });
    expect(grip).toBeLessThan(effectiveGrip('asphalt', { wetness: 1, standingWater: 0 }));
  });

  it('genera segni deterministici in base allo slip e al carico ruota', () => {
    const slip: WheelSlip = { long: 0.4, lat: 0.2, load: 1, locked: false };
    expect(shouldSkid(slip, 'asphalt')).toBe(true);
    expect(shouldSkid(slip, 'ice')).toBe(false);
    expect(skidIntensity(slip)).toBeGreaterThan(0);
    expect(skidIntensity(slip)).toBeLessThanOrEqual(1);
  });
});

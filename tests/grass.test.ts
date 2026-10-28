import { describe, expect, it } from 'vitest';
import { COVER_CROP, COVER_DRY, COVER_MEADOW } from '../src/world/ground-mask';
import { grassBladeHeightScale } from '../src/world/grass';

describe('altezza dell’erba', () => {
  it('genera sterpaglia alta nella macchia e mantiene bassi i campi coltivati', () => {
    expect(grassBladeHeightScale(COVER_DRY, 10, 0, 1)).toBe(10);
    expect(grassBladeHeightScale(COVER_CROP, 10, 0.5, 1)).toBeCloseTo(3.4);
  });

  it('concentra l’erba alta sui bordi non battuti della strada', () => {
    expect(grassBladeHeightScale(COVER_MEADOW, 4, 0, 1)).toBe(10);
    expect(grassBladeHeightScale(COVER_MEADOW, 1, 0.5, 1)).toBeCloseTo(3.4);
  });

  it('rifiuta parametri non finiti e limita i roll di altezza', () => {
    expect(grassBladeHeightScale(COVER_DRY, 10, 0, 2)).toBe(10);
    expect(() => grassBladeHeightScale(COVER_DRY, Number.NaN, 0, 0)).toThrow(RangeError);
  });
});

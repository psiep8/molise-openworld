import { describe, expect, it } from 'vitest';
import { COVER_CROP, COVER_DRY, COVER_MEADOW } from '../src/world/ground-mask';
import { grassBladeHeightScale } from '../src/world/grass';

describe('altezza dell’erba', () => {
  it('stratifica il prato: sterpaglie alte, erba media e qualche ciuffo basso', () => {
    // sterpaglia: 4,4-7 × 0,17 m ≈ 0,75-1,2 m da terra
    expect(grassBladeHeightScale(COVER_MEADOW, 10, 0.2, 0)).toBeCloseTo(4.4);
    expect(grassBladeHeightScale(COVER_MEADOW, 10, 0.2, 1)).toBeCloseTo(7);
    // erba media: 0,4-0,6 m
    expect(grassBladeHeightScale(COVER_MEADOW, 10, 0.7, 1)).toBeCloseTo(3.8);
    // il resto resta corto: 0,2-0,3 m
    expect(grassBladeHeightScale(COVER_MEADOW, 10, 0.95, 1)).toBeCloseTo(2.1);
  });

  it('tiene corto il coltivo e alta la macchia secca', () => {
    // nei campi lavorati l'erba non deve invadere le colture
    expect(grassBladeHeightScale(COVER_CROP, 10, 0.5, 1)).toBeCloseTo(2.1);
    expect(grassBladeHeightScale(COVER_DRY, 10, 0.2, 1)).toBeCloseTo(7);
  });

  it('alza il ciglio della strada e rifiuta parametri non finiti', () => {
    // sul ciglio la sterpaglia è quasi sempre alta
    expect(grassBladeHeightScale(COVER_MEADOW, 4, 0.5, 0)).toBeCloseTo(4.4);
    // lontano dalla strada qualche ciuffo basso resta
    expect(grassBladeHeightScale(COVER_MEADOW, 1, 0.99, 0)).toBeCloseTo(1.2);
    expect(() => grassBladeHeightScale(COVER_DRY, Number.NaN, 0, 0)).toThrow(RangeError);
  });
});

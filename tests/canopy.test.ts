import { describe, expect, it } from 'vitest';
import { CanopyField, type CanopyMeta } from '../src/geo/canopy';

const meta: CanopyMeta = {
  source: 'test',
  license: 'CC BY 4.0',
  attribution: 'test',
  encoding: 'uint8, metri',
  step: 10,
  nx: 3,
  nz: 2,
  originX: -10,
  originZ: -5,
  lat: 41.87,
  lon: 14.77,
  metersPerDegLat: 111000,
  metersPerDegLon: 83000,
  minHeight: 0,
  maxHeight: 22,
  treeCells: 2,
  generatedAt: '2026-01-01T00:00:00.000Z',
};

describe('canopy height field', () => {
  it('interpola altezze e tratta 0 come assenza di albero', () => {
    const field = new CanopyField(meta, new Uint8Array([0, 10, 20, 0, 20, 10]));
    expect(field.heightAt(-10, -5)).toBe(0);
    expect(field.heightAt(0, -5)).toBe(10);
    expect(field.heightAt(5, -5)).toBeCloseTo(15, 5);
    expect(field.heightAt(0, 0)).toBeCloseTo(15, 5);
  });

  it('limita il campionamento ai bordi e conosce la copertura', () => {
    const field = new CanopyField(meta, new Uint8Array([0, 10, 20, 0, 20, 10]));
    expect(field.heightAt(-1000, -1000)).toBe(0);
    expect(field.heightAt(1000, 1000)).toBe(10);
    expect(field.covers(0, 0)).toBe(true);
    expect(field.covers(1000, 0)).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';
import { Heightfield, type HeightMeta, type StreamedElevationGrid } from '../src/geo/elevation';

const meta: HeightMeta = {
  source: 'test',
  license: 'test',
  attribution: 'test',
  encoding: 'int16-decimeters',
  step: 30,
  nx: 5,
  nz: 5,
  originX: -60,
  originZ: -60,
  lat: 45,
  lon: 10,
  metersPerDegLat: 111_320,
  metersPerDegLon: 78_700,
  minElevation: 0,
  maxElevation: 1200,
  generatedAt: '2026-01-01T00:00:00.000Z',
};

/** Rampa lineare in longitudine: 200 m a 9,9° + 10.000 m per grado. */
const ramp = (lon: number): number => 200 + (lon - 9.9) * 10_000;

/**
 * Griglia di quota su una fascia di 0,05° di longitudine. I valori sono in
 * decimetri, come nei tile veri (`int16-decimeters`).
 */
function grid(
  minLon: number,
  height: (lon: number) => number,
  width = 5,
  rows = 5,
): StreamedElevationGrid {
  const maxLon = minLon + 0.05;
  const values: number[] = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < width; col++) {
      const lon = minLon + (col / (width - 1)) * (maxLon - minLon);
      values.push(Math.round(height(lon) * 10));
    }
  }
  return { minLon, maxLon, minLat: 44.9, maxLat: 44.95, width, height: rows, values };
}

function sample(heights: Heightfield, lon: number, lat = 44.925): number {
  return heights.heightAt((lon - meta.lon) * meta.metersPerDegLon, (meta.lat - lat) * meta.metersPerDegLat);
}

describe('quote a tile', () => {
  it('il DEM locale resta la fonte dentro il suo rettangolo', () => {
    const heights = new Heightfield(meta, new Int16Array(meta.nx * meta.nz));
    heights.setStreamedTile('vicino', grid(9.99, () => 900));
    expect(heights.heightAt(0, 0)).toBe(0);
  });

  it('due tile adiacenti si incontrano sul confine senza gradini', () => {
    const heights = new Heightfield(meta, new Int16Array(meta.nx * meta.nz));
    heights.setStreamedTile('a', grid(9.9, ramp));
    heights.setStreamedTile('b', grid(9.95, ramp));
    const atSeam = sample(heights, 9.95);
    expect(atSeam).toBeCloseTo(700, 1);
    // appena a sinistra e a destra la rampa vale quello che deve
    expect(sample(heights, 9.949)).toBeCloseTo(690, 0);
    expect(sample(heights, 9.951)).toBeCloseTo(710, 0);
  });

  it('a parità di copertura vince la griglia più fine', () => {
    const heights = new Heightfield(meta, new Int16Array(meta.nx * meta.nz));
    const coarse = grid(9.9, () => 300, 2, 2);
    heights.setStreamedTile('coarse', coarse);
    expect(sample(heights, 9.95)).toBeCloseTo(300, 1);
    heights.setStreamedTile('fine', grid(9.9, ramp));
    expect(sample(heights, 9.95)).toBeCloseTo(700, 1);
    heights.removeStreamedTile('fine');
    expect(sample(heights, 9.95)).toBeCloseTo(300, 1);
  });

  it('senza tile la quota resta finita (rilievo procedurale)', () => {
    const heights = new Heightfield(meta, new Int16Array(meta.nx * meta.nz));
    const value = sample(heights, 9.95);
    expect(Number.isFinite(value)).toBe(true);
  });
});

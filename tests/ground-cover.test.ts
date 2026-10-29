import { describe, expect, it } from 'vitest';
import { detailRadiusFor, planGroundCover, type GroundCoverVariant } from '../src/world/ground-cover';

const meadow: GroundCoverVariant = {
  slug: 'ground-meadow-tile',
  footprint: 18,
  variant: 0,
  triangles: 17_278,
};

const flat = (): number => 12;

function plan(overrides: Partial<Parameters<typeof planGroundCover>[0]> = {}) {
  return planGroundCover({
    x: 0,
    z: 0,
    budget: 40,
    spacing: 16,
    heightAt: flat,
    variantAt: () => ({ asset: meadow }),
    ...overrides,
  });
}

describe('copertura continua delle zolle GLB', () => {
  it('pavimenta ogni cella piantabile senza buchi e con sovrapposizione', () => {
    const result = plan();
    expect(result.spots.length).toBeGreaterThan(30);
    expect(result.coverage).toBeCloseTo(1, 6);
    expect(result.blocked).toBe(0);
    expect(result.fill).toBeCloseTo(1, 6);

    // due celle adiacenti sulla stessa riga: la somma delle semi-impronte
    // supera la distanza fra i centri, quindi non c'è fessura
    const row = result.spots
      .filter((spot) => Math.abs(spot.z) < 1e-6)
      .sort((a, b) => a.x - b.x);
    expect(row.length).toBeGreaterThan(1);
    for (let i = 1; i < row.length; i++) {
      const previous = row[i - 1]!;
      const current = row[i]!;
      const gap = current.x - previous.x;
      const halfWidths =
        ((meadow.footprint * previous.scale!) / 2) + ((meadow.footprint * current.scale!) / 2);
      expect(gap).toBeLessThanOrEqual(halfWidths + 1e-9);
      expect(halfWidths).toBeGreaterThan(gap);
    }
  });

  it('rispetta il budget e ricava il raggio dal preset, non da un numero fisso', () => {
    const small = plan({ budget: 12 });
    const large = plan({ budget: 54 });
    expect(small.spots.length).toBeLessThanOrEqual(12);
    expect(large.spots.length).toBeLessThanOrEqual(54);
    expect(large.radius).toBeGreaterThan(small.radius);
    expect(large.radius).toBeLessThanOrEqual(60);
    expect(plan({ budget: 0 }).spots).toHaveLength(0);
  });

  it('lascia fuori strada, acqua e costruito ma li conta come non piantabili', () => {
    const result = plan({
      variantAt: (x) => (x < 2 ? null : { asset: meadow }),
    });
    expect(result.blocked).toBeGreaterThan(0);
    expect(result.coverage).toBeCloseTo(1, 6);
    expect(result.fill).toBeLessThan(1);
    for (const spot of result.spots) expect(spot.x).toBeGreaterThanOrEqual(2);
  });

  it('separa il livello vicino da quello lontano', () => {
    const result = plan({ budget: 54, spacing: 16 });
    expect(result.near).toBeGreaterThan(0);
    expect(result.far).toBeGreaterThan(0);
    expect(result.near + result.far).toBe(result.spots.length);
    for (const spot of result.spots) {
      const distance = Math.hypot(spot.x, spot.z);
      if (spot.lod === 1) expect(distance).toBeLessThanOrEqual(16 * 1.9 + 1e-9);
      else expect(distance).toBeGreaterThan(16 * 1.9 - 1e-9);
    }
  });

  it('stima i triangoli e usa il gradiente DEM per inclinare le zolle', () => {
    const sloped = plan({
      heightAt: (x, z) => 0.2 * x + 0.1 * z,
    });
    expect(sloped.triangles).toBeGreaterThanOrEqual(sloped.spots.length * meadow.triangles);
    for (const spot of sloped.spots) {
      expect(spot.slopeX).toBeCloseTo(0.2, 6);
      expect(spot.slopeZ).toBeCloseTo(0.1, 6);
      expect(spot.y).toBeCloseTo(0.2 * spot.x + 0.1 * spot.z + 0.035, 6);
    }
  });

  it('calcola un raggio di dettaglio limitato all’area davvero visibile', () => {
    expect(detailRadiusFor(0, 5)).toBe(0);
    expect(detailRadiusFor(10, 5)).toBeLessThanOrEqual(24);
    expect(detailRadiusFor(100, 5)).toBe(24);
  });
});

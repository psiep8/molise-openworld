import { describe, expect, it } from 'vitest';
import { groundAtEdge, planBuildingGrounding } from '../src/world/building-ground';
import type { Pt } from '../src/geo/geo';

/** Casa 8 × 10 m su un pendio dell'8% lungo x (0,08 m per metro). */
const footprint: Pt[] = [
  { x: 0, z: 0 },
  { x: 8, z: 0 },
  { x: 8, z: 10 },
  { x: 0, z: 10 },
];
const slope = (x: number): number => 0.08 * x;

describe('quota per facciata', () => {
  it('il portone sta alla quota del marciapiede davanti, non al punto più basso', () => {
    // lato 1 = (8,0)–(8,10): è il lato in salita, tutto a quota 0,64
    const plan = planBuildingGrounding(footprint, (x) => slope(x), 6.4, { frontEdge: 1 });
    expect(plan.groundFront).toBeCloseTo(0.64, 2);
    expect(groundAtEdge(footprint, 1, (x) => slope(x))).toBeCloseTo(0.64, 2);
    expect(plan.base).toBeLessThan(plan.groundMin);
    expect(plan.stories).toBe(2);
    expect(plan.balconyY).not.toBeNull();
  });

  it('su una facciata in pendenza la quota è la media del lato, non il punto più basso', () => {
    // lato 0 = (0,0)–(8,0): sale da 0 a 0,64, quindi davanti alla porta 0,32
    const plan = planBuildingGrounding(footprint, (x) => slope(x), 6.4, { frontEdge: 0 });
    expect(plan.groundFront).toBeCloseTo(0.32, 2);
    expect(groundAtEdge(footprint, 0, (x) => slope(x))).toBeCloseTo(0.32, 2);
    // la base resta sotto il punto più basso: a valle il muro non resta sospeso
    expect(plan.base).toBeCloseTo(-0.25, 2);
  });

  it('nessun balcone sotto il primo piano sopra la strada', () => {
    for (const frontEdge of [0, 1, 2, 3]) {
      const plan = planBuildingGrounding(footprint, (x) => slope(x), 6.4, { frontEdge });
      if (plan.balconyY === null) continue;
      expect(plan.balconyY).toBeGreaterThanOrEqual(plan.groundFront + 2.5);
    }
  });

  it('sul lato in salita il tetto sale per non affondare nel terreno', () => {
    const plan = planBuildingGrounding(footprint, (x) => slope(x), 3.0, {
      frontEdge: 0,
      minAboveUphill: 2.6,
    });
    expect(plan.topY).toBeGreaterThanOrEqual(plan.groundMax + 2.6);
    expect(plan.topY).toBeGreaterThanOrEqual(plan.groundFront + 3.0 - 1e-9);
  });

  it('il dislivello finisce nel basamento, non nei piani', () => {
    const plan = planBuildingGrounding(footprint, (x) => slope(x), 6.4, { frontEdge: 0 });
    expect(plan.foundation).toBeCloseTo(plan.groundFront - plan.groundMin, 6);
    expect(plan.base).toBeLessThanOrEqual(plan.groundMin);
  });

  it('la facciata in salita ha comunque il primo balcone a un piano di quota', () => {
    const plan = planBuildingGrounding(footprint, (x) => slope(x), 7.6, { frontEdge: 1 });
    expect(plan.groundFront).toBeCloseTo(0.64, 2);
    expect(plan.balconyY).not.toBeNull();
    expect(plan.balconyY! - plan.groundFront).toBeGreaterThanOrEqual(2.5);
  });

  it('su terreno piano lo zoccolo non diventa un piano in più', () => {
    const plan = planBuildingGrounding(footprint, () => 12, 6.4);
    expect(plan.groundMin).toBe(12);
    expect(plan.groundMax).toBe(12);
    expect(plan.base).toBeCloseTo(11.75, 6);
    expect(plan.stories).toBe(2);
  });

  it('rifiuta impronte e altezze degeneri', () => {
    expect(() => planBuildingGrounding([{ x: 0, z: 0 }, { x: 1, z: 0 }], () => 0, 6)).toThrow();
    expect(() => planBuildingGrounding(footprint, () => 0, 0)).toThrow();
  });
});

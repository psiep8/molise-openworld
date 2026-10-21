import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { clamp, pointInPolygon, type Pt } from '../src/geo/geo';
import { latLonToWorld } from '../src/config';
import { planHipRoof } from '../src/world/roof';

const rectangle: Pt[] = [
  { x: 0, z: 0 },
  { x: 10, z: 0 },
  { x: 10, z: 20 },
  { x: 0, z: 20 },
];

/** Impronta a U: il baricentro cade nel vuoto centrale. */
const uShape: Pt[] = [
  { x: 0, z: 0 },
  { x: 20, z: 0 },
  { x: 20, z: 20 },
  { x: 14, z: 20 },
  { x: 14, z: 6 },
  { x: 6, z: 6 },
  { x: 6, z: 20 },
  { x: 0, z: 20 },
];

describe('planHipRoof', () => {
  it('crea una falda per ogni lato della gronda', () => {
    const plan = planHipRoof(rectangle, 5, 2);
    expect(plan).not.toBeNull();
    expect(plan!.slopes).toHaveLength(4);
    expect(plan!.perimeter).toBeCloseTo(60, 6);
  });

  it('mette gronda alla base e colmo in quota', () => {
    const plan = planHipRoof(rectangle, 5, 2)!;
    for (const slope of plan.slopes) {
      for (const corner of slope.corners) {
        expect(corner.y).toBeGreaterThanOrEqual(5);
        expect(corner.y).toBeLessThanOrEqual(7);
      }
      // i primi due vertici sono in gronda, gli ultimi due sul colmo
      expect(slope.corners[0].y).toBe(5);
      expect(slope.corners[1].y).toBe(5);
      expect(slope.corners[2].y).toBe(7);
      expect(slope.corners[3].y).toBe(7);
      expect(slope.slopeLength).toBeGreaterThan(2);
    }
  });

  it('il colmo sta dentro l’impronta e più vicino al centro', () => {
    const plan = planHipRoof(rectangle, 0, 3)!;
    for (const p of plan.ridgeRing) {
      expect(pointInPolygon(p.x, p.z, rectangle)).toBe(true);
      expect(Math.hypot(p.x - 5, p.z - 10)).toBeLessThan(Math.hypot(10, 10));
    }
  });

  it('con `inset` maggiore il colmo è più piccolo', () => {
    const wide = planHipRoof(rectangle, 0, 2, 0.2)!;
    const narrow = planHipRoof(rectangle, 0, 2, 0.6)!;
    const spread = (ring: Pt[]): number => Math.max(...ring.map((p) => Math.hypot(p.x - 5, p.z - 10)));
    expect(spread(narrow.ridgeRing)).toBeLessThan(spread(wide.ridgeRing));
  });

  it('ricade sul tetto piatto quando il baricentro è fuori dall’impronta', () => {
    expect(pointInPolygon(10, 11.5, uShape)).toBe(false);
    expect(planHipRoof(uShape, 0, 2)).toBeNull();
  });

  it('rifiuta impronte degeneri', () => {
    expect(planHipRoof([{ x: 0, z: 0 }, { x: 1, z: 0 }], 0, 2)).toBeNull();
    expect(planHipRoof(rectangle, 0, 0)).toBeNull();
  });
});

describe('tetti sugli edifici reali di Palata', () => {
  interface RawOsm {
    buildings: { h: number; c: [number, number][] }[];
  }

  const ringArea = (points: Pt[]): number => {
    let a = 0;
    for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
      a += (points[j].x + points[i].x) * (points[j].z - points[i].z);
    }
    return Math.abs(a / 2);
  };

  const raw = JSON.parse(
    readFileSync(new URL('../public/geo/osm.json', import.meta.url), 'utf8'),
  ) as RawOsm;

  it('la maggior parte delle impronte OSM produce un tetto a falde', () => {
    let total = 0;
    let planned = 0;
    for (const b of raw.buildings) {
      const points = b.c.map(([lat, lon]) => latLonToWorld(lat, lon));
      const area = ringArea(points);
      if (points.length < 3 || area < 6) continue;
      total++;
      let cx = 0;
      let cz = 0;
      for (const p of points) {
        cx += p.x;
        cz += p.z;
      }
      cx /= points.length;
      cz /= points.length;
      const footprint = points.map((p) => ({ x: cx + (p.x - cx) * 1.045, z: cz + (p.z - cz) * 1.045 }));
      const rise = clamp(Math.sqrt(Math.max(4, area)) * 0.16, 1, 3.2);
      if (planHipRoof(footprint, 100, rise)) planned++;
    }
    expect(total).toBeGreaterThan(1000);
    expect(planned / total).toBeGreaterThan(0.8);
  });

  it('ogni falda sale dalla gronda al colmo e resta sopra l’impronta', () => {
    for (const b of raw.buildings.slice(0, 400)) {
      const points = b.c.map(([lat, lon]) => latLonToWorld(lat, lon));
      const area = ringArea(points);
      if (points.length < 4 || area < 12) continue;
      let cx = 0;
      let cz = 0;
      for (const p of points) {
        cx += p.x;
        cz += p.z;
      }
      cx /= points.length;
      cz /= points.length;
      const plan = planHipRoof(points, 0, 2.2);
      if (!plan) continue;
      for (const slope of plan.slopes) {
        expect(slope.corners[2].y).toBeCloseTo(plan.ridgeY, 6);
        expect(slope.corners[0].y).toBe(0);
      }
      for (const p of plan.ridgeRing) {
        expect(p.x).toBeGreaterThanOrEqual(Math.min(...points.map((q) => q.x)) - 1e-6);
        expect(p.x).toBeLessThanOrEqual(Math.max(...points.map((q) => q.x)) + 1e-6);
      }
    }
  });
});

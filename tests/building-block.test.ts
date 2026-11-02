import { describe, expect, it } from 'vitest';
import type { Pt } from '../src/geo/geo';
import { findSharedEdges, insetSharedEdges } from '../src/world/building-block';

const square = (x: number, z: number, size = 10): Pt[] => [
  { x, z },
  { x: x + size, z },
  { x: x + size, z: z + size },
  { x, z: z + size },
];

describe('muri comuni delle schiere', () => {
  it('riconosce il lato condiviso da due case attaccate', () => {
    const a = square(0, 0);
    const flags = findSharedEdges([a, square(10, 0)]);
    // lato 1 di A: (10,0) → (10,10); lato 3 di B: (10,10) → (10,0)
    expect(flags[0]).toEqual([false, true, false, false]);
    expect(flags[1]).toEqual([false, false, false, true]);
  });

  it('non segna nulla per case staccate o che si toccano solo in un angolo', () => {
    const flags = findSharedEdges([square(0, 0), square(30, 0), square(9.5, 9.5)]);
    expect(flags[0]!.every((v) => !v)).toBe(true);
    expect(flags[1]!.every((v) => !v)).toBe(true);
    expect(flags[2]!.every((v) => !v)).toBe(true);
  });

  it('rientra il muro comune di pochi centimetri, senza toccare gli altri lati', () => {
    const a = square(0, 0);
    const flags = findSharedEdges([a, square(10, 0)]);
    const moved = insetSharedEdges(a, flags[0]!, 0.05);
    expect(moved[1]!.x).toBeCloseTo(9.95, 6);
    expect(moved[2]!.x).toBeCloseTo(9.95, 6);
    expect(moved[0]).toEqual({ x: 0, z: 0 });
    expect(moved[3]).toEqual({ x: 0, z: 10 });
    // nessun punto resta sul muro del vicino
    expect(Math.max(...moved.map((p) => p.x))).toBeLessThan(10);
  });
});

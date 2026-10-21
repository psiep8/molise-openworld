import { describe, expect, it } from 'vitest';
import type { Pt } from '../src/geo/geo';
import { roundCorners } from '../src/world/roads';

/** Segmento dritto: nessun angolo, la polilinea non deve cambiare. */
const straight: Pt[] = [
  { x: 0, z: 0 },
  { x: 10, z: 0 },
  { x: 20, z: 0 },
];

/** Svolta a 90°: un solo vertice interno, il caso che nei nastri fa la cuspide. */
const corner: Pt[] = [
  { x: 0, z: 0 },
  { x: 20, z: 0 },
  { x: 20, z: 20 },
];

describe('roundCorners', () => {
  it('lascia intatta una polilinea dritta', () => {
    const out = roundCorners(straight, 22);
    expect(out).toHaveLength(straight.length);
    out.forEach((p, i) => {
      expect(p.x).toBeCloseTo(straight[i].x, 6);
      expect(p.z).toBeCloseTo(straight[i].z, 6);
    });
  });

  it('spezza il vertice di una svolta secca in due punti', () => {
    const out = roundCorners(corner, 22);
    expect(out).toHaveLength(4);
    // gli estremi restano quelli originali
    expect(out[0]).toEqual(corner[0]);
    expect(out[out.length - 1]).toEqual(corner[2]);
    // i due punti nuovi stanno sui lati, a 35% della lunghezza (7 m su 20 m)
    expect(out[1].x).toBeCloseTo(13, 5);
    expect(out[1].z).toBeCloseTo(0, 5);
    expect(out[2].x).toBeCloseTo(20, 5);
    expect(out[2].z).toBeCloseTo(7, 5);
  });

  it('non tocca curve dolci sotto la soglia', () => {
    const gentle: Pt[] = [
      { x: 0, z: 0 },
      { x: 10, z: 1 },
      { x: 20, z: 0 },
    ];
    expect(roundCorners(gentle, 22)).toHaveLength(3);
  });

  it('regge polilinee degeneri', () => {
    expect(roundCorners([], 22)).toHaveLength(0);
    expect(roundCorners([{ x: 1, z: 1 }], 22)).toHaveLength(1);
    expect(roundCorners([{ x: 0, z: 0 }, { x: 0, z: 0 }, { x: 5, z: 0 }], 22)).toHaveLength(3);
  });
});

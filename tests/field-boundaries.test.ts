import { describe, expect, it } from 'vitest';
import type { Heightfield } from '../src/geo/elevation';
import type { Pt } from '../src/geo/geo';
import {
  boundaryRings,
  boundarySamples,
  buildDitchGeometry,
  polylineSamples,
} from '../src/world/field-boundaries';

const square: Pt[] = [
  { x: 0, z: 0 },
  { x: 10, z: 0 },
  { x: 10, z: 10 },
  { x: 0, z: 10 },
];

const WALL_KINDS = new Set(['meadow', 'wood']);
const FENCE_KINDS = new Set(['vineyard']);

describe('boundaryRings', () => {
  it(' tiene solo le classi richieste e gli anelli chiusi', () => {
    const areas = [
      { kind: 'meadow', points: square },
      { kind: 'vineyard', points: square },
      { kind: 'residential', points: square },
      { kind: 'wood', points: square.slice(0, 2) }, // troppo corto
    ];
    expect(boundaryRings(areas, WALL_KINDS)).toHaveLength(1);
    expect(boundaryRings(areas, FENCE_KINDS)).toHaveLength(1);
  });
});

describe('boundarySamples', () => {
  it('campiona il perimetro a passo costante chiudendo l’anello', () => {
    const samples = boundarySamples(square, 2.5);
    // perimetro 40 m, passo 2,5 m: 16 campioni complessivi
    expect(samples).toHaveLength(16);
    expect(samples[0]!.x).toBeCloseTo(0, 6);
    expect(samples[0]!.z).toBeCloseTo(0, 6);
    // il resto del passo prosegue sul quarto lato senza duplicare l’origine
    const last = samples[15]!;
    expect(last.x).toBeCloseTo(0, 6);
    expect(last.z).toBeCloseTo(2.5, 6);
  });

  it('porta il residuo del passo da un lato al successivo', () => {
    // lato lungo 7 m con passo 5: un campione a 0 e il residuo (3 m) sul lato dopo
    const longSide: Pt[] = [
      { x: 0, z: 0 },
      { x: 7, z: 0 },
      { x: 7, z: 7 },
      { x: 0, z: 7 },
    ];
    const samples = boundarySamples(longSide, 5);
    // 0, 5 sul primo lato; residuo 3 sul secondo; residuo 1 sul terzo; residuo 4 sul quarto
    expect(samples.map((s) => [s.x, s.z])).toEqual([
      [0, 0],
      [5, 0],
      [7, 3],
      [6, 7],
      [1, 7],
      [0, 3],
    ]);
  });

  it('ruota il box lungo X in direzione del lato (yaw corretto)', () => {
    const samples = boundarySamples(square, 5);
    // lato +x: il box deve restare lungo x → rotation.y = 0
    expect(samples[0]!.yaw).toBeCloseTo(0, 6);
    // lato +z: box lungo z → atan2(-tz, tx) = atan2(-1, 0) = -π/2
    expect(samples.find((s) => s.x === 10)!.yaw).toBeCloseTo(-Math.PI / 2, 6);
  });
});

describe('polylineSamples', () => {
  it('non chiude il giro come farebbe un anello', () => {
    const path: Pt[] = [
      { x: 0, z: 0 },
      { x: 10, z: 0 },
      { x: 10, z: 10 },
    ];
    const samples = polylineSamples(path, 2.5);
    // solo i due lati (4 + 4), nessun ritorno in origine
    expect(samples).toHaveLength(8);
    expect(samples[7]!.x).toBeCloseTo(10, 6);
    expect(samples[7]!.z).toBeCloseTo(7.5, 6);
  });
});

describe('buildDitchGeometry', () => {
  const flat = { heightAt: () => 100, slopeAt: () => 0 } as unknown as Heightfield;

  it('restituisce null senza fossi', () => {
    expect(buildDitchGeometry([], flat)).toBeNull();
    expect(
      buildDitchGeometry([{ type: 'river', points: square }], flat),
    ).toBeNull();
  });

  it('cinque vertici per stazione e quote coerenti', () => {
    const geo = buildDitchGeometry(
      [{ type: 'ditch', points: [{ x: 0, z: 0 }, { x: 30, z: 0 }] }],
      flat,
    );
    expect(geo).not.toBeNull();
    const pos = geo!.getAttribute('position');
    // 30 m / passo 3 = 10 campioni + estremo finale → 11 stazioni × 5
    expect(pos.count).toBe(11 * 5);
    // letto sopra il terreno, rive più in alto del letto, bordi quasi al terreno
    // precisione float32 degli attributi: 4 cifre bastano a distinguere i livelli
    expect(pos.getY(2)).toBeCloseTo(100.05, 4); // letto
    expect(pos.getY(1)).toBeCloseTo(100.28, 4); // riva
    expect(pos.getY(0)).toBeCloseTo(100.02, 4); // bordo
    // il fosso è largo 3,4 m: i bordi sono a ±1,7 sulle z (normale al lato)
    expect(pos.getZ(0)).toBeCloseTo(-1.7, 6);
    expect(pos.getZ(4)).toBeCloseTo(1.7, 6);
    expect(geo!.getIndex()!.count).toBe(10 * 4 * 6);
  });
});

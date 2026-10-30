import { describe, expect, it } from 'vitest';
import { COVER_CROP, COVER_DRY, COVER_MEADOW, COVER_WOOD } from '../src/world/ground-mask';
import {
  groundAreaBlocksKit,
  groundGridCells,
  groundKitSlugAt,
  terrainSlopeAt,
} from '../src/world/ground-kit-rules';

describe('regole georeferenziate del ground kit', () => {
  const context = {
    cover: COVER_MEADOW,
    slopeDegrees: 2,
    distanceToRoad: 10,
    surface: null,
    seed: 0.4,
  };

  it('sceglie campo, bosco, prato, roccia e margine stradale dai dati', () => {
    expect(groundKitSlugAt({ ...context, cover: COVER_MEADOW })).toBe('ground-meadow-tile');
    expect(groundKitSlugAt({ ...context, cover: COVER_WOOD })).toBe('ground-meadow-tile');
    expect(groundKitSlugAt({ ...context, cover: COVER_CROP })).toBe('ground-field-tile');
    expect(groundKitSlugAt({ ...context, cover: COVER_DRY })).toBe('ground-field-tile');
    expect(groundKitSlugAt({ ...context, surface: 'rock' })).toBe('ground-bank-tile');
    expect(groundKitSlugAt({ ...context, distanceToRoad: 3.4 })).toBe('ground-bank-tile');
  });

  it('limita i modelli ai pendii compatibili e non mette fango sull’asciutto', () => {
    expect(groundKitSlugAt({ ...context, slopeDegrees: 24.01 })).toBeNull();
    expect(groundKitSlugAt({ ...context, distanceToRoad: -0.1 })).toBeNull();
    // terra asciutta: resta prato/coltivo, non una pozza di fango
    expect(groundKitSlugAt({ ...context, surface: 'dirt', seed: 0.8 })).toBe('ground-meadow-tile');
    expect(groundKitSlugAt({ ...context, surface: 'dirt', seed: 0.2 })).toBe('ground-meadow-tile');
    // suolo nudo in un coltivo: zolla di campo, non prato
    expect(
      groundKitSlugAt({ ...context, surface: 'dirt', seed: 0.2, cover: COVER_CROP }),
    ).toBe('ground-field-tile');
  });

  it('tiene la pietra solo su roccia o pendio vero, non sul prato dolce', () => {
    expect(groundKitSlugAt({ ...context, slopeDegrees: 18 })).toBe('ground-meadow-tile');
    expect(groundKitSlugAt({ ...context, slopeDegrees: 21 })).toBe('ground-bank-tile');
    expect(groundKitSlugAt({ ...context, cover: COVER_WOOD, seed: 0.95 })).toBe(
      'ground-meadow-tile',
    );
  });

  it('con la pioggia il fango aumenta e copre anche le praterie basse', () => {
    // la stessa cella di terra: asciutta resta campo, bagnata diventa fango
    expect(groundKitSlugAt({ ...context, surface: 'dirt', seed: 0.45, wetness: 0 })).toBe(
      'ground-meadow-tile',
    );
    expect(groundKitSlugAt({ ...context, surface: 'dirt', seed: 0.45, wetness: 0.9 })).toBe(
      'ground-mud',
    );
    expect(groundKitSlugAt({ ...context, cover: COVER_MEADOW, seed: 0.95, wetness: 0.9 })).toBe(
      'ground-mud',
    );
    expect(groundKitSlugAt({ ...context, cover: COVER_MEADOW, seed: 0.95, wetness: 0.2 })).toBe(
      'ground-meadow-tile',
    );
    expect(groundKitSlugAt({ ...context, cover: COVER_WOOD, seed: 0.5, wetness: 1 })).toBe(
      'ground-meadow-tile',
    );
  });

  it('rifiuta un bagnato fuori scala invece di scegliere una zolla a caso', () => {
    expect(() => groundKitSlugAt({ ...context, wetness: 1.4 })).toThrow(RangeError);
    expect(() => groundKitSlugAt({ ...context, wetness: Number.NaN })).toThrow(RangeError);
  });

  it('allinea il piano medio della zolla al gradiente DEM', () => {
    const slope = terrainSlopeAt((x, z) => 0.2 * x + 0.1 * z, 17, -4, 2);
    expect(slope.x).toBeCloseTo(0.2, 8);
    expect(slope.z).toBeCloseTo(0.1, 8);
    expect(slope.degrees).toBeCloseTo((Math.atan(Math.hypot(0.2, 0.1)) * 180) / Math.PI, 8);
  });

  it('non riveste poligoni georeferenziati di acqua o costruito', () => {
    const water = {
      kind: 'water',
      points: [
        { x: -5, z: -5 },
        { x: 5, z: -5 },
        { x: 5, z: 5 },
        { x: -5, z: 5 },
      ],
      bounds: { minX: -5, maxX: 5, minZ: -5, maxZ: 5 },
    };
    const residential = { ...water, kind: 'residential' };
    expect(groundAreaBlocksKit(0, 0, [water])).toBe(true);
    // l'area residenziale copre tutto il paese: se bloccasse le zolle, in centro
    // resterebbe il mosaico satellite invece del prato GLB
    expect(groundAreaBlocksKit(0, 0, [residential])).toBe(false);
    expect(groundAreaBlocksKit(0, 0, [{ ...water, kind: 'parking' }])).toBe(true);
    expect(groundAreaBlocksKit(8, 0, [water])).toBe(false);
    expect(groundAreaBlocksKit(0, 0, [{ ...water, kind: 'wood' }])).toBe(false);
  });

  it('genera la griglia in ordine stabile e riempie prima intorno al giocatore', () => {
    const first = groundGridCells(1, -2, 12, 4);
    const second = groundGridCells(1, -2, 12, 4);
    expect(first).toEqual(second);
    expect(first[0]).toEqual({ x: 0, z: -4 });
    const distances = first.map((point) => Math.hypot(point.x - 1, point.z + 2));
    expect(distances).toEqual([...distances].sort((a, b) => a - b));
  });
});

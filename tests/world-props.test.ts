import { describe, expect, it } from 'vitest';
import { QUALITY_ORDER } from '../src/gfx/quality';
import { WorldShrubField, signYaw, worldPropBudget } from '../src/world/world-props';

/**
 * Il budget del world kit decide quanto mondo esiste: se `minimal` non è a zero,
 * un PC che sceglie "Compatibilità" si carica comunque 58 alberi da 17k
 * triangoli; se i preset non crescono, `ultra` non si distingue da `media`.
 */
describe('worldPropBudget', () => {
  it('spegne tutto su minimal', () => {
    const budget = worldPropBudget('minimal');
    for (const value of Object.values(budget)) expect(value).toBe(0);
  });

  it('cresce con il preset, campo per campo', () => {
    for (let i = 1; i < QUALITY_ORDER.length; i++) {
      const previous = worldPropBudget(QUALITY_ORDER[i - 1]!);
      const current = worldPropBudget(QUALITY_ORDER[i]!);
      for (const key of Object.keys(current) as (keyof typeof current)[]) {
        expect(current[key], `${key} non cresce da ${QUALITY_ORDER[i - 1]} a ${QUALITY_ORDER[i]}`).toBeGreaterThanOrEqual(
          previous[key],
        );
      }
    }
  });

  it('tiene i casali fuori dai preset leggeri e li accende da media in su', () => {
    expect(worldPropBudget('low').house).toBe(0);
    expect(worldPropBudget('medium').house).toBeGreaterThan(0);
  });

  it('non promette più erba fotografica di quanta ne disegna il campo', () => {
    // WorldGrass chiede al massimo 400 ciuffi (GRASS_MAX), qualunque preset
    for (const level of QUALITY_ORDER) expect(worldPropBudget(level).grass).toBeLessThanOrEqual(400);
  });
});

/**
 * Il sottobosco del world kit non è un ostacolo, ma non è nemmeno asfalto:
 * attraversarlo deve costare velocità, altrimenti le felci sono decorazioni
 * trasparenti.
 */
describe('WorldShrubField', () => {
  const assets = [
    { size: { x: 2, z: 2 } } as never,
  ];
  const spot = (x: number, z: number, scale = 1) => ({ x, y: 0, z, yaw: 0, scale, variant: 0 });

  it('rallenta dentro la macchia e lascia libero fuori', () => {
    const field = new WorldShrubField([spot(0, 0)], assets);
    expect(field.factorAt(0.2, 0.2)).toBeCloseTo(0.55, 6);
    expect(field.factorAt(5, 5)).toBe(1);
  });

  it('scala il raggio con la scala dell’istanza', () => {
    const field = new WorldShrubField([spot(0, 0, 0.5)], assets);
    // raggio 0,8·0,5 = 0,4 m: a mezzo metro si è fuori
    expect(field.factorAt(0.2, 0)).toBeCloseTo(0.55, 6);
    expect(field.factorAt(0.5, 0)).toBe(1);
  });

  it('senza cespugli il passo è libero ovunque', () => {
    const field = new WorldShrubField([], []);
    expect(field.factorAt(123, -456)).toBe(1);
  });
});

/**
 * I cartelli hanno la faccia leggibile sul lato -X locale: se la rotazione è
 * sbagliata si vedono di taglio (o dal retro) e non servono a niente.
 */
describe('signYaw', () => {
  const headings: [number, number][] = [
    [1, 0],
    [0, 1],
    [-1, 0],
    [0, -1],
    [Math.SQRT1_2, Math.SQRT1_2],
    [-0.6, 0.8],
  ];

  it('gira la faccia (-X) contro chi arriva, qualunque sia la direzione', () => {
    for (const [tx, tz] of headings) {
      const yaw = signYaw(tx, tz);
      // rotazione attorno a Y di three: x' = x·cos + z·sin, z' = -x·sin + z·cos
      const faceX = -Math.cos(yaw);
      const faceZ = Math.sin(yaw);
      expect(faceX).toBeCloseTo(-tx, 6);
      expect(faceZ).toBeCloseTo(-tz, 6);
    }
  });
});

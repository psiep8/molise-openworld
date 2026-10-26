import { describe, expect, it } from 'vitest';
import { monthForGameDay, seasonTints } from '../src/world/landcover';

describe('stagioni della copertura del suolo', () => {
  it('parte a ottobre: stoppie gialle e boschi che virano al ruggine', () => {
    expect(monthForGameDay(1)).toBe(10);
    const october = seasonTints(10);
    // il canale rosso del coltivo sale, il blu scende: è la stoppia secca
    expect(october.plough[0]).toBeGreaterThan(october.plough[2]);
    expect(october.woodland[0]).toBeGreaterThan(october.woodland[2]);
    expect(october.strength).toBeGreaterThan(0.5);
  });

  it('tiene le tinte vicine a 1: devono spostare l’ora, non ridipingere il mondo', () => {
    for (let month = 1; month <= 12; month++) {
      const tint = seasonTints(month);
      for (const rgb of [tint.plough, tint.grass, tint.woodland, tint.rock]) {
        for (const value of rgb) {
          expect(value).toBeGreaterThan(0.7);
          expect(value).toBeLessThan(1.3);
        }
      }
      expect(tint.strength).toBeGreaterThan(0);
      expect(tint.strength).toBeLessThanOrEqual(0.7);
    }
  });

  it('interpola tra le stagioni e accetta mesi fuori scala', () => {
    const april = seasonTints(4);
    expect(april.grass[1]).toBeGreaterThan(april.grass[2]);
    expect(seasonTints(13)).toEqual(seasonTints(1));
    expect(seasonTints(0)).toEqual(seasonTints(12));
  });

  it('conta i mesi di 30 giorni a partire da ottobre', () => {
    expect(monthForGameDay(30)).toBe(10);
    expect(monthForGameDay(31)).toBe(11);
    expect(monthForGameDay(61)).toBe(12);
    expect(monthForGameDay(91)).toBe(1);
    expect(monthForGameDay(361)).toBe(10);
  });
});

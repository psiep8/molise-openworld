import { describe, expect, it } from 'vitest';
import {
  NEEDS_DECAY_PER_HOUR,
  advanceNeeds,
  applyNeedEffect,
  createInitialNeeds,
  needsWarning,
  sanitizeNeeds,
  sleepNeeds,
} from '../src/sim/needs';

describe('bisogni del personaggio', () => {
  it('parte con valori pieni e ragionevoli', () => {
    const needs = createInitialNeeds();
    expect(needs.hunger).toBeGreaterThan(50);
    expect(needs.energy).toBeGreaterThan(50);
    expect(needs.fun).toBeGreaterThan(50);
  });

  it('cala in modo proporzionale al tempo di gioco', () => {
    const start = createInitialNeeds();
    const afterHour = advanceNeeds(start, 60);
    expect(afterHour.hunger).toBeCloseTo(start.hunger - NEEDS_DECAY_PER_HOUR.hunger, 5);
    expect(afterHour.energy).toBeCloseTo(start.energy - NEEDS_DECAY_PER_HOUR.energy, 5);
    expect(afterHour.fun).toBeCloseTo(start.fun - NEEDS_DECAY_PER_HOUR.fun, 5);

    const afterHalf = advanceNeeds(start, 30);
    expect(afterHalf.hunger).toBeCloseTo(start.hunger - NEEDS_DECAY_PER_HOUR.hunger / 2, 5);
  });

  it('non scende sotto zero e non supera cento', () => {
    const starving = advanceNeeds(createInitialNeeds(), 10_000);
    expect(starving.hunger).toBe(0);
    expect(starving.energy).toBe(0);
    expect(starving.fun).toBe(0);

    const full = applyNeedEffect(createInitialNeeds(), { nutrition: 500, energy: 500, fun: 500 });
    expect(full.hunger).toBe(100);
    expect(full.energy).toBe(100);
    expect(full.fun).toBe(100);
  });

  it('mangiare e bere modificano fame, energia e divertimento', () => {
    const needs = { hunger: 20, energy: 30, fun: 40 };
    const fed = applyNeedEffect(needs, { nutrition: 30, energy: 12, fun: 5 });
    expect(fed).toEqual({ hunger: 50, energy: 42, fun: 45 });
  });

  it('dormire recupera energia e non azzera la fame', () => {
    const slept = sleepNeeds({ hunger: 40, energy: 10, fun: 30 });
    expect(slept.energy).toBe(100);
    expect(slept.hunger).toBe(36);
    expect(slept.fun).toBe(36);
  });

  it('avvisa quando un bisogno è basso, senza punizioni improvvise', () => {
    expect(needsWarning({ hunger: 80, energy: 80, fun: 80 })).toBeNull();
    expect(needsWarning({ hunger: 10, energy: 80, fun: 80 })).toContain('fame');
    expect(needsWarning({ hunger: 80, energy: 10, fun: 80 })).toContain('stanco');
    expect(needsWarning({ hunger: 80, energy: 80, fun: 10 })).toContain('annoi');
  });

  it('convalida i dati corrotti senza mandare in crash il gioco', () => {
    expect(sanitizeNeeds(null)).toEqual(createInitialNeeds());
    const fixed = sanitizeNeeds({ hunger: -50, energy: 999, fun: 'x' });
    expect(fixed.hunger).toBe(0);
    expect(fixed.energy).toBe(100);
    expect(fixed.fun).toBe(createInitialNeeds().fun);
  });
});

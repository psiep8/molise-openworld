import { describe, expect, it } from 'vitest';
import { advanceWetness, drivingWater, type WetnessInput, type WetnessState } from '../src/world/wetness';

const dryDay: WetnessInput = { targetWetness: 0.8, rain: 0.8, day: 1, wind: 10 };
const nightCalm: WetnessInput = { targetWetness: 0, rain: 0, day: 0, wind: 0 };

function simulate(state: WetnessState, input: WetnessInput, seconds: number, step = 1 / 30): WetnessState {
  let current = state;
  for (let t = 0; t < seconds; t += step) current = advanceWetness(current, input, step);
  return current;
}

describe('advanceWetness', () => {
  it('bagna in fretta: dopo dieci secondi di pioggia la pellicola è quasi al bersaglio', () => {
    const wet = simulate({ wetness: 0, standingWater: 0 }, dryDay, 10);
    expect(wet.wetness).toBeGreaterThan(0.72);
    expect(wet.wetness).toBeLessThanOrEqual(0.8);
  });

  it('asciuga lentamente e in modo continuo, non come un interruttore', () => {
    const wet: WetnessState = { wetness: 0.8, standingWater: 0.6 };
    const afterMinute = simulate(wet, nightCalm, 60);
    const afterTwo = simulate(wet, nightCalm, 120);
    const afterFive = simulate(wet, nightCalm, 300);
    expect(afterMinute.wetness).toBeGreaterThan(0.55);
    expect(afterMinute.wetness).toBeLessThan(0.8);
    expect(afterTwo.wetness).toBeGreaterThan(afterFive.wetness);
    expect(afterFive.wetness).toBeGreaterThan(0);
  });

  it('di giorno e con vento asciuga prima che di notte senza vento', () => {
    const wet: WetnessState = { wetness: 0.8, standingWater: 0.5 };
    const sunny = simulate(wet, { targetWetness: 0, rain: 0, day: 1, wind: 30 }, 120);
    const night = simulate(wet, nightCalm, 120);
    expect(sunny.wetness).toBeLessThan(night.wetness - 0.05);
  });

  it('le pozze restano dopo che la pellicola è quasi asciutta', () => {
    const soaked = simulate({ wetness: 0, standingWater: 0 }, dryDay, 120);
    expect(soaked.standingWater).toBeGreaterThan(0.4);
    const dried = simulate(soaked, nightCalm, 300);
    expect(dried.standingWater).toBeGreaterThan(dried.wetness);
    expect(dried.standingWater).toBeGreaterThan(0.15);
  });

  it('limita il passo: un frame lungo non asciuga come dieci minuti veri', () => {
    const wet: WetnessState = { wetness: 0.8, standingWater: 0.5 };
    const longFrame = advanceWetness(wet, nightCalm, 30);
    const quarter = advanceWetness(wet, nightCalm, 0.25);
    expect(longFrame.wetness).toBeCloseTo(quarter.wetness, 10);
  });

  it('resta dentro 0…1 e non produce NaN', () => {
    const safe = advanceWetness(
      { wetness: Number.NaN, standingWater: 4 },
      { targetWetness: 3, rain: Number.NaN, day: Number.NaN, wind: -10 },
      1 / 60,
    );
    expect(safe.wetness).toBeGreaterThanOrEqual(0);
    expect(safe.wetness).toBeLessThanOrEqual(1);
    expect(safe.standingWater).toBeGreaterThanOrEqual(0);
    expect(safe.standingWater).toBeLessThanOrEqual(1);
    expect(Number.isFinite(safe.wetness)).toBe(true);
  });
});

describe('drivingWater', () => {
  it('con la pioggia l’acqua ferma non supera la pellicola', () => {
    expect(drivingWater({ wetness: 0.4, standingWater: 0.9 }, 0.7)).toBeCloseTo(0.4);
  });

  it('senza pioggia le pozze restano e contano per l’aderenza', () => {
    expect(drivingWater({ wetness: 0.1, standingWater: 0.55 }, 0)).toBeCloseTo(0.55);
  });
});

import { describe, expect, it } from 'vitest';
import { setWind, windUniforms } from '../src/gfx/wind';

describe('vento sulle piante', () => {
  it('trasmette direzione e intensità del vento agli shader', () => {
    const { uWind } = windUniforms();

    setWind(30, 0);
    expect(uWind.value.x).toBeCloseTo(0);
    expect(uWind.value.y).toBeCloseTo(-1);

    setWind(15, 90);
    expect(uWind.value.x).toBeCloseTo(-0.5);
    expect(uWind.value.y).toBeCloseTo(0);
  });

  it('ferma l’oscillazione con calma e limita i venti estremi', () => {
    const { uWind } = windUniforms();

    setWind(0, 180);
    expect(uWind.value.length()).toBe(0);

    setWind(300, 90);
    expect(uWind.value.length()).toBeCloseTo(2.4);
  });

  it('rifiuta dati meteo non numerici', () => {
    expect(() => setWind(Number.NaN, 0)).toThrow('numeri finiti');
    expect(() => setWind(5, Number.POSITIVE_INFINITY)).toThrow('numeri finiti');
  });
});

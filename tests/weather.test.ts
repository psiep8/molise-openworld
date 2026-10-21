import { describe, expect, it } from 'vitest';
import { defaultWeather, fetchWeather, sunPosition, weatherLabel, isFogCode } from '../src/world/weather';

describe('sunPosition', () => {
  it('all’equatore e all’equinozio il sole è quasi allo zenit a mezzogiorno UTC', () => {
    const sun = sunPosition(new Date('2026-03-20T12:00:00Z'), 0, 0);
    expect(sun.elevation).toBeGreaterThan(85);
    expect(sun.elevation).toBeLessThanOrEqual(90);
  });

  it('a Palata a giugno il sole culmina vicino ai 71°', () => {
    const sun = sunPosition(new Date('2026-06-21T11:00:00Z'), 41.8905, 14.7854);
    // massimo teorico = 90 - latitudine + declinazione ≈ 71.6°
    expect(sun.elevation).toBeGreaterThan(67);
    expect(sun.elevation).toBeLessThan(74);
    expect(sun.azimuth).toBeGreaterThan(150);
    expect(sun.azimuth).toBeLessThan(230);
  });

  it('a Palata a dicembre il sole è molto più basso', () => {
    const sun = sunPosition(new Date('2026-12-21T11:00:00Z'), 41.8905, 14.7854);
    expect(sun.elevation).toBeGreaterThan(18);
    expect(sun.elevation).toBeLessThan(30);
  });

  it('all’alba e al tramonto reali di Palata il sole è sull’orizzonte', () => {
    // 21 ottobre 2026: alba 07:20 e tramonto 18:10 locali (UTC+2)
    const sunrise = sunPosition(new Date('2026-10-21T05:20:00Z'), 41.8905, 14.7854);
    const sunset = sunPosition(new Date('2026-10-21T16:10:00Z'), 41.8905, 14.7854);
    expect(Math.abs(sunrise.elevation)).toBeLessThan(2.5);
    expect(Math.abs(sunset.elevation)).toBeLessThan(2.5);
  });

  it('di notte l’elevazione è negativa', () => {
    const sun = sunPosition(new Date('2026-10-21T00:00:00Z'), 41.8905, 14.7854);
    expect(sun.elevation).toBeLessThan(-20);
  });

  it('restituisce un azimut sempre nell’intervallo 0–360', () => {
    for (let hour = 0; hour < 24; hour += 3) {
      const sun = sunPosition(new Date(Date.UTC(2026, 9, 21, hour)), 41.8905, 14.7854);
      expect(sun.azimuth).toBeGreaterThanOrEqual(0);
      expect(sun.azimuth).toBeLessThan(360);
      expect(Number.isFinite(sun.elevation)).toBe(true);
    }
  });
});

describe('meteo', () => {
  it('traduce i codici WMO principali', () => {
    expect(weatherLabel(0)).toBe('Sereno');
    expect(weatherLabel(3)).toBe('Coperto');
    expect(weatherLabel(61)).toContain('Pioggia');
    expect(weatherLabel(95)).toContain('Temporale');
    expect(weatherLabel(1234)).toBe('Meteo variabile');
  });

  it('parsa la risposta di Open-Meteo (current + daily)', async () => {
    const original = globalThis.fetch;
    const payload = {
      current: {
        temperature_2m: 19.7,
        weather_code: 3,
        cloud_cover: 100,
        precipitation: 0,
        snowfall: 0,
        wind_speed_10m: 18.5,
        wind_direction_10m: 201,
        is_day: 1,
      },
      daily: { sunrise: ['2026-10-21T07:20'], sunset: ['2026-10-21T18:10'] },
    };
    globalThis.fetch = (async () => new Response(JSON.stringify(payload), { status: 200 })) as typeof fetch;
    try {
      const w = await fetchWeather(41.8905, 14.7854);
      expect(w.temperature).toBeCloseTo(19.7, 5);
      expect(w.code).toBe(3);
      expect(w.cloudCover).toBe(100);
      expect(w.windSpeed).toBeCloseTo(18.5, 5);
      expect(w.windDirection).toBe(201);
      expect(w.isDay).toBe(true);
      expect(w.sunrise).toBe('07:20');
      expect(w.sunset).toBe('18:10');
    } finally {
      globalThis.fetch = original;
    }
  });

  it('riconosce nebbia e default coerente', () => {
    expect(isFogCode(45)).toBe(true);
    expect(isFogCode(48)).toBe(true);
    expect(isFogCode(3)).toBe(false);
    const d = defaultWeather();
    expect(d.cloudCover).toBeGreaterThanOrEqual(0);
    expect(d.cloudCover).toBeLessThanOrEqual(100);
    expect(d.precipitation).toBe(0);
  });
});

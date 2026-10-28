import { describe, expect, it } from 'vitest';
import {
  dayOfYear,
  horizonGlowFactor,
  isWeatherPreset,
  solarDeclination,
  sunAtLocalTime,
  WEATHER_PRESETS,
} from '../src/environment/sun-clock';

const LAT = 41.8905;
const LON = 14.7854;
/** 21 giugno */
const SUMMER = 172;

describe('sole per ora locale', () => {
  it('a mezzogiorno è alto sopra l’orizzonte', () => {
    const noon = sunAtLocalTime(12, LAT, LON, SUMMER);
    expect(noon.elevation).toBeGreaterThan(60);
  });

  it('a mezzanotte è sotto l’orizzonte', () => {
    expect(sunAtLocalTime(0, LAT, LON, SUMMER).elevation).toBeLessThan(-5);
  });

  it('al mattino il sole è a est, al pomeriggio a ovest', () => {
    const morning = sunAtLocalTime(8, LAT, LON, SUMMER);
    const afternoon = sunAtLocalTime(17, LAT, LON, SUMMER);
    expect(morning.elevation).toBeGreaterThan(0);
    expect(morning.azimuth).toBeLessThan(180);
    expect(afternoon.azimuth).toBeGreaterThan(180);
  });

  it('l’alba è più tardi d’inverno che d’estate', () => {
    // alle 7 d’estate il sole è già sorto, a dicembre no
    expect(sunAtLocalTime(7, LAT, LON, SUMMER).elevation).toBeGreaterThan(0);
    expect(sunAtLocalTime(7, LAT, LON, 355).elevation).toBeLessThan(0);
  });

  it('la declinazione è positiva d’estate e negativa d’inverno', () => {
    expect(solarDeclination(SUMMER)).toBeGreaterThan(20);
    expect(solarDeclination(355)).toBeLessThan(-20);
  });

  it('dayOfYear conta dal 1º gennaio', () => {
    expect(dayOfYear(new Date(Date.UTC(2026, 0, 1)))).toBe(1);
    expect(dayOfYear(new Date(Date.UTC(2026, 11, 31)))).toBe(365);
  });

  it('la posizione è deterministica', () => {
    expect(sunAtLocalTime(6.5, LAT, LON, SUMMER)).toEqual(sunAtLocalTime(6.5, LAT, LON, SUMMER));
  });

  it('concentra lo scatter all’orizzonte in modo simmetrico e lo spegne di notte fonda', () => {
    expect(horizonGlowFactor(0)).toBe(1);
    expect(horizonGlowFactor(6)).toBe(horizonGlowFactor(-6));
    expect(horizonGlowFactor(22)).toBe(0);
    expect(horizonGlowFactor(-30)).toBe(0);
    expect(() => horizonGlowFactor(Number.NaN)).toThrow(RangeError);
  });
});

describe('preset meteo', () => {
  it('riconosce solo i valori previsti', () => {
    expect(isWeatherPreset('rain')).toBe(true);
    expect(isWeatherPreset('snow')).toBe(true);
    expect(isWeatherPreset('grandine')).toBe(false);
    expect(isWeatherPreset(null)).toBe(false);
  });

  it('pioggia e neve hanno precipitazione o accumulo', () => {
    expect(WEATHER_PRESETS.rain.precipitation).toBeGreaterThan(0);
    expect(WEATHER_PRESETS.snow.snowfall).toBeGreaterThan(0);
    expect(WEATHER_PRESETS.clear.precipitation).toBe(0);
  });
});

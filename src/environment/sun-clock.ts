/**
 * Posizione del sole per un'ora locale arbitraria.
 *
 * A differenza di `sunPosition` (che parte da un istante reale), qui l'ora è un
 * parametro: serve al cursore "ora del giorno" delle impostazioni, per provare
 * alba, mezzogiorno, tramonto e notte senza aspettare il tempo reale.
 *
 * Modello NOAA semplificato: declinazione solare dal giorno dell'anno, angolo
 * orario dall'ora solare locale. Errore di alcuni primi d'arco, sufficiente per
 * l'illuminazione di una scena.
 */

export interface SolarPosition {
  /** gradi sopra l'orizzonte, negativo di notte */
  elevation: number;
  /** gradi da nord, in senso orario */
  azimuth: number;
}

const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;

/** Giorno dell'anno (1…365) da una data UTC. */
export function dayOfYear(date: Date): number {
  const start = Date.UTC(date.getUTCFullYear(), 0, 1);
  return Math.floor((date.getTime() - start) / 86400000) + 1;
}

/** Declinazione solare in gradi per un giorno dell'anno. */
export function solarDeclination(day: number): number {
  return 23.44 * Math.sin(((360 / 365) * (day - 81)) * RAD);
}

/**
 * Sole per ora locale (0…24), latitudine e longitudine.
 * `hours` accetta valori frazionari (es. 6.5 = 06:30).
 */
export function sunAtLocalTime(hours: number, lat: number, lon: number, day = 172): SolarPosition {
  const declination = solarDeclination(day) * RAD;
  const latRad = lat * RAD;
  // ora solare locale: mezzogiorno solare alle 12, corretta dalla longitudine
  const solarHours = ((hours - lon / 15 + 24) % 24 + 24) % 24;
  const hourAngle = (solarHours - 12) * 15 * RAD;

  const sinElevation =
    Math.sin(latRad) * Math.sin(declination) + Math.cos(latRad) * Math.cos(declination) * Math.cos(hourAngle);
  const elevation = Math.asin(Math.max(-1, Math.min(1, sinElevation))) * DEG;

  const azFromSouth = Math.atan2(
    Math.sin(hourAngle),
    Math.cos(hourAngle) * Math.sin(latRad) - Math.tan(declination) * Math.cos(latRad),
  );
  const azimuth = (((azFromSouth * DEG + 180) % 360) + 360) % 360;

  return { elevation, azimuth };
}

export type WeatherPreset = 'auto' | 'clear' | 'cloudy' | 'rain' | 'snow' | 'fog';

export interface WeatherPresetData {
  label: string;
  cloudCover: number;
  precipitation: number;
  snowfall: number;
  windSpeed: number;
  code: number;
  temperature: number;
}

export const WEATHER_PRESETS: Record<Exclude<WeatherPreset, 'auto'>, WeatherPresetData> = {
  clear: { label: 'Sereno', cloudCover: 5, precipitation: 0, snowfall: 0, windSpeed: 6, code: 0, temperature: 20 },
  cloudy: { label: 'Nuvoloso', cloudCover: 80, precipitation: 0, snowfall: 0, windSpeed: 12, code: 3, temperature: 17 },
  rain: { label: 'Pioggia', cloudCover: 95, precipitation: 2.4, snowfall: 0, windSpeed: 18, code: 63, temperature: 12 },
  snow: { label: 'Neve', cloudCover: 92, precipitation: 0, snowfall: 2.0, windSpeed: 10, code: 73, temperature: -1 },
  fog: { label: 'Nebbia', cloudCover: 60, precipitation: 0, snowfall: 0, windSpeed: 4, code: 45, temperature: 8 },
};

export function isWeatherPreset(value: string | null | undefined): value is WeatherPreset {
  return value === 'auto' || value === 'clear' || value === 'cloudy' || value === 'rain' || value === 'snow' || value === 'fog';
}

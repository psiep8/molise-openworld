/**
 * Meteo reale e posizione reale del sole.
 *
 * - Dati meteo: Open-Meteo (open source, gratuita, senza chiave, CORS ok).
 *   Licenza dati CC BY 4.0 — https://open-meteo.com/
 * - Sole: formula NOAA semplificata, calcolata in locale dall'ora UTC e dalla
 *   latitudine/longitudine del giocatore. Funziona anche senza rete.
 *
 * Il modulo resta puro (nessun accesso al DOM all'import): i test possono
 * importarlo in Node senza stub.
 */

export interface WeatherSnapshot {
  temperature: number;
  /** codice WMO (0 sereno … 95 temporale) */
  code: number;
  cloudCover: number;
  precipitation: number;
  snowfall: number;
  windSpeed: number;
  windDirection: number;
  isDay: boolean;
  /** orario locale "HH:MM" */
  sunrise: string | null;
  sunset: string | null;
  fetchedAt: number;
}

export interface SunPosition {
  /** gradi sopra l'orizzonte, negativo di notte */
  elevation: number;
  /** gradi da nord, in senso orario */
  azimuth: number;
}

export const WEATHER_ATTRIBUTION = 'Meteo: Open-Meteo (CC BY 4.0)';
export const WEATHER_REFRESH_MS = 10 * 60 * 1000;

const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;

/** Posizione del sole (NOAA simplified) per un istante e un punto sulla Terra. */
export function sunPosition(date: Date, lat: number, lon: number): SunPosition {
  const jd = date.getTime() / 86400000 + 2440587.5;
  const n = jd - 2451545.0;

  const meanLongitude = ((280.46 + 0.9856474 * n) % 360 + 360) % 360;
  const meanAnomaly = (((357.528 + 0.9856003 * n) % 360 + 360) % 360) * RAD;
  const eclipticLongitude = (meanLongitude + 1.915 * Math.sin(meanAnomaly) + 0.02 * Math.sin(2 * meanAnomaly)) * RAD;
  const obliquity = (23.439 - 0.0000004 * n) * RAD;

  const rightAscension = Math.atan2(Math.cos(obliquity) * Math.sin(eclipticLongitude), Math.cos(eclipticLongitude));
  const declination = Math.asin(Math.sin(obliquity) * Math.sin(eclipticLongitude));

  const gmstHours = (((18.697374558 + 24.06570982441908 * n) % 24) + 24) % 24;
  const localSidereal = gmstHours * 15 + lon;
  let hourAngle = localSidereal * RAD - rightAscension;
  hourAngle = Math.atan2(Math.sin(hourAngle), Math.cos(hourAngle));

  const latRad = lat * RAD;
  const sinElevation =
    Math.sin(latRad) * Math.sin(declination) + Math.cos(latRad) * Math.cos(declination) * Math.cos(hourAngle);
  const elevation = Math.asin(Math.max(-1, Math.min(1, sinElevation))) * DEG;

  const azFromSouth = Math.atan2(
    Math.sin(hourAngle),
    Math.cos(hourAngle) * Math.sin(latRad) - Math.tan(declination) * Math.cos(latRad),
  );
  const azimuth = ((azFromSouth * DEG + 180) % 360 + 360) % 360;

  return { elevation, azimuth };
}

const LABELS: Record<number, string> = {
  0: 'Sereno',
  1: 'Prevalentemente sereno',
  2: 'Parzialmente nuvoloso',
  3: 'Coperto',
  45: 'Nebbia',
  48: 'Nebbia con brina',
  51: 'Pioviggine debole',
  53: 'Pioviggine',
  55: 'Pioviggine intensa',
  56: 'Pioviggine gelata',
  57: 'Pioviggine gelata intensa',
  61: 'Pioggia debole',
  63: 'Pioggia',
  65: 'Pioggia forte',
  66: 'Pioggia gelata',
  67: 'Pioggia gelata forte',
  71: 'Neve debole',
  73: 'Neve',
  75: 'Neve forte',
  77: 'Granelli di neve',
  80: 'Rovesci deboli',
  81: 'Rovesci',
  82: 'Rovesci violenti',
  85: 'Rovesci di neve',
  86: 'Rovesci di neve forti',
  95: 'Temporale',
  96: 'Temporale con grandine',
  99: 'Temporale con grandine forte',
};

export function weatherLabel(code: number): string {
  return LABELS[code] ?? 'Meteo variabile';
}

export function isFogCode(code: number): boolean {
  return code === 45 || code === 48;
}

export function defaultWeather(): WeatherSnapshot {
  return {
    temperature: 18,
    code: 1,
    cloudCover: 15,
    precipitation: 0,
    snowfall: 0,
    windSpeed: 8,
    windDirection: 230,
    isDay: true,
    sunrise: null,
    sunset: null,
    fetchedAt: 0,
  };
}

function formatLocalTime(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  // Open-Meteo con timezone=auto restituisce "2026-10-21T07:12"
  const match = /T(\d{2}:\d{2})/.exec(value);
  return match ? match[1] : null;
}

function toNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

interface OpenMeteoResponse {
  current?: Record<string, unknown>;
  daily?: { sunrise?: unknown[]; sunset?: unknown[] };
}

export async function fetchWeather(lat: number, lon: number, signal?: AbortSignal): Promise<WeatherSnapshot> {
  const url = new URL('https://api.open-meteo.com/v1/forecast');
  url.searchParams.set('latitude', lat.toFixed(4));
  url.searchParams.set('longitude', lon.toFixed(4));
  url.searchParams.set(
    'current',
    'temperature_2m,weather_code,cloud_cover,precipitation,rain,snowfall,wind_speed_10m,wind_direction_10m,is_day',
  );
  url.searchParams.set('daily', 'sunrise,sunset');
  url.searchParams.set('timezone', 'auto');
  url.searchParams.set('forecast_days', '1');

  const res = await fetch(url.toString(), { signal, headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = (await res.json()) as OpenMeteoResponse;
  const current = data.current ?? {};
  const sunrise = Array.isArray(data.daily?.sunrise) ? formatLocalTime(data.daily.sunrise[0]) : null;
  const sunset = Array.isArray(data.daily?.sunset) ? formatLocalTime(data.daily.sunset[0]) : null;

  return {
    temperature: toNumber(current.temperature_2m),
    code: Math.round(toNumber(current.weather_code, -1)),
    cloudCover: Math.max(0, Math.min(100, toNumber(current.cloud_cover))),
    precipitation: Math.max(0, toNumber(current.precipitation)),
    snowfall: Math.max(0, toNumber(current.snowfall)),
    windSpeed: Math.max(0, toNumber(current.wind_speed_10m)),
    windDirection: ((toNumber(current.wind_direction_10m) % 360) + 360) % 360,
    isDay: toNumber(current.is_day) >= 0.5,
    sunrise,
    sunset,
    fetchedAt: Date.now(),
  };
}

/**
 * Servizio meteo reale con auto-aggiornamento ogni 10 minuti.
 * Non lancia mai eccezioni verso il gioco: in caso di rete assente espone
 * `error` e mantiene l'ultimo dato (o il default), mentre il sole reale
 * continua a funzionare perché è calcolato in locale.
 */
export class RealWeather {
  snapshot: WeatherSnapshot | null = null;
  error: string | null = null;
  loading = false;
  enabled = false;
  onChange?: () => void;

  private lat = 41.8905;
  private lon = 14.7854;
  private nextRefresh = 0;
  private controller: AbortController | null = null;

  enable(lat: number, lon: number): void {
    this.enabled = true;
    this.setLocation(lat, lon);
    void this.refresh(true);
  }

  disable(): void {
    this.enabled = false;
    this.loading = false;
    this.controller?.abort();
    this.controller = null;
    this.onChange?.();
  }

  setLocation(lat: number, lon: number): void {
    this.lat = lat;
    this.lon = lon;
  }

  /** Chiamato ogni frame: controlla se è ora di aggiornare. */
  update(now = Date.now()): void {
    if (this.enabled && now >= this.nextRefresh) void this.refresh();
  }

  async refresh(force = false): Promise<void> {
    if (!this.enabled) return;
    if (this.loading && !force) return;

    this.controller?.abort();
    const controller = new AbortController();
    this.controller = controller;
    this.loading = true;
    this.onChange?.();

    const timeout = setTimeout(() => controller.abort(), 9000);
    try {
      const snapshot = await fetchWeather(this.lat, this.lon, controller.signal);
      if (controller !== this.controller) return;
      this.snapshot = snapshot;
      this.error = null;
      this.nextRefresh = Date.now() + WEATHER_REFRESH_MS;
    } catch (err) {
      if (controller !== this.controller) return;
      const aborted = controller.signal.aborted;
      this.error = aborted ? 'risposta lenta o assente' : 'rete non disponibile';
      // riprova prima, senza martellare il servizio
      this.nextRefresh = Date.now() + 2 * 60 * 1000;
    } finally {
      clearTimeout(timeout);
      if (controller === this.controller) {
        this.loading = false;
        this.controller = null;
        this.onChange?.();
      }
    }
  }
}

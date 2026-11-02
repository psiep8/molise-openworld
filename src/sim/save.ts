/**
 * Salvataggio della modalità vita.
 *
 * Sono salvati solo identificatori e valori serializzabili: niente riferimenti
 * a mesh, materiali o altri oggetti runtime. Il file ha un numero di versione
 * esplicito e viene convalidato al caricamento; se è corrotto o incompleto il
 * gioco riparte da uno stato sicuro senza sovrascrivere il file originale
 * (la sovrascrittura avviene solo al salvataggio successivo).
 *
 * Le preferenze già esistenti (aspetto, veicolo, colore, garage) continuano a
 * usare le proprie chiavi `molise.*`, così i salvataggi vecchi restano validi.
 */

import { worldToLatLon } from '../config';
import { createInitialWallet, sanitizeWallet, type Wallet } from './economy';
import { createInitialNeeds, sanitizeNeeds, type Needs } from './needs';

export const SAVE_VERSION = 2;
export const SAVE_KEY = 'molise.life.v1';

export interface LifeSave {
  version: number;
  wallet: Wallet;
  needs: Needs;
  /** Giorno di gioco, 1 = primo giorno. */
  day: number;
  /** Minuti dalla mezzanotte (0–1439). */
  minutes: number;
  /**
   * Ultima posizione del giocatore in coordinate geografiche, se disponibile.
   * I metri locali non sono stabili: spostando l'origine del mondo (floating
   * origin) o estendendolo non significherebbero più nulla. I salvataggi
   * vecchi con `position` in metri vengono convertiti al caricamento.
   */
  geo: { lat: number; lon: number } | null;
  savedAt: number;
}

export function createNewLifeSave(): LifeSave {
  return {
    version: SAVE_VERSION,
    wallet: createInitialWallet(),
    needs: createInitialNeeds(),
    day: 1,
    minutes: 8 * 60,
    geo: null,
    savedAt: 0,
  };
}

/**
 * Posizione salvata: lat/lon (v2) oppure i vecchi metri locali convertiti una
 * volta sola. Fuori intervallo geografico si scarta, non si indovina.
 */
function readGeo(
  raw: Partial<LifeSave> & { position?: { x?: unknown; z?: unknown } | null },
): { lat: number; lon: number } | null {
  const geo = raw.geo;
  if (
    geo &&
    Number.isFinite(geo.lat) &&
    Number.isFinite(geo.lon) &&
    Math.abs(geo.lat) <= 90 &&
    Math.abs(geo.lon) <= 180
  ) {
    return { lat: geo.lat, lon: geo.lon };
  }
  const legacy = raw.position;
  if (legacy && Number.isFinite(legacy.x) && Number.isFinite(legacy.z)) {
    const ll = worldToLatLon(legacy.x as number, legacy.z as number);
    if (Number.isFinite(ll.lat) && Number.isFinite(ll.lon)) return { lat: ll.lat, lon: ll.lon };
  }
  return null;
}

/** Convalida un oggetto caricato; `null` se non è recuperabile. */
export function sanitizeLifeSave(input: unknown): LifeSave | null {
  if (!input || typeof input !== 'object') return null;
  const raw = input as Partial<LifeSave>;
  const wallet = sanitizeWallet(raw.wallet);
  if (!wallet) return null;
  const day = Number.isFinite(raw.day) ? Math.max(1, Math.floor(raw.day as number)) : 1;
  const minutes = Number.isFinite(raw.minutes)
    ? Math.min(1439, Math.max(0, Math.floor(raw.minutes as number)))
    : 8 * 60;
  const geo = readGeo(raw);
  return {
    version: SAVE_VERSION,
    wallet,
    needs: sanitizeNeeds(raw.needs),
    day,
    minutes,
    geo,
    savedAt: Number.isFinite(raw.savedAt) ? (raw.savedAt as number) : 0,
  };
}

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function loadLifeSave(): LifeSave | null {
  const store = storage();
  if (!store) return null;
  try {
    const raw = store.getItem(SAVE_KEY);
    if (!raw) return null;
    return sanitizeLifeSave(JSON.parse(raw));
  } catch {
    // salvataggio illeggibile: si riparte in sicurezza, il file resta per debug
    return null;
  }
}

export function saveLifeSave(save: LifeSave): boolean {
  const store = storage();
  if (!store) return false;
  try {
    store.setItem(SAVE_KEY, JSON.stringify({ ...save, version: SAVE_VERSION, savedAt: Date.now() }));
    return true;
  } catch {
    return false;
  }
}

export function clearLifeSave(): void {
  try {
    window.localStorage.removeItem(SAVE_KEY);
  } catch {
    // localStorage può essere disabilitato
  }
}

/** Orario leggibile HH:MM partendo dai minuti di gioco. */
export function formatGameClock(minutes: number): string {
  const total = ((Math.floor(minutes) % 1440) + 1440) % 1440;
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/**
 * Avanza l'orologio: restituisce il nuovo giorno e i nuovi minuti.
 * 1 secondo reale = 1 minuto di gioco è troppo veloce per una sessione lunga,
 * quindi il gioco usa un fattore configurabile in `GAME_MINUTES_PER_SECOND`.
 */
export function advanceClock(day: number, minutes: number, gameMinutes: number): { day: number; minutes: number } {
  const total = minutes + Math.max(0, gameMinutes);
  const extraDays = Math.floor(total / 1440);
  return { day: day + extraDays, minutes: Math.round(total % 1440) };
}

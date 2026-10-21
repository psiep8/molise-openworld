/**
 * Casa/garage del giocatore.
 *
 * Si sceglie un edificio reale del paese (impronta OSM) e lo si usa come base:
 * il segnalibro resta sulla mappa, l'auto si può parcheggiare lì e dal menu si
 * può tornare al garage. La posizione è salvata in `localStorage`.
 */

import { HOME, VILLAGES, latLonToWorld } from '../config';
import type { BuildingIndex } from '../geo/osm';

export interface Property {
  x: number;
  z: number;
  label: string;
}

const STORAGE_KEY = 'molise.garage';
/** Sotto questa superficie (m²) è una rimessa, non una casa. */
const MIN_AREA = 34;
/** Distanza massima dal giocatore per poter scegliere l'edificio. */
export const PROPERTY_RANGE = 22;

function centroid(points: readonly { x: number; z: number }[]): { x: number; z: number } {
  let x = 0;
  let z = 0;
  for (const p of points) {
    x += p.x;
    z += p.z;
  }
  return { x: x / points.length, z: z / points.length };
}

/** Nome leggibile in base al paese più vicino. */
export function propertyLabel(x: number, z: number): string {
  let best: { name: string; d: number } | null = null;
  for (const v of VILLAGES) {
    const w = latLonToWorld(v.lat, v.lon);
    const d = Math.hypot(w.x - x, w.z - z);
    if (!best || d < best.d) best = { name: v.name, d };
  }
  if (!best) return 'Casa';
  const place = best.name === HOME.name ? `${HOME.name} · centro` : best.name;
  return best.d < 900 ? `Casa a ${place}` : `Casa in campagna (${place})`;
}

/**
 * Edificio più vicino al punto, entro `maxDistance` metri dal centro dell'impronta.
 * Ignora le costruzioni troppo piccole (garage, fienili, muri).
 */
export function findNearestProperty(
  buildings: BuildingIndex,
  x: number,
  z: number,
  maxDistance = PROPERTY_RANGE,
): Property | null {
  let best: { property: Property; d: number } | null = null;
  for (const building of buildings.near(x, z)) {
    if (building.area < MIN_AREA || building.points.length < 3) continue;
    const c = centroid(building.points);
    const d = Math.hypot(c.x - x, c.z - z);
    if (d > maxDistance) continue;
    if (!best || d < best.d) {
      best = { property: { x: c.x, z: c.z, label: propertyLabel(c.x, c.z) }, d };
    }
  }
  return best?.property ?? null;
}

export function loadProperty(): Property | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Property>;
    if (typeof parsed.x !== 'number' || typeof parsed.z !== 'number') return null;
    return {
      x: parsed.x,
      z: parsed.z,
      label: typeof parsed.label === 'string' && parsed.label ? parsed.label : propertyLabel(parsed.x, parsed.z),
    };
  } catch {
    return null;
  }
}

export function saveProperty(property: Property | null): void {
  try {
    if (!property) {
      window.localStorage.removeItem(STORAGE_KEY);
      return;
    }
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(property));
  } catch {
    // localStorage può essere disabilitato
  }
}

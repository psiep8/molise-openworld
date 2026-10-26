import { clamp } from '../geo/geo';

/** Limiti della scala della minimappa, in metri di lato. */
export const MINIMAP_MIN = 200;
export const MINIMAP_MAX = 720;

/**
 * Scala della minimappa, in metri di lato.
 *
 * A piedi si guarda vicino: 300 m coprono il paese e le strade attorno, dove
 * prima 780 m riducevano Palata a una macchia. In auto la scala si apre con la
 * velocità (240 m da fermo, ~660 m a 100 km/h), così a 90 km/h si vede la curva
 * dopo invece di scoprirla a metà. `zoomFactor` è la rotella sopra la mappa:
 * stringe o allarga intorno al valore automatico.
 */
export function minimapMeters(mode: 'walk' | 'drive', speed = 0, zoomFactor = 1): number {
  const factor = clamp(zoomFactor, 0.45, 2.4);
  const base = mode === 'walk' ? 300 : 240 + Math.abs(speed) * 4.4;
  return clamp(base, MINIMAP_MIN, MINIMAP_MAX) * factor;
}

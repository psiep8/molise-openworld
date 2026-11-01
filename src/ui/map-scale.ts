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

/**
 * Raggruppa i punti che sullo schermo cadono più vicini di `radius` pixel.
 *
 * Sulla mappa grande l'intera valle sta in ~1600 px: le nove attività di
 * Palata finiscono entro una trentina di pixel e i loro rombi, larghi una
 * quindicina di pixel l'uno, diventavano una macchia sola — con le etichette
 * che si scartavano a vicenda. Il raggruppamento è greedy sull'ordine dato
 * (chi viene prima fa da capogruppo) e restituisce gli indici, così chi
 * disegna può mostrare un badge con il numero invece di nove simboli
 * sovrapposti.
 */
export function clusterByRadius(
  points: readonly { x: number; y: number }[],
  radius: number,
): number[][] {
  const groups: number[][] = [];
  const used = new Array<boolean>(points.length).fill(false);
  for (let i = 0; i < points.length; i++) {
    if (used[i]) continue;
    const origin = points[i]!;
    used[i] = true;
    const group = [i];
    for (let j = i + 1; j < points.length; j++) {
      if (used[j]) continue;
      const p = points[j]!;
      if (Math.hypot(p.x - origin.x, p.y - origin.y) <= radius) {
        used[j] = true;
        group.push(j);
      }
    }
    groups.push(group);
  }
  return groups;
}

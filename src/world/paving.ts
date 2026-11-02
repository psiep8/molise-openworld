/**
 * Geometria pura dei marciapiedi: scelta stabile della variante e piano su cui
 * appoggiare i moduli.
 *
 * Il bug di fondo dei marciapiedi "spezzettati" era decidere la quota a punti:
 * un modulo rigido ruotato solo in imbardata resta orizzontale e su una strada
 * in pendenza vola da un lato e affonda dall'altro. Qui il piano si ricava
 * dalla pendenza longitudinale e traversale della strada, così vale per strade
 * parallele a X, a Z e in diagonale senza casi speciali sull'asse del modello.
 */

export interface SlopeFrame {
  /** derivata della quota lungo X (pendenza vista dal terreno) */
  slopeX: number;
  /** derivata della quota lungo Z */
  slopeZ: number;
}

/**
 * Hash stabile (FNV-1a): lo stesso seme dà lo stesso risultato in ogni sessione
 * e su ogni piattaforma, quindi una via non cambia pavimentazione al reload.
 */
export function stableHash(values: readonly number[]): number {
  let hash = 2166136261 >>> 0;
  for (const value of values) {
    hash ^= Math.round(Number.isFinite(value) ? value : 0) >>> 0;
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash >>> 0;
}

/** Scelta deterministica in `[0, count)`. */
export function stableChoice(values: readonly number[], count: number): number {
  if (!Number.isInteger(count) || count <= 0) return 0;
  return stableHash(values) % count;
}

/**
 * Piano stradale come derivate di quota.
 *
 * `t` è la tangente orizzontale normalizzata, `grade` la pendenza lungo la
 * strada e `crossGrade` quella traversale (positiva verso la normale sinistra
 * `(-tz, tx)`). Il gradiente risultante è `grade·t + crossGrade·n`, da cui le
 * derivate parziali usate da `WorldSpot.slopeX/slopeZ`.
 */
export function slopeFrame(
  grade: number,
  crossGrade: number,
  tx: number,
  tz: number,
): SlopeFrame {
  if (
    !Number.isFinite(grade) ||
    !Number.isFinite(crossGrade) ||
    !Number.isFinite(tx) ||
    !Number.isFinite(tz)
  ) {
    return { slopeX: 0, slopeZ: 0 };
  }
  const length = Math.hypot(tx, tz);
  if (length < 1e-6) return { slopeX: 0, slopeZ: 0 };
  const ux = tx / length;
  const uz = tz / length;
  return {
    slopeX: grade * ux - crossGrade * uz,
    slopeZ: grade * uz + crossGrade * ux,
  };
}

/**
 * Fattore di lunghezza con cui un modulo resta entro `tolerance` dal profilo
 * stradale: si prova il modulo intero e poi sempre più corto, così su una
 * curva stretta il pezzo si accorcia invece di tagliare la corda (o di essere
 * saltato, che apriva i buchi in salita).
 */
export function shortestFitFactor(
  baseLength: number,
  tolerance: number,
  sample: (distance: number) => number,
): number {
  if (!Number.isFinite(baseLength) || baseLength <= 0) return 1;
  const limit = Number.isFinite(tolerance) && tolerance > 0 ? tolerance : 0.02;
  const factors = [1, 0.8, 0.6, 0.45, 0.3, 0.2];
  for (const factor of factors) {
    const length = baseLength * factor;
    if (length < 0.4) break;
    const start = sample(0);
    const middle = sample(length / 2);
    const end = sample(length);
    if (Math.abs(middle - (start + end) / 2) <= limit) return factor;
  }
  const shortest = factors[factors.length - 1]!;
  return Math.max(0.4 / baseLength, shortest);
}

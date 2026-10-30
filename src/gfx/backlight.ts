/**
 * Controsole: il sole in faccia non deve bruciare la scena.
 *
 * Guardare il sole alza la luce che arriva all'obiettivo di ordini di grandezza;
 * un'esposizione fissa pensata per la strada diventa bianca. L'occhio chiude
 * l'iride in circa mezzo secondo e la riapre più lentamente: qui si fa lo stesso
 * con un fattore morbido fra 0 e 1, che abbassa l'esposizione e spegne il disco
 * solare sotto nuvole e pioggia.
 */

export interface Direction {
  x: number;
  y: number;
  z: number;
}

const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value));

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

/** Quanto il sole è dentro il campo visivo: 1 al centro, 0 fuori. */
export function glareFactor(forward: Direction, sun: Direction): number {
  const fl = Math.hypot(forward.x, forward.y, forward.z);
  const sl = Math.hypot(sun.x, sun.y, sun.z);
  if (fl < 1e-6 || sl < 1e-6) return 0;
  const dot = (forward.x * sun.x + forward.y * sun.y + forward.z * sun.z) / (fl * sl);
  // cono largo ~60°: il bagliore si sente prima di guardare il disco
  return smoothstep(0.5, 0.97, dot);
}

/**
 * Smorzamento asimmetrico: l'iride si chiude in ~0,6 s e si riapre in ~1,5 s.
 * `dt` in secondi; il risultato resta in [0,1].
 */
export function adaptGlare(current: number, target: number, dt: number): number {
  const wanted = clamp(target, 0, 1);
  const tau = wanted > current ? 0.6 : 1.5;
  return current + (wanted - current) * (1 - Math.exp(-Math.max(0, dt) / tau));
}

/**
 * Esposizione con il controsole: al massimo −30%, mai sotto il 60% della base
 * (una scena buia non è una scena leggibile). Pioggia e neve attenuano il
 * bagliore perché il sole è già velato; di notte non c'è nulla da smorzare.
 */
export function backlightExposure(base: number, glare: number, rain: number, snow: number, day: number): number {
  const veil = clamp(1 - 0.45 * clamp(rain, 0, 1) - 0.3 * clamp(snow, 0, 1), 0.35, 1);
  const reduction = 0.3 * clamp(glare, 0, 1) * veil * clamp(day, 0, 1);
  return Math.max(base * 0.6, base * (1 - reduction));
}

/**
 * Visibilità del disco solare: sotto nuvole fitte, pioggia o neve non c'è un
 * disco bianco, solo luce diffusa.
 */
export function sunDiskStrength(cloud: number, rain: number, snow: number): number {
  return clamp(
    (1 - 0.8 * clamp(cloud, 0, 1)) * (1 - clamp(rain, 0, 1)) * (1 - 0.9 * clamp(snow, 0, 1)),
    0,
    1,
  );
}

/**
 * Rugosità minima del manto bagnato controsole.
 *
 * L'asfalto bagnato era lucido come uno specchio (0,12): con il sole basso
 * rifletteva un lobo enorme e la strada spariva nel bianco. Sotto i 0,22 il
 * riflesso resta un velo che segue l'ambiente, non un faro.
 */
export function wetRoadRoughness(glare: number): number {
  const min = 0.22 + 0.06 * clamp(glare, 0, 1);
  return clamp(min, 0.22, 0.34);
}

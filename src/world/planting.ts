import type { Heightfield } from '../geo/elevation';

/**
 * Quota di impianto per alberi, cespugli e sassi.
 *
 * Il terreno del gioco ha maglie da ~9,5 m e pendenze vere: campionare la quota
 * solo al centro dell'oggetto lascia la base sospesa sul lato a valle. Il
 * problema si vede soprattutto sugli argini delle strade di campagna, dove un
 * albero piantato a un metro dal ciglio mostra le radici nel vuoto.
 *
 * Qui si guarda un disco attorno al piede e si prende la quota **più bassa**,
 * con un piccolo affondamento: l'oggetto resta piantato anche quando il terreno
 * scende, e sull'altro lato affonda di qualche centimetro — che è esattamente
 * quello che fa un tronco su un pendio.
 */
export interface GroundUnder {
  min: number;
  max: number;
}

function sample(
  heights: Pick<Heightfield, 'heightAt'>,
  x: number,
  z: number,
  dx: number,
  dz: number,
): number {
  return heights.heightAt(x + dx, z + dz);
}

/** Quota minima e massima del terreno dentro un disco di raggio `radius`. */
export function groundUnder(
  heights: Pick<Heightfield, 'heightAt'>,
  x: number,
  z: number,
  radius = 0.8,
): GroundUnder {
  let min = heights.heightAt(x, z);
  let max = min;
  if (radius <= 0) return { min, max };
  const inner = radius * 0.55;
  for (let i = 0; i < 8; i++) {
    const angle = (i / 8) * Math.PI * 2;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const hInner = sample(heights, x, z, cos * inner, sin * inner);
    const hOuter = sample(heights, x, z, cos * radius, sin * radius);
    if (hInner < min) min = hInner;
    if (hOuter < min) min = hOuter;
    if (hInner > max) max = hInner;
    if (hOuter > max) max = hOuter;
  }
  return { min, max };
}

/**
 * Quota del piede: il punto più basso del disco, meno l'affondamento.
 *
 * `sink` deve restare piccolo (5–12 cm): serve a nascondere il taglio netto
 * della base, non a seppellire il modello.
 */
export function plantingHeight(
  heights: Pick<Heightfield, 'heightAt'>,
  x: number,
  z: number,
  radius = 0.8,
  sink = 0.08,
): number {
  return groundUnder(heights, x, z, radius).min - sink;
}

/**
 * Vero se il piede poggia su un salto troppo forte perché l'oggetto sembri
 * piantato anche affondandolo fino al punto più basso. In quel caso è meglio
 * non metterlo: un albero in meno è meno falso di un albero con le radici a
 * mezz'aria.
 */
export function footingTooSteep(
  heights: Pick<Heightfield, 'heightAt'>,
  x: number,
  z: number,
  radius = 0.8,
  maxRise = 1.25,
): boolean {
  const { min, max } = groundUnder(heights, x, z, radius);
  return max - min > maxRise;
}

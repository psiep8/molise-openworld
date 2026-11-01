/**
 * Diagnosi dell'arredo stradale: lampioni e cartelli.
 *
 * Le regole di piazzamento sono sparse fra `roads.ts` (lampioni) e
 * `street-furniture.ts` (segnaletica). Questo modulo non piazza niente: prende
 * le posizioni finali e dice, con numeri, quante violano le regole che il gioco
 * promette:
 *
 *  - nessun palo sulla carreggiata;
 *  - nessun palo dentro un edificio;
 *  - nessun palo su una pendenza dove non sta in piedi;
 *  - base alla quota del terreno (quando la quota è nota);
 *  - niente due oggetti addosso (sovrapposizione < `minGap`).
 *
 * È puro e deterministico: si può chiamare dal gioco una volta per build e dai
 * test con indici finti, senza scena né renderer.
 */

export interface FurnitureSpot {
  x: number;
  z: number;
  /** quota del piede, se già calcolata */
  y?: number;
}

export interface FurnitureContext {
  roads: { isOnRoad(x: number, z: number, tolerance?: number): boolean };
  buildings: { hitsCircle(x: number, z: number, radius: number): boolean };
  heights: {
    heightAt(x: number, z: number): number;
    slopeAt(x: number, z: number): number;
  };
}

export interface FurnitureAuditOptions {
  /** pendenza massima accettata, gradi */
  maxSlope?: number;
  /** distanza minima fra due oggetti, metri */
  minGap?: number;
  /** tolleranza fra quota del piede e terreno, metri */
  groundTolerance?: number;
}

export interface FurnitureAudit {
  /** oggetti esaminati (posizioni non finite scartate) */
  checked: number;
  /** piedi sulla carreggiata (al più 10 cm oltre il ciglio) */
  onRoad: number;
  /** piedi dentro un edificio (o a meno di 30 cm dal muro) */
  inBuilding: number;
  /** pendenza locale oltre il limite */
  onSlope: number;
  /** quota del piede diversa dal terreno */
  offGround: number;
  /** coppie più vicine di `minGap` */
  crowded: number;
  /** distanza minima trovata fra due oggetti, `Infinity` se ne esiste uno solo */
  minGap: number;
}

/**
 * Controlla un elenco di posizioni. La distanza minima è calcolata su tutte le
 * coppie: gli elenchi sono nell'ordine delle centinaia (lampioni e cartelli di
 * un paese), non delle decine di migliaia, quindi una griglia spaziale sarebbe
 * complessità inutile.
 */
export function auditFurniture(
  spots: readonly FurnitureSpot[],
  context: FurnitureContext,
  options: FurnitureAuditOptions = {},
): FurnitureAudit {
  const maxSlope = options.maxSlope ?? 12;
  const minGap = options.minGap ?? 0.6;
  const groundTolerance = options.groundTolerance ?? 0.08;
  const audit: FurnitureAudit = {
    checked: 0,
    onRoad: 0,
    inBuilding: 0,
    onSlope: 0,
    offGround: 0,
    crowded: 0,
    minGap: Infinity,
  };

  const valid: FurnitureSpot[] = [];
  for (const spot of spots) {
    if (!Number.isFinite(spot.x) || !Number.isFinite(spot.z)) continue;
    valid.push(spot);
    audit.checked++;
    if (context.roads.isOnRoad(spot.x, spot.z, 0.1)) audit.onRoad++;
    if (context.buildings.hitsCircle(spot.x, spot.z, 0.3)) audit.inBuilding++;
    if (context.heights.slopeAt(spot.x, spot.z) > maxSlope) audit.onSlope++;
    if (spot.y !== undefined && Number.isFinite(spot.y)) {
      const ground = context.heights.heightAt(spot.x, spot.z);
      if (Math.abs(spot.y - ground) > groundTolerance) audit.offGround++;
    }
  }

  for (let i = 0; i < valid.length; i++) {
    const a = valid[i]!;
    for (let j = i + 1; j < valid.length; j++) {
      const b = valid[j]!;
      const distance = Math.hypot(a.x - b.x, a.z - b.z);
      if (distance < audit.minGap) audit.minGap = distance;
      if (distance < minGap) audit.crowded++;
    }
  }

  return audit;
}

/** Somma dei contatori: comodo per decidere se loggare un avviso. */
export function auditViolations(audit: FurnitureAudit): number {
  return audit.onRoad + audit.inBuilding + audit.onSlope + audit.offGround + audit.crowded;
}

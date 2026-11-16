import { pointInPolygon, type Pt } from '../geo/geo';

/**
 * Superfici pavimentate che non vengono dalle strade OSM: il sagrato della
 * chiesa e le piazze mappate come poligoni. Servono a tre cose, tutte
 * importanti:
 *
 *  - l'erba non deve crescere sulle lastre (`ground-mask.ts`);
 *  - alberi e cespugli non devono piantarci radici (`vegetation.ts`);
 *  - il giocatore deve camminare sulla quota della lastra, non sul DEM sotto
 *    (`ground.ts`), altrimenti sulla piazza rialzata affonda di 40 cm.
 *
 * Non entrano nell'indice delle collisioni: si cammina sopra senza ostacoli,
 * esattamente come sul sagrato vero.
 */
export interface PavedArea {
  /** centro della superficie, coordinate mondo */
  x: number;
  z: number;
  /** rotazione su Y, come i nastri: +Z locale è la profondità */
  yaw: number;
  /** mezze dimensioni in metri, in coordinate locali */
  halfW: number;
  halfD: number;
  /**
   * Poligono reale della piazza. Se manca si usa il rettangolo orientato
   * (`halfW`/`halfD`), che resta il caso del sagrato della chiesa.
   */
  points?: readonly Pt[];
  /** quota della lastra sopra il terreno (m); default 0,05 come il sagrato */
  lift?: number;
}

/** Vero se il punto cade dentro una delle superfici pavimentate. */
export function insidePaved(x: number, z: number, areas: readonly PavedArea[]): boolean {
  for (const area of areas) {
    if (area.points && area.points.length >= 3) {
      if (pointInPolygon(x, z, area.points as Pt[])) return true;
      continue;
    }
    const dx = x - area.x;
    const dz = z - area.z;
    const cos = Math.cos(area.yaw);
    const sin = Math.sin(area.yaw);
    // rotazione inversa: dal mondo alle coordinate locali della piazza
    const lx = dx * cos - dz * sin;
    const lz = dx * sin + dz * cos;
    if (Math.abs(lx) <= area.halfW && Math.abs(lz) <= area.halfD) return true;
  }
  return false;
}

/** Bounding box mondo, per limitare le celle da marcare nella maschera. */
export function pavedBounds(area: PavedArea): {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
} {
  if (area.points && area.points.length >= 3) {
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (const p of area.points) {
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minZ = Math.min(minZ, p.z);
      maxZ = Math.max(maxZ, p.z);
    }
    return { minX, maxX, minZ, maxZ };
  }
  const cos = Math.cos(area.yaw);
  const sin = Math.sin(area.yaw);
  const ex = Math.abs(cos) * area.halfW + Math.abs(sin) * area.halfD;
  const ez = Math.abs(sin) * area.halfW + Math.abs(cos) * area.halfD;
  return { minX: area.x - ex, maxX: area.x + ex, minZ: area.z - ez, maxZ: area.z + ez };
}

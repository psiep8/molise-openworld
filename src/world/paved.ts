/**
 * Superfici pavimentate che non vengono dalle strade OSM: per ora la piazza
 * davanti alla chiesa. Servono a due cose sole, ma importanti:
 *
 *  - l'erba non deve crescere sulle lastre (`ground-mask.ts`);
 *  - alberi e cespugli non devono piantarci radici (`vegetation.ts`).
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
}

/** Vero se il punto cade dentro una delle superfici pavimentate. */
export function insidePaved(x: number, z: number, areas: readonly PavedArea[]): boolean {
  for (const area of areas) {
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
  const cos = Math.cos(area.yaw);
  const sin = Math.sin(area.yaw);
  const ex = Math.abs(cos) * area.halfW + Math.abs(sin) * area.halfD;
  const ez = Math.abs(sin) * area.halfW + Math.abs(cos) * area.halfD;
  return { minX: area.x - ex, maxX: area.x + ex, minZ: area.z - ez, maxZ: area.z + ez };
}

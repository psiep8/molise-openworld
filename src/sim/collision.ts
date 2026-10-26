/**
 * Collisioni dell'auto come corpo orientato (OBB).
 *
 * Un cerchio solo al centro lasciava passare muri e pali attraverso il muso e
 * il retrotreno. Due cerchi (avantreno/retrotreno) hanno risolto il problema
 * frontale ma lasciavano scoperti i fianchi: strisciando contro un muro
 * l'auto ci entrava di lato. Qui il rettangolo è approssimato da sei sonde
 * circolari — quattro angoli e due metà dei lati lunghi — disposte in modo che
 * l'inviluppo misuri esattamente lunghezza × larghezza.
 *
 * Il modulo è volutamente senza Three.js e senza DOM: la risoluzione si testa
 * con resolver finti, come la fisica dell'auto.
 */

export interface CircleResolver {
  resolveCircle(x: number, z: number, radius: number): { x: number; z: number; hit: boolean };
}

export interface BodyCollision {
  x: number;
  z: number;
  speed: number;
  hit: boolean;
  /** spostamento totale applicato, in metri */
  push: number;
}

/**
 * Risolve il rettangolo dell'auto contro edifici e ostacoli cilindrici.
 *
 * `halfLength` è metà lunghezza, `halfWidth` metà larghezza (compresi gli
 * specchietti). La velocità cala in proporzione alla penetrazione più profonda:
 * un urto di striscio costa poco, uno frontale ferma l'auto. Sommare le
 * penetrazioni di più sonde farebbe pagare tre volte lo stesso muro.
 */
export function resolveBody(
  x: number,
  z: number,
  yaw: number,
  speed: number,
  halfLength: number,
  halfWidth: number,
  resolvers: readonly (CircleResolver | null | undefined)[],
): BodyCollision {
  const fx = -Math.sin(yaw);
  const fz = -Math.cos(yaw);
  const rx = Math.cos(yaw);
  const rz = -Math.sin(yaw);

  // raggio delle sonde: metà larghezza (o meno), così l'inviluppo combacia
  const r = Math.min(halfWidth * 0.5, 0.5);
  const long = Math.max(0, halfLength - r);
  const wide = Math.max(0, halfWidth - r);
  const probes: [number, number][] = [
    [long, wide],
    [long, -wide],
    [-long, wide],
    [-long, -wide],
    [0, wide],
    [0, -wide],
  ];

  let px = x;
  let pz = z;
  let push = 0;
  let deepest = 0;
  let hit = false;

  for (const [along, side] of probes) {
    let cx = px + fx * along + rx * side;
    let cz = pz + fz * along + rz * side;
    for (const resolver of resolvers) {
      if (!resolver) continue;
      const fixed = resolver.resolveCircle(cx, cz, r);
      if (!fixed.hit) continue;
      const dx = fixed.x - cx;
      const dz = fixed.z - cz;
      if (!Number.isFinite(dx) || !Number.isFinite(dz)) continue;
      px += dx;
      pz += dz;
      cx = fixed.x;
      cz = fixed.z;
      const depth = Math.hypot(dx, dz);
      push += depth;
      deepest = Math.max(deepest, depth);
      hit = true;
    }
  }

  if (!hit) return { x, z, speed, hit: false, push: 0 };
  // 20 cm di penetrazione tolgono ~36%, un urto pieno quasi tutta la velocità
  const factor = Math.max(0.15, 1 - deepest * 1.8);
  return { x: px, z: pz, speed: speed * factor, hit: true, push };
}

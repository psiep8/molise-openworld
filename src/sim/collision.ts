/**
 * Collisioni dell'auto come corpo a due cerchi.
 *
 * Un cerchio solo al centro lasciava passare muri e pali attraverso il muso e
 * il retrotreno: l'auto si fermava quando l'ostacolo era già a metà carrozzeria.
 * Due cerchi (avantreno e retrotreno) approssimano il rettangolo della vettura
 * con un costo trascurabile e senza cambiare la fisica pura di `stepCar`.
 *
 * Il modulo è volutamente senza Three.js e senza DOM: la risoluzione si testa
 * con due resolver finti, come la fisica dell'auto.
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
 * Risolve avantreno e retrotreno contro edifici e ostacoli cilindrici.
 *
 * `halfLength` è la distanza dal centro ai due cerchi (circa metà passo),
 * `radius` il mezzo ingombro trasversale. La velocità cala in proporzione alla
 * penetrazione: un urto di striscio costa poco, uno frontale ferma l'auto.
 */
export function resolveBody(
  x: number,
  z: number,
  yaw: number,
  speed: number,
  halfLength: number,
  radius: number,
  resolvers: readonly (CircleResolver | null | undefined)[],
): BodyCollision {
  const fx = -Math.sin(yaw);
  const fz = -Math.cos(yaw);
  let px = x;
  let pz = z;
  let push = 0;
  let hit = false;

  for (const along of [halfLength, -halfLength]) {
    let cx = px + fx * along;
    let cz = pz + fz * along;
    for (const resolver of resolvers) {
      if (!resolver) continue;
      const fixed = resolver.resolveCircle(cx, cz, radius);
      if (!fixed.hit) continue;
      const dx = fixed.x - cx;
      const dz = fixed.z - cz;
      if (!Number.isFinite(dx) || !Number.isFinite(dz)) continue;
      px += dx;
      pz += dz;
      cx = fixed.x;
      cz = fixed.z;
      push += Math.hypot(dx, dz);
      hit = true;
    }
  }

  if (!hit) return { x, z, speed, hit: false, push: 0 };
  // la perdita dipende da quanto è entrato l'ostacolo, non dal tempo di frame:
  // 20 cm di penetrazione tolgono ~36%, un urto pieno quasi tutta la velocità
  const factor = Math.max(0.15, 1 - push * 1.8);
  return { x: px, z: pz, speed: speed * factor, hit: true, push };
}

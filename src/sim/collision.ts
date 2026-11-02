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
 * Due correzioni rispetto alla versione precedente:
 *
 *  - la perdita di velocità è **energia dell'urto**, cioè ∝ v² della componente
 *    normale all'impatto. Prima dipendeva dalla penetrazione: bastava che un
 *    frame lungo spostasse l'auto di 40 cm e l'urto "costava poco", quindi non
 *    c'era schianto. Ora a 30 m/s frontali l'auto si ferma, a 10° di striscio
 *    scivola quasi indenne;
 *  - l'urto eccentrico restituisce un impulso di imbardata: il muso gira, non
 *    viene solo espulso lateralmente.
 *
 * La continuità (niente tunneling) si ottiene nel chiamante con sotto-passi di
 * moto più corti del raggio delle sonde: questo modulo resta puro e testabile.
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
  /** velocità normale all'impatto, m/s: 0 = strisciata, 30 = muro frontale */
  impact: number;
  /** rotazione da applicare all'imbardata, rad */
  yawKick: number;
}

/**
 * Risolve il rettangolo dell'auto contro edifici e ostacoli cilindrici.
 *
 * `halfLength` è metà lunghezza, `halfWidth` metà larghezza (compresi gli
 * specchietti). La velocità cala in proporzione all'energia dell'urto normale:
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
  // normale dello spostamento più profondo: dice contro cosa si è andati
  let nx = 0;
  let nz = 0;
  // coppia attorno al centro: sonda davanti + spinta laterale = muso che gira
  let torque = 0;

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
      if (depth >= deepest) {
        deepest = depth;
        const len = depth || 1;
        nx = dx / len;
        nz = dz / len;
      }
      // componente laterale della spinta su questa sonda, per l'imbardata
      torque += along * (dx * rx + dz * rz);
      hit = true;
    }
  }

  if (!hit) return { x, z, speed, hit: false, push: 0, impact: 0, yawKick: 0 };

  // velocità del centro lungo la normale: positiva se si va *dentro* il muro
  const vn = Math.max(0, -(fx * speed * nx + fz * speed * nz));
  // energia dissipata ∝ v²: 3 m/s → ~5%, 10 m/s → ~53%, 16+ m/s → quasi ferma
  const loss = Math.min(0.985, 1.35 * (vn / 16) * (vn / 16));
  const factor = 1 - loss;
  // impulso di imbardata solo per urti davvero eccentrici: uno frontale
  // centrato non deve far girare l'auto
  const yawKick = Math.max(-0.12, Math.min(0.12, -torque * 0.05));
  return { x: px, z: pz, speed: speed * factor, hit: true, push, impact: vn, yawKick };
}

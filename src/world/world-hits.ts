import { windTime } from '../gfx/wind';
import type { WorldHitMesh, WorldRole, WorldSpot } from './worldkit';

/**
 * Reazione all'urto dei GLB importati.
 *
 * L'auto che prende un albero o un cartello deve farlo vedere: senza questo,
 * `ObstacleIndex` fermerebbe il veicolo contro un modello immobile, come se
 * avesse preso un muro invisibile. Qui si annota **quale** istanza è stata
 * colpita e con che forza, e lo shader del kit (`world/worldkit.ts`, attributo
 * `aHit`) la fa piegare e tornare a posto in circa un secondo.
 *
 * Si aggiorna solo l'attributo dell'istanza colpita: nessuna matrice da
 * riscrivere, nessun oggetto da clonare. Il tempo è lo stesso `uTime` del vento,
 * così albero e chiome procedurali si muovono sullo stesso orologio.
 *
 * Modulo senza Three.js nel ciclo caldo: la matematica è pura e si testa con
 * `tests/world-hits.test.ts`.
 */

export interface WorldHitEvent {
  /** punto dell'ostacolo colpito, in metri di mondo */
  x: number;
  z: number;
  /** direzione della spinta (dal veicolo verso l'ostacolo), normalizzata */
  dx: number;
  dz: number;
  /** 0…1: un urto a 20 km/h non fa lo stesso effetto di uno a 90 */
  strength: number;
  /** tag dell'ostacolo nell'indice delle collisioni (`world-tree`, `sign`, …) */
  tag: string | null;
}

/** Quali ostacoli hanno un modello che può piegarsi. */
const HIT_ROLES: ReadonlyMap<string, WorldRole> = new Map([
  ['world-tree', 'tree'],
  ['sign', 'sign'],
]);

/** Oltre questa distanza il modello colpito non è quello che si è urtato. */
const REACH: Record<'tree' | 'sign', number> = { tree: 5, sign: 2.5 };

/**
 * Direzione dell'urto nello spazio locale dell'istanza.
 *
 * Il vento e l'urto lavorano sui vertici **prima** della matrice di istanza,
 * quindi la spinta va ruotata di `-yaw`: l'inverso della rotazione applicata
 * da `WorldKit.instances` (`x' = x·cos + z·sin`, `z' = -x·sin + z·cos`).
 */
export function localHitDirection(yaw: number, dx: number, dz: number): { x: number; z: number } {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  return { x: dx * c - dz * s, z: dx * s + dz * c };
}

interface Registration {
  spots: readonly WorldSpot[];
  parts: WorldHitMesh[];
  /** indice dell'istanza dentro la mesh, per ogni spot (le varianti filtrano) */
  instanceIndex: number[];
}

export class WorldHitField {
  private readonly roles = new Map<WorldRole, Registration>();
  private total = 0;

  /** Quanti urti ha fatto reagire dall'avvio (diagnostica). */
  get count(): number {
    return this.total;
  }

  register(role: WorldRole, spots: readonly WorldSpot[], parts: WorldHitMesh[]): void {
    if (spots.length === 0 || parts.length === 0) return;
    const instanceIndex: number[] = [];
    const seen = new Map<number, number>();
    for (const spot of spots) {
      const variant = spot.variant ?? 0;
      const index = seen.get(variant) ?? 0;
      instanceIndex.push(index);
      seen.set(variant, index + 1);
    }
    this.roles.set(role, { spots, parts, instanceIndex });
  }

  /**
   * Fa reagire il modello colpito. Restituisce il ruolo toccato, o `null` se
   * l'ostacolo è rigido (sasso, casa) o troppo lontano dal punto d'urto.
   */
  hit(event: WorldHitEvent): WorldRole | null {
    if (!event.tag || !(event.strength > 0)) return null;
    const role = HIT_ROLES.get(event.tag);
    if (!role) return null;
    const registration = this.roles.get(role);
    if (!registration) return null;

    let best = -1;
    let bestDistance = REACH[role as 'tree' | 'sign'];
    for (let i = 0; i < registration.spots.length; i++) {
      const spot = registration.spots[i]!;
      const distance = Math.hypot(spot.x - event.x, spot.z - event.z);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = i;
      }
    }
    if (best < 0) return null;

    const spot = registration.spots[best]!;
    const variant = spot.variant ?? 0;
    const local = localHitDirection(spot.yaw, event.dx, event.dz);
    const strength = Math.min(1, Math.max(0, event.strength));
    const time = windTime();
    const index = registration.instanceIndex[best]!;
    for (const part of registration.parts) {
      if (part.variant !== variant) continue;
      const data = part.attribute.array as Float32Array;
      data[index * 4] = time;
      data[index * 4 + 1] = strength;
      data[index * 4 + 2] = local.x;
      data[index * 4 + 3] = local.z;
      part.attribute.needsUpdate = true;
    }
    this.total++;
    return role;
  }
}

/**
 * Autopilota di strada, stile Slow Roads: l'auto segue la carreggiata da sola.
 *
 * Non è un sistema di guida autonoma: è un pilota puro che insegue un punto
 * davanti alla macchina sulla centerline e modera il gas in curva. Sta fuori dal
 * mondo 3D e da Three.js, così si testa con un `CarState` finto.
 *
 * Perché il punto d'inseguimento e non il volante della strada: OSM disegna le
 * vie come polilinee spezzate e ricampionate; inseguire la tangente del
 * segmento fa oscillare il volante a ogni vertice, inseguire un punto 12 m più
 * avanti dà una traiettoria che taglia dolcemente le curve.
 */
import type { CarInput, CarState } from './car';

/** Tratto di strada su cui correggere la traiettoria. */
export interface RoadSegmentLike {
  ax: number;
  az: number;
  bx: number;
  bz: number;
}

export interface RoadTarget {
  x: number;
  z: number;
  /** velocità di crociera massima, m/s */
  cruise: number;
}

/** Differenza fra due angoli, riportata in -π…π. */
export function wrapAngle(angle: number): number {
  let a = angle;
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

/**
 * Punto di inseguimento: proiezione della macchina sul segmento, spostata in
 * avanti di `lookahead` metri **nel verso in cui sta andando l'auto**.
 * Il verso conta: molte vie OSM sono disegnate in senso opposto a quello di
 * marcia, e senza il segno l'autopilota sterzerebbe per fare inversione.
 */
export function followTarget(
  segment: RoadSegmentLike,
  x: number,
  z: number,
  yaw: number,
  lookahead = 12,
): { x: number; z: number } {
  const ex = segment.bx - segment.ax;
  const ez = segment.bz - segment.az;
  const len = Math.hypot(ex, ez) || 1;
  const dx = ex / len;
  const dz = ez / len;
  const along = Math.max(0, Math.min(len, (x - segment.ax) * dx + (z - segment.az) * dz));
  const px = segment.ax + dx * along;
  const pz = segment.az + dz * along;
  const forward = -Math.sin(yaw) * dx - Math.cos(yaw) * dz;
  const sign = forward >= 0 ? 1 : -1;
  return { x: px + dx * sign * lookahead, z: pz + dz * sign * lookahead };
}

/**
 * Comandi per l'autopilota: sterza verso il punto d'inseguimento e tiene la
 * crociera, rallentando quanto più la curva è stretta (l'errore di rotta è una
 * buona approssimazione del raggio: a 12 m di anticipo, 0,4 rad sono già
 * un'imboccatura da 30 m).
 */
export function autopilotInput(state: CarState, target: RoadTarget, far?: { x: number; z: number }): CarInput {
  const desired = Math.atan2(-(target.x - state.x), -(target.z - state.z));
  const error = wrapAngle(desired - state.yaw);
  const steer = Math.max(-1, Math.min(1, error * 2.2));

  // curva in arrivo: il punto lontano vede la piega prima che sia addosso.
  // Senza questo si frena con l'auto già dentro la curva, che è il modo
  // classico di arrivarci lunghi.
  let curve = Math.abs(error);
  if (far) {
    const farDesired = Math.atan2(-(far.x - state.x), -(far.z - state.z));
    curve = Math.max(curve, Math.abs(wrapAngle(farDesired - state.yaw)) * 0.85);
  }
  // il fattore scende fino a ~40% della crociera su una curva stretta
  const slow = Math.max(0.4, 1 - curve * 1.1);
  const cruise = target.cruise * slow;

  let throttle = 0;
  let brake = 0;
  if (state.speed < -0.3) {
    // sta andando indietro: prima si ferma, poi riparte
    brake = 1;
  } else if (state.speed < cruise - 0.6) {
    throttle = 1;
  } else if (state.speed > cruise + 1.6) {
    brake = state.speed > cruise + 4 ? 1 : 0.45;
  }
  return { throttle, brake, steer, handbrake: false };
}

/**
 * Fisica arcade dell'auto, pura e deterministica: nessuna dipendenza da Three.js
 * o dal DOM, così è testabile con vitest.
 *
 * Convenzione: yaw = 0 punta a nord (-z); avanti = (-sin yaw, -cos yaw).
 * yaw positivo = sterzata a sinistra.
 */

export interface CarState {
  x: number;
  z: number;
  yaw: number;
  /** velocità lungo l'asse longitudinale, m/s (negativa in retromarcia) */
  speed: number;
  /** angolo di sterzo corrente, -1..1 */
  steer: number;
}

export interface CarInput {
  /** 0..1 */
  throttle: number;
  /** 0..1 — frena se in marcia avanti, retromarcia da fermo */
  brake: number;
  /** -1..1 — positivo a sinistra */
  steer: number;
  handbrake: boolean;
}

export interface CarEnv {
  /** true se le ruote sono su asfalto */
  onRoad: boolean;
  /** quota del terreno */
  groundHeight: (x: number, z: number) => number;
}

export interface CarTuning {
  maxSpeed: number;
  reverseSpeed: number;
  engineAccel: number;
  brakeDecel: number;
  offroadSpeedFactor: number;
  offroadGrip: number;
  wheelbase: number;
  track: number;
  maxSteer: number;
  dragLinear: number;
  dragQuadratic: number;
  gravity: number;
}

/** Parametri di riferimento: una berlina media. Ogni veicolo può sovrascriverli. */
export const CAR: CarTuning = {
  maxSpeed: 34.5,
  reverseSpeed: 8.5,
  engineAccel: 9.2,
  brakeDecel: 20,
  offroadSpeedFactor: 0.62,
  offroadGrip: 0.58,
  wheelbase: 2.5,
  track: 1.68,
  maxSteer: 0.56,
  dragLinear: 0.16,
  dragQuadratic: 0.0009,
  gravity: 9.81,
};

const clamp = (v: number, a: number, b: number): number => (v < a ? a : v > b ? b : v);

export function createCarState(x: number, z: number, yaw = 0): CarState {
  return { x, z, yaw, speed: 0, steer: 0 };
}

export function stepCar(
  state: CarState,
  input: CarInput,
  env: CarEnv,
  dt: number,
  tuning: CarTuning = CAR,
): CarState {
  const next: CarState = { ...state };
  const surface = env.onRoad ? 1 : tuning.offroadSpeedFactor;
  const maxSpeed = tuning.maxSpeed * surface;
  const reverseMax = tuning.reverseSpeed * surface;

  // --- motore / freni -----------------------------------------------------
  if (input.throttle > 0) {
    const fade = 1 - clamp(Math.max(0, next.speed) / maxSpeed, 0, 1) * 0.55;
    next.speed += tuning.engineAccel * surface * fade * input.throttle * dt;
  }
  if (input.brake > 0) {
    if (next.speed > 0.4) {
      next.speed -= tuning.brakeDecel * input.brake * dt;
    } else {
      next.speed -= tuning.engineAccel * 0.55 * surface * input.brake * dt;
    }
  }

  // --- resistenze ---------------------------------------------------------
  next.speed -= next.speed * tuning.dragLinear * dt;
  next.speed -= Math.sign(next.speed) * tuning.dragQuadratic * next.speed * next.speed * dt;
  if (input.handbrake) next.speed -= next.speed * 2.2 * dt;
  if (input.throttle === 0 && input.brake === 0) next.speed -= next.speed * 0.55 * dt;

  // --- pendenza -----------------------------------------------------------
  const fx = -Math.sin(next.yaw);
  const fz = -Math.cos(next.yaw);
  const front = env.groundHeight(next.x + fx * tuning.wheelbase * 0.5, next.z + fz * tuning.wheelbase * 0.5);
  const back = env.groundHeight(next.x - fx * tuning.wheelbase * 0.5, next.z - fz * tuning.wheelbase * 0.5);
  const pitch = Math.atan2(front - back, tuning.wheelbase);
  next.speed -= tuning.gravity * Math.sin(pitch) * dt * 0.85;

  next.speed = clamp(next.speed, -reverseMax, maxSpeed);

  // --- sterzo (bicycle model) --------------------------------------------
  const steerTarget = clamp(input.steer, -1, 1);
  const steerLerp = 1 - Math.exp(-9 * dt);
  next.steer += (steerTarget - next.steer) * steerLerp;

  const speedRatio = clamp(Math.abs(next.speed) / tuning.maxSpeed, 0, 1);
  const steerAngle = next.steer * tuning.maxSteer * (1 - 0.55 * speedRatio);
  let yawRate = (next.speed / tuning.wheelbase) * Math.tan(steerAngle);
  if (input.handbrake) yawRate *= 1.9;
  // fuori strada il posteriore scivola un po' di più
  if (!env.onRoad) yawRate *= 1.12;
  next.yaw += yawRate * dt;

  // --- integrazione -------------------------------------------------------
  const ndx = -Math.sin(next.yaw);
  const ndz = -Math.cos(next.yaw);
  next.x += ndx * next.speed * dt;
  next.z += ndz * next.speed * dt;

  return next;
}

export function speedKmh(speed: number): number {
  return Math.abs(speed) * 3.6;
}

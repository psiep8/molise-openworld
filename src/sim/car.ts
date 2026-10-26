/**
 * Fisica dell'auto, pura e deterministica: nessuna dipendenza da Three.js
 * o dal DOM, così è testabile con vitest.
 *
 * Modello longitudinale: coppia motore da curva coppia/potenza, moltiplicata
 * dal rapporto in uso e dal finale, limitata dall'aderenza; resistenze di
 * rotolamento e aerodinamiche. Il cambio è automatico (con strappo di 0,28 s
 * e kickdown), la retromarcia si inserisce frenando da fermo e i freni
 * decelerano come un'auto stradale (~9–10 m/s²), non come un muro.
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
  /** marcia inserita: -1 retromarcia, 1..n marce avanti */
  gear: number;
  /** regime motore, giri/min */
  rpm: number;
  /** secondi residui di cambio marcia (coppia staccata) */
  shiftTimer: number;
  /** true se la coppia richiesta supera l'aderenza: le ruote pattinano */
  wheelspin: boolean;
}

export interface CarInput {
  /** 0..1 */
  throttle: number;
  /** 0..1 — frena se in marcia avanti, retromarcia da fermo */
  brake: number;
  /** -1..1 — positivo a sinistra */
  steer: number;
  handbrake: boolean;
  /**
   * Spinta temporanea (Shift): più aderenza disponibile e velocità massima
   * più alta. Non è un tasto magico: resta comunque limitata dalle gomme.
   */
  boost?: boolean;
}

export interface CarEnv {
  /** true se le ruote sono su asfalto */
  onRoad: boolean;
  /** quota del terreno */
  groundHeight: (x: number, z: number) => number;
}

export interface CarTuning {
  /** limiti di velocità, m/s */
  maxSpeed: number;
  reverseSpeed: number;
  mass: number;
  wheelRadius: number;
  /** potenza massima all'albero, W */
  power: number;
  /** coppia massima, Nm */
  torque: number;
  /** regimi di coppia e potenza massima, giri/min */
  rpmTorque: number;
  rpmPower: number;
  redlineRpm: number;
  idleRpm: number;
  /** rapporti del cambio, dalla prima alla più lunga */
  gearRatios: readonly number[];
  finalDrive: number;
  /** rendimento meccanico della trasmissione */
  drivetrainEfficiency: number;
  /** quota di peso sulle ruote motrici */
  tractionShare: number;
  /** coefficiente di aderenza su asfalto asciutto */
  grip: number;
  rollingResistance: number;
  /** CdA: coefficiente di penetrazione × superficie frontale, m² */
  dragArea: number;
  /** decelerazione dei freni di servizio, m/s² */
  brakeDecel: number;
  /** durata dell'inserimento marcia, s */
  shiftTime: number;
  offroadSpeedFactor: number;
  offroadGrip: number;
  wheelbase: number;
  track: number;
  maxSteer: number;
  gravity: number;
}

/** Parametri di riferimento: una berlina media. Ogni veicolo può sovrascriverli. */
export const CAR: CarTuning = {
  maxSpeed: 34.5,
  reverseSpeed: 8.5,
  mass: 1250,
  wheelRadius: 0.32,
  power: 80000,
  torque: 195,
  rpmTorque: 3400,
  rpmPower: 5500,
  redlineRpm: 6200,
  idleRpm: 800,
  gearRatios: [3.55, 1.95, 1.35, 1.03, 0.82],
  finalDrive: 3.9,
  drivetrainEfficiency: 0.9,
  tractionShare: 0.62,
  grip: 0.95,
  rollingResistance: 0.012,
  dragArea: 0.66,
  brakeDecel: 10,
  shiftTime: 0.28,
  offroadSpeedFactor: 0.62,
  offroadGrip: 0.58,
  wheelbase: 2.5,
  track: 1.68,
  maxSteer: 0.56,
  gravity: 9.81,
};

const AIR_DENSITY = 1.2;

const clamp = (v: number, a: number, b: number): number => (v < a ? a : v > b ? b : v);

export function createCarState(x: number, z: number, yaw = 0): CarState {
  return { x, z, yaw, speed: 0, steer: 0, gear: 1, rpm: 0, shiftTimer: 0, wheelspin: false };
}

/** Rapporto in uso: la retromarcia usa la prima, un filo più lunga. */
function gearRatio(tuning: CarTuning, gear: number): number {
  const first = tuning.gearRatios[0];
  if (gear < 0) return first * 1.05;
  return tuning.gearRatios[Math.min(Math.max(gear, 1), tuning.gearRatios.length) - 1];
}

/** Giri motore per una data velocità e rapporto. */
function rpmAt(speedAbs: number, ratio: number, tuning: CarTuning): number {
  return ((speedAbs / tuning.wheelRadius) * ratio * tuning.finalDrive * 60) / (2 * Math.PI);
}

/**
 * Coppia disponibile al regime dato.
 *
 * Sotto il regime di coppia massima il motore eroga al massimo `torque`;
 * sopra, la coppia segue la potenza massima (P/ω) e cala ancora un po'
 * verso il limitatore, come su un motore reale.
 */
function torqueAt(rpm: number, tuning: CarTuning): number {
  const omega = Math.max((rpm * Math.PI) / 30, 1);
  let torque = Math.min(tuning.torque, tuning.power / omega);
  if (rpm > tuning.rpmPower) {
    const over = clamp((rpm - tuning.rpmPower) / Math.max(1, tuning.redlineRpm - tuning.rpmPower), 0, 1);
    torque *= 1 - 0.18 * over;
  }
  if (rpm < tuning.rpmTorque) {
    // ai bassi regimi un motore stradale non dà già la coppia massima
    torque *= 0.82 + 0.18 * (rpm / tuning.rpmTorque);
  }
  if (rpm < tuning.idleRpm) {
    torque *= clamp((rpm - tuning.idleRpm * 0.35) / (tuning.idleRpm * 0.65), 0, 1);
  }
  return Math.max(0, torque);
}

export function stepCar(
  state: CarState,
  input: CarInput,
  env: CarEnv,
  dt: number,
  tuning: CarTuning = CAR,
): CarState {
  const next: CarState = { ...state };
  const gearCount = tuning.gearRatios.length;
  const surface = env.onRoad ? 1 : tuning.offroadSpeedFactor;
  // la spinta allunga anche il rapporto finale: +25% di velocità massima
  const maxSpeed = tuning.maxSpeed * surface * (input.boost ? 1.25 : 1);
  const reverseMax = tuning.reverseSpeed * surface;

  if (next.shiftTimer > 0) next.shiftTimer = Math.max(0, next.shiftTimer - dt);

  // --- selezione marcia: avanti / retromarcia ------------------------------
  // La retromarcia si inserisce col freno da fermo. Per tornare avanti basta
  // il gas, anche se l'auto sta ancora arretrando: è quello che fa un cambio
  // automatico quando si passa da R a D, e prima costringeva a fermarsi del
  // tutto (a 0 km/h) prima di poter ripartire.
  const wantsReverse = next.speed <= 0.25 && input.throttle < 0.05 && input.brake > 0.4;
  const wantsForward = input.throttle > 0.05 && input.brake < 0.05;
  if (next.gear < 0 && wantsForward) {
    next.gear = 1;
    next.shiftTimer = tuning.shiftTime;
  } else if (next.gear >= 1 && wantsReverse) {
    next.gear = -1;
    next.shiftTimer = tuning.shiftTime;
  }

  const forward = next.gear >= 1;
  const ratio = gearRatio(tuning, next.gear);
  const speedAbs = Math.abs(next.speed);
  // a frizione che slitta (partenza) il motore sta al minimo: la coppia arriva
  // comunque alle ruote, limitata dall'aderenza
  const rpm = Math.max(rpmAt(speedAbs, ratio, tuning), tuning.idleRpm);
  const torque = torqueAt(rpm, tuning);
  const gearForce = (torque * ratio * tuning.finalDrive * tuning.drivetrainEfficiency) / tuning.wheelRadius;

  const normalLoad = tuning.mass * tuning.gravity;
  // la spinta alza un po' l'aderenza disponibile e allunga il rapporto finale:
  // senza questo, con la coppia già oltre il limite di aderenza non cambierebbe
  // nulla fino a metà della scala di velocità
  const boostGrip = input.boost ? 1.18 : 1;
  const tractionLimit =
    tuning.grip * (env.onRoad ? 1 : tuning.offroadGrip) * normalLoad * tuning.tractionShare * boostGrip;

  // in retromarcia è il freno a dare gas all'indietro
  const driveInput = forward ? input.throttle : input.brake;
  const driveSign = forward ? 1 : -1;
  const shiftCut = next.shiftTimer > 0 ? 0 : 1;
  const demand = gearForce * driveInput * driveSign * shiftCut * (input.boost ? 1.25 : 1);
  const force = clamp(demand, -tractionLimit, tractionLimit);
  next.wheelspin = Math.abs(demand) > tractionLimit * 1.05 && driveInput > 0.25;

  // --- resistenze ----------------------------------------------------------
  const dir = Math.sign(next.speed);
  const rolling = tuning.rollingResistance * normalLoad * dir;
  const aero = 0.5 * AIR_DENSITY * tuning.dragArea * next.speed * speedAbs;
  const engineBrake = driveInput < 0.02 ? gearForce * 0.05 * dir : 0;

  let brakeForce = 0;
  if (forward && input.brake > 0 && speedAbs > 0.2) {
    brakeForce = tuning.brakeDecel * input.brake * tuning.mass * (env.onRoad ? 1 : tuning.offroadGrip) * dir;
  }
  // freno a mano: blocca il posteriore, decelera e fa scivolare il retrotreno
  if (input.handbrake && speedAbs > 0.2) brakeForce += 3.4 * tuning.mass * dir;

  // --- pendenza ------------------------------------------------------------
  const fx = -Math.sin(next.yaw);
  const fz = -Math.cos(next.yaw);
  const front = env.groundHeight(next.x + fx * tuning.wheelbase * 0.5, next.z + fz * tuning.wheelbase * 0.5);
  const back = env.groundHeight(next.x - fx * tuning.wheelbase * 0.5, next.z - fz * tuning.wheelbase * 0.5);
  const pitch = Math.atan2(front - back, tuning.wheelbase);
  const slopeAccel = -tuning.gravity * Math.sin(pitch) * 0.85;

  const accel = (force - rolling - aero - engineBrake - brakeForce) / tuning.mass + slopeAccel;
  let speed = next.speed + accel * dt;

  // i freni fermano l'auto, non la fanno ripartire all'indietro
  if (forward && input.brake > 0.05 && speed < 0) speed = 0;
  if (!forward && speed > 0) speed = 0;
  if (driveInput < 0.02 && Math.abs(speed) < 0.14) speed = 0;
  speed = clamp(speed, -reverseMax, maxSpeed);

  // --- cambio automatico ---------------------------------------------------
  if (forward && next.shiftTimer <= 0) {
    const rpmNow = rpmAt(Math.abs(speed), ratio, tuning);
    if (rpmNow > tuning.redlineRpm * 0.96 && next.gear < gearCount) {
      next.gear += 1;
      next.shiftTimer = tuning.shiftTime;
    } else if (next.gear > 1 && rpmNow < tuning.redlineRpm * 0.42) {
      next.gear -= 1;
      next.shiftTimer = tuning.shiftTime;
    } else if (next.gear > 1 && input.throttle > 0.95 && rpmNow < tuning.redlineRpm * 0.48) {
      // kickdown: piede a tavoletta, il cambio scala
      next.gear -= 1;
      next.shiftTimer = tuning.shiftTime;
    }
  }

  next.speed = speed;
  const displayRatio = gearRatio(tuning, next.gear);
  const rollingRpm = speedAbs < 0.3
    ? tuning.idleRpm + driveInput * 900
    : rpmAt(Math.abs(speed), displayRatio, tuning);
  next.rpm = clamp(rollingRpm, tuning.idleRpm, tuning.redlineRpm);

  // --- sterzo (bicycle model) ---------------------------------------------
  // La tastiera dà tutto lo sterzo in un colpo: la risposta va addolcita e il
  // lock va ridotto con la velocità. La riduzione era però troppo aggressiva
  // (a 30 km/h il volante restava quasi dritto e ogni curva richiedeva di
  // rallentare a passo d'uomo): ora il lock cala più lentamente e il tetto di
  // accelerazione laterale è quello di un'auto con gomme buone, non di un
  // tram. A 30 km/h il raggio d'azione resta intorno ai 9 m, a 50 km/h ai 16.
  const steerTarget = clamp(input.steer, -1, 1);
  const steerLerp = 1 - Math.exp(-8 * dt);
  next.steer += (steerTarget - next.steer) * steerLerp;

  const kmh = Math.abs(next.speed) * 3.6;
  const lock = tuning.maxSteer / (1 + kmh * 0.04);
  let yawRate = (next.speed / tuning.wheelbase) * Math.tan(next.steer * lock);
  const yawCap = Math.abs(next.speed) > 0.5 ? Math.min(2.6, 9.5 / Math.abs(next.speed)) : 2.6;
  yawRate = clamp(yawRate, -yawCap, yawCap);
  if (input.handbrake) yawRate *= 1.9;
  // fuori strada il posteriore scivola un po' di più
  if (!env.onRoad) yawRate *= 1.12;
  next.yaw += yawRate * dt;

  // --- integrazione --------------------------------------------------------
  const ndx = -Math.sin(next.yaw);
  const ndz = -Math.cos(next.yaw);
  next.x += ndx * next.speed * dt;
  next.z += ndz * next.speed * dt;

  return next;
}

export function speedKmh(speed: number): number {
  return Math.abs(speed) * 3.6;
}

/**
 * Scalino del cordolo (18 cm) preso in salita o in discesa.
 *
 * Il rialzo del marciapiede non è una rampa: salirci con le ruote costa
 * velocità e dà un colpo alla carrozzeria, scenderne uno più piccolo. La
 * funzione è pura per poterla testare senza scena 3D.
 */
/**
 * Inclinazione della carrozzeria: rollio verso l'esterno della curva e beccheggio
 * di frenata/accelerazione.
 *
 * Il rollio nasce dall'accelerazione laterale (velocità × velocità di imbardata):
 * a 50 km/h in una curva da 30 m sono circa 6,4 m/s², che su una berlina sono
 * 3–4° di inclinazione. Non è la sospensione vera, ma è quello che l'occhio usa
 * per capire che l'auto sta curvando.
 */
export function bodyLean(
  speed: number,
  yawRate: number,
  accel: number,
): { roll: number; pitch: number } {
  const lateral = speed * yawRate;
  const roll = clamp(-lateral * 0.011, -0.1, 0.1);
  // frenata = muso giù, accelerazione = muso su (piccolo: non è un dragster)
  const pitch = clamp(accel * 0.0045, -0.035, 0.035);
  return { roll, pitch };
}

export function curbImpact(
  previousLift: number,
  lift: number,
): { speedFactor: number; bump: number } {
  const step = lift - previousLift;
  if (step > 0.12) return { speedFactor: 0.9, bump: Math.min(0.055, step * 0.28) };
  if (step < -0.12) return { speedFactor: 0.97, bump: Math.min(0.03, -step * 0.14) };
  return { speedFactor: 1, bump: 0 };
}

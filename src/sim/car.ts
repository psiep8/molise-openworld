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

import {
  surfaceConditions,
  surfaceMaterial,
  type SurfaceWeather,
  type WheelSlip,
} from './surfaces';

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
  /** velocità longitudinale nel sistema auto; `speed` resta l'alias retrocompatibile */
  vx: number;
  /** velocità laterale nel sistema auto, positiva verso sinistra, m/s */
  vy: number;
  /** velocità di imbardata, rad/s */
  yawRate: number;
  wheelSlip: { fl: WheelSlip; fr: WheelSlip; rl: WheelSlip; rr: WheelSlip };
  /** 0..1: quota di pneumatici oltre il picco di aderenza */
  sliding: number;
  /** true quando l'ABS riduce la pressione su almeno una ruota */
  absActive?: boolean;
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
  /** grip ambientale da pioggia/neve; 1 = asciutto, valori minori = scivoloso */
  gripScale?: number;
  /** condizioni atmosferiche; gripScale è mantenuto per i vecchi chiamanti */
  weather?: Partial<SurfaceWeather>;
  /** materiale restituito dal campionatore del terreno */
  surface?: string;
  /** materiale misurato sotto ciascuna ruota, quando disponibile */
  wheelSurfaces?: Partial<Record<'fl' | 'fr' | 'rl' | 'rr', string>>;
  /**
   * Attrito della vegetazione attraversata (0 = niente, 1 = macchia fitta).
   * Non è una collisione: l'auto passa, ma perde velocità e allunga la frenata.
   */
  vegetationDrag?: number;
}

interface SurfacePhysics {
  speed: number;
  grip: number;
  rolling: number;
  sink: number;
}

function surfacePhysics(env: CarEnv, tuning: CarTuning, speed: number): SurfacePhysics {
  const surface = env.surface?.toLowerCase();
  const normalized = surface ?? (env.onRoad ? 'asphalt' : 'terrain');
  const material = surfaceMaterial(normalized);
  const isPaved = ['asphalt', 'concrete', 'paving_stones', 'paved', 'cobblestone', 'sett'].includes(normalized);
  const conditions = surfaceConditions(normalized, env.weather, speed);
  const speedFactor = material.id === 'gravel' ? 0.78 :
    material.id === 'dirt' ? (surface === 'terrain' ? tuning.offroadSpeedFactor : 0.7) :
      material.id === 'rock' ? 0.74 : material.id === 'mud' || material.id === 'sand' ? 0.52 :
        material.id === 'grass' ? 0.5 : material.id === 'woodland' ? 0.48 : isPaved ? 1 :
            surface === undefined && !env.onRoad ? tuning.offroadSpeedFactor :
            tuning.offroadSpeedFactor;
  return {
    speed: speedFactor,
    grip: Math.max(0.04, conditions.muPeak),
    rolling: conditions.rolling,
    sink: conditions.sink,
  };
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
  /** schema di trazione e taratura del corpo rigido */
  drive?: 'fwd' | 'rwd' | 'awd';
  centerOfGravityHeight?: number;
  yawInertiaScale?: number;
  brakeBias?: number;
  abs?: boolean;
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
  drive: 'rwd',
  centerOfGravityHeight: 0.5,
  yawInertiaScale: 1.2,
  brakeBias: 0.64,
  abs: true,
};

const AIR_DENSITY = 1.2;
/**
 * Lock dello sterzo a velocità: a 0 km/h tutto, poi cala in modo dolce.
 * 0,028 per km/h è la taratura "gioco di guida": a 100 km/h resta circa un
 * quinto della sterzata, abbastanza per una curva d'emergenza ma non per
 * ribaltarsi. La stessa funzione serve alla grafica delle ruote anteriori, così
 * quello che si vede combacia con quello che fa la fisica.
 */
const STEER_LOCK_FALLOFF = 0.028;
/** Accelerazione laterale massima (m/s²): ~1,25 g su asfalto asciutto. */
const LATERAL_GRIP = 12.5;
/** Tetto di imbardata a bassissima velocità (rad/s). */
const MAX_YAW_RATE = 2.7;

const clamp = (v: number, a: number, b: number): number => (v < a ? a : v > b ? b : v);

export function createCarState(x: number, z: number, yaw = 0): CarState {
  const slip = (): WheelSlip => ({ long: 0, lat: 0, load: 0.25, locked: false });
  return {
    x, z, yaw, speed: 0, vx: 0, vy: 0, yawRate: 0,
    wheelSlip: { fl: slip(), fr: slip(), rl: slip(), rr: slip() },
    sliding: 0, steer: 0, gear: 1, rpm: 0, shiftTimer: 0, wheelspin: false,
  };
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
  // Alcuni salvataggi e chiamanti legacy impostano `speed` direttamente.
  // In tal caso la velocità storica resta la fonte autorevole.
  if (state.speed !== state.vx) next.vx = state.speed;
  next.vy ??= 0;
  next.yawRate ??= 0;
  next.wheelSlip ??= {
    fl: { long: 0, lat: 0, load: 0.25, locked: false },
    fr: { long: 0, lat: 0, load: 0.25, locked: false },
    rl: { long: 0, lat: 0, load: 0.25, locked: false },
    rr: { long: 0, lat: 0, load: 0.25, locked: false },
  };
  next.sliding ??= 0;
  next.speed = next.vx;
  const gearCount = tuning.gearRatios.length;
  const surface = surfacePhysics(env, tuning, next.speed);
  const vegetationDrag = clamp(env.vegetationDrag ?? 0, 0, 1);
  // la spinta allunga anche il rapporto finale: +25% di velocità massima
  const maxSpeed =
    tuning.maxSpeed * surface.speed * (input.boost ? 1.25 : 1) * (1 - 0.28 * vegetationDrag);
  const reverseMax = tuning.reverseSpeed * surface.speed * (1 - 0.28 * vegetationDrag);

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
  const gripScale = clamp(env.gripScale ?? 1, 0.15, 1.2);
  // la spinta alza un po' l'aderenza disponibile e allunga il rapporto finale:
  // senza questo, con la coppia già oltre il limite di aderenza non cambierebbe
  // nulla fino a metà della scala di velocità
  const boostGrip = input.boost ? 1.18 : 1;
  const tractionLimit =
    tuning.grip * surface.grip * normalLoad * tuning.tractionShare * boostGrip * gripScale;

  // in retromarcia è il freno a dare gas all'indietro
  const driveInput = forward ? input.throttle : input.brake;
  const driveSign = forward ? 1 : -1;
  const shiftCut = next.shiftTimer > 0 ? 0 : 1;
  const demand = gearForce * driveInput * driveSign * shiftCut * (input.boost ? 1.25 : 1);
  const topMaterial = surfaceConditions(
    env.surface ?? (env.onRoad ? 'asphalt' : 'terrain'),
    env.weather,
    speedAbs,
  );
  const slidingTractionLimit = tractionLimit * topMaterial.muSlide /
    Math.max(0.04, topMaterial.muPeak);
  const force = Math.sign(demand) * Math.min(
    Math.abs(demand),
    Math.abs(demand) > tractionLimit ? slidingTractionLimit : tractionLimit,
  );
  next.wheelspin = Math.abs(demand) > tractionLimit * 1.05 && driveInput > 0.25;

  // --- resistenze ----------------------------------------------------------
  const dir = Math.sign(next.speed);
  const rolling = tuning.rollingResistance * surface.rolling * normalLoad * dir;
  const sink = surface.sink * (0.25 + speedAbs * 0.08) * tuning.mass * dir;
  const aero = 0.5 * AIR_DENSITY * tuning.dragArea * next.speed * speedAbs;
  const engineBrake = driveInput < 0.02 ? gearForce * 0.05 * dir : 0;

  let brakeForce = 0;
  if (forward && input.brake > 0 && speedAbs > 0.2) {
    const brakeConditions = surfaceConditions(
      env.surface ?? (env.onRoad ? 'asphalt' : 'terrain'),
      env.weather,
      speedAbs,
    );
    const brakePeak = tuning.grip * brakeConditions.muPeak * gripScale * tuning.gravity;
    const brakeSlide = tuning.grip * brakeConditions.muSlide * gripScale * tuning.gravity;
    const requestedBrake = tuning.brakeDecel * input.brake;
    const deceleration = tuning.abs === false && requestedBrake > brakePeak
      ? brakeSlide
      : Math.min(requestedBrake, brakePeak);
    brakeForce = deceleration * tuning.mass * dir;
  }
  // freno a mano: blocca il posteriore, decelera e fa scivolare il retrotreno
  if (input.handbrake && speedAbs > 0.2) {
    const handbrakeDecel = Math.min(
      3.4,
      tuning.grip * topMaterial.muSlide * gripScale * tuning.gravity,
    );
    brakeForce += handbrakeDecel * tuning.mass * dir;
  }
  // cespugli e sottobosco non sono muri: si attraversano, ma ogni metro costa
  // velocità. La forza è proporzionale alla massa così resta ~2,4 m/s² pieni.
  const vegetation = vegetationDrag * 2.4 * tuning.mass * dir;

  // --- pendenza ------------------------------------------------------------
  const fx = -Math.sin(next.yaw);
  const fz = -Math.cos(next.yaw);
  const front = env.groundHeight(next.x + fx * tuning.wheelbase * 0.5, next.z + fz * tuning.wheelbase * 0.5);
  const back = env.groundHeight(next.x - fx * tuning.wheelbase * 0.5, next.z - fz * tuning.wheelbase * 0.5);
  const pitch = Math.atan2(front - back, tuning.wheelbase);
  const slopeAccel = -tuning.gravity * Math.sin(pitch) * 0.85;

  const accel =
    (force - rolling - sink - aero - engineBrake - brakeForce - vegetation) / tuning.mass + slopeAccel;
  let speed = next.speed + accel * dt;

  // i freni fermano l'auto, non la fanno ripartire all'indietro
  if (forward && input.brake > 0.05 && speed < 0) speed = 0;
  if (!forward && speed > 0) speed = 0;
  if (driveInput < 0.02 && Math.abs(speed) < 0.14) speed = 0;
  speed = clamp(speed, -reverseMax, maxSpeed);

  // --- cambio automatico ---------------------------------------------------
  if (forward && next.shiftTimer <= 0) {
    const rpmNow = rpmAt(Math.abs(speed), ratio, tuning);
    // Si sale vicino al regime di potenza massima, non al limitatore: se si
    // aspettano i 96% del limitatore, un'auto che in penultima marcia non
    // arriva a quel regime (la Golf in quinta si fermava a 6523 giri su 6528)
    // non inserisce mai la marcia piu' lunga e perde 9 km/h di punta.
    const upshiftRpm = Math.min(tuning.redlineRpm * 0.96, tuning.rpmPower * 1.03);
    if (rpmNow > upshiftRpm && next.gear < gearCount) {
      next.gear += 1;
      next.shiftTimer = tuning.shiftTime;
    } else if (next.gear > 1 && rpmNow < tuning.redlineRpm * 0.42) {
      next.gear -= 1;
      next.shiftTimer = tuning.shiftTime;
    } else if (
      next.gear > 1 &&
      input.throttle > 0.95 &&
      rpmNow < Math.min(tuning.redlineRpm * 0.48, tuning.rpmPower * 0.55)
    ) {
      // kickdown: piede a tavoletta, il cambio scala. La soglia deve stare
      // sotto i giri che la marcia superiore ha subito dopo il passaggio,
      // altrimenti la Uno resta a oscillare fra prima e seconda a 33 km/h.
      next.gear -= 1;
      next.shiftTimer = tuning.shiftTime;
    }
  }

  next.speed = speed;
  next.vx = speed;
  const displayRatio = gearRatio(tuning, next.gear);
  const rollingRpm = speedAbs < 0.3
    ? tuning.idleRpm + driveInput * 900
    : rpmAt(Math.abs(speed), displayRatio, tuning);
  next.rpm = clamp(rollingRpm, tuning.idleRpm, tuning.redlineRpm);

  // --- pneumatici e corpo rigido planare ----------------------------------
  // Forze di pneumatico stabili a passi fissi; lo slip regolarizzato e la
  // zona quasi-statica evitano singolarità quando l'auto è quasi ferma.
  const steerTarget = clamp(input.steer, -1, 1);
  const steerLerp = 1 - Math.exp(-10 * dt);
  next.steer += (steerTarget - next.steer) * steerLerp;
  const lock = steerLock(tuning.maxSteer, next.speed);
  const delta = next.steer * lock;
  const inertia = tuning.mass *
    (tuning.wheelbase * tuning.wheelbase + tuning.track ** 2) / 12 *
    (tuning.yawInertiaScale ?? 1.2);
  const frontAxle = tuning.wheelbase * 0.42;
  const rearAxle = tuning.wheelbase - frontAxle;
  const cgHeight = tuning.centerOfGravityHeight ?? 0.5;
  const axleFrontShare = 0.56;
  const drive = tuning.drive ?? 'rwd';
  const drivenWheelCount = drive === 'awd' ? 4 : 2;
  const driveWheelShare = 1 / drivenWheelCount;
  const brakeBias = clamp(tuning.brakeBias ?? 0.64, 0.5, 0.8);
  const currentWeather = env.weather ?? {};
  const substeps = Math.max(1, Math.ceil(Math.max(0, dt) * 120));
  const h = substeps > 0 ? dt / substeps : 0;
  let lateralAcceleration = 0;
  let slidingSum = 0;
  let slipState = next.wheelSlip;
  let absActive = false;
  const wheelIds = ['fl', 'fr', 'rl', 'rr'] as const;

  for (let step = 0; step < substeps; step++) {
    const longitudinalAcceleration = dt > 0 ? (speed - state.speed) / dt : 0;
    const fzFront = tuning.mass * tuning.gravity * axleFrontShare -
      tuning.mass * longitudinalAcceleration * cgHeight / tuning.wheelbase;
    const fzRear = tuning.mass * tuning.gravity * (1 - axleFrontShare) +
      tuning.mass * longitudinalAcceleration * cgHeight / tuning.wheelbase;
    const sideTransfer = tuning.mass * lateralAcceleration * cgHeight / tuning.track;
    const loads = [
      Math.max(0.04, (fzFront * 0.5 - sideTransfer * axleFrontShare * 0.5) /
        (tuning.mass * tuning.gravity)),
      Math.max(0.04, (fzFront * 0.5 + sideTransfer * axleFrontShare * 0.5) /
        (tuning.mass * tuning.gravity)),
      Math.max(0.04, (fzRear * 0.5 - sideTransfer * (1 - axleFrontShare) * 0.5) /
        (tuning.mass * tuning.gravity)),
      Math.max(0.04, (fzRear * 0.5 + sideTransfer * (1 - axleFrontShare) * 0.5) /
        (tuning.mass * tuning.gravity)),
    ];
    const positions = [
      { axle: frontAxle, side: -0.5, front: true },
      { axle: frontAxle, side: 0.5, front: true },
      { axle: -rearAxle, side: -0.5, front: false },
      { axle: -rearAxle, side: 0.5, front: false },
    ];
    let totalLateral = 0;
    let yawMoment = 0;
    let overLimit = 0;
    const updated = {} as CarState['wheelSlip'];
    for (let i = 0; i < wheelIds.length; i++) {
      const id = wheelIds[i]!;
      const position = positions[i]!;
      const localSurface = env.wheelSurfaces?.[id] ?? env.surface;
      const localConditions = surfaceConditions(
        localSurface,
        currentWeather,
        Math.abs(next.vx),
      );
      const mu = Math.max(0.04, tuning.grip * localConditions.muPeak * gripScale);
      const muSlide = Math.max(0.035, tuning.grip * localConditions.muSlide * gripScale);
      const load = loads[i]! * tuning.mass * tuning.gravity;
      const capacity = mu * load;
      const slidingCapacity = muSlide * load;
      const isDriven = drive === 'awd' || (drive === 'fwd' && position.front) ||
        (drive === 'rwd' && !position.front);
      const wheelLongDemand = isDriven ? Math.abs(force) * driveWheelShare : 0;
      const wheelBrakeDemand = input.brake * tuning.brakeDecel * tuning.mass *
        (position.front ? brakeBias / 2 : (1 - brakeBias) / 2);
      absActive ||= !!tuning.abs && input.brake > 0.15 && wheelBrakeDemand > capacity * 0.78;
      const handbrakeLocked = input.handbrake && !position.front && Math.abs(next.speed) > 0.8;
      const brakeLocked = !tuning.abs && wheelBrakeDemand > capacity * 0.92;
      const locked = handbrakeLocked || brakeLocked;
      const longitudinalUse = locked ? 1 : clamp(
        (wheelLongDemand + wheelBrakeDemand) / Math.max(1, capacity), 0, 0.96,
      );
      const longitudinalSlip = handbrakeLocked
        ? -Math.sign(next.speed || 1)
        : brakeLocked ? -Math.sign(next.speed || 1) * 0.85
          : isDriven && wheelLongDemand > capacity * 0.75
            ? clamp((wheelLongDemand / Math.max(1, capacity) - 0.7) * 0.5, 0, 1)
            : (input.brake > 0.05 ? -input.brake * 0.08 : 0);

      const axleVy = next.vy + next.yawRate * position.axle;
      const wheelVx = Math.max(0.01, Math.abs(next.vx) - next.yawRate * position.side * (tuning.track ?? 1.68) * 0.5);
      const slipAngle = Math.atan2(axleVy, wheelVx) - (position.front ? delta : 0);
      const slipMagnitude = Math.abs(slipAngle);
      const peakSlipAngle = 0.12;
      const slidingRatio = slidingCapacity / Math.max(1, capacity);
      const tireCurve = slipMagnitude <= peakSlipAngle
        ? slipMagnitude / peakSlipAngle
        : slidingRatio + (1 - slidingRatio) *
          Math.exp(-(slipMagnitude - peakSlipAngle) * 6);
      const rawLateral = -Math.sign(slipAngle) * capacity * tireCurve;
      const remainingGrip = Math.sqrt(Math.max(0, 1 - longitudinalUse * longitudinalUse));
      const lateralForce = clamp(rawLateral, -capacity * remainingGrip, capacity * remainingGrip);
      const lateralRatio = Math.abs(slipAngle) / peakSlipAngle;
      const sliding = clamp(Math.max(
        (lateralRatio - 1) / 2,
        Math.abs(longitudinalSlip) * 0.8,
      ), 0, 1);
      updated[id] = {
        long: clamp(longitudinalSlip, -1, 1),
        lat: clamp(slipAngle, -1.5, 1.5),
        load: clamp(load / (tuning.mass * tuning.gravity / 4), 0.15, 2.5),
        locked,
      };
      totalLateral += lateralForce;
      yawMoment += lateralForce * position.axle;
      overLimit += sliding;
    }

    // La pendenza laterale usa la stessa quota campionata del terreno; se
    // l'aderenza è bassa l'auto scivola gradualmente verso valle.
    const slopeLeft = (env.groundHeight(next.x - Math.cos(next.yaw) * 1.5, next.z + Math.sin(next.yaw) * 1.5) -
      env.groundHeight(next.x + Math.cos(next.yaw) * 1.5, next.z - Math.sin(next.yaw) * 1.5)) / 3;
    const sideSlopeAccel = clamp(slopeLeft, -0.5, 0.5) * tuning.gravity;
    const lateralAccel = totalLateral / tuning.mass + sideSlopeAccel * (1 - surface.grip);
    lateralAcceleration = lateralAccel;
    const yawAccel = yawMoment / Math.max(1, inertia);
    next.yawRate += yawAccel * h;
    next.yawRate *= Math.exp(-0.9 * h);

    if (Math.abs(next.vx) < 1.5) {
      // Quasi-statico: conserva il raggio di sterzata atteso a passo d'uomo,
      // ma lascia che il freno a mano liberi il retrotreno quando si muove.
      const requested = (next.vx / tuning.wheelbase) * Math.tan(delta);
      const target = requested * surface.grip;
      next.yawRate += (target - next.yawRate) * (1 - Math.exp(-8 * h));
      next.vy *= Math.exp(-4 * h);
      if (Math.abs(next.vx) < 0.2 && !input.handbrake) next.yawRate = 0;
    } else {
      next.vy += (lateralAccel - next.yawRate * next.vx) * h;
      next.vy *= Math.exp(-0.04 * h);
    }

    const yawCap = Math.min(MAX_YAW_RATE, LATERAL_GRIP * surface.grip /
      Math.max(1.5, Math.abs(next.vx)));
    next.yawRate = clamp(next.yawRate, -yawCap, yawCap);
    next.yaw += next.yawRate * h;
    const forwardX = -Math.sin(next.yaw);
    const forwardZ = -Math.cos(next.yaw);
    const leftX = -Math.cos(next.yaw);
    const leftZ = Math.sin(next.yaw);
    next.x += (forwardX * next.vx + leftX * next.vy) * h;
    next.z += (forwardZ * next.vx + leftZ * next.vy) * h;
    slipState = updated;
    slidingSum = overLimit / wheelIds.length;
  }

  next.wheelSlip = slipState;
  next.sliding = clamp(slidingSum, 0, 1);
  next.absActive = absActive;
  next.speed = next.vx;
  // Fattore di carico laterale limitato alla capacità complessiva: usato dai
  // feedback visivi senza duplicare il modello dei pneumatici.
  void lateralAcceleration;

  return next;
}

export function speedKmh(speed: number): number {
  return Math.abs(speed) * 3.6;
}

/**
 * Angolo massimo delle ruote anteriori alla velocità corrente (radianti).
 * Pura: la usano sia `stepCar` sia `Vehicle` per far sterzare i GLB con lo
 * stesso angolo della fisica (prima la grafica girava troppo e sembrava che
 * l'auto non seguisse le ruote).
 */
export function steerLock(maxSteer: number, speed: number): number {
  return maxSteer / (1 + Math.abs(speed) * 3.6 * STEER_LOCK_FALLOFF);
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
  leanFactor = 1,
  maxRoll = 0.1,
): { roll: number; pitch: number } {
  const lateral = speed * yawRate;
  const roll = clamp(-lateral * 0.011 * leanFactor, -maxRoll, maxRoll);
  // frenata = muso giù, accelerazione = muso su (piccolo: non è un dragster)
  const pitch = clamp(accel * 0.0045, -0.035, 0.035);
  return { roll, pitch };
}

/**
 * Fase del lampeggio delle frecce: 1,4 Hz, acceso per il 55% del periodo.
 *
 * È lo stesso ritmo delle frecce vere (1–2 Hz) e sta fuori dal modello 3D per
 * poterlo testare: la luce deve spegnersi, non solo cambiare intensità, altrimenti
 * di giorno sembra sempre accesa.
 */
export function blinkOn(time: number, hz = 1.4): boolean {
  const phase = ((time * hz) % 1 + 1) % 1;
  return phase < 0.55;
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

/**
 * Locomozione umana, pura e senza Three.js.
 *
 * Le clip di camminata e corsa hanno durate diverse e il terreno sotto i piedi
 * non è mai perfettamente piatto: se questi calcoli vivono dentro il renderer
 * non si possono provare senza WebGL. Qui stanno le regole (pesi del blend,
 * velocità delle clip, fase di falcata, inclinazione del corpo e posa seduta)
 * e `HumanBody`/`Player` si limitano ad applicarle.
 */

export type LocomotionState = 'idle' | 'walk' | 'run';

export interface LocomotionWeights {
  idle: number;
  walk: number;
  run: number;
}

export interface SeatPose {
  /** rotazione X della coscia: positiva in avanti */
  hip: number;
  /** rotazione X della tibia: negativa, il polpaccio va indietro */
  knee: number;
  /** rotazione X del braccio: positiva in avanti */
  arm: number;
  /** rotazione X dell'avambraccio: negativa, il gomito si chiude verso il volante */
  elbow: number;
  /** rotazione X del busto: positiva in avanti */
  torso: number;
}

const clamp = (value: number, min: number, max: number): number =>
  value < min ? min : value > max ? max : value;

function smoothstep(value: number, edge0: number, edge1: number): number {
  if (!(edge1 > edge0)) return value >= edge1 ? 1 : 0;
  const t = clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

function normalize(weights: LocomotionWeights): LocomotionWeights {
  const idle = Number.isFinite(weights.idle) ? Math.max(0, weights.idle) : 0;
  const walk = Number.isFinite(weights.walk) ? Math.max(0, weights.walk) : 0;
  const run = Number.isFinite(weights.run) ? Math.max(0, weights.run) : 0;
  const sum = idle + walk + run;
  if (!(sum > 1e-9)) return { idle: 1, walk: 0, run: 0 };
  return { idle: idle / sum, walk: walk / sum, run: run / sum };
}

/**
 * Pesi desiderati per una certa velocità, normalizzati a 1.
 *
 * Sotto 0,2 m/s il personaggio è fermo; la camminata entra gradualmente fino
 * a ~1,1 m/s e la corsa si sovrappone fra `walkSpeed * 1,12` e
 * `runSpeed * 0,92`, così il passaggio non ha scatti.
 */
export function locomotionWeights(
  speed: number,
  walkSpeed: number,
  runSpeed: number,
): LocomotionWeights {
  if (!Number.isFinite(speed) || speed <= 0) return { idle: 1, walk: 0, run: 0 };
  const walkIn = smoothstep(speed, 0.2, 1.1);
  const runStart = Math.max(1.1001, Math.max(0, walkSpeed) * 1.12);
  const runEnd = Math.max(runStart + 0.01, Math.max(0, runSpeed) * 0.92);
  const runIn = smoothstep(speed, runStart, runEnd);
  const idleWant = 1 - walkIn;
  const runWant = runIn;
  const walkWant = Math.max(0, 1 - idleWant - runWant);
  return normalize({ idle: idleWant, walk: walkWant, run: runWant });
}

/**
 * Avvicina i pesi al bersaglio con una costante di tempo, indipendente dal
 * frame rate: due passi da 1/60 s danno lo stesso risultato di uno da 1/30 s.
 */
export function blendLocomotion(
  current: LocomotionWeights,
  target: LocomotionWeights,
  dt: number,
  rate = 10,
): LocomotionWeights {
  if (!Number.isFinite(dt) || dt < 0) return { ...current };
  const safeRate = Number.isFinite(rate) && rate >= 0 ? rate : 10;
  const k = dt > 0 ? 1 - Math.exp(-safeRate * dt) : 0;
  return normalize({
    idle: current.idle + (target.idle - current.idle) * k,
    walk: current.walk + (target.walk - current.walk) * k,
    run: current.run + (target.run - current.run) * k,
  });
}

/** Stato dominante; a parità vince l'ordine idle → walk → run. */
export function dominantState(weights: LocomotionWeights): LocomotionState {
  const ordered: Array<[LocomotionState, number]> = [
    ['idle', weights.idle],
    ['walk', weights.walk],
    ['run', weights.run],
  ];
  let best: LocomotionState = 'idle';
  let bestValue = -Infinity;
  for (const [state, raw] of ordered) {
    const value = Number.isFinite(raw) ? raw : 0;
    if (value > bestValue + 1e-9) {
      best = state;
      bestValue = value;
    }
  }
  return best;
}

/**
 * Velocità di riproduzione della clip: una camminata lenta non deve sembrare
 * un passo di robot né una corsa a rallentatore.
 */
export function strideTimeScale(
  kind: 'walk' | 'run',
  speed: number,
  walkSpeed: number,
  runSpeed: number,
): number {
  const lower = kind === 'walk' ? 0.65 : 0.8;
  const upper = kind === 'walk' ? 1.6 : 1.3;
  const reference = kind === 'walk' ? walkSpeed : runSpeed;
  if (!Number.isFinite(speed) || speed <= 0 || !(reference > 0)) return lower;
  return clamp(speed / reference, lower, upper);
}

/**
 * Porta la seconda clip alla stessa frazione di falcata della prima.
 * Ritorna `null` se i tempi non sono utilizzabili.
 */
export function syncStridePhase(
  duration: number,
  sourceTime: number,
  sourceDuration: number,
): number | null {
  if (!(duration > 0) || !(sourceDuration > 0) || !Number.isFinite(sourceTime)) return null;
  if (!Number.isFinite(duration) || !Number.isFinite(sourceDuration)) return null;
  const phase = (((sourceTime % sourceDuration) + sourceDuration) % sourceDuration) / sourceDuration;
  return phase * duration;
}

/**
 * Pendenza sotto il personaggio, misurata sui due piedi e lungo la direzione
 * di marcia. `pitch` positivo in salita, `roll` positivo quando il piede
 * sinistro è più in basso (il corpo pende a sinistra).
 */
export function terrainTilt(
  heightAt: (x: number, z: number) => number,
  x: number,
  z: number,
  yaw: number,
): { pitch: number; roll: number } {
  if (!Number.isFinite(x) || !Number.isFinite(z) || !Number.isFinite(yaw)) {
    return { pitch: 0, roll: 0 };
  }
  const fx = -Math.sin(yaw);
  const fz = -Math.cos(yaw);
  const lx = -Math.cos(yaw);
  const lz = Math.sin(yaw);

  const ahead = heightAt(x + fx * 0.22, z + fz * 0.22);
  const behind = heightAt(x - fx * 0.22, z - fz * 0.22);
  const left = heightAt(x + lx * 0.16, z + lz * 0.16);
  const right = heightAt(x - lx * 0.16, z - lz * 0.16);

  const pitch = Number.isFinite(ahead) && Number.isFinite(behind)
    ? clamp(Math.atan2(ahead - behind, 0.44), -0.22, 0.22)
    : 0;
  const roll = Number.isFinite(left) && Number.isFinite(right)
    ? clamp(Math.atan2(right - left, 0.32), -0.22, 0.22)
    : 0;
  return { pitch, roll };
}

/** Avanzamento morbido di una transizione a tempo (ingresso/uscita auto). */
export function transitionProgress(elapsed: number, duration: number): number {
  if (!Number.isFinite(elapsed)) return 0;
  if (!Number.isFinite(duration) || duration <= 0) return 1;
  if (elapsed <= 0) return 0;
  if (elapsed >= duration) return 1;
  const t = elapsed / duration;
  return t * t * (3 - 2 * t);
}

/**
 * Posa seduta additiva: 0 in piedi, 1 seduto. Le rotazioni sono offset in
 * radianti da sommare alle ossa, non una clip completa: così il corpo resta
 * animato anche durante l'ingresso in auto.
 */
export function seatPose(progress: number): SeatPose {
  const p = Number.isFinite(progress) ? clamp(progress, 0, 1) : 0;
  const smooth = p * p * (3 - 2 * p);
  return {
    hip: 1.1 * smooth,
    knee: smooth > 0 ? -1.4 * smooth : 0,
    // La spalla ruota poco su un asse obliquo, il gomito si chiude molto: le
    // mani finiscono ~30 cm avanti e 15 sopra la spina, all'altezza del volante,
    // invece di restare appese lungo i fianchi.
    arm: 0.3 * smooth,
    elbow: smooth > 0 ? -1.9 * smooth : 0,
    torso: 0.15 * smooth,
  };
}

/**
 * Quota del terreno sotto ciascun piede, con la stessa geometria usata da
 * `terrainTilt`. Se un campione non è valido si ricade sulla quota del corpo.
 */
export function footHeights(
  heightAt: (x: number, z: number) => number,
  x: number,
  z: number,
  yaw: number,
): { left: number; right: number; average: number; spread: number } {
  const center = Number.isFinite(x) && Number.isFinite(z) ? heightAt(x, z) : 0;
  const fallback = Number.isFinite(center) ? center : 0;
  if (!Number.isFinite(x) || !Number.isFinite(z) || !Number.isFinite(yaw)) {
    return { left: fallback, right: fallback, average: fallback, spread: 0 };
  }
  const lx = -Math.cos(yaw);
  const lz = Math.sin(yaw);
  const rawLeft = heightAt(x + lx * 0.16, z + lz * 0.16);
  const rawRight = heightAt(x - lx * 0.16, z - lz * 0.16);
  const left = Number.isFinite(rawLeft) ? rawLeft : fallback;
  const right = Number.isFinite(rawRight) ? rawRight : fallback;
  return {
    left,
    right,
    average: (left + right) / 2,
    spread: Math.abs(left - right),
  };
}

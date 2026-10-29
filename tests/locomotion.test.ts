import { describe, expect, it } from 'vitest';
import {
  blendLocomotion,
  dominantState,
  footHeights,
  locomotionWeights,
  seatPose,
  strideTimeScale,
  syncStridePhase,
  terrainTilt,
  transitionProgress,
  type LocomotionWeights,
} from '../src/entities/locomotion';

const WALK = 2.2;
const RUN = 5.5;
const plane = (x: number, z: number): number => 0.2 * x + 0.1 * z;

const sum = (weights: LocomotionWeights): number => weights.idle + weights.walk + weights.run;

describe('pesi della locomozione', () => {
  it('sono sempre normalizzati e a velocità zero è tutto idle', () => {
    for (const speed of [0, 0.1, 0.5, 1, 2.2, 3.4, 5.5, 10, 40]) {
      const weights = locomotionWeights(speed, WALK, RUN);
      expect(sum(weights)).toBeCloseTo(1, 10);
      expect(weights.idle).toBeGreaterThanOrEqual(0);
      expect(weights.walk).toBeGreaterThanOrEqual(0);
      expect(weights.run).toBeGreaterThanOrEqual(0);
    }
    expect(locomotionWeights(0, WALK, RUN)).toEqual({ idle: 1, walk: 0, run: 0 });
    expect(locomotionWeights(Number.NaN, WALK, RUN)).toEqual({ idle: 1, walk: 0, run: 0 });
  });

  it('passa da camminata a corsa senza tornare indietro', () => {
    let previous = -1;
    for (let speed = 0; speed <= 8; speed += 0.1) {
      const weights = locomotionWeights(speed, WALK, RUN);
      expect(weights.run).toBeGreaterThanOrEqual(previous - 1e-9);
      previous = weights.run;
    }
    // a velocità di camminata la camminata domina, in corsa domina la corsa
    expect(locomotionWeights(WALK, WALK, RUN).walk).toBeGreaterThan(locomotionWeights(WALK, WALK, RUN).run);
    expect(locomotionWeights(RUN, WALK, RUN).run).toBeGreaterThan(0.9);
  });
});

describe('blend dei pesi', () => {
  it('raggiunge il bersaglio e ignora i dt non validi', () => {
    const target = locomotionWeights(RUN, WALK, RUN);
    let weights: LocomotionWeights = { idle: 1, walk: 0, run: 0 };
    for (let i = 0; i < 600; i++) weights = blendLocomotion(weights, target, 1 / 60);
    expect(weights.run).toBeCloseTo(target.run, 3);
    expect(sum(weights)).toBeCloseTo(1, 10);
    expect(blendLocomotion(weights, target, Number.NaN)).toEqual(weights);
    expect(blendLocomotion(weights, target, -1)).toEqual(weights);
  });

  it('è indipendente dal frame rate: 30 e 60 fps danno gli stessi pesi', () => {
    const target = locomotionWeights(4, WALK, RUN);
    const from: LocomotionWeights = { idle: 1, walk: 0, run: 0 };
    let at30 = from;
    for (let i = 0; i < 15; i++) at30 = blendLocomotion(at30, target, 1 / 30);
    let at60 = from;
    for (let i = 0; i < 30; i++) at60 = blendLocomotion(at60, target, 1 / 60);
    expect(at30.idle).toBeCloseTo(at60.idle, 6);
    expect(at30.walk).toBeCloseTo(at60.walk, 6);
    expect(at30.run).toBeCloseTo(at60.run, 6);
  });
});

describe('stato dominante e velocità delle clip', () => {
  it('sceglie il peso maggiore e a parità rispetta l’ordine idle → walk → run', () => {
    expect(dominantState({ idle: 0.6, walk: 0.3, run: 0.1 })).toBe('idle');
    expect(dominantState({ idle: 0.1, walk: 0.6, run: 0.3 })).toBe('walk');
    expect(dominantState({ idle: 0.1, walk: 0.3, run: 0.6 })).toBe('run');
    expect(dominantState({ idle: 0.5, walk: 0.5, run: 0 })).toBe('idle');
    expect(dominantState({ idle: 0, walk: 0.5, run: 0.5 })).toBe('walk');
  });

  it('limita la velocità di riproduzione di camminata e corsa', () => {
    expect(strideTimeScale('walk', 0, WALK, RUN)).toBeCloseTo(0.65, 8);
    expect(strideTimeScale('walk', WALK, WALK, RUN)).toBeCloseTo(1, 8);
    expect(strideTimeScale('walk', 100, WALK, RUN)).toBeCloseTo(1.6, 8);
    expect(strideTimeScale('run', 0, WALK, RUN)).toBeCloseTo(0.8, 8);
    expect(strideTimeScale('run', RUN, WALK, RUN)).toBeCloseTo(1, 8);
    expect(strideTimeScale('run', 100, WALK, RUN)).toBeCloseTo(1.3, 8);
  });
});

describe('fase di falcata', () => {
  it('porta la seconda clip sulla stessa frazione della prima', () => {
    expect(syncStridePhase(0.8, 1, 2)).toBeCloseTo(0.4, 6);
    expect(syncStridePhase(1, 0.5, 2)).toBeCloseTo(0.25, 6);
    expect(syncStridePhase(2, 5.5, 2)).toBeCloseTo(1.5, 6);
    expect(syncStridePhase(2, 4, 2)).toBeCloseTo(0, 6);
  });

  it('non tocca niente se durate o tempi non sono validi', () => {
    expect(syncStridePhase(0, 1, 2)).toBeNull();
    expect(syncStridePhase(1, 1, 0)).toBeNull();
    expect(syncStridePhase(1, Number.NaN, 2)).toBeNull();
  });
});

describe('adattamento al terreno', () => {
  it('misura salita e pendenza laterale sul piano noto', () => {
    const flatYaw = terrainTilt(plane, 10, 5, 0);
    // yaw 0 guarda verso -z: il piano scende davanti, quindi pitch negativo
    expect(flatYaw.pitch).toBeCloseTo(-Math.atan(0.1), 6);
    // verso sinistra (-x) il piano è più basso: il corpo pende a sinistra
    expect(flatYaw.roll).toBeCloseTo(Math.atan(0.2), 6);

    const turned = terrainTilt(plane, 10, 5, Math.PI / 2);
    expect(turned.pitch).toBeCloseTo(-Math.atan(0.2), 6);
    expect(turned.roll).toBeCloseTo(-Math.atan(0.1), 6);
  });

  it('limita l’inclinazione e azzera i campioni non validi', () => {
    const steep = terrainTilt((x) => 5 * x, 0, 0, Math.PI / 2);
    expect(steep.pitch).toBeCloseTo(-0.22, 8);
    expect(terrainTilt(() => Number.NaN, 0, 0, 0)).toEqual({ pitch: 0, roll: 0 });
    expect(terrainTilt(plane, 0, 0, Number.NaN)).toEqual({ pitch: 0, roll: 0 });
  });

  it('dà la quota dei due piedi, la media e il dislivello', () => {
    const feet = footHeights(plane, 10, 5, 0);
    expect(feet.left).toBeCloseTo(plane(9.84, 5), 6);
    expect(feet.right).toBeCloseTo(plane(10.16, 5), 6);
    expect(feet.average).toBeCloseTo(plane(10, 5), 6);
    expect(feet.spread).toBeCloseTo(0.064, 6);
    expect(footHeights(() => Number.NaN, 10, 5, 0)).toEqual({
      left: 0,
      right: 0,
      average: 0,
      spread: 0,
    });
  });
});

describe('transizioni e posa seduta', () => {
  it('avanza morbida e satura agli estremi', () => {
    expect(transitionProgress(0, 0.6)).toBe(0);
    expect(transitionProgress(0.3, 0.6)).toBeCloseTo(0.5, 8);
    expect(transitionProgress(0.6, 0.6)).toBe(1);
    expect(transitionProgress(2, 0.6)).toBe(1);
    expect(transitionProgress(0.2, 0)).toBe(1);
    expect(transitionProgress(Number.NaN, 0.6)).toBe(0);
  });

  it('piega il corpo in modo monotono e limitato', () => {
    expect(seatPose(0)).toEqual({ hip: 0, knee: 0, arm: 0, elbow: 0, torso: 0 });
    expect(seatPose(-2)).toEqual(seatPose(0));
    expect(seatPose(2)).toEqual(seatPose(1));
    expect(seatPose(Number.NaN)).toEqual(seatPose(0));
    let previous = seatPose(0);
    for (let p = 0.1; p <= 1.0001; p += 0.1) {
      const pose = seatPose(p);
      expect(pose.hip).toBeGreaterThanOrEqual(previous.hip - 1e-9);
      expect(pose.knee).toBeLessThanOrEqual(previous.knee + 1e-9);
      expect(pose.arm).toBeGreaterThanOrEqual(previous.arm - 1e-9);
      expect(pose.elbow).toBeLessThanOrEqual(previous.elbow + 1e-9);
      expect(pose.torso).toBeGreaterThanOrEqual(previous.torso - 1e-9);
      previous = pose;
    }
    expect(seatPose(1).hip).toBeCloseTo(1.1, 8);
    expect(seatPose(1).knee).toBeCloseTo(-1.4, 8);
    // le mani devono arrivare davanti al busto, non restare lungo i fianchi
    expect(seatPose(1).arm).toBeGreaterThan(0.2);
    expect(seatPose(1).elbow).toBeLessThan(-1.5);
  });
});

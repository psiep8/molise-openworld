import { describe, expect, it } from 'vitest';
import type { Heightfield } from '../src/geo/elevation';
import type { Road, TrafficSignalLocation } from '../src/geo/osm';
import {
  SIGNAL_CYCLE,
  SIGNAL_PHASE_OFFSET,
  buildTrafficLights,
  planTrafficSignals,
  signalStateAt,
} from '../src/world/traffic-signals';

function road(points: { x: number; z: number }[], width = 7): Road {
  return {
    type: 'secondary',
    name: '',
    width,
    paved: true,
    points,
    bounds: {
      minX: Math.min(...points.map((point) => point.x)),
      maxX: Math.max(...points.map((point) => point.x)),
      minZ: Math.min(...points.map((point) => point.z)),
      maxZ: Math.max(...points.map((point) => point.z)),
    },
  };
}

const flat = {
  heightAt: () => 120,
  slopeAt: () => 0,
} as unknown as Pick<Heightfield, 'heightAt' | 'slopeAt'>;

function crossingRoads(): Road[] {
  return [
    road([
      { x: -60, z: 0 },
      { x: 60, z: 0 },
    ]),
    road([
      { x: 0, z: -60 },
      { x: 0, z: 60 },
    ]),
  ];
}

describe('semafori mappati', () => {
  it('cicla verde, giallo e rosso in modo deterministico', () => {
    expect(signalStateAt(0)).toBe('green');
    expect(signalStateAt(SIGNAL_CYCLE.green - 0.01)).toBe('green');
    expect(signalStateAt(SIGNAL_CYCLE.green + 0.01)).toBe('amber');
    expect(signalStateAt(SIGNAL_CYCLE.green + SIGNAL_CYCLE.amber - 0.01)).toBe('amber');
    expect(signalStateAt(SIGNAL_CYCLE.green + SIGNAL_CYCLE.amber)).toBe('red');
    expect(signalStateAt(SIGNAL_CYCLE.cycle - 0.01)).toBe('red');
    expect(signalStateAt(SIGNAL_CYCLE.cycle)).toBe('green');
    expect(signalStateAt(-0.01)).toBe('red');
  });

  it('sfasa la seconda fase di mezzo ciclo', () => {
    expect(SIGNAL_PHASE_OFFSET).toBe(SIGNAL_CYCLE.green + SIGNAL_CYCLE.amber);
    expect(signalStateAt(0, SIGNAL_PHASE_OFFSET)).toBe('red');
    expect(signalStateAt(SIGNAL_PHASE_OFFSET, SIGNAL_PHASE_OFFSET)).toBe('green');
    expect(signalStateAt(SIGNAL_PHASE_OFFSET + SIGNAL_CYCLE.green + 1, SIGNAL_PHASE_OFFSET)).toBe(
      'amber',
    );
  });

  it('porta i pali sul ciglio e separa i due assi dell’incrocio', () => {
    // nodi sulla linea di arresto, appena fuori dall'area dell'incrocio
    const signals: TrafficSignalLocation[] = [
      { x: 0, z: -8 },
      { x: 0, z: 8 },
      { x: 8, z: 0 },
    ];
    const plans = planTrafficSignals(signals, crossingRoads());
    expect(plans).toHaveLength(3);
    // i due semafori nord-sud condividono l'asse, quello est-ovest è l'altro
    expect(plans.filter((plan) => plan.phase === 0)).toHaveLength(2);
    expect(plans.filter((plan) => plan.phase === 1)).toHaveLength(1);
    expect(new Set(plans.map((plan) => plan.cluster)).size).toBe(1);
    for (const plan of plans) {
      // il palo non nasce sulla mezzeria: almeno 3,5 m dal centro strada
      expect(Math.min(Math.abs(plan.x), Math.abs(plan.z))).toBeGreaterThan(3.5);
    }
  });

  it('tiene il verso dichiarato da `traffic_signals:direction`', () => {
    const [forward] = planTrafficSignals(
      [{ x: 10, z: 0, direction: 'forward' }],
      crossingRoads(),
    );
    const [backward] = planTrafficSignals(
      [{ x: 10, z: 0, direction: 'backward' }],
      crossingRoads(),
    );
    expect(forward).toBeDefined();
    expect(backward).toBeDefined();
    expect(Math.abs(forward!.yaw - backward!.yaw)).toBeCloseTo(Math.PI, 6);
  });

  it('scarta i nodi lontani dalla carreggiata e i duplicati', () => {
    const roads = crossingRoads();
    expect(planTrafficSignals([{ x: 200, z: 200 }], roads)).toHaveLength(0);
    // due nodi quasi coincidenti: un solo palo
    expect(
      planTrafficSignals(
        [
          { x: 0, z: 3 },
          { x: 0.1, z: 3.05 },
        ],
        roads,
      ),
    ).toHaveLength(1);
  });

  it('costruisce pali e teste con lanterne che si accendono', () => {
    const system = buildTrafficLights({
      signals: [
        { x: 0, z: 3 },
        { x: 3, z: 0 },
      ],
      roads: crossingRoads(),
      heights: flat,
    });
    expect(system).not.toBeNull();
    expect(system!.spots).toHaveLength(2);
    expect(system!.group.name).toBe('traffic-lights');

    const statesAt = (seconds: number): Map<number, Set<string>> => {
      system!.update(seconds);
      const byPhase = new Map<number, Set<string>>();
      system!.group.traverse((object) => {
        const mesh = object as import('three').Mesh;
        const material = mesh.material as import('three').MeshStandardMaterial | undefined;
        if (!material || typeof material.userData.signalLamp !== 'string') return;
        const phase = mesh.userData.signalPhase as number;
        const states = byPhase.get(phase) ?? new Set<string>();
        states.add(String(material.userData.state));
        byPhase.set(phase, states);
      });
      return byPhase;
    };

    const seen = new Set<string>();
    for (let second = 0; second < SIGNAL_CYCLE.cycle * 2; second += 1) {
      const byPhase = statesAt(second);
      expect(byPhase.size).toBe(2);
      const phase0 = byPhase.get(0)!;
      const phase1 = byPhase.get(1)!;
      expect(phase0.size).toBe(1);
      expect(phase1.size).toBe(1);
      const state0 = [...phase0][0]!;
      const state1 = [...phase1][0]!;
      seen.add(state0);
      seen.add(state1);
      // le due fasi non sono mai verdi insieme
      expect(state0 === 'green' && state1 === 'green').toBe(false);
    }
    expect(seen.has('green')).toBe(true);
    expect(seen.has('red')).toBe(true);
    expect(seen.has('amber')).toBe(true);
  });
});

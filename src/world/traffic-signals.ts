import * as THREE from 'three';
import type { Heightfield } from '../geo/elevation';
import { hashInt, type Pt } from '../geo/geo';
import type { BuildingIndex, Road, TrafficSignalLocation } from '../geo/osm';

/**
 * Semafori mappati in OSM.
 *
 * EarthNG li usa per far fermare il traffico agli incroci; qui si porta la
 * parte visibile e temporale, senza l'AI: ogni `highway=traffic_signals`
 * diventa un palo sul ciglio, con la testa rivolta verso il traffico in
 * arrivo. I semafori vicini formano un incrocio, e gli assi stradali opposti
 * (nord-sud contro est-ovest) si alternano verde/giallo/rosso.
 *
 * Il ciclo è deterministico: il colore non dipende dal frame ma dal tempo
 * trascorso, quindi tutti i semafori dello stesso incrocio restano
 * sincronizzati. I materiali delle lanterne sono pochi e riusati per fase:
 * accendere un materiale per semaforo costerebbe un cambio di stato per
 * ciascuno a ogni transizione.
 */
export type SignalState = 'green' | 'amber' | 'red';

export const SIGNAL_CYCLE = {
  /** durata di un ciclo completo, in secondi */
  cycle: 26,
  /** verde pieno */
  green: 10,
  /** giallo */
  amber: 3,
} as const;

/** Sfasamento della seconda fase: quando una è verde, l'altra è rossa. */
export const SIGNAL_PHASE_OFFSET = SIGNAL_CYCLE.green + SIGNAL_CYCLE.amber;

export function signalStateAt(seconds: number, offset = 0): SignalState {
  const cycle = SIGNAL_CYCLE.cycle;
  let phase = (seconds + offset) % cycle;
  if (phase < 0) phase += cycle;
  if (phase < SIGNAL_CYCLE.green) return 'green';
  if (phase < SIGNAL_CYCLE.green + SIGNAL_CYCLE.amber) return 'amber';
  return 'red';
}

export interface TrafficSignalPlan {
  x: number;
  z: number;
  /** rotazione della testa: le lanterne guardano il traffico in arrivo */
  yaw: number;
  /** incrocio di appartenenza (semafori entro `clusterDistance`) */
  cluster: number;
  /** 0 e 1 sono i due assi che si alternano */
  phase: 0 | 1;
}

export interface TrafficSignalPlanOptions {
  /** distanza massima dal ciglio di una strada asfaltata */
  maxDistance?: number;
  /** distanza del palo oltre il bordo della carreggiata */
  sideOffset?: number;
  /** semafori più vicini di così appartengono allo stesso incrocio */
  clusterDistance?: number;
}

interface RoadHit {
  x: number;
  z: number;
  nx: number;
  nz: number;
  tx: number;
  tz: number;
  halfWidth: number;
  distance: number;
}

/** Proiezione del nodo OSM sulla carreggiata asfaltata più vicina. */
function projectToRoad(x: number, z: number, roads: readonly Road[]): RoadHit | null {
  let best: RoadHit | null = null;
  for (const road of roads) {
    if (!road.paved || road.width < 3) continue;
    for (let i = 1; i < road.points.length; i++) {
      const a = road.points[i - 1]!;
      const b = road.points[i]!;
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const length2 = dx * dx + dz * dz;
      if (length2 < 1e-6) continue;
      const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / length2));
      const px = a.x + dx * t;
      const pz = a.z + dz * t;
      const distance = Math.hypot(x - px, z - pz);
      if (best && distance >= best.distance) continue;
      const length = Math.sqrt(length2);
      best = {
        x: px,
        z: pz,
        nx: -dz / length,
        nz: dx / length,
        tx: dx / length,
        tz: dz / length,
        halfWidth: road.width / 2,
        distance,
      };
    }
  }
  return best;
}

function approachDirection(
  signal: TrafficSignalLocation,
  hit: RoadHit,
  side: 1 | -1,
): Pt {
  const forward = { x: hit.tx, z: hit.tz };
  switch (signal.direction) {
    case 'forward':
      return forward;
    case 'backward':
      return { x: -forward.x, z: -forward.z };
    case 'both':
      return forward;
    default:
      // Il semaforo sta sul lato destro del verso di marcia: se il nodo è a
      // sinistra della tangente, il traffico arriva nel verso opposto.
      return side === 1 ? forward : { x: -forward.x, z: -forward.z };
  }
}

interface PlacedSignal {
  x: number;
  z: number;
  heading: number;
  yaw: number;
}

/**
 * Dispone i semafori sul ciglio e assegna loro un incrocio e una fase.
 *
 * Il nodo OSM di un `highway=traffic_signals` sta dov'è la linea di arresto,
 * spesso in mezzeria: il palo va spostato oltre il bordo, altrimenti nasce in
 * mezzo alla carreggiata. Come per i cartelli, se il nodo è già oltre il
 * ciglio non lo si muove.
 */
export function planTrafficSignals(
  signals: readonly TrafficSignalLocation[],
  roads: readonly Road[],
  options: TrafficSignalPlanOptions = {},
): TrafficSignalPlan[] {
  const maxDistance = options.maxDistance ?? 15;
  const sideOffset = options.sideOffset ?? 0.85;
  const clusterDistance = options.clusterDistance ?? 45;
  const placed: PlacedSignal[] = [];
  /** nodi OSM già accettati: due mappature quasi coincidenti sono lo stesso palo */
  const accepted: Pt[] = [];

  for (const signal of signals) {
    const hit = projectToRoad(signal.x, signal.z, roads);
    if (!hit || hit.distance > maxDistance) continue;
    // Il confronto è sulla posizione **mappata**: due nodi quasi coincidenti
    // possono finire ai due lati opposti della carreggiata e sembrare due pali.
    if (accepted.some((other) => Math.hypot(other.x - signal.x, other.z - signal.z) < 0.8)) {
      continue;
    }
    const lateral = (signal.x - hit.x) * hit.nx + (signal.z - hit.z) * hit.nz;
    const side: 1 | -1 = lateral >= 0 ? 1 : -1;
    const offset = hit.halfWidth + sideOffset;
    const x =
      Math.abs(lateral) >= offset ? signal.x : hit.x + hit.nx * side * offset;
    const z =
      Math.abs(lateral) >= offset ? signal.z : hit.z + hit.nz * side * offset;
    if (placed.some((other) => Math.hypot(other.x - x, other.z - z) < 1.1)) continue;

    accepted.push({ x: signal.x, z: signal.z });
    const approach = approachDirection(signal, hit, side);
    placed.push({
      x,
      z,
      heading: Math.atan2(approach.x, approach.z),
      yaw: Math.atan2(-approach.x, -approach.z),
    });
  }
  if (placed.length === 0) return [];

  // unione per prossimità: i semafori di un incrocio sono a pochi metri
  const parent = placed.map((_, index) => index);
  const find = (index: number): number => {
    while (parent[index] !== index) {
      parent[index] = parent[parent[index]!]!;
      index = parent[index]!;
    }
    return index;
  };
  for (let i = 0; i < placed.length; i++) {
    for (let j = i + 1; j < placed.length; j++) {
      if (Math.hypot(placed[i]!.x - placed[j]!.x, placed[i]!.z - placed[j]!.z) > clusterDistance) {
        continue;
      }
      const a = find(i);
      const b = find(j);
      if (a !== b) parent[b] = a;
    }
  }

  // indici di cluster compatti, nell'ordine in cui compaiono
  const clusterIds = new Map<number, number>();
  const clusters = placed.map((_, index) => {
    const root = find(index);
    let id = clusterIds.get(root);
    if (id === undefined) {
      id = clusterIds.size;
      clusterIds.set(root, id);
    }
    return id;
  });

  return placed.map((signal, index) => {
    const cluster = clusters[index]!;
    // I due assi di un incrocio sono perpendicolari. Piegando l'angolo di
    // approccio in [0, π) — i due versi della stessa strada coincidono — l'asse
    // con angolo < π/2 è sempre la fase 0 e quello perpendicolare la fase 1,
    // senza dipendere dall'ordine dei nodi nel tile.
    const axis = ((signal.heading % Math.PI) + Math.PI) % Math.PI;
    const phase: 0 | 1 = axis < Math.PI / 2 ? 0 : 1;
    return { x: signal.x, z: signal.z, yaw: signal.yaw, cluster, phase };
  });
}

interface LampMaterials {
  red: THREE.MeshStandardMaterial;
  amber: THREE.MeshStandardMaterial;
  green: THREE.MeshStandardMaterial;
}

export interface TrafficLightSystem {
  group: THREE.Group;
  /** piedi dei pali, da registrare come ostacoli */
  spots: { x: number; z: number }[];
  update(elapsed: number): void;
  dispose(): void;
}

export interface TrafficLightBuildOptions {
  signals: readonly TrafficSignalLocation[];
  roads: readonly Road[];
  heights: Pick<Heightfield, 'heightAt' | 'slopeAt'>;
  buildings?: Pick<BuildingIndex, 'hitsCircle'>;
  maxSlope?: number;
  plan?: TrafficSignalPlanOptions;
}

const LAMP_COLORS: Record<keyof LampMaterials, { base: number; light: number }> = {
  red: { base: 0x390604, light: 0xff2a18 },
  amber: { base: 0x3a2503, light: 0xffa41a },
  green: { base: 0x043a17, light: 0x19ff70 },
};

function lampMaterial(kind: keyof LampMaterials): THREE.MeshStandardMaterial {
  const colors = LAMP_COLORS[kind];
  const material = new THREE.MeshStandardMaterial({
    color: colors.base,
    emissive: colors.light,
    emissiveIntensity: 0,
    roughness: 0.35,
    metalness: 0,
  });
  material.userData.signalLamp = kind;
  return material;
}

function setLampState(materials: LampMaterials, state: SignalState): void {
  const active = 2.6;
  materials.red.emissiveIntensity = state === 'red' ? active : 0;
  materials.amber.emissiveIntensity = state === 'amber' ? active : 0;
  materials.green.emissiveIntensity = state === 'green' ? active : 0;
  materials.red.userData.state = state;
  materials.amber.userData.state = state;
  materials.green.userData.state = state;
}

function clusterOffset(x: number, z: number): number {
  const seed = hashInt(Math.round(x * 10) ^ Math.round(z * 10), 0x51a7);
  return ((seed % 1000) / 1000) * SIGNAL_CYCLE.cycle;
}

/**
 * Costruisce il gruppo dei semafori. Ogni testa ha tre lanterne emissive;
 * `update` le accende in base al tempo trascorso, non al frame.
 */
export function buildTrafficLights(
  options: TrafficLightBuildOptions,
): TrafficLightSystem | null {
  const plans = planTrafficSignals(options.signals, options.roads, options.plan);
  if (plans.length === 0) return null;

  const maxSlope = options.maxSlope ?? 14;
  const group = new THREE.Group();
  group.name = 'traffic-lights';
  const spots: { x: number; z: number }[] = [];

  const poleGeometry = new THREE.CylinderGeometry(0.055, 0.075, 3.1, 8);
  poleGeometry.translate(0, 1.55, 0);
  const headGeometry = new THREE.BoxGeometry(0.42, 1.05, 0.24);
  const lensGeometry = new THREE.CircleGeometry(0.105, 14);
  const poleMaterial = new THREE.MeshStandardMaterial({
    color: 0x7f878b,
    roughness: 0.5,
    metalness: 0.55,
  });
  const headMaterial = new THREE.MeshStandardMaterial({
    color: 0x22272a,
    roughness: 0.55,
    metalness: 0.25,
  });

  const clusterMaterials = new Map<number, [LampMaterials, LampMaterials]>();
  const clusterOffsets = new Map<number, number>();
  const lastStates = new Map<number, [SignalState, SignalState]>();

  for (const plan of plans) {
    if (options.heights.slopeAt(plan.x, plan.z) > maxSlope) continue;
    if (options.buildings?.hitsCircle(plan.x, plan.z, 0.35)) continue;

    let materials = clusterMaterials.get(plan.cluster);
    if (!materials) {
      const a: LampMaterials = {
        red: lampMaterial('red'),
        amber: lampMaterial('amber'),
        green: lampMaterial('green'),
      };
      const b: LampMaterials = {
        red: lampMaterial('red'),
        amber: lampMaterial('amber'),
        green: lampMaterial('green'),
      };
      materials = [a, b];
      clusterMaterials.set(plan.cluster, materials);
      const first = plans.find((entry) => entry.cluster === plan.cluster)!;
      clusterOffsets.set(plan.cluster, clusterOffset(first.x, first.z));
      lastStates.set(plan.cluster, ['green', 'red']);
      setLampState(a, 'green');
      setLampState(b, 'red');
    }

    const y = options.heights.heightAt(plan.x, plan.z) + 0.02;
    const pole = new THREE.Mesh(poleGeometry, poleMaterial);
    pole.position.set(plan.x, y, plan.z);
    pole.castShadow = false;
    group.add(pole);

    const head = new THREE.Group();
    head.position.set(plan.x, y + 3.25, plan.z);
    head.rotation.y = plan.yaw;
    const body = new THREE.Mesh(headGeometry, headMaterial);
    body.castShadow = false;
    head.add(body);

    const lamps = materials[plan.phase];
    const kinds: (keyof LampMaterials)[] = ['red', 'amber', 'green'];
    for (let index = 0; index < kinds.length; index++) {
      const lamp = new THREE.Mesh(lensGeometry, lamps[kinds[index]!]);
      lamp.position.set(0, 0.31 - index * 0.31, 0.125);
      lamp.userData.signalPhase = plan.phase;
      head.add(lamp);
    }
    group.add(head);
    spots.push({ x: plan.x, z: plan.z });
  }

  if (spots.length === 0) {
    poleGeometry.dispose();
    headGeometry.dispose();
    lensGeometry.dispose();
    poleMaterial.dispose();
    headMaterial.dispose();
    for (const pair of clusterMaterials.values()) {
      for (const materials of pair) {
        materials.red.dispose();
        materials.amber.dispose();
        materials.green.dispose();
      }
    }
    return null;
  }

  return {
    group,
    spots,
    update(elapsed: number): void {
      for (const [cluster, materials] of clusterMaterials) {
        const offset = clusterOffsets.get(cluster) ?? 0;
        const state0 = signalStateAt(elapsed, offset);
        const state1 = signalStateAt(elapsed, offset + SIGNAL_PHASE_OFFSET);
        const last = lastStates.get(cluster);
        if (last && last[0] === state0 && last[1] === state1) continue;
        setLampState(materials[0], state0);
        setLampState(materials[1], state1);
        lastStates.set(cluster, [state0, state1]);
      }
    },
    dispose(): void {
      poleGeometry.dispose();
      headGeometry.dispose();
      lensGeometry.dispose();
      poleMaterial.dispose();
      headMaterial.dispose();
      for (const pair of clusterMaterials.values()) {
        for (const materials of pair) {
          materials.red.dispose();
          materials.amber.dispose();
          materials.green.dispose();
        }
      }
    },
  };
}

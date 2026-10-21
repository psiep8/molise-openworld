/**
 * Pianificazione di itinerari sulla rete stradale OSM, pura e deterministica.
 *
 * Il grafo è costruito una volta dalle polilinee delle strade: i vertici che
 * cadono nella stessa cella (≈4 m) sono lo stesso nodo, così le way che si
 * toccano in un incrocio risultano connesse anche se i dati arrivano da
 * relazioni diverse. I costi degli archi sono le distanze reali, moltiplicate
 * per una penalità che tiene fuori le scorciatoie pedonali quando si guida.
 *
 * Nessuna dipendenza da Three.js o dal DOM: si testa con vitest.
 */
import type { Pt } from '../geo/geo';
import type { Road } from '../geo/osm';

export interface RoadGraph {
  /** coordinate dei nodi (metri, sistema del mondo) */
  readonly xs: Float64Array;
  readonly zs: Float64Array;
  /** CSR: gli archi del nodo i stanno in [offsets[i], offsets[i + 1]) */
  readonly offsets: Int32Array;
  readonly targets: Int32Array;
  readonly costs: Float64Array;
}

export interface RouteResult {
  /** polilinea completa: posizione di partenza, nodi della strada, arrivo */
  points: Pt[];
  /** lunghezza geometrica in metri (senza penalità) */
  distance: number;
  /** distanza dalla partenza alla strada più vicina */
  approach: number;
}

/** Penalità per tipo di strada: un tratturo non è una statale. */
const TYPE_FACTOR: Record<string, number> = {
  motorway: 0.95,
  trunk: 0.95,
  primary: 1,
  secondary: 1,
  tertiary: 1.02,
  unclassified: 1.05,
  residential: 1.08,
  living_street: 1.2,
  service: 1.15,
  road: 1.05,
  pedestrian: 1.3,
  cycleway: 1.9,
  track: 1.45,
  bridleway: 2.4,
  path: 2.4,
  footway: 2.4,
  steps: 3,
};

function roadFactor(road: Road): number {
  const byType = TYPE_FACTOR[road.type];
  if (byType !== undefined) return byType;
  return road.paved ? 1.1 : 1.3;
}

/** Costruisce il grafo stradale. `snap` è la tolleranza di fusione dei nodi (m). */
export function buildRoadGraph(roads: Road[], snap = 4): RoadGraph {
  const cellSize = Math.max(0.5, snap);
  const lookup = new Map<string, number>();
  const xs: number[] = [];
  const zs: number[] = [];

  const nodeFor = (x: number, z: number): number => {
    const key = `${Math.round(x / cellSize)}:${Math.round(z / cellSize)}`;
    const found = lookup.get(key);
    if (found !== undefined) return found;
    const id = xs.length;
    xs.push(x);
    zs.push(z);
    lookup.set(key, id);
    return id;
  };

  const from: number[] = [];
  const to: number[] = [];
  const cost: number[] = [];

  for (const road of roads) {
    if (road.points.length < 2) continue;
    const factor = roadFactor(road);
    for (let i = 1; i < road.points.length; i++) {
      const a = road.points[i - 1];
      const b = road.points[i];
      const len = Math.hypot(b.x - a.x, b.z - a.z);
      if (len < 0.05) continue;
      const na = nodeFor(a.x, a.z);
      const nb = nodeFor(b.x, b.z);
      if (na === nb) continue;
      from.push(na, nb);
      to.push(nb, na);
      cost.push(len * factor, len * factor);
    }
  }

  const nodeCount = xs.length;
  const degree = new Int32Array(nodeCount);
  for (const id of from) degree[id]++;
  const offsets = new Int32Array(nodeCount + 1);
  for (let i = 0; i < nodeCount; i++) offsets[i + 1] = offsets[i] + degree[i];

  const targets = new Int32Array(from.length);
  const costs = new Float64Array(from.length);
  const cursor = offsets.slice(0, nodeCount);
  for (let e = 0; e < from.length; e++) {
    const slot = cursor[from[e]]++;
    targets[slot] = to[e];
    costs[slot] = cost[e];
  }

  return {
    xs: Float64Array.from(xs),
    zs: Float64Array.from(zs),
    offsets,
    targets,
    costs,
  };
}

/** Nodo più vicino a un punto, con la sua distanza. */
export function nearestNode(graph: RoadGraph, x: number, z: number): { node: number; distance: number } | null {
  let best = -1;
  let bestD = Infinity;
  for (let i = 0; i < graph.xs.length; i++) {
    const dx = graph.xs[i] - x;
    const dz = graph.zs[i] - z;
    const d = dx * dx + dz * dz;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  if (best < 0) return null;
  return { node: best, distance: Math.sqrt(bestD) };
}

/** Min-heap indicizzato per nodo: A* senza allocazioni per frame. */
class MinHeap {
  private readonly nodes: number[] = [];
  private readonly keys: number[] = [];

  get size(): number {
    return this.nodes.length;
  }

  push(node: number, key: number): void {
    this.nodes.push(node);
    this.keys.push(key);
    let i = this.nodes.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.keys[parent] <= this.keys[i]) break;
      this.swap(i, parent);
      i = parent;
    }
  }

  pop(): number {
    const top = this.nodes[0];
    const lastNode = this.nodes.pop() as number;
    const lastKey = this.keys.pop() as number;
    if (this.nodes.length > 0) {
      this.nodes[0] = lastNode;
      this.keys[0] = lastKey;
      let i = 0;
      for (;;) {
        const left = i * 2 + 1;
        const right = left + 1;
        let smallest = i;
        if (left < this.nodes.length && this.keys[left] < this.keys[smallest]) smallest = left;
        if (right < this.nodes.length && this.keys[right] < this.keys[smallest]) smallest = right;
        if (smallest === i) break;
        this.swap(i, smallest);
        i = smallest;
      }
    }
    return top;
  }

  private swap(a: number, b: number): void {
    const n = this.nodes[a];
    this.nodes[a] = this.nodes[b];
    this.nodes[b] = n;
    const k = this.keys[a];
    this.keys[a] = this.keys[b];
    this.keys[b] = k;
  }
}

/**
 * Itinerario più breve da `from` a `to` sulla rete stradale (A*).
 * Restituisce null se i due punti non sono collegati o se non ci sono strade.
 */
export function planRoute(graph: RoadGraph, from: Pt, to: Pt): RouteResult | null {
  if (graph.xs.length === 0) return null;
  const start = nearestNode(graph, from.x, from.z);
  const goal = nearestNode(graph, to.x, to.z);
  if (!start || !goal) return null;

  const n = graph.xs.length;
  const gScore = new Float64Array(n).fill(Infinity);
  const cameFrom = new Int32Array(n).fill(-1);
  const closed = new Uint8Array(n);
  const heap = new MinHeap();
  const gx = graph.xs[goal.node];
  const gz = graph.zs[goal.node];

  // 0.9 = fattore minimo fra le strade: l'euristica resta ammissibile
  const heuristic = (node: number): number =>
    Math.hypot(graph.xs[node] - gx, graph.zs[node] - gz) * 0.9;

  gScore[start.node] = 0;
  heap.push(start.node, heuristic(start.node));

  while (heap.size > 0) {
    const current = heap.pop();
    if (closed[current]) continue;
    if (current === goal.node) break;
    closed[current] = 1;

    const end = graph.offsets[current + 1];
    for (let e = graph.offsets[current]; e < end; e++) {
      const next = graph.targets[e];
      if (closed[next]) continue;
      const tentative = gScore[current] + graph.costs[e];
      if (tentative < gScore[next]) {
        gScore[next] = tentative;
        cameFrom[next] = current;
        heap.push(next, tentative + heuristic(next));
      }
    }
  }

  if (cameFrom[goal.node] === -1 && goal.node !== start.node) return null;

  const nodes: number[] = [];
  let cursor = goal.node;
  while (cursor !== -1) {
    nodes.push(cursor);
    if (cursor === start.node) break;
    cursor = cameFrom[cursor];
  }
  if (nodes[nodes.length - 1] !== start.node) return null;
  nodes.reverse();

  const points: Pt[] = [{ x: from.x, z: from.z }];
  for (const id of nodes) points.push({ x: graph.xs[id], z: graph.zs[id] });
  points.push({ x: to.x, z: to.z });

  let distance = 0;
  for (let i = 1; i < points.length; i++) {
    distance += Math.hypot(points[i].x - points[i - 1].x, points[i].z - points[i - 1].z);
  }

  return { points, distance, approach: start.distance };
}

/** Lunghezza della polilinea in metri. */
export function polylineLength(points: Pt[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += Math.hypot(points[i].x - points[i - 1].x, points[i].z - points[i - 1].z);
  }
  return total;
}

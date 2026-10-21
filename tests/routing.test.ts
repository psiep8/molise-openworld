import { describe, expect, it } from 'vitest';
import { boundsOf } from '../src/geo/geo';
import type { Road } from '../src/geo/osm';
import { buildRoadGraph, nearestNode, planRoute, polylineLength } from '../src/sim/routing';

function road(type: string, coords: [number, number][], paved = true): Road {
  const points = coords.map(([x, z]) => ({ x, z }));
  return {
    type,
    name: '',
    width: 5,
    paved,
    points,
    bounds: boundsOf(points),
  };
}

describe('grafo stradale', () => {
  it('fonde i nodi che cadono nella stessa cella', () => {
    const graph = buildRoadGraph([road('residential', [[0, 0], [0, 50]]), road('residential', [[0.4, 0.3], [50, 50]])]);
    expect(graph.xs.length).toBe(3);
  });

  it('nearestNode trova il vertice più vicino', () => {
    const graph = buildRoadGraph([road('residential', [[0, 0], [0, 100]])]);
    const near = nearestNode(graph, 3, 98);
    expect(near?.node).toBe(1);
    expect(near?.distance).toBeCloseTo(Math.hypot(3, 2), 6);
  });
});

describe('planRoute', () => {
  it('segue una strada dritta e misura partenza e arrivo', () => {
    const graph = buildRoadGraph([road('residential', [[0, 0], [0, 100], [0, 200]])]);
    const route = planRoute(graph, { x: 0, z: -5 }, { x: 0, z: 205 });
    expect(route).not.toBeNull();
    expect(route!.distance).toBeCloseTo(210, 6);
    expect(route!.points[0]).toEqual({ x: 0, z: -5 });
    expect(route!.points[route!.points.length - 1]).toEqual({ x: 0, z: 205 });
    expect(polylineLength(route!.points)).toBeCloseTo(route!.distance, 6);
  });

  it('sceglie il ramo più corto quando la rete si divide', () => {
    const graph = buildRoadGraph([
      road('residential', [[0, 0], [0, 100], [0, 200]]),
      road('residential', [[0, 0], [200, 100], [0, 200]]),
    ]);
    const route = planRoute(graph, { x: 0, z: 0 }, { x: 0, z: 200 });
    expect(route!.distance).toBeCloseTo(200, 6);
  });

  it('preferisce l’asfalto al sentiero anche se il sentiero è più corto', () => {
    const graph = buildRoadGraph([
      road('path', [[0, 0], [0, 100]], false),
      road('residential', [[0, 0], [80, 50], [0, 100]]),
    ]);
    const route = planRoute(graph, { x: 0, z: 0 }, { x: 0, z: 100 });
    // 2 * hypot(80, 50) ≈ 188.7 m di asfalto contro 100 m di sentiero (× 2.4)
    expect(route!.distance).toBeCloseTo(2 * Math.hypot(80, 50), 4);
  });

  it('restituisce null se le due reti non sono collegate', () => {
    const graph = buildRoadGraph([
      road('residential', [[0, 0], [0, 100]]),
      road('residential', [[5000, 5000], [5000, 5100]]),
    ]);
    expect(planRoute(graph, { x: 0, z: 0 }, { x: 5000, z: 5100 })).toBeNull();
  });

  it('collega due way che condividono l’incrocio con coordinate arrotondate', () => {
    const graph = buildRoadGraph([
      road('residential', [[0, 0], [0, 100]]),
      road('residential', [[0.6, 100.4], [100, 100]]),
    ]);
    const route = planRoute(graph, { x: 0, z: 0 }, { x: 100, z: 100 });
    expect(route).not.toBeNull();
    expect(route!.distance).toBeCloseTo(200, 3);
  });

  it('un grafo vuoto non produce itinerari', () => {
    const graph = buildRoadGraph([]);
    expect(planRoute(graph, { x: 0, z: 0 }, { x: 1, z: 1 })).toBeNull();
  });
});

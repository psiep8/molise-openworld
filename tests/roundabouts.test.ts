import { describe, expect, it } from 'vitest';
import type { Pt } from '../src/geo/geo';
import type { Road } from '../src/geo/osm';
import {
  ROUNDABOUT,
  buildRoundaboutAprons,
  detectRoundabouts,
  type RoundaboutSurface,
} from '../src/world/roundabouts';

function road(points: Pt[], options: Partial<Road> = {}): Road {
  const xs = points.map((point) => point.x);
  const zs = points.map((point) => point.z);
  return {
    type: 'secondary',
    name: 'Rotatoria',
    width: 7,
    paved: true,
    points,
    bounds: {
      minX: Math.min(...xs),
      maxX: Math.max(...xs),
      minZ: Math.min(...zs),
      maxZ: Math.max(...zs),
    },
    ...options,
  };
}

function circle(radius: number, segments = 32, closed = true): Pt[] {
  const points: Pt[] = [];
  for (let i = 0; i < segments + (closed ? 1 : 0); i++) {
    const angle = (i / segments) * Math.PI * 2;
    points.push({ x: Math.cos(angle) * radius, z: Math.sin(angle) * radius });
  }
  return points;
}

function square(radius: number, segments = 4): Pt[] {
  const points: Pt[] = [
    { x: -radius, z: -radius },
    { x: radius, z: -radius },
    { x: radius, z: radius },
    { x: -radius, z: radius },
  ];
  for (let i = 0; i < segments; i++) {
    // punti intermedi sui lati, per superare il minimo di vertici
    const t = i / segments;
    points.push({ x: -radius + 2 * radius * t, z: -radius });
  }
  points.push(points[0]!);
  return points;
}

const flat: RoundaboutSurface = {
  heightAt: () => 500,
  normalAt: () => ({ x: 0, y: 1, z: 0 }),
};

describe('rotatorie da OSM', () => {
  it('riconosce un anello chiuso quasi circolare', () => {
    const rings = detectRoundabouts([road(circle(12))]);
    expect(rings).toHaveLength(1);
    const ring = rings[0]!;
    expect(ring.meanRadius).toBeCloseTo(12, 0);
    expect(ring.outerRadius).toBeCloseTo(12 - 7 / 2, 3);
    expect(ring.apronWidth).toBeCloseTo(2, 6);
    expect(ring.innerRadius).toBeCloseTo(ring.outerRadius - ring.apronWidth, 6);
    expect(ring.segments).toBeGreaterThanOrEqual(24);
  });

  it('scarta una way aperta, un ponte, una pista e un anello troppo largo', () => {
    expect(detectRoundabouts([road(circle(12, 32, false))])).toHaveLength(0);
    expect(detectRoundabouts([road(circle(12), { bridge: true })])).toHaveLength(0);
    expect(detectRoundabouts([road(circle(12), { type: 'footway' })])).toHaveLength(0);
    expect(detectRoundabouts([road(circle(12), { paved: false })])).toHaveLength(0);
    expect(detectRoundabouts([road(circle(12), { width: 14 })])).toHaveLength(0);
    expect(detectRoundabouts([road(circle(45))])).toHaveLength(0);
    expect(detectRoundabouts([road(circle(3, 16))])).toHaveLength(0);
  });

  it('scarta un piazzale quadrato: non è una rotatoria', () => {
    expect(detectRoundabouts([road(square(12))])).toHaveLength(0);
  });

  it('riconosce una rotatoria spezzata in più way aperte', () => {
    const radius = 12;
    const arcs: Pt[][] = [];
    // quattro archi da 90°, ognuno una way aperta: è così che OSM spezza
    // una rotatoria a ogni innesto
    for (let arc = 0; arc < 4; arc++) {
      const points: Pt[] = [];
      for (let i = 0; i <= 8; i++) {
        const angle = (arc * Math.PI) / 2 + (i / 8) * (Math.PI / 2) * 1;
        points.push({ x: Math.cos(angle) * radius, z: Math.sin(angle) * radius });
      }
      arcs.push(points);
    }
    const ways = arcs.map((points) => road(points));
    // due approcci radiali sullo stesso nodo: non devono entrare nell'anello
    ways.push(
      road([
        { x: radius, z: 0 },
        { x: radius + 14, z: 0 },
      ]),
      road([
        { x: -radius, z: 0 },
        { x: -radius - 14, z: 0 },
      ]),
    );
    const rings = detectRoundabouts(ways);
    expect(rings).toHaveLength(1);
    expect(rings[0]!.meanRadius).toBeCloseTo(radius, 1);
    expect(rings[0]!.innerRadius).toBeGreaterThan(0);
  });

  it('non scambia un isolato urbano per una rotatoria', () => {
    const size = 24;
    const block = [
      road([
        { x: -size, z: -size },
        { x: size, z: -size },
      ]),
      road([
        { x: size, z: -size },
        { x: size, z: size },
      ]),
      road([
        { x: size, z: size },
        { x: -size, z: size },
      ]),
      road([
        { x: -size, z: size },
        { x: -size, z: -size },
      ]),
    ];
    expect(detectRoundabouts(block)).toHaveLength(0);
  });

  it('non duplica lo stesso anello trovato due volte', () => {
    const rings = detectRoundabouts([road(circle(12)), road(circle(12.3))]);
    expect(rings).toHaveLength(1);
  });

  it('costruisce corona e cordolo dell’isola', () => {
    const rings = detectRoundabouts([road(circle(12))]);
    const { surface, curb } = buildRoundaboutAprons(
      rings,
      flat,
      { r: 1, g: 1, b: 1 },
      { r: 1, g: 1, b: 1 },
      0.2,
    );
    const segments = rings[0]!.segments;
    expect(surface.positions).toHaveLength(segments * 4 * 3);
    expect(surface.indices).toHaveLength(segments * 6);
    expect(curb.positions).toHaveLength(segments * 4 * 3);
    expect(curb.indices).toHaveLength(segments * 6);

    const top = 500 + 0.2 + ROUNDABOUT.apronHeight;
    for (let i = 0; i < surface.positions.length; i += 3) {
      const x = surface.positions[i]!;
      const y = surface.positions[i + 1]!;
      const z = surface.positions[i + 2]!;
      const radius = Math.hypot(x, z);
      expect(y).toBeCloseTo(top, 6);
      expect(radius).toBeGreaterThanOrEqual(rings[0]!.innerRadius - 1e-6);
      expect(radius).toBeLessThanOrEqual(rings[0]!.outerRadius + 1e-6);
    }
    const bottom = 500 + 0.2 - ROUNDABOUT.sink;
    for (let i = 0; i < curb.positions.length; i += 3) {
      const y = curb.positions[i + 1]!;
      expect(Math.abs(y - bottom) < 1e-6 || Math.abs(y - top) < 1e-6).toBe(true);
    }
  });

  it('accoda più rotatorie senza riusare gli indici', () => {
    const rings = detectRoundabouts([
      road(circle(12)),
      road(circle(9).map((point) => ({ x: point.x + 60, z: point.z }))),
    ]);
    expect(rings).toHaveLength(2);
    const { surface } = buildRoundaboutAprons(
      rings,
      flat,
      { r: 1, g: 1, b: 1 },
      { r: 1, g: 1, b: 1 },
      0.2,
    );
    const vertices = surface.positions.length / 3;
    expect(Math.max(...surface.indices)).toBe(vertices - 1);
  });
});

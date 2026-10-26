import { describe, expect, it } from 'vitest';
import type { Pt } from '../src/geo/geo';
import type { RoadIndex } from '../src/geo/osm';
import { filletCorner, giveWayTriangles, isRealJunction, roundCorners, splineThrough } from '../src/world/roads';

/** Segmento dritto: nessun angolo, la polilinea non deve cambiare. */
const straight: Pt[] = [
  { x: 0, z: 0 },
  { x: 10, z: 0 },
  { x: 20, z: 0 },
];

/** Svolta a 90°: un solo vertice interno, il caso che nei nastri fa la cuspide. */
const corner: Pt[] = [
  { x: 0, z: 0 },
  { x: 20, z: 0 },
  { x: 20, z: 20 },
];

describe('roundCorners', () => {
  it('lascia intatta una polilinea dritta', () => {
    const out = roundCorners(straight, 22);
    expect(out).toHaveLength(straight.length);
    out.forEach((p, i) => {
      expect(p.x).toBeCloseTo(straight[i].x, 6);
      expect(p.z).toBeCloseTo(straight[i].z, 6);
    });
  });

  it('spezza il vertice di una svolta secca in due punti', () => {
    const out = roundCorners(corner, 22);
    expect(out).toHaveLength(4);
    // gli estremi restano quelli originali
    expect(out[0]).toEqual(corner[0]);
    expect(out[out.length - 1]).toEqual(corner[2]);
    // i due punti nuovi stanno sui lati, a 35% della lunghezza (7 m su 20 m)
    expect(out[1].x).toBeCloseTo(13, 5);
    expect(out[1].z).toBeCloseTo(0, 5);
    expect(out[2].x).toBeCloseTo(20, 5);
    expect(out[2].z).toBeCloseTo(7, 5);
  });

  it('non tocca curve dolci sotto la soglia', () => {
    const gentle: Pt[] = [
      { x: 0, z: 0 },
      { x: 10, z: 1 },
      { x: 20, z: 0 },
    ];
    expect(roundCorners(gentle, 22)).toHaveLength(3);
  });

  it('regge polilinee degeneri', () => {
    expect(roundCorners([], 22)).toHaveLength(0);
    expect(roundCorners([{ x: 1, z: 1 }], 22)).toHaveLength(1);
    expect(roundCorners([{ x: 0, z: 0 }, { x: 0, z: 0 }, { x: 5, z: 0 }], 22)).toHaveLength(3);
  });
});

describe('raccordo d\'angolo tra cordoli', () => {
  const center: Pt = { x: 0, z: 0 };

  it('sostituisce lo spigolo con un quarto d\'arco', () => {
    const arc = filletCorner(
      { x: 0, z: 3 },
      { x: 1, z: 0 },
      { x: 3, z: 0 },
      { x: 0, z: 1 },
      center,
      0.9,
      6,
    );
    expect(arc).not.toBeNull();
    expect(arc!).toHaveLength(7);
    // parte e finisce sui due cordoli, a 0,9 m dallo spigolo (3, 3)
    expect(arc![0]!.x).toBeCloseTo(2.1, 5);
    expect(arc![0]!.z).toBeCloseTo(3, 5);
    expect(arc![6]!.x).toBeCloseTo(3, 5);
    expect(arc![6]!.z).toBeCloseTo(2.1, 5);
    // l'arco resta nell'angolo: nessun punto va oltre lo spigolo né dentro l'incrocio
    for (const p of arc!) {
      expect(p.x).toBeGreaterThanOrEqual(2.1 - 1e-6);
      expect(p.x).toBeLessThanOrEqual(3 + 1e-6);
      expect(p.z).toBeGreaterThanOrEqual(2.1 - 1e-6);
      expect(p.z).toBeLessThanOrEqual(3 + 1e-6);
    }
  });

  it('non raccorda cordoli paralleli (niente divisione per zero)', () => {
    expect(
      filletCorner({ x: 0, z: 3 }, { x: 1, z: 0 }, { x: 0, z: 9 }, { x: 1, z: 0 }, center),
    ).toBeNull();
  });
});

describe('riconoscimento dell\'incrocio', () => {
  /** Strada larga 6 m (semilarghezza 3) che corre lungo x. */
  const stub = {
    isOnRoad: (_x: number, z: number, tolerance = 0.8) => Math.abs(z) <= 3 + tolerance,
  } as unknown as RoadIndex;

  it('accetta un punto sulla carreggiata che attraversa', () => {
    expect(isRealJunction(stub, { x: 0, z: 1 }, 1)).toBe(true);
  });

  it('rifiuta una via che passa a due metri dal ciglio', () => {
    // con la vecchia tolleranza di 2 m questo era "incrocio": da lì
    // arrivavano stop e zebre in mezzo al rettilineo
    expect(isRealJunction(stub, { x: 0, z: 5 }, 1)).toBe(false);
  });
});

describe('dare precedenza', () => {
  it('disegna le punte sulla corsia di marcia, col vertice verso chi arriva', () => {
    const tris = giveWayTriangles({ x: 0, z: 0 }, 1, 0, 6);
    expect(tris).toHaveLength(4);
    for (const tri of tris) {
      expect(tri).toHaveLength(3);
      // corsia di destra rispetto al verso +x: z negativi
      for (const p of tri) expect(p.z).toBeLessThan(0);
      // base verso l'incrocio (x ~ 0), punta indietro verso il guidatore
      expect(tri[2]!.x).toBeLessThan(tri[0]!.x);
      expect(tri[2]!.x).toBeCloseTo(-0.95, 5);
    }
    // le punte coprono la carreggiata senza sovrapporsi
    const centres = tris.map((t) => (t[0]!.z + t[1]!.z) / 2).sort((a, b) => a - b);
    for (let i = 1; i < centres.length; i++) expect(centres[i]!).toBeGreaterThan(centres[i - 1]!);
  });
});

describe('spline centripeta', () => {
  it('passa per i nodi OSM e campiona fitto', () => {
    const nodes: Pt[] = [
      { x: 0, z: 0 },
      { x: 10, z: 0 },
      { x: 20, z: 4 },
      { x: 30, z: 0 },
    ];
    const out = splineThrough(nodes, 5);
    expect(out.length).toBeGreaterThan(nodes.length * 2);
    // primo e ultimo restano quelli veri: la strada non si stacca dall'incrocio
    expect(out[0]!.x).toBeCloseTo(nodes[0]!.x, 9);
    expect(out[0]!.z).toBeCloseTo(nodes[0]!.z, 9);
    const last = out[out.length - 1]!;
    expect(last.x).toBeCloseTo(nodes[nodes.length - 1]!.x, 9);
    expect(last.z).toBeCloseTo(nodes[nodes.length - 1]!.z, 9);
    // ogni nodo compare nella polilinea campionata
    for (const node of nodes) {
      const hit = out.some((p) => Math.hypot(p.x - node.x, p.z - node.z) < 1e-6);
      expect(hit).toBe(true);
    }
  });

  it('su un rettilineo non inventa curve', () => {
    const out = splineThrough(
      [
        { x: 0, z: 0 },
        { x: 10, z: 0 },
        { x: 20, z: 0 },
      ],
      4,
    );
    for (const p of out) expect(Math.abs(p.z)).toBeLessThan(1e-9);
  });

  it('regge polilinee degeneri con punti coincidenti', () => {
    const out = splineThrough(
      [
        { x: 0, z: 0 },
        { x: 0, z: 0 },
        { x: 5, z: 0 },
      ],
      5,
    );
    for (const p of out) expect(Number.isFinite(p.x) && Number.isFinite(p.z)).toBe(true);
    expect(splineThrough([{ x: 1, z: 1 }], 5)).toHaveLength(1);
  });
});

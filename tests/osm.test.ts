import { describe, expect, it } from 'vitest';
import {
  BuildingIndex,
  RoadIndex,
  markTownSidewalks,
  roadSurface,
  roadWidth,
  widenUnmappedRuralRoads,
  type Building,
  type Road,
} from '../src/geo/osm';
import { isRealJunction, roadPolyline } from '../src/world/roads';

function building(x: number, z: number, size = 10, height = 6): Building {
  const points = [
    { x, z },
    { x: x + size, z },
    { x: x + size, z: z + size },
    { x, z: z + size },
  ];
  return {
    height,
    points,
    bounds: { minX: x, maxX: x + size, minZ: z, maxZ: z + size },
    area: size * size,
  };
}

function road(type: string, points: { x: number; z: number }[]): Road {
  return {
    type,
    name: '',
    width: roadWidth(type),
    paved: roadSurface(type) === 'asphalt',
    points,
    bounds: {
      minX: Math.min(...points.map((p) => p.x)),
      maxX: Math.max(...points.map((p) => p.x)),
      minZ: Math.min(...points.map((p) => p.z)),
      maxZ: Math.max(...points.map((p) => p.z)),
    },
  };
}

describe('indice edifici', () => {
  it('spinge un cerchio fuori da un edificio e riporta la collisione', () => {
    const index = new BuildingIndex([building(0, 0)]);
    const res = index.resolveCircle(5, 5, 0.5);
    expect(res.hit).toBe(true);
    const outside =
      res.x <= -0.4 || res.x >= 10.4 || res.z <= -0.4 || res.z >= 10.4;
    expect(outside).toBe(true);
  });

  it('non tocca chi è lontano', () => {
    const index = new BuildingIndex([building(0, 0)]);
    const res = index.resolveCircle(100, 100, 0.5);
    expect(res.hit).toBe(false);
    expect(res.x).toBe(100);
    expect(res.z).toBe(100);
  });

  it('risolve anche il bordo esterno a distanza minore del raggio', () => {
    const index = new BuildingIndex([building(0, 0)]);
    const res = index.resolveCircle(10.3, 5, 0.6);
    expect(res.hit).toBe(true);
    expect(res.x).toBeGreaterThanOrEqual(10.55);
  });

  it('hitsCircle risponde come resolveCircle senza spostare il punto', () => {
    const index = new BuildingIndex([building(0, 0)]);
    expect(index.hitsCircle(5, 5, 0.5)).toBe(true);
    expect(index.hitsCircle(10.3, 5, 0.6)).toBe(true);
    expect(index.hitsCircle(10.7, 5, 0.6)).toBe(false);
    expect(index.hitsCircle(100, 100, 0.5)).toBe(false);
  });

  it('rimuove le impronte streamed e ricostruisce la griglia', () => {
    const staticHouse = building(0, 0);
    const streamed = building(100, 100);
    const index = new BuildingIndex([staticHouse, streamed]);
    expect(index.hitsCircle(105, 105, 0.5)).toBe(true);
    expect(index.remove([streamed])).toBe(1);
    expect(index.all).toEqual([staticHouse]);
    expect(index.hitsCircle(105, 105, 0.5)).toBe(false);
    expect(index.hitsCircle(5, 5, 0.5)).toBe(true);
    expect(index.remove([building(300, 300)])).toBe(0);
  });
});

describe('incroci per strisce e stop', () => {
  const roads = new RoadIndex([
    road('residential', [
      { x: -50, z: 0 },
      { x: 50, z: 0 },
    ]),
    road('residential', [
      { x: 0, z: -50 },
      { x: 0, z: 50 },
    ]),
  ]);

  it('conta come incrocio solo il punto che sta su un\'altra strada', () => {
    // idx 0 è la strada orizzontale: il punto (0,0) sta anche sulla verticale
    expect(isRealJunction(roads, { x: 0, z: 0 }, 0)).toBe(true);
    // tratto dritto in mezzo alla sola strada orizzontale
    expect(isRealJunction(roads, { x: 30, z: 0 }, 0)).toBe(false);
    expect(isRealJunction(undefined, { x: 0, z: 0 }, 0)).toBe(false);
  });
});

describe('indice strade', () => {
  const index = new RoadIndex([
    road('residential', [
      { x: -50, z: 0 },
      { x: 50, z: 0 },
    ]),
    road('track', [
      { x: 0, z: -50 },
      { x: 0, z: 50 },
    ]),
  ]);

  it('riconosce di essere su strada asfaltata', () => {
    expect(index.isOnRoad(0, 0)).toBe(true);
    expect(index.isOnRoad(0, 1.8)).toBe(true);
  });

  it('riconosce lo sterrato e il fuori strada', () => {
    expect(index.isOnRoad(0, 30, 0.2)).toBe(true);
    expect(index.isOnRoad(40, 40, 0.2)).toBe(false);
  });

  it('misura la distanza dal ciglio: negativa in carreggiata, positiva fuori', () => {
    expect(index.distanceFromRoad(0, 0)).toBeLessThan(0);
    expect(index.distanceFromRoad(40, 40)).toBeGreaterThan(30);
    expect(index.distanceFromRoad(5000, 5000)).toBe(Infinity);
  });

  it('trova la strada asfaltata più vicina', () => {
    const near = index.nearest(20, 10);
    expect(near).not.toBeNull();
    expect(near?.road.type).toBe('residential');
    expect(Math.abs(near!.z)).toBeLessThan(0.001);
  });

  it('campiona i cigli a passo costante, senza tentativi casuali', () => {
    const only = new RoadIndex([
      road('residential', [
        { x: -50, z: 0 },
        { x: 50, z: 0 },
      ]),
    ]);
    const pts: { x: number; z: number }[] = [];
    only.forEachRoadEdge(0, 0, 40, 1, (x, z) => pts.push({ x, z }));
    expect(pts.length).toBeGreaterThan(150);
    for (const p of pts) {
      // larghezza 5,2 → semilarghezza 2,6 + 0,18 di ciglio
      expect(Math.abs(Math.abs(p.z) - 2.78)).toBeLessThan(1e-6);
      expect(Math.abs(p.x)).toBeLessThanOrEqual(40);
    }
  });

  it('può usare la stessa spline del nastro stradale', () => {
    const curved = road('residential', [
      { x: 0, z: 0 },
      { x: 20, z: 0 },
      { x: 20, z: 20 },
    ]);
    const visualLine = roadPolyline(curved);
    const index = new RoadIndex([curved], undefined, roadPolyline);
    const curvedPoint = visualLine.find((point) => point.x > 18 && point.z > 1);
    expect(curvedPoint).toBeDefined();
    expect(index.isOnRoad(curvedPoint!.x, curvedPoint!.z, 0.1)).toBe(true);
  });
});

describe('marciapiedi solo nel costruito', () => {
  it('segna i punti vicini alle case e lascia nuda la provinciale', () => {
    const road500 = road('residential', [
      { x: -200, z: 0 },
      { x: -100, z: 0 },
      { x: 0, z: 0 },
      { x: 100, z: 0 },
      { x: 200, z: 0 },
    ]);
    // Due case per lato della via: il centro di ogni impronta cade entro 26 m
    // dal nodo stradale, quindi è tessuto urbano e non un casale isolato.
    const buildings = new BuildingIndex([
      building(-5, 10),
      building(5, 10),
      building(-5, -20),
      building(5, -20),
    ]);
    markTownSidewalks([road500], buildings);
    const spans = road500.walkSpans!;
    expect(spans).toHaveLength(5);
    expect(spans[2]).toBe(true);
    expect(spans[4]).toBe(false);

    const index = new RoadIndex([road500]);
    // dentro il paese il ciglio rialzato c'è (asfalto 20 cm + cordolo 18 cm)
    expect(index.surfaceOffset(0, 3.3)).toBeGreaterThan(0.3);
    // in aperta campagna niente marciapiede: solo la spalla in ghiaia, più bassa
    const shoulder = index.surfaceOffset(200, 3.3);
    expect(shoulder).toBeGreaterThan(0.1);
    expect(shoulder).toBeLessThan(0.25);
    // oltre il ciglione si torna sull'erba (il raccordo arriva a ~5,1 m)
    expect(index.surfaceOffset(200, 5.2)).toBe(0);
  });

  it('un casale isolato non fa nascere il marciapiede in mezzo ai campi', () => {
    const road500 = road('residential', [
      { x: -200, z: 0 },
      { x: -100, z: 0 },
      { x: 0, z: 0 },
      { x: 100, z: 0 },
      { x: 200, z: 0 },
    ]);
    // Una sola casa a 20 m: è campagna, non un paese.
    markTownSidewalks([road500], new BuildingIndex([building(0, 20)]));
    expect(road500.walkSpans!.some(Boolean)).toBe(false);
  });

  describe('larghezze inferite delle strade rurali', () => {
    it('allarga solo le carreggiate locali senza larghezza/corsie mappate', () => {
      const rural = road('unclassified', [{ x: 0, z: 0 }, { x: 100, z: 0 }]);
      const residential = road('residential', [{ x: 0, z: 10 }, { x: 100, z: 10 }]);
      const mapped = { ...road('residential', [{ x: 0, z: 20 }, { x: 100, z: 20 }]), tagWidth: 4.8 };
      const urban = { ...road('unclassified', [{ x: 0, z: 30 }, { x: 100, z: 30 }]), walkSpans: [true, false] };
      const multilane = { ...road('residential', [{ x: 0, z: 40 }, { x: 100, z: 40 }]), lanes: 2 };

      widenUnmappedRuralRoads([rural, residential, mapped, urban, multilane]);

      expect(rural.width).toBe(5.8);
      expect(residential.width).toBe(5.6);
      expect(mapped.width).toBe(5.2);
      expect(urban.width).toBe(5.4);
      expect(multilane.width).toBe(5.2);
    });
  });
});

describe('larghezze e superfici', () => {
  it('distingue asfalto e sterrato', () => {
    expect(roadSurface('primary')).toBe('asphalt');
    expect(roadSurface('track')).toBe('dirt');
    expect(roadWidth('primary')).toBeGreaterThan(roadWidth('track'));
    expect(roadWidth('tipo-inventato')).toBe(4.5);
  });
});

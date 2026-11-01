import { describe, expect, it } from 'vitest';
import type { OsmData, Road } from '../src/geo/osm';
import { auditFurniture, auditViolations, type FurnitureContext } from '../src/world/furniture-audit';
import { placeSignBesideRoad } from '../src/world/street-furniture';

/** Strada dritta lungo z, mezzeria x = 0, larghezza 6 m. */
function straightOsm(width = 6): OsmData {
  const road = {
    type: 'secondary',
    name: 'Via',
    width,
    paved: true,
    points: [
      { x: 0, z: 0 },
      { x: 0, z: 100 },
    ],
    bounds: { minX: 0, maxX: 0, minZ: 0, maxZ: 100 },
  } as unknown as Road;
  return { roads: [road] } as unknown as OsmData;
}

/** Contesto finto: carreggiata |x| < 3, edificio attorno a (10, 0). */
function context(): FurnitureContext {
  return {
    roads: { isOnRoad: (x, _z, tolerance = 0) => Math.abs(x) < 3 + tolerance },
    buildings: {
      hitsCircle: (x, z, radius) => Math.abs(x - 10) < 2 + radius && Math.abs(z) < 3 + radius,
    },
    heights: {
      heightAt: () => 50,
      // solo la scarpata di prova a x ≈ 30 è ripida
      slopeAt: (x) => (Math.abs(x - 30) < 5 ? 20 : 2),
    },
  };
}

describe('placeSignBesideRoad', () => {
  it('sposta un cartello sulla mezzeria oltre il ciglio', () => {
    const spot = placeSignBesideRoad(0.4, 50, straightOsm());
    expect(Math.abs(spot.x)).toBeCloseTo(3.85);
    expect(spot.z).toBeCloseTo(50);
    expect(context().roads.isOnRoad(spot.x, spot.z, 0.25)).toBe(false);
  });

  it('lascia stare un cartello già fuori dalla carreggiata', () => {
    const spot = placeSignBesideRoad(5, 50, straightOsm());
    expect(spot.x).toBeCloseTo(5);
    expect(spot.z).toBeCloseTo(50);
  });

  it('sa passare al lato opposto quando quello occupato ha un muro', () => {
    const spot = placeSignBesideRoad(0.4, 50, straightOsm(), 1);
    expect(spot.x).toBeCloseTo(-3.85);
  });
});

describe('auditFurniture', () => {
  const spots = [
    { x: 0, z: 0 }, // in carreggiata
    { x: 10, z: 0 }, // dentro l'edificio
    { x: 30, z: 0 }, // pendenza 20°
    { x: 5, z: 100, y: 52 }, // piede 2 m sopra il terreno
    { x: 100, z: 100 }, // libero
    { x: 200, z: 200 }, // coppia sovrapposta
    { x: 200.3, z: 200 },
  ];

  it('conta le violazioni per tipo e la distanza minima', () => {
    const audit = auditFurniture(spots, context(), { maxSlope: 12, minGap: 0.5 });
    expect(audit.checked).toBe(7);
    expect(audit.onRoad).toBe(1);
    expect(audit.inBuilding).toBe(1);
    expect(audit.onSlope).toBe(1);
    expect(audit.offGround).toBe(1);
    expect(audit.crowded).toBe(1);
    expect(audit.minGap).toBeCloseTo(0.3, 5);
    expect(auditViolations(audit)).toBe(5);
  });

  it('non segnala niente su un elenco pulito', () => {
    const audit = auditFurniture(
      [
        { x: 4, z: 20, y: 50 },
        { x: -4, z: 40, y: 50 },
      ],
      context(),
      { maxSlope: 12, minGap: 0.5 },
    );
    expect(auditViolations(audit)).toBe(0);
  });

  it('scarta le posizioni non finite e regge l’elenco vuoto', () => {
    const audit = auditFurniture([{ x: Number.NaN, z: 0 }], context());
    expect(audit.checked).toBe(0);
    expect(audit.minGap).toBe(Infinity);
    expect(auditViolations(audit)).toBe(0);
  });
});

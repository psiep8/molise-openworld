import { describe, expect, it } from 'vitest';
import { BBOX, CENTER_LAT, METERS_PER_DEG_LAT, METERS_PER_DEG_LON, WORLD, latLonToWorld, worldToLatLon } from '../src/config';
import { distanceToSegment2, mercatorPixel, mulberry32, pointInPolygon, wrapAngle } from '../src/geo/geo';

describe('proiezione locale', () => {
  it('mappa il centro del mondo su (0,0)', () => {
    const p = latLonToWorld(CENTER_LAT, (BBOX.lonMin + BBOX.lonMax) / 2);
    expect(p.x).toBeCloseTo(0, 6);
    expect(p.z).toBeCloseTo(0, 6);
  });

  it('il nord è -z e l’est è +x', () => {
    const north = latLonToWorld(CENTER_LAT + 0.01, 14.775);
    const east = latLonToWorld(CENTER_LAT, 14.785);
    expect(north.z).toBeLessThan(0);
    expect(east.x).toBeGreaterThan(0);
    expect(north.z).toBeCloseTo(-0.01 * METERS_PER_DEG_LAT, 6);
    expect(east.x).toBeCloseTo(0.01 * METERS_PER_DEG_LON, 6);
  });

  it('round-trip lat/lon -> world -> lat/lon', () => {
    for (const [lat, lon] of [
      [41.8905, 14.7854],
      [41.8291, 14.7103],
      [41.9025, 14.8364],
    ]) {
      const w = latLonToWorld(lat, lon);
      const back = worldToLatLon(w.x, w.z);
      expect(back.lat).toBeCloseTo(lat, 9);
      expect(back.lon).toBeCloseTo(lon, 9);
    }
  });

  it('le dimensioni del mondo coprono il bbox dichiarato', () => {
    expect(WORLD.width).toBeGreaterThan(13000);
    expect(WORLD.width).toBeLessThan(15000);
    expect(WORLD.height).toBeGreaterThan(11000);
    expect(WORLD.height).toBeLessThan(13000);
  });
});

describe('geometria', () => {
  it('pointInPolygon riconosce dentro e fuori', () => {
    const square = [
      { x: 0, z: 0 },
      { x: 10, z: 0 },
      { x: 10, z: 10 },
      { x: 0, z: 10 },
    ];
    expect(pointInPolygon(5, 5, square)).toBe(true);
    expect(pointInPolygon(-1, 5, square)).toBe(false);
    expect(pointInPolygon(11, 11, square)).toBe(false);
  });

  it('distanza punto-segmento', () => {
    expect(distanceToSegment2(5, 5, 0, 0, 10, 0)).toBeCloseTo(5, 9);
    expect(distanceToSegment2(-5, 0, 0, 0, 10, 0)).toBeCloseTo(5, 9);
    expect(distanceToSegment2(3, 4, 0, 0, 10, 0)).toBeCloseTo(4, 9);
    expect(distanceToSegment2(0, 0, 2, 2, 2, 2)).toBeCloseTo(Math.SQRT2 * 2, 9);
  });

  it('mercatorPixel resta coerente con il livello di zoom', () => {
    const z16 = mercatorPixel(41.87, 14.775, 16);
    const z17 = mercatorPixel(41.87, 14.775, 17);
    expect(z17.x).toBeCloseTo(z16.x * 2, 6);
    expect(z17.y).toBeCloseTo(z16.y * 2, 6);
    expect(Math.floor(z16.x / 256)).toBe(35457);
    expect(Math.floor(z16.y / 256)).toBe(24359);
  });

  it('mulberry32 è deterministico', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    const seqA = Array.from({ length: 5 }, a);
    const seqB = Array.from({ length: 5 }, b);
    expect(seqA).toEqual(seqB);
    expect(seqA.every((v) => v >= 0 && v < 1)).toBe(true);
  });

  it('wrapAngle riporta in [-π, π]', () => {
    expect(wrapAngle(Math.PI * 3)).toBeCloseTo(Math.PI, 9);
    expect(wrapAngle(-Math.PI * 3)).toBeCloseTo(-Math.PI, 9);
  });
});

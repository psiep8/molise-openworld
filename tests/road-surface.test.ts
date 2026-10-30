import { describe, expect, it } from 'vitest';
import { ROAD_SURFACE_MAX_ACROSS, ROAD_SURFACE_MAX_STEP, roadRibbonColumns, roadRibbonStations } from '../src/world/road-surface';

describe('stazioni del nastro stradale', () => {
  it('non lascia mai una corda più lunga di metà cella del terreno', () => {
    const stations = roadRibbonStations([
      { x: 0, z: 0 },
      { x: 100, z: 0 },
      { x: 100, z: 100 },
    ]);
    expect(stations[0]).toEqual({ x: 0, z: 0 });
    expect(stations.at(-1)).toEqual({ x: 100, z: 100 });
    for (let i = 1; i < stations.length; i++) {
      const a = stations[i - 1]!;
      const b = stations[i]!;
      expect(Math.hypot(b.x - a.x, b.z - a.z)).toBeLessThanOrEqual(ROAD_SURFACE_MAX_STEP + 1e-9);
    }
    // 200 m di polilinea: ~42 stazioni, non due
    expect(stations.length).toBeGreaterThan(40);
  });

  it('tiene i punti della polilinea, così le curve non vengono tagliate', () => {
    const stations = roadRibbonStations([
      { x: 0, z: 0 },
      { x: 10, z: 4 },
      { x: 20, z: 0 },
    ]);
    expect(stations.some((p) => p.x === 10 && p.z === 4)).toBe(true);
  });

  it('accetta un passo esplicito', () => {
    const coarse = roadRibbonStations([{ x: 0, z: 0 }, { x: 20, z: 0 }], 10);
    expect(coarse).toEqual([
      { x: 0, z: 0 },
      { x: 10, z: 0 },
      { x: 20, z: 0 },
    ]);
  });

  it('non duplica i punti coincidenti', () => {
    const stations = roadRibbonStations([
      { x: 5, z: 5 },
      { x: 5, z: 5 },
      { x: 9.5, z: 5 },
    ]);
    expect(stations).toHaveLength(2);
  });

  it('rifiuta un passo nullo o negativo', () => {
    expect(() => roadRibbonStations([{ x: 0, z: 0 }, { x: 1, z: 0 }], 0)).toThrow(RangeError);
    expect(() => roadRibbonStations([{ x: 0, z: 0 }, { x: 1, z: 0 }], -2)).toThrow(RangeError);
  });

  it('su una collina la corda resta vicina alla superficie', () => {
    // collina larga 60 m: con stazioni ogni 4,75 m la corda non deve staccarsi
    const heightAt = (x: number, z: number): number =>
      20 * Math.exp(-((x - 50) ** 2 + (z - 50) ** 2) / (2 * 30 * 30));
    const stations = roadRibbonStations([{ x: 0, z: 50 }, { x: 100, z: 50 }]);
    let worst = 0;
    for (let i = 1; i < stations.length; i++) {
      const a = stations[i - 1]!;
      const b = stations[i]!;
      for (let k = 1; k < 8; k++) {
        const t = k / 8;
        const x = a.x + (b.x - a.x) * t;
        const z = a.z + (b.z - a.z) * t;
        const chord = heightAt(a.x, a.z) * (1 - t) + heightAt(b.x, b.z) * t;
        worst = Math.max(worst, Math.abs(heightAt(x, z) - chord));
      }
    }
    // la corda taglia la cupola, ma di pochi centimetri: con i 20 cm di
    // asfalto sopra il prato la piega non arriva mai al manto
    expect(worst).toBeLessThan(0.1);
  });
});

describe('colonne del nastro stradale', () => {
  it('divide la larghezza in celle da meno di 2 m', () => {
    expect(roadRibbonColumns(1.2)).toBe(2);
    // strada larga 6 m: 3,6 -> 4 celle da 1,5 m
    expect(roadRibbonColumns(6)).toBe(5);
    expect(roadRibbonColumns(7)).toBe(5);
    expect(roadRibbonColumns(14)).toBe(9);
    expect(ROAD_SURFACE_MAX_ACROSS).toBeLessThan(2);
  });

  it('rifiuta una larghezza non valida', () => {
    expect(() => roadRibbonColumns(0)).toThrow(RangeError);
    expect(() => roadRibbonColumns(Number.NaN)).toThrow(RangeError);
  });
});

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Heightfield, type HeightMeta } from '../src/geo/elevation';
import { START } from '../src/config';

const meta: HeightMeta = {
  source: 'test',
  license: 'test',
  attribution: 'test',
  encoding: 'int16-le, decimetri',
  step: 10,
  nx: 4,
  nz: 4,
  originX: -15,
  originZ: -15,
  lat: 41.87,
  lon: 14.775,
  metersPerDegLat: 111145,
  metersPerDegLon: 83014,
  minElevation: 0,
  maxElevation: 30,
  generatedAt: 'test',
};

function grid(values: number[]): Heightfield {
  const data = new Int16Array(values.map((v) => Math.round(v * 10)));
  return new Heightfield(meta, data);
}

describe('Heightfield', () => {
  it('campiona i vertici esatti', () => {
    const h = grid([
      0, 10, 20, 30,
      10, 20, 30, 40,
      20, 30, 40, 50,
      30, 40, 50, 60,
    ]);
    expect(h.heightAt(-15, -15)).toBeCloseTo(0, 6);
    expect(h.heightAt(15, -15)).toBeCloseTo(30, 6);
    expect(h.heightAt(-15, 15)).toBeCloseTo(30, 6);
    expect(h.heightAt(15, 15)).toBeCloseTo(60, 6);
  });

  it('interpola bilinearmente al centro di una cella', () => {
    const h = grid([
      0, 10, 20, 30,
      10, 20, 30, 40,
      20, 30, 40, 50,
      30, 40, 50, 60,
    ]);
    expect(h.heightAt(-10, -10)).toBeCloseTo(10, 6);
    expect(h.heightAt(0, 0)).toBeCloseTo(30, 6);
    expect(h.heightAt(-5, -5)).toBeCloseTo(20, 6);
  });

  it('clampa ai bordi del mondo', () => {
    const h = grid(new Array(16).fill(7));
    expect(h.heightAt(-1e6, -1e6)).toBeCloseTo(7, 6);
    expect(h.heightAt(1e6, 1e6)).toBeCloseTo(7, 6);
  });

  it('normale verticale su terreno piatto', () => {
    const h = grid(new Array(16).fill(5));
    const n = h.normalAt(0, 0);
    expect(n.x).toBeCloseTo(0, 9);
    expect(n.z).toBeCloseTo(0, 9);
    expect(n.y).toBeGreaterThan(0);
    expect(h.slopeAt(0, 0)).toBeCloseTo(0, 4);
  });

  it('ricalcola i chunk senza buchi tra i campioni', () => {
    const h = grid(new Array(16).fill(1));
    expect(h.heightAt(0.5, 0.5)).toBeCloseTo(1, 6);
  });
});

const heightPath = resolve(process.cwd(), 'public/geo/heights.json');
const binPath = resolve(process.cwd(), 'public/geo/heights.bin');

describe.runIf(existsSync(heightPath) && existsSync(binPath))('dati DEM generati', () => {
  const realMeta = JSON.parse(readFileSync(heightPath, 'utf8')) as HeightMeta;
  const buffer = readFileSync(binPath);
  const hf = new Heightfield(realMeta, new Int16Array(buffer.buffer, buffer.byteOffset, buffer.byteLength / 2));

  it('ha dimensioni e formattazione coerenti', () => {
    expect(buffer.byteLength).toBe(realMeta.nx * realMeta.nz * 2);
    expect(realMeta.originX).toBeCloseTo(-((realMeta.nx - 1) * realMeta.step) / 2, 6);
    expect(realMeta.originZ).toBeCloseTo(-((realMeta.nz - 1) * realMeta.step) / 2, 6);
    expect(realMeta.step).toBe(10);
  });

  it('copre tutto il bbox con un margine di mezzo campione', () => {
    const minX = realMeta.originX;
    const maxX = minX + (realMeta.nx - 1) * realMeta.step;
    const minZ = realMeta.originZ;
    const maxZ = minZ + (realMeta.nz - 1) * realMeta.step;
    expect(minX).toBeLessThan(-7000);
    expect(maxX).toBeGreaterThan(7000);
    expect(minZ).toBeLessThan(-6000);
    expect(maxZ).toBeGreaterThan(6000);
  });

  it('la quota di Palata è plausibile per il Molise', () => {
    const elev = hf.heightAt(START.x, START.z);
    expect(elev).toBeGreaterThan(150);
    expect(elev).toBeLessThan(900);
  });

  it('non contiene buchi estremi nella zona abitata', () => {
    expect(hf.minElevation).toBeGreaterThan(0);
    expect(hf.maxElevation).toBeLessThan(2000);
  });
});

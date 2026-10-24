import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { Heightfield, type HeightMeta } from '../src/geo/elevation';
import {
  FarTerrain,
  distanceOutside,
  farHeight,
  fbm2,
  ridged2,
  valueNoise2,
} from '../src/world/far-terrain';

/** DEM finto di 100 km di lato, con una collina al centro: basta per la geometria. */
function fakeHeightfield(): Heightfield {
  const step = 100;
  const nx = 1_001;
  const nz = 1_001;
  const meta: HeightMeta = {
    source: 'test',
    license: 'test',
    attribution: 'test',
    encoding: 'int16 decimetri',
    step,
    nx,
    nz,
    originX: -50_000,
    originZ: -50_000,
    lat: 41.87,
    lon: 14.78,
    metersPerDegLat: 111_132,
    metersPerDegLon: 82_000,
    minElevation: 300,
    maxElevation: 900,
    generatedAt: '2026-10-24',
  };
  const data = new Int16Array(nx * nz);
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const r = Math.hypot(i - nx / 2, j - nz / 2) / (nx / 2);
      data[j * nx + i] = Math.round((520 + 300 * Math.exp(-r * r * 3)) * 10);
    }
  }
  return new Heightfield(meta, data);
}

const bounds = { halfWidth: 50_000, halfHeight: 50_000, centerX: 0, centerZ: 0 };

describe('rumore delle montagne lontane', () => {
  it('è deterministico: due run diverse danno la stessa vetta', () => {
    expect(valueNoise2(12.3, 45.6)).toBe(valueNoise2(12.3, 45.6));
    expect(ridged2(1.5, -2.5)).toBe(ridged2(1.5, -2.5));
  });

  it('resta nei limiti e non produce NaN', () => {
    for (let i = 0; i < 200; i++) {
      const x = (i * 37.7) % 10_000;
      const z = (i * 91.3) % 10_000;
      const n = valueNoise2(x, z);
      expect(n).toBeGreaterThanOrEqual(-1);
      expect(n).toBeLessThanOrEqual(1);
      expect(Number.isFinite(fbm2(x / 900, z / 900))).toBe(true);
      const ridge = ridged2(x / 900, z / 900);
      expect(ridge).toBeGreaterThanOrEqual(0);
      expect(ridge).toBeLessThanOrEqual(1);
    }
  });

  it('le creste sono più appuntite del rumore semplice', () => {
    // la media di ridged (n²) resta più bassa e i valori alti sono rari: è la
    // differenza tra una catena appenninica e dune tonde
    let ridgeHigh = 0;
    let noiseHigh = 0;
    for (let i = 0; i < 500; i++) {
      const x = i * 0.37;
      const z = i * 0.61;
      if (ridged2(x, z) > 0.7) ridgeHigh++;
      if (Math.abs(valueNoise2(x, z)) > 0.7) noiseHigh++;
    }
    expect(ridgeHigh).toBeLessThan(noiseHigh);
  });
});

describe('altezza della cintura', () => {
  it('dentro il DEM è esattamente il DEM: nessun gradino al bordo', () => {
    const heights = fakeHeightfield();
    for (const [x, z] of [
      [0, 0],
      [12_000, -30_000],
      [-49_000, 49_000],
    ]) {
      expect(farHeight(x!, z!, heights, bounds)).toBe(heights.heightAt(x!, z!));
      expect(distanceOutside(x!, z!, bounds)).toBe(0);
    }
  });

  it('fuori dal DEM alza le montagne, ma resta un paesaggio e non un muro', () => {
    const heights = fakeHeightfield();
    const base = heights.heightAt(60_000, 0);
    const far = farHeight(60_000, 0, heights, bounds);
    expect(Number.isFinite(far)).toBe(true);
    expect(far).toBeGreaterThanOrEqual(base - 200);
    expect(far).toBeLessThan(base + 1_200);
  });

  it('cresce con la distanza dal bordo (la rampa evita il salto)', () => {
    const heights = fakeHeightfield();
    const ramp = [0, 500, 2_000, 4_000].map((d) => farHeight(50_000 + d, 0, heights, bounds));
    for (let i = 1; i < ramp.length; i++) expect(ramp[i]!).toBeGreaterThanOrEqual(ramp[i - 1]! - 150);
  });
});

describe('mesh della cintura', () => {
  it('è una sola mesh, con indici e colori per vertice', () => {
    const far = new FarTerrain(fakeHeightfield(), { outerRadius: 9_000 });
    far.update(0, 0, true);
    const meshes: THREE.Mesh[] = [];
    far.group.traverse((object) => {
      if ((object as THREE.Mesh).isMesh) meshes.push(object as THREE.Mesh);
    });
    expect(meshes.length).toBe(1);
    const geometry = meshes[0]!.geometry;
    expect(geometry.getAttribute('position').count).toBeGreaterThan(5_000);
    expect(geometry.getAttribute('color').count).toBe(geometry.getAttribute('position').count);
    expect(geometry.index!.count / 3).toBe(far.triangles);
    expect(far.triangles).toBeLessThan(13_000);
  });

  it('non si ricostruisce a ogni frame, solo quando la camera si sposta', () => {
    const far = new FarTerrain(fakeHeightfield());
    far.update(0, 0, true);
    const geometry = (far.group.children[0] as THREE.Mesh).geometry;
    const first = geometry.getAttribute('position').getX(10);
    far.update(20, 20);
    expect(geometry.getAttribute('position').getX(10)).toBe(first);
    far.update(1_000, 0);
    expect(geometry.getAttribute('position').getX(10)).not.toBe(first);
  });

  it('cambia raggio interno con il preset di qualità, senza buchi davanti', () => {
    const far = new FarTerrain(fakeHeightfield());
    far.setInnerRadius(1_050);
    far.update(0, 0, true);
    const position = (far.group.children[0] as THREE.Mesh).geometry.getAttribute('position');
    let min = Infinity;
    for (let i = 0; i < position.count; i++) {
      min = Math.min(min, Math.hypot(position.getX(i), position.getZ(i)));
    }
    expect(min).toBeGreaterThan(1_000);
    expect(min).toBeLessThan(1_300);
  });

  it('si può nascondere e liberare', () => {
    const far = new FarTerrain(fakeHeightfield());
    far.setVisible(false);
    expect(far.visible).toBe(false);
    far.dispose();
    expect(far.group.children.length).toBe(0);
  });
});

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  airColorAt,
  airOpacityAt,
  distantTerrainColor,
  horizontalAlignment,
  horizonPalette,
  sunwardMix,
  type HorizonPalette,
} from '../src/world/atmosphere';

const DAY = { sunElevation: 45, cloud: 0, rain: 0, snow: 0, day: 1 } as const;

function saturation(hex: number): number {
  const color = new THREE.Color(hex);
  const max = Math.max(color.r, color.g, color.b);
  const min = Math.min(color.r, color.g, color.b);
  return max <= 0 ? 0 : (max - min) / max;
}

function luminance(hex: number): number {
  const color = new THREE.Color(hex);
  return 0.2126 * color.r + 0.7152 * color.g + 0.0722 * color.b;
}

describe('tavolozza dell\'orizzonte', () => {
  it('a mezzogiorno sereno è un blu-grigio saturo, non un bianco', () => {
    const palette = horizonPalette(DAY);
    for (const hex of [palette.away, palette.sun, palette.sky, palette.fog]) {
      expect(saturation(hex)).toBeGreaterThanOrEqual(0.12);
      expect(luminance(hex)).toBeLessThanOrEqual(0.8);
    }
    // l'aria non copre mai del tutto il rilievo
    expect(palette.airOpacity).toBeGreaterThanOrEqual(0.7);
    expect(palette.airOpacity).toBeLessThan(0.9);
  });

  it('la nebbia è grigio-azzurra, non bianca', () => {
    const palette = horizonPalette({ ...DAY, sunElevation: 8, mist: 1, cloud: 0.8 });
    expect(saturation(palette.fog)).toBeGreaterThanOrEqual(0.08);
    expect(luminance(palette.fog)).toBeLessThan(0.75);
  });

  it('la pioggia è più grigia del sereno ma resta colorata', () => {
    const clear = horizonPalette(DAY);
    const rainy = horizonPalette({ ...DAY, cloud: 1, rain: 1 });
    expect(luminance(rainy.fog)).toBeLessThan(luminance(clear.fog));
    expect(saturation(rainy.fog)).toBeGreaterThanOrEqual(0.08);
  });

  it('la neve resta fredda e chiara, senza diventare bianco puro', () => {
    const palette = horizonPalette({ ...DAY, sunElevation: 20, snow: 1, cloud: 0.9 });
    expect(palette.fog).not.toBe(0xffffff);
    expect(saturation(palette.fog)).toBeGreaterThan(0.05);
  });

  it('di notte l\'orizzonte è blu scuro', () => {
    const palette = horizonPalette({ ...DAY, sunElevation: -12, day: 0 });
    expect(luminance(palette.fog)).toBeLessThan(0.05);
  });

  it('verso il sole l\'aria è più calda che dalla parte opposta', () => {
    const palette = horizonPalette(DAY);
    const toward = airColorAt(1, palette);
    const away = airColorAt(-1, palette);
    expect(toward.r / toward.b).toBeGreaterThan(away.r / away.b);
    expect(sunwardMix(1)).toBeGreaterThan(sunwardMix(-1));
  });
});

describe('profondità dell\'aria', () => {
  it('cresce con la distanza e non supera il tetto', () => {
    const palette: HorizonPalette = horizonPalette(DAY);
    expect(airOpacityAt(0, palette)).toBe(0);
    expect(airOpacityAt(2_000, palette)).toBeGreaterThan(0.2);
    expect(airOpacityAt(11_000, palette)).toBeGreaterThan(0.6);
    expect(airOpacityAt(11_000, palette)).toBeLessThan(palette.airOpacity);
    expect(airOpacityAt(80_000, palette)).toBeLessThanOrEqual(palette.airOpacity + 1e-9);
    expect(airOpacityAt(2_000, palette)).toBeLessThan(airOpacityAt(6_000, palette));
  });

  it('a 11 km il rilievo conserva ancora il suo colore', () => {
    const palette = horizonPalette(DAY);
    const terrain = new THREE.Color(0x4e6144);
    const air = airColorAt(0.2, palette);
    const distant = distantTerrainColor(terrain, 11_000, 0.2, palette);
    // non è né il terreno puro né l'aria pura: resta una via di mezzo
    expect(distant.getHex()).not.toBe(terrain.getHex());
    expect(distant.getHex()).not.toBe(air.getHex());
    const distance = (a: THREE.Color, b: THREE.Color): number =>
      Math.hypot(a.r - b.r, a.g - b.g, a.b - b.b);
    expect(distance(distant, terrain)).toBeGreaterThan(0.01);
  });

  it('la direzione orizzontale distingue sole e parte opposta', () => {
    expect(horizontalAlignment(0, -1, 0, -1)).toBeCloseTo(1, 6);
    expect(horizontalAlignment(0, 1, 0, -1)).toBeCloseTo(-1, 6);
    expect(horizontalAlignment(1, 0, 0, -1)).toBeCloseTo(0, 6);
    expect(horizontalAlignment(0, 0, 0, 1)).toBe(0);
  });
});

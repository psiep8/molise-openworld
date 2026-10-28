import { describe, expect, it } from 'vitest';
import { ObstacleIndex } from '../src/geo/obstacles';

describe('ostacoli cilindrici', () => {
  it('un cerchio lontano non tocca nulla', () => {
    const index = new ObstacleIndex();
    index.add(10, 10, 0.15);
    expect(index.hitsCircle(0, 0, 0.4)).toBe(false);
    expect(index.resolveCircle(0, 0, 0.4)).toEqual({ x: 0, z: 0, hit: false });
  });

  it('spinge fuori chi entra nel palo', () => {
    const index = new ObstacleIndex();
    index.add(0, 0, 0.15);
    const fixed = index.resolveCircle(0.05, 0, 0.5);
    expect(fixed.hit).toBe(true);
    // il centro finisce ad almeno raggio palo + raggio cerchio
    expect(Math.hypot(fixed.x, fixed.z)).toBeGreaterThanOrEqual(0.64);
  });

  it('con il centro esatto sul palo esce comunque (niente NaN)', () => {
    const index = new ObstacleIndex();
    index.add(3, -2, 0.2);
    const fixed = index.resolveCircle(3, -2, 0.5);
    expect(fixed.hit).toBe(true);
    expect(Number.isFinite(fixed.x)).toBe(true);
    expect(Number.isFinite(fixed.z)).toBe(true);
    expect(Math.hypot(fixed.x - 3, fixed.z + 2)).toBeGreaterThanOrEqual(0.69);
  });

  it('regge più ostacoli vicini senza incastrarsi', () => {
    const index = new ObstacleIndex();
    for (let i = 0; i < 6; i++) index.add(i * 2, 30, 0.15);
    const fixed = index.resolveCircle(5, 30, 0.4);
    expect(index.hitsCircle(fixed.x, fixed.z, 0.4)).toBe(false);
  });

  it('ignora coordinate non finite', () => {
    const index = new ObstacleIndex();
    index.add(Number.NaN, 0, 0.2);
    index.add(0, Number.POSITIVE_INFINITY, 0.2);
    expect(index.count).toBe(0);
  });

  it('dice quale ostacolo è stato preso, per farlo reagire', () => {
    const index = new ObstacleIndex();
    index.add(10, 10, 0.3, 'world-tree');
    index.add(14, 10, 0.3, 'sign');
    expect(index.nearest(10.4, 10, 1)?.tag).toBe('world-tree');
    expect(index.nearest(13.6, 10, 1)?.tag).toBe('sign');
    // niente entro la portata: l'auto ha preso un muro, non un ostacolo
    expect(index.nearest(0, 0, 1)).toBeNull();
  });

  it('conta il bordo dell\'ostacolo, non il centro', () => {
    const index = new ObstacleIndex();
    index.add(0, 0, 2);
    // a 2,5 m dal centro la distanza dal bordo è 0,5: dentro una portata di 0,6
    expect(index.nearest(2.5, 0, 0.6)).not.toBeNull();
    expect(index.nearest(2.5, 0, 0.4)).toBeNull();
  });

  it('rimuove un gruppo taggato senza toccare gli altri ostacoli', () => {
    const index = new ObstacleIndex();
    index.add(2, 0, 0.15, 'guardrail');
    index.add(0, 2, 0.15);
    expect(index.count).toBe(2);
    index.removeTag('guardrail');
    expect(index.count).toBe(1);
    expect(index.hitsCircle(2, 0, 0.4)).toBe(false);
    expect(index.hitsCircle(0, 2, 0.4)).toBe(true);
  });
});

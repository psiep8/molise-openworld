import { describe, expect, it } from 'vitest';
import { WorldHitField, localHitDirection } from '../src/world/world-hits';
import type { WorldHitMesh, WorldSpot } from '../src/world/worldkit';

/**
 * L'urto del world kit: l'auto preme un albero e quello deve piegarsi **lui**,
 * non tutto il bosco. Qui si verifica la sola parte misurabile fuori dalla GPU:
 * quale istanza riceve l'evento, in che verso, e con che forza.
 */
function part(variant: number, count: number): WorldHitMesh {
  const attribute = {
    array: new Float32Array(count * 4),
    needsUpdate: false,
  };
  return { mesh: {}, attribute, variant } as unknown as WorldHitMesh;
}

function spot(x: number, z: number, yaw: number, variant: number): WorldSpot {
  return { x, y: 0, z, yaw, variant };
}

describe('localHitDirection', () => {
  it('senza rotazione la spinta resta quella del mondo', () => {
    expect(localHitDirection(0, 0, -1)).toEqual({ x: 0, z: -1 });
  });

  it('ruota di -yaw, l’inverso della matrice di istanza', () => {
    // yaw = 90°: un colpo verso -Z del mondo arriva da +X locale
    const local = localHitDirection(Math.PI / 2, 0, -1);
    expect(local.x).toBeCloseTo(1, 6);
    expect(local.z).toBeCloseTo(0, 6);
  });

  it('è l’inverso esatto della rotazione usata per piazzare le istanze', () => {
    const yaw = 0.83;
    const local = localHitDirection(yaw, 0.6, -0.8);
    // x' = x·cos + z·sin, z' = -x·sin + z·cos (three, rotazione su Y)
    const worldX = local.x * Math.cos(yaw) + local.z * Math.sin(yaw);
    const worldZ = -local.x * Math.sin(yaw) + local.z * Math.cos(yaw);
    expect(worldX).toBeCloseTo(0.6, 6);
    expect(worldZ).toBeCloseTo(-0.8, 6);
  });
});

describe('WorldHitField', () => {
  it('scrive forza e verso sull’istanza colpita', () => {
    const hits = new WorldHitField();
    const trees = part(0, 2);
    hits.register('tree', [spot(5, 5, 0, 0), spot(40, 40, 0, 0)], [trees]);

    const role = hits.hit({ x: 5.3, z: 5.1, dx: 0, dz: -1, strength: 0.7, tag: 'world-tree' });
    expect(role).toBe('tree');
    expect(hits.count).toBe(1);

    const data = trees.attribute.array as Float32Array;
    expect(data[1]).toBeCloseTo(0.7, 6);
    expect(data[2]).toBeCloseTo(0, 6);
    expect(data[3]).toBeCloseTo(-1, 6);
    expect(trees.attribute.needsUpdate).toBe(true);
    // la seconda istanza è rimasta ferma
    expect(data[5]).toBe(0);
  });

  it('sceglie l’albero più vicino al punto d’urto, non il primo', () => {
    const hits = new WorldHitField();
    const trees = part(0, 3);
    hits.register('tree', [spot(0, 0, 0, 0), spot(12, 0, 0, 0), spot(2.5, 0, 0, 0)], [trees]);
    hits.hit({ x: 2.4, z: 0.2, dx: 1, dz: 0, strength: 1, tag: 'world-tree' });
    const data = trees.attribute.array as Float32Array;
    expect(data[9]).toBeCloseTo(1, 6);
    expect(data[1]).toBe(0);
    expect(data[5]).toBe(0);
  });

  it('rispetta le varianti: ogni mesh ha i propri indici', () => {
    const hits = new WorldHitField();
    const first = part(0, 2);
    const second = part(1, 1);
    hits.register('tree', [spot(0, 0, 0, 0), spot(1, 0, 0, 0), spot(2, 0, 0, 1)], [first, second]);

    hits.hit({ x: 2.1, z: 0, dx: 1, dz: 0, strength: 1, tag: 'world-tree' });
    expect((second.attribute.array as Float32Array)[1]).toBeCloseTo(1, 6);
    expect(first.attribute.needsUpdate).toBe(false);
  });

  it('ignora gli ostacoli rigidi e quelli fuori portata', () => {
    const hits = new WorldHitField();
    hits.register('tree', [spot(0, 0, 0, 0)], [part(0, 1)]);
    expect(hits.hit({ x: 0, z: 0, dx: 1, dz: 0, strength: 1, tag: 'world-rock' })).toBeNull();
    expect(hits.hit({ x: 0, z: 0, dx: 1, dz: 0, strength: 1, tag: 'world-house' })).toBeNull();
    expect(hits.hit({ x: 20, z: 0, dx: 1, dz: 0, strength: 1, tag: 'world-tree' })).toBeNull();
    expect(hits.count).toBe(0);
  });

  it('fa piegare anche il cespuglio attraversato, pur senza collisione', () => {
    const hits = new WorldHitField();
    const shrubs = part(0, 2);
    hits.register('shrub', [spot(0, 0, 0, 0), spot(6, 0, 0, 0)], [shrubs]);
    const role = hits.hit({ x: 0.4, z: 0.2, dx: 0, dz: 1, strength: 0.6, tag: 'world-shrub' });
    expect(role).toBe('shrub');
    expect((shrubs.attribute.array as Float32Array)[1]).toBeCloseTo(0.6, 6);
  });

  it('non fa nulla a forza zero (urti a passo d’uomo)', () => {
    const hits = new WorldHitField();
    hits.register('sign', [spot(0, 0, 0, 0)], [part(0, 1)]);
    expect(hits.hit({ x: 0, z: 0, dx: 0, dz: 1, strength: 0, tag: 'sign' })).toBeNull();
  });
});

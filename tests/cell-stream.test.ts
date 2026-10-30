import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  BAND_HYSTERESIS,
  DETAIL_BANDS,
  SlotRuns,
  StreamedCells,
  bandForDistance,
  cellKeyOf,
  cellSeed,
  type CellBuilder,
  type CellLayer,
} from '../src/world/cell-stream';

const CELL = 10;
const RADIUS = 25;

/** Una mesh finta con la stessa superficie che usa `StreamedCells`. */
function makeLayer(capacity = 4000, maxPerCell = 40): CellLayer {
  const mesh = new THREE.InstancedMesh(
    new THREE.BufferGeometry(),
    new THREE.MeshBasicMaterial(),
    capacity,
  );
  mesh.setColorAt(0, new THREE.Color(0xffffff));
  return { mesh, maxPerCell, colored: true };
}

/** Costruttore deterministico: 12 istanze dentro la cella, in posizioni stabili. */
function makeBuilder(log: { cx: number; cz: number; band: number }[] = []): CellBuilder {
  return (cx, cz, band, writer) => {
    log.push({ cx, cz, band });
    writer.begin(0);
    for (let i = 0; i < 12; i++) {
      const ox = cx * CELL + 0.5 + (i % 4) * 0.9;
      const oz = cz * CELL + 0.5 + Math.floor(i / 4) * 0.7;
      writer.add(ox, 0, oz, 0, 1, 1, 1);
      writer.rgb(1, 1, 1);
    }
  };
}

/** Istanze davvero scritte (matrice non nulla): posizione x/z e cella di origine. */
function placed(mesh: THREE.InstancedMesh): { x: number; z: number; cx: number; cz: number }[] {
  const array = mesh.instanceMatrix.array as Float32Array;
  const out: { x: number; z: number; cx: number; cz: number }[] = [];
  for (let i = 0; i < mesh.instanceMatrix.count; i++) {
    const o = i * 16;
    if (array[o + 15] === 0) continue;
    const x = array[o + 12]!;
    const z = array[o + 14]!;
    out.push({ x, z, cx: Math.floor(x / CELL), cz: Math.floor(z / CELL) });
  }
  return out;
}

function stream(builder: CellBuilder, layer: CellLayer, budgetMs = 1000): StreamedCells {
  return new StreamedCells([layer], builder, {
    cellSize: CELL,
    radius: RADIUS,
    // uscita esattamente sul raggio: il test può prevedere il disco vivo
    keepRadius: RADIUS,
    budgetMs,
    maxCellsPerFrame: 500,
    seed: 1234,
  });
}

/** Celle la cui cella centrale sta dentro il raggio. */
function expectedCells(x: number, z: number): number {
  let count = 0;
  for (let cz = Math.floor((z - RADIUS) / CELL); cz <= Math.floor((z + RADIUS) / CELL); cz++) {
    for (let cx = Math.floor((x - RADIUS) / CELL); cx <= Math.floor((x + RADIUS) / CELL); cx++) {
      const centreX = (cx + 0.5) * CELL;
      const centreZ = (cz + 0.5) * CELL;
      if (Math.hypot(centreX - x, centreZ - z) <= RADIUS) count++;
    }
  }
  return count;
}

describe('fascia di dettaglio', () => {
  it('separa le quattro fasce ai confini dichiarati', () => {
    expect(DETAIL_BANDS).toEqual([30, 60, 95]);
    expect(bandForDistance(0)).toBe(0);
    expect(bandForDistance(29.999)).toBe(0);
    expect(bandForDistance(30)).toBe(1);
    expect(bandForDistance(59.999)).toBe(1);
    expect(bandForDistance(60)).toBe(2);
    expect(bandForDistance(94.999)).toBe(2);
    expect(bandForDistance(95)).toBe(3);
    expect(bandForDistance(400)).toBe(3);
  });

  it('tiene l’isteresi più stretta della fascia', () => {
    expect(BAND_HYSTERESIS).toBeGreaterThan(0);
    expect(BAND_HYSTERESIS).toBeLessThan(DETAIL_BANDS[0]!);
  });
});

describe('seme e chiave della cella', () => {
  it('è deterministico e indipendente dall’ordine di creazione', () => {
    expect(cellSeed(12, -34, 2, 0x9a55)).toBe(cellSeed(12, -34, 2, 0x9a55));
    expect(cellSeed(12, -34, 2, 0x9a55)).not.toBe(cellSeed(12, -34, 1, 0x9a55));
    expect(cellSeed(12, -34, 2, 0x9a55)).not.toBe(cellSeed(13, -34, 2, 0x9a55));
    expect(cellSeed(12, -34, 2, 0x9a55)).not.toBe(cellSeed(12, -34, 2, 0x9a56));
  });

  it('resta un intero senza segno anche a coordinate negative', () => {
    for (const [cx, cz] of [
      [-1, -1],
      [-32768, 32767],
      [0, 0],
      [12345, -54321],
    ]) {
      const seed = cellSeed(cx!, cz!, 3, 7);
      expect(Number.isInteger(seed)).toBe(true);
      expect(seed).toBeGreaterThanOrEqual(0);
      expect(seed).toBeLessThanOrEqual(0xffffffff);
    }
  });

  it('dà una chiave diversa a ogni cella del vicinato', () => {
    const keys = new Set<number>();
    for (let cx = -20; cx <= 20; cx++) {
      for (let cz = -20; cz <= 20; cz++) keys.add(cellKeyOf(cx, cz));
    }
    expect(keys.size).toBe(41 * 41);
    expect(cellKeyOf(-1, 5)).not.toBe(cellKeyOf(5, -1));
  });
});

describe('SlotRuns', () => {
  it('assegna run contigui e allineati', () => {
    const pool = new SlotRuns(1000);
    const a = pool.acquire(30)!;
    const b = pool.acquire(18)!;
    expect(a).toEqual({ start: 0, count: 32 });
    expect(b).toEqual({ start: 32, count: 24 });
    expect(pool.highWater).toBe(56);
    expect(pool.freeSlots()).toBe(1000 - 56);
  });

  it('non sovrappone mai due prenotazioni', () => {
    const pool = new SlotRuns(512);
    const used = new Uint8Array(512);
    for (let i = 0; i < 40; i++) {
      const run = pool.acquire(1 + ((i * 7) % 23));
      if (!run) break;
      for (let s = run.start; s < run.start + run.count; s++) {
        expect(used[s]).toBe(0);
        used[s] = 1;
      }
    }
    // ciò che è prenotato e ciò che è libero devono sommare alla capacità
    let taken = 0;
    for (const value of used) taken += value;
    expect(taken + pool.freeSlots()).toBe(512);
  });

  it('fonde i run alla liberazione e riporta giù highWater', () => {
    const pool = new SlotRuns(300);
    const a = pool.acquire(40)!;
    const b = pool.acquire(40)!;
    const c = pool.acquire(40)!;
    pool.release(b.start, b.count);
    pool.release(a.start, a.count);
    pool.release(c.start, c.count);
    expect(pool.freeSlots()).toBe(300);
    expect(pool.highWater).toBe(0);
    // il pool torna utilizzabile per intero (300 non è multiplo di 8)
    expect(pool.acquire(296)).toEqual({ start: 0, count: 296 });
    expect(pool.freeSlots()).toBe(4);
  });

  it('rifiuta una prenotazione più grande dello spazio residuo', () => {
    const pool = new SlotRuns(64);
    expect(pool.acquire(48)).toEqual({ start: 0, count: 48 });
    expect(pool.acquire(24)).toBeNull();
    expect(pool.acquire(0)).toBeNull();
  });
});

describe('StreamedCells', () => {
  it('popola il disco e non esce dal raggio', () => {
    const layer = makeLayer();
    const field = stream(makeBuilder(), layer);
    field.update(0, 0, 0, 0, 1);

    const instances = placed(layer.mesh);
    expect(instances.length).toBeGreaterThan(0);
    expect(field.metrics.cells).toBe(expectedCells(0, 0));
    expect(instances.length).toBe(field.metrics.cells * 12);
    for (const instance of instances) {
      const centreX = (instance.cx + 0.5) * CELL;
      const centreZ = (instance.cz + 0.5) * CELL;
      expect(Math.hypot(centreX, centreZ)).toBeLessThanOrEqual(RADIUS);
      expect(instance.x).toBeGreaterThanOrEqual(instance.cx * CELL);
      expect(instance.x).toBeLessThan((instance.cx + 1) * CELL);
    }
  });

  it('è deterministico a parità di seme e di spostamenti', () => {
    const run = () => {
      const layer = makeLayer();
      const log: { cx: number; cz: number; band: number }[] = [];
      const field = stream(makeBuilder(log), layer);
      for (let i = 0; i < 30; i++) field.update(i * 1.7, i * -2.3, 0, 0, 1);
      return { positions: placed(layer.mesh), log, cells: field.metrics.cells };
    };
    const a = run();
    const b = run();
    expect(a.cells).toBe(b.cells);
    expect(a.log).toEqual(b.log);
    expect(a.positions).toEqual(b.positions);
  });

  it('costruisce prima le celle verso il punto previsto', () => {
    const layer = makeLayer();
    const log: { cx: number; cz: number; band: number }[] = [];
    const field = stream(makeBuilder(log), layer, 1000);
    field.update(0, 0, 0, -100, 0.016);
    expect(log.length).toBeGreaterThan(0);
    // il primo costruito deve essere il più vicino al punto previsto (0, -100)
    // fra le celle che stanno davvero nel raggio
    let best = Infinity;
    for (let cz = Math.floor(-RADIUS / CELL); cz <= Math.floor(RADIUS / CELL); cz++) {
      for (let cx = Math.floor(-RADIUS / CELL); cx <= Math.floor(RADIUS / CELL); cx++) {
        const centreX = (cx + 0.5) * CELL;
        const centreZ = (cz + 0.5) * CELL;
        if (Math.hypot(centreX, centreZ) > RADIUS) continue;
        const distance = Math.hypot(centreX, centreZ + 100);
        if (distance < best) best = distance;
      }
    }
    const first = log[0]!;
    expect(Math.hypot((first.cx + 0.5) * CELL, (first.cz + 0.5) * CELL + 100)).toBeCloseTo(best, 6);
  });

  it('entra ed esce senza duplicare o perdere istanze', () => {
    const layer = makeLayer();
    const field = stream(makeBuilder(), layer);
    let x = 0;
    let z = 0;
    for (let step = 0; step < 40; step++) {
      field.update(x, z, 0, 0, 1);
      const instances = placed(layer.mesh);
      // nessuna posizione ripetuta: gli slot vecchi sono stati davvero liberati
      const unique = new Set(instances.map((p) => `${p.x.toFixed(3)},${p.z.toFixed(3)}`));
      expect(unique.size).toBe(instances.length);
      // nessuna cella persa: il numero di istanze è quello delle celle attese
      expect(instances.length).toBe(expectedCells(x, z) * 12);
      for (const instance of instances) {
        const dx = (instance.cx + 0.5) * CELL - x;
        const dz = (instance.cz + 0.5) * CELL - z;
        expect(Math.hypot(dx, dz)).toBeLessThanOrEqual(RADIUS);
      }
      x += CELL * 0.6;
      z += CELL * 0.35;
    }
  });

  it('dissolve in entrata e in uscita invece di comparire di colpo', () => {
    const layer = makeLayer();
    const field = stream(makeBuilder(), layer);
    const fade = layer.mesh.geometry.getAttribute('aFade') as THREE.InstancedBufferAttribute;

    field.update(0, 0, 0, 0, 0.016);
    const firstFrame = (fade.array as Float32Array).slice(0, layer.mesh.instanceMatrix.count);
    // appena nate le celle non sono ancora piene
    expect(Math.max(...firstFrame)).toBeLessThan(1);

    // dopo un secondo la dissolvenza è finita
    field.update(0, 0, 0, 0, 1);
    const settled = (fade.array as Float32Array).slice(0, layer.mesh.instanceMatrix.count);
    expect(Math.max(...settled)).toBeCloseTo(1, 4);

    // allontanandosi le celle vecchie restano in dissolvenza e le nuove
    // cominciano a comparire: non c'è un salto netto da un fotogramma all'altro
    const before = placed(layer.mesh).length;
    field.update(500, 0, 0, 0, 0.05);
    expect(placed(layer.mesh).length).toBeGreaterThan(before);

    field.update(500, 0, 0, 0, 2);
    expect(placed(layer.mesh).length).toBe(expectedCells(500, 0) * 12);
  });

  it('libera tutti gli slot quando ci si allontana', () => {
    const layer = makeLayer();
    const field = stream(makeBuilder(), layer);
    field.update(0, 0, 0, 0, 1);
    expect(field.metrics.instances).toBeGreaterThan(0);

    field.update(1000, 0, 0, 0, 2);
    const live = placed(layer.mesh);
    for (const instance of live) {
      const centreX = (instance.cx + 0.5) * CELL;
      expect(Math.hypot(centreX - 1000, (instance.cz + 0.5) * CELL)).toBeLessThanOrEqual(RADIUS);
    }
    expect(field.metrics.instances).toBe(live.length);
  });

  it('tiene in memoria le celle vuote invece di rifarle', () => {
    const layer = makeLayer();
    let calls = 0;
    const field = new StreamedCells(
      [layer],
      (_cx, _cz, _band, writer) => {
        calls++;
        writer.begin(0);
      },
      {
        cellSize: CELL,
        radius: RADIUS,
        keepRadius: RADIUS,
        budgetMs: 1000,
        maxCellsPerFrame: 500,
        seed: 9,
      },
    );
    field.update(0, 0, 0, 0, 1);
    const built = calls;
    expect(built).toBe(expectedCells(0, 0));
    expect(field.metrics.instances).toBe(0);
    expect(field.metrics.cells).toBe(built);

    // abbassare la densità non fa rifare una cella che non ha contenuto
    field.setDensity(0.4);
    field.update(0, 0, 0, 0, 1);
    expect(calls).toBe(built);
  });

  it('cambia densità rifacendo le celle esistenti', () => {
    const layer = makeLayer();
    const log: { cx: number; cz: number; band: number }[] = [];
    const field = stream(makeBuilder(log), layer);
    field.update(0, 0, 0, 0, 1);
    const built = log.length;
    expect(built).toBeGreaterThan(0);

    field.setDensity(0.4);
    field.update(0, 0, 0, 0, 1);
    // tutte le celle vive vengono rimesse in coda (una volta sola)
    expect(log.length).toBeGreaterThan(built);
    expect(field.metrics.instances).toBe(expectedCells(0, 0) * 12);
  });
});

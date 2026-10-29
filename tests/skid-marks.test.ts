import { describe, expect, it } from 'vitest';
import { SkidMarks } from '../src/entities/skid-marks';

describe('tracce di pneumatico persistenti', () => {
  it('mantiene i segmenti nel mondo e li esporta per chunk', () => {
    const source = new SkidMarks();
    source.setBudget(10);
    source.add(20, 30, 0.2, 4, 0x292a28, 0.8, 120, 0.24);
    source.add(940, 30, 0, 4, 0x292a28, 0.8, 120, 0.24);
    const packed = source.serializeChunk('0:0');
    expect(packed.length).toBe(7);
    const restored = new SkidMarks();
    restored.setBudget(10);
    restored.restoreChunk('0:0', packed);
    expect(restored.serializeChunk('0:0')).toEqual(packed);
    source.update(60);
    expect(source.serializeChunk('0:0')[4]).toBe(60);
  });

  it('rispetta il budget del preset e il preset minimo può spegnerle', () => {
    const marks = new SkidMarks();
    marks.setBudget(1);
    marks.add(1, 1, 0, 0);
    marks.add(2, 2, 0, 0);
    expect(marks.serializeChunk('0:0').length).toBe(7);
    marks.setBudget(0);
    marks.add(3, 3, 0, 0);
    expect(marks.renderedCount).toBe(0);
    expect(marks.serializeChunk('0:0').length).toBe(7);
  });

  it('concatena i segmenti in un nastro continuo senza buchi', () => {
    const marks = new SkidMarks();
    marks.setBudget(10);
    marks.addRibbon(0, 0, 3, 0, 0.1);
    marks.addRibbon(3, 0, 6, 0, 0.1);
    const segments = marks.chunkSegments('0:0');
    expect(segments).toHaveLength(2);
    expect(segments[0]!.length).toBeCloseTo(3, 6);
    expect(segments[1]!.length).toBeCloseTo(3, 6);
    const endOfFirst = {
      x: segments[0]!.x + Math.sin(segments[0]!.yaw) * segments[0]!.length * 0.5,
      z: segments[0]!.z + Math.cos(segments[0]!.yaw) * segments[0]!.length * 0.5,
    };
    const startOfSecond = {
      x: segments[1]!.x - Math.sin(segments[1]!.yaw) * segments[1]!.length * 0.5,
      z: segments[1]!.z - Math.cos(segments[1]!.yaw) * segments[1]!.length * 0.5,
    };
    expect(endOfFirst.x).toBeCloseTo(startOfSecond.x, 6);
    expect(endOfFirst.z).toBeCloseTo(startOfSecond.z, 6);
  });

  it('salva i chunk su storage e li ricarica dopo un riavvio', () => {
    const store = memoryStorage();
    const first = new SkidMarks(store);
    first.setBudget(10);
    first.add(20, 30, 0.2, 4, 0x292a28, 0.8, 120, 0.24);
    expect(first.save()).toBe(true);
    expect(store.getItem('molise.skid-marks')).not.toBeNull();

    // una nuova istanza simula il riavvio del gioco: i dati devono tornare
    const restarted = new SkidMarks(store);
    restarted.setBudget(10);
    restarted.streamAround(20, 30);
    expect(restarted.serializeChunk('0:0').length).toBe(7);
    restarted.clear();
    expect(store.getItem('molise.skid-marks')).toBeNull();
  });
});

describe('nastri dopo un riavvio', () => {
  it('conserva lunghezza e direzione dei segmenti, non solo la posizione', () => {
    const store = memoryStorage();
    const first = new SkidMarks(store);
    first.setBudget(10);
    first.addRibbon(0, 0, 3, 0, 0.1);
    first.addRibbon(3, 0, 6, 0, 0.1);
    expect(first.save()).toBe(true);
    const restarted = new SkidMarks(store);
    restarted.setBudget(10);
    restarted.streamAround(1, 0);
    const segments = restarted.chunkSegments('0:0');
    expect(segments).toHaveLength(2);
    expect(segments[0]!.length).toBeCloseTo(3, 6);
    expect(segments[1]!.length).toBeCloseTo(3, 6);
    expect(segments[0]!.yaw).toBeCloseTo(Math.PI / 2, 6);
  });
});

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string): string | null => values.get(key) ?? null,
    setItem: (key: string, value: string): void => {
      values.set(key, value);
    },
    removeItem: (key: string): void => {
      values.delete(key);
    },
  };
}

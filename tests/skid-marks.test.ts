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
});

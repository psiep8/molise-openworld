import { describe, expect, it } from 'vitest';
import { syncStridePhase } from '../src/entities/human-model';

/**
 * Camminata e corsa sono clip di durata diversa: il blend deve tenere i piedi
 * alla stessa frazione di falcata, altrimenti durante il passaggio il pedone
 * "scatta". La funzione lavora solo sui tempi, quindi si prova senza WebGL.
 */
describe('sincronizzazione del passo', () => {
  it('porta la seconda clip alla stessa frazione di falcata della prima', () => {
    // camminata a metà falcata (1 s su 2 s), corsa di 0,8 s: deve andare a 0,4 s
    expect(syncStridePhase(0.8, 1, 2)).toBeCloseTo(0.4, 5);
    // camminata a un quarto, corsa di 1 s: 0,25 s
    expect(syncStridePhase(1, 0.5, 2)).toBeCloseTo(0.25, 5);
  });

  it('funziona anche quando la clip sorgente ha già superato il proprio giro', () => {
    expect(syncStridePhase(2, 5.5, 2)).toBeCloseTo(1.5, 5);
    expect(syncStridePhase(2, 4, 2)).toBeCloseTo(0, 5);
  });

  it('non tocca niente se le durate non sono valide', () => {
    expect(syncStridePhase(0, 1, 2)).toBeNull();
    expect(syncStridePhase(1, 1, 0)).toBeNull();
    expect(syncStridePhase(1, Number.NaN, 2)).toBeNull();
  });

  it('le due clip restano allineate mentre i pesi si scambiano', () => {
    const walkDuration = 1.2;
    const runDuration = 0.75;
    let walk = 0.3;
    let run = 0;
    for (let i = 0; i < 40; i++) {
      // le due clip avanzano a ritmi diversi (durate diverse)…
      walk += 1 / 60;
      run += 1 / 55;
      // …e a ogni frame la corsa viene riallineata alla camminata, come in
      // `HumanBody.update`: senza, in un secondo le fasi sarebbero sfasate
      run = syncStridePhase(runDuration, walk, walkDuration) ?? run;
      const walkPhase = (walk % walkDuration) / walkDuration;
      const runPhase = (run % runDuration) / runDuration;
      expect(Math.abs(walkPhase - runPhase)).toBeLessThan(1e-9);
    }
  });
});

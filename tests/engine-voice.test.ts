import { describe, expect, it } from 'vitest';
import { engineLoad, engineVoice, firingHz } from '../src/audio/audio';
import { VEHICLES } from '../src/sim/vehicle-catalog';

const voiceOf = (id: string) => {
  const spec = VEHICLES.find((v) => v.id === id);
  if (!spec) throw new Error(`veicolo mancante: ${id}`);
  return engineVoice(spec);
};

describe('engineVoice', () => {
  it('legge i cilindri dalla sigla del motore', () => {
    expect(voiceOf('lamborghini-revuelto').cylinders).toBe(12);
    expect(voiceOf('audi-novulari').cylinders).toBe(8);
    expect(voiceOf('audi-r8-2010').cylinders).toBe(10);
    expect(voiceOf('land-rover-defender').cylinders).toBe(6);
  });

  it('non confonde le valvole con i cilindri (8V = 4 cilindri)', () => {
    // il Punto è un 1.2 Fire 8V: la "V" è il numero di valvole, non la bancata
    expect(voiceOf('fiat-punto-2011').cylinders).toBe(4);
    expect(voiceOf('cupra-terramar').cylinders).toBe(4);
  });

  it('peso e regimi restano nei limiti utili al sintetizzatore', () => {
    for (const spec of VEHICLES) {
      const voice = engineVoice(spec);
      expect(voice.cylinders).toBeGreaterThanOrEqual(1);
      expect(voice.cylinders).toBeLessThanOrEqual(16);
      expect(voice.weight).toBeGreaterThanOrEqual(0.2);
      expect(voice.weight).toBeLessThanOrEqual(1);
      expect(voice.idleRpm).toBeGreaterThanOrEqual(500);
      expect(voice.redlineRpm).toBeGreaterThan(voice.idleRpm);
    }
  });

  it('un V12 ha una frequenza di accensione più alta di un quattro cilindri', () => {
    const v12 = voiceOf('lamborghini-revuelto');
    const four = voiceOf('fiat-punto-2011');
    const firing = (v: ReturnType<typeof engineVoice>) => firingHz(v.idleRpm, v.cylinders);
    expect(firing(v12)).toBeGreaterThan(firing(four));
  });

  it('il carico segue il gas, non solo i giri', () => {
    expect(engineLoad(0, 800, 800, 6500)).toBe(0);
    const part = engineLoad(0.3, 3500, 800, 6500);
    const full = engineLoad(1, 3500, 800, 6500);
    expect(part).toBeGreaterThan(0);
    expect(full).toBeGreaterThan(part);
    // in rilascio a giri alti resta un filo di overrun, ma molto meno del gas
    const overrun = engineLoad(0, 5000, 800, 6500);
    expect(overrun).toBeGreaterThan(0);
    expect(overrun).toBeLessThan(part);
  });

  it('la frequenza di accensione è quella fisica', () => {
    // 6000 giri/min su un V12 = 100 giri/s × 6 accensioni = 600 Hz
    expect(firingHz(6000, 12)).toBeCloseTo(600, 6);
    // un 4 cilindri a 3000 giri batte 100 volte al secondo
    expect(firingHz(3000, 4)).toBeCloseTo(100, 6);
  });
});

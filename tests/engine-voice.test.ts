import { describe, expect, it } from 'vitest';
import { engineVoice } from '../src/audio/audio';
import { VEHICLES } from '../src/sim/vehicle-catalog';

const voiceOf = (id: string) => {
  const spec = VEHICLES.find((v) => v.id === id);
  if (!spec) throw new Error(`veicolo mancante: ${id}`);
  return engineVoice(spec);
};

describe('engineVoice', () => {
  it('legge i cilindri dalla sigla del motore', () => {
    expect(voiceOf('lamborghini-aventador').cylinders).toBe(12);
    expect(voiceOf('ferrari-458').cylinders).toBe(8);
    expect(voiceOf('audi-r8').cylinders).toBe(10);
    expect(voiceOf('land-rover-defender').cylinders).toBe(6);
  });

  it('non confonde le valvole con i cilindri (8V = 4 cilindri)', () => {
    // il Punto è un 1.2 Fire 8V: la "V" è il numero di valvole, non la bancata
    expect(voiceOf('punto').cylinders).toBe(4);
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
    const v12 = voiceOf('lamborghini-aventador');
    const four = voiceOf('punto');
    const firing = (v: ReturnType<typeof engineVoice>) => (v.idleRpm / 60) * (v.cylinders / 2);
    expect(firing(v12)).toBeGreaterThan(firing(four));
  });
});

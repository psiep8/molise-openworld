import { describe, expect, it } from 'vitest';
import { medianWaterLevel } from '../src/world/roads';

describe('livello degli specchi d’acqua', () => {
  it('usa la mediana per non far galleggiare i laghi su picchi isolati del DEM', () => {
    expect(medianWaterLevel([100, 101, 125, 102, 99])).toBe(101);
  });

  it('media i due valori centrali quando il numero di quote è pari', () => {
    expect(medianWaterLevel([98, 102, 100, 104])).toBe(101);
  });

  it('rifiuta quote vuote o non finite', () => {
    expect(() => medianWaterLevel([])).toThrow(RangeError);
    expect(() => medianWaterLevel([100, Number.NaN])).toThrow(RangeError);
  });
});

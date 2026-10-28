import { describe, expect, it } from 'vitest';
import { createOpenImageryProvider, zoomForDistance } from '../src/world/imagery';

describe('zoomForDistance', () => {
  it('usa z18 vicino al giocatore, dove campi e tennis devono leggersi', () => {
    expect(zoomForDistance(0)).toBe(18);
    expect(zoomForDistance(500)).toBe(18);
  });

  describe('createOpenImageryProvider', () => {
    it('usa la sorgente locale aperta senza configurazione remota', () => {
      const provider = createOpenImageryProvider(undefined, undefined);
      expect(provider.id).toBe('local-open-imagery');
      expect(provider.attribution).toContain('CC BY 4.0');
      expect(provider.url(16, 2, 3)).toContain('empty-imagery.svg');
    });

    it('espande i segnaposto del provider remoto configurato', () => {
      const provider = createOpenImageryProvider(
        'https://tiles.example/{z}/{x}/{y}.png',
        'Dati aperti con attribuzione',
      );
      expect(provider.url(16, 123, 456)).toBe('https://tiles.example/16/123/456.png');
    });

    it('richiede attribuzione e coordinate XYZ al provider remoto', () => {
      expect(() => createOpenImageryProvider('https://tiles.example/{z}/{x}/{y}.png', undefined)).toThrow(
        'VITE_OPEN_IMAGERY_ATTRIBUTION',
      );
      expect(() => createOpenImageryProvider('https://tiles.example/{z}/{x}.png', 'Attribuzione')).toThrow(
        'segnaposto',
      );
    });
  });

  it('scende a z17 a media distanza e a z16 oltre', () => {
    expect(zoomForDistance(501)).toBe(17);
    expect(zoomForDistance(3200)).toBe(17);
    expect(zoomForDistance(3201)).toBe(16);
  });
});

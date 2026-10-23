import { describe, expect, it } from 'vitest';
import { zoomForDistance } from '../src/world/imagery';

describe('zoomForDistance', () => {
  it('usa z18 vicino al giocatore, dove campi e tennis devono leggersi', () => {
    expect(zoomForDistance(0)).toBe(18);
    expect(zoomForDistance(500)).toBe(18);
  });

  it('scende a z17 a media distanza e a z16 oltre', () => {
    expect(zoomForDistance(501)).toBe(17);
    expect(zoomForDistance(3200)).toBe(17);
    expect(zoomForDistance(3201)).toBe(16);
  });
});

import { describe, expect, it } from 'vitest';
import { clusterByRadius, MINIMAP_MAX, MINIMAP_MIN, minimapMeters } from '../src/ui/map-scale';

describe('scala della minimappa', () => {
  it('a piedi guarda vicino: il paese si legge', () => {
    expect(minimapMeters('walk')).toBe(300);
    // correre non deve allargare la mappa: conta il mezzo, non la velocità
    expect(minimapMeters('walk', 8.6)).toBe(300);
  });

  it('in auto si apre con la velocità', () => {
    const ferma = minimapMeters('drive', 0);
    const cinquanta = minimapMeters('drive', 50 / 3.6);
    const cento = minimapMeters('drive', 100 / 3.6);
    expect(ferma).toBe(240);
    expect(cinquanta).toBeGreaterThan(ferma);
    expect(cento).toBeGreaterThan(cinquanta);
    expect(cento).toBeLessThan(780); // comunque più zoomato di prima
  });

  it('la scala è sempre dentro i limiti utili', () => {
    expect(minimapMeters('drive', 0, 0.1)).toBeGreaterThanOrEqual(MINIMAP_MIN * 0.45);
    expect(minimapMeters('drive', 500, 10)).toBeLessThanOrEqual(MINIMAP_MAX * 2.4);
  });

  it('la rotella moltiplica il valore automatico', () => {
    expect(minimapMeters('walk', 0, 0.5)).toBe(150);
    expect(minimapMeters('walk', 0, 2)).toBe(600);
    // il fattore è limitato: la mappa non può diventare inutilizzabile
    expect(minimapMeters('walk', 0, 99)).toBe(300 * 2.4);
    expect(minimapMeters('walk', 0, -5)).toBe(300 * 0.45);
  });

  it('la velocità negativa (retromarcia) conta come positiva', () => {
    expect(minimapMeters('drive', -10)).toBe(minimapMeters('drive', 10));
  });
});

describe('cluster dei POI sulla mappa grande', () => {
  it('fonde i simboli che si sovrappongono e lascia separati gli altri', () => {
    // tre attività di Palata entro pochi pixel + una lontana
    const groups = clusterByRadius(
      [
        { x: 100, y: 100 },
        { x: 106, y: 104 },
        { x: 112, y: 99 },
        { x: 900, y: 400 },
      ],
      22,
    );
    expect(groups).toHaveLength(2);
    expect(groups[0]).toEqual([0, 1, 2]);
    expect(groups[1]).toEqual([3]);
  });

  it('il capogruppo è il primo punto incontrato', () => {
    const groups = clusterByRadius(
      [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 60, y: 0 },
      ],
      15,
    );
    expect(groups).toEqual([[0, 1], [2]]);
  });

  it('ogni punto finisce in un solo gruppo', () => {
    const points = Array.from({ length: 40 }, (_, i) => ({ x: (i % 7) * 9, y: Math.floor(i / 7) * 9 }));
    const groups = clusterByRadius(points, 12);
    const seen = groups.flat();
    expect(seen).toHaveLength(points.length);
    expect(new Set(seen).size).toBe(points.length);
  });

  it('senza punti non inventa gruppi', () => {
    expect(clusterByRadius([], 22)).toEqual([]);
  });
});

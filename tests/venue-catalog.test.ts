import { describe, expect, it } from 'vitest';
import { START } from '../src/config';
import {
  VENUES,
  findNearestVenue,
  getCategories,
  getMenuItem,
  getVenue,
  venueStatusLabel,
} from '../src/sim/venue-catalog';

describe('catalogo attività di Palata', () => {
  it('ha ID univoci e tutte le piste di ricerca richieste', () => {
    const ids = VENUES.map((v) => v.id);
    expect(new Set(ids).size).toBe(ids.length);

    const names = VENUES.map((v) => v.name.toLowerCase());
    expect(names.some((n) => n.includes('vecchio frantoio'))).toBe(true);
    expect(names.some((n) => n.includes('s. michaelion'))).toBe(true);
    expect(names.some((n) => n.includes('bar el rancho'))).toBe(true);
    expect(names.some((n) => n.includes('coal'))).toBe(true);
    expect(names.some((n) => n.includes('ricciolotto'))).toBe(true);
    expect(names.some((n) => n.includes('persichillo'))).toBe(true);
    expect(names.some((n) => n.includes('banca'))).toBe(true);
  });

  it('colloca i marker vicino al centro di Palata', () => {
    for (const venue of VENUES) {
      const distance = Math.hypot(venue.x - START.x, venue.z - START.z);
      expect(distance).toBeLessThan(400);
    }
  });

  it('non dichiara verificato ciò che non è stato verificato', () => {
    for (const venue of VENUES) {
      expect(venue.status).not.toBe('verified');
      expect(venue.source.length).toBeGreaterThan(3);
      expect(venue.dateChecked).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(venue.note.length).toBeGreaterThan(20);
    }
  });

  it('dichiara chiaramente che i prezzi sono simulati e non usa prezzi reali', () => {
    for (const venue of VENUES) {
      expect(venue.pricesSimulated).toBe(true);
      for (const item of venue.menu) {
        expect(Number.isInteger(item.priceCents)).toBe(true);
        expect(item.priceCents).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('ogni attività acquistabile ha un menu coerente', () => {
    for (const venue of VENUES) {
      if (venue.interaction === 'atm') continue;
      expect(venue.menu.length).toBeGreaterThan(0);
      const ids = venue.menu.map((m) => m.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it('gli outfit in vendita corrispondono agli stili realmente implementati', () => {
    const shop = getVenue('ricciolotto-abbigliamento');
    expect(shop).toBeDefined();
    const outfits = shop?.menu.filter((m) => m.outfit).map((m) => m.outfit) ?? [];
    expect(outfits.length).toBeGreaterThanOrEqual(7);
    for (const outfit of outfits) {
      expect(['casual', 'elegante', 'formale', 'tuta', 'campagna', 'sportivo', 'hippie']).toContain(outfit);
    }
  });

  it('trova il luogo più vicino entro il raggio richiesto', () => {
    const venue = VENUES[0];
    const near = findNearestVenue(venue.x + 3, venue.z + 4, 20);
    expect(near?.id).toBe(venue.id);
    expect(findNearestVenue(venue.x + 5000, venue.z + 5000, 20)).toBeNull();
  });

  it('espone categorie e stato leggibile', () => {
    expect(getCategories().length).toBeGreaterThan(3);
    expect(venueStatusLabel('needs-review')).toBe('Da verificare');
    expect(venueStatusLabel('simulated')).toBe('Simulato');
    expect(venueStatusLabel('verified')).toBe('Verificato');
    const venue = VENUES[0];
    expect(getMenuItem(venue, venue.menu[0].id)?.id).toBe(venue.menu[0].id);
  });
});

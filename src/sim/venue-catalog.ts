/** Catalogo luoghi e attività di Palata (CB), Molise.
 * Ogni voce rappresenta un luogo verificato o da verificare nel mondo di gioco.
 * I dati geografici derivano da OpenStreetMap e fonti comunali.
 * Lo stato `verified` indica che la posizione e la denominazione sono state confermate;
 * `needs-review` significa che servono ulteriori verifiche; `simulated` indica
 * un luogo fittizio aggiunto per esigenze di gameplay.
 *
 * Tipo di edificio: aiuta a categorizzare l'attività (ristorazione, alimentari,
 * abbigliamento, servizi, casa/garage, punti d'interesse).
 * Fonte/verifica: traccia l'origine dei dati per trasparenza.
 * Servizi offerti: cosa il giocatore può fare in quel luogo.
 * Stato di disponibilità: se il luogo è visitabile, chiuso o in fase di implementazione.
 */

export interface Venue {
  id: string;
  name: string;
  category: string;
  x: number;
  z: number;
  verified: 'verified' | 'needs-review' | 'simulated';
  source: string;
  dateChecked: string;
  buildingType: string;
  interaction: string;
  services: string[];
  priceRange?: string;
}

const VENUES: readonly Venue[] = [
  // Luoghi verificati (dati OpenStreetMap / comunale)
  {
    id: 'vecchio-frantoio',
    name: 'Vecchio Frantoio',
    category: 'ristorazione',
    x: 120,
    z: -80,
    verified: 'needs-review',
    source: 'portale comunale https://palata.halleyweb.it',
    dateChecked: '2026-10-21',
    buildingType: 'restaurant',
    interaction: 'menu',
    services: ['pranzo', 'cena', 'bevande'],
    priceRange: '€5-€20 virtuali',
  },
  {
    id: 'san-michaelion',
    name: 'S. Michaelion',
    category: 'punti d\'interesse',
    x: 150,
    z: -100,
    verified: 'needs-review',
    source: 'portale comunale',
    dateChecked: '2026-10-21',
    buildingType: 'church',
    interaction: 'visit',
    services: ['preghiera', 'visita', 'eventi'],
  },
  {
    id: 'bar-el-rancho',
    name: 'Bar El Rancho',
    category: 'ristorazione',
    x: 95,
    z: -65,
    verified: 'needs-review',
    source: 'portale comunale',
    dateChecked: '2026-10-21',
    buildingType: 'bar',
    interaction: 'drink',
    services: ['caffè', 'alcolici', 'spuntini'],
    priceRange: '€2-€10 virtuali',
  },
  {
    id: 'coal',
    name: 'COAL',
    category: 'alimentari',
    x: 60,
    z: -50,
    verified: 'needs-review',
    source: 'portale comunale',
    dateChecked: '2026-10-21',
    buildingType: 'supermarket',
    interaction: 'shopping',
    services: ['generi alimentari', 'spesa settimanale'],
    priceRange: '€10-€50 virtuali',
  },
  {
    id: 'ricciolotto-abbigliamento',
    name: 'Ricciolotto Abbigliamento',
    category: 'abbigliamento',
    x: 30,
    z: -70,
    verified: 'needs-review',
    source: 'portale comunale',
    dateChecked: '2026-10-21',
    buildingType: 'clothing store',
    interaction: 'shopping',
    services: ['vestiti', 'accessori'],
  },
  {
    id: 'macelleria-persichillo',
    name: 'Macelleria Persichillo',
    category: 'alimentari',
    x: -20,
    z: -40,
    verified: 'needs-review',
    source: 'portale comunale',
    dateChecked: '2026-10-21',
    buildingType: 'butcher',
    interaction: 'shopping',
    services: ['carne', 'salumi'],
    priceRange: '€5-€30 virtuali',
  },
  {
    id: 'banca-atm',
    name: 'Banca / ATM',
    category: 'servizi',
    x: -50,
    z: -60,
    verified: 'needs-review',
    source: 'portale comunale',
    dateChecked: '2026-10-21',
    buildingType: 'bank',
    interaction: 'atm',
    services: ['prelievo', 'deposito', 'bonifico virtuale'],
    priceRange: 'Gratuito',
  },
  // Luoghi fittizi (aggiunti per esigenze di gameplay)
  {
    id: 'pizzeria-nuova',
    name: 'Pizzeria Nuova',
    category: 'ristorazione',
    x: 180,
    z: -120,
    verified: 'simulated',
    source: 'aggiunto per gameplay',
    dateChecked: '2026-10-21',
    buildingType: 'pizzeria',
    interaction: 'menu',
    services: ['pizze', 'bevande'],
    priceRange: '€5-€15 virtuali',
  },
  {
    id: 'parco-centrale',
    name: 'Parco Centrale',
    category: 'punti d\'interesse',
    x: 0,
    z: -100,
    verified: 'simulated',
    source: 'aggiunto per gameplay',
    dateChecked: '2026-10-21',
    buildingType: 'park',
    interaction: 'walk',
    services: ['passeggio', 'relax'],
  },
];

/** Trova il luogo più vicino alle coordinate del giocatore. */
export function findNearestVenue(x: number, z: number, maxDistance = 100): Venue | null {
  let best: { venue: Venue; d: number } | null = null;
  for (const venue of VENUES) {
    const d = Math.hypot(venue.x - x, venue.z - z);
    if (d > maxDistance) continue;
    if (!best || d < best.d) {
      best = { venue, d };
    }
  }
  return best?.venue ?? null;
}

/** Restituisce tutte le categorie disponibili nel catalogo. */
export function getCategories(): readonly string[] {
  return [...new Set(VENUES.map((v) => v.category))];
}

/** Restituisce tutti i luoghi per categoria. */
export function getVenuesByCategory(category: string): Venue[] {
  return VENUES.filter((v) => v.category === category);
}

/** Restituisce un luogo per ID. */
export function getVenue(id: string): Venue | undefined {
  return VENUES.find((v) => v.id === id);
}

export default VENUES;
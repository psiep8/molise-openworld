/**
 * Catalogo luoghi e attività di Palata (CB), Molise.
 *
 * Ogni voce è un dato usato dal gioco (marker sulla mappa, punto di
 * interazione, pannello attività e menu), non solo una lista nel README.
 *
 * Stato di verifica:
 * - `verified`: nome e posizione confermati da una fonte pubblica;
 * - `needs-review`: il nome è una pista di ricerca, la posizione nel gioco è
 *   approssimativa e va verificata sul campo;
 * - `simulated`: luogo o attività fittizia aggiunta per il gameplay.
 *
 * ATTENZIONE: nessuna di queste voci è oggi `verified`. Le coordinate sono
 * offset locali intorno al centro di Palata (START) e servono a collocare i
 * marker nel paese; non sono rilevamenti GPS. I prezzi dei menu sono inventati
 * per il gioco (`pricesSimulated: true`) e non sono prezzi reali delle attività.
 * Nessun ordine o pagamento reale viene inviato: il denaro è solo virtuale.
 */

import { START } from '../config';
import type { NeedEffect } from './needs';

export type VenueStatus = 'verified' | 'needs-review' | 'simulated';
export type VenueCategory =
  | 'ristorazione'
  | 'alimentari'
  | 'abbigliamento'
  | 'servizi'
  | 'casa'
  | "punti d'interesse";

export type VenueInteraction = 'menu' | 'drink' | 'shopping' | 'atm' | 'visit' | 'walk' | 'home';

export interface VenueMenuItem {
  id: string;
  label: string;
  priceCents: number;
  description: string;
  /** Effetto sui bisogni dopo l'acquisto. */
  needs?: NeedEffect;
  /** Outfit sbloccato/indossato (negozio di abbigliamento). */
  outfit?: string;
  /** Categoria del prodotto, usata nel registro transazioni. */
  product: string;
}

export interface Venue {
  id: string;
  name: string;
  category: VenueCategory;
  /** Posizione nel mondo in metri, relativa al centro di Palata. */
  x: number;
  z: number;
  status: VenueStatus;
  source: string;
  dateChecked: string;
  /** Nota esplicita su cosa è verificato e cosa no. */
  note: string;
  buildingType: string;
  interaction: VenueInteraction;
  services: string[];
  /** Menu di gioco; i prezzi sono sempre fittizi. */
  menu: readonly VenueMenuItem[];
  pricesSimulated: boolean;
  /** Colore del marker sulla mappa. */
  color: string;
  openHours: string;
}

const AT = (dx: number, dz: number): { x: number; z: number } => ({
  x: Math.round(START.x + dx),
  z: Math.round(START.z + dz),
});

const SOURCE_COMUNE = 'Portale comunale di Palata (esercizi commerciali) — https://palata.halleyweb.it';
const SOURCE_OSM = 'OpenStreetMap (ODbL) — posizione approssimativa intorno al centro di Palata';

/** Costruisce una voce con tutte le informazioni comuni già compilate. */
function venue(
  base: Omit<Venue, 'dateChecked' | 'pricesSimulated' | 'openHours'> &
    Partial<Pick<Venue, 'dateChecked' | 'pricesSimulated' | 'openHours'>>,
): Venue {
  return {
    dateChecked: '2026-10-21',
    pricesSimulated: true,
    openHours: '08:00–23:00 (orario di gioco, non quello reale)',
    ...base,
  };
}

export const VENUES: readonly Venue[] = [
  venue({
    id: 'vecchio-frantoio',
    name: 'Vecchio Frantoio',
    category: 'ristorazione',
    ...AT(-62, -38),
    status: 'needs-review',
    source: `${SOURCE_COMUNE}; ${SOURCE_OSM}`,
    note: 'Nome indicato come pista di ricerca. Indirizzo e coordinate non verificati: la posizione nel gioco è approssimativa. Menu e prezzi sono simulati.',
    buildingType: 'restaurant',
    interaction: 'menu',
    services: ['pranzo', 'cena', 'bevande'],
    color: '#ff8a5b',
    menu: [
      { id: 'bruschetta', label: 'Bruschetta al pomodoro', priceCents: 450, description: 'Pane, pomodoro e olio', needs: { nutrition: 12, fun: 4 }, product: 'antipasto' },
      { id: 'pasta', label: 'Pasta al pomodoro', priceCents: 800, description: 'Primo semplice della casa', needs: { nutrition: 30, fun: 6 }, product: 'primo' },
      { id: 'pizza', label: 'Pizza margherita', priceCents: 700, description: 'Pomodoro, mozzarella e basilico', needs: { nutrition: 34, fun: 8 }, product: 'pizza' },
      { id: 'grigliata', label: 'Grigliata mista', priceCents: 1400, description: 'Carne alla brace e contorno', needs: { nutrition: 46, fun: 10 }, product: 'secondo' },
      { id: 'acqua', label: 'Acqua 0,5 L', priceCents: 200, description: 'Bottiglia di acqua naturale', needs: { nutrition: 3 }, product: 'bevanda' },
      { id: 'vino', label: 'Vino della casa', priceCents: 400, description: 'Calice di vino rosso', needs: { fun: 10, energy: -4 }, product: 'bevanda' },
    ],
  }),
  venue({
    id: 'san-michaelion',
    name: 'S. Michaelion',
    category: "punti d'interesse",
    ...AT(18, -82),
    status: 'needs-review',
    source: SOURCE_COMUNE,
    note: 'Pista di ricerca del portale comunale. Denominazione e posizione da confermare; nel gioco è un punto di visita senza acquisti.',
    buildingType: 'church',
    interaction: 'visit',
    services: ['visita', 'eventi'],
    color: '#c9b27a',
    menu: [
      { id: 'visita', label: 'Visita al complesso', priceCents: 0, description: 'Passeggiata e momento di relax (gratuito)', needs: { fun: 9 }, product: 'visita' },
    ],
  }),
  venue({
    id: 'bar-el-rancho',
    name: 'Bar El Rancho',
    category: 'ristorazione',
    ...AT(-28, 34),
    status: 'needs-review',
    source: `${SOURCE_COMUNE}; ${SOURCE_OSM}`,
    note: 'Nome indicato come pista di ricerca. Posizione approssimativa, orari reali non verificati. Consumazioni simulate.',
    buildingType: 'bar',
    interaction: 'drink',
    services: ['caffè', 'spuntini', 'bevande'],
    color: '#ffb55b',
    openHours: '06:00–24:00 (orario di gioco)',
    menu: [
      { id: 'caffe', label: 'Caffè', priceCents: 120, description: 'Espresso al banco', needs: { energy: 12, fun: 3 }, product: 'caffè' },
      { id: 'cornetto', label: 'Cornetto', priceCents: 150, description: 'Cornetto semplice', needs: { nutrition: 14, fun: 2 }, product: 'colazione' },
      { id: 'panino', label: 'Panino', priceCents: 400, description: 'Panino con prosciutto e formaggio', needs: { nutrition: 26, fun: 4 }, product: 'panino' },
      { id: 'birra', label: 'Birra alla spina', priceCents: 350, description: 'Bicchiere di birra', needs: { fun: 10, energy: -3 }, product: 'bevanda' },
      { id: 'gelato', label: 'Gelato', priceCents: 300, description: 'Coppetta di gelato', needs: { nutrition: 10, fun: 12 }, product: 'dolce' },
    ],
  }),
  venue({
    id: 'coal',
    name: 'COAL (alimentari)',
    category: 'alimentari',
    ...AT(68, 22),
    status: 'needs-review',
    source: `${SOURCE_COMUNE}; ${SOURCE_OSM}`,
    note: 'Pista di ricerca. Insegna e posizione da verificare; la spesa è un menu simulato con prezzi fittizi.',
    buildingType: 'supermarket',
    interaction: 'shopping',
    services: ['generi alimentari', 'spesa'],
    color: '#8bd17c',
    menu: [
      { id: 'pane', label: 'Pane', priceCents: 200, description: 'Fila di pane fresco', needs: { nutrition: 12 }, product: 'pane' },
      { id: 'latte', label: 'Latte 1 L', priceCents: 160, description: 'Latte intero', needs: { nutrition: 8 }, product: 'latticini' },
      { id: 'pasta', label: 'Pasta 500 g', priceCents: 130, description: 'Pasta di semola', needs: { nutrition: 10 }, product: 'pasta' },
      { id: 'pomodori', label: 'Pomodori 1 kg', priceCents: 250, description: 'Ortaggi freschi', needs: { nutrition: 8, fun: 2 }, product: 'ortaggi' },
      { id: 'olio', label: 'Olio extravergine', priceCents: 600, description: 'Bottiglia da 750 ml', needs: { nutrition: 5, fun: 4 }, product: 'condimenti' },
      { id: 'spesa', label: 'Spesa completa', priceCents: 1800, description: 'Una settimana di generi di base', needs: { nutrition: 55, fun: 6 }, product: 'spesa' },
    ],
  }),
  venue({
    id: 'ricciolotto-abbigliamento',
    name: 'Ricciolotto Abbigliamento',
    category: 'abbigliamento',
    ...AT(-96, 12),
    status: 'needs-review',
    source: `${SOURCE_COMUNE}; ${SOURCE_OSM}`,
    note: 'Pista di ricerca. I capi sono stili procedurali generici, senza marchi reali; prezzi simulati.',
    buildingType: 'clothing store',
    interaction: 'shopping',
    services: ['vestiti', 'accessori', 'guardaroba'],
    color: '#c58bff',
    openHours: '09:00–20:00 (orario di gioco)',
    menu: [
      { id: 'outfit-casual', label: 'Outfit casual', priceCents: 2500, description: 'Felpa e jeans', needs: { fun: 12 }, outfit: 'casual', product: 'abbigliamento' },
      { id: 'outfit-elegante', label: 'Outfit elegante', priceCents: 6500, description: 'Blazer e pantaloni scuri', needs: { fun: 16 }, outfit: 'elegante', product: 'abbigliamento' },
      { id: 'outfit-formale', label: 'Outfit formale', priceCents: 9000, description: 'Abito scuro con cravatta', needs: { fun: 18 }, outfit: 'formale', product: 'abbigliamento' },
      { id: 'outfit-tuta', label: 'Tuta sportiva', priceCents: 3500, description: 'Tuta comoda con profili', needs: { fun: 10 }, outfit: 'tuta', product: 'abbigliamento' },
      { id: 'outfit-campagna', label: 'Outfit da campagna', priceCents: 3000, description: 'Giacca da lavoro e jeans', needs: { fun: 8 }, outfit: 'campagna', product: 'abbigliamento' },
      { id: 'outfit-sportivo', label: 'Outfit sportivo', priceCents: 2800, description: 'Maglia tecnica e cappellino', needs: { fun: 10 }, outfit: 'sportivo', product: 'abbigliamento' },
      { id: 'outfit-hippie', label: 'Outfit hippie', priceCents: 3200, description: 'Camicia a toni caldi e fascia', needs: { fun: 12 }, outfit: 'hippie', product: 'abbigliamento' },
    ],
  }),
  venue({
    id: 'macelleria-persichillo',
    name: 'Macelleria Persichillo',
    category: 'alimentari',
    ...AT(-14, -54),
    status: 'needs-review',
    source: `${SOURCE_COMUNE}; ${SOURCE_OSM}`,
    note: 'Pista di ricerca. Posizione approssimativa; tagli e prezzi sono simulati.',
    buildingType: 'butcher',
    interaction: 'shopping',
    services: ['carne', 'salumi'],
    color: '#e07878',
    menu: [
      { id: 'salsiccia', label: 'Salsiccia 500 g', priceCents: 600, description: 'Salsiccia fresca', needs: { nutrition: 22 }, product: 'carne' },
      { id: 'prosciutto', label: 'Prosciutto 200 g', priceCents: 800, description: 'Affettato misto', needs: { nutrition: 18, fun: 3 }, product: 'salumi' },
      { id: 'tagliata', label: 'Tagliata 400 g', priceCents: 1200, description: 'Carne da cuocere', needs: { nutrition: 38, fun: 5 }, product: 'carne' },
    ],
  }),
  venue({
    id: 'banca-atm',
    name: 'Banca / ATM virtuale',
    category: 'servizi',
    ...AT(104, -28),
    status: 'needs-review',
    source: `${SOURCE_COMUNE}; ${SOURCE_OSM}`,
    note: 'Presenza di uno sportello bancario da verificare. In gioco è un ATM SIMULATO: sposta solo euro virtuali tra contanti e conto virtuale. Nessun collegamento bancario reale.',
    buildingType: 'bank',
    interaction: 'atm',
    services: ['prelievo virtuale', 'versamento virtuale'],
    color: '#79b8ff',
    openHours: 'Sempre accessibile (simulazione)',
    menu: [],
  }),
  venue({
    id: 'pizzeria-nuova',
    name: 'Pizzeria Nuova',
    category: 'ristorazione',
    ...AT(148, -118),
    status: 'simulated',
    source: 'Aggiunto per il gameplay',
    note: 'ATTIVITÀ FITTIZIA: non corrisponde a un esercizio reale di Palata. Menu e prezzi sono inventati.',
    buildingType: 'pizzeria',
    interaction: 'menu',
    services: ['pizze', 'bevande'],
    color: '#ff6b9d',
    menu: [
      { id: 'pizza-margherita', label: 'Pizza margherita', priceCents: 650, description: 'Pomodoro, mozzarella, basilico', needs: { nutrition: 32, fun: 9 }, product: 'pizza' },
      { id: 'pizza-salsiccia', label: 'Pizza salsiccia e cipolla', priceCents: 850, description: 'Pomodoro, salsiccia, cipolla', needs: { nutrition: 38, fun: 10 }, product: 'pizza' },
      { id: 'birra', label: 'Birra', priceCents: 300, description: 'Bottiglia da 33 cl', needs: { fun: 8, energy: -2 }, product: 'bevanda' },
      { id: 'tiramisu', label: 'Tiramisù', priceCents: 400, description: 'Dolce della casa', needs: { nutrition: 12, fun: 12 }, product: 'dolce' },
    ],
  }),
  venue({
    id: 'parco-centrale',
    name: 'Parco Centrale',
    category: "punti d'interesse",
    ...AT(0, -142),
    status: 'simulated',
    source: 'Aggiunto per il gameplay',
    note: 'LUOGO FITTIZIO: area di relax inventata per il gioco, non un parco reale documentato.',
    buildingType: 'park',
    interaction: 'walk',
    services: ['passeggio', 'relax'],
    color: '#6fcf97',
    openHours: 'Sempre accessibile',
    menu: [
      { id: 'passeggiata', label: 'Passeggiata nel parco', priceCents: 0, description: 'Dieci minuti di relax (gratuito)', needs: { fun: 14, energy: 4 }, product: 'attività' },
    ],
  }),
];

/** Colore/etichetta per i marker della mappa. */
export const CATEGORY_LABEL: Record<VenueCategory, string> = {
  ristorazione: 'Ristorazione',
  alimentari: 'Alimentari',
  abbigliamento: 'Abbigliamento',
  servizi: 'Servizi',
  casa: 'Casa e garage',
  "punti d'interesse": "Punti d'interesse",
};

export const VENUE_CATEGORIES = Object.keys(CATEGORY_LABEL) as VenueCategory[];

/** Luogo più vicino al giocatore, entro `maxDistance` metri. */
export function findNearestVenue(x: number, z: number, maxDistance = 100): Venue | null {
  let best: { venue: Venue; d: number } | null = null;
  for (const venue of VENUES) {
    const d = Math.hypot(venue.x - x, venue.z - z);
    if (d > maxDistance) continue;
    if (!best || d < best.d) best = { venue, d };
  }
  return best?.venue ?? null;
}

export function getCategories(): readonly VenueCategory[] {
  return VENUE_CATEGORIES;
}

export function getVenuesByCategory(category: VenueCategory): Venue[] {
  return VENUES.filter((v) => v.category === category);
}

export function getVenue(id: string): Venue | undefined {
  return VENUES.find((v) => v.id === id);
}

export function getMenuItem(venue: Venue, itemId: string): VenueMenuItem | undefined {
  return venue.menu.find((m) => m.id === itemId);
}

export function venueStatusLabel(status: VenueStatus): string {
  if (status === 'verified') return 'Verificato';
  if (status === 'needs-review') return 'Da verificare';
  return 'Simulato';
}

export default VENUES;

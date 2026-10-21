/**
 * Bisogni del personaggio: fame, energia e divertimento.
 *
 * Valori 0–100, dove 100 è il massimo benessere. Calano con il tempo di gioco
 * in modo prevedibile e graduale: nessuna morte improvvisa, nessuna perdita
 * arbitraria dei progressi. Le azioni del gioco (mangiare, bere, dormire,
 * comprare, passeggiare) li modificano in modo deterministico e testabile.
 */

export interface Needs {
  /** 100 = sazio, 0 = affamato. */
  hunger: number;
  /** 100 = riposato, 0 = esausto. */
  energy: number;
  /** 100 = allegro, 0 = annoiato. */
  fun: number;
}

/** Calo per ora di gioco da svegli. */
export const NEEDS_DECAY_PER_HOUR = {
  hunger: 4.5,
  energy: 3.2,
  fun: 2.4,
} as const;

/** Sotto questa soglia scatta l'avviso nel HUD. */
export const NEED_WARNING = 25;

export function createInitialNeeds(): Needs {
  return { hunger: 72, energy: 80, fun: 66 };
}

export function clampNeed(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, value));
}

export function sanitizeNeeds(input: unknown): Needs {
  if (!input || typeof input !== 'object') return createInitialNeeds();
  const raw = input as Partial<Needs>;
  return {
    hunger: clampNeed(typeof raw.hunger === 'number' ? raw.hunger : createInitialNeeds().hunger),
    energy: clampNeed(typeof raw.energy === 'number' ? raw.energy : createInitialNeeds().energy),
    fun: clampNeed(typeof raw.fun === 'number' ? raw.fun : createInitialNeeds().fun),
  };
}

/** Avanza i bisogni di `gameMinutes` minuti di gioco da svegli. */
export function advanceNeeds(needs: Needs, gameMinutes: number): Needs {
  const hours = Math.max(0, gameMinutes) / 60;
  return {
    hunger: clampNeed(needs.hunger - NEEDS_DECAY_PER_HOUR.hunger * hours),
    energy: clampNeed(needs.energy - NEEDS_DECAY_PER_HOUR.energy * hours),
    fun: clampNeed(needs.fun - NEEDS_DECAY_PER_HOUR.fun * hours),
  };
}

export interface NeedEffect {
  nutrition?: number;
  energy?: number;
  fun?: number;
}

/** Applica l'effetto di un pasto, una consumazione o un'attività. */
export function applyNeedEffect(needs: Needs, effect: NeedEffect): Needs {
  return {
    hunger: clampNeed(needs.hunger + (effect.nutrition ?? 0)),
    energy: clampNeed(needs.energy + (effect.energy ?? 0)),
    fun: clampNeed(needs.fun + (effect.fun ?? 0)),
  };
}

/** Dormire: energia piena, leggera fame, un po' di buonumore. */
export function sleepNeeds(needs: Needs): Needs {
  return {
    hunger: clampNeed(needs.hunger - 4),
    energy: 100,
    fun: clampNeed(needs.fun + 6),
  };
}

export function lowestNeed(needs: Needs): { key: keyof Needs; value: number } {
  const keys: (keyof Needs)[] = ['hunger', 'energy', 'fun'];
  let key: keyof Needs = 'hunger';
  for (const candidate of keys) {
    if (needs[candidate] < needs[key]) key = candidate;
  }
  return { key, value: needs[key] };
}

export const NEED_LABEL: Record<keyof Needs, string> = {
  hunger: 'Fame',
  energy: 'Energia',
  fun: 'Divertimento',
};

/** Avviso da mostrare nel HUD, oppure null se va tutto bene. */
export function needsWarning(needs: Needs): string | null {
  if (needs.energy <= NEED_WARNING) return 'Sei stanco: torna a casa e dormi (E vicino a casa)';
  if (needs.hunger <= NEED_WARNING) return 'Hai fame: compra qualcosa al bar o al ristorante';
  if (needs.fun <= NEED_WARNING) return 'Ti annoi: fai un giro o prendi un caffè';
  return null;
}

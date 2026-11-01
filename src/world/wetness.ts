/**
 * Bagnato dell'asfalto: pellicola d'acqua e acqua ferma nelle tracce.
 *
 * L'asfalto non si bagna e non asciuga come un interruttore. Prima il gioco
 * usava due costanti diverse per "piove" e "non piove", ma lo stato era uno
 * solo: appena smetteva di piovere la strada tornava lucida per sempre, e le
 * pozze sparivano insieme alla pellicola. Qui i due stati sono separati:
 *
 *  - la **pellicola** si forma in pochi secondi e asciuga in minuti, tanto più
 *    in fretta quanto più il sole è alto e il vento tira;
 *  - l'**acqua ferma** (pozze, tracce delle ruote, bordi) si riempie con la
 *    pioggia ma se ne va molto più piano, perché è acqua profonda e non un
 *    velo: resta a lungo dopo che la strada è tornata opaca.
 *
 * Tutte le funzioni sono pure e accettano `dt` in secondi: si possono testare
 * senza renderer e senza orologio.
 */

export interface WetnessState {
  /** pellicola d'acqua 0…1 (0 = asfalto asciutto) */
  wetness: number;
  /** acqua ferma nelle pozze 0…1 */
  standingWater: number;
}

export interface WetnessInput {
  /** quanto la strada dovrebbe essere bagnata adesso, 0…1 */
  targetWetness: number;
  /** intensità della pioggia 0…1 */
  rain: number;
  /** luce del giorno 0…1: il sole asciuga, la notte no */
  day: number;
  /** vento in km/h: asciuga anche lui, ma meno del sole */
  wind: number;
}

/** Velocità di bagnatura (1/s): la pioggia bagna in fretta. */
const SOAK_RATE = 0.3;
/** Asciugatura minima, di notte e senza vento (1/s): quasi asciutta in ~15 min. */
const DRY_RATE = 0.0028;
/** Quanto il sole accelera l'asciugatura (1/s a mezzogiorno). */
const SUN_DRY_RATE = 0.0045;
/** Quanto il vento accelera l'asciugatura (1/s a 40 km/h). */
const WIND_DRY_RATE = 0.0018;
/** Le pozze si riempiono più piano della pellicola. */
const PUDDLE_SOAK_RATE = 0.16;
/** E si svuotano molto più piano: l'acqua profonda resta. */
const PUDDLE_DRY_RATE = 0.0009;

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

/** Passo esponenziale verso il bersaglio: nessun salto, nessun overshoot. */
function approach(current: number, target: number, dt: number, rate: number): number {
  if (!(dt > 0) || !(rate > 0)) return current;
  return current + (target - current) * (1 - Math.exp(-rate * dt));
}

/**
 * Avanza lo stato di un passo di simulazione.
 *
 * `dt` è limitato a 250 ms: se la scheda va in background o si apre un menu,
 * al ritorno la strada non deve asciugarsi di colpo come se fossero passati
 * dieci minuti in un frame.
 */
export function advanceWetness(state: WetnessState, input: WetnessInput, dt: number): WetnessState {
  const step = Math.min(0.25, Math.max(0, Number.isFinite(dt) ? dt : 0));
  const target = clamp01(input.targetWetness);
  const rain = clamp01(input.rain);
  const day = clamp01(input.day);
  const wind = clamp01(input.wind / 40);

  const rate =
    target > state.wetness
      ? SOAK_RATE
      : DRY_RATE + SUN_DRY_RATE * day + WIND_DRY_RATE * wind;
  const wetness = approach(clamp01(state.wetness), target, step, rate);

  // L'acqua ferma non è la pellicola: senza pioggia il bersaglio scende a zero
  // solo con l'evaporazione lenta, e il riempimento segue la pellicola appena
  // formata (una strada che si bagna da un minuto non ha ancora pozze fondate).
  const puddleTarget = rain > 0.02
    ? clamp01(rain) * clamp01(0.2 + wetness * 0.8)
    : 0;
  const standingWater = approach(
    clamp01(state.standingWater),
    puddleTarget,
    step,
    puddleTarget > state.standingWater ? PUDDLE_SOAK_RATE : PUDDLE_DRY_RATE,
  );

  return { wetness, standingWater };
}

/**
 * Acqua ferma "fisica" da passare alla guida.
 *
 * Nel modello di aderenza conta l'acqua che resta sull'asfalto: la pellicola
 * bagna, ma solo le pozze vere riducono il grip in modo netto. Il valore è
 * limitato dalla pellicola quando piove (non può esserci più acqua ferma che
 * acqua in superficie), mentre dopo la pioggia le pozze possono sopravvivere
 * alla pellicola e continuare a contare finché non evaporano.
 */
export function drivingWater(state: WetnessState, rain: number): number {
  const wet = clamp01(state.wetness);
  const puddles = clamp01(state.standingWater);
  if (clamp01(rain) > 0.02) return Math.min(puddles, wet);
  return puddles;
}

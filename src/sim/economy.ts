/**
 * Economia virtuale — SOLO DENARO DI GIOCO.
 *
 * Regola inderogabile: gli euro di questo modulo sono una valuta fittizia
 * interna al gioco. Non sono denaro vero, non hanno valore monetario reale e
 * non sono collegati a carte, conti, IBAN, gateway o servizi finanziari reali.
 *
 * Scelte di progetto:
 * - tutti gli importi sono interi in centesimi (nessun errore floating-point);
 * - le operazioni sono pure: ricevono un wallet e restituiscono un nuovo wallet,
 *   così un acquisto fallito non può lasciare uno stato parzialmente aggiornato;
 * - i saldi non possono diventare negativi;
 * - ogni movimento registra importo, categoria, luogo, descrizione, metodo
 *   virtuale, orario di gioco e saldo risultante.
 */

export type MoneyMethod = 'contanti' | 'conto' | 'carta-simulata';

export type TransactionType = 'spesa' | 'deposito' | 'prelievo' | 'ricarica';

export interface Transaction {
  id: string;
  /** Importo in centesimi; negativo per le uscite. */
  amount: number;
  type: TransactionType;
  category: string;
  place: string;
  description: string;
  method: MoneyMethod;
  /** Orario di gioco in minuti dalla mezzanotte del giorno corrente. */
  gameTime: number;
  /** Giorno di gioco (1 = primo giorno). */
  day: number;
  balanceBefore: number;
  balanceAfter: number;
  cashAfter: number;
  accountAfter: number;
}

export interface Wallet {
  /** Contanti virtuali, in centesimi. */
  cash: number;
  /** Conto virtuale in-game, in centesimi. */
  account: number;
  transactions: Transaction[];
}

export const INITIAL_CASH_CENTS = 50_000; // 500 € virtuali
export const INITIAL_ACCOUNT_CENTS = 200_000; // 2.000 € virtuali

export function createInitialWallet(): Wallet {
  return { cash: INITIAL_CASH_CENTS, account: INITIAL_ACCOUNT_CENTS, transactions: [] };
}

export function cloneWallet(wallet: Wallet): Wallet {
  return { cash: wallet.cash, account: wallet.account, transactions: [...wallet.transactions] };
}

export function totalCents(wallet: Wallet): number {
  return wallet.cash + wallet.account;
}

export function availableCents(wallet: Wallet, method: MoneyMethod = 'contanti'): number {
  return method === 'contanti' ? wallet.cash : wallet.account;
}

export function canAfford(wallet: Wallet, amountCents: number, method: MoneyMethod = 'contanti'): boolean {
  return isValidAmount(amountCents) && availableCents(wallet, method) >= amountCents;
}

export function isValidAmount(amountCents: number): boolean {
  return Number.isInteger(amountCents) && amountCents > 0;
}

export interface PurchaseInput {
  amountCents: number;
  place: string;
  description: string;
  /** Metodo virtuale usato; default contanti. */
  method?: MoneyMethod;
  category?: string;
  gameTime?: number;
  day?: number;
}

export type EconomyResult =
  | { ok: true; wallet: Wallet; transaction: Transaction }
  | { ok: false; wallet: Wallet; reason: 'importo-non-valido' | 'fondi-insufficienti' };

let sequence = 0;

function nextId(day: number, gameTime: number): string {
  sequence = (sequence + 1) % 1_000_000;
  return `tx-${day}-${gameTime}-${sequence}`;
}

function makeTransaction(
  wallet: Wallet,
  amount: number,
  type: TransactionType,
  input: { place: string; description: string; method: MoneyMethod; category: string; gameTime?: number; day?: number },
  cashAfter: number,
  accountAfter: number,
): Transaction {
  const day = input.day ?? 1;
  const gameTime = input.gameTime ?? 0;
  return {
    id: nextId(day, gameTime),
    amount,
    type,
    category: input.category,
    place: input.place,
    description: input.description,
    method: input.method,
    gameTime,
    day,
    balanceBefore: totalCents(wallet),
    balanceAfter: cashAfter + accountAfter,
    cashAfter,
    accountAfter,
  };
}

/** Acquisto atomico: se non ci sono fondi sufficienti il wallet resta identico. */
export function purchase(wallet: Wallet, input: PurchaseInput): EconomyResult {
  const method = input.method ?? 'contanti';
  if (!isValidAmount(input.amountCents)) {
    return { ok: false, wallet, reason: 'importo-non-valido' };
  }
  if (availableCents(wallet, method) < input.amountCents) {
    return { ok: false, wallet, reason: 'fondi-insufficienti' };
  }

  const cashAfter = method === 'contanti' ? wallet.cash - input.amountCents : wallet.cash;
  const accountAfter = method === 'contanti' ? wallet.account : wallet.account - input.amountCents;
  const transaction = makeTransaction(
    wallet,
    -input.amountCents,
    'spesa',
    {
      place: input.place,
      description: input.description,
      method,
      category: input.category ?? 'acquisto',
      gameTime: input.gameTime,
      day: input.day,
    },
    cashAfter,
    accountAfter,
  );

  return {
    ok: true,
    wallet: {
      cash: cashAfter,
      account: accountAfter,
      transactions: [...wallet.transactions, transaction],
    },
    transaction,
  };
}

/** Deposito virtuale: contanti → conto. Non crea né distrugge denaro. */
export function deposit(wallet: Wallet, amountCents: number, place: string, gameTime = 0, day = 1): EconomyResult {
  if (!isValidAmount(amountCents)) return { ok: false, wallet, reason: 'importo-non-valido' };
  if (wallet.cash < amountCents) return { ok: false, wallet, reason: 'fondi-insufficienti' };

  const cashAfter = wallet.cash - amountCents;
  const accountAfter = wallet.account + amountCents;
  const transaction = makeTransaction(
    wallet,
    amountCents,
    'deposito',
    { place, description: 'Versamento contanti sul conto virtuale', method: 'contanti', category: 'banca', gameTime, day },
    cashAfter,
    accountAfter,
  );

  return {
    ok: true,
    wallet: { cash: cashAfter, account: accountAfter, transactions: [...wallet.transactions, transaction] },
    transaction,
  };
}

/** Prelievo virtuale: conto → contanti. Non crea né distrugge denaro. */
export function withdraw(wallet: Wallet, amountCents: number, place: string, gameTime = 0, day = 1): EconomyResult {
  if (!isValidAmount(amountCents)) return { ok: false, wallet, reason: 'importo-non-valido' };
  if (wallet.account < amountCents) return { ok: false, wallet, reason: 'fondi-insufficienti' };

  const cashAfter = wallet.cash + amountCents;
  const accountAfter = wallet.account - amountCents;
  const transaction = makeTransaction(
    wallet,
    -amountCents,
    'prelievo',
    { place, description: 'Prelievo dal conto virtuale', method: 'conto', category: 'banca', gameTime, day },
    cashAfter,
    accountAfter,
  );

  return {
    ok: true,
    wallet: { cash: cashAfter, account: accountAfter, transactions: [...wallet.transactions, transaction] },
    transaction,
  };
}

export function transfer(
  wallet: Wallet,
  amountCents: number,
  direction: 'cash-to-bank' | 'bank-to-cash',
  place: string,
  gameTime = 0,
  day = 1,
): EconomyResult {
  return direction === 'cash-to-bank'
    ? deposit(wallet, amountCents, place, gameTime, day)
    : withdraw(wallet, amountCents, place, gameTime, day);
}

/** Storico dal più recente al più vecchio (la lista originale non viene mutata). */
export function getTransactionHistory(wallet: Wallet): Transaction[] {
  return [...wallet.transactions].reverse();
}

export function getBalanceSummary(wallet: Wallet): {
  cash: number;
  account: number;
  total: number;
  transactionCount: number;
} {
  return {
    cash: wallet.cash,
    account: wallet.account,
    total: totalCents(wallet),
    transactionCount: wallet.transactions.length,
  };
}

/** Formattazione italiana: 12,50 €. */
export function formatEuro(cents: number): string {
  const negative = cents < 0;
  const value = Math.abs(Math.round(cents)) / 100;
  return `${negative ? '−' : ''}${value.toFixed(2).replace('.', ',')} €`;
}

/**
 * Convalida un wallet caricato da localStorage. Restituisce `null` se i dati
 * non sono recuperabili: il chiamante può ripartire da un wallet iniziale
 * senza perdere il file originale (che resta intatto finché non si salva).
 */
export function sanitizeWallet(input: unknown): Wallet | null {
  if (!input || typeof input !== 'object') return null;
  const raw = input as Partial<Wallet>;
  if (!Number.isFinite(raw.cash) || !Number.isFinite(raw.account)) return null;
  const cash = Math.max(0, Math.round(raw.cash as number));
  const account = Math.max(0, Math.round(raw.account as number));
  const transactions: Transaction[] = [];
  if (Array.isArray(raw.transactions)) {
    for (const item of raw.transactions) {
      const t = item as Partial<Transaction>;
      if (
        typeof t.id === 'string' &&
        Number.isFinite(t.amount) &&
        typeof t.place === 'string' &&
        typeof t.description === 'string'
      ) {
        transactions.push({
          id: t.id,
          amount: Math.round(t.amount as number),
          type: t.type ?? 'spesa',
          category: t.category ?? 'acquisto',
          place: t.place,
          description: t.description,
          method: t.method ?? 'contanti',
          gameTime: Number.isFinite(t.gameTime) ? (t.gameTime as number) : 0,
          day: Number.isFinite(t.day) ? (t.day as number) : 1,
          balanceBefore: Number.isFinite(t.balanceBefore) ? (t.balanceBefore as number) : 0,
          balanceAfter: Number.isFinite(t.balanceAfter) ? (t.balanceAfter as number) : 0,
          cashAfter: Number.isFinite(t.cashAfter) ? (t.cashAfter as number) : cash,
          accountAfter: Number.isFinite(t.accountAfter) ? (t.accountAfter as number) : account,
        });
      }
    }
  }
  return { cash, account, transactions };
}

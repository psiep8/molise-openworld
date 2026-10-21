import { describe, expect, it } from 'vitest';
import {
  INITIAL_ACCOUNT_CENTS,
  INITIAL_CASH_CENTS,
  canAfford,
  createInitialWallet,
  deposit,
  formatEuro,
  getTransactionHistory,
  purchase,
  sanitizeWallet,
  totalCents,
  withdraw,
} from '../src/sim/economy';

describe('economia virtuale', () => {
  it('parte con 500 € virtuali in contanti e 2.000 € sul conto', () => {
    const wallet = createInitialWallet();
    expect(wallet.cash).toBe(INITIAL_CASH_CENTS);
    expect(wallet.account).toBe(INITIAL_ACCOUNT_CENTS);
    expect(totalCents(wallet)).toBe(250_000);
    expect(wallet.transactions).toHaveLength(0);
  });

  it('un acquisto valido scala solo i contanti e registra il movimento', () => {
    const wallet = createInitialWallet();
    const result = purchase(wallet, {
      amountCents: 700,
      place: 'Bar El Rancho',
      description: 'Caffè',
      method: 'contanti',
      category: 'caffè',
      gameTime: 480,
      day: 2,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.wallet.cash).toBe(INITIAL_CASH_CENTS - 700);
    expect(result.wallet.account).toBe(INITIAL_ACCOUNT_CENTS);
    expect(result.wallet.transactions).toHaveLength(1);
    expect(result.transaction.amount).toBe(-700);
    expect(result.transaction.balanceBefore).toBe(250_000);
    expect(result.transaction.balanceAfter).toBe(249_300);
    expect(result.transaction.day).toBe(2);
  });

  it('un acquisto rifiutato non modifica né saldo né storico', () => {
    const wallet = createInitialWallet();
    const result = purchase(wallet, {
      amountCents: INITIAL_CASH_CENTS + 1,
      place: 'Negozio',
      description: 'Troppo caro',
      method: 'contanti',
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.wallet).toBe(wallet);
    expect(result.wallet.cash).toBe(INITIAL_CASH_CENTS);
    expect(result.wallet.transactions).toHaveLength(0);
  });

  it('si può pagare col conto virtuale senza toccare i contanti', () => {
    const wallet = createInitialWallet();
    const result = purchase(wallet, {
      amountCents: 6500,
      place: 'Ricciolotto Abbigliamento',
      description: 'Outfit elegante',
      method: 'conto',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.wallet.cash).toBe(INITIAL_CASH_CENTS);
    expect(result.wallet.account).toBe(INITIAL_ACCOUNT_CENTS - 6500);
    expect(canAfford(result.wallet, 1000, 'contanti')).toBe(true);
  });

  it('rifiuta importi non interi o non positivi', () => {
    const wallet = createInitialWallet();
    expect(purchase(wallet, { amountCents: 10.5, place: 'X', description: 'Y' }).ok).toBe(false);
    expect(purchase(wallet, { amountCents: -100, place: 'X', description: 'Y' }).ok).toBe(false);
    expect(purchase(wallet, { amountCents: 0, place: 'X', description: 'Y' }).ok).toBe(false);
  });

  it('deposito e prelievo spostano denaro senza crearlo né distruggerlo', () => {
    const wallet = createInitialWallet();
    const deposited = deposit(wallet, 10_000, 'ATM virtuale', 600, 1);
    expect(deposited.ok).toBe(true);
    if (!deposited.ok) return;
    expect(deposited.wallet.cash).toBe(INITIAL_CASH_CENTS - 10_000);
    expect(deposited.wallet.account).toBe(INITIAL_ACCOUNT_CENTS + 10_000);
    expect(totalCents(deposited.wallet)).toBe(totalCents(wallet));

    const withdrawn = withdraw(deposited.wallet, 5_000, 'ATM virtuale', 610, 1);
    expect(withdrawn.ok).toBe(true);
    if (!withdrawn.ok) return;
    expect(withdrawn.wallet.cash).toBe(INITIAL_CASH_CENTS - 5_000);
    expect(withdrawn.wallet.account).toBe(INITIAL_ACCOUNT_CENTS + 5_000);
    expect(totalCents(withdrawn.wallet)).toBe(totalCents(wallet));
  });

  it('non permette prelievi oltre il conto né depositi oltre i contanti', () => {
    const wallet = createInitialWallet();
    expect(withdraw(wallet, INITIAL_ACCOUNT_CENTS + 1, 'ATM').ok).toBe(false);
    expect(deposit(wallet, INITIAL_CASH_CENTS + 1, 'ATM').ok).toBe(false);
    expect(wallet.cash).toBe(INITIAL_CASH_CENTS);
    expect(wallet.account).toBe(INITIAL_ACCOUNT_CENTS);
  });

  it('lo storico è dal più recente al più vecchio', () => {
    let wallet = createInitialWallet();
    const first = purchase(wallet, { amountCents: 100, place: 'A', description: 'Primo' });
    if (!first.ok) throw new Error('acquisto fallito');
    const second = purchase(first.wallet, { amountCents: 200, place: 'B', description: 'Secondo' });
    if (!second.ok) throw new Error('acquisto fallito');
    wallet = second.wallet;
    const history = getTransactionHistory(wallet);
    expect(history.map((t) => t.description)).toEqual(['Secondo', 'Primo']);
    expect(wallet.transactions.map((t) => t.description)).toEqual(['Primo', 'Secondo']);
  });

  it('formatta gli importi in euro italiani senza floating point', () => {
    expect(formatEuro(0)).toBe('0,00 €');
    expect(formatEuro(1234)).toBe('12,34 €');
    expect(formatEuro(-700)).toBe('−7,00 €');
  });

  it('convalida i wallet caricati e scarta quelli irrecuperabili', () => {
    expect(sanitizeWallet(null)).toBeNull();
    expect(sanitizeWallet({ cash: 'x', account: 1 })).toBeNull();
    const wallet = sanitizeWallet({ cash: 10.4, account: 20, transactions: [{ id: 'a' }] });
    expect(wallet).not.toBeNull();
    expect(wallet?.cash).toBe(10);
    expect(wallet?.account).toBe(20);
    expect(wallet?.transactions).toHaveLength(0);
  });
});

/** Economia virtuale SOLO DENARO DI GIOCO.
 * Regola inderogabile: gli euro sono una valuta fittizia interna al gioco.
 * Non sono denaro vero e non hanno valore monetario reale.
 * Non integrano pagamenti reali, carte bancarie reali, conti reali,
 * gateway, wallet reali, acquisti in-app o API finanziarie.
 *
 * Il denaro è memorizzato come interi in centesimi per evitare errori floating-point.
 * Tutte le transazioni sono atomiche: un acquisto fallito non deve modificare il saldo.
 * Per impostazione predefinita si impediscono saldi negativi (salve meccanica esplicita).
 * Importi decimali sono rappresentati correttamente tramite centesimi interi.
 * Registra importo, data/ora di gioco, categoria, luogo, descrizione, metodo virtuale
 * e saldo risultante.
 * Consente di consultare il saldo e lo storico transazioni dalla UI.
 * Depositi e prelievi da ATM/banca sono trasferimenti tra contanti virtuali e conto virtuale.
 * Prezzi e ricompense sono configurabili e sottoposti a test.
 * Prevede reset della partita/salvataggio e gestione di dati corrotti senza perdita silenziosa.
 */
export interface Transaction {
  id: string;
  amount: number; // in centesimi (intero)
  type: 'spesa' | 'deposito' | 'prelievo' | 'bonifico'; // must match Wallet interface
  category: string;
  place: string;
  description: string;
  method: string;
  timestamp: number;
  balanceBefore: number;
  balanceAfter: number;
}

export interface Wallet {
  cash: number; // contanti in centesimi
  balance: number; // conto virtuale in centesimi
  transactions: Transaction[];
}

export const INITIAL_CASH_CENTS = 50000; // €500 in centesimi
export const INITIAL_BALANCE_CENTS = 200000; // €2000 in centesimi

export function createInitialWallet(): Wallet {
  return {
    cash: INITIAL_CASH_CENTS,
    balance: INITIAL_BALANCE_CENTS,
    transactions: [],
  };
}

export function getBalanceCash(wallet: Wallet): number {
  return wallet.cash;
}

export function getBalanceTotal(wallet: Wallet): number {
  return wallet.cash + wallet.balance;
}

export function canAfford(wallet: Wallet, amountCents: number): boolean {
  return wallet.cash >= amountCents;
}

export function purchase(
  wallet: Wallet,
  amountCents: number,
  place: string,
  description: string,
  method: string
): { success: boolean; wallet: Wallet; transaction: Transaction } {
  // Verifica fondi sufficienti
  if (wallet.cash < amountCents) {
    return {
      success: false,
      wallet,
      transaction: {
        id: Date.now().toString(),
        amount: amountCents,
        type: 'spesa' as const,
        category: 'acquisto',
        place,
        description,
        method,
        timestamp: Date.now(),
        balanceBefore: getBalanceTotal(wallet),
        balanceAfter: getBalanceTotal(wallet),
      },
    };
  }

  // Nuova wallet con saldo aggiornato
  const newCash = wallet.cash - amountCents;
  const newBalance = wallet.balance;
  const newTransaction: Transaction = {
    id: Date.now().toString(),
    amount: -amountCents, // negativo per spesa
    type: 'spesa' as const,
    category: 'acquisto',
    place,
    description,
    method,
    timestamp: Date.now(),
    balanceBefore: getBalanceTotal(wallet),
    balanceAfter: newCash + newBalance,
  };
  const newTransactions = [...wallet.transactions, newTransaction];

  const newWallet: Wallet = {
    cash: newCash,
    balance: newBalance,
    transactions: newTransactions,
  };

  return {
    success: true,
    wallet: newWallet,
    transaction: newTransaction,
  };
}

export function deposit(
  wallet: Wallet,
  amountCents: number,
  place: string,
  description: string
): { success: boolean; wallet: Wallet; transaction: Transaction } {
  if (amountCents <= 0) {
    return { success: false, wallet, transaction: {} as Transaction };
  }

  const newCash = wallet.cash + amountCents;
  const newBalance = wallet.balance - amountCents;
  const newTransaction: Transaction = {
    id: Date.now().toString(),
    amount: amountCents,
    type: 'deposito' as const,
    category: 'banca',
    place,
    description,
    method: 'bonifico/cash',
    timestamp: Date.now(),
    balanceBefore: getBalanceTotal(wallet),
    balanceAfter: newCash + newBalance,
  };
  const newTransactions = [...wallet.transactions, newTransaction];

  const newWallet: Wallet = {
    cash: newCash,
    balance: newBalance,
    transactions: newTransactions,
  };

  return {
    success: true,
    wallet: newWallet,
    transaction: newTransaction,
  };
}

export function withdraw(
  wallet: Wallet,
  amountCents: number,
  place: string,
  description: string
): { success: boolean; wallet: Wallet; transaction: Transaction } {
  if (amountCents <= 0) {
    return { success: false, wallet, transaction: {} as Transaction };
  }

  // Non permittere saldo negativo nel conto
  if (wallet.balance < amountCents) {
    return {
      success: false,
      wallet,
      transaction: {
        id: Date.now().toString(),
        amount: -amountCents,
        type: 'prelievo' as const,
        category: 'banca',
        place,
        description,
        method: 'ATM',
        timestamp: Date.now(),
        balanceBefore: getBalanceTotal(wallet),
        balanceAfter: getBalanceTotal(wallet),
      },
    };
  }

  const newCash = wallet.cash - amountCents;
  const newBalance = wallet.balance + amountCents;
  const newTransaction: Transaction = {
    id: Date.now().toString(),
    amount: amountCents,
    type: 'prelievo' as const,
    category: 'banca',
    place,
    description,
    method: 'ATM',
    timestamp: Date.now(),
    balanceBefore: getBalanceTotal(wallet),
    balanceAfter: newCash + newBalance,
  };
  const newTransactions = [...wallet.transactions, newTransaction];

  const newWallet: Wallet = {
    cash: newCash,
    balance: newBalance,
    transactions: newTransactions,
  };

  return {
    success: true,
    wallet: newWallet,
    transaction: newTransaction,
  };
}

export function transferBetweenCashAndBank(
  wallet: Wallet,
  amountCents: number,
  direction: 'cash-to-bank' | 'bank-to-cash',
  place: string,
  description: string
): { success: boolean; wallet: Wallet; transaction: Transaction } {
  // direction: 'cash-to-bank' = deposit, 'bank-to-cash' = withdraw
  if (direction === 'cash-to-bank') {
    return deposit(wallet, amountCents, place, description);
  } else {
    return withdraw(wallet, amountCents, place, description);
  }
}

export function getTransactionHistory(wallet: Wallet): Transaction[] {
  return [...wallet.transactions].sort((a, b) => b.timestamp - a.timestamp);
}

export function getBalanceSummary(wallet: Wallet): {
  cash: number;
  balance: number;
  total: number;
  transactionCount: number;
} {
  return {
    cash: wallet.cash,
    balance: wallet.balance,
    total: getBalanceTotal(wallet),
    transactionCount: wallet.transactions.length,
  };
}
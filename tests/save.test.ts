import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createInitialWallet } from '../src/sim/economy';
import { createInitialNeeds } from '../src/sim/needs';
import {
  SAVE_KEY,
  advanceClock,
  clearLifeSave,
  createNewLifeSave,
  formatGameClock,
  loadLifeSave,
  sanitizeLifeSave,
  saveLifeSave,
} from '../src/sim/save';

class MemoryStorage {
  private readonly map = new Map<string, string>();

  get length(): number {
    return this.map.size;
  }

  key(index: number): string | null {
    return [...this.map.keys()][index] ?? null;
  }

  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }

  removeItem(key: string): void {
    this.map.delete(key);
  }

  clear(): void {
    this.map.clear();
  }
}

describe('salvataggio della modalità vita', () => {
  beforeEach(() => {
    const storage = new MemoryStorage();
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: { localStorage: storage },
    });
  });

  afterEach(() => {
    clearLifeSave();
  });

  it('crea una partita nuova con denaro virtuale iniziale e orologio alle 08:00', () => {
    const save = createNewLifeSave();
    expect(save.wallet).toEqual(createInitialWallet());
    expect(save.needs).toEqual(createInitialNeeds());
    expect(save.day).toBe(1);
    expect(save.minutes).toBe(480);
  });

  it('salva e ricarica stato e posizione', () => {
    const save = createNewLifeSave();
    save.wallet = { ...save.wallet, cash: 42_100 };
    save.needs = { hunger: 11, energy: 22, fun: 33 };
    save.day = 4;
    save.minutes = 13 * 60 + 25;
    save.position = { x: 12.5, z: -80.25 };
    expect(saveLifeSave(save)).toBe(true);

    const loaded = loadLifeSave();
    expect(loaded).not.toBeNull();
    expect(loaded?.wallet.cash).toBe(42_100);
    expect(loaded?.needs).toEqual({ hunger: 11, energy: 22, fun: 33 });
    expect(loaded?.day).toBe(4);
    expect(loaded?.minutes).toBe(805);
    expect(loaded?.position).toEqual({ x: 12.5, z: -80.25 });
  });

  it('ignora un salvataggio corrotto senza cancellarlo', () => {
    window.localStorage.setItem(SAVE_KEY, '{non-json');
    expect(loadLifeSave()).toBeNull();
    expect(window.localStorage.getItem(SAVE_KEY)).toBe('{non-json');
  });

  it('convalida i campi fuori scala', () => {
    const fixed = sanitizeLifeSave({
      wallet: { cash: 1000, account: 2000, transactions: [] },
      needs: { hunger: 200, energy: -5, fun: 50 },
      day: -3,
      minutes: 9999,
      position: { x: 1, z: 2 },
      savedAt: 0,
    });
    expect(fixed?.needs).toEqual({ hunger: 100, energy: 0, fun: 50 });
    expect(fixed?.day).toBe(1);
    expect(fixed?.minutes).toBe(1439);
    expect(sanitizeLifeSave({ wallet: { cash: 'x' } })).toBeNull();
  });

  it('rimuove il salvataggio su richiesta', () => {
    saveLifeSave(createNewLifeSave());
    expect(loadLifeSave()).not.toBeNull();
    clearLifeSave();
    expect(loadLifeSave()).toBeNull();
  });

  it('formatta e avanza l\'orologio di gioco', () => {
    expect(formatGameClock(0)).toBe('00:00');
    expect(formatGameClock(8 * 60 + 5)).toBe('08:05');
    expect(formatGameClock(1439)).toBe('23:59');
    expect(advanceClock(1, 23 * 60 + 30, 60)).toEqual({ day: 2, minutes: 30 });
    expect(advanceClock(3, 10 * 60, 25)).toEqual({ day: 3, minutes: 625 });
  });
});

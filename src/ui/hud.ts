export type Mode = 'walk' | 'drive';

import { formatEuro, getTransactionHistory, type Wallet } from '../sim/economy';

const $ = <T extends HTMLElement>(id: string): T | null => document.getElementById(id) as T | null;

export class Hud {
  private readonly hud = $('hud');
  private readonly start = $('start');
  private readonly loading = $('loading');
  private readonly loadingText = $('loading-text');
  private readonly loadingBar = $('loading-bar');
  private readonly modePill = $('mode-pill');
  private readonly speedo = $('speedo');
  private readonly speedValue = $('speed-value');
  private readonly gearValue = $('gear-value');
  private readonly rpmValue = $('rpm-value');
  private readonly vehicleSpec = $('vehicle-spec');
  private readonly appearanceSummary = $('appearance-summary');
  private readonly garageStatus = $('garage-status');
  private readonly objective = $('objective');
  private readonly routePanel = $('route-panel');
  private readonly routeText = $('route-text');
  private readonly toastEl = $('toast');
  private readonly help = $('help');
  private readonly minimapLabel = $('minimap-label');
  private readonly positionReadout = $('position-readout');
  private readonly mapOverlay = $('map-overlay');
  private readonly balanceCash = $('balance-cash');
  private readonly balanceTotal = $('balance-total');
  private readonly settings = $('settings');
  private readonly weatherToggle = $('toggle-real-weather') as HTMLInputElement | null;
  private readonly weatherStatus = $('weather-status');
  private readonly weatherRefresh = $('btn-weather-refresh') as HTMLButtonElement | null;
  private readonly fatal = $('fatal');
  private readonly fatalText = $('fatal-text');
  private toastTimer: number | undefined;
  private helpVisible = true;

  setLoading(progress: number, text: string): void {
    this.loading?.classList.remove('hidden');
    if (this.loadingText) this.loadingText.textContent = text;
    if (this.loadingBar) this.loadingBar.style.width = `${Math.round(progress * 100)}%`;
  }

  hideLoading(): void {
    this.loading?.classList.add('hidden');
  }

  hideStart(): void {
    this.start?.classList.add('hidden');
  }

  showHud(): void {
    this.hud?.classList.remove('hidden');
  }

  setMode(mode: Mode): void {
    if (!this.modePill) return;
    this.modePill.textContent = mode === 'drive' ? 'Alla guida' : 'A piedi';
    this.speedo?.classList.toggle('hidden', mode !== 'drive');
  }

  setSpeed(kmh: number): void {
    if (this.speedValue) this.speedValue.textContent = String(kmh);
  }

  /** Marcia inserita (-1 = retromarcia) e regime motore, per il contagiri. */
  setGear(gear: number, rpm: number): void {
    if (this.gearValue) this.gearValue.textContent = gear < 0 ? 'R' : String(gear);
    if (this.rpmValue) this.rpmValue.textContent = `${Math.round(rpm / 10) * 10} rpm`;
  }

  /** Dati meccanici del veicolo selezionato (motore, potenza, velocità reale). */
  setVehicleSpec(text: string): void {
    if (this.vehicleSpec) this.vehicleSpec.textContent = text;
  }

  /** Riepilogo del personaggio (sesso, altezza, corporatura, outfit). */
  setAppearanceSummary(text: string): void {
    if (this.appearanceSummary) this.appearanceSummary.textContent = text;
  }

  /** Casa/garage selezionato, o il messaggio "nessuna casa scelta". */
  setGarageStatus(text: string): void {
    if (this.garageStatus) this.garageStatus.textContent = text;
  }

  setObjective(text: string | null): void {
    if (!this.objective) return;
    if (!text) {
      this.objective.classList.add('hidden');
      return;
    }
    this.objective.classList.remove('hidden');
    if (this.objective.dataset.text !== text) {
      this.objective.innerHTML = text;
      this.objective.dataset.text = text;
    }
  }

  /** Itinerario attivo: testo già pronto (null = nessun itinerario). */
  setRoute(text: string | null): void {
    if (!this.routePanel || !this.routeText) return;
    if (!text) {
      this.routePanel.classList.add('hidden');
      return;
    }
    this.routePanel.classList.remove('hidden');
    this.routeText.textContent = text;
  }

  setPosition(lat: number, lon: number, elev: number, fps: number): void {
    if (!this.positionReadout) return;
    const ns = lat >= 0 ? 'N' : 'S';
    const ew = lon >= 0 ? 'E' : 'W';
    this.positionReadout.textContent = `${Math.abs(lat).toFixed(5)}° ${ns} · ${Math.abs(lon).toFixed(5)}° ${ew} · ${Math.round(elev)} m · ${Math.round(fps)} fps`;
  }

  setLocation(name: string): void {
    if (this.minimapLabel) this.minimapLabel.textContent = name;
  }

  toast(message: string, ms = 2600): void {
    if (!this.toastEl) return;
    this.toastEl.textContent = message;
    this.toastEl.classList.remove('hidden');
    if (this.toastTimer) window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.toastEl?.classList.add('hidden'), ms);
  }

  toggleHelp(): boolean {
    this.helpVisible = !this.helpVisible;
    this.help?.classList.toggle('hidden', !this.helpVisible);
    return this.helpVisible;
  }

  showMap(show: boolean): void {
    this.mapOverlay?.classList.toggle('hidden', !show);
  }

  get mapVisible(): boolean {
    return !this.mapOverlay?.classList.contains('hidden');
  }

  showSettings(show: boolean): void {
    this.settings?.classList.toggle('hidden', !show);
  }

  get settingsVisible(): boolean {
    return !this.settings?.classList.contains('hidden');
  }

  setRealWeather(enabled: boolean): void {
    if (this.weatherToggle) this.weatherToggle.checked = enabled;
  }

  /** Attiva o attenua i controlli di ora e meteo manuali. */
  setManualTime(enabled: boolean): void {
    const toggle = document.getElementById('toggle-manual-time') as HTMLInputElement | null;
    if (toggle) toggle.checked = enabled;
    const controls = document.getElementById('manual-controls');
    controls?.classList.toggle('muted', !enabled);
  }

  setTimeLabel(hour: number): void {
    const el = document.getElementById('time-value');
    if (!el) return;
    const h = Math.floor(hour) % 24;
    const m = Math.round((hour - Math.floor(hour)) * 60) % 60;
    el.textContent = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }

  setVehicleName(name: string): void {
    const el = document.getElementById('car-name');
    if (el) el.textContent = name;
  }

  setBalance(wallet: Wallet): void {
    if (this.balanceCash) this.balanceCash.textContent = formatEuro(wallet.cash);
    if (this.balanceTotal) this.balanceTotal.textContent = formatEuro(wallet.cash + wallet.account);
    const count = document.getElementById('balance-transactions');
    if (count) count.textContent = `${wallet.transactions.length} mov.`;

    const cash = document.getElementById('wallet-cash');
    const account = document.getElementById('wallet-account');
    const total = document.getElementById('wallet-total');
    if (cash) cash.textContent = formatEuro(wallet.cash);
    if (account) account.textContent = formatEuro(wallet.account);
    if (total) total.textContent = formatEuro(wallet.cash + wallet.account);

    const history = document.getElementById('wallet-history');
    if (history) {
      history.textContent = '';
      const entries = getTransactionHistory(wallet);
      if (entries.length === 0) {
        const li = document.createElement('li');
        li.className = 'wallet-empty';
        li.textContent = 'Nessun movimento: acquisti, depositi e prelievi virtuali compariranno qui.';
        history.append(li);
      }
      for (const t of entries.slice(0, 40)) {
        const li = document.createElement('li');
        const copy = document.createElement('span');
        const time = `${String(Math.floor(t.gameTime / 60)).padStart(2, '0')}:${String(t.gameTime % 60).padStart(2, '0')}`;
        copy.textContent = `G${t.day} ${time} · ${t.description} · ${t.place}`;
        const amount = document.createElement('span');
        amount.className = `wallet-amount ${t.amount < 0 ? 'out' : 'in'}`;
        amount.textContent = `${t.amount > 0 ? '+' : ''}${formatEuro(t.amount)}`;
        li.append(copy, amount);
        history.append(li);
      }
    }
  }

  /** Barre dei bisogni: 0–100, sotto 25 diventano rosse. */
  setNeeds(needs: { hunger: number; energy: number; fun: number }): void {
    const set = (id: string, value: number): void => {
      const bar = document.getElementById(id) as HTMLElement | null;
      if (!bar) return;
      bar.style.width = `${Math.round(Math.max(0, Math.min(100, value)))}%`;
      bar.classList.toggle('low', value <= 25);
    };
    set('need-hunger', needs.hunger);
    set('need-energy', needs.energy);
    set('need-fun', needs.fun);
  }

  /**
   * `overrideHour` serve all'ora manuale: l'orologio in alto deve mostrare
   * l'ora che il giocatore sta vedendo nel cielo, non quella del tempo di
   * gioco che continua a scorrere sotto.
   */
  setClock(day: number, minutes: number, overrideHour?: number): void {
    const shown = overrideHour === undefined ? minutes : overrideHour * 60;
    const clock = document.getElementById('clock-value');
    if (clock) {
      const total = ((Math.floor(shown) % 1440) + 1440) % 1440;
      clock.textContent = `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
    }
    const dayEl = document.getElementById('day-value');
    if (dayEl) dayEl.textContent = `Giorno ${day}`;
  }

  setNeedsWarning(text: string | null): void {
    const el = document.getElementById('needs-warning');
    if (!el) return;
    el.textContent = text ?? '';
    el.classList.toggle('hidden', !text);
  }

  setWeatherStatus(text: string): void {
    if (this.weatherStatus) this.weatherStatus.textContent = text;
  }

  setWeatherBusy(busy: boolean): void {
    if (!this.weatherRefresh) return;
    this.weatherRefresh.disabled = busy;
    this.weatherRefresh.textContent = busy ? 'Aggiorno…' : 'Aggiorna ora';
  }

  showFatal(message: string): void {
    this.loading?.classList.add('hidden');
    this.start?.classList.add('hidden');
    this.fatal?.classList.remove('hidden');
    if (this.fatalText) this.fatalText.textContent = message;
  }
}

export type Mode = 'walk' | 'drive';

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
  private readonly objective = $('objective');
  private readonly routePanel = $('route-panel');
  private readonly routeText = $('route-text');
  private readonly toastEl = $('toast');
  private readonly help = $('help');
  private readonly minimapLabel = $('minimap-label');
  private readonly positionReadout = $('position-readout');
  private readonly mapOverlay = $('map-overlay');
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

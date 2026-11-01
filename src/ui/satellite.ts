import { BBOX, WORLD, latLonToWorld, worldToLatLon } from '../config';
import { mercatorPixel } from '../geo/geo';
import { OPEN_WORLD_IMAGERY, type TileProvider } from '../world/imagery';
import { loadOpenRasterTile } from '../world/tile-cache';

const TILE = 256;
const EARTH_CIRCUMFERENCE = 40075016.686;
const DEG = Math.PI / 180;
const MID_LAT = (BBOX.latMin + BBOX.latMax) / 2;
/** Fade-in di una tile appena arrivata: niente "pop" sgranato. */
const TILE_FADE_MS = 260;
/** Una tile fallita si riprova dopo questo tempo (rete che va e viene). */
const RETRY_MS = 20_000;
/** Caricamenti contemporanei: più di così la banda si satura e le prime tile tardano. */
const MAX_INFLIGHT = 6;

export interface TileRect {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

interface CachedTile {
  rect: TileRect;
  img?: HTMLImageElement;
  loading: boolean;
  failed: boolean;
  failedAt: number;
  /** quando l'immagine è arrivata: serve al fade-in */
  arrivedAt: number;
  lastUsed: number;
}

export interface SatelliteStats {
  zoom: number;
  loaded: number;
  pending: number;
  failed: number;
}

/** Latitudine del bordo nord di una tile Web Mercator. */
function tileLat(y: number, z: number): number {
  const n = Math.PI - (2 * Math.PI * y) / 2 ** z;
  return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
}

/** Rettangolo in metri locali coperto dalla tile z/x/y. */
export function tileWorldRect(z: number, x: number, y: number): TileRect {
  const n = 2 ** z;
  const lonWest = (x / n) * 360 - 180;
  const lonEast = ((x + 1) / n) * 360 - 180;
  const nw = latLonToWorld(tileLat(y, z), lonWest);
  const se = latLonToWorld(tileLat(y + 1, z), lonEast);
  return { minX: nw.x, maxX: se.x, minZ: nw.z, maxZ: se.z };
}

/**
 * Zoom che dà circa **un pixel di tile per pixel di canvas**.
 *
 * È il punto che mancava: con uno zoom fisso a 17 una minimappa da 240 m su
 * 640 px chiede 0,375 m/px, ma z17 ne offre 0,9 → immagine ingrandita e
 * sfocata. Qui si parte da metri per pixel dello schermo e si sceglie il
 * livello che li copre, senza superare il massimo del provider.
 */
export function zoomForScale(metersPerPixel: number, lat = MID_LAT, maxZoom = 19): number {
  const latFactor = Math.cos(lat * DEG);
  const exact = Math.log2(
    (EARTH_CIRCUMFERENCE * latFactor) / (TILE * Math.max(1e-6, metersPerPixel)),
  );
  // `ceil`: meglio una tile un filo più fine che una ingrandita
  return Math.max(14, Math.min(Math.min(maxZoom, 19), Math.ceil(exact)));
}

/**
 * Cache di tile satellite per minimappa e mappa grande.
 *
 * - zoom adattivo (`zoomForScale`), non più fisso a 17;
 * - prefetch del livello successivo intorno al giocatore;
 * - coda con priorità per distanza e limite di richieste in volo;
 * - crossfade di 260 ms quando una tile arriva, con il livello inferiore
 *   lasciato sotto come base (mai un buco sgranato);
 * - fallback al mosaico Sentinel locale se le tile non arrivano (offline).
 */
export class SatelliteTiles {
  private readonly cache = new Map<string, CachedTile>();
  private readonly queued = new Map<string, { z: number; x: number; y: number; priority: number }>();
  private readonly maxTiles = 260;
  private inflight = 0;
  private localImage: HTMLImageElement | null = null;
  private localLoading = false;
  private statsValue: SatelliteStats = { zoom: 15, loaded: 0, pending: 0, failed: 0 };

  constructor(
    private readonly provider: TileProvider = OPEN_WORLD_IMAGERY,
    private readonly onUpdate?: () => void,
  ) {
    if (provider.localOnly) this.loadLocal('world-imagery-hd.jpg', true);
  }

  get name(): string {
    return this.provider.name;
  }

  get attribution(): string {
    return this.provider.attribution;
  }

  get maxZoom(): number {
    return this.provider.maxZoom;
  }

  get usesTiles(): boolean {
    return !this.provider.localOnly;
  }

  get stats(): SatelliteStats {
    return { ...this.statsValue, pending: this.inflight + this.queued.size };
  }

  /** Zoom utile per una certa scala (metri di lato) e dimensione canvas. */
  idealZoom(viewMeters: number, sizePx: number): number {
    return zoomForScale(viewMeters / Math.max(1, sizePx), MID_LAT, this.provider.maxZoom);
  }

  private loadLocal(url: string, allowFallback: boolean): void {
    if (this.localImage || this.localLoading) return;
    this.localLoading = true;
    const root = `${import.meta.env.BASE_URL}geo/`;
    const image = new Image();
    image.decoding = 'async';
    image.onload = () => {
      this.localImage = image;
      this.localLoading = false;
      this.onUpdate?.();
    };
    image.onerror = () => {
      this.localLoading = false;
      // La versione HD è un di più: se manca si torna al mosaico 2048.
      if (allowFallback) this.loadLocal('world-imagery.jpg', false);
      else this.onUpdate?.();
    };
    image.src = `${root}${url}`;
  }

  /** Base offline: usata sotto le tile e quando le tile non arrivano. */
  private ensureFallback(): void {
    if (!this.localImage) this.loadLocal('world-imagery-hd.jpg', true);
  }

  private get(z: number, x: number, y: number, priority: number): CachedTile {
    const key = `${z}/${x}/${y}`;
    let tile = this.cache.get(key);
    if (!tile) {
      tile = {
        rect: tileWorldRect(z, x, y),
        loading: false,
        failed: false,
        failedAt: 0,
        arrivedAt: 0,
        lastUsed: 0,
      };
      this.cache.set(key, tile);
      if (this.cache.size > this.maxTiles) this.evict();
    }
    tile.lastUsed = performance.now();
    if (tile.img || tile.loading) return tile;
    if (tile.failed && performance.now() - tile.failedAt < RETRY_MS) return tile;
    if (this.inflight >= MAX_INFLIGHT) {
      const pending = this.queued.get(key);
      // il primo che chiede la tile ha la priorità migliore
      if (!pending || priority < pending.priority) this.queued.set(key, { z, x, y, priority });
      return tile;
    }
    this.start(tile, z, x, y);
    return tile;
  }

  private start(tile: CachedTile, z: number, x: number, y: number): void {
    tile.loading = true;
    tile.failed = false;
    this.inflight++;
    loadOpenRasterTile(this.provider.url(z, x, y))
      .then((img) => {
        tile.img = img;
        tile.loading = false;
        tile.arrivedAt = performance.now();
        this.statsValue.loaded++;
        this.onUpdate?.();
      })
      .catch(() => {
        tile.loading = false;
        tile.failed = true;
        tile.failedAt = performance.now();
        this.statsValue.failed++;
        // niente tile: la minimappa non deve restare vuota
        if (!this.provider.localOnly) this.ensureFallback();
      })
      .finally(() => {
        this.inflight--;
        this.pump();
      });
  }

  /** Avvia la prossima richiesta in coda (la più vicina al giocatore). */
  private pump(): void {
    while (this.inflight < MAX_INFLIGHT && this.queued.size > 0) {
      let bestKey: string | null = null;
      let best = Number.POSITIVE_INFINITY;
      for (const [key, entry] of this.queued) {
        if (entry.priority < best) {
          best = entry.priority;
          bestKey = key;
        }
      }
      if (!bestKey) return;
      const entry = this.queued.get(bestKey)!;
      this.queued.delete(bestKey);
      const tile = this.cache.get(bestKey);
      if (!tile || tile.img || tile.loading) continue;
      this.start(tile, entry.z, entry.x, entry.y);
    }
  }

  private evict(): void {
    const now = performance.now();
    const candidates = [...this.cache.entries()]
      .filter(([, tile]) => !tile.loading)
      .sort((a, b) => a[1].lastUsed - b[1].lastUsed);
    for (const [key, tile] of candidates) {
      // le tile appena arrivate restano: sono quelle che si stanno guardando
      if (tile.arrivedAt && now - tile.arrivedAt < 8000) continue;
      this.cache.delete(key);
      if (this.cache.size <= this.maxTiles * 0.75) return;
    }
  }

  /** Mosaico locale ritagliato sulla finestra visibile (fallback o provider locale). */
  private drawLocal(
    ctx: CanvasRenderingContext2D,
    size: number,
    view: { x: number; z: number },
    viewMeters: number,
  ): boolean {
    const image = this.localImage;
    if (!image) return false;
    const sourceWidth = image.naturalWidth || image.width;
    const sourceHeight = image.naturalHeight || image.height;
    if (sourceWidth < 2 || sourceHeight < 2) return false;
    const pxPerMeterX = sourceWidth / WORLD.width;
    const pxPerMeterY = sourceHeight / WORLD.height;
    const left = view.x - viewMeters / 2;
    const top = view.z - viewMeters / 2;
    ctx.save();
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.filter = 'contrast(1.08) saturate(1.06)';
    ctx.drawImage(
      image,
      (left + WORLD.halfWidth) * pxPerMeterX,
      (top + WORLD.halfHeight) * pxPerMeterY,
      viewMeters * pxPerMeterX,
      viewMeters * pxPerMeterY,
      0,
      0,
      size,
      size,
    );
    ctx.restore();
    return true;
  }

  /**
   * Disegna le tile intorno a `view` dentro un canvas circolare già clippato.
   * `zoom` è opzionale: senza, si sceglie quello che dà 1:1 con i pixel.
   */
  draw(
    ctx: CanvasRenderingContext2D,
    size: number,
    view: { x: number; z: number },
    viewMeters: number,
    zoom?: number,
  ): void {
    const targetZoom = zoom ?? this.idealZoom(viewMeters, size);
    this.statsValue.zoom = targetZoom;
    const half = viewMeters / 2;

    if (this.provider.localOnly) {
      this.drawLocal(ctx, size, view, viewMeters);
      return;
    }

    // base: mosaico locale (offline) sotto le tile, se disponibile
    const hasLocal = this.drawLocal(ctx, size, view, viewMeters);
    if (!hasLocal && this.localImage === null) {
      // niente mosaico: fondo neutro, non un buco nero
      ctx.fillStyle = '#2b3327';
      ctx.fillRect(0, 0, size, size);
    }

    // livello inferiore come base: se la tile fine non è ancora arrivata,
    // l'occhio vede comunque una foto continua invece di un riquadro vuoto
    const baseZoom = targetZoom > 14 ? targetZoom - 1 : 0;
    if (baseZoom >= 14) this.drawLevel(ctx, size, view, viewMeters, baseZoom, 1);
    this.drawLevel(ctx, size, view, viewMeters, targetZoom, -1);

    // prefetch del livello successivo: quando lo zoom sale (o ci si avvicina)
    // le tile sono già in cache, quindi il passaggio non si vede
    if (targetZoom < Math.min(this.provider.maxZoom, 19)) {
      this.prefetch(view, targetZoom + 1, half);
    }
  }

  /** Disegna un livello di tile con fade-in; `alpha < 0` = fade per tile. */
  private drawLevel(
    ctx: CanvasRenderingContext2D,
    size: number,
    view: { x: number; z: number },
    viewMeters: number,
    zoom: number,
    alpha: number,
  ): void {
    const half = viewMeters / 2;
    const k = size / viewMeters;
    const cx = size / 2;
    const cy = size / 2;
    const nw = worldToLatLon(view.x - half, view.z - half);
    const se = worldToLatLon(view.x + half, view.z + half);
    const p0 = mercatorPixel(nw.lat, nw.lon, zoom);
    const p1 = mercatorPixel(se.lat, se.lon, zoom);
    const tx0 = Math.floor(p0.x / TILE) - 1;
    const tx1 = Math.floor(p1.x / TILE) + 1;
    const ty0 = Math.floor(p0.y / TILE) - 1;
    const ty1 = Math.floor(p1.y / TILE) + 1;
    const now = performance.now();
    ctx.save();
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    for (let ty = ty0; ty <= ty1; ty++) {
      for (let tx = tx0; tx <= tx1; tx++) {
        const rect = tileWorldRect(zoom, tx, ty);
        const dx = rect.minX - view.x;
        const dz = rect.minZ - view.z;
        // priorità = distanza dal centro dello schermo
        const priority = dx * dx + dz * dz;
        const tile = this.get(zoom, tx, ty, priority);
        if (!tile.img) continue;
        const sx = cx + dx * k;
        const sy = cy + dz * k;
        const sw = (rect.maxX - rect.minX) * k;
        const sh = (rect.maxZ - rect.minZ) * k;
        // Aggancio ai pixel interi: con il vecchio `-0,5 / +1` per coprire le
        // cuciture la tile veniva ricampionata di mezzo pixel e perdeva
        // nitidezza — proprio l'effetto "sfocato" da cui si partiva. Le tile
        // confinanti arrotondano lo stesso bordo allo stesso pixel, quindi
        // non si aprono fessure e non serve allargare nulla.
        const x0 = Math.round(sx);
        const y0 = Math.round(sy);
        const x1 = Math.round(sx + sw);
        const y1 = Math.round(sy + sh);
        if (x1 - x0 < 1 || y1 - y0 < 1) continue;
        ctx.globalAlpha = alpha >= 0
          ? alpha
          : Math.min(1, (now - tile.arrivedAt) / TILE_FADE_MS);
        ctx.drawImage(tile.img, x0, y0, x1 - x0, y1 - y0);
      }
    }
    ctx.restore();
  }

  /** Chiede in anticipo le tile del livello successivo intorno alla vista. */
  private prefetch(
    view: { x: number; z: number },
    zoom: number,
    half: number,
  ): void {
    const nw = worldToLatLon(view.x - half, view.z - half);
    const se = worldToLatLon(view.x + half, view.z + half);
    const p0 = mercatorPixel(nw.lat, nw.lon, zoom);
    const p1 = mercatorPixel(se.lat, se.lon, zoom);
    const tx0 = Math.floor(p0.x / TILE);
    const tx1 = Math.floor(p1.x / TILE);
    const ty0 = Math.floor(p0.y / TILE);
    const ty1 = Math.floor(p1.y / TILE);
    // solo il centro: un anello intero a zoom alto costa decine di MB
    const mx = Math.round((tx0 + tx1) / 2);
    const my = Math.round((ty0 + ty1) / 2);
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        this.get(zoom, mx + dx, my + dy, 1e9);
      }
    }
  }
}

/**
 * Mosaico satellite dell'intera area di gioco per la mappa grande.
 *
 * Il mosaico locale (Sentinel, 3,4 m/px) è la sorgente migliore disponibile
 * per l'intera area: a scala regionale un canvas da 1400 px chiede ~10 m/px,
 * quindi z14 basta e avanza. Le tile vere vengono usate solo se il mosaico
 * manca (installazione senza `geo/`), dove servono a riempire il fondo.
 */
export class SatelliteBasemap {
  readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D | null;
  private drawn = 0;
  private total = 0;
  private finished = false;

  constructor(
    private readonly provider: TileProvider = OPEN_WORLD_IMAGERY,
    private readonly onUpdate?: () => void,
    private readonly zoom = 14,
  ) {
    this.canvas = document.createElement('canvas');
    const p0 = mercatorPixel(BBOX.latMax, BBOX.lonMin, zoom);
    const p1 = mercatorPixel(BBOX.latMin, BBOX.lonMax, zoom);
    this.canvas.width = Math.max(256, Math.round(p1.x - p0.x));
    this.canvas.height = Math.max(256, Math.round(p1.y - p0.y));
    this.ctx = this.canvas.getContext('2d');
    if (this.ctx) {
      this.ctx.fillStyle = '#2b3628';
      this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
      // Prima il mosaico Sentinel locale (HD se disponibile): la mappa è
      // pronta subito e anche offline. Se il file manca, si usano le tile
      // aperte configurate.
      const root = `${import.meta.env.BASE_URL}geo/`;
      const loadMosaic = (url: string, allowFallback: boolean): void => {
        const img = new Image();
        img.decoding = 'async';
        img.onload = () => {
          this.ctx?.drawImage(img, 0, 0, this.canvas.width, this.canvas.height);
          this.total = 1;
          this.drawn = 1;
          this.finished = true;
          this.onUpdate?.();
        };
        img.onerror = () => {
          if (allowFallback) {
            loadMosaic(`${root}world-imagery.jpg`, false);
            return;
          }
          if (this.provider.localOnly) {
            this.finished = true;
            this.onUpdate?.();
            return;
          }
          this.load(p0, p1);
        };
        img.src = url;
      };
      loadMosaic(`${root}world-imagery-hd.jpg`, true);
    }
  }

  get ready(): boolean {
    return this.finished || (this.total > 0 && this.drawn / this.total > 0.5);
  }

  get progress(): number {
    return this.total === 0 ? 0 : this.drawn / this.total;
  }

  private load(p0: { x: number; y: number }, p1: { x: number; y: number }): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const tx0 = Math.floor(p0.x / TILE);
    const tx1 = Math.floor(p1.x / TILE);
    const ty0 = Math.floor(p0.y / TILE);
    const ty1 = Math.floor(p1.y / TILE);
    this.total = (tx1 - tx0 + 1) * (ty1 - ty0 + 1);

    for (let ty = ty0; ty <= ty1; ty++) {
      for (let tx = tx0; tx <= tx1; tx++) {
        loadOpenRasterTile(this.provider.url(this.zoom, tx, ty))
          .then((img) => {
            ctx.drawImage(img, tx * TILE - p0.x, ty * TILE - p0.y);
            this.drawn++;
            this.onUpdate?.();
          })
          .catch(() => {
            this.drawn++;
          })
          .finally(() => {
            if (this.drawn >= this.total) {
              this.finished = true;
              this.onUpdate?.();
            }
          });
      }
    }
  }
}

import { BBOX, latLonToWorld, worldToLatLon } from '../config';
import { mercatorPixel } from '../geo/geo';
import { ESRI_WORLD_IMAGERY, type TileProvider } from '../world/imagery';

const TILE = 256;

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

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`tile ${url} non disponibile`));
    img.src = url;
  });
}

/**
 * Cache di tile satellite per la minimappa "radar".
 * Le tile sono caricate in modo lazy e tenute in memoria (LRU semplice),
 * così il radar si riempie mentre guidi invece di bloccare il gioco.
 */
export class SatelliteTiles {
  private readonly cache = new Map<string, CachedTile>();
  private readonly maxTiles = 220;

  constructor(
    private readonly provider: TileProvider = ESRI_WORLD_IMAGERY,
    private readonly onUpdate?: () => void,
  ) {}

  private get(z: number, x: number, y: number): CachedTile {
    const key = `${z}/${x}/${y}`;
    const found = this.cache.get(key);
    if (found) return found;

    const tile: CachedTile = { rect: tileWorldRect(z, x, y), loading: true, failed: false };
    this.cache.set(key, tile);
    loadImage(this.provider.url(z, x, y))
      .then((img) => {
        tile.img = img;
        tile.loading = false;
        this.onUpdate?.();
      })
      .catch(() => {
        tile.failed = true;
        tile.loading = false;
      });

    if (this.cache.size > this.maxTiles) this.evict();
    return tile;
  }

  private evict(): void {
    for (const [key, tile] of this.cache) {
      if (tile.loading) continue;
      this.cache.delete(key);
      if (this.cache.size <= this.maxTiles * 0.75) return;
    }
  }

  /** Disegna le tile intorno a `view` dentro un canvas circolare già clippato. */
  draw(ctx: CanvasRenderingContext2D, size: number, view: { x: number; z: number }, viewMeters: number, zoom = 17): void {
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

    for (let ty = ty0; ty <= ty1; ty++) {
      for (let tx = tx0; tx <= tx1; tx++) {
        const tile = this.get(zoom, tx, ty);
        if (!tile.img) continue;
        const sx = cx + (tile.rect.minX - view.x) * k;
        const sy = cy + (tile.rect.minZ - view.z) * k;
        const sw = (tile.rect.maxX - tile.rect.minX) * k;
        const sh = (tile.rect.maxZ - tile.rect.minZ) * k;
        ctx.drawImage(tile.img, sx - 0.5, sy - 0.5, sw + 1, sh + 1);
      }
    }
  }
}

/**
 * Mosaico satellite dell'intera area di gioco (z14, ~7 m/px) usato come
 * sfondo della mappa grande: strade e edifici vettoriali restano sopra.
 */
export class SatelliteBasemap {
  readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D | null;
  private drawn = 0;
  private total = 0;
  private finished = false;

  constructor(
    private readonly provider: TileProvider = ESRI_WORLD_IMAGERY,
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
      // Prima il mosaico Sentinel locale: la mappa è pronta subito e anche
      // offline. Se il file manca, si torna alle tile Esri in streaming.
      const img = new Image();
      img.decoding = 'async';
      img.onload = () => {
        this.ctx?.drawImage(img, 0, 0, this.canvas.width, this.canvas.height);
        this.total = 1;
        this.drawn = 1;
        this.finished = true;
        this.onUpdate?.();
      };
      img.onerror = () => this.load(p0, p1);
      img.src = `${import.meta.env.BASE_URL}geo/world-imagery.jpg`;
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
        loadImage(this.provider.url(this.zoom, tx, ty))
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


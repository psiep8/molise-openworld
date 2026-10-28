const CACHE_NAME = 'molise-open-raster-tiles-v1';
const MAX_CACHED_TILES = 2048;

interface ResponseCache {
  match(request: RequestInfo | URL): Promise<Response | undefined>;
  put(request: RequestInfo | URL, response: Response): Promise<void>;
  keys(): Promise<readonly Request[]>;
  delete(request: RequestInfo | URL): Promise<boolean>;
}

interface CacheStorageLike {
  open(name: string): Promise<ResponseCache>;
}

export class OpenRasterTileCache {
  private cachePromise: Promise<ResponseCache | null> | null = null;
  private readonly inflight = new Map<string, Promise<Blob>>();
  private warned = false;

  constructor(
    private readonly storage: CacheStorageLike | undefined = globalThis.caches,
    private readonly fetcher: typeof fetch = fetch,
    private readonly maxEntries = MAX_CACHED_TILES,
  ) {
    if (!Number.isInteger(maxEntries) || maxEntries < 1) {
      throw new Error(`cache tile: limite non valido (${maxEntries})`);
    }
  }

  load(url: string): Promise<Blob> {
    const pending = this.inflight.get(url);
    if (pending) return pending;
    const request = this.loadOnce(url).finally(() => this.inflight.delete(url));
    this.inflight.set(url, request);
    return request;
  }

  private async loadOnce(url: string): Promise<Blob> {
    const cache = await this.getCache();
    if (cache) {
      try {
        const cached = await cache.match(url);
        if (cached?.ok) return cached.blob();
      } catch (error) {
        this.warn('lettura cache non riuscita', error);
      }
    }

    const response = await this.fetcher(url, { mode: 'cors' });
    if (!response.ok) throw new Error(`tile ${url}: HTTP ${response.status}`);
    const blob = await response.blob();

    if (cache) {
      try {
        await cache.put(
          url,
          new Response(blob.slice(0, blob.size, blob.type), {
            status: response.status,
            statusText: response.statusText,
            headers: response.headers,
          }),
        );
        await this.trim(cache);
      } catch (error) {
        this.warn('salvataggio cache non riuscito; la tile resta disponibile solo in questa sessione', error);
      }
    }
    return blob;
  }

  private getCache(): Promise<ResponseCache | null> {
    if (!this.storage) return Promise.resolve(null);
    this.cachePromise ??= this.storage.open(CACHE_NAME).catch((error: unknown) => {
      this.warn('cache persistente non disponibile; continuo con la rete', error);
      return null;
    });
    return this.cachePromise;
  }

  private async trim(cache: ResponseCache): Promise<void> {
    const keys = await cache.keys();
    const excess = keys.length - this.maxEntries;
    for (let i = 0; i < excess; i++) {
      if (!(await cache.delete(keys[i]!))) {
        throw new Error(`cache tile: impossibile rimuovere ${keys[i]!.url}`);
      }
    }
  }

  private warn(message: string, error: unknown): void {
    if (this.warned) return;
    this.warned = true;
    console.warn(`[tile cache] ${message}`, error);
  }
}

export const openRasterTileCache = new OpenRasterTileCache();

export async function loadOpenRasterTile(url: string): Promise<HTMLImageElement> {
  const blob = await openRasterTileCache.load(url);
  const objectUrl = URL.createObjectURL(blob);
  const image = new Image();
  image.decoding = 'async';
  return new Promise((resolve, reject) => {
    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error(`tile immagine non decodificabile: ${url}`));
    };
    image.src = objectUrl;
  });
}

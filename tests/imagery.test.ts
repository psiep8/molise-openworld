import { describe, expect, it } from 'vitest';
import { createOpenImageryProvider, zoomForDistance } from '../src/world/imagery';
import { OpenRasterTileCache } from '../src/world/tile-cache';

describe('zoomForDistance', () => {
  it('usa z18 vicino al giocatore, dove campi e tennis devono leggersi', () => {
    expect(zoomForDistance(0)).toBe(18);
    expect(zoomForDistance(500)).toBe(18);
  });

  it('scende a z17 a media distanza e a z16 oltre', () => {
    expect(zoomForDistance(501)).toBe(17);
    expect(zoomForDistance(3200)).toBe(17);
    expect(zoomForDistance(3201)).toBe(16);
  });
});

describe('createOpenImageryProvider', () => {
  it('usa la sorgente locale aperta senza configurazione remota', () => {
    const provider = createOpenImageryProvider(undefined, undefined);
    expect(provider.id).toBe('local-open-imagery');
    expect(provider.attribution).toContain('CC BY 4.0');
    expect(provider.url(16, 2, 3)).toContain('empty-imagery.svg');
  });

  it('espande i segnaposto del provider remoto configurato', () => {
    const provider = createOpenImageryProvider(
      'https://tiles.example/{z}/{x}/{y}.png',
      'Dati aperti con attribuzione',
    );
    expect(provider.url(16, 123, 456)).toBe('https://tiles.example/16/123/456.png');
  });

  it('richiede attribuzione e coordinate XYZ al provider remoto', () => {
    expect(() => createOpenImageryProvider('https://tiles.example/{z}/{x}/{y}.png', undefined)).toThrow(
      'VITE_OPEN_IMAGERY_ATTRIBUTION',
    );
    expect(() => createOpenImageryProvider('https://tiles.example/{z}/{x}.png', 'Attribuzione')).toThrow(
      'segnaposto',
    );
  });
});

describe('OpenRasterTileCache', () => {
  function createStorage(records: Map<string, Response>) {
    const cacheUrl = (request: RequestInfo | URL): string =>
      request instanceof Request ? request.url : String(request);
    return {
      async open() {
        return {
          match: async (request: RequestInfo | URL) => records.get(cacheUrl(request)),
          put: async (request: RequestInfo | URL, response: Response) => {
            records.set(cacheUrl(request), response);
          },
          keys: async () => [...records.keys()].map((url) => new Request(url)),
          delete: async (request: RequestInfo | URL) => records.delete(cacheUrl(request)),
        };
      },
    };
  }

  it('riusa tile persistenti anche offline e scarica solo quelle mancanti', async () => {
    const records = new Map<string, Response>();
    let fetches = 0;
    const cacheStorage = createStorage(records);
    const onlineCache = new OpenRasterTileCache(cacheStorage, async () => {
      fetches++;
      return new Response('open tile', { headers: { 'content-type': 'image/png' } });
    });
    const tileUrl = 'https://tiles.example/1/0/0.png';
    expect(await (await onlineCache.load(tileUrl)).text()).toBe('open tile');

    const offlineCache = new OpenRasterTileCache(cacheStorage, async () => {
      throw new Error('offline');
    });
    expect(await (await offlineCache.load(tileUrl)).text()).toBe('open tile');
    expect(fetches).toBe(1);
  });

  it('mantiene la cache limitata ed espelle prima le tile meno recenti', async () => {
    const records = new Map<string, Response>();
    const cache = new OpenRasterTileCache(
      createStorage(records),
      async () => new Response('tile'),
      2,
    );

    await cache.load('https://tiles.example/1/0/0.png');
    await cache.load('https://tiles.example/1/0/1.png');
    await cache.load('https://tiles.example/1/1/0.png');
    expect([...records.keys()]).toEqual([
      'https://tiles.example/1/0/1.png',
      'https://tiles.example/1/1/0.png',
    ]);
  });

  it('deduplica le richieste concorrenti della stessa tile', async () => {
    let fetches = 0;
    const cache = new OpenRasterTileCache(undefined, async () => {
      fetches++;
      await Promise.resolve();
      return new Response('tile');
    });

    const urls = Array.from({ length: 5 }, () => cache.load('https://tiles.example/1/0/0.png'));
    const blobs = await Promise.all(urls);
    expect(fetches).toBe(1);
    expect(await Promise.all(blobs.map((blob) => blob.text()))).toEqual(Array(5).fill('tile'));
  });

  it('lega il fetcher al global: window.fetch lanciato come metodo perde this', async () => {
    let receiver: unknown = null;
    const fetcher = function (this: unknown) {
      receiver = this;
      return Promise.resolve(new Response('tile'));
    } as unknown as typeof fetch;
    const cache = new OpenRasterTileCache(undefined, fetcher);

    expect(await (await cache.load('https://tiles.example/1/0/0.png')).text()).toBe('tile');
    expect(receiver).toBe(globalThis);
  });

  it('propaga l’errore HTTP invece di mascherare una tile mancante', async () => {
    const cache = new OpenRasterTileCache(undefined, async () => new Response(null, { status: 404 }));
    await expect(cache.load('https://tiles.example/1/0/0.png')).rejects.toThrow('HTTP 404');
  });
});

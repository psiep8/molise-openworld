import * as THREE from 'three';
import { CHUNK_SIZE, WORLD, worldToLatLon } from '../config';
import { mercatorPixel } from '../geo/geo';
import { chunkOrigin } from './chunks';

/**
 * Mosaico Sentinel-2 cloudless dell'intero mondo (CC BY 4.0, EOX).
 * Lo scarica `npm run geo:imagery` in `public/geo/world-imagery.jpg`.
 */
const BASE_IMAGERY_URL = `${import.meta.env.BASE_URL}geo/world-imagery.jpg`;

export interface TileProvider {
  id: string;
  name: string;
  attribution: string;
  url: (z: number, x: number, y: number) => string;
  maxZoom: number;
}

export const ESRI_WORLD_IMAGERY: TileProvider = {
  id: 'esri-world-imagery',
  name: 'Esri World Imagery',
  attribution: 'Immagini: © Esri, Maxar, Earthstar Geographics',
  url: (z, x, y) =>
    `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`,
  maxZoom: 19,
};

const TILE = 256;

/**
 * Zoom satellite in base alla distanza dal giocatore.
 *
 * z17 ≈ 0,9 m/px: si leggono tetti, uliveti e muretti a secco.
 * z16 ≈ 1,8 m/px: è il fondo scala utile per i campi lontani.
 *
 * z18 non si usa: un chunk è largo 912 m e a z18 servirebbero ~100 tile e una
 * canvas da 2432 px, che viene comunque tagliata a 2048. Il guadagno è minimo
 * e lo streaming non riesce a texturizzare i chunk lontani (era il motivo per
 * cui i campi all'orizzonte restavano verdi e sfocati).
 */
export function zoomForDistance(distance: number): number {
  if (distance <= 900) return 17;
  return 16;
}

/** Carica le tile come immagini (CORS ok per Esri). */
function loadTileImage(provider: TileProvider, z: number, x: number, y: number): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`tile ${z}/${x}/${y} non disponibile`));
    img.src = provider.url(z, x, y);
  });
}

/**
 * Compone la texture di un chunk (912 m) a partire dalle tile del provider.
 * La texture copre esattamente l'area geografica del chunk; lo zoom decide
 * quanti pixel per metro finiscono nella canvas (fino a 2048 px).
 * Un filo di saturazione in più avvicina le foto aeree ai colori reali
 * del paesaggio molisano (l'Esri di campagna tende al grigio).
 */
export class ImageryStreamer {
  private readonly inflight = new Map<string, Promise<THREE.Texture>>();
  private readonly anisotropy: number;
  private readonly baseZoom = 16;
  /** mosaico Sentinel già decodificato dal browser (nessuna tile da rete) */
  private baseImage: HTMLImageElement | null = null;

  constructor(
    readonly provider: TileProvider = ESRI_WORLD_IMAGERY,
    anisotropy = 4,
    private readonly onTileError?: (err: Error) => void,
  ) {
    this.anisotropy = anisotropy;
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => {
      this.baseImage = img;
    };
    img.src = BASE_IMAGERY_URL;
  }

  get hasBaseImage(): boolean {
    return this.baseImage !== null;
  }

  /**
   * Ritaglia dal mosaico Sentinel la porzione esatta di un chunk.
   *
   * È sincrono e locale: ogni chunk ha subito un'immagine vera (campi, boschi,
   * paesi) anche a 3 km, senza aspettare le tile Esri. Le tile arrivano dopo e
   * sostituiscono questo ritaglio con il dettaglio z17.
   */
  baseChunkTexture(cx: number, cz: number): THREE.Texture | null {
    const img = this.baseImage;
    if (!img) return null;
    const x0 = chunkOrigin(cx);
    const z0 = chunkOrigin(cz);
    const sx = ((x0 + WORLD.halfWidth) / WORLD.width) * img.naturalWidth;
    const sy = ((z0 + WORLD.halfHeight) / WORLD.height) * img.naturalHeight;
    const sw = (CHUNK_SIZE / WORLD.width) * img.naturalWidth;
    const sh = (CHUNK_SIZE / WORLD.height) * img.naturalHeight;

    const size = 256;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.filter = 'saturate(1.16) contrast(1.04)';
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, size, size);

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.generateMipmaps = true;
    texture.anisotropy = this.anisotropy;
    texture.needsUpdate = true;
    return texture;
  }

  async loadChunkTexture(cx: number, cz: number, zoom = this.baseZoom): Promise<THREE.Texture> {
    const key = `${cx}:${cz}:${zoom}`;
    const existing = this.inflight.get(key);
    if (existing) return existing;
    const promise = this.compose(cx, cz, Math.min(zoom, this.provider.maxZoom)).finally(() => {
      this.inflight.delete(key);
    });
    this.inflight.set(key, promise);
    return promise;
  }

  private async compose(cx: number, cz: number, zoom: number): Promise<THREE.Texture> {
    // angoli geografici del chunk: nord-ovest e sud-est
    const x0 = chunkOrigin(cx);
    const z0 = chunkOrigin(cz);
    const nw = worldToLatLon(x0, z0);
    const se = worldToLatLon(x0 + CHUNK_SIZE, z0 + CHUNK_SIZE);
    const p0 = mercatorPixel(nw.lat, nw.lon, zoom);
    const p1 = mercatorPixel(se.lat, se.lon, zoom);

    const spanX = p1.x - p0.x;
    const spanY = p1.y - p0.y;
    const maxSize = 2048;
    const scale = Math.min(1, maxSize / Math.max(spanX, spanY));
    const size = Math.max(256, Math.round(spanX * scale));

    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = Math.max(256, Math.round(spanY * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('canvas 2d non disponibile');
    // fallback: verde collina, così non si vedono buchi se una tile manca
    ctx.fillStyle = '#5b6b42';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const tx0 = Math.floor(p0.x / TILE);
    const tx1 = Math.floor(p1.x / TILE);
    const ty0 = Math.floor(p0.y / TILE);
    const ty1 = Math.floor(p1.y / TILE);
    const scaleX = canvas.width / spanX;
    const scaleY = canvas.height / spanY;

    // leggero ritocco cromatico: le foto aeree rurali sono spente
    ctx.filter = 'saturate(1.16) contrast(1.04)';

    const jobs: Promise<void>[] = [];
    for (let ty = ty0; ty <= ty1; ty++) {
      for (let tx = tx0; tx <= tx1; tx++) {
        jobs.push(
          loadTileImage(this.provider, zoom, tx, ty)
            .then((img) => {
              const dx = (tx * TILE - p0.x) * scaleX;
              const dy = (ty * TILE - p0.y) * scaleY;
              ctx.drawImage(img, dx, dy, TILE * scaleX + 0.5, TILE * scaleY + 0.5);
            })
            .catch((err: Error) => {
              this.onTileError?.(err);
            }),
        );
      }
    }
    await Promise.all(jobs);
    ctx.filter = 'none';

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.generateMipmaps = true;
    texture.anisotropy = this.anisotropy;
    texture.needsUpdate = true;
    return texture;
  }
}

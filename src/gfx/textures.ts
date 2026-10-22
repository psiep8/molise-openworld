import * as THREE from 'three';

/**
 * Texture PBR CC0 (Poly Haven + ambientCG) caricate da `public/textures/`.
 *
 * - `color` è in sRGB, le altre mappe restano lineari (nessuna conversione).
 * - Le texture sono condivise e messe in cache: si scaricano una volta sola.
 * - Se un file manca, Three.js tiene la texture vuota e il materiale continua a
 *   funzionare (con il solo colore/vertex color). I file sono versionati, quindi
 *   in un'installazione completa non accade.
 */
export type TextureKey =
  | 'asphalt'
  | 'gravel'
  | 'plaster'
  | 'plaster2'
  | 'stonewall'
  | 'brick'
  | 'rooftiles'
  | 'grass'
  | 'rock'
  | 'bark'
  | 'concrete';

export interface PbrSet {
  map?: THREE.Texture;
  normalMap?: THREE.Texture;
  roughnessMap?: THREE.Texture;
}

export interface PbrOptions {
  color?: boolean;
  normal?: boolean;
  rough?: boolean;
  /** ripetizioni in UV (le UV di strade/edifici sono in metri) */
  repeat?: number;
}

const BASE = '/textures';
const loader = new THREE.TextureLoader();
const cache = new Map<string, THREE.Texture>();

function texture(url: string, srgb: boolean, anisotropy: number): THREE.Texture {
  const cached = cache.get(url);
  if (cached) return cached;
  const tex = loader.load(url);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  tex.anisotropy = anisotropy;
  cache.set(url, tex);
  return tex;
}

/** Set PBR completo (o parziale) per una superficie. */
export function pbr(renderer: THREE.WebGLRenderer, key: TextureKey, options: PbrOptions = {}): PbrSet {
  const { color = true, normal = true, rough = true, repeat = 1 } = options;
  const anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const dir = `${BASE}/${key}`;
  const set: PbrSet = {};
  if (color) set.map = texture(`${dir}/color.jpg`, true, anisotropy);
  if (normal) set.normalMap = texture(`${dir}/normal.jpg`, false, anisotropy);
  if (rough) set.roughnessMap = texture(`${dir}/rough.jpg`, false, anisotropy);
  if (repeat !== 1) {
    for (const tex of Object.values(set)) {
      tex.repeat.set(repeat, repeat);
    }
  }
  return set;
}

/** Solo la mappa colore (per il dettaglio del terreno campionato in coordinate mondo). */
export function pbrColor(renderer: THREE.WebGLRenderer, key: TextureKey): THREE.Texture {
  return texture(`${BASE}/${key}/color.jpg`, true, Math.min(8, renderer.capabilities.getMaxAnisotropy()));
}

/**
 * Mappa colore con una ripetizione propria.
 *
 * Non si clona la texture condivisa: un clone con `needsUpdate` forzava
 * l'upload prima che l'immagine fosse arrivata e la console si riempiva di
 * "Texture marked for update but no image data found". Qui ogni ripetizione ha
 * il suo caricamento (il file è lo stesso, quindi arriva dalla cache HTTP).
 */
const repeatedCache = new Map<string, THREE.Texture>();
export function pbrColorRepeated(renderer: THREE.WebGLRenderer, key: TextureKey, repeat: number): THREE.Texture {
  const url = `${BASE}/${key}/color.jpg`;
  const cacheKey = `${url}@${repeat}`;
  const cached = repeatedCache.get(cacheKey);
  if (cached) return cached;
  const tex = loader.load(url);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  tex.repeat.set(repeat, repeat);
  repeatedCache.set(cacheKey, tex);
  return tex;
}

export interface FoliageSet {
  map: THREE.Texture;
  normalMap: THREE.Texture;
  alphaMap: THREE.Texture;
}

/**
 * Fogli fotografici con alpha reale (ambientCG Leaf003, CC0) per le chiome:
 * la `alphaMap` è la mappa Opacity del pacchetto, senza la quale le foglie
 * resterebbero un riquadro verde pieno.
 */
export function foliageSet(renderer: THREE.WebGLRenderer): FoliageSet {
  const anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  return {
    map: texture(`${BASE}/foliage/color.jpg`, true, anisotropy),
    normalMap: texture(`${BASE}/foliage/normal.jpg`, false, anisotropy),
    // alphaMap va campionata sul canale verde: i JPG di ambientCG sono in scala
    // di grigi, quindi va bene qualunque canale.
    alphaMap: texture(`${BASE}/foliage/opacity.jpg`, false, anisotropy),
  };
}

/**
 * Normali dell'acqua (tre file separati per poterli scorrare in modo
 * indipendente: nastri dei torrenti e specchi d'acqua hanno UV diversi).
 */
export function waterNormals(renderer: THREE.WebGLRenderer, repeatX: number, repeatY: number): THREE.Texture {
  const key = `water:normals:${repeatX}:${repeatY}`;
  const cached = cache.get(key);
  if (cached) return cached;
  const anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  // un caricamento vero per ogni repeat, invece di clonare una texture che può
  // non essere ancora arrivata: il clone con `needsUpdate` faceva comparire
  // "Texture marked for update but no image data found" in console
  const tex = loader.load(`${BASE}/water/normals.jpg`);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.NoColorSpace;
  tex.anisotropy = anisotropy;
  tex.repeat.set(repeatX, repeatY);
  cache.set(key, tex);
  return tex;
}

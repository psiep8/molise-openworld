import * as THREE from 'three';
import { CHUNK_SIZE, TERRAIN_SEGMENTS, VIEW_RADIUS, WORLD } from '../config';
import type { Heightfield } from '../geo/elevation';
import { pbrColor } from '../gfx/textures';
import { chunkCenter, chunkIndex, chunkKey, chunkOrigin } from './chunks';
import { zoomForDistance, type ImageryStreamer } from './imagery';
import type { Landcover, LandcoverMode } from './landcover';

interface Chunk {
  cx: number;
  cz: number;
  mesh: THREE.Mesh;
  material: THREE.MeshStandardMaterial;
  normalMap: THREE.Texture;
  /** zoom attualmente applicato alla texture (0 = nessuna) */
  textureZoom: number;
  texture?: THREE.Texture;
  loadingZoom?: number;
  hasTexture: boolean;
  disposed: boolean;
  /** true se il chunk ha una texture di copertura locale da rilasciare */
  landcoverLocal: boolean;
}

const NORMAL_MAP_SIZE = 128;
const NORMAL_STRENGTH = 2.6;

/**
 * Normal map ricavata dal DEM: il rilievo "fine" (muretti, fossi, crinali)
 * resta visibile anche quando la geometria è più grossolana del dato.
 * Gli assi sono in spazio tangente: X = est, Y = nord, Z = su.
 */
function buildNormalMap(hf: Heightfield, cx: number, cz: number): THREE.CanvasTexture {
  const size = NORMAL_MAP_SIZE;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas 2d non disponibile');
  const img = ctx.createImageData(size, size);
  const ox = chunkOrigin(cx);
  const oz = chunkOrigin(cz);
  const step = CHUNK_SIZE / (size - 1);
  const max = size - 1;
  const sample = (i: number, j: number): number => {
    const ii = i < 0 ? 0 : i > max ? max : i;
    const jj = j < 0 ? 0 : j > max ? max : j;
    return hf.heightAt(ox + ii * step, oz + jj * step);
  };

  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const hL = sample(i - 1, j);
      const hR = sample(i + 1, j);
      const hN = sample(i, j - 1);
      const hS = sample(i, j + 1);
      let nx = ((hL - hR) / (2 * step)) * NORMAL_STRENGTH;
      let ny = ((hS - hN) / (2 * step)) * NORMAL_STRENGTH;
      let nz = 1;
      const len = Math.hypot(nx, ny, nz) || 1;
      nx /= len;
      ny /= len;
      nz /= len;
      const k = (j * size + i) * 4;
      img.data[k] = (nx * 0.5 + 0.5) * 255;
      img.data[k + 1] = (ny * 0.5 + 0.5) * 255;
      img.data[k + 2] = (nz * 0.5 + 0.5) * 255;
      img.data[k + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

/**
 * Grana condivisa per tutte le mesh di terreno: una sola texture, riusata da
 * ogni chunk come `roughnessMap`, così le superfici non risultano uniformi
 * nemmeno quando la foto satellite è a bassa risoluzione.
 */
let detailMap: THREE.CanvasTexture | null = null;
function terrainDetailMap(): THREE.CanvasTexture {
  if (detailMap) return detailMap;
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas 2d non disponibile');
  const img = ctx.createImageData(size, size);
  let seed = 0x9e3779b9;
  for (let i = 0; i < img.data.length; i += 4) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const n = 190 + (seed % 60);
    img.data[i] = n;
    img.data[i + 1] = n;
    img.data[i + 2] = n;
    img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(CHUNK_SIZE / 24, CHUNK_SIZE / 24);
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  detailMap = texture;
  return texture;
}

/**
 * Aggiunge il dettaglio ravvicinato al terreno: la foto satellite è nitida solo
 * da lontano, quindi si moltiplica per una texture erba/roccia campionata in
 * coordinate mondo. La modulazione è centrata su 1 (luminanza media), così non
 * cambia il colore medio del satellite, e sfuma con la distanza per non far
 * vedere la ripetizione all'orizzonte.
 *
 * Nello stesso shader arrivano le ombre delle nuvole: un rumore largo che scorre
 * col vento e scurisce il suolo a chiazze, come succede davvero quando passano.
 */
export const cloudShadowUniform = { value: 0 };
export const cloudDriftUniform = { value: new THREE.Vector2(0, 0) };

/** `amount` = copertura nuvolosa di giorno (0..1); il drift segue il vento. */
export function setCloudShadow(amount: number, dt: number, windX: number, windZ: number): void {
  cloudShadowUniform.value = Math.min(1, Math.max(0, amount));
  cloudDriftUniform.value.x += windX * dt * 0.0025;
  cloudDriftUniform.value.y += windZ * dt * 0.0025;
}

function applyTerrainDetail(material: THREE.MeshStandardMaterial, renderer: THREE.WebGLRenderer): void {
  const grass = pbrColor(renderer, 'grass');
  const rock = pbrColor(renderer, 'rock');
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uDetailGrass = { value: grass };
    shader.uniforms.uDetailRock = { value: rock };
    shader.uniforms.uCloudShadow = cloudShadowUniform;
    shader.uniforms.uCloudDrift = cloudDriftUniform;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nvarying vec3 vDetailWorld;\nvarying vec3 vDetailNormal;',
      )
      .replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\nvDetailWorld = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;\nvDetailNormal = normalize( mat3( modelMatrix ) * objectNormal );',
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
varying vec3 vDetailWorld;
varying vec3 vDetailNormal;
uniform sampler2D uDetailGrass;
uniform sampler2D uDetailRock;
uniform float uCloudShadow;
uniform vec2 uCloudDrift;

float cloudHash( vec2 p ) {
  return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453 );
}
float cloudNoise( vec2 p ) {
  vec2 i = floor( p );
  vec2 f = fract( p );
  f = f * f * ( 3.0 - 2.0 * f );
  float a = cloudHash( i );
  float b = cloudHash( i + vec2( 1.0, 0.0 ) );
  float c = cloudHash( i + vec2( 0.0, 1.0 ) );
  float d = cloudHash( i + vec2( 1.0, 1.0 ) );
  return mix( mix( a, b, f.x ), mix( c, d, f.x ), f.y );
}`,
      )
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
        float detailDist = length( vDetailWorld - cameraPosition );
        float detailFade = 1.0 - smoothstep( 60.0, 210.0, detailDist );
        if ( detailFade > 0.001 ) {
          float slope = smoothstep( 0.62, 0.86, 1.0 - clamp( normalize( vDetailNormal ).y, 0.0, 1.0 ) );
          // due scale: la grossa dà le macchie d'erba, la fine il pelo del prato
          vec3 g = texture2D( uDetailGrass, vDetailWorld.xz * 0.22 ).rgb;
          vec3 fine = texture2D( uDetailGrass, vDetailWorld.xz * 1.35 ).rgb;
          vec3 r = texture2D( uDetailRock, vDetailWorld.xz * 0.16 ).rgb;
          vec3 tex = mix( mix( g, fine, 0.4 ), r, slope );
          float lum = dot( tex, vec3( 0.299, 0.587, 0.114 ) );
          float mod = 1.0 + ( lum - 0.34 ) * 1.3;
          float nearFade = 1.0 - smoothstep( 10.0, 40.0, detailDist );
          diffuseColor.rgb *= mix( 1.0, mod, ( 0.45 + 0.3 * nearFade ) * detailFade );
        }
        // grana a media distanza: la foto Sentinel è a ~7 m/px e da lontano
        // diventa una macchia liscia; un rumore neutro le ridà un po' di
        // consistenza senza inventare confini di campo
        float grain = cloudNoise( vDetailWorld.xz * 0.045 ) * 0.6 + cloudNoise( vDetailWorld.xz * 0.11 + 7.0 ) * 0.4;
        float grainFade = smoothstep( 120.0, 320.0, detailDist );
        diffuseColor.rgb *= 1.0 + ( grain - 0.5 ) * 0.14 * grainFade;
        // ombre delle nuvole: due rumori sovrapposti che scorrono col vento
        if ( uCloudShadow > 0.01 ) {
          vec2 cp = vDetailWorld.xz * 0.0016 + uCloudDrift;
          float n = cloudNoise( cp ) * 0.65 + cloudNoise( cp * 2.7 + 13.0 ) * 0.35;
          float shade = smoothstep( 0.42, 0.78, n );
          diffuseColor.rgb *= 1.0 - 0.34 * uCloudShadow * shade;
        }`,
      );
  };
  material.customProgramCacheKey = () => 'terrain-detail-v3';
}

interface LandcoverUniformState {
  uLcBase: { value: THREE.Texture };
  uLcLocal: { value: THREE.Texture };
  uLcFields: { value: THREE.Texture };
  uLcDetail: { value: THREE.Texture };
  uLcNormal: { value: THREE.Texture };
  uLocalReady: { value: number };
  uFieldsReady: { value: number };
  uMicroReady: { value: number };
  uBaseScale: { value: THREE.Vector2 };
  uBaseOffset: { value: THREE.Vector2 };
  uLocalOrigin: { value: THREE.Vector2 };
  uLocalScale: { value: number };
  uSeasonGlobal: { value: THREE.Vector3 };
}

/**
 * Shader della Fase A: la copertura del suolo (coltivo/prato/bosco/roccia)
 * decide colore e grana, il satellite resta la base fotografica.
 *
 * Il dettaglio a 60 m e 6 m **non** è più calcolato per pixel: è cotto una
 * volta sola in `landcover.ts` in una texture di modulazione RGB (2 m/px locale,
 * 12 m/px globale), con le tinte relative di classe già dentro. Qui si fa un
 * solo campione e si moltiplica. La scala da 0,8 m resta dove serve davvero:
 * micro-rilievo normale sotto i 32 m e solchi delle parcelle sotto i 95 m.
 * La misura che ha imposto questa scelta è in `HANDOFF.md`: tre campioni di
 * dettaglio per pixel quasi dimezzavano gli fps sulla iGPU di prova.
 */
function applyLandcoverDetail(
  material: THREE.MeshStandardMaterial,
  landcover: Landcover,
  cx: number,
  cz: number,
): LandcoverUniformState {
  const base = landcover.baseTexture;
  if (!base) throw new Error('landcover senza overlay globale');
  const uniforms: LandcoverUniformState = {
    uLcBase: { value: base },
    // segnaposto finché il chunk non ha la sua overlay a 2 m/px: uLocalReady=0
    uLcLocal: { value: base },
    uLcFields: { value: landcover.fieldsTexture ?? base },
    uLcDetail: { value: landcover.detailTexture ?? base },
    uLcNormal: { value: landcover.microNormal },
    uLocalReady: { value: 0 },
    uFieldsReady: { value: landcover.fieldsTexture ? 1 : 0 },
    uMicroReady: { value: landcover.detailTexture ? 1 : 0 },
    uBaseScale: { value: new THREE.Vector2(1 / WORLD.width, 1 / WORLD.height) },
    uBaseOffset: { value: new THREE.Vector2(WORLD.halfWidth / WORLD.width, WORLD.halfHeight / WORLD.height) },
    uLocalOrigin: { value: new THREE.Vector2(chunkOrigin(cx), chunkOrigin(cz)) },
    uLocalScale: { value: 1 / CHUNK_SIZE },
    // stesso Vector3 mutato da `setSeason`: nessun rebuild dei materiali
    uSeasonGlobal: { value: landcover.seasonGlobalUniform },
  };
  material.userData.lc = uniforms;
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms, {
      uCloudShadow: cloudShadowUniform,
      uCloudDrift: cloudDriftUniform,
    });
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nvarying vec3 vDetailWorld;\nvarying vec3 vDetailNormal;',
      )
      .replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\nvDetailWorld = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;\nvDetailNormal = normalize( mat3( modelMatrix ) * objectNormal );',
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
varying vec3 vDetailWorld;
varying vec3 vDetailNormal;
uniform sampler2D uLcBase;
uniform sampler2D uLcLocal;
uniform sampler2D uLcFields;
uniform sampler2D uLcDetail;
uniform sampler2D uLcNormal;
uniform float uLocalReady;
uniform float uFieldsReady;
uniform float uMicroReady;
uniform vec2 uBaseScale;
uniform vec2 uBaseOffset;
uniform vec2 uLocalOrigin;
uniform float uLocalScale;
uniform vec3 uSeasonGlobal;
uniform float uCloudShadow;
uniform vec2 uCloudDrift;

float lcHash( vec2 p ) {
  return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453 );
}
float lcNoise( vec2 p ) {
  vec2 i = floor( p );
  vec2 f = fract( p );
  f = f * f * ( 3.0 - 2.0 * f );
  float a = lcHash( i );
  float b = lcHash( i + vec2( 1.0, 0.0 ) );
  float c = lcHash( i + vec2( 0.0, 1.0 ) );
  float d = lcHash( i + vec2( 1.0, 1.0 ) );
  return mix( mix( a, b, f.x ), mix( c, d, f.x ), f.y );
}`,
      )
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
        float lcDist = length( vDetailWorld - cameraPosition );
        vec2 lcBaseUV = vDetailWorld.xz * uBaseScale + uBaseOffset;
        // overaly cotta: RGB = modulazione * tinta relativa / 2, A = peso coltivo.
        // Locale a 2 m/px quando c'è, altrimenti la globale a 12 m/px.
        vec4 lc = uLocalReady > 0.5
          ? texture2D( uLcLocal, ( vDetailWorld.xz - uLocalOrigin ) * uLocalScale )
          : texture2D( uLcBase, lcBaseUV );
        // i bordi della mappa possono essere a zero: in quel caso non toccare
        float lcLum = max( lc.r, max( lc.g, lc.b ) );
        if ( lcLum > 0.004 ) {
          diffuseColor.rgb *= max( vec3( 0.0 ), lc.rgb * 2.0 * uSeasonGlobal );
          // dettaglio di colore a 0,8 m: un solo campione dei quattro canali
          // (coltivo/prato/bosco/roccia) scelto dal peso del coltivo in A.
          // Solo da vicino: a 150 m è mipmap e non aggiunge nulla.
          if ( uMicroReady > 0.5 && lcDist < 45.0 ) {
            vec4 dm = texture2D( uLcDetail, vDetailWorld.xz / 0.8 );
            float micro = mix( dm.g, dm.r, lc.a );
            float microFade = 1.0 - smoothstep( 18.0, 45.0, lcDist );
            diffuseColor.rgb *= 1.0 + ( micro - 0.5 ) * 0.55 * microFade;
          }
        }

        // solchi: direzione e forza della parcella, solo da vicino e sul coltivo
        if ( uFieldsReady > 0.5 && lcDist < 95.0 && lc.a > 0.02 ) {
          vec4 fld = texture2D( uLcFields, lcBaseUV );
          vec2 fdir = fld.rg * 2.0 - 1.0;
          float flen = length( fdir );
          fdir = flen > 0.01 ? fdir / flen : vec2( 1.0, 0.0 );
          float along = dot( vDetailWorld.xz, fdir );
          // ai piedi del campo la direzione è quasi radente: senza questa
          // soglia sulle derivate i solchi da 0,55 m diventano un moiré
          float aa = 1.0 - smoothstep( 0.12, 0.55, fwidth( along ) );
          float stripe = mix( 0.5, sin( along * 11.4 ) * 0.5 + 0.5, aa );
          float furrow = fld.b * fld.a * ( 1.0 - smoothstep( 18.0, 95.0, lcDist ) ) * lc.a;
          diffuseColor.rgb *= 1.0 + ( stripe - 0.5 ) * 0.34 * furrow;
          float clod = lcNoise( vDetailWorld.xz * 2.7 + fdir * along * 0.08 );
          diffuseColor.rgb *= 1.0 + ( clod - 0.5 ) * 0.12 * furrow;
        }

        if ( uCloudShadow > 0.01 ) {
          vec2 cp = vDetailWorld.xz * 0.0016 + uCloudDrift;
          float n = lcNoise( cp ) * 0.65 + lcNoise( cp * 2.7 + 13.0 ) * 0.35;
          float shade = smoothstep( 0.42, 0.78, n );
          diffuseColor.rgb *= 1.0 - 0.34 * uCloudShadow * shade;
        }`,
      )
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
        if ( lcDist < 38.0 ) {
          vec3 mn = texture2D( uLcNormal, vDetailWorld.xz / 0.8 ).xyz * 2.0 - 1.0;
          float mf = 1.0 - smoothstep( 12.0, 38.0, lcDist );
          normal = normalize( normal + vec3( mn.xy, 0.0 ) * 0.38 * mf );
        }`,
      );
  };
  material.customProgramCacheKey = () => 'terrain-landcover-v2';
  return uniforms;
}

/**
 * Streaming del terreno a chunk: geometria dal DEM, ritaglio del mosaico
 * Sentinel come base immediata per ogni chunk e tile Esri z17/z16 per il
 * dettaglio. Carica al massimo N chunk per frame, ordina per distanza e
 * libera quelli lontani.
 */
export class Terrain {
  readonly group = new THREE.Group();
  private readonly chunks = new Map<string, Chunk>();
  private readonly queue: { cx: number; cz: number; d: number }[] = [];
  private readonly heightfield: Heightfield;
  private readonly imagery: ImageryStreamer;
  private readonly landcover: Landcover | null;
  private readonly maxBuildPerFrame = 2;
  private readonly maxTextureLoads = 5;
  private readonly inflight = new Set<string>();
  /** tetto dello zoom satellite, abbassato dai preset grafici più leggeri */
  private maxZoom = 18;
  private focusX = 0;
  private focusZ = 0;
  private lastCx = Number.NaN;
  private lastCz = Number.NaN;
  private lastRadius = 0;

  constructor(
    heightfield: Heightfield,
    imagery: ImageryStreamer,
    private readonly renderer: THREE.WebGLRenderer,
    maxZoom = 18,
    landcover: Landcover | null = null,
  ) {
    this.heightfield = heightfield;
    this.imagery = imagery;
    this.landcover = landcover;
    this.maxZoom = Math.max(15, Math.min(18, maxZoom));
    this.group.name = 'terrain';
  }

  /** Copertura del suolo per la diagnostica e il banco prova. */
  get landcoverStats(): ReturnType<Landcover['stats']> | null {
    return this.landcover?.stats() ?? null;
  }

  /**
   * Cambia modalità/raggio della copertura a runtime (tasto G). Se cambia lo
   * shader o l'insieme delle texture locali, i chunk si ricostruiscono: la
   * geometria è la stessa, quindi il costo è una sola passata di build.
   */
  setLandcoverPreset(mode: LandcoverMode, radius: number): void {
    const lc = this.landcover;
    if (!lc) return;
    const beforeMode = lc.effectiveMode;
    const beforeRadius = lc.radiusMeters;
    lc.configure(mode, radius);
    if (lc.effectiveMode === beforeMode && lc.radiusMeters === beforeRadius) return;
    for (const [key, chunk] of [...this.chunks]) this.disposeChunk(chunk, key);
    this.queue.length = 0;
    this.lastCx = Number.NaN;
    this.lastCz = Number.NaN;
  }

  /** Tinta stagionale (1..12); ottobre è la stagione di partenza. */
  setSeason(month: number): void {
    this.landcover?.setSeason(month);
  }

  /** Cambia il tetto di dettaglio a runtime (tasto G / preset qualità). */
  setMaxZoom(zoom: number): void {
    this.maxZoom = Math.max(15, Math.min(18, zoom));
  }

  get loadedChunks(): number {
    return this.chunks.size;
  }

  get texturedChunks(): number {
    let n = 0;
    for (const c of this.chunks.values()) if (c.hasTexture) n++;
    return n;
  }

  /** Chunk con texture almeno z17 (per diagnostica e smoke test). */
  get detailedChunks(): number {
    let n = 0;
    for (const c of this.chunks.values()) if (c.textureZoom >= 17) n++;
    return n;
  }

  /** Costruisce subito i chunk entro un raggio (usato dalla schermata di caricamento). */
  async preload(x: number, z: number, radius = 1600): Promise<void> {
    this.update(x, z, radius, true);
    const start = performance.now();
    while ((this.queue.length > 0 || this.inflight.size > 0) && performance.now() - start < 4500) {
      this.buildNext();
      this.tick();
      await new Promise((r) => setTimeout(r, 8));
    }
  }

  update(x: number, z: number, radius = VIEW_RADIUS, force = false): void {
    this.focusX = x;
    this.focusZ = z;
    const cx = chunkIndex(x);
    const cz = chunkIndex(z);
    if (!force && cx === this.lastCx && cz === this.lastCz && Math.abs(radius - this.lastRadius) < 1) {
      return;
    }
    this.lastCx = cx;
    this.lastCz = cz;
    this.lastRadius = radius;

    const r = Math.ceil(radius / CHUNK_SIZE);
    const wanted = new Set<string>();
    this.queue.length = 0;

    for (let ix = cx - r; ix <= cx + r; ix++) {
      for (let iz = cz - r; iz <= cz + r; iz++) {
        const dx = chunkCenter(ix) - x;
        const dz = chunkCenter(iz) - z;
        const d = Math.hypot(dx, dz);
        if (d > radius + CHUNK_SIZE * 0.5) continue;
        const key = chunkKey(ix, iz);
        wanted.add(key);
        if (!this.chunks.has(key)) {
          this.queue.push({ cx: ix, cz: iz, d });
        }
      }
    }
    this.queue.sort((a, b) => a.d - b.d);

    for (const [key, chunk] of this.chunks) {
      if (!wanted.has(key)) this.disposeChunk(chunk, key);
    }
  }

  /** Da chiamare ogni frame: costruisce qualche chunk e affina le texture vicine. */
  tick(): void {
    for (let i = 0; i < this.maxBuildPerFrame && this.queue.length > 0; i++) {
      this.buildNext();
    }

    // il mosaico Sentinel è locale e sincrono: appena è decodificato dà una
    // texture vera anche ai chunk costruiti prima che finisse il caricamento
    if (this.imagery.hasBaseImage) {
      for (const chunk of this.chunks.values()) {
        if (chunk.disposed || chunk.texture) continue;
        const base = this.imagery.baseChunkTexture(chunk.cx, chunk.cz);
        if (base) this.applyBaseTexture(chunk, base);
      }
    }

    if (this.inflight.size >= this.maxTextureLoads) return;
    const upgrades: { chunk: Chunk; d: number; zoom: number }[] = [];
    for (const chunk of this.chunks.values()) {
      if (chunk.disposed || chunk.loadingZoom !== undefined) continue;
      if (this.inflight.has(chunkKey(chunk.cx, chunk.cz))) continue;
      const d = Math.hypot(chunkCenter(chunk.cx) - this.focusX, chunkCenter(chunk.cz) - this.focusZ);
      const zoom = Math.min(this.maxZoom, zoomForDistance(d));
      if (zoom > chunk.textureZoom) upgrades.push({ chunk, d, zoom });
    }
    upgrades.sort((a, b) => a.d - b.d);
    let started = 0;
    for (const u of upgrades) {
      if (started >= 2 || this.inflight.size >= this.maxTextureLoads) break;
      this.requestTexture(u.chunk, u.zoom);
      started++;
    }
  }

  private buildNext(): void {
    const next = this.queue.shift();
    if (!next) return;
    const key = chunkKey(next.cx, next.cz);
    if (this.chunks.has(key)) return;
    const chunk = this.buildChunk(next.cx, next.cz, next.d);
    this.chunks.set(key, chunk);
    this.group.add(chunk.mesh);
  }

  /** Applica il ritaglio Sentinel come texture di partenza (zoom 0 = da affinare). */
  private applyBaseTexture(chunk: Chunk, texture: THREE.Texture): void {
    chunk.texture = texture;
    chunk.textureZoom = 0;
    chunk.material.map = texture;
    chunk.material.color.set(0xffffff);
    chunk.material.needsUpdate = true;
    chunk.hasTexture = true;
  }

  private requestTexture(chunk: Chunk, zoom: number): void {
    if (chunk.disposed || chunk.loadingZoom !== undefined || chunk.textureZoom >= zoom) return;
    const key = chunkKey(chunk.cx, chunk.cz);
    if (this.inflight.has(key)) return;
    this.inflight.add(key);
    chunk.loadingZoom = zoom;

    this.imagery
      .loadChunkTexture(chunk.cx, chunk.cz, zoom)
      .then((texture) => {
        chunk.loadingZoom = undefined;
        this.inflight.delete(key);
        if (chunk.disposed || chunk.textureZoom >= zoom) {
          texture.dispose();
          return;
        }
        const previous = chunk.texture;
        chunk.texture = texture;
        chunk.textureZoom = zoom;
        chunk.material.map = texture;
        chunk.material.color.set(0xffffff);
        chunk.material.needsUpdate = true;
        chunk.hasTexture = true;
        previous?.dispose();
      })
      .catch(() => {
        chunk.loadingZoom = undefined;
        this.inflight.delete(key);
      });
  }

  private buildChunk(cx: number, cz: number, distance: number): Chunk {
    const centerX = chunkCenter(cx);
    const centerZ = chunkCenter(cz);

    const geometry = new THREE.PlaneGeometry(CHUNK_SIZE, CHUNK_SIZE, TERRAIN_SEGMENTS, TERRAIN_SEGMENTS);
    geometry.rotateX(-Math.PI / 2);
    const pos = geometry.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const wx = centerX + pos.getX(i);
      const wz = centerZ + pos.getZ(i);
      pos.setY(i, this.heightfield.heightAt(wx, wz));
    }
    pos.needsUpdate = true;
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();

    const normalMap = buildNormalMap(this.heightfield, cx, cz);
    const material = new THREE.MeshStandardMaterial({
      color: 0x7d8b5c,
      roughness: 1,
      metalness: 0,
      normalMap,
      normalScale: new THREE.Vector2(1.05, 1.05),
      roughnessMap: terrainDetailMap(),
      // il satellite è opaco: senza questo, il cielo si specchia radente e
      // sembra ghiaccio invece che prato/asfalto
      envMapIntensity: 0.35,
    });
    const landcoverMode = this.landcover?.effectiveMode ?? 'off';
    let landcoverUniforms: LandcoverUniformState | null = null;
    if (landcoverMode !== 'off' && this.landcover) {
      landcoverUniforms = applyLandcoverDetail(material, this.landcover, cx, cz);
    } else {
      applyTerrainDetail(material, this.renderer);
    }

    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(centerX, 0, centerZ);
    mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();

    const chunk: Chunk = {
      cx,
      cz,
      mesh,
      material,
      normalMap,
      textureZoom: 0,
      hasTexture: false,
      disposed: false,
      landcoverLocal: false,
    };

    // copertura locale a 2 m/px: arriva in asincrono, il chunk intanto usa la
    // mappa globale (12 m/px). Fuori dal raggio del preset non si scarica nulla.
    if (landcoverMode === 'full' && this.landcover && landcoverUniforms) {
      const lc = this.landcover;
      if (lc.covers(cx, cz, this.focusX, this.focusZ)) {
        chunk.landcoverLocal = true;
        const uniforms = landcoverUniforms;
        lc.acquire(cx, cz, (texture) => {
          if (chunk.disposed) return;
          uniforms.uLcLocal.value = texture;
          uniforms.uLocalReady.value = 1;
          material.needsUpdate = true;
        });
      }
    }

    // prima il ritaglio Sentinel locale (immediato), poi l'affinamento Esri
    const base = this.imagery.baseChunkTexture(cx, cz);
    if (base) this.applyBaseTexture(chunk, base);

    this.requestTexture(chunk, Math.min(this.maxZoom, zoomForDistance(distance)));
    return chunk;
  }

  private disposeChunk(chunk: Chunk, key: string): void {
    chunk.disposed = true;
    this.chunks.delete(key);
    this.inflight.delete(key);
    this.group.remove(chunk.mesh);
    chunk.mesh.geometry.dispose();
    chunk.material.dispose();
    chunk.normalMap.dispose();
    chunk.texture?.dispose();
    if (chunk.landcoverLocal) this.landcover?.release(chunk.cx, chunk.cz);
  }

  dispose(): void {
    for (const [key, chunk] of this.chunks) this.disposeChunk(chunk, key);
    this.queue.length = 0;
  }
}

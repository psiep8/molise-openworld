import * as THREE from 'three';
import { CHUNK_SIZE, TERRAIN_SEGMENTS, VIEW_RADIUS, WORLD } from '../config';
import type { Heightfield } from '../geo/elevation';
import { pointInPolygon } from '../geo/geo';
import type { Area, Road } from '../geo/osm';
import { chunkCenter, chunkIndex, chunkKey, chunkOrigin } from './chunks';
import type { Landcover, LandcoverMode } from './landcover';
import { roadPolyline } from './roads';

interface TunnelSegment {
  ax: number;
  az: number;
  bx: number;
  bz: number;
  radius: number;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

interface Chunk {
  cx: number;
  cz: number;
  mesh: THREE.Mesh;
  material: THREE.MeshStandardMaterial;
  normalMap: THREE.Texture;
  disposed: boolean;
  /** true se il chunk ha una texture di copertura locale da rilasciare */
  landcoverLocal: boolean;
  /** copertura locale già cotta, riusata quando si cambia preset senza ricostruire */
  localTexture?: THREE.Texture;
}

const NORMAL_MAP_SIZE = 128;
const NORMAL_STRENGTH = 2.6;
const HEIGHT_FOG_FRAGMENT = /* glsl */ `
#ifdef USE_FOG
  float heightDensityScale = exp( clamp( ( 420.0 - vDetailWorld.y ) * 0.0015, -1.5, 1.5 ) );
  #ifdef FOG_EXP2
    float fogFactor = 1.0 - exp( - fogDensity * fogDensity * heightDensityScale * vFogDepth * vFogDepth );
  #else
    float fogFactor = smoothstep( fogNear / heightDensityScale, fogFar / heightDensityScale, vFogDepth );
  #endif
  gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );
#endif
`;

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
 * Colore del terreno a grandi campiture, determinato da copertura OSM,
 * pendenza e rumore procedurale, senza immagini satellitari.
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

function applyTerrainDetail(material: THREE.MeshStandardMaterial, _renderer: THREE.WebGLRenderer): void {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uCloudShadow = cloudShadowUniform;
    shader.uniforms.uCloudDrift = cloudDriftUniform;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nattribute vec4 aTerrainCover;\nvarying vec4 vTerrainCover;\nvarying vec3 vDetailWorld;\nvarying vec3 vDetailNormal;',
      )
      .replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\nvTerrainCover = aTerrainCover;\nvDetailWorld = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;\nvDetailNormal = normalize( mat3( modelMatrix ) * objectNormal );',
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
varying vec3 vDetailWorld;
varying vec3 vDetailNormal;
varying vec4 vTerrainCover;
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
        float slope = smoothstep( 0.48, 0.78, 1.0 - clamp( normalize( vDetailNormal ).y, 0.0, 1.0 ) );
        vec4 cover = clamp( vTerrainCover, 0.0, 1.0 );
        float covered = clamp( dot( cover, vec4( 1.0 ) ), 0.0, 1.0 );
        float meadow = 1.0 - covered;
        vec3 meadowColor = vec3( 0.30, 0.39, 0.20 );
        vec3 cropColor = vec3( 0.56, 0.43, 0.20 );
        vec3 woodlandColor = vec3( 0.19, 0.29, 0.16 );
        vec3 scrubColor = vec3( 0.38, 0.37, 0.22 );
        vec3 bareColor = vec3( 0.43, 0.36, 0.27 );
        vec3 classColor = meadowColor * meadow + cropColor * cover.r +
          woodlandColor * cover.g + scrubColor * cover.b + bareColor * cover.a;
        vec3 flatColor = mix( classColor, bareColor, slope * ( 1.0 - cover.g * 0.55 ) );
        float macro = cloudNoise( vDetailWorld.xz * 0.021 );
        float fine = cloudNoise( vDetailWorld.xz * 0.31 );
        float rows = sin( dot( vDetailWorld.xz, normalize( vec2( 1.0, 0.36 ) ) ) * 0.33 + macro * 3.0 );
        float furrow = 1.0 + rows * 0.055 * cover.r;
        diffuseColor.rgb = flatColor * ( 0.76 + macro * 0.3 ) * ( 0.92 + fine * 0.12 ) * furrow;
        // ombre delle nuvole: due rumori sovrapposti che scorrono col vento
        if ( uCloudShadow > 0.01 ) {
          vec2 cp = vDetailWorld.xz * 0.0016 + uCloudDrift;
          float n = cloudNoise( cp ) * 0.65 + cloudNoise( cp * 2.7 + 13.0 ) * 0.35;
          float shade = smoothstep( 0.42, 0.78, n );
          diffuseColor.rgb *= 1.0 - 0.34 * uCloudShadow * shade;
        }`,
      )
      .replace('#include <fog_fragment>', HEIGHT_FOG_FRAGMENT);
  };
  material.customProgramCacheKey = () => 'terrain-geographic-cover-v2';
}

export type TerrainCoverWeights = readonly [crop: number, woodland: number, scrub: number, bare: number];

const TERRAIN_COVER: Readonly<Record<string, { priority: number; weights: TerrainCoverWeights }>> = {
  wood: { priority: 3, weights: [0, 1, 0, 0] },
  forest: { priority: 3, weights: [0, 1, 0, 0] },
  orchard: { priority: 3, weights: [0.42, 0.58, 0, 0] },
  farmland: { priority: 2, weights: [1, 0, 0, 0] },
  farm: { priority: 2, weights: [1, 0, 0, 0] },
  vineyard: { priority: 2, weights: [1, 0, 0, 0] },
  allotments: { priority: 2, weights: [1, 0, 0, 0] },
  scrub: { priority: 1, weights: [0, 0, 1, 0] },
  heath: { priority: 1, weights: [0, 0, 1, 0] },
  quarry: { priority: 4, weights: [0, 0, 0, 1] },
  farmyard: { priority: 4, weights: [0, 0, 0, 1] },
  industrial: { priority: 4, weights: [0, 0, 0, 1] },
  residential: { priority: 4, weights: [0, 0, 0, 1] },
  water: { priority: 4, weights: [0, 0, 0, 1] },
};

/** Classifica il terreno usando le aree georeferenziate OSM, senza imagery. */
export function terrainCoverWeightsAt(x: number, z: number, areas: readonly Area[]): TerrainCoverWeights {
  let selected: { priority: number; weights: TerrainCoverWeights } | null = null;
  for (const area of areas) {
    const cover = TERRAIN_COVER[area.kind];
    if (
      !cover ||
      cover.priority <= (selected?.priority ?? 0) ||
      x < area.bounds.minX ||
      x > area.bounds.maxX ||
      z < area.bounds.minZ ||
      z > area.bounds.maxZ ||
      !pointInPolygon(x, z, area.points)
    ) {
      continue;
    }
    selected = cover;
  }
  return selected?.weights ?? [0, 0, 0, 0];
}

function applyTerrainCover(
  geometry: THREE.BufferGeometry,
  centerX: number,
  centerZ: number,
  areas: readonly Area[],
): void {
  const position = geometry.getAttribute('position');
  const weights = new Float32Array(position.count * 4);
  const half = CHUNK_SIZE * 0.5;
  const candidates = areas.filter(
    (area) =>
      TERRAIN_COVER[area.kind] &&
      area.bounds.maxX >= centerX - half &&
      area.bounds.minX <= centerX + half &&
      area.bounds.maxZ >= centerZ - half &&
      area.bounds.minZ <= centerZ + half,
  );
  for (let i = 0; i < position.count; i++) {
    const cover = terrainCoverWeightsAt(centerX + position.getX(i), centerZ + position.getZ(i), candidates);
    weights.set(cover, i * 4);
  }
  geometry.setAttribute('aTerrainCover', new THREE.Float32BufferAttribute(weights, 4));
}

interface LandcoverUniformState {
  uLcBase: { value: THREE.Texture };
  uLcLocal: { value: THREE.Texture };
  uLocalReady: { value: number };
  uBaseScale: { value: THREE.Vector2 };
  uBaseOffset: { value: THREE.Vector2 };
  uLocalOrigin: { value: THREE.Vector2 };
  uLocalScale: { value: number };
  uWorldHalfBounds: { value: THREE.Vector2 };
  uSeasonGlobal: { value: THREE.Vector3 };
  /** grana fotografica 0,8 m per classe (coltivo, prato, bosco, roccia) */
  uLcDetail: { value: THREE.Texture };
  /** direzione dei solchi (RG) e forza dell'aratura (B) */
  uLcFields: { value: THREE.Texture };
}

/**
 * Shader della copertura ESA/OSM: le classi di terreno decidono colore e
 * grana. Le immagini raster sono esclusivamente dati di classificazione,
 * non fotografie satellitari campionate nel terreno.
 */
function applyLandcoverDetail(
  material: THREE.MeshStandardMaterial,
  landcover: Landcover,
  cx: number,
  cz: number,
  _renderer: THREE.WebGLRenderer,
): LandcoverUniformState {
  const base = landcover.baseTexture;
  if (!base) throw new Error('landcover senza overlay globale');
  const uniforms: LandcoverUniformState = {
    uLcBase: { value: base },
    uLcLocal: { value: base },
    uLocalReady: { value: 0 },
    uBaseScale: { value: new THREE.Vector2(1 / WORLD.width, 1 / WORLD.height) },
    uBaseOffset: { value: new THREE.Vector2(WORLD.halfWidth / WORLD.width, WORLD.halfHeight / WORLD.height) },
    uLocalOrigin: { value: new THREE.Vector2(chunkOrigin(cx), chunkOrigin(cz)) },
    uLocalScale: { value: 1 / CHUNK_SIZE },
    uWorldHalfBounds: { value: new THREE.Vector2(WORLD.halfWidth, WORLD.halfHeight) },
    uSeasonGlobal: { value: landcover.seasonGlobalUniform },
    uLcDetail: { value: landcover.detailTexture ?? base },
    uLcFields: { value: landcover.fieldsTexture ?? base },
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
uniform float uLocalReady;
uniform vec2 uBaseScale;
uniform vec2 uBaseOffset;
uniform vec2 uLocalOrigin;
uniform float uLocalScale;
uniform vec2 uWorldHalfBounds;
uniform vec3 uSeasonGlobal;
uniform sampler2D uLcDetail;
uniform sampler2D uLcFields;
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
        vec2 lcBaseUV = vDetailWorld.xz * uBaseScale + uBaseOffset;
        vec4 lc = uLocalReady > 0.5
          ? texture2D( uLcLocal, ( vDetailWorld.xz - uLocalOrigin ) * uLocalScale )
          : texture2D( uLcBase, lcBaseUV );
        float lcCoverage = step( 0.004, lc.r + lc.g + lc.b + lc.a );
        float rockWeight = lc.a;
        vec3 cropColor = vec3( 0.64, 0.53, 0.31 );
        vec3 grassColor = vec3( 0.38, 0.48, 0.30 );
        vec3 forestColor = vec3( 0.25, 0.35, 0.22 );
        vec3 soilColor = vec3( 0.49, 0.41, 0.29 );
        vec3 classColor = lc.r * cropColor + lc.g * grassColor + lc.b * forestColor + rockWeight * soilColor;
        float lcMacro = lcNoise( vDetailWorld.xz * 0.07 );
        vec3 mappedColor = classColor * ( 0.9 + ( lcMacro - 0.5 ) * 0.16 ) * uSeasonGlobal;

        // Grana procedurale per classe e solchi dei campi, senza fotografia.
        vec4 lcDetail = texture2D( uLcDetail, vDetailWorld.xz * 0.22 );
        float lcDetailValue = dot( lcDetail, lc );
        vec4 lcField = texture2D( uLcFields, lcBaseUV );
        vec2 lcFieldDir = lcField.rg * 2.0 - 1.0;
        float lcFurrow = sin( dot( vDetailWorld.xz, lcFieldDir ) * 1.7 + lcNoise( vDetailWorld.xz * 0.08 ) * 2.0 );
        float lcFine = lcNoise( vDetailWorld.xz * 1.35 );
        mappedColor *= ( 0.82 + 0.36 * lcDetailValue ) * ( 0.93 + 0.14 * lcMacro ) * ( 0.98 + 0.04 * lcFine );
        mappedColor *= 1.0 + lcFurrow * 0.055 * lcField.b;
        // zero fotografia: la classificazione del suolo è l'unica sorgente.
        // Gli asset 3D (zolle, grano, fango) coprono il primo piano.

        bool outsideGeo = abs( vDetailWorld.x ) > uWorldHalfBounds.x || abs( vDetailWorld.z ) > uWorldHalfBounds.y;
        if ( outsideGeo ) {
          vec2 fieldCell = floor( vDetailWorld.xz / 280.0 );
          float fieldClass = lcHash( fieldCell );
          float crop = smoothstep( 0.32, 0.58, fieldClass ) * ( 1.0 - smoothstep( 0.82, 0.96, fieldClass ) );
          float woodland = smoothstep( 0.82, 0.96, fieldClass );
          float fieldNoise = lcNoise( vDetailWorld.xz * 0.003 + fieldCell * 0.31 );
          vec3 proceduralColor = mix( grassColor, cropColor, crop );
          proceduralColor = mix( proceduralColor, forestColor, woodland );
          mappedColor = proceduralColor * ( 0.9 + ( fieldNoise - 0.5 ) * 0.08 ) * uSeasonGlobal;
          lcCoverage = 1.0;
        }
        diffuseColor.rgb = mix( diffuseColor.rgb, mappedColor, lcCoverage );

        if ( uCloudShadow > 0.01 ) {
          vec2 cp = vDetailWorld.xz * 0.0016 + uCloudDrift;
          float n = lcNoise( cp ) * 0.65 + lcNoise( cp * 2.7 + 13.0 ) * 0.35;
          float shade = smoothstep( 0.42, 0.78, n );
          diffuseColor.rgb *= 1.0 - 0.34 * uCloudShadow * shade;
        }`,
      )
      .replace('#include <fog_fragment>', HEIGHT_FOG_FRAGMENT);
  };
  material.customProgramCacheKey = () => 'terrain-pastel-landcover-v6';
  return uniforms;
}

/**
 * Streaming del terreno a chunk: geometria dal DEM e copertura georeferenziata
 * OSM/ESA, senza mosaico satellitare. Carica al massimo N chunk per frame,
 * ordina per distanza e libera quelli lontani.
 */
export class Terrain {
  readonly group = new THREE.Group();
  private readonly chunks = new Map<string, Chunk>();
  private readonly queue: { cx: number; cz: number; d: number }[] = [];
  /** chunk da re-materializzare dopo un cambio di copertura del suolo */
  private readonly remat: Chunk[] = [];
  private readonly heightfield: Heightfield;
  private readonly landcover: Landcover | null;
  private readonly tunnelSegments: TunnelSegment[];
  private readonly areas: readonly Area[];
  private readonly maxBuildPerFrame = 2;
  private focusX = 0;
  private focusZ = 0;
  private lastCx = Number.NaN;
  private lastCz = Number.NaN;
  private lastRadius = 0;

  constructor(
    heightfield: Heightfield,
    private readonly renderer: THREE.WebGLRenderer,
    landcover: Landcover | null = null,
    tunnels: readonly Road[] = [],
    areas: readonly Area[] = [],
  ) {
    this.heightfield = heightfield;
    this.landcover = landcover;
    this.areas = areas;
    this.tunnelSegments = tunnels.flatMap((road) => {
      const line = roadPolyline(road);
      const radius = road.width * 0.5 + 1.1;
      return line.slice(1).map((point, index) => {
        const previous = line[index]!;
        return {
          ax: previous.x,
          az: previous.z,
          bx: point.x,
          bz: point.z,
          radius,
          minX: Math.min(previous.x, point.x) - radius,
          maxX: Math.max(previous.x, point.x) + radius,
          minZ: Math.min(previous.z, point.z) - radius,
          maxZ: Math.max(previous.z, point.z) + radius,
        };
      });
    });
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

    // Un cambio di preset non deve distruggere il mondo: prima si liberavano
    // TUTTI i chunk (e le loro texture di copertura) e la scena restava vuota
    // per decine di secondi. Ora:
    // - se cambia solo il raggio (media → alta → ultra) non si tocca niente:
    //   i chunk nuovi nascono col raggio nuovo, i vecchi restano;
    // - se cambia il modo si rifà solo il materiale, qualche chunk per frame,
    //   riusando geometria e copertura. Nessun buco e nessun frame da 5 s.
    if (lc.effectiveMode === beforeMode) {
      // il raggio è cambiato: i chunk che stanno sul nuovo bordo devono
      // acquistare o restituire la texture locale, ma solo quelli. Senza
      // questo, alzando il raggio la fascia esterna restava senza dettaglio.
      if (lc.effectiveMode === 'full' && lc.radiusMeters !== beforeRadius) {
        for (const chunk of this.chunks.values()) {
          const covered = lc.covers(chunk.cx, chunk.cz, this.focusX, this.focusZ);
          if (covered !== chunk.landcoverLocal && !this.remat.includes(chunk)) {
            this.remat.push(chunk);
          }
        }
      }
      return;
    }
    this.queue.length = 0;
    this.lastCx = Number.NaN;
    this.lastCz = Number.NaN;
    for (const chunk of this.chunks.values()) {
      if (!this.remat.includes(chunk)) this.remat.push(chunk);
    }
  }

  /** Tinta stagionale (1..12); ottobre è la stagione di partenza. */
  setSeason(month: number): void {
    this.landcover?.setSeason(month);
  }

  get loadedChunks(): number {
    return this.chunks.size;
  }

  get coveredChunks(): number {
    let covered = 0;
    for (const chunk of this.chunks.values()) {
      if (chunk.mesh.geometry.getAttribute('aTerrainCover')) covered++;
    }
    return covered;
  }

  /** Costruisce subito i chunk entro un raggio (usato dalla schermata di caricamento). */
  async preload(x: number, z: number, radius = 1600): Promise<void> {
    this.update(x, z, radius, true);
    const start = performance.now();
    while (this.queue.length > 0 && performance.now() - start < 4500) {
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

  /**
   * Aggiorna in place i chunk caricati dopo l'arrivo o la rimozione di quote DEM.
   *
   * Prima si distruggeva tutto e si ricostruiva due chunk per frame: per un
   * istante il terreno spariva e la telecamera cadeva nel vuoto. Le quote
   * cambiano solo fuori dal DEM locale, quindi basta spostare i vertici,
   * ricalcolare le normali e rigenerare la normal map.
   */
  refreshElevation(): void {
    for (const chunk of this.chunks.values()) {
      if (chunk.disposed) continue;
      const centerX = chunkCenter(chunk.cx);
      const centerZ = chunkCenter(chunk.cz);
      const geometry = chunk.mesh.geometry;
      const pos = geometry.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < pos.count; i++) {
        const wx = centerX + pos.getX(i);
        const wz = centerZ + pos.getZ(i);
        pos.setY(i, this.heightfield.heightAt(wx, wz));
      }
      pos.needsUpdate = true;
      geometry.computeVertexNormals();
      geometry.computeBoundingSphere();

      const normalMap = buildNormalMap(this.heightfield, chunk.cx, chunk.cz);
      chunk.normalMap.dispose();
      chunk.normalMap = normalMap;
      chunk.material.normalMap = normalMap;
      chunk.material.needsUpdate = true;
    }
  }

  /** Da chiamare ogni frame: costruisce qualche chunk e affina la copertura vicina. */
  tick(): void {
    for (let i = 0; i < this.maxBuildPerFrame && this.queue.length > 0; i++) {
      this.buildNext();
    }

    // ricambio graduale del materiale dopo un cambio di copertura del suolo:
    // pochi chunk per frame, i più vicini per primi, senza buchi nel terreno
    if (this.remat.length > 0) {
      this.remat.sort(
        (a, b) =>
          Math.hypot(chunkCenter(a.cx) - this.focusX, chunkCenter(a.cz) - this.focusZ) -
          Math.hypot(chunkCenter(b.cx) - this.focusX, chunkCenter(b.cz) - this.focusZ),
      );
      for (let i = 0; i < this.maxBuildPerFrame && this.remat.length > 0; i++) {
        const chunk = this.remat.shift()!;
        if (!chunk.disposed) this.rematerialize(chunk);
      }
    }

  }

  private buildNext(): void {
    const next = this.queue.shift();
    if (!next) return;
    const key = chunkKey(next.cx, next.cz);
    if (this.chunks.has(key)) return;
    const chunk = this.buildChunk(next.cx, next.cz);
    this.chunks.set(key, chunk);
    this.group.add(chunk.mesh);
  }

  private buildChunk(cx: number, cz: number): Chunk {
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
    if (this.tunnelSegments.length) {
      const sourceIndex = geometry.getIndex();
      if (sourceIndex) {
        const indices: number[] = [];
        const gridStep = CHUNK_SIZE / TERRAIN_SEGMENTS;
        const nearby = this.tunnelSegments.filter(
          (segment) =>
            segment.maxX >= centerX - CHUNK_SIZE * 0.5 &&
            segment.minX <= centerX + CHUNK_SIZE * 0.5 &&
            segment.maxZ >= centerZ - CHUNK_SIZE * 0.5 &&
            segment.minZ <= centerZ + CHUNK_SIZE * 0.5,
        );
        const insideTunnel = (x: number, z: number): boolean =>
          nearby.some((segment) => {
            if (
              x < segment.minX - gridStep ||
              x > segment.maxX + gridStep ||
              z < segment.minZ - gridStep ||
              z > segment.maxZ + gridStep
            ) return false;
            const dx = segment.bx - segment.ax;
            const dz = segment.bz - segment.az;
            const length2 = dx * dx + dz * dz || 1e-8;
            const t = Math.max(0, Math.min(1, ((x - segment.ax) * dx + (z - segment.az) * dz) / length2));
            const ox = x - segment.ax - dx * t;
            const oz = z - segment.az - dz * t;
            return ox * ox + oz * oz <= (segment.radius + gridStep * 0.1) ** 2;
          });
        for (let i = 0; i < sourceIndex.count; i += 3) {
          const a = sourceIndex.getX(i);
          const b = sourceIndex.getX(i + 1);
          const c = sourceIndex.getX(i + 2);
          const x = centerX + (pos.getX(a) + pos.getX(b) + pos.getX(c)) / 3;
          const z = centerZ + (pos.getZ(a) + pos.getZ(b) + pos.getZ(c)) / 3;
          if (insideTunnel(x, z)) continue;
          indices.push(a, b, c);
        }
        geometry.setIndex(indices);
      }
    }
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
    applyTerrainCover(geometry, centerX, centerZ, this.areas);

    const normalMap = buildNormalMap(this.heightfield, cx, cz);
    const material = new THREE.MeshStandardMaterial({
      color: 0x7d8b5c,
      roughness: 1,
      metalness: 0,
      normalMap,
      normalScale: new THREE.Vector2(1.05, 1.05),
      // il terreno pastello è opaco e ruvido, senza grana speculare artificiale
      envMapIntensity: 0.35,
    });
    const landcoverMode = this.landcover?.effectiveMode ?? 'off';
    let landcoverUniforms: LandcoverUniformState | null = null;
    if (landcoverMode !== 'off' && this.landcover) {
      landcoverUniforms = applyLandcoverDetail(material, this.landcover, cx, cz, this.renderer);
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
          chunk.localTexture = texture;
          // il materiale può essere cambiato nel frattempo (preset grafico):
          // si scrivono gli uniform del materiale corrente, non di quello
          // catturato quando è partito il caricamento
          const current = chunk.material.userData.lc as LandcoverUniformState | undefined;
          if (current) {
            current.uLcLocal.value = texture;
            current.uLocalReady.value = 1;
          } else {
            uniforms.uLcLocal.value = texture;
            uniforms.uLocalReady.value = 1;
          }
          chunk.material.needsUpdate = true;
        });
      }
    }

    return chunk;
  }

  /**
   * Rifà solo il materiale di un chunk, senza ricostruire geometria e senza
   * preservando la geometria e gli attributi di copertura georeferenziati.
   */
  private rematerialize(chunk: Chunk): void {
    const lc = this.landcover;
    const old = chunk.material;
    const mode = lc?.effectiveMode ?? 'off';
    const material = new THREE.MeshStandardMaterial({
      color: old.color.clone(),
      roughness: old.roughness,
      metalness: old.metalness,
      normalMap: chunk.normalMap,
      normalScale: old.normalScale.clone(),
      envMapIntensity: old.envMapIntensity,
    });
    let uniforms: LandcoverUniformState | null = null;
    if (mode !== 'off' && lc) {
      try {
        uniforms = applyLandcoverDetail(material, lc, chunk.cx, chunk.cz, this.renderer);
      } catch {
        // copertura non ancora decodificata: si resta sul dettaglio semplice
        applyTerrainDetail(material, this.renderer);
      }
    } else {
      applyTerrainDetail(material, this.renderer);
    }
    chunk.material = material;
    chunk.mesh.material = material;

    if (mode === 'full' && lc && uniforms && lc.covers(chunk.cx, chunk.cz, this.focusX, this.focusZ)) {
      if (chunk.landcoverLocal && chunk.localTexture) {
        uniforms.uLcLocal.value = chunk.localTexture;
        uniforms.uLocalReady.value = 1;
      } else if (!chunk.landcoverLocal) {
        chunk.landcoverLocal = true;
        lc.acquire(chunk.cx, chunk.cz, (texture) => {
          if (chunk.disposed) return;
          chunk.localTexture = texture;
          const current = chunk.material.userData.lc as LandcoverUniformState | undefined;
          if (!current) return;
          current.uLcLocal.value = texture;
          current.uLocalReady.value = 1;
          chunk.material.needsUpdate = true;
        });
      }
    } else if (chunk.landcoverLocal) {
      lc?.release(chunk.cx, chunk.cz);
      chunk.landcoverLocal = false;
      chunk.localTexture = undefined;
    }

    old.dispose();
  }

  private disposeChunk(chunk: Chunk, key: string): void {
    chunk.disposed = true;
    this.chunks.delete(key);
    this.group.remove(chunk.mesh);
    chunk.mesh.geometry.dispose();
    chunk.material.dispose();
    chunk.normalMap.dispose();
    chunk.localTexture = undefined;
    if (chunk.landcoverLocal) this.landcover?.release(chunk.cx, chunk.cz);
  }

  dispose(): void {
    for (const [key, chunk] of this.chunks) this.disposeChunk(chunk, key);
    this.queue.length = 0;
    this.remat.length = 0;
  }
}

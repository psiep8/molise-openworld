import * as THREE from 'three';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { vehiclePassSnippet, vehiclePassUniforms, windUniforms } from '../gfx/wind';

/**
 * World kit: i GLB di vegetazione, case e arredo consegnati dal proprietario.
 *
 * Differenza sostanziale con il *city kit* (`world/citykit.ts`): questi file
 * **sono nel repository** (`public/worldkit/`, ~50 MB) e vengono caricati a ogni
 * avvio, non solo su una macchina dove qualcuno ha lanciato uno script di
 * download. Sono il materiale con cui si riempie la campagna: alberi veri,
 * ciuffi d'erba fotografati, sassi, cartelli, una casa di campagna.
 *
 * Come sono fatti i file (`scripts/import-world-glb.mjs`):
 *  - geometria semplificata, quantizzata e compressa con meshopt (decoder
 *    incluso in three, nessuna cartella `public/draco/` da scaricare);
 *  - texture webp ridotte (512–1024 px), quindi niente 4K per un sasso;
 *  - molti modelli condividono un file (i pack di vegetazione): il manifest dice
 *    quali nodi sono un albero e quali un cespuglio, così un solo download
 *    riempie decine di varianti.
 *
 * La normalizzazione è in metri: ogni modello viene portato all'altezza reale
 * dichiarata nel manifest (`height`), con la base a y = 0 e il centro in x/z.
 * Il piazzamento può quindi ragionare su ingombri veri senza sapere nulla dei
 * file: un albero è alto 9 m, un sasso 1,2 m.
 */

export type WorldRole =
  | 'tree'
  | 'shrub'
  | 'tree-distant'
  | 'rock'
  | 'grass'
  | 'grass-hero'
  | 'sign'
  | 'house'
  | 'ground'
  | 'field'
  | 'bale'
  | 'village'
  | 'sidewalk'
  | 'curb'
  | 'guardrail'
  | 'streetlight'
  | 'bridge'
  | 'spare';

export interface WorldCredit {
  title: string;
  author: string;
  license: string;
  source: string;
}

export interface WorldModelEntry {
  slug: string;
  name: string;
  role: WorldRole;
  file: string;
  nodes: string[];
  height: number;
  width: number;
  depth: number;
  triangles: number;
  bytes: number;
  usage: 'placed' | 'reserve';
  /**
   * Come normalizzare il modello: `height` per alberi e case, `footprint` per
   * le fotogrammetrie di terreno quasi piatte. Senza questo un piano da 602 m
   * diviso per un'altezza di 1 mm diventerebbe largo centinaia di chilometri.
   */
  normalize?: 'height' | 'footprint';
  /** dimensione orizzontale target quando `normalize === 'footprint'` */
  scaleTo?: number;
  /** CC BY-NC: escluso dalle build commerciali (`VITE_COMMERCIAL_BUILD=1`). */
  nonCommercial?: boolean;
  /** asset unico ad alta densità: il runtime ne piazza al massimo un esemplare */
  hero?: boolean;
  credits: WorldCredit;
}

export interface WorldSpot {
  x: number;
  y: number;
  z: number;
  /** rotazione su Y; il modello guarda +Z quando yaw = 0 */
  yaw: number;
  /** moltiplicatore sull'altezza dichiarata (0,8 = modello all'80%) */
  scale?: number;
  variant?: number;
}

export interface WorldPart {
  name: string;
  geometry: THREE.BufferGeometry;
  material: THREE.MeshStandardMaterial;
  castShadow: boolean;
}

export interface WorldAsset {
  slug: string;
  role: WorldRole;
  name: string;
  /** dimensioni reali dopo la normalizzazione (metri) */
  size: THREE.Vector3;
  /** triangoli della variante: serve al piazzamento per scegliere quelle leggere */
  triangles: number;
  /** asset unico ad alta densità (fotogrammetria di fili d'erba) */
  hero?: boolean;
  parts: WorldPart[];
}

/** Ruoli che ondeggiano col vento condiviso (velocità e direzione dal meteo). */
const WIND_ROLES: ReadonlySet<WorldRole> = new Set([
  'tree',
  'shrub',
  'grass',
  'grass-hero',
  'field',
  'sign',
]);
/** Ruoli che si piegano quando l'auto li prende: il sasso, la terra e la casa no. */
const HIT_ROLES: ReadonlySet<WorldRole> = new Set(['tree', 'shrub', 'field', 'sign']);

/** Uniform di bagnato di tutti i materiali del kit, pilotati dalla pioggia. */
const wetUniforms: THREE.IUniform<number>[] = [];
/** Uniform di neve posata (0…1): imbianca le superfici rivolte in alto. */
const snowUniforms: THREE.IUniform<number>[] = [];

/**
 * Bagnato 0…1 su tutto il kit: la pioggia scurisce e lucida anche i GLB
 * importati, non solo l'asfalto. Stessa scala di `applyWetness` del gioco.
 */
export function setWorldKitWetness(wet: number): void {
  const value = Number.isFinite(wet) ? Math.min(1, Math.max(0, wet)) : 0;
  for (const uniform of wetUniforms) uniform.value = value;
}

/**
 * Neve posata 0…1 su tutto il kit: chiome, sassi e tetti si imbiancano sulle
 * superfici che guardano in alto, come fa il terreno. Le superfici verticali
 * (tronchi, pali, muri) restano scure.
 */
export function setWorldKitSnow(snow: number): void {
  const value = Number.isFinite(snow) ? Math.min(1, Math.max(0, snow)) : 0;
  for (const uniform of snowUniforms) uniform.value = value;
}

/** Materiali che non devono proiettare ombre: card, decal, vetri. */
function castsShadow(role: WorldRole, material: THREE.Material): boolean {
  if (role === 'grass' || role === 'grass-hero' || role === 'shrub' || role === 'field' || role === 'ground') {
    return false;
  }
  if (material.transparent) return false;
  return true;
}

/**
 * Superficie dei GLB: vento, urto e bagnato, tutto in un solo `onBeforeCompile`
 * (two `onBeforeCompile` sullo stesso materiale si sovrascriverebbero).
 *
 * - **vento**: lo stesso uniform condiviso di erba e chiome (`gfx/wind.ts`),
 *   alimentato da velocità e direzione del meteo reale. La base resta ferma,
 *   la punta si muove.
 * - **urto**: ogni istanza ha `aHit = (inizio, forza, dx, dz)`. Quando l'auto
 *   prende un albero o un cartello, `world/world-hits.ts` scrive il proprio
 *   indice e lo shader lo fa oscillare smorzando in ~1 s. Nessuna matrice da
 *   riscrivere a ogni frame: si aggiorna solo l'attributo dell'istanza colpita.
 * - **bagnato**: `uKitWet` scurisce e abbassa la rugosità quando piove, sulla
 *   stessa scala dell'asfalto.
 *
 * Altezze e ampiezze sono uniform, non costanti nello shader, così tutte le
 * varianti di un ruolo condividono un solo programma compilato.
 */
function applySurface(material: THREE.MeshStandardMaterial, role: WorldRole, height: number): void {
  const { uTime, uWind } = windUniforms();
  const wet: THREE.IUniform<number> = { value: 0 };
  wetUniforms.push(wet);
  const snow: THREE.IUniform<number> = { value: 0 };
  snowUniforms.push(snow);
  // esposto per diagnostica: dal browser si legge bagnato e neve veri
  const store = material.userData as { kitWet?: THREE.IUniform<number>; kitSnow?: THREE.IUniform<number> };
  store.kitWet = wet;
  store.kitSnow = snow;
  // sasso, terra e casa non ondeggiano: hanno comunque bisogno del bagnato
  const sway = !WIND_ROLES.has(role)
    ? 0
    : role === 'grass' || role === 'grass-hero'
      ? 1.1
      : role === 'shrub'
        ? 0.55
        : role === 'field'
          ? 0.7
          : role === 'sign'
            ? 0.05
            : 0.4;
  const hit = HIT_ROLES.has(role);
  const pass = role === 'grass' || role === 'grass-hero' || role === 'shrub' || role === 'field';
  // le zolle di terra devono stare sopra il triangolo del DEM senza
  // z-fighting: è l'unico ruolo che vive a pochi centimetri dal terreno
  if (role === 'ground') {
    material.polygonOffset = true;
    material.polygonOffsetFactor = -2;
    material.polygonOffsetUnits = -4;
  }
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uTime;
    shader.uniforms.uWind = uWind;
    shader.uniforms.uKitHeight = { value: height };
    shader.uniforms.uKitSway = { value: sway };
    shader.uniforms.uKitWet = wet;
    shader.uniforms.uKitSnow = snow;
    if (pass) Object.assign(shader.uniforms, vehiclePassUniforms());
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform float uTime;
        uniform vec2 uWind;
        uniform float uKitHeight;
        uniform float uKitSway;${hit ? '\n        attribute vec4 aHit;' : ''}${pass ? '\n        uniform vec2 uCarPos;\n        uniform float uCarSpeed;' : ''}`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        #ifdef USE_INSTANCING
          vec3 kitPos = vec3( instanceMatrix[ 3 ][ 0 ], instanceMatrix[ 3 ][ 1 ], instanceMatrix[ 3 ][ 2 ] );
        #else
          vec3 kitPos = vec3( 0.0 );
        #endif
        float kitBend = clamp( position.y / max( uKitHeight, 0.05 ), 0.0, 1.0 );
        float kitPhase = kitPos.x * 0.37 + kitPos.z * 0.29;
        float kitSway = sin( uTime * 1.7 + kitPhase ) * 0.06 + sin( uTime * 3.1 + kitPhase * 1.6 ) * 0.022;
        transformed.x += kitSway * uKitSway * kitBend * kitBend * uWind.x;
        transformed.z += kitSway * uKitSway * kitBend * kitBend * uWind.y;${
          hit
            ? `
        float kitHitAge = uTime - aHit.x;
        if ( aHit.y > 0.0 ) {
          float kitHitWave = sin( kitHitAge * 26.0 ) * exp( -kitHitAge * 4.0 ) * aHit.y;
          float kitHitAmp = 0.05 * uKitHeight * ( 0.3 + kitBend * 0.7 );
          transformed.x += aHit.z * kitHitWave * kitHitAmp;
          transformed.z += aHit.w * kitHitWave * kitHitAmp;
        }`
            : ''
        }${pass ? vehiclePassSnippet('kitPos', 'kitBend', 'uKitHeight') : ''}`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uKitWet;\nuniform float uKitSnow;')
      .replace(
        '#include <map_fragment>',
        '#include <map_fragment>\ndiffuseColor.rgb *= mix( 1.0, 0.62, uKitWet );',
      )
      // la neve ha bisogno della normale vera, che esiste solo dopo
      // `normal_fragment_begin`: lì si tinge la superficie e si alza la
      // rugosità (una foglia innevata non è lucida)
      .replace(
        '#include <normal_fragment_begin>',
        `#include <normal_fragment_begin>
        vec3 kitNormalWorld = normalize( ( vec4( normal, 0.0 ) * viewMatrix ).xyz );
        float kitSnow = uKitSnow * smoothstep( 0.15, 0.75, kitNormalWorld.y );
        diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.93, 0.95, 0.99 ), kitSnow * 0.85 );
        roughnessFactor = mix( roughnessFactor, 0.92, kitSnow );`,
      );
  };
  material.customProgramCacheKey = () => `worldkit-surface-${role}-${hit ? 'hit' : 'still'}`;
  material.needsUpdate = true;
}

/** Un pezzo di mesh istanziata che può reagire a un urto. */
export interface WorldHitMesh {
  mesh: THREE.InstancedMesh;
  attribute: THREE.InstancedBufferAttribute;
  variant: number;
}

/** Altezza del sottoalbero nel mondo (dopo le trasformazioni dei padri). */
function subtreeBox(nodes: THREE.Object3D[]): THREE.Box3 {
  const box = new THREE.Box3();
  for (const node of nodes) box.expandByObject(node);
  return box;
}

/**
 * KHR_mesh_quantization salva posizioni e normali come interi normalizzati e
 * sposta la scala nei nodi. three li legge bene in GPU, ma `applyMatrix4`
 * riscrive i risultati **nello stesso array intero** (clamp a ±1): la geometria
 * si schiaccia. Qui si converte in float prima di cuocerci le trasformazioni.
 */
function dequantizeGeometry(geometry: THREE.BufferGeometry): void {
  for (const name of Object.keys(geometry.attributes)) {
    const attribute = geometry.getAttribute(name) as THREE.BufferAttribute;
    if (!attribute || !attribute.normalized) continue;
    const itemSize = attribute.itemSize;
    const count = attribute.count;
    const out = new Float32Array(count * itemSize);
    for (let i = 0; i < count; i++) {
      for (let c = 0; c < itemSize; c++) out[i * itemSize + c] = attribute.getComponent(i, c);
    }
    geometry.setAttribute(name, new THREE.BufferAttribute(out, itemSize));
  }
}

function collectMeshes(node: THREE.Object3D): THREE.Mesh[] {
  const meshes: THREE.Mesh[] = [];
  node.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if ((mesh as unknown as { isMesh?: boolean }).isMesh) meshes.push(mesh);
  });
  return meshes;
}

/**
 * Costruisce le parti di un asset: geometria cotta in spazio locale normalizzato
 * (base a terra, centro in x/z, altezza reale) e materiale proprio, così il vento
 * di un albero non tocca il cespuglio che condivide la texture.
 */
function buildAsset(
  scene: THREE.Object3D,
  entry: WorldModelEntry,
  anisotropy: number,
): WorldAsset | null {
  const roots: THREE.Object3D[] = [];
  for (const name of entry.nodes) {
    const found = scene.getObjectByName(name);
    if (!found) {
      console.warn(`worldkit: nodo "${name}" mancante in ${entry.file}`);
      continue;
    }
    roots.push(found);
  }
  const selected = roots.length > 0 ? roots : [scene];
  scene.updateMatrixWorld(true);
  const box = subtreeBox(selected);
  if (box.isEmpty()) return null;
  const size = box.getSize(new THREE.Vector3());
  const footprint = entry.normalize === 'footprint';
  const target = footprint ? (entry.scaleTo ?? entry.width ?? 1) : entry.height;
  const measured = footprint
    ? Math.max(size.x, size.z, 0.001)
    : Math.max(size.y, 0.001);
  const scale = target / measured;
  // centro in x/z e base a y = 0, in un colpo solo: la geometria finale è già
  // pronta per l'istanza, che applica solo posizione, yaw e scala variabile
  const center = box.getCenter(new THREE.Vector3());
  // prima si porta il modello nell'origine, poi lo si scala: invertire l'ordine
  // lascerebbe un residuo di (scale - 1) × centro, cioè metri di scarto
  const transform = new THREE.Matrix4()
    .makeScale(scale, scale, scale)
    .multiply(new THREE.Matrix4().makeTranslation(-center.x, -box.min.y, -center.z));

  const parts: WorldPart[] = [];
  const materialCache = new Map<THREE.Material, THREE.MeshStandardMaterial>();
  for (const root of selected) {
    for (const mesh of collectMeshes(root)) {
      const source = mesh.material as THREE.Material | THREE.Material[];
      const base = Array.isArray(source) ? source[0] : source;
      if (!base) continue;
      let material = materialCache.get(base);
      if (!material) {
        material = base.clone() as THREE.MeshStandardMaterial;
        // la normal map di uno scan a 512 px è già al limite: oltre non serve
        for (const slot of ['map', 'normalMap', 'roughnessMap', 'aoMap', 'emissiveMap'] as const) {
          const texture = material[slot] as THREE.Texture | null;
          if (texture) texture.anisotropy = anisotropy;
        }
        // tutti i ruoli passano di qui: anche sassi e case devono bagnarsi
        applySurface(material, entry.role, entry.height);
        material.needsUpdate = true;
        materialCache.set(base, material);
      }
      const geometry = mesh.geometry.clone();
      dequantizeGeometry(geometry);
      // matrixWorld include le rotazioni dei padri Sketchfab (spesso -90° su X)
      geometry.applyMatrix4(
        new THREE.Matrix4().multiplyMatrices(transform, mesh.matrixWorld),
      );
      geometry.computeBoundingBox();
      geometry.computeBoundingSphere();
      parts.push({
        name: mesh.name || entry.slug,
        geometry,
        material,
        castShadow: castsShadow(entry.role, material),
      });
    }
  }
  if (parts.length === 0) return null;
  let triangles = 0;
  for (const part of parts) {
    const index = part.geometry.getIndex();
    triangles += (index ? index.count : part.geometry.getAttribute('position').count) / 3;
  }
  return {
    slug: entry.slug,
    role: entry.role,
    name: entry.name,
    size: new THREE.Vector3(size.x * scale, size.y * scale, size.z * scale),
    triangles: Math.round(triangles),
    hero: entry.hero,
    parts,
  };
}

export class WorldKit {
  readonly assets = new Map<WorldRole, WorldAsset[]>();

  constructor(assets: WorldAsset[]) {
    for (const asset of assets) {
      const list = this.assets.get(asset.role);
      if (list) list.push(asset);
      else this.assets.set(asset.role, [asset]);
    }
  }

  /** Aggiunge un altro kit caricato in differita (per esempio i villaggi). */
  add(other: WorldKit | null): void {
    if (!other) return;
    for (const [role, list] of other.assets) {
      const own = this.assets.get(role);
      if (own) own.push(...list);
      else this.assets.set(role, [...list]);
    }
  }

  get count(): number {
    let total = 0;
    for (const list of this.assets.values()) total += list.length;
    return total;
  }

  get triangles(): number {
    let total = 0;
    for (const list of this.assets.values()) {
      for (const asset of list) {
        for (const part of asset.parts) {
          const index = part.geometry.getIndex();
          total += (index ? index.count : part.geometry.getAttribute('position').count) / 3;
        }
      }
    }
    return Math.round(total);
  }

  has(role: WorldRole): boolean {
    return (this.assets.get(role)?.length ?? 0) > 0;
  }

  variants(role: WorldRole): WorldAsset[] {
    return this.assets.get(role) ?? [];
  }

  /** Dimensioni reali della prima variante di un ruolo (metri). */
  size(role: WorldRole): THREE.Vector3 | null {
    const asset = this.assets.get(role)?.[0];
    return asset ? asset.size.clone() : null;
  }

  /**
   * Istanze di un ruolo in una sola passata. `frustumCulled = false` come nel
   * city kit: il bounding sphere è quello della geometria singola, non dello
   * sciame, e con le istanze sparse il culling taglierebbe pezzi visibili.
   */
  instances(
    role: WorldRole,
    spots: readonly WorldSpot[],
    opts: { castShadow?: boolean; receiveShadow?: boolean; hits?: WorldHitMesh[] } = {},
  ): THREE.Group {
    const group = new THREE.Group();
    group.name = `world-${role}`;
    const assets = this.variants(role);
    if (assets.length === 0 || spots.length === 0) return group;

    const dummy = new THREE.Object3D();
    for (let variant = 0; variant < assets.length; variant++) {
      const asset = assets[variant];
      const own =
        assets.length === 1 ? spots : spots.filter((spot) => (spot.variant ?? 0) === variant);
      if (own.length === 0) continue;
      for (const part of asset.parts) {
        const mesh = new THREE.InstancedMesh(part.geometry, part.material, own.length);
        mesh.name = `${role}-${asset.slug}-${part.name}`;
        mesh.frustumCulled = false;
        // l'attributo di urto è per-istanza, quindi la geometria non può essere
        // quella condivisa dall'asset: se ne clona una con i quattro float in più
        if (opts.hits) {
          const geometry = part.geometry.clone();
          const attribute = new THREE.InstancedBufferAttribute(new Float32Array(own.length * 4), 4);
          attribute.setUsage(THREE.DynamicDrawUsage);
          geometry.setAttribute('aHit', attribute);
          mesh.geometry = geometry;
          opts.hits.push({ mesh, attribute, variant });
        }
        mesh.castShadow = opts.castShadow ?? part.castShadow;
        mesh.receiveShadow = opts.receiveShadow ?? true;
        for (let i = 0; i < own.length; i++) {
          const spot = own[i]!;
          dummy.position.set(spot.x, spot.y, spot.z);
          dummy.rotation.set(0, spot.yaw, 0);
          dummy.scale.setScalar(spot.scale ?? 1);
          dummy.updateMatrix();
          mesh.setMatrixAt(i, dummy.matrix);
        }
        mesh.instanceMatrix.needsUpdate = true;
        group.add(mesh);
      }
    }
    return group;
  }
}

interface ManifestCredit {
  title: string;
  author: string;
  license: string;
  source: string;
}

interface ManifestModel extends Omit<WorldModelEntry, 'credits'> {
  credits: ManifestCredit;
}

interface Manifest {
  version: number;
  models: ManifestModel[];
}

/**
 * Carica solo i ruoli richiesti: i modelli di riserva (terreni, neve, arredi
 * non ancora piazzati) restano nel repo ma non si scaricano né occupano VRAM.
 *
 * Non lancia se il manifest manca: il mondo deve partire anche con una build
 * senza `public/worldkit/` (per esempio un checkout parziale).
 */
export async function loadWorldKit(
  base = `${import.meta.env.BASE_URL}worldkit/`,
  anisotropy = 4,
  roles: readonly WorldRole[] = [
    'tree',
    'shrub',
    'tree-distant',
    'rock',
    'grass',
    'grass-hero',
    'sign',
    'house',
    'ground',
    'field',
    'bale',
    'village',
    'sidewalk',
    'curb',
    'guardrail',
    'streetlight',
  ],
): Promise<WorldKit | null> {
  let manifest: Manifest;
  try {
    const response = await fetch(`${base}manifest.json`, { cache: 'no-store' });
    if (!response.ok) return null;
    manifest = (await response.json()) as Manifest;
  } catch {
    return null;
  }
  const wanted = new Set(roles);
  const commercial = import.meta.env.VITE_COMMERCIAL_BUILD === '1';
  const entries = (manifest.models ?? []).filter(
    (entry) =>
      entry.role &&
      entry.slug &&
      wanted.has(entry.role) &&
      // le riserve restano nel manifest ma non si scaricano: un ponte da 36k
      // triangoli non deve pesare su un preset che non lo piazza.
      entry.usage !== 'reserve' &&
      !(commercial && entry.nonCommercial),
  );
  if (entries.length === 0) return null;

  await MeshoptDecoder.ready;
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);

  const byFile = new Map<string, ManifestModel[]>();
  for (const entry of entries) {
    const list = byFile.get(entry.file);
    if (list) list.push(entry);
    else byFile.set(entry.file, [entry]);
  }

  const loaded = await Promise.all(
    [...byFile.entries()].map(async ([file, models]) => {
      try {
        const gltf = await loader.loadAsync(`${base}${file}`);
        const assets: WorldAsset[] = [];
        for (const model of models) {
          const asset = buildAsset(gltf.scene, { ...model, credits: model.credits }, anisotropy);
          if (asset) assets.push(asset);
        }
        return assets;
      } catch (error) {
        console.warn(`worldkit: ${file} non caricato`, error);
        return [];
      }
    }),
  );

  const assets = loaded.flat();
  return assets.length > 0 ? new WorldKit(assets) : null;
}


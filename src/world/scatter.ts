import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { CanopyField } from '../geo/canopy';
import type { Heightfield } from '../geo/elevation';
import type { ObstacleIndex } from '../geo/obstacles';
import type { BuildingIndex, OsmData, RoadIndex } from '../geo/osm';
import { foliageSet } from '../gfx/textures';
import { vehiclePassSnippet, vehiclePassUniforms, windUniforms } from '../gfx/wind';
import type { CityKit, KitAsset } from './citykit';
import type { PavedArea } from './paved';
import type { WorldAsset, WorldKit } from './worldkit';
import {
  SCATTER_CELL_SIZE,
  ScatterGenerator,
  scatterCollisionRadius,
  type ScatterInstance,
  type ScatterKind,
  type ScatterSources,
} from './scatter-gen';

const DEFAULT_RADIUS = 540;
const SMALL_OBJECT_RADIUS = 210;
/**
 * Alberi veri (GLB) entro questo raggio; oltre, la sagoma lontana.
 * Le due rappresentazioni si sovrappongono nella fascia di dissolvenza, così
 * il passaggio non si vede come uno scatto.
 */
const NEAR_TREE_RADIUS = 160;
const FAR_TREE_START = 112;
/**
 * Massimo ritardo delle liste di istanze.
 *
 * `update()` riallinea l'ancora del LOD solo ogni 40 m percorsi: fra due
 * riallineamenti le liste restano quelle del punto di partenza. Se coprissero
 * esattamente la fascia utile, un albero che si avvicina resterebbe fuori dal
 * LOD vicino finché non scatta il riallineamento — visibile come un albero
 * mezzo dissolto che si accende d'un colpo. I margini servono a coprire
 * proprio quei 40 m di ritardo.
 */
const REBUILD_LAG = 40;
/** Fascia in cui la sagoma vicina sfuma e quella lontana prende il posto. */
const NEAR_FADE_START = 112;
const NEAR_FADE_END = 156;
/** Gli alberi fotogrammetrici più vicini sostituiscono i low-poly entro ~45 m. */
const HERO_FADE_START = 24;
const HERO_FADE_END = 46;
const HERO_LIMIT = 48;

/** Camera della dissolvenza LOD, condivisa da tutti i materiali dello scatter. */
const scatterCamera = { value: new THREE.Vector2(0, 0) };

const TREE_PALETTES: Record<Exclude<ScatterKind, 'shrub' | 'rock'>, number[]> = {
  broadleaf: [0x71834d, 0x82945a, 0x8c9a60, 0x667847],
  olive: [0x929a78, 0xa2a987, 0x858f6e, 0x9ca283],
  cypress: [0x263e2b, 0x304b31, 0x3a5638, 0x29432e],
  poplar: [0x617b48, 0x708750, 0x7d9157, 0x5d7545],
};
const SHRUB_PALETTE = [0x65774b, 0x778452, 0x596c43, 0x87905a];
const ROCK_PALETTE = [0x756e60, 0x827969, 0x625f55, 0x948a77];

type TreeKind = keyof typeof TREE_PALETTES;
type RenderKind = ScatterKind;

type ScatterMode = 'near' | 'hero' | 'far';

interface ScatterOptions {
  osm: OsmData;
  heights: Heightfield;
  roads: RoadIndex;
  buildings: BuildingIndex;
  canopy?: CanopyField | null;
  paved?: readonly PavedArea[];
  trees: number;
  shrubs: number;
  shadows?: boolean;
  radius?: number;
  seed?: number;
  obstacles?: ObstacleIndex;
  /** world kit: alberi e cespugli veri al posto delle sfere procedurali */
  kit?: WorldKit | null;
  /** city kit: i sei alberi da campagna low-poly (450–600 triangoli) */
  cityKit?: CityKit | null;
}

interface InstanceSet {
  mesh: THREE.InstancedMesh;
  capacity: number;
}

interface AssetPart {
  geometry: THREE.BufferGeometry;
  material: THREE.MeshStandardMaterial;
}

/** Una variante di albero già pronta per l'istanziazione. */
interface TreeAsset {
  key: string;
  /** specie condivisa da hero e LOD vicino (`oak-big`, `fir-large`, …) */
  species: string;
  kind: TreeKind;
  size: THREE.Vector3;
  /** altezza del modello normalizzato: serve a riportarlo all'altezza di specie */
  height: number;
  parts: AssetPart[];
  sets: InstanceSet[];
}

interface ShrubAsset {
  key: string;
  height: number;
  parts: AssetPart[];
  sets: InstanceSet[];
}

interface SourceAsset {
  slug: string;
  size: THREE.Vector3;
  parts: AssetPart[];
}

const TREE_KINDS: readonly TreeKind[] = ['broadleaf', 'olive', 'cypress', 'poplar'];
const ALL_KINDS: readonly RenderKind[] = [...TREE_KINDS, 'shrub', 'rock'];
let nextColliderTag = 0;

/**
 * Deterministic, cell-streamed landscape scatter.
 *
 * Alberi e cespugli sono GLB per davvero: i low-poly da campagna del city kit e
 * i modelli del world kit, non sfere procedurali. Tre livelli si alternano con
 * dissolvenza per distanza — fotogrammetria vicina, low-poly a media distanza,
 * sagoma oltre i 112 m — così avvicinandosi non si vede il cambio di modello.
 * Le sfere restano solo come fallback quando nessun kit è disponibile.
 */
export class ScatterVegetation {
  readonly group = new THREE.Group();
  private readonly generator: ScatterGenerator;
  private readonly radius: number;
  private readonly cellRadius: number;
  private readonly cellCache = new Map<string, ScatterInstance[]>();
  private readonly fallbackSets = new Map<RenderKind, InstanceSet>();
  private readonly fallbackGeometries = new Map<RenderKind, THREE.BufferGeometry>();
  private readonly fallbackMaterials = new Map<RenderKind, THREE.MeshStandardMaterial>();
  /** Geometric/materiali presi in prestito dal kit: non si liberano qui. */
  private readonly borrowed = new Set<THREE.BufferGeometry | THREE.Material>();
  /** Materiali clonati dallo scatter: si liberano nel dispose. */
  private readonly ownedMaterials = new Set<THREE.Material>();
  private readonly nearTreeAssets: TreeAsset[] = [];
  private readonly heroTreeAssets: TreeAsset[] = [];
  private readonly farTreeAssets: TreeAsset[] = [];
  private readonly shrubAssets: ShrubAsset[] = [];
  private readonly nearByKind = new Map<TreeKind, TreeAsset[]>();
  private readonly heroByKind = new Map<TreeKind, TreeAsset[]>();
  private readonly farByKind = new Map<TreeKind, TreeAsset[]>();
  private readonly billboardGeometry = new THREE.PlaneGeometry(4, 6);
  private readonly billboardMaterial: THREE.MeshStandardMaterial | null;
  private farSet: InstanceSet | null = null;
  private readonly dummy = new THREE.Object3D();
  private readonly color = new THREE.Color();
  private readonly castShadows: boolean;
  private readonly obstacles?: ObstacleIndex;
  private readonly colliderTag = `scatter-tree-${nextColliderTag++}`;
  private centerCellX = Number.NaN;
  private centerCellZ = Number.NaN;
  private lodAnchorX = Number.NaN;
  private lodAnchorZ = Number.NaN;
  private disposed = false;

  constructor(renderer: THREE.WebGLRenderer, options: ScatterOptions) {
    this.group.name = 'streamed-vegetation-scatter';
    this.radius = options.radius ?? DEFAULT_RADIUS;
    this.cellRadius = Math.ceil(this.radius / SCATTER_CELL_SIZE);
    this.castShadows = options.shadows ?? false;
    this.obstacles = options.obstacles;
    const sources: ScatterSources = {
      osm: options.osm,
      heights: options.heights,
      roads: options.roads,
      buildings: options.buildings,
      canopy: options.canopy,
      paved: options.paved,
      seed: options.seed,
      treeDensity: options.trees / 14_000,
      shrubDensity: options.shrubs / 2_200,
    };
    this.generator = new ScatterGenerator(sources);

    const kit = options.kit ?? null;
    const city = options.cityKit ?? null;

    // ------------------------------------------------------------------
    // Catalogo alberi vicini: i low-poly da campagna (450–600 triangoli)
    // e i modelli del world kit. Ogni variante ha il proprio materiale
    // clonato perché la dissolvenza LOD vive nell'onBeforeCompile.
    // ------------------------------------------------------------------
    if (city) {
      const cityNear: { slug: string; kind: TreeKind }[] = [
        { slug: 'apple-tree', kind: 'broadleaf' },
        { slug: 'apple-tree', kind: 'olive' },
        { slug: 'birch-tree', kind: 'poplar' },
        { slug: 'arborvitae-conifer', kind: 'cypress' },
        { slug: 'lineside-pine', kind: 'cypress' },
      ];
      for (const entry of cityNear) {
        const asset = city.bySlug(entry.slug);
        if (!asset || asset.parts.length === 0) continue;
        const tree = this.makeTreeAsset(sourceOf(asset), entry.kind, 'near', 48, true, `${entry.slug}-${entry.kind}`);
        if (tree) this.pushNear(tree);
      }
    }

    const distant = kit?.variants('tree-distant') ?? [];
    // Le sagome del world kit storico (100–370 triangoli) fanno da LOD
    // lontano: restano leggere anche con migliaia di istanze. I modelli nuovi
    // dei pack (2.000–12.000 triangoli) entrano solo nel LOD vicino.
    const lowPoly = distant.filter((asset) => asset.triangles <= 450);
    const nearDistant = [...distant.filter((asset) => asset.triangles > 450), ...lowPoly.slice(0, 6)];
    for (let index = 0; index < nearDistant.length; index++) {
      const asset = nearDistant[index]!;
      if (asset.parts.length === 0) continue;
      const kind = farKindFor(asset);
      const near = this.makeTreeAsset(sourceOf(asset), kind, 'near', 48, false, `near-${asset.slug}`);
      if (near) this.pushNear(near);
    }
    // Tutte le sagome leggere, non le prime otto: diviso per silhouette dà
    // candidati lontani per ogni specie (colonnare → cipresso/pioppo,
    // allargata → latifoglia/olivo), così la dissolvenza non cambia tipo.
    for (const asset of lowPoly) {
      if (asset.parts.length === 0) continue;
      const kind = farKindFor(asset);
      const far = this.makeTreeAsset(sourceOf(asset), kind, 'far', 40, false, `far-${asset.slug}`);
      if (far) this.pushFar(far);
    }

    // ------------------------------------------------------------------
    // Hero: i due alberi fotogrammetrici del world kit per i 48 esemplari
    // più vicini, più l'ulivo del city kit. Sostituiscono i low-poly entro
    // 46 m con dissolvenza, quindi la chioma vicina è quella vera.
    // ------------------------------------------------------------------
    // Un eroe per famiglia, non tutti i modelli del pack: ogni eroe costa una
    // draw call per parte e i più vicini sono al massimo 48 in tutta la scena.
    const heroSlugs = new Set(['oak-big', 'oak-large', 'oak-medium', 'fir-large', 'fir-medium']);
    for (const asset of kit?.variants('tree') ?? []) {
      if (!heroSlugs.has(asset.slug) || asset.parts.length === 0) continue;
      this.borrowed.add(asset.parts[0]!.geometry);
      const hero = this.makeTreeAsset(sourceOf(asset), treeKindFor(asset.slug, asset.name), 'hero', 24, false, `hero-${asset.slug}`);
      if (hero) this.pushHero(hero);
    }

    // ------------------------------------------------------------------
    // Cespugli: tutte le varianti leggere del kit, non un solo modello.
    // ------------------------------------------------------------------
    const shrubs = (kit?.variants('shrub') ?? [])
      .filter((asset) => asset.parts.length > 0 && asset.triangles <= 7_000)
      .sort((a, b) => a.triangles - b.triangles)
      .slice(0, 14);
    for (const asset of shrubs) {
      const parts = asset.parts.map((part) => {
        this.borrowed.add(part.geometry);
        this.borrowed.add(part.material);
        return { geometry: part.geometry, material: part.material };
      });
      const shrub: ShrubAsset = {
        key: asset.slug,
        height: Math.max(0.2, asset.size.y),
        parts,
        sets: parts.map((part) => this.createSet(part.geometry, part.material, 64, false)),
      };
      this.shrubAssets.push(shrub);
    }

    // ------------------------------------------------------------------
    // Fallback procedurale: solo dove il kit non ha il ruolo (o non c'è kit).
    // ------------------------------------------------------------------
    const needsFallback = (kind: RenderKind): boolean => {
      if (kind === 'rock') return true;
      if (kind === 'shrub') return this.shrubAssets.length === 0;
      return !this.nearByKind.has(kind);
    };
    for (const kind of ALL_KINDS) {
      if (!needsFallback(kind)) continue;
      const geometry = createScatterGeometry(kind);
      const material = new THREE.MeshStandardMaterial({
        color: 0xffffff,
        vertexColors: true,
        roughness: kind === 'rock' ? 0.96 : 1,
        metalness: 0,
      });
      if (kind !== 'rock') {
        applyWind(material, kind === 'cypress' ? 0.35 : kind === 'shrub' ? 0.6 : 1, kind === 'shrub', kind === 'shrub' ? undefined : 'near');
      }
      this.fallbackGeometries.set(kind, geometry);
      this.fallbackMaterials.set(kind, material);
      this.fallbackSets.set(kind, this.createSet(geometry, material, 128));
    }

    // Sagome lontane: una sola mesh con shader billboard, ancora usata solo
    // quando il world kit non fornisce i modelli `tree-distant`.
    const leaves = foliageSet(renderer);
    this.billboardMaterial =
      this.farTreeAssets.length === 0
        ? new THREE.MeshStandardMaterial({
            map: leaves.map,
            alphaMap: leaves.alphaMap,
            alphaTest: 0.42,
            side: THREE.DoubleSide,
            vertexColors: true,
            roughness: 1,
            metalness: 0,
            transparent: false,
          })
        : null;
    if (this.billboardMaterial) {
      applyBillboardShader(this.billboardMaterial);
      this.farSet = this.createSet(this.billboardGeometry, this.billboardMaterial, 512);
    }
  }

  update(x: number, z: number): void {
    if (this.disposed) return;
    scatterCamera.value.set(x, z);
    const cellX = Math.floor(x / SCATTER_CELL_SIZE);
    const cellZ = Math.floor(z / SCATTER_CELL_SIZE);
    if (cellX === this.centerCellX && cellZ === this.centerCellZ) {
      // 40 m invece di 24: con la macchina a 120 km/h un rebuild ogni 24 m
      // arrivava ogni 0,7 s e ridefiniva tutte le istanze vicine; a 40 m il
      // cambio di LOD delle chiome lontane non si nota e il costo si dimezza
      if (Math.hypot(x - this.lodAnchorX, z - this.lodAnchorZ) < 40) return;
      this.lodAnchorX = x;
      this.lodAnchorZ = z;
      this.rebuildInstances(x, z);
      return;
    }
    this.centerCellX = cellX;
    this.centerCellZ = cellZ;
    const keep = new Set<string>();

    for (let dz = -this.cellRadius; dz <= this.cellRadius; dz++) {
      for (let dx = -this.cellRadius; dx <= this.cellRadius; dx++) {
        const distanceX = (dx + 0.5) * SCATTER_CELL_SIZE;
        const distanceZ = (dz + 0.5) * SCATTER_CELL_SIZE;
        if (distanceX * distanceX + distanceZ * distanceZ > this.radius * this.radius) continue;
        const cx = cellX + dx;
        const cz = cellZ + dz;
        const cellKey = `${cx},${cz}`;
        keep.add(cellKey);
        if (!this.cellCache.has(cellKey)) this.cellCache.set(cellKey, this.generator.generateCell(cx, cz));
      }
    }
    for (const cellKey of this.cellCache.keys()) {
      if (!keep.has(cellKey)) this.cellCache.delete(cellKey);
    }
    this.refreshVegetationColliders();
    this.rebuildInstances(x, z);
    this.lodAnchorX = x;
    this.lodAnchorZ = z;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.cellCache.clear();
    this.obstacles?.replaceTag(this.colliderTag, []);
    for (const set of this.fallbackSets.values()) this.removeSet(set);
    for (const asset of this.allTreeAssets()) for (const set of asset.sets) this.removeSet(set);
    for (const shrub of this.shrubAssets) for (const set of shrub.sets) this.removeSet(set);
    this.removeSet(this.farSet);
    for (const geometry of this.fallbackGeometries.values()) {
      if (!this.borrowed.has(geometry)) geometry.dispose();
    }
    this.billboardGeometry.dispose();
    for (const material of this.fallbackMaterials.values()) {
      if (!this.borrowed.has(material)) material.dispose();
    }
    for (const material of this.ownedMaterials) material.dispose();
    this.billboardMaterial?.dispose();
    this.group.clear();
  }

  private *allTreeAssets(): Generator<TreeAsset> {
    yield* this.nearTreeAssets;
    yield* this.heroTreeAssets;
    yield* this.farTreeAssets;
  }

  private pushNear(asset: TreeAsset): void {
    this.nearTreeAssets.push(asset);
    const list = this.nearByKind.get(asset.kind);
    if (list) list.push(asset);
    else this.nearByKind.set(asset.kind, [asset]);
  }

  private pushHero(asset: TreeAsset): void {
    this.heroTreeAssets.push(asset);
    const list = this.heroByKind.get(asset.kind);
    if (list) list.push(asset);
    else this.heroByKind.set(asset.kind, [asset]);
  }

  private pushFar(asset: TreeAsset): void {
    this.farTreeAssets.push(asset);
    const list = this.farByKind.get(asset.kind);
    if (list) list.push(asset);
    else this.farByKind.set(asset.kind, [asset]);
  }

  /**
   * Costruisce una variante pronta per l'istanziazione. Il materiale è clonato
   * (non condiviso con il resto del kit) perché ogni livello LOD ha bisogno
   * della propria dissolvenza; la geometria invece resta condivisa.
   */
  private makeTreeAsset(
    source: SourceAsset,
    kind: TreeKind,
    mode: ScatterMode,
    capacity: number,
    addWind: boolean,
    key: string,
  ): TreeAsset | null {
    if (source.parts.length === 0 || source.size.y <= 0.05) return null;
    const parts = source.parts.map((part) => {
      const material = part.material.clone();
      // `Material.clone()` non porta con sé onBeforeCompile: senza questa
      // copia i GLB perderebbero vento, bagnato e neve del kit.
      material.onBeforeCompile = part.material.onBeforeCompile;
      material.customProgramCacheKey = part.material.customProgramCacheKey;
      this.borrowed.add(part.geometry);
      this.ownedMaterials.add(material);
      decorateTreeMaterial(material, mode, addWind, source.size.y);
      return { geometry: part.geometry, material };
    });
    const asset: TreeAsset = {
      key,
      species: speciesOf(key),
      kind,
      size: source.size.clone(),
      height: source.size.y,
      parts,
      sets: parts.map((part) => this.createSet(part.geometry, part.material, capacity, false)),
    };
    return asset;
  }

  private createSet(
    geometry: THREE.BufferGeometry,
    material: THREE.Material,
    capacity: number,
    castShadow = this.castShadows,
  ): InstanceSet {
    const mesh = new THREE.InstancedMesh(geometry, material, capacity);
    mesh.count = 0;
    mesh.frustumCulled = false;
    mesh.castShadow = castShadow;
    mesh.receiveShadow = false;
    this.group.add(mesh);
    return { mesh, capacity };
  }

  private ensureCapacity(set: InstanceSet, required: number, geometry: THREE.BufferGeometry, material: THREE.Material): InstanceSet {
    if (required <= set.capacity) return set;
    let capacity = set.capacity;
    while (capacity < required) capacity *= 2;
    const replacement = this.createSet(geometry, material, capacity, set.mesh.castShadow);
    this.removeSet(set);
    return replacement;
  }

  private removeSet(set: InstanceSet | null): void {
    if (!set) return;
    this.group.remove(set.mesh);
    set.mesh.dispose();
  }

  private rebuildInstances(x: number, z: number): void {
    const near: Record<TreeKind, ScatterInstance[]> = {
      broadleaf: [],
      olive: [],
      cypress: [],
      poplar: [],
    };
    const shrubs: ScatterInstance[] = [];
    const rocks: ScatterInstance[] = [];
    const far: ScatterInstance[] = [];

    for (const instances of this.cellCache.values()) {
      for (const instance of instances) {
        const dx = instance.x - x;
        const dz = instance.z - z;
        const distance2 = dx * dx + dz * dz;
        if (instance.kind === 'shrub') {
          if (distance2 <= SMALL_OBJECT_RADIUS * SMALL_OBJECT_RADIUS) shrubs.push(instance);
        } else if (instance.kind === 'rock') {
          if (distance2 <= SMALL_OBJECT_RADIUS * SMALL_OBJECT_RADIUS) rocks.push(instance);
        } else {
          const nearLimit = NEAR_TREE_RADIUS + REBUILD_LAG;
          if (distance2 <= nearLimit * nearLimit) near[instance.kind].push(instance);
          // La sagoma lontana compare già nella fascia 112–156, dove la
          // vicina sfuma: le due rappresentazioni si sovrappongono. Il
          // margine dietro `FAR_TREE_START` copre il ritardo di `REBUILD_LAG`.
          const farLimit = FAR_TREE_START - REBUILD_LAG;
          if (distance2 >= farLimit * farLimit) far.push(instance);
        }
      }
    }

    for (const set of this.fallbackSets.values()) set.mesh.count = 0;
    for (const asset of this.allTreeAssets()) for (const set of asset.sets) set.mesh.count = 0;
    for (const shrub of this.shrubAssets) for (const set of shrub.sets) set.mesh.count = 0;
    if (this.farSet) this.farSet.mesh.count = 0;

    // Alberi vicini: GLB per specie, con i low-poly di campagna. Si assegna
    // prima ogni istanza alla sua variante, così l'hero può essere scelto solo
    // quando esiste il LOD vicino della **stessa** specie.
    const assigned = new Map<ScatterInstance, TreeAsset>();
    for (const kind of TREE_KINDS) {
      const instances = near[kind];
      const assets = this.nearByKind.get(kind);
      if (assets && assets.length > 0) {
        const groups = new Map<TreeAsset, ScatterInstance[]>();
        for (const instance of instances) {
          const asset = this.pickTreeAsset(assets, instance);
          assigned.set(instance, asset);
          const list = groups.get(asset);
          if (list) list.push(instance);
          else groups.set(asset, [instance]);
        }
        this.writeTreeGroups(groups, 'near');
      } else if (instances.length > 0) {
        this.writeFallback(kind, instances);
      }
    }

    // Hero fotogrammetrici per i più vicini, con dissolvenza 24–46 m.
    const heroes = this.pickHeroes(near, assigned, x, z);
    if (heroes.length > 0) {
      const groups = new Map<TreeAsset, ScatterInstance[]>();
      for (const instance of heroes) {
        const nearAsset = assigned.get(instance);
        const kind = instance.kind as TreeKind;
        const choices = this.heroByKind.get(kind) ?? [];
        const hero = choices.find((asset) => asset.species === nearAsset?.species);
        if (!hero) continue;
        const list = groups.get(hero);
        if (list) list.push(instance);
        else groups.set(hero, [instance]);
      }
      this.writeTreeGroups(groups, 'hero');
    }

    // Cespugli: varianti diverse a gruppi, non un solo modello ripetuto.
    if (this.shrubAssets.length > 0 && shrubs.length > 0) {
      const groups = new Map<ShrubAsset, ScatterInstance[]>();
      for (const instance of shrubs) {
        const asset = this.shrubAssets[hashInstance(instance, 19) % this.shrubAssets.length]!;
        const list = groups.get(asset);
        if (list) list.push(instance);
        else groups.set(asset, [instance]);
      }
      for (const [asset, list] of groups) this.writeShrubGroup(asset, list);
    } else if (shrubs.length > 0) {
      this.writeFallback('shrub', shrubs);
    }
    this.writeFallback('rock', rocks);

    // Lontani: sagome GLB del world kit, altrimenti i billboard di sempre.
    if (this.farTreeAssets.length > 0 && far.length > 0) {
      this.writeTreeGroups(this.groupFarInstances(far), 'far');
    } else if (this.farSet) {
      const farSet = this.ensureCapacity(this.farSet, far.length, this.billboardGeometry, this.billboardMaterial!);
      this.farSet = farSet;
      this.writeBillboards(farSet.mesh, far);
    }
  }

  /**
   * Raggruppa i lontani per **specie**: la sagoma deve essere la versione
   * leggera dello stesso albero scelto nel LOD vicino.
   *
   * Fra 112 e 156 m le due rappresentazioni stanno in scena insieme e si
   * scambiano con la dissolvenza: se una è una quercia e l'altra una sagoma
   * di specie diversa l'albero sembra cambiare tipo avvicinandosi. La scelta
   * dipende solo dall'istanza (posizione + specie vicina), mai dalla distanza,
   * quindi resta ferma mentre si guida.
   */
  private groupFarInstances(instances: readonly ScatterInstance[]): Map<TreeAsset, ScatterInstance[]> {
    const groups = new Map<TreeAsset, ScatterInstance[]>();
    for (const instance of instances) {
      const kind = instance.kind as TreeKind;
      const nearChoices = this.nearByKind.get(kind);
      const farChoices = this.farByKind.get(kind);
      const farPool = farChoices && farChoices.length > 0 ? farChoices : this.farTreeAssets;
      if (farPool.length === 0) continue;
      const nearAsset = nearChoices && nearChoices.length > 0 ? this.pickTreeAsset(nearChoices, instance) : null;
      const asset = this.pickFarAsset(farPool, instance, nearAsset);
      const list = groups.get(asset);
      if (list) list.push(instance);
      else groups.set(asset, [instance]);
    }
    return groups;
  }

  /**
   * Candidata lontana con la silhouette più vicina a quella del LOD vicino
   * (rapporto larghezza/altezza), con una finestra di tre per non replicare
   * sempre lo stesso modello.
   */
  private pickFarAsset(
    choices: readonly TreeAsset[],
    instance: ScatterInstance,
    nearAsset: TreeAsset | null,
  ): TreeAsset {
    const aspectOf = (asset: TreeAsset): number => (asset.size.y > 0.5 ? asset.size.x / asset.size.y : Number.NaN);
    const nearAspect = nearAsset ? aspectOf(nearAsset) : Number.NaN;
    const target = instance.height && instance.height > 1
      ? instance.height
      : treeDimensions(instance.kind as TreeKind).height * instance.scale;
    const ranked = [...choices].sort((a, b) => {
      if (Number.isFinite(nearAspect)) {
        const ea = Number.isFinite(aspectOf(a)) ? aspectOf(a) : nearAspect;
        const eb = Number.isFinite(aspectOf(b)) ? aspectOf(b) : nearAspect;
        return Math.abs(ea - nearAspect) - Math.abs(eb - nearAspect);
      }
      return Math.abs(a.height - target) - Math.abs(b.height - target);
    });
    const window = ranked.slice(0, Math.min(3, ranked.length));
    return window[hashInstance(instance, 47) % window.length]!;
  }

  /**
   * Variante più vicina in altezza, con una finestra di tre per non ripetere
   * sempre lo stesso modello. La quota viene dal generatore (canopy misurato),
   * non dalla categoria: una quercia da 19 m resta alta anche quando cambia LOD.
   */
  private pickTreeAsset(choices: readonly TreeAsset[], instance: ScatterInstance): TreeAsset {
    const target = instance.height && instance.height > 1
      ? instance.height
      : treeDimensions(instance.kind as TreeKind).height * instance.scale;
    const ranked = [...choices].sort(
      (a, b) => Math.abs(a.height - target) - Math.abs(b.height - target),
    );
    const window = ranked.slice(0, Math.min(3, ranked.length));
    return window[hashInstance(instance, 31) % window.length]!;
  }

  private writeTreeGroups(groups: Map<TreeAsset, ScatterInstance[]>, mode: ScatterMode): void {
    for (const [asset, instances] of groups) this.writeTreeGroup(asset, instances, mode);
  }

  private writeTreeGroup(asset: TreeAsset, instances: readonly ScatterInstance[], mode: ScatterMode): void {
    const dimensions = treeDimensions(asset.kind);
    const stretch = nonUniformScale(asset.kind);
    const heroBoost = mode === 'hero' ? 1.04 : 1;
    for (let partIndex = 0; partIndex < asset.parts.length; partIndex++) {
      const part = asset.parts[partIndex]!;
      let set = asset.sets[partIndex]!;
      set = this.ensureCapacity(set, instances.length, part.geometry, part.material);
      asset.sets[partIndex] = set;
      const mesh = set.mesh;
      for (let i = 0; i < instances.length; i++) {
        const instance = instances[i]!;
        // Il modello viene portato all'altezza della specie, non alla sua
        // altezza nominale: così i low-poly e i fotogrammetrici coincidono.
        // L'altezza viene dal generatore (canopy/ specie), non dalla categoria:
        // una quercia da 19 m resta alta anche quando il LOD cambia.
        const target = (instance.height && instance.height > 1 ? instance.height : dimensions.height * instance.scale) * heroBoost;
        const base = target / Math.max(0.1, asset.height);
        this.dummy.position.set(instance.x, instance.y - 0.025, instance.z);
        this.dummy.rotation.set(0, instance.rotation + hashInstance(instance, 7) * 0.0007, 0);
        this.dummy.scale.set(base * stretch[0], base * stretch[1], base * stretch[2]);
        this.dummy.updateMatrix();
        mesh.setMatrixAt(i, this.dummy.matrix);
        const tint = naturalTint(instance);
        this.color.setRGB(tint * 0.97, tint, tint * 0.93);
        mesh.setColorAt(i, this.color);
      }
      mesh.count = instances.length;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  }

  private writeShrubGroup(asset: ShrubAsset, instances: readonly ScatterInstance[]): void {
    for (let partIndex = 0; partIndex < asset.parts.length; partIndex++) {
      const part = asset.parts[partIndex]!;
      let set = asset.sets[partIndex]!;
      set = this.ensureCapacity(set, instances.length, part.geometry, part.material);
      asset.sets[partIndex] = set;
      const mesh = set.mesh;
      for (let i = 0; i < instances.length; i++) {
        const instance = instances[i]!;
        // I cespugli sono già in scala reale: basta la scala del generatore,
        // con una leggera sporcatura per non lasciare file identiche.
        const scale = instance.scale * (0.92 + (hashInstance(instance, 5) % 17) / 100);
        this.dummy.position.set(instance.x, instance.y - 0.02, instance.z);
        this.dummy.rotation.set(0, instance.rotation, 0);
        this.dummy.scale.setScalar(scale);
        this.dummy.updateMatrix();
        mesh.setMatrixAt(i, this.dummy.matrix);
        const tint = 0.9 + (hashInstance(instance, 11) % 5) * 0.035;
        this.color.setRGB(tint * 0.98, tint, tint * 0.95);
        mesh.setColorAt(i, this.color);
      }
      mesh.count = instances.length;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  }

  private writeFallback(kind: RenderKind, instances: readonly ScatterInstance[]): void {
    const set = this.fallbackSets.get(kind);
    if (!set) return;
    const geometry = this.fallbackGeometries.get(kind);
    const material = this.fallbackMaterials.get(kind);
    if (!geometry || !material) return;
    const grown = this.ensureCapacity(set, instances.length, geometry, material);
    this.fallbackSets.set(kind, grown);
    for (let i = 0; i < instances.length; i++) {
      const instance = instances[i]!;
      this.dummy.position.set(instance.x, instance.y, instance.z);
      this.dummy.rotation.set(0, instance.rotation, 0);
      this.dummy.scale.setScalar(instance.scale);
      this.dummy.updateMatrix();
      grown.mesh.setMatrixAt(i, this.dummy.matrix);
      this.color.setHex(colorFor(kind, instance.variation));
      grown.mesh.setColorAt(i, this.color);
    }
    grown.mesh.count = instances.length;
    grown.mesh.instanceMatrix.needsUpdate = true;
    if (grown.mesh.instanceColor) grown.mesh.instanceColor.needsUpdate = true;
  }

  /** I più vicini entro 46 m, solo se il loro LOD vicino ha un hero della stessa specie. */
  private pickHeroes(
    near: Record<TreeKind, ScatterInstance[]>,
    assigned: Map<ScatterInstance, TreeAsset>,
    x: number,
    z: number,
  ): ScatterInstance[] {
    if (this.heroTreeAssets.length === 0) return [];
    const eligible: { instance: ScatterInstance; d: number }[] = [];
    for (const kind of TREE_KINDS) {
      const heroes = this.heroByKind.get(kind);
      if (!heroes || heroes.length === 0) continue;
      for (const instance of near[kind]) {
        const d = (instance.x - x) ** 2 + (instance.z - z) ** 2;
        if (d > HERO_FADE_END * HERO_FADE_END) continue;
        const nearAsset = assigned.get(instance);
        if (!nearAsset || !heroes.some((asset) => asset.species === nearAsset.species)) continue;
        eligible.push({ instance, d });
      }
    }
    eligible.sort((a, b) => a.d - b.d);
    return eligible.slice(0, HERO_LIMIT).map((entry) => entry.instance);
  }

  private writeBillboards(mesh: THREE.InstancedMesh, instances: readonly ScatterInstance[]): void {
    for (let i = 0; i < instances.length; i++) {
      const instance = instances[i]!;
      const dimensions = treeDimensions(instance.kind as TreeKind);
      const height = instance.height && instance.height > 1 ? instance.height : dimensions.height * instance.scale;
      this.dummy.position.set(instance.x, instance.y + height * 0.5, instance.z);
      this.dummy.rotation.set(0, 0, 0);
      this.dummy.scale.set((dimensions.width / 4) * instance.scale, (height / 6), 1);
      this.dummy.updateMatrix();
      mesh.setMatrixAt(i, this.dummy.matrix);
      this.color.setHex(colorFor(instance.kind, instance.variation));
      mesh.setColorAt(i, this.color);
    }
    mesh.count = instances.length;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }

  movementFactorAt(x: number, z: number): number {
    return this.generator.movementFactorAt(x, z);
  }

  private refreshVegetationColliders(): void {
    if (!this.obstacles) return;
    const colliders: { x: number; z: number; radius: number }[] = [];
    for (const instances of this.cellCache.values()) {
      for (const instance of instances) {
        const radius = scatterCollisionRadius(instance.kind, instance.scale);
        if (radius !== null) colliders.push({ x: instance.x, z: instance.z, radius });
      }
    }
    this.obstacles.replaceTag(this.colliderTag, colliders);
  }
}

function sourceOf(asset: KitAsset | WorldAsset): SourceAsset {
  return {
    slug: asset.slug,
    size: asset.size,
    parts: asset.parts.map((part) => ({ geometry: part.geometry, material: part.material })),
  };
}

/**
 * Specie dei `tree-distant`: la sagoma stretta è un cipresso/pioppo, quella
 * allargata un olivo o una latifoglia. Serve perché la sagoma lontana e quella
 * vicina abbiano la stessa proporzione, altrimenti la dissolvenza mostra un
 * albero che cambia forma.
 */
function treeKindFor(slug: string, name: string): TreeKind {
  const label = `${slug} ${name}`.toLowerCase();
  if (/fir|pine|spruce|conifer|abete|pino|peccio|arborvitae/.test(label)) return 'cypress';
  if (/birch|poplar|aspen|betulla|pioppo/.test(label)) return 'poplar';
  if (/olive|ulivo|olivo/.test(label)) return 'olive';
  if (/oak|maple|ash|apple|cherry|beech|quercia|acero|frassino|melo|ciliegio/.test(label)) return 'broadleaf';
  return 'broadleaf';
}

/**
 * Specie della sagoma lontana.
 *
 * I nomi generici ("Albero lontano 3") non dicono nulla, ma le proporzioni
 * sì: una sagoma stretta resta un cipresso o un pioppo anche a 300 m. Senza
 * questa classificazione ogni scelta finiva in `broadleaf` e un filare di
 * cipressi dissolvenziava in un blob rotondo — l'albero che "cambia tipo"
 * avvicinandosi.
 */
function farKindFor(asset: WorldAsset): TreeKind {
  const label = `${asset.slug} ${asset.name}`.toLowerCase();
  const named = treeKindFor(asset.slug, asset.name);
  // `treeKindFor` restituisce `broadleaf` anche senza parole-chiave: per gli
  // scoperti generici si decide quindi dalla silhouette del manifest
  if (named !== 'broadleaf' || /oak|maple|beech|quercia|acero|faggio|apple|melo|cherry|ciliegio/.test(label)) {
    return named;
  }
  const aspect = asset.size.x / Math.max(0.5, asset.size.y);
  if (aspect < 0.2) return 'cypress';
  if (aspect < 0.33) return 'poplar';
  // l'olivo è basso e largo: solo fascia intermedia di proporzione, altrimenti
  // un albero realistico alto 6 m finiva fra gli ulivi
  if (asset.size.y < 6.5 && aspect > 0.55 && aspect <= 0.95) return 'olive';
  return 'broadleaf';
}

function speciesOf(key: string): string {
  return key.replace(/^hero-/, '').replace(/^near-/, '').replace(/^far-/, '').replace(/-near$/, '');
}

function nonUniformScale(kind: TreeKind): [number, number, number] {
  if (kind === 'olive') return [1.1, 0.88, 1.1];
  if (kind === 'cypress') return [0.9, 1, 0.9];
  if (kind === 'poplar') return [0.74, 1.08, 0.74];
  return [1, 1, 1];
}

function hashInstance(instance: ScatterInstance, salt: number): number {
  let h = Math.imul((instance.x * 10) | 0, 0x27d4eb2d);
  h ^= Math.imul((instance.z * 10) | 0, 0x165667b1);
  h ^= Math.imul(instance.variation + salt + 1, 0x9e3779b1);
  h ^= h >>> 15;
  return h >>> 0;
}

/** Tinta chiara per rompere la ripetizione senza colorare le foglie di verde. */
function naturalTint(instance: ScatterInstance): number {
  return 0.9 + (hashInstance(instance, 3) % 7) / 100;
}

function colorFor(kind: ScatterKind, variation: number): number {
  if (kind === 'shrub') return SHRUB_PALETTE[variation]!;
  if (kind === 'rock') return ROCK_PALETTE[variation]!;
  return TREE_PALETTES[kind][variation]!;
}

function treeDimensions(kind: TreeKind): { width: number; height: number } {
  if (kind === 'olive') return { width: 4.4, height: 5.8 };
  if (kind === 'cypress') return { width: 1.8, height: 10.2 };
  if (kind === 'poplar') return { width: 2.8, height: 12.5 };
  return { width: 4.5, height: 8.6 };
}

function colorGeometry(geometry: THREE.BufferGeometry, color: number): THREE.BufferGeometry {
  const position = geometry.getAttribute('position');
  const base = new THREE.Color(color);
  const colors = new Float32Array(position.count * 3);
  for (let i = 0; i < position.count; i++) {
    const shade = 0.88 + 0.12 * Math.sin(position.getY(i) * 1.7 + i * 0.13);
    colors[i * 3] = base.r * shade;
    colors[i * 3 + 1] = base.g * shade;
    colors[i * 3 + 2] = base.b * shade;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geometry;
}

function translated(
  geometry: THREE.BufferGeometry,
  x: number,
  y: number,
  z: number,
  sx = 1,
  sy = 1,
  sz = 1,
): THREE.BufferGeometry {
  geometry.scale(sx, sy, sz);
  geometry.translate(x, y, z);
  return geometry;
}

function createScatterGeometry(kind: ScatterKind): THREE.BufferGeometry {
  if (kind === 'rock') {
    return colorGeometry(createRockGeometry(), 0xffffff);
  }
  if (kind === 'shrub') {
    const pieces: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 5; i++) {
      const angle = (i / 5) * Math.PI * 2;
      const radius = i === 0 ? 0 : 0.34;
      const blob = new THREE.IcosahedronGeometry(0.55 + (i % 3) * 0.06, 1);
      translated(blob, Math.cos(angle) * radius, 0.45 + (i % 2) * 0.12, Math.sin(angle) * radius, 1, 0.82, 1);
      pieces.push(colorGeometry(blob, [0x637448, 0x75834f, 0x82905a, 0x596b41, 0x71804d][i]!));
    }
    return mergeAndDispose(pieces);
  }

  const pieces: THREE.BufferGeometry[] = [];
  if (kind === 'broadleaf') {
    const trunk = new THREE.CylinderGeometry(0.16, 0.32, 3.2, 9, 3);
    translated(trunk, 0, 1.6, 0);
    pieces.push(colorGeometry(trunk, 0x51402f));
    addCrown(pieces, 5, 0.72, 0x7c8b55, 2.8, 5.5, 0.65);
  } else if (kind === 'olive') {
    const trunk = new THREE.CylinderGeometry(0.2, 0.42, 2.1, 8, 3);
    translated(trunk, 0, 1.05, 0);
    pieces.push(colorGeometry(trunk, 0x5c4935));
    addCrown(pieces, 6, 0.78, 0x939b79, 2.1, 3.7, 0.86);
  } else if (kind === 'cypress') {
    const trunk = new THREE.CylinderGeometry(0.08, 0.2, 1.25, 7, 2);
    translated(trunk, 0, 0.625, 0);
    pieces.push(colorGeometry(trunk, 0x4a3e2d));
    const crown = new THREE.ConeGeometry(0.83, 8.6, 11, 8);
    translated(crown, 0, 5.15, 0, 0.84, 1, 0.84);
    pieces.push(colorGeometry(crown, 0x334a32));
  } else {
    const trunk = new THREE.CylinderGeometry(0.12, 0.24, 4.5, 8, 3);
    translated(trunk, 0, 2.25, 0);
    pieces.push(colorGeometry(trunk, 0x574431));
    addCrown(pieces, 4, 0.42, 0x71834d, 3.4, 7.6, 0.52);
  }
  return mergeAndDispose(pieces);
}

function addCrown(
  pieces: THREE.BufferGeometry[],
  clusters: number,
  radius: number,
  color: number,
  baseY: number,
  topY: number,
  flatten: number,
): void {
  for (let i = 0; i < clusters; i++) {
    const angle = (i / clusters) * Math.PI * 2 + i * 0.77;
    const vertical = (i % 3) / 3;
    const size = radius * (0.78 + (i % 4) * 0.1);
    const blob = new THREE.IcosahedronGeometry(size, 2);
    const y = baseY + (topY - baseY) * vertical;
    const distance = radius * (i === 0 ? 0 : 0.42 + (i % 2) * 0.12);
    translated(blob, Math.cos(angle) * distance, y, Math.sin(angle) * distance, 1, flatten, 1);
    const tint = new THREE.Color(color).multiplyScalar(0.9 + (i % 4) * 0.055);
    pieces.push(colorGeometry(blob, tint.getHex()));
  }
  const crownTop = new THREE.IcosahedronGeometry(radius * 0.68, 2);
  translated(crownTop, 0, topY, 0, 0.92, flatten, 0.92);
  pieces.push(colorGeometry(crownTop, color));
}

function createRockGeometry(): THREE.BufferGeometry {
  const geometry = new THREE.IcosahedronGeometry(1, 2);
  const position = geometry.getAttribute('position');
  for (let i = 0; i < position.count; i++) {
    const factor = 0.84 + ((i * 37 + 19) % 29) / 100;
    position.setXYZ(i, position.getX(i) * factor, position.getY(i) * factor * 0.65, position.getZ(i) * factor);
  }
  position.needsUpdate = true;
  geometry.computeVertexNormals();
  translated(geometry, 0, 0.42, 0, 0.88, 0.78, 1.04);
  return geometry;
}

function mergeAndDispose(pieces: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const compatible = pieces.map((piece) => (piece.index ? piece.toNonIndexed() : piece));
  const merged = mergeGeometries(compatible, false);
  for (const piece of pieces) piece.dispose();
  for (let i = 0; i < compatible.length; i++) {
    if (compatible[i] !== pieces[i]) compatible[i]!.dispose();
  }
  if (!merged) throw new Error('scatter: impossibile unire le geometrie della vegetazione');
  merged.computeBoundingSphere();
  return merged;
}

const DITHER_FRAGMENT = `
      float scatterNoise = fract( sin( dot( gl_FragCoord.xy, vec2( 12.9898, 78.233 ) ) ) * 43758.5453 );
      if ( scatterNoise > vScatterFade ) discard;`;

function fadeSnippet(mode: ScatterMode): string {
  const start = mode === 'hero' ? HERO_FADE_START : NEAR_FADE_START;
  const end = mode === 'hero' ? HERO_FADE_END : NEAR_FADE_END;
  return `
      #ifdef USE_INSTANCING
        vec3 scatterOrigin = instanceMatrix[ 3 ].xyz;
      #else
        vec3 scatterOrigin = vec3( 0.0 );
      #endif
      float scatterDistance = distance( scatterOrigin.xz, uScatterCamera );
      vScatterFade = ${
        mode === 'far'
          ? `smoothstep( ${FAR_TREE_START.toFixed(1)}, ${NEAR_FADE_END.toFixed(1)}, scatterDistance )`
          : `1.0 - smoothstep( ${start.toFixed(1)}, ${end.toFixed(1)}, scatterDistance )`
      };`;
}

/**
 * Materiale di un albero GLB: vento (solo per i modelli che non ce l'hanno già)
 * e dissolvenza LOD. Il dithered cutout fa sparire gradualmente le foglie senza
 * trasparenza né ordinamento dei triangoli.
 */
function decorateTreeMaterial(
  material: THREE.MeshStandardMaterial,
  mode: ScatterMode,
  addWind: boolean,
  height: number,
): void {
  const { uTime, uWind } = windUniforms();
  const original = material.onBeforeCompile;
  const baseKey = material.customProgramCacheKey?.() ?? material.type;
  material.onBeforeCompile = (shader, renderer) => {
    original?.call(material, shader, renderer);
    shader.uniforms.uScatterCamera = scatterCamera;
    let preamble = '';
    let wind = '';
    if (addWind) {
      shader.uniforms.uScatterTime = uTime;
      shader.uniforms.uScatterWind = uWind;
      preamble += '\n        uniform float uScatterTime;\n        uniform vec2 uScatterWind;';
      wind = `
        #ifdef USE_INSTANCING
          vec3 scatterSwayOrigin = instanceMatrix[ 3 ].xyz;
        #else
          vec3 scatterSwayOrigin = vec3( 0.0 );
        #endif
        float scatterBend = clamp( position.y / ${Math.max(0.1, height).toFixed(2)}, 0.0, 1.0 );
        float scatterPhase = scatterSwayOrigin.x * 0.37 + scatterSwayOrigin.z * 0.29;
        float scatterSway = sin( uScatterTime * 1.45 + scatterPhase ) * 0.035;
        transformed.x += scatterSway * scatterBend * scatterBend * uScatterWind.x;
        transformed.z += scatterSway * scatterBend * scatterBend * uScatterWind.y;`;
    }
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>\n        uniform vec2 uScatterCamera;\n        varying float vScatterFade;${preamble}`,
      )
      .replace('#include <begin_vertex>', `#include <begin_vertex>${wind}${fadeSnippet(mode)}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\n        varying float vScatterFade;')
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>${DITHER_FRAGMENT}`);
  };
  material.customProgramCacheKey = () => `${baseKey}-scatter-${mode}-${addWind ? 'wind' : 'still'}`;
  material.needsUpdate = true;
}

function applyWind(
  material: THREE.MeshStandardMaterial,
  strength: number,
  shrub = false,
  fade?: 'near',
): void {
  const { uTime, uWind } = windUniforms();
  const passUniforms = vehiclePassUniforms();
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uScatterWindTime = uTime;
    shader.uniforms.uScatterWind = uWind;
    if (shrub) Object.assign(shader.uniforms, passUniforms);
    if (fade) shader.uniforms.uScatterCamera = scatterCamera;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>\nuniform float uScatterWindTime;\nuniform vec2 uScatterWind;${
          fade ? '\nuniform vec2 uScatterCamera;\nvarying float vScatterFade;' : ''
        }${shrub ? '\nuniform vec2 uCarPos;\nuniform vec2 uCarVel;\nuniform float uCarSpeed;' : ''}`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        #ifdef USE_INSTANCING
          vec3 scatterOrigin = instanceMatrix[ 3 ].xyz;
        #else
          vec3 scatterOrigin = vec3( 0.0 );
        #endif
        float scatterWindHeight = ${shrub ? 'smoothstep( 0.35, 0.9, position.y )' : 'smoothstep( 1.8, 7.2, position.y )'};
        float scatterWind = sin( uScatterWindTime * 1.35 + scatterOrigin.x * 0.031 + scatterOrigin.z * 0.027 );
        transformed.x += scatterWind * scatterWindHeight * ${strength.toFixed(2)} * 0.16 * uScatterWind.x;
        transformed.z += scatterWind * scatterWindHeight * ${strength.toFixed(2)} * 0.16 * uScatterWind.y;${
          fade
            ? `
        float scatterDistance = distance( scatterOrigin.xz, uScatterCamera );
        vScatterFade = 1.0 - smoothstep( ${NEAR_FADE_START.toFixed(1)}, ${NEAR_FADE_END.toFixed(1)}, scatterDistance );`
            : ''
        }${shrub ? vehiclePassSnippet('scatterOrigin', 'scatterWindHeight', 'length( instanceMatrix[ 1 ].xyz )') : ''}`,
      );
    if (fade) {
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vScatterFade;')
        .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>${DITHER_FRAGMENT}`);
    }
  };
  material.customProgramCacheKey = () =>
    `scatter-wind-${strength.toFixed(2)}-${shrub ? 'shrub' : 'tree'}-${fade ? 'near' : 'none'}-v4`;
}

function applyBillboardShader(material: THREE.MeshStandardMaterial): void {
  const { uTime, uWind } = windUniforms();
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uBillboardWindTime = uTime;
    shader.uniforms.uBillboardWind = uWind;
    shader.uniforms.uScatterCamera = scatterCamera;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nuniform float uBillboardWindTime;\nuniform vec2 uBillboardWind;\nuniform vec2 uScatterCamera;\nvarying float vScatterFade;',
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        #ifdef USE_INSTANCING
          vec3 scatterCenter = instanceMatrix[ 3 ].xyz;
          vec3 toCamera = normalize( cameraPosition - ( modelMatrix * vec4( scatterCenter, 1.0 ) ).xyz );
          vec3 right = cross( vec3( 0.0, 1.0, 0.0 ), toCamera );
          right = dot( right, right ) > 0.0001 ? normalize( right ) : vec3( 1.0, 0.0, 0.0 );
          vec3 up = normalize( cross( toCamera, right ) );
          float width = length( instanceMatrix[ 0 ].xyz );
          float height = length( instanceMatrix[ 1 ].xyz );
          vec3 scatterPosition = scatterCenter + right * position.x * width + up * position.y * height;
        #else
          vec3 scatterCenter = vec3( 0.0 );
          vec3 scatterPosition = position;
        #endif
        float scatterDistance = distance( scatterCenter.xz, uScatterCamera );
        vScatterFade = smoothstep( ${FAR_TREE_START.toFixed(1)}, ${NEAR_FADE_END.toFixed(1)}, scatterDistance );
        float billboardBend = smoothstep( -1.5, 2.8, position.y );
        float billboardSway = sin( uBillboardWindTime * 1.35 + scatterCenter.x * 0.031 + scatterCenter.z * 0.027 );
        scatterPosition.x += billboardSway * billboardBend * 0.2 * uBillboardWind.x;
        scatterPosition.z += billboardSway * billboardBend * 0.2 * uBillboardWind.y;`,
      )
      .replace(
        '#include <project_vertex>',
        `vec4 mvPosition = viewMatrix * modelMatrix * vec4( scatterPosition, 1.0 );
        gl_Position = projectionMatrix * mvPosition;`,
      )
      .replace(
        '#include <worldpos_vertex>',
        'vec4 worldPosition = modelMatrix * vec4( scatterPosition, 1.0 );',
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vScatterFade;')
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>${DITHER_FRAGMENT}`);
  };
  material.customProgramCacheKey = () => 'streamed-tree-billboard-wind-v2-lod';
}

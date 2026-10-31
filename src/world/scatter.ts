import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { CanopyField } from '../geo/canopy';
import type { Heightfield } from '../geo/elevation';
import type { ObstacleIndex } from '../geo/obstacles';
import type { BuildingIndex, OsmData, RoadIndex } from '../geo/osm';
import { foliageSet } from '../gfx/textures';
import { vehiclePassSnippet, vehiclePassUniforms, windUniforms } from '../gfx/wind';
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

const LEAF_LOD_RADIUS = 150;
const DEFAULT_RADIUS = 540;
const SMALL_OBJECT_RADIUS = 210;

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
}

interface InstanceSet {
  mesh: THREE.InstancedMesh;
  capacity: number;
}

const TREE_KINDS: readonly TreeKind[] = ['broadleaf', 'olive', 'cypress', 'poplar'];
const ALL_KINDS: readonly RenderKind[] = [...TREE_KINDS, 'shrub', 'rock'];
let nextColliderTag = 0;

/**
 * Deterministic, cell-streamed landscape scatter. Meshes are instanced by
 * species; the full tree stays near the player and photographic foliage cards
 * represent distant crowns.
 */
export class ScatterVegetation {
  readonly group = new THREE.Group();
  private readonly generator: ScatterGenerator;
  private readonly radius: number;
  private readonly cellRadius: number;
  private readonly cellCache = new Map<string, ScatterInstance[]>();
  private readonly nearSets = new Map<RenderKind, InstanceSet>();
  private readonly farSet: InstanceSet;
  private readonly geometries = new Map<RenderKind, THREE.BufferGeometry>();
  private readonly materials = new Map<RenderKind, THREE.MeshStandardMaterial>();
  /** Geometric/materiali presi in prestito dal world kit: non si liberano qui. */
  private readonly borrowed = new Set<THREE.BufferGeometry | THREE.Material>();
  /** Due alberi fotogrammetrici per i 48 esemplari più vicini. */
  private readonly heroVariants: WorldAsset[] = [];
  private readonly heroSets: InstanceSet[][] = [];
  private readonly heroCapacity = 24;
  private readonly billboardGeometry = new THREE.PlaneGeometry(4, 6);
  private readonly billboardMaterial: THREE.MeshStandardMaterial;
  private readonly leafCardGeometry: THREE.BufferGeometry;
  private readonly leafCardMaterial: THREE.MeshStandardMaterial;
  private leafCardSet: InstanceSet;
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
    // cespugli: un GLB leggero (300–900 triangoli) al posto dei cinque blob
    // rotondi; il materiale del kit ha già vento, bagnato e neve
    const shrubAsset =
      kit?.variants('shrub').find((asset) => asset.triangles <= 900 && asset.parts.length > 0) ?? null;
    for (const kind of ALL_KINDS) {
      const borrowedAsset = kind === 'shrub' ? shrubAsset : null;
      const geometry = borrowedAsset?.parts[0]?.geometry ?? createScatterGeometry(kind);
      const material =
        borrowedAsset?.parts[0]?.material ??
        new THREE.MeshStandardMaterial({
          color: 0xffffff,
          vertexColors: true,
          roughness: kind === 'rock' ? 0.96 : 1,
          metalness: 0,
        });
      if (borrowedAsset) {
        this.borrowed.add(geometry);
        this.borrowed.add(material);
      } else if (kind !== 'rock') {
        applyWind(material, kind === 'cypress' ? 0.35 : kind === 'shrub' ? 0.6 : 1, kind === 'shrub');
      }
      this.geometries.set(kind, geometry);
      this.materials.set(kind, material);
      this.nearSets.set(kind, this.createSet(geometry, material, 128));
    }

    // alberi veri per i 48 esemplari più vicini: due modelli da 10–12 m, ruotati
    // e scalati sulla chioma che sostituiscono
    for (const asset of kit?.variants('tree').slice(0, 2) ?? []) {
      if (asset.parts.length === 0) continue;
      const sets = asset.parts.map((part) => {
        this.borrowed.add(part.geometry);
        this.borrowed.add(part.material);
        return this.createSet(part.geometry, part.material, this.heroCapacity);
      });
      this.heroVariants.push(asset);
      this.heroSets.push(sets);
    }

    const leaves = foliageSet(renderer);
    this.leafCardGeometry = createLeafCardGeometry();
    this.leafCardMaterial = new THREE.MeshStandardMaterial({
      map: leaves.map,
      alphaMap: leaves.alphaMap,
      normalMap: leaves.normalMap,
      alphaTest: 0.46,
      alphaToCoverage: true,
      side: THREE.DoubleSide,
      vertexColors: true,
      roughness: 1,
      metalness: 0,
    });
    this.leafCardMaterial.normalScale.set(0.55, 0.55);
    applyWind(this.leafCardMaterial, 1);
    this.leafCardSet = this.createSet(this.leafCardGeometry, this.leafCardMaterial, 512);

    this.billboardMaterial = new THREE.MeshStandardMaterial({
      map: leaves.map,
      alphaMap: leaves.alphaMap,
      alphaTest: 0.42,
      side: THREE.DoubleSide,
      vertexColors: true,
      roughness: 1,
      metalness: 0,
      transparent: false,
    });
    applyBillboardShader(this.billboardMaterial);
    this.farSet = this.createSet(this.billboardGeometry, this.billboardMaterial, 512);
  }

  update(x: number, z: number): void {
    if (this.disposed) return;
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
    for (const set of this.nearSets.values()) this.removeSet(set);
    this.removeSet(this.leafCardSet);
    this.removeSet(this.farSet);
    for (const geometry of this.geometries.values()) {
      if (!this.borrowed.has(geometry)) geometry.dispose();
    }
    this.billboardGeometry.dispose();
    this.leafCardGeometry.dispose();
    for (const material of this.materials.values()) {
      if (!this.borrowed.has(material)) material.dispose();
    }
    this.leafCardMaterial.dispose();
    this.billboardMaterial.dispose();
    this.group.clear();
  }

  private createSet(geometry: THREE.BufferGeometry, material: THREE.Material, capacity: number): InstanceSet {
    const mesh = new THREE.InstancedMesh(geometry, material, capacity);
    mesh.count = 0;
    mesh.frustumCulled = false;
    mesh.castShadow = this.castShadows;
    mesh.receiveShadow = false;
    this.group.add(mesh);
    return { mesh, capacity };
  }

  private ensureCapacity(set: InstanceSet, required: number, geometry: THREE.BufferGeometry, material: THREE.Material): InstanceSet {
    if (required <= set.capacity) return set;
    let capacity = set.capacity;
    while (capacity < required) capacity *= 2;
    const replacement = this.createSet(geometry, material, capacity);
    this.removeSet(set);
    return replacement;
  }

  private removeSet(set: InstanceSet): void {
    this.group.remove(set.mesh);
    set.mesh.dispose();
  }

  private rebuildInstances(x: number, z: number): void {
    const near: Record<RenderKind, ScatterInstance[]> = {
      broadleaf: [],
      olive: [],
      cypress: [],
      poplar: [],
      shrub: [],
      rock: [],
    };
    const distant: ScatterInstance[] = [];
    const leafCards: ScatterInstance[] = [];

    for (const instances of this.cellCache.values()) {
      for (const instance of instances) {
        const dx = instance.x - x;
        const dz = instance.z - z;
        const distance2 = dx * dx + dz * dz;
        if (instance.kind === 'shrub' || instance.kind === 'rock') {
          if (distance2 <= SMALL_OBJECT_RADIUS * SMALL_OBJECT_RADIUS) near[instance.kind].push(instance);
        } else if (distance2 <= LEAF_LOD_RADIUS * LEAF_LOD_RADIUS) {
          near[instance.kind].push(instance);
          if (instance.kind !== 'cypress') leafCards.push(instance);
        } else {
          distant.push(instance);
        }
      }
    }

    // I 48 alberi più vicini diventano GLB: il resto resta al LOD a schede.
    // Toglierli dai set procedurali evita l'albero doppio allo stesso punto.
    const heroes = this.pickHeroes([...near.broadleaf, ...near.olive], x, z);
    if (heroes.length > 0) {
      const used = new Set(heroes);
      near.broadleaf = near.broadleaf.filter((instance) => !used.has(instance));
      near.olive = near.olive.filter((instance) => !used.has(instance));
      for (let i = leafCards.length - 1; i >= 0; i--) {
        if (used.has(leafCards[i]!)) leafCards.splice(i, 1);
      }
    }
    this.writeHeroes(heroes);

    for (const kind of ALL_KINDS) {
      const instances = near[kind];
      let set = this.nearSets.get(kind)!;
      set = this.ensureCapacity(set, instances.length, this.geometries.get(kind)!, this.materials.get(kind)!);
      this.nearSets.set(kind, set);
      this.writeInstances(set.mesh, instances, kind);
    }
    this.leafCardSet = this.ensureCapacity(
      this.leafCardSet,
      leafCards.length,
      this.leafCardGeometry,
      this.leafCardMaterial,
    );
    this.writeLeafCards(this.leafCardSet.mesh, leafCards);
    const far = this.ensureCapacity(this.farSet, distant.length, this.billboardGeometry, this.billboardMaterial);
    if (far !== this.farSet) Object.assign(this.farSet, far);
    this.writeBillboards(this.farSet.mesh, distant);
  }

  /** I più vicini entro 120 m, fino a 24 per ciascuno dei due modelli GLB. */
  private pickHeroes(instances: readonly ScatterInstance[], x: number, z: number): ScatterInstance[] {
    if (this.heroVariants.length === 0) return [];
    const limit = this.heroCapacity * this.heroVariants.length;
    return instances
      .map((instance) => ({
        instance,
        d: (instance.x - x) ** 2 + (instance.z - z) ** 2,
      }))
      .filter((entry) => entry.d <= 120 * 120)
      .sort((a, b) => a.d - b.d)
      .slice(0, limit)
      .map((entry) => entry.instance);
  }

  private writeHeroes(heroes: readonly ScatterInstance[]): void {
    const counts = new Array<number>(this.heroVariants.length).fill(0);
    for (const sets of this.heroSets) for (const set of sets) set.mesh.count = 0;
    heroes.forEach((instance, index) => {
      const variant = index % this.heroVariants.length;
      const asset = this.heroVariants[variant]!;
      const slot = counts[variant]!;
      if (slot >= this.heroCapacity) return;
      counts[variant] = slot + 1;
      // la chioma GLB è alta 10,5–12 m: la si scala all'altezza della specie
      const target = treeDimensions(instance.kind as TreeKind).height * instance.scale;
      const scale = target / Math.max(0.1, asset.size.y);
      this.dummy.position.set(instance.x, instance.y - 0.08, instance.z);
      this.dummy.rotation.set(0, instance.rotation, 0);
      this.dummy.scale.setScalar(scale);
      this.dummy.updateMatrix();
      for (const set of this.heroSets[variant]!) {
        set.mesh.setMatrixAt(slot, this.dummy.matrix);
        this.color.setHex(colorFor(instance.kind, instance.variation));
        set.mesh.setColorAt(slot, this.color);
      }
    });
    for (let variant = 0; variant < this.heroSets.length; variant++) {
      for (const set of this.heroSets[variant]!) {
        set.mesh.count = counts[variant]!;
        set.mesh.instanceMatrix.needsUpdate = true;
        if (set.mesh.instanceColor) set.mesh.instanceColor.needsUpdate = true;
      }
    }
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

  private writeInstances(mesh: THREE.InstancedMesh, instances: readonly ScatterInstance[], kind: RenderKind): void {
    for (let i = 0; i < instances.length; i++) {
      const instance = instances[i]!;
      this.dummy.position.set(instance.x, instance.y, instance.z);
      this.dummy.rotation.set(0, instance.rotation, 0);
      this.dummy.scale.setScalar(instance.scale);
      this.dummy.updateMatrix();
      mesh.setMatrixAt(i, this.dummy.matrix);
      this.color.setHex(colorFor(kind, instance.variation));
      mesh.setColorAt(i, this.color);
    }
    mesh.count = instances.length;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }

  private writeBillboards(mesh: THREE.InstancedMesh, instances: readonly ScatterInstance[]): void {
    for (let i = 0; i < instances.length; i++) {
      const instance = instances[i]!;
      const dimensions = treeDimensions(instance.kind as TreeKind);
      this.dummy.position.set(instance.x, instance.y + dimensions.height * instance.scale * 0.5, instance.z);
      this.dummy.rotation.set(0, 0, 0);
      this.dummy.scale.set((dimensions.width / 4) * instance.scale, (dimensions.height / 6) * instance.scale, 1);
      this.dummy.updateMatrix();
      mesh.setMatrixAt(i, this.dummy.matrix);
      this.color.setHex(colorFor(instance.kind, instance.variation));
      mesh.setColorAt(i, this.color);
    }
    mesh.count = instances.length;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }

  private writeLeafCards(mesh: THREE.InstancedMesh, instances: readonly ScatterInstance[]): void {
    for (let i = 0; i < instances.length; i++) {
      const instance = instances[i]!;
      this.dummy.position.set(instance.x, instance.y, instance.z);
      this.dummy.rotation.set(0, instance.rotation, 0);
      const crownScale = instance.kind === 'olive' ? [1.12, 0.7, 1.12] : instance.kind === 'poplar' ? [0.78, 1.18, 0.78] : [1, 1, 1];
      this.dummy.scale.set(
        instance.scale * crownScale[0]!,
        instance.scale * crownScale[1]!,
        instance.scale * crownScale[2]!,
      );
      this.dummy.updateMatrix();
      mesh.setMatrixAt(i, this.dummy.matrix);
      this.color.setHex(colorFor(instance.kind, instance.variation));
      mesh.setColorAt(i, this.color);
    }
    mesh.count = instances.length;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }
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

function createLeafCardGeometry(): THREE.BufferGeometry {
  const rng = (index: number): number => {
    const value = Math.sin(index * 127.1 + 311.7) * 43758.5453;
    return value - Math.floor(value);
  };
  const pieces: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 12; i++) {
    const size = 1.8 + rng(i + 1) * 0.9;
    const geometry = new THREE.PlaneGeometry(size, size * 1.12, 2, 3);
    const angle = (i / 12) * Math.PI * 2 + rng(i + 14) * 0.6;
    const elevation = 3.1 + rng(i + 24) * 2.4;
    const radius = 0.2 + rng(i + 38) * 0.75;
    geometry.rotateY(angle);
    geometry.rotateX((rng(i + 51) - 0.5) * 0.42);
    geometry.translate(Math.cos(angle) * radius, elevation, Math.sin(angle) * radius);
    pieces.push(colorGeometry(geometry, 0xffffff));
  }
  return mergeAndDispose(pieces);
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

function applyWind(material: THREE.MeshStandardMaterial, strength: number, shrub = false): void {
  const { uTime, uWind } = windUniforms();
  const passUniforms = vehiclePassUniforms();
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uScatterWindTime = uTime;
    shader.uniforms.uScatterWind = uWind;
    if (shrub) Object.assign(shader.uniforms, passUniforms);
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>\nuniform float uScatterWindTime;\nuniform vec2 uScatterWind;${
          shrub ? '\nuniform vec2 uCarPos;\nuniform float uCarSpeed;' : ''
        }`,
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
          shrub ? vehiclePassSnippet('scatterOrigin', 'scatterWindHeight', 'length( instanceMatrix[ 1 ].xyz )') : ''
        }`,
      );
  };
  material.customProgramCacheKey = () => `scatter-wind-${strength.toFixed(2)}-${shrub ? 'shrub' : 'tree'}-v3`;
}

function applyBillboardShader(material: THREE.MeshStandardMaterial): void {
  const { uTime, uWind } = windUniforms();
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uBillboardWindTime = uTime;
    shader.uniforms.uBillboardWind = uWind;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nuniform float uBillboardWindTime;\nuniform vec2 uBillboardWind;',
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
  };
  material.customProgramCacheKey = () => 'streamed-tree-billboard-wind-v1';
}

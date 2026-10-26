import * as THREE from 'three';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { preciseBox, splitCarWheels } from '../entities/car-wheels';

/**
 * Auto di serie fornite come GLB (`public/cars/`).
 *
 * I file non stanno nel repository (sono pesanti e la licenza va verificata):
 * `public/cars/manifest.json` elenca slug, file e rotazione del muso. Chi clona
 * il progetto mette i `.glb` nella stessa cartella e ritrova le auto nel menu;
 * se mancano, il veicolo ricade sulla sagoma procedurale senza errori.
 *
 * Ogni modello viene normalizzato una volta sola e poi riusato:
 * - lunghezza 1 sull'asse Z, muso verso **+Z** (il gioco ruota di 180°);
 * - base a y = 0 e centro in x/z, così non affonda né galleggia;
 * - ruote con perno al mozzo, nominate `wheel-fl`… e raggiungere con
 *   `Vehicle.collectExternalWheels` come quelle del garage;
 * - niente riflessi "da showroom": alcuni GLB usano la texture della vernice
 *   come emissiva con intensità 35, e in gioco ruote e griglie diventerebbero
 *   bianche. Qui quell'imbroglio viene spento.
 *
 * La scala finale la decide lo `spec` (`length`): lo stesso template può servire
 * per una versione lunga o corta dell'auto.
 */

export interface CarManifestEntry {
  /** id usato da `VehicleSpec.model` */
  slug: string;
  /** nome del file dentro `public/cars/` */
  file: string;
  /** nome leggibile, solo per diagnostica */
  name?: string;
  /**
   * Rotazione attorno a Y, in gradi, per portare il muso dell'asset verso +Z.
   * 0 = il modello guarda già a +Z; 180 = muso a -Z; 90 = muso a -X.
   */
  yaw?: number;
  /** lunghezza misurata dell'asset, in metri (diagnostica) */
  length?: number;
  /**
   * Nodi o materiali da togliere prima di normalizzare: molti GLB da gioco
   * portano con sé un piano d'ombra finto, una copertura o pezzi della
   * trasformazione che nel mondo non devono esistere. Si tolgono davvero,
   * così non entrano né nel box né nella scena.
   */
  hide?: string[];
}

export interface CarAsset {
  slug: string;
  /** modello normalizzato: lunghezza 1, muso +Z, base a y = 0 */
  template: THREE.Group;
  /** ingombri nel template (z ≈ 1) */
  size: THREE.Vector3;
  /** ruote animate trovate (0–4) */
  wheels: number;
}

interface Manifest {
  version?: number;
  cars?: CarManifestEntry[];
}

const WHEEL_TAG = /(?:wheel|ruota)[-_ ]?(fl|fr|rl|rr|bl|br)(?![a-z0-9])/i;
const FRONT_WORDS = /(?:front|anteriore|avantreno)[-_ ]?(left|right|sinistra|destra)[-_ ]?(?:wheel|ruota)/i;
const REAR_WORDS = /(?:rear|retro|posteriore)[-_ ]?(left|right|sinistra|destra)[-_ ]?(?:wheel|ruota)/i;
const BRAKE_PART = /caliper|pinza|brakes?\b|freno/i;
const NOT_A_WHEEL = /caliper|pinza|brakes?\b|freno|steering|volante|mirror|specchietto|seat|sedile|targa|plate/i;

/** Legge il manifest; se manca o è rotto il gioco parte senza auto GLB. */
export async function loadCarManifest(baseUrl: string): Promise<CarManifestEntry[]> {
  try {
    const response = await fetch(`${baseUrl}manifest.json`, { cache: 'no-cache' });
    if (!response.ok) return [];
    const data = (await response.json()) as Manifest;
    if (!Array.isArray(data.cars)) return [];
    return data.cars.filter((entry) => entry && typeof entry.slug === 'string' && typeof entry.file === 'string');
  } catch {
    return [];
  }
}

function tagFromName(name: string): string | null {
  // moto e modelli con due sole ruote: `front_wheel` / `rear_wheel`
  if (/(?:^|[-_ ])front[-_ ]?wheel$/i.test(name)) return 'fl';
  if (/(?:^|[-_ ])rear[-_ ]?wheel$/i.test(name)) return 'rl';
  const direct = WHEEL_TAG.exec(name);
  if (direct) {
    const tag = direct[1].toLowerCase();
    return tag === 'bl' ? 'rl' : tag === 'br' ? 'rr' : tag;
  }
  const front = FRONT_WORDS.exec(name);
  if (front) return front[1].toLowerCase().startsWith('l') || front[1].toLowerCase().startsWith('s') ? 'fl' : 'fr';
  const rear = REAR_WORDS.exec(name);
  if (rear) return rear[1].toLowerCase().startsWith('l') || rear[1].toLowerCase().startsWith('s') ? 'rl' : 'rr';
  return null;
}

function depthOf(object: THREE.Object3D): number {
  let depth = 0;
  for (let parent = object.parent; parent; parent = parent.parent) depth++;
  return depth;
}

function isInsideHub(object: THREE.Object3D): boolean {
  for (let parent = object.parent; parent; parent = parent.parent) {
    if (parent.name.endsWith('-hub')) return true;
  }
  return false;
}

/** Toglie dalla scena i nodi e i materiali elencati nel manifest. */
function removeHidden(root: THREE.Object3D, hide: readonly string[]): void {
  if (hide.length === 0) return;
  const wanted = new Set(hide.map((name) => name.toLowerCase()));
  const doomed: THREE.Object3D[] = [];
  root.traverse((object) => {
    const names = [object.name.toLowerCase()];
    const mesh = object as THREE.Mesh;
    if (mesh.isMesh) {
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const material of materials) if (material?.name) names.push(material.name.toLowerCase());
    }
    if (names.some((name) => wanted.has(name))) doomed.push(object);
  });
  for (const object of doomed) object.parent?.remove(object);
}

/** Spegne le emissive "da showroom" che usano l'albedo come luce. */
function tameMaterials(root: THREE.Object3D, anisotropy: number): void {
  const seen = new Set<THREE.Material>();
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const material of materials) {
      if (!material || seen.has(material)) continue;
      seen.add(material);
      const standard = material as THREE.MeshStandardMaterial;
      if (!standard.isMeshStandardMaterial) continue;
      // Audi R8 (e altri GLB da showroom): emissiveFactor 1,1,1 × 35 sulla
      // stessa texture dell'albedo. In gioco significa cerchi bianchi.
      if (
        standard.emissiveIntensity > 2 &&
        standard.emissiveMap &&
        standard.map &&
        standard.emissiveMap.source === standard.map.source
      ) {
        standard.emissive.setHex(0x000000);
        standard.emissiveIntensity = 0;
        standard.emissiveMap = null;
        standard.needsUpdate = true;
      }
      // Alcuni modelli chiamano "glass" il materiale del lunotto ma non
      // dichiarano né alpha né trasmissione: glTF lo lascia bianco e opaco e
      // in gioco sembra un telo steso sul motore. Il nome è l'unica
      // informazione disponibile, quindi si applica un vetro scuro leggero.
      // Gomme quasi nere (0x0a0a0a) su asfalto scuro: la ruota sparisce nel
      // manto e l'auto sembra galleggiare. Un grigio-caldo opaco con un filo
      // di ambiente riflesso stacca il cerchio dalla strada.
      if (/tyre|tire|rubber|pneumatic|gomma/i.test(standard.name)) {
        if (!standard.map && standard.color.r + standard.color.g + standard.color.b < 0.25) {
          standard.color.setHex(0x1f2225);
        }
        standard.roughness = Math.max(standard.roughness, 0.82);
        standard.envMapIntensity = Math.max(standard.envMapIntensity ?? 1, 0.5);
        standard.needsUpdate = true;
      }
      const glass = /glass|window|windshield|windscreen|vetro|cristallo|lunotto/i.test(standard.name);
      const physical = standard as THREE.MeshPhysicalMaterial;
      if (glass && !standard.transparent && standard.opacity >= 0.99 && !physical.transmission) {
        standard.transparent = true;
        standard.opacity = 0.34;
        standard.depthWrite = false;
        standard.color.setHex(standard.map ? 0x9fb2bb : 0x22313b);
        standard.roughness = Math.min(standard.roughness, 0.08);
        standard.metalness = Math.min(standard.metalness, 0.2);
        standard.envMapIntensity = Math.max(standard.envMapIntensity ?? 1, 1.25);
        standard.needsUpdate = true;
      }
      for (const value of Object.values(standard)) {
        const texture = value as THREE.Texture | null;
        if (texture && (texture as THREE.Texture).isTexture) texture.anisotropy = anisotropy;
      }
    }
  });
}

/**
 * Crea il perno della ruota nel spazio del template e ci aggancia il nodo.
 * Il perno resta figlio del template (non del nodo ruotato): così `rotation.x`
 * è sempre l'asse trasversale dell'auto, qualunque rotazione abbiano i nodi del
 * GLB.
 */
function makeHub(template: THREE.Group, node: THREE.Object3D, tag: string): THREE.Group {
  const box = preciseBox(node);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const hub = new THREE.Group();
  hub.name = `wheel-${tag}-hub`;
  hub.position.copy(center);
  hub.rotation.order = 'YXZ';
  hub.userData.wheelRadius = Math.max(size.x, size.y, size.z) / 2;
  template.add(hub);
  hub.updateMatrixWorld(true);
  hub.attach(node);
  node.name = `wheel-${tag}`;
  return hub;
}

/** Nodi ruota dichiarati dall'autore, scelti al livello più alto (non annidati). */
function declaredWheels(template: THREE.Group): { node: THREE.Object3D; tag: string }[] {
  const candidates: { node: THREE.Object3D; tag: string; depth: number }[] = [];
  template.traverse((object) => {
    if (!object.name || isInsideHub(object)) return;
    if (BRAKE_PART.test(object.name)) return;
    const tag = tagFromName(object.name);
    if (!tag) return;
    candidates.push({ node: object, tag, depth: depthOf(object) });
  });
  candidates.sort((a, b) => a.depth - b.depth);

  const chosen: { node: THREE.Object3D; tag: string }[] = [];
  const tags = new Set<string>();
  for (const candidate of candidates) {
    if (tags.has(candidate.tag)) continue;
    if (chosen.some((other) => isAncestor(other.node, candidate.node))) continue;
    tags.add(candidate.tag);
    chosen.push({ node: candidate.node, tag: candidate.tag });
  }
  return chosen;
}

function isAncestor(ancestor: THREE.Object3D, object: THREE.Object3D): boolean {
  for (let parent = object.parent; parent; parent = parent.parent) {
    if (parent === ancestor) return true;
  }
  return false;
}

/** Pinze e freni non devono girare con la ruota: restano nel corpo. */
function detachBrakeParts(wheel: THREE.Object3D, template: THREE.Group): void {
  const moving: THREE.Object3D[] = [];
  wheel.traverse((object) => {
    if (object !== wheel && BRAKE_PART.test(object.name)) moving.push(object);
  });
  for (const object of moving) {
    if (isInsideHub(object)) continue;
    // se un antenato è già stato spostato, questo viaggia con lui
    if (moving.some((other) => other !== object && isAncestor(other, object))) continue;
    template.attach(object);
  }
}

/**
 * Ruote non dichiarate (es. Defender: cerchi e pneumatici sono nodi separati
 * con nomi che non seguono una convenzione). Si cercano le mesh a forma di
 * disco nella metà bassa e vicino ai quattro angoli, poi si uniscono per
 * angolo: cerchio, pneumatico e disco freno finiscono sullo stesso perno.
 */
function geometricWheels(template: THREE.Group, box: THREE.Box3): number {
  const size = box.getSize(new THREE.Vector3());
  const width = Math.max(size.x, 0.2);
  const height = Math.max(size.y, 0.2);
  const length = Math.max(size.z, 0.2);

  const targets = [
    new THREE.Vector3(-width * 0.42, 0, length * 0.33),
    new THREE.Vector3(width * 0.42, 0, length * 0.33),
    new THREE.Vector3(-width * 0.42, 0, -length * 0.33),
    new THREE.Vector3(width * 0.42, 0, -length * 0.33),
  ];

  const candidates: { mesh: THREE.Mesh; center: THREE.Vector3 }[] = [];
  template.traverse((object) => {
    const mesh = object as THREE.Mesh & { isInstancedMesh?: boolean; isSkinnedMesh?: boolean };
    if (!mesh.isMesh || !mesh.visible || mesh.isInstancedMesh || mesh.isSkinnedMesh) return;
    if (isInsideHub(object) || NOT_A_WHEEL.test(object.name)) return;
    const meshBox = preciseBox(mesh);
    if (meshBox.isEmpty()) return;
    const s = meshBox.getSize(new THREE.Vector3());
    const [d0, d1, d2] = [s.x, s.y, s.z].sort((a, b) => b - a);
    if (d0 < 0.05 || d0 > 0.32) return;
    if (d1 / d0 < 0.78) return;
    if (d2 / d0 > 0.72) return;
    const center = meshBox.getCenter(new THREE.Vector3());
    if (center.y > box.min.y + height * 0.55) return;
    if (Math.abs(center.x - (box.min.x + box.max.x) / 2) < width * 0.18) return;
    if (Math.abs(center.z - (box.min.z + box.max.z) / 2) < length * 0.15) return;
    candidates.push({ mesh, center });
  });
  if (candidates.length < 4) return 0;

  const clusters: { target: THREE.Vector3; items: THREE.Mesh[] }[] = targets.map((target) => ({ target, items: [] }));
  const limit = Math.max(width, 0.3) * 0.62;
  for (const candidate of candidates) {
    let best = -1;
    let bestDistance = Infinity;
    for (let i = 0; i < clusters.length; i++) {
      const target = clusters[i].target;
      const distance = Math.hypot(candidate.center.x - target.x, candidate.center.z - target.z);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = i;
      }
    }
    if (best >= 0 && bestDistance <= limit) clusters[best].items.push(candidate.mesh);
  }
  if (clusters.some((cluster) => cluster.items.length === 0)) return 0;

  let wheels = 0;
  for (let i = 0; i < clusters.length; i++) {
    const items = clusters[i].items;
    const union = new THREE.Box3();
    for (const mesh of items) union.union(preciseBox(mesh));
    if (union.isEmpty()) continue;
    const center = union.getCenter(new THREE.Vector3());
    const hub = new THREE.Group();
    hub.name = `wheel-${['fl', 'fr', 'rl', 'rr'][i]}-hub`;
    hub.position.copy(center);
    hub.rotation.order = 'YXZ';
    const unionSize = union.getSize(new THREE.Vector3());
    hub.userData.wheelRadius = Math.max(unionSize.x, unionSize.y, unionSize.z) / 2;
    template.add(hub);
    hub.updateMatrixWorld(true);
    for (const mesh of items) hub.attach(mesh);
    wheels++;
  }
  return wheels;
}

/** Porta un GLB grezzo al formato interno. */
function normalize(root: THREE.Object3D, entry: CarManifestEntry): THREE.Group {
  const scene = root;
  scene.updateMatrixWorld(true);

  const orient = new THREE.Group();
  orient.name = 'car-orient';
  orient.rotation.y = THREE.MathUtils.degToRad(entry.yaw ?? 0);
  orient.add(scene);

  const template = new THREE.Group();
  template.name = `car:${entry.slug}`;
  template.add(orient);
  template.updateMatrixWorld(true);

  // lunghezza 1: scala, base a terra, centro sull'asse. `preciseBox` serve
  // perché i GLB ruotano la scocca dentro i nodi e il box OBB raddoppierebbe.
  const raw = preciseBox(template);
  const rawSize = raw.getSize(new THREE.Vector3());
  const long = Math.max(rawSize.x, rawSize.z);
  const scale = 1 / Math.max(0.001, long);
  orient.scale.setScalar(scale);
  template.updateMatrixWorld(true);

  const scaled = preciseBox(template);
  const center = scaled.getCenter(new THREE.Vector3());
  orient.position.set(-center.x, -scaled.min.y, -center.z);
  template.updateMatrixWorld(true);

  return template;
}

export class CarLibrary {
  private readonly entries = new Map<string, CarManifestEntry>();
  private readonly pending = new Map<string, Promise<CarAsset | null>>();
  private readonly ready = new Map<string, CarAsset>();
  private readonly loader: GLTFLoader;

  constructor(
    private readonly baseUrl: string,
    dracoUrl: string,
    private readonly anisotropy = 8,
  ) {
    const draco = new DRACOLoader().setDecoderPath(dracoUrl);
    this.loader = new GLTFLoader().setDRACOLoader(draco);
  }

  async loadManifest(): Promise<number> {
    const entries = await loadCarManifest(this.baseUrl);
    for (const entry of entries) this.entries.set(entry.slug, entry);
    return entries.length;
  }

  has(slug: string): boolean {
    return this.entries.has(slug);
  }

  /** Template già pronto (usato da `Vehicle.resolveExternal`, sincrono). */
  cached(slug: string): CarAsset | null {
    return this.ready.get(slug) ?? null;
  }

  /** Carica (o riusa) un'auto. Non lancia: un GLB rotto non ferma il gioco. */
  get(slug: string): Promise<CarAsset | null> {
    const cached = this.ready.get(slug);
    if (cached) return Promise.resolve(cached);
    const running = this.pending.get(slug);
    if (running) return running;
    const entry = this.entries.get(slug);
    if (!entry) return Promise.resolve(null);

    const promise = this.load(entry)
      .then((asset) => {
        if (asset) this.ready.set(slug, asset);
        return asset;
      })
      .catch((error: unknown) => {
        console.warn(`auto GLB non caricata (${slug})`, error);
        return null;
      })
      .finally(() => this.pending.delete(slug));
    this.pending.set(slug, promise);
    return promise;
  }

  private async load(entry: CarManifestEntry): Promise<CarAsset | null> {
    const gltf = await this.loader.loadAsync(`${this.baseUrl}${entry.file}`);
    removeHidden(gltf.scene, entry.hide ?? []);
    tameMaterials(gltf.scene, this.anisotropy);
    const template = normalize(gltf.scene, entry);

    const box = preciseBox(template);
    const size = box.getSize(new THREE.Vector3());

    let wheels = 0;
    const declared = declaredWheels(template);
    const twoWheeler =
      declared.length === 2 &&
      declared.some((wheel) => wheel.tag === 'fl') &&
      declared.some((wheel) => wheel.tag === 'rl');
    if (declared.length >= 4 || twoWheeler) {
      for (const { node, tag } of declared) {
        detachBrakeParts(node, template);
        makeHub(template, node, tag);
        wheels++;
      }
    } else if (declared.length === 0) {
      wheels = geometricWheels(template, box);
    }
    // ultimo tentativo: ruote fuse nella carrozzeria (Punto e molti GLB
    // esportati da editor voxel). `splitCarWheels` non tocca nulla se non
    // trova quattro ruote plausibili.
    if (wheels === 0) {
      const split = splitCarWheels(template, false);
      wheels = split?.wheels ?? 0;
    }

    return { slug: entry.slug, template, size, wheels };
  }
}

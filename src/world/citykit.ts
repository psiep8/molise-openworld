import * as THREE from 'three';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

/**
 * City kit (threejsassets.com).
 *
 * Il nucleo è il pack **Realistic City** (tier free): strada, marciapiede,
 * panchina, lampione, alberi, berlina. Ai ruoli "da paese" si aggiungono
 * modelli low-poly presi dagli altri pack gratuiti del sito per quello che al
 * Realistic City manca: siepi, canneti, rovi, massi di campagna, un relitto.
 * Sono sagome piccole e senza dettagli leggibili a 20 m, quindi non abbassano
 * la resa, e costano 0,4–2k triangoli l'una.
 *
 * I GLB arrivano in scala reale (i low-poly a volte no) ma con il **pivot al
 * centro del bounding box**: senza normalizzazione mezza panchina starebbe sotto
 * terra. Qui ogni modello viene riportato con la base a y = 0 e il centro in
 * x/z, poi le mesh vengono "appiattite" in parti (geometria + materiale) per
 * poterle istanziare: una panchina è 5 parti, una macchina 16, ma 40 panchine
 * restano 5 draw call.
 *
 * I file non sono nel repository (licenza Free Commercial, vietata la
 * ridistribuzione): se `public/citykit/manifest.json` manca, `loadCityKit`
 * restituisce `null` e il mondo resta quello procedurale di sempre.
 */

export type KitRole =
  | 'road-surface'
  | 'road-junction'
  | 'sidewalk'
  | 'plaza'
  | 'tree-street'
  | 'tree-park'
  | 'lamp'
  | 'traffic-light'
  | 'sign'
  | 'bench'
  | 'bin'
  | 'car'
  | 'boulder'
  /* vegetazione e pietre di campagna: modelli low-poly, ma a queste scale
   * (siepi, canneti, rovi, massi) la differenza di stile non si legge e la
   * sagoma è quella giusta */
  | 'hedge'
  | 'bush'
  | 'reed'
  | 'rock'
  | 'wreck';

export interface KitSpot {
  x: number;
  y: number;
  z: number;
  /** rotazione su Y: il modello guarda +Z quando yaw = 0 */
  yaw: number;
  scale?: number;
  /** tinta della vernice (solo `car`): moltiplica la texture della carrozzeria */
  color?: number;
  /** indice della variante quando il ruolo ne ha più di una (massi, ecc.) */
  variant?: number;
}

export interface KitPart {
  name: string;
  geometry: THREE.BufferGeometry;
  material: THREE.MeshStandardMaterial;
  /** vernice auto: materiale con colore bianco, pronto per il tint per istanza */
  tintable?: THREE.MeshStandardMaterial;
  castShadow: boolean;
}

export interface KitAsset {
  role: KitRole;
  slug: string;
  name: string;
  /** dimensioni reali dopo la normalizzazione (metri) */
  size: THREE.Vector3;
  template: THREE.Object3D;
  parts: KitPart[];
}

interface ManifestEntry {
  role: KitRole;
  slug: string;
  name: string;
}

interface Manifest {
  assets: ManifestEntry[];
}

const DECAL_PART = /(stain|decal|shadow|gum|litter|soil|mulch|ground)/i;
const PAINT_PART = /paint/i;

/** Materiali "di servizio": non devono proiettare ombre, sono decalcomanie. */
function shouldCast(name: string, material: THREE.Material): boolean {
  if (DECAL_PART.test(name)) return false;
  if ((material as THREE.MeshStandardMaterial).transparent) return false;
  return true;
}

/**
 * Il modulo world/roads applica la bagnatura del meteo leggendo
 * `material.userData.roadWet`. Il materiale del kit è un MeshStandardMaterial
 * del loader glTF, quindi gli si aggiunge lo stesso aggancio: scurisce e lucida
 * senza toccare le mappe.
 */
function applyWetness(material: THREE.MeshStandardMaterial): void {
  const wet = { value: 0 };
  (material.userData as { roadWet?: { value: number } }).roadWet = wet;
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uRoadWet = wet;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uRoadWet;')
      .replace('#include <map_fragment>', '#include <map_fragment>\ndiffuseColor.rgb *= mix(1.0, 0.55, uRoadWet);')
      .replace(
        '#include <roughnessmap_fragment>',
        '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.14, uRoadWet);',
      );
  };
  material.customProgramCacheKey = () => 'citykit-wet-v1';
}

export class CityKit {
  /** Un ruolo può avere più modelli intercambiabili (tre massi, ecc.). */
  readonly assets = new Map<KitRole, KitAsset[]>();

  constructor(assets: KitAsset[]) {
    for (const asset of assets) {
      const list = this.assets.get(asset.role);
      if (list) list.push(asset);
      else this.assets.set(asset.role, [asset]);
    }
  }

  get count(): number {
    let total = 0;
    for (const list of this.assets.values()) total += list.length;
    return total;
  }

  get roles(): KitRole[] {
    return [...this.assets.keys()];
  }

  has(role: KitRole): boolean {
    return (this.assets.get(role)?.length ?? 0) > 0;
  }

  /** Tutti i modelli del ruolo, nell'ordine del manifest. */
  variants(role: KitRole): KitAsset[] {
    return this.assets.get(role) ?? [];
  }

  asset(role: KitRole): KitAsset | undefined {
    return this.assets.get(role)?.[0];
  }

  part(role: KitRole, partName: string): KitPart | undefined {
    return this.asset(role)?.parts.find((p) => p.name === partName);
  }

  /** Dimensioni reali già normalizzate (per decidere distanze e ingombri). */
  size(role: KitRole): THREE.Vector3 | null {
    const asset = this.asset(role);
    return asset ? asset.size.clone() : null;
  }

  /**
   * Materiale clonato per la superficie stradale/marciapiede.
   *
   * Le mappe del kit sono pensate per una tile: `repeat` le riporta in metri
   * sulle UV dei nastri OSM (che corrono in metri). Il colore per vertice
   * resta quello dei nastri (quasi bianco), quindi `white` evita di scurire
   * due volte il materiale.
   */
  material(
    role: KitRole,
    partName: string,
    opts: { repeat?: [number, number]; white?: boolean; wet?: boolean } = {},
  ): THREE.MeshStandardMaterial | null {
    const part = this.part(role, partName);
    if (!part) return null;
    const material = part.material.clone();
    if (opts.white) material.color.setHex(0xffffff);
    if (opts.repeat) {
      for (const slot of ['map', 'normalMap', 'roughnessMap', 'aoMap', 'emissiveMap'] as const) {
        const texture = material[slot] as THREE.Texture | null;
        if (!texture) continue;
        const clone = texture.clone();
        clone.wrapS = THREE.RepeatWrapping;
        clone.wrapT = THREE.RepeatWrapping;
        clone.repeat.set(opts.repeat[0], opts.repeat[1]);
        clone.needsUpdate = true;
        (material as unknown as Record<string, THREE.Texture | null>)[slot] = clone;
      }
    }
    if (opts.wet) applyWetness(material);
    material.needsUpdate = true;
    return material;
  }

  /**
   * Istanze di un asset in una sola passata. `frustumCulled = false` perché il
   * bounding sphere di un InstancedMesh è quello della geometria singola: con
   * le istanze sparse il culling taglierebbe via pezzi visibili.
   */
  instances(
    role: KitRole,
    spots: KitSpot[],
    opts: { castShadow?: boolean; receiveShadow?: boolean; tintPaint?: boolean } = {},
  ): THREE.Group {
    const group = new THREE.Group();
    group.name = `kit-${role}`;
    const assets = this.variants(role);
    if (assets.length === 0 || spots.length === 0) return group;

    const dummy = new THREE.Object3D();
    const tint = new THREE.Color();
    for (let variant = 0; variant < assets.length; variant++) {
      const asset = assets[variant];
      // con un solo modello si usa tutto; con più varianti ognuna prende le sue
      // istanze (le altre restano fuori, così i massi non si sovrappongono)
      const own = assets.length === 1 ? spots : spots.filter((spot) => (spot.variant ?? 0) === variant);
      if (own.length === 0) continue;
      for (const part of asset.parts) {
        const painted = opts.tintPaint === true && PAINT_PART.test(part.name);
        const material = painted && part.tintable ? part.tintable : part.material;
        const mesh = new THREE.InstancedMesh(part.geometry, material, own.length);
        mesh.name = `${role}-${part.name}`;
        mesh.frustumCulled = false;
        mesh.castShadow = opts.castShadow ?? part.castShadow;
        mesh.receiveShadow = opts.receiveShadow ?? true;
        for (let i = 0; i < own.length; i++) {
          const spot = own[i];
          dummy.position.set(spot.x, spot.y, spot.z);
          dummy.rotation.set(0, spot.yaw, 0);
          dummy.scale.setScalar(spot.scale ?? 1);
          dummy.updateMatrix();
          mesh.setMatrixAt(i, dummy.matrix);
          if (painted && spot.color !== undefined) {
            tint.setHex(spot.color);
            mesh.setColorAt(i, tint);
          }
        }
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
        group.add(mesh);
      }
    }
    return group;
  }

  /** Clone singolo (targhette, oggetti unici): geometrie e materiali condivisi. */
  create(role: KitRole, spot: KitSpot): THREE.Object3D | null {
    const list = this.variants(role);
    const asset = list[Math.min(spot.variant ?? 0, list.length - 1)];
    if (!asset) return null;
    const object = asset.template.clone(true);
    object.position.set(spot.x, spot.y, spot.z);
    object.rotation.y = spot.yaw;
    if (spot.scale) object.scale.setScalar(spot.scale);
    return object;
  }

  /** Materiali emissivi (lampioni, fari) da accendere di notte. */
  glowMaterials(role: KitRole, pattern = /(led|lens|emit)/i): THREE.MeshStandardMaterial[] {
    const seen = new Set<THREE.MeshStandardMaterial>();
    for (const asset of this.variants(role)) {
      for (const part of asset.parts) {
        if (!pattern.test(part.name)) continue;
        const material = part.material;
        if (material.emissive && material.emissive.getHex() !== 0) seen.add(material);
      }
    }
    return [...seen];
  }
}

async function normalize(
  gltf: Awaited<ReturnType<GLTFLoader['loadAsync']>>,
  entry: ManifestEntry,
  anisotropy: number,
): Promise<KitAsset> {
  const root = gltf.scene;
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  // pivot: base a terra, centro in x/z — il pack ha il pivot al centro del bbox
  root.position.x -= center.x;
  root.position.z -= center.z;
  root.position.y -= box.min.y;
  root.updateMatrixWorld(true);

  const parts: KitPart[] = [];
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!(mesh as unknown as { isMesh?: boolean }).isMesh) return;
    const source = mesh.material as THREE.Material | THREE.Material[];
    const material = (Array.isArray(source) ? source[0] : source) as THREE.MeshStandardMaterial;
    if (!material) return;
    for (const slot of ['map', 'normalMap', 'roughnessMap', 'aoMap', 'emissiveMap'] as const) {
      const texture = material[slot] as THREE.Texture | null;
      if (texture) texture.anisotropy = anisotropy;
    }
    // la geometria viene cotta in spazio locale normalizzato: il template non
    // viene spostato a runtime, ogni istanza ha solo la sua matrice
    const geometry = mesh.geometry.clone();
    geometry.applyMatrix4(mesh.matrixWorld);
    geometry.computeBoundingSphere();
    mesh.castShadow = shouldCast(mesh.name, material);
    mesh.receiveShadow = true;
    const part: KitPart = {
      name: mesh.name || 'part',
      geometry,
      material,
      castShadow: mesh.castShadow,
    };
    if (PAINT_PART.test(part.name)) {
      // la vernice del kit è marrone e la texture è quasi bianca: per tingerla
      // per istanza il materiale deve partire da bianco
      const tintable = material.clone();
      tintable.color.setHex(0xffffff);
      tintable.needsUpdate = true;
      part.tintable = tintable;
    }
    parts.push(part);
  });

  return { role: entry.role, slug: entry.slug, name: entry.name, size, template: root, parts };
}

/**
 * Carica il kit se c'è. Non lancia mai per un file mancante: il gioco deve
 * partire anche senza (offline, macchina nuova, licenza non scaricata).
 */
export async function loadCityKit(
  base = `${import.meta.env.BASE_URL}citykit/`,
  dracoPath = `${import.meta.env.BASE_URL}draco/`,
  anisotropy = 4,
): Promise<CityKit | null> {
  let manifest: Manifest;
  try {
    const response = await fetch(`${base}manifest.json`, { cache: 'no-store' });
    if (!response.ok) return null;
    manifest = (await response.json()) as Manifest;
  } catch {
    return null;
  }
  const entries = (manifest.assets ?? []).filter((entry) => entry.role && entry.slug);
  if (entries.length === 0) return null;

  const draco = new DRACOLoader().setDecoderPath(dracoPath);
  const loader = new GLTFLoader().setDRACOLoader(draco);
  const loaded = await Promise.all(
    entries.map(async (entry) => {
      try {
        const gltf = await loader.loadAsync(`${base}${entry.slug}.glb`);
        return await normalize(gltf, entry, anisotropy);
      } catch (error) {
        console.warn(`city kit: ${entry.slug} non caricato`, error);
        return null;
      }
    }),
  );
  draco.dispose();

  const assets = loaded.filter((asset): asset is KitAsset => asset !== null);
  if (assets.length === 0) return null;
  return new CityKit(assets);
}

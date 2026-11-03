import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js';
import { GAME } from '../config';
import { BUILD_GIRTH, outfitColors, type Appearance } from './appearance';
import {
  blendLocomotion,
  locomotionWeights,
  seatPose,
  strideTimeScale,
  syncStridePhase,
} from './locomotion';

export { syncStridePhase } from './locomotion';

/** Personaggi umani veri.
 *
 * Il corpo visibile è un avatar GLB con skin e scheletro RPM
 * (`uomo.glb` / `donna.glb`). Le clip di idle, camminata e corsa sono GLB RPM
 * separate: il percorso di caricamento non usa file esterni.
 *
 * Un `HumanBody` è un'istanza indipendente (scheletro clonato): geometrie e
 * texture restano una copia sola in memoria anche con venti pedoni in scena.
 */

/** Anim set per i clip di animazione. */
export interface AnimSet {
  idle: THREE.AnimationClip;
  walk: THREE.AnimationClip;
  walkVariants: readonly THREE.AnimationClip[];
  run: THREE.AnimationClip;
  jog: THREE.AnimationClip;
  jump: THREE.AnimationClip;
  stairs: THREE.AnimationClip;
  strafeLeft: THREE.AnimationClip;
  strafeRight: THREE.AnimationClip;
  turnLeft: THREE.AnimationClip;
  turnRight: THREE.AnimationClip;
  walkTurn: THREE.AnimationClip;
  turn180: THREE.AnimationClip;
  startWalking: THREE.AnimationClip;
  stopWalking: THREE.AnimationClip;
  enterCar: THREE.AnimationClip;
  exitCar: THREE.AnimationClip;
  driving: THREE.AnimationClip;
}

/** Tipo di azione umana. */
export type HumanAction =
  | 'jump'
  | 'turnLeft'
  | 'turnRight'
  | 'walkTurn'
  | 'turn180'
  | 'startWalking'
  | 'stopWalking'
  | 'enterCar'
  | 'exitCar';

/** Descrizione del movimento umano. */
export interface HumanMotion {
  forward?: number;
  strafe?: number;
  uphill?: boolean;
  driving?: boolean;
}

/** Set di file umano. */
interface HumanFileSet {
  idle: string;
  walk: string;
  run: string;
}

/** Asset per i capelli. */
interface HairAssets {
  male: readonly THREE.Object3D[];
  female: readonly THREE.Object3D[];
}

/** Dimensioni del corpo. */
export interface BodySize {
  /** Altezza reale della mesh skinning, in unità mondo */
  height: number;
  /** Quota del punto più basso, per appoggiare i piedi a terra */
  minY: number;
}

/** Asset umani completi. */
export interface HumanAssets {
  readonly male: THREE.Object3D;
  readonly female: THREE.Object3D;
  readonly size: { male: BodySize; female: BodySize };
  readonly clips: { male: AnimSet; female: AnimSet };
  readonly hair: HairAssets;
  /** Corpo femminile Sketchfab (statico) usato come pelle del rig RPM. */
  readonly importedFemale?: THREE.Object3D;
  /** Corpo maschile Sketchfab (statico) usato come pelle del rig RPM. */
  readonly importedMale?: THREE.Object3D;
  /** File opzionali mancanti (capelli, riga sorgente): non bloccano il gioco. */
  readonly diagnostics: { warnings: readonly string[] };
}

/** File umani di riferimento.
 *
 * I due corpi visibili sono GLB con skin e scheletro RPM. Le clip sono gli
 * stessi GLB di animazione RPM, senza file esterni.
 */
export interface HumanFiles extends HumanFileSet {
  maleBody: string;
  femaleBody: string;
}

export const HUMAN_FILES: HumanFiles = {
  maleBody: 'uomo-real.glb',
  femaleBody: 'donna-real.glb',
  idle: 'donna-idle.glb',
  walk: 'donna-walk.glb',
  run: 'donna-run.glb',
};

/** Regex per normalizzare i nomi delle ossa (rimuovere prefissi e caratteri non alfanumerici). */
function boneKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/^mixamorig[:_-]?/, '')
    .replace(/[^a-z0-9]/g, '');
}

/** Indica le ossa di un albero scheletrico per nome confrontabile. */
function indexBones(root: THREE.Object3D): Map<string, THREE.Object3D> {
  const bones = new Map<string, THREE.Object3D>();
  root.traverse((obj) => {
    if (!obj.name || !(obj as THREE.Bone).isBone) return;
    const key = boneKey(obj.name);
    if (!bones.has(key)) bones.set(key, obj);
  });
  return bones;
}

/**
 * I GLB RPM sono esportati come materiale unlit e hanno una normal map
 * embedded che il materiale non referenzia. La texture è già allineata alle
 * UV del corpo: la agganciamo a un MeshStandardMaterial, così pelle, viso e
 * tessuti reagiscono alla luce invece di restare piatti. Se il file non ha
 * una normal map, il corpo resta com'era.
 */
async function upgradeBodyMaterials(
  gltf: Awaited<ReturnType<GLTFLoader['loadAsync']>>,
  root: THREE.Object3D,
): Promise<void> {
  const parser = gltf.parser as unknown as {
    json: { textures?: Array<{ name?: string }> };
    getDependency(type: 'texture', index: number): Promise<THREE.Texture>;
  };
  const normalIndex = parser.json.textures?.findIndex((texture) => /normal/i.test(texture.name ?? '')) ?? -1;
  let normalMap: THREE.Texture | null = null;
  if (normalIndex >= 0) {
    try {
      normalMap = await parser.getDependency('texture', normalIndex);
      normalMap.colorSpace = THREE.NoColorSpace;
      normalMap.flipY = false;
    } catch {
      normalMap = null;
    }
  }
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const upgraded = materials.map((material) => {
      let next = material as THREE.MeshStandardMaterial;
      if (material instanceof THREE.MeshBasicMaterial && material.map) {
        next = new THREE.MeshStandardMaterial({
          name: material.name,
          map: material.map,
          color: material.color.clone(),
          roughness: 0.7,
          metalness: 0,
          side: material.side,
          transparent: material.transparent,
          opacity: material.opacity,
          alphaTest: material.alphaTest,
          depthWrite: material.depthWrite,
          depthTest: material.depthTest,
        });
      }
      if (normalMap && next.isMeshStandardMaterial) {
        next.normalMap = normalMap;
        next.normalScale.set(1, 1);
        next.needsUpdate = true;
      }
      return next;
    });
    mesh.material = Array.isArray(mesh.material) ? upgraded : upgraded[0]!;
  });
}

/**
 * Le sfere oculari del GLB MakeHuman hanno una texture che, con le UV cotte,
 * si legge come un guscio biancastro con l'iride fuori posto; rimpicciolirle
 * attorno al centro della coppia le avvicinava e lasciava intravedere il rosso
 * della palpebra. Qui la sclera resta piena (copre l'orbita) e la pupilla è una
 * sfera scura agganciata all'osso testa, così non si stacca dal viso.
 */
function fitBakedEyes(root: THREE.Object3D): void {
  const eyes: THREE.Mesh[] = [];
  const heads: THREE.Bone[] = [];
  root.traverse((object) => {
    if (!eyes.length && (object as THREE.Mesh).isMesh && /high-poly/i.test(object.name)) {
      eyes.push(object as THREE.Mesh);
    }
    if (!heads.length && (object as THREE.Bone).isBone && boneKey(object.name) === 'head') {
      heads.push(object as THREE.Bone);
    }
  });
  const eyeMesh = eyes[0];
  if (!eyeMesh) return;

  const materials = Array.isArray(eyeMesh.material) ? eyeMesh.material : [eyeMesh.material];
  for (const material of materials) {
    const standard = material as THREE.MeshStandardMaterial;
    standard.map = null;
    standard.color.setHex(0xf4efe6);
    standard.roughness = 0.34;
    standard.metalness = 0;
    standard.needsUpdate = true;
  }

  const geometry = eyeMesh.geometry;
  const position = geometry.getAttribute('position');
  if (!position) return;
  // Le sfere cotte stanno ~1,3 cm sopra l'apertura della palpebra: senza lo
  // spostamento coprono la fronte e lasciano scoperto il rosso dell'orbita.
  for (let i = 0; i < position.count; i++) position.setY(i, position.getY(i) - 0.013);
  position.needsUpdate = true;
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  // Due orbite separate: il centro va preso per occhio, non sulla coppia.
  const sides = [new THREE.Box3(), new THREE.Box3()];
  const point = new THREE.Vector3();
  for (let i = 0; i < position.count; i++) {
    point.fromBufferAttribute(position, i);
    sides[point.x < 0 ? 0 : 1]!.expandByPoint(point);
  }

  const head = heads[0];
  if (!head) return;
  root.updateMatrixWorld(true);
  const pupilGeometry = new THREE.SphereGeometry(0.004, 10, 8);
  const pupilMaterial = new THREE.MeshStandardMaterial({ color: 0x241a13, roughness: 0.35 });
  const headScale = new THREE.Vector3();
  head.getWorldScale(headScale);
  const inverseScale = new THREE.Vector3(
    1 / Math.max(1e-4, headScale.x),
    1 / Math.max(1e-4, headScale.y),
    1 / Math.max(1e-4, headScale.z),
  );
  for (const side of sides) {
    if (side.isEmpty()) continue;
    const center = side.getCenter(new THREE.Vector3());
    const at = new THREE.Vector3(center.x, center.y, side.max.z - 0.001);
    eyeMesh.localToWorld(at);
    head.worldToLocal(at);
    const pupil = new THREE.Mesh(pupilGeometry, pupilMaterial);
    pupil.name = 'eye-pupil';
    pupil.position.copy(at);
    pupil.scale.copy(inverseScale);
    pupil.castShadow = false;
    pupil.receiveShadow = false;
    head.add(pupil);
  }
}

/** I denti del GLB escono dalle labbra: li si stringe e li si arretra nell'arcata. */
function fitBakedTeeth(root: THREE.Object3D): void {
  const found: THREE.Mesh[] = [];
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    if (materials.some((material) => /teeth/i.test(material?.name ?? ''))) found.push(mesh);
  });
  const teeth = found[0];
  if (!teeth) return;
  const geometry = teeth.geometry;
  geometry.computeBoundingBox();
  const box = geometry.boundingBox;
  if (!box) return;
  const center = box.getCenter(new THREE.Vector3());
  const position = geometry.getAttribute('position');
  if (!position) return;
  for (let i = 0; i < position.count; i++) {
    position.setXYZ(
      i,
      center.x + (position.getX(i) - center.x) * 0.86,
      center.y + (position.getY(i) - center.y) * 0.86,
      center.z + (position.getZ(i) - center.z) * 0.86 - 0.006,
    );
  }
  position.needsUpdate = true;
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
}

/** Corpo visibile con skin: se manca la pelle o le ossa chiave è un asset rotto. */
async function loadBody(base: string, file: string, sex: keyof HairAssets): Promise<THREE.Object3D> {
  let gltf: Awaited<ReturnType<GLTFLoader['loadAsync']>>;
  try {
    gltf = await new GLTFLoader().loadAsync(base + file);
  } catch (err) {
    throw new Error(`corpo ${sex} (${file}) non caricato: ${err instanceof Error ? err.message : String(err)}`);
  }
  const root = gltf.scene ?? gltf.scenes[0];
  if (!root) throw new Error(`corpo ${sex} (${file}) senza scena`);
  root.updateMatrixWorld(true);
  let skinned = 0;
  root.traverse((object) => { if ((object as THREE.SkinnedMesh).isSkinnedMesh) skinned++; });
  if (skinned === 0) throw new Error(`corpo ${sex} (${file}) senza mesh con skin: non è animabile`);
  const bones = indexBones(root);
  if (!bones.has('hips') || !bones.has('head')) {
    throw new Error(`corpo ${sex} (${file}) senza scheletro RPM (Hips/Head)`);
  }
  // I GLB MakeHuman hanno già capelli, occhi e vestiti cotti nella gerarchia.
  // Evita di sovrapporre i vecchi ciuffi RPM separati e di applicare la normal
  // map RPM (unica e globale) a pelle, capelli e tessuti MakeHuman.
  const bakedHair = /-real\.glb$/i.test(file);
  root.userData.bakedHair = bakedHair;
  if (!bakedHair) await upgradeBodyMaterials(gltf, root);
  else {
    fitBakedEyes(root);
    fitBakedTeeth(root);
  }
  return root;
}  /** Crea un gruppo capelli dai source mesh, colorandoli in base all'hairColor. */
function makeHair(
  source: THREE.Object3D,
  hairColor: number,
  materialsOwned: THREE.Material[],
  head: THREE.Object3D,
  bodyFront: 1 | -1,
): THREE.Group {
  const model = cloneSkeleton(source) as THREE.Object3D;
  model.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(model);
  const size = bounds.getSize(new THREE.Vector3());
  if (bounds.isEmpty() || size.x < 1e-4 || size.y < 1e-4 || size.z < 1e-4) {
    throw new Error(`variante capelli non valida: ${source.name}`);
  }
  const center = bounds.getCenter(new THREE.Vector3());
  const fit = new THREE.Group();
  fit.name = `hair-${source.name}`;
  // Il pack capelli è centrato sull'origine dell'osso Head, che sta alla base
  // del cranio: senza alzarlo di ~9 cm il caschetto copre occhi e volto.
  fit.scale.set(0.22 / size.x, 0.26 / size.y, 0.22 / size.z);
  fit.position.y = 0.105;
  // L'osso Head ha l'origine alla base del cranio, non al centro del viso:
  // sposta il ciuffo anche indietro, altrimenti la frangia copre gli occhi.
  head.updateWorldMatrix(true, false);
  const headWorldInverse = new THREE.Quaternion();
  head.getWorldQuaternion(headWorldInverse).invert();
  const back = new THREE.Vector3(0, 0, bodyFront)
    .applyQuaternion(headWorldInverse)
    .multiplyScalar(-0.10);
  fit.position.add(back);
  const centered = new THREE.Group();
  centered.position.set(-center.x, -bounds.min.y, -center.z);
  centered.add(model);
  fit.add(centered);

  model.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.frustumCulled = false;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const cloned = materials.map((material) => {
      const copy = material.clone();
      if (copy instanceof THREE.MeshStandardMaterial || copy instanceof THREE.MeshPhongMaterial) {
        copy.color.multiply(new THREE.Color(hairColor));
      }
      materialsOwned.push(copy);
      return copy;
    });
    mesh.material = Array.isArray(mesh.material) ? cloned : cloned[0]!;
  });
  return fit;
}

/** Misura l'altezza del corpo dalla geometria nella posa di riposo.
 *
 * Le ossa non bastano: il rig MakeHuman non ha le punte HeadTop_End/Toe_End,
 * quindi la loro estensione sarebbe molto minore dell'altezza reale. I limiti
 * delle mesh includono testa, capelli e piedi e danno la scala corretta.
 */
function measureBody(root: THREE.Object3D): BodySize {
  root.updateWorldMatrix(true, true);
  const bounds = new THREE.Box3().setFromObject(root);
  const size = bounds.getSize(new THREE.Vector3());
  if (bounds.isEmpty() || !Number.isFinite(size.y) || size.y < 0.2) {
    return { height: 1.8, minY: 0 };
  }
  return { height: size.y, minY: bounds.min.y };
}

/** Retargeta una clip da uno scheletro sorgente a uno destinatario, mappando
 * i nomi delle ossa (normalizzati) e saltando le tracce non presenti.
 */
export function bindClip(
  clip: THREE.AnimationClip,
  root: THREE.Object3D,
  sourceRoot?: THREE.Object3D,
): THREE.AnimationClip | null {
  const bones = indexBones(root);
  const sourceBones = sourceRoot ? indexBones(sourceRoot) : null;
  const tracks: THREE.KeyframeTrack[] = [];
  for (const track of clip.tracks) {
    const match = /^(.+?)\.(position|quaternion|scale)$/.exec(track.name);
    if (!match) continue;
    const key = boneKey(match[1] ?? '');
    const bone = bones.get(key);
    if (!bone) continue;
    const path = match[2];
    if (path === 'quaternion') {
      const sourceBone = sourceBones?.get(key);
      if (!sourceBone) {
        tracks.push(new THREE.QuaternionKeyframeTrack(`${bone.name}.quaternion`, track.times, track.values));
        continue;
      }
      const sourceRestInverse = sourceBone.quaternion.clone().invert();
      const values = new Float32Array(track.values.length);
      const animated = new THREE.Quaternion();
      const delta = new THREE.Quaternion();
      const retargeted = new THREE.Quaternion();
      for (let i = 0; i < track.values.length; i += 4) {
        animated.fromArray(track.values, i);
        delta.copy(sourceRestInverse).multiply(animated);
        retargeted.copy(bone.quaternion).multiply(delta).normalize();
        retargeted.toArray(values, i);
      }
      tracks.push(new THREE.QuaternionKeyframeTrack(`${bone.name}.quaternion`, track.times, values));
    } else if (path === 'position') {
      // Salta la traslazione del bacino che contiene il root motion delle clip
      // (nelle clip femminili è in un'unità diversa): lasciandola, il personaggio
      // scivola in avanti da solo invece di restare dove lo mette il gioco.
      // Il passo verticale lo dà comunque il gioco con il proprio bob.
      if (boneKey(bone.name) === 'hips') continue;
      tracks.push(new THREE.VectorKeyframeTrack(`${bone.name}.position`, track.times, track.values));
    } else {
      tracks.push(new THREE.VectorKeyframeTrack(`${bone.name}.scale`, track.times, track.values));
    }
  }
  if (tracks.length === 0) return null;
  return new THREE.AnimationClip(clip.name, clip.duration, tracks);
}

/** Copia una clip con UUID e tracce propri.
 *
 * `AnimationMixer.clipAction` usa l'UUID della clip come chiave di cache: se
 * più slot dell'AnimSet ricevono lo stesso clip di ripiego (idle o walk),
 * finiscono tutti sulla stessa AnimationAction. I loro `setEffectiveWeight(0)`
 * si sovrascrivono a vicenda e il personaggio resta nella posa di riposo.
 * Una copia per slot evita l'aliasing mantenendo identici i dati animati.
 */
function uniqueClip(clip: THREE.AnimationClip): THREE.AnimationClip {
  return new THREE.AnimationClip(
    clip.name,
    clip.duration,
    clip.tracks.map((track) => track.clone()),
    clip.blendMode,
  );
}

type AnimationKey = 'idle' | 'walk' | 'run';

/** Clip e scheletro di riposo da cui proviene: il secondo serve al retargeting. */
interface AnimationSource {
  readonly clip: THREE.AnimationClip;
  readonly root: THREE.Object3D | null;
}

/** Carica le tre clip GLB RPM insieme al rig sorgente. */
async function loadAnimationSource(base: string, warnings: string[]): Promise<{
  clips: Map<AnimationKey, AnimationSource>;
}> {
  const loader = new GLTFLoader();
  const keys: AnimationKey[] = ['idle', 'walk', 'run'];
  const results = await Promise.allSettled(
    keys.map(async (key) => {
      const gltf = await loader.loadAsync(base + HUMAN_FILES[key]);
      const clip = gltf.animations.find((candidate) => candidate.tracks.length > 0);
      if (!clip) throw new Error(`animazione ${key} vuota in ${HUMAN_FILES[key]}`);
      return [key, { clip, root: gltf.scene ?? gltf.scenes[0] ?? null }] as const;
    }),
  );
  const clips = new Map<AnimationKey, AnimationSource>();
  results.forEach((result, index) => {
    const key = keys[index]!;
    if (result.status === 'fulfilled') clips.set(key, result.value[1]);
    else warnings.push(`clip ${key}: ${String(result.reason)}`);
  });
  if (!clips.has('idle')) throw new Error('clip di riposo GLB non caricata: impossibile animare i personaggi');
  return { clips };
}

/** Associa le clip GLB a un corpo; le azioni non disponibili ricadono su idle/walk. */
function bindAnimSet(clips: Map<AnimationKey, AnimationSource>, body: THREE.Object3D): AnimSet {
  const idle = clips.get('idle');
  if (!idle) throw new Error('clip di riposo vuota');
  const idleBound = bindClip(idle.clip, body, idle.root ?? undefined);
  if (!idleBound) throw new Error('la clip di riposo non ha tracce compatibili con lo scheletro del corpo');
  const clip = (key: AnimationKey): THREE.AnimationClip => {
    const source = clips.get(key);
    return source ? bindClip(source.clip, body, source.root ?? undefined) ?? idleBound : idleBound;
  };
  const walk = clip('walk');
  const run = clip('run');
  const idleSlot = (): THREE.AnimationClip => uniqueClip(idleBound);
  const walkSlot = (): THREE.AnimationClip => uniqueClip(walk);
  const runSlot = (): THREE.AnimationClip => uniqueClip(run);
  return {
    idle: idleSlot(),
    walk: walkSlot(),
    walkVariants: [walkSlot()],
    run: runSlot(),
    jog: runSlot(),
    jump: idleSlot(),
    stairs: walkSlot(),
    strafeLeft: walkSlot(),
    strafeRight: walkSlot(),
    turnLeft: idleSlot(),
    turnRight: idleSlot(),
    walkTurn: walkSlot(),
    turn180: idleSlot(),
    startWalking: walkSlot(),
    stopWalking: idleSlot(),
    enterCar: idleSlot(),
    exitCar: idleSlot(),
    driving: idleSlot(),
  };
}

/** Carica le varianti capelli per un sesso dato. */
async function loadHairVariants(base: string, file: string, sex: keyof HairAssets): Promise<THREE.Object3D[]> {
  let gltf: Awaited<ReturnType<GLTFLoader['loadAsync']>>;
  try {
    gltf = await new GLTFLoader().loadAsync(base + file);
  } catch (err) {
    throw new Error(`capelli ${base + file} non caricati: ${err instanceof Error ? err.message : String(err)}`);
  }
  gltf.scene.updateMatrixWorld(true);

  const variants =
    sex === 'male'
      ? (gltf.scene.getObjectByName('basemesh22')?.children.filter((child) => (child as THREE.Mesh).isMesh) ?? [])
      : (gltf.scene.getObjectByName('GLTF_SceneRootNode')?.children.filter((child) =>
          /^Hair\d+_ARM_/.test(child.name),
        ) ?? []);
  if (variants.length === 0) throw new Error(`nessuna variante capelli ${sex} trovata in ${file}`);

  return variants.map((source) => {
    const variant = new THREE.Group();
    variant.name = source.name;
    if (source.parent) {
      variant.matrix.copy(source.parent.matrixWorld);
      variant.matrixAutoUpdate = false;
    }
    variant.add(cloneSkeleton(source) as THREE.Object3D);
    return variant;
  });
}

/**
 * Carica tutti gli asset umani con degradazione per asset.
 *
 * - corpi: obbligatori, uno per sesso; se uno manca si lancia un errore chiaro
 *   (il gioco lo mostra e riprova) invece di sostituire un manichino;
 * - clip: un GLB mancante ricade sulla clip di riposo;
 * - capelli: opzionali, se il pack non si carica si resta senza capelli.
 */
export async function loadHumanAssets(base = `${import.meta.env.BASE_URL}models/`): Promise<HumanAssets> {
  const warnings: string[] = [];
  const characterBase = base.replace(/models\/$/, 'characters/');
  const debugBody = importedBodyDebugEnabled();
  const [
    animationResult,
    maleResult,
    femaleResult,
    importedFemaleResult,
    importedMaleResult,
    maleHairResult,
    femaleHairResult,
  ] = await Promise.allSettled([
    loadAnimationSource(base, warnings),
    loadBody(base, HUMAN_FILES.maleBody, 'male'),
    loadBody(base, HUMAN_FILES.femaleBody, 'female'),
    debugBody ? loadImportedBody(characterBase, 'female_body_base_mesh.glb', 'femminile') : Promise.resolve(null),
    debugBody ? loadImportedBody(characterBase, 'male_body.glb', 'maschile') : Promise.resolve(null),
    loadHairVariants(characterBase, 'free_male_fashion_hair_collection_01_lowpoly.glb', 'male'),
    loadHairVariants(characterBase, 'hair_pack_part_2.glb', 'female'),
  ]);
  const failures: string[] = [];
  let animation: Awaited<ReturnType<typeof loadAnimationSource>> | null = null;
  if (animationResult.status === 'fulfilled') animation = animationResult.value;
  else failures.push(`animazioni: ${String(animationResult.reason)}`);
  let male: THREE.Object3D | null = null;
  if (maleResult.status === 'fulfilled') male = maleResult.value;
  else failures.push(`corpo maschile: ${String(maleResult.reason)}`);
  let female: THREE.Object3D | null = null;
  if (femaleResult.status === 'fulfilled') female = femaleResult.value;
  else failures.push(`corpo femminile: ${String(femaleResult.reason)}`);
  let importedFemale: THREE.Object3D | null = null;
  if (importedFemaleResult.status === 'fulfilled') importedFemale = importedFemaleResult.value;
  else warnings.push(`corpo importato femminile: ${String(importedFemaleResult.reason)}`);
  let importedMale: THREE.Object3D | null = null;
  if (importedMaleResult.status === 'fulfilled') importedMale = importedMaleResult.value;
  else warnings.push(`corpo importato maschile: ${String(importedMaleResult.reason)}`);
  if (debugBody) {
    console.info(
      `[personaggi] corpi importati (debug): femminile ${importedFemale ? 'caricato' : 'non disponibile'}, maschile ${importedMale ? 'caricato' : 'non disponibile'}`,
    );
  }
  const hairOf = (result: PromiseSettledResult<THREE.Object3D[]>): THREE.Object3D[] => {
    if (result.status === 'fulfilled') return result.value;
    warnings.push(`capelli: ${String(result.reason)}`);
    return [];
  };
  const maleHair = hairOf(maleHairResult);
  const femaleHair = hairOf(femaleHairResult);
  if (failures.length > 0) throw new Error(`Personaggi non caricati: ${failures.join(' · ')}`);
  if (!male || !female || !animation) throw new Error('Personaggi non caricati: asset incompleti');
  const maleSize = measureBody(male);
  const femaleSize = measureBody(female);
  for (const warning of warnings) console.warn(`personaggi: ${warning}`);
  return {
    male,
    female,
    size: { male: maleSize, female: femaleSize },
    clips: {
      male: bindAnimSet(animation.clips, male),
      female: bindAnimSet(animation.clips, female),
    },
    hair: { male: maleHair, female: femaleHair },
    ...(importedFemale ? { importedFemale } : {}),
    ...(importedMale ? { importedMale } : {}),
    diagnostics: { warnings },
  };
}

/**
 * Il corpo scultura importato è un esperimento visivo, non il personaggio di
 * produzione: non ha volto né vestiti e per animarlo usa pesi trasferiti dal
 * corpo RPM. Resta disponibile solo con `?debugbody=1`, così il percorso normale
 * carica il personaggio completo (RPM) e non paga nemmeno i GLB della scultura.
 */
function importedBodyDebugEnabled(): boolean {
  return typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('debugbody');
}

/** Opzioni per la creazione del corpo umano. */
export interface HumanBodyOptions {
  /** Ombre proiettate: i pedoni lontani possono risparmiarle */
  shadow?: boolean;
  /** Variazione casuale della fase di animazione, per non vederli marciare in sincrono */
  phase?: number;
  /** Variazione di colore per dare varianti di carnagione e capo */
  tint?: THREE.Color;
  /** Tinta del capo cotto (camicia/pantaloni) per variare i pedoni */
  outfitTint?: number;
  /** Indice deterministico della variante capelli (pedoni) */
  hairVariant?: number;
  /**
   * Sostituisce la pelle RPM con la scultura importata dello stesso sesso.
   * È un percorso di debug (`?debugbody=1`), non il corpo di produzione:
   * la scultura non ha volto, vestiti o texture.
   */
  importedBody?: boolean;
}

/**
 * Carica un corpo umano importato (Sketchfab). È una scultura statica: qui
 * serve solo la geometria, che viene allineata allo scheletro RPM e pesata sui
 * suoi vertici. Se manca, quel sesso resta sul corpo RPM.
 */
async function loadImportedBody(base: string, file: string, label: string): Promise<THREE.Object3D> {
  const gltf = await new GLTFLoader().loadAsync(base + file);
  const scene = gltf.scene ?? gltf.scenes[0];
  if (!scene) throw new Error(`corpo importato ${label} senza scena`);
  let meshes = 0;
  scene.traverse((object) => { if ((object as THREE.Mesh).isMesh) meshes++; });
  if (meshes === 0) throw new Error(`corpo importato ${label} senza mesh`);
  return scene;
}

function firstMesh(root: THREE.Object3D): THREE.Mesh | null {
  let found: THREE.Mesh | null = null;
  root.traverse((object) => {
    if (!found && (object as THREE.Mesh).isMesh) found = object as THREE.Mesh;
  });
  return found;
}

function firstBodyMesh(root: THREE.Object3D): THREE.SkinnedMesh | null {
  let found: THREE.SkinnedMesh | null = null;
  root.traverse((object) => {
    const mesh = object as THREE.SkinnedMesh;
    if (!mesh.isSkinnedMesh) return;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    if (materials.some((material) => /\.body$/i.test(material?.name ?? ''))) found = mesh;
  });
  return found;
}

function firstSkinnedMesh(root: THREE.Object3D): THREE.SkinnedMesh | null {
  // I capelli sono aggiunti prima e sono anch'essi SkinnedMesh: non devono
  // essere scambiati per il corpo. Preferisci Wolf3D_Avatar, poi la mesh con
  // più vertici (il corpo RPM ne ha molti più di un ciuffo).
  let named: THREE.SkinnedMesh | null = null;
  let namedVertices = -1;
  let largest: THREE.SkinnedMesh | null = null;
  let largestVertices = -1;
  root.traverse((object) => {
    const mesh = object as THREE.SkinnedMesh;
    if (!mesh.isSkinnedMesh) return;
    const count = mesh.geometry.getAttribute('position')?.count ?? 0;
    if (/wolf3d|avatar/i.test(mesh.name) && count > namedVertices) {
      named = mesh;
      namedVertices = count;
    }
    if (count > largestVertices) {
      largest = mesh;
      largestVertices = count;
    }
  });
  return named ?? largest;
}

/**
 * Copia i pesi di skinning dal corpo RPM al corpo importato.
 *
 * I due corpi hanno proporzioni diverse ma stessa posa di riposo: si cercano
 * i vertici RPM più vicini con una griglia spaziale, evitando un confronto
 * O(15.000 × 7.000). Il risultato è una mesh che usa lo scheletro RPM e quindi
 * tutte le clip già caricate.
 */
function transferSkinWeights(target: THREE.BufferGeometry, source: THREE.BufferGeometry): boolean {
  const targetPosition = target.getAttribute('position');
  const sourcePosition = source.getAttribute('position');
  const sourceIndex = source.getAttribute('skinIndex');
  const sourceWeight = source.getAttribute('skinWeight');
  if (!targetPosition || !sourcePosition || !sourceIndex || !sourceWeight) return false;
  if (sourceIndex.itemSize < 4 || sourceWeight.itemSize < 4) return false;

  const cell = 0.06;
  const grid = new Map<string, number[]>();
  const key = (x: number, y: number, z: number): string =>
    `${Math.floor(x / cell)}:${Math.floor(y / cell)}:${Math.floor(z / cell)}`;
  for (let i = 0; i < sourcePosition.count; i++) {
    const k = key(sourcePosition.getX(i), sourcePosition.getY(i), sourcePosition.getZ(i));
    const bucket = grid.get(k);
    if (bucket) bucket.push(i);
    else grid.set(k, [i]);
  }

  const skinIndex = new Uint16Array(targetPosition.count * 4);
  const skinWeight = new Float32Array(targetPosition.count * 4);
  for (let i = 0; i < targetPosition.count; i++) {
    const x = targetPosition.getX(i);
    const y = targetPosition.getY(i);
    const z = targetPosition.getZ(i);
    let nearest = -1;
    let nearestDistance = Infinity;
    const cx = Math.floor(x / cell);
    const cy = Math.floor(y / cell);
    const cz = Math.floor(z / cell);
    for (let ox = -1; ox <= 1 && nearest < 0; ox++) {
      for (let oy = -1; oy <= 1 && nearest < 0; oy++) {
        for (let oz = -1; oz <= 1 && nearest < 0; oz++) {
          const bucket = grid.get(`${cx + ox}:${cy + oy}:${cz + oz}`);
          if (!bucket) continue;
          for (const candidate of bucket) {
            const distance =
              (sourcePosition.getX(candidate) - x) ** 2 +
              (sourcePosition.getY(candidate) - y) ** 2 +
              (sourcePosition.getZ(candidate) - z) ** 2;
            if (distance < nearestDistance) {
              nearest = candidate;
              nearestDistance = distance;
            }
          }
        }
      }
    }
    // Vertici fuori dalla griglia (piedi o punte dei capelli): fallback esatto.
    if (nearest < 0) {
      for (let candidate = 0; candidate < sourcePosition.count; candidate++) {
        const distance =
          (sourcePosition.getX(candidate) - x) ** 2 +
          (sourcePosition.getY(candidate) - y) ** 2 +
          (sourcePosition.getZ(candidate) - z) ** 2;
        if (distance < nearestDistance) {
          nearest = candidate;
          nearestDistance = distance;
        }
      }
    }
    if (nearest < 0) return false;
    for (let k = 0; k < 4; k++) {
      skinIndex[i * 4 + k] = sourceIndex.getComponent(nearest, k);
      skinWeight[i * 4 + k] = sourceWeight.getComponent(nearest, k);
    }
  }
  target.setAttribute('skinIndex', new THREE.BufferAttribute(skinIndex, 4));
  target.setAttribute('skinWeight', new THREE.BufferAttribute(skinWeight, 4));
  return true;
}

/** Allinea la scultura importata alla posa locale della mesh RPM. */
function alignImportedGeometry(
  model: THREE.Object3D,
  sourceMesh: THREE.SkinnedMesh,
  imported: THREE.Object3D,
): THREE.BufferGeometry | null {
  const importedMesh = firstMesh(imported);
  if (!importedMesh) return null;
  model.updateWorldMatrix(true, true);
  imported.updateWorldMatrix(true, true);
  sourceMesh.updateWorldMatrix(true, true);
  const geometry = importedMesh.geometry.clone();
  geometry.applyMatrix4(importedMesh.matrixWorld);
  geometry.applyMatrix4(new THREE.Matrix4().copy(sourceMesh.matrixWorld).invert());
  sourceMesh.geometry.computeBoundingBox();
  geometry.computeBoundingBox();
  const targetBox = geometry.boundingBox;
  const sourceBox = sourceMesh.geometry.boundingBox;
  if (!targetBox || !sourceBox) return null;
  const targetHeight = targetBox.max.y - targetBox.min.y;
  const sourceHeight = sourceBox.max.y - sourceBox.min.y;
  if (!(targetHeight > 0.1) || !(sourceHeight > 0.1)) return null;
  const scale = sourceHeight / targetHeight;
  geometry.translate(
    -(targetBox.min.x + targetBox.max.x) / 2,
    -targetBox.min.y,
    -(targetBox.min.z + targetBox.max.z) / 2,
  );
  geometry.scale(scale, scale, scale);
  geometry.translate(
    (sourceBox.min.x + sourceBox.max.x) / 2,
    sourceBox.min.y,
    (sourceBox.min.z + sourceBox.max.z) / 2,
  );
  geometry.computeBoundingBox();
  // La scultura può essere esportata girata di 180° rispetto alla mesh RPM.
  // Se i piedi indicano un fronte diverso, la giro attorno al proprio centro
  // PRIMA di trasferire i pesi, così mani e piedi finiscono sulle ossa giuste
  // e il viso guarda nella stessa direzione delle clip RPM.
  const sourceFront = frontFromFeet(sourceMesh.geometry);
  const importedFront = frontFromFeet(geometry);
  if (sourceFront !== importedFront) {
    const rotatedBox = geometry.boundingBox;
    if (!rotatedBox) return null;
    const centerX = (rotatedBox.min.x + rotatedBox.max.x) / 2;
    const centerZ = (rotatedBox.min.z + rotatedBox.max.z) / 2;
    geometry.translate(-centerX, 0, -centerZ);
    geometry.rotateY(Math.PI);
    geometry.translate(centerX, 0, centerZ);
  }
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

/** Direzione frontale stimata dai piedi: le punte sporgono più dei talloni. */
function frontFromFeet(geometry: THREE.BufferGeometry): 1 | -1 {
  const position = geometry.getAttribute('position');
  const box = geometry.boundingBox;
  if (!position || !box) return 1;
  const height = box.max.y - box.min.y;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (let i = 0; i < position.count; i++) {
    const y = position.getY(i);
    if (y > box.min.y + height * 0.08) continue;
    const z = position.getZ(i);
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }
  if (!Number.isFinite(minZ) || !Number.isFinite(maxZ)) return 1;
  return maxZ - (minZ + maxZ) / 2 >= (minZ + maxZ) / 2 - minZ ? 1 : -1;
}

/** Osso dominante di ogni vertice, già normalizzato per il confronto. */
function dominantBoneNames(geometry: THREE.BufferGeometry, skeleton: THREE.Skeleton): string[] {
  const index = geometry.getAttribute('skinIndex');
  const weight = geometry.getAttribute('skinWeight');
  const bones = skeleton.bones.map((bone) => boneKey(bone.name));
  const out: string[] = [];
  if (!index || !weight) return out;
  for (let i = 0; i < index.count; i++) {
    let best = -1;
    let bestWeight = -1;
    for (let k = 0; k < 4; k++) {
      const value = weight.getComponent(i, k);
      if (value > bestWeight) {
        bestWeight = value;
        best = index.getComponent(i, k);
      }
    }
    out.push(best >= 0 ? bones[best] ?? '' : '');
  }
  return out;
}

/**
 * Colora la scultura per zone usando le ossa che la muovono, non la sola
 * altezza: così mani e avambracci restano pelle e non diventano maniche di
 * vestito. Il seno e le cosce sono coperti dal vestito; le gambe sotto il
 * ginocchio restano pelle. Il corpo maschile usa maglietta e pantaloni.
 */
function importedBodyMaterial(
  appearance: Appearance,
  geometry: THREE.BufferGeometry,
  female: boolean,
  dominantBones: readonly string[],
): THREE.MeshStandardMaterial {
  const position = geometry.getAttribute('position');
  const box = geometry.boundingBox;
  if (!position || !box) {
    return new THREE.MeshStandardMaterial({ color: appearance.skin, roughness: 0.7 });
  }
  const height = Math.max(1e-4, box.max.y - box.min.y);
  const colors = outfitColors(appearance);
  const skin = new THREE.Color(appearance.skin);
  const dress = new THREE.Color(0x8f4650);
  const top = new THREE.Color(colors.top);
  const pants = new THREE.Color(colors.bottom);
  const shoes = new THREE.Color(female ? 0x1d1a1a : colors.shoes);
  const values = new Float32Array(position.count * 3);
  for (let i = 0; i < position.count; i++) {
    const bone = dominantBones[i] ?? '';
    const y = (position.getY(i) - box.min.y) / height;
    let color: THREE.Color;
    if (/(foot|toe)/.test(bone)) {
      color = shoes;
    } else if (y > 0.90 || /(hand|forearm|upperarm|arm)/.test(bone)) {
      // Testa, mani e braccia restano pelle; il corpetto copre il busto.
      color = skin;
    } else if (female) {
      color = y < 0.35 ? skin : y < 0.89 ? dress : skin;
    } else if (y < 0.07) {
      color = shoes;
    } else if (y < 0.42) {
      color = pants;
    } else if (y < 0.89) {
      color = top;
    } else {
      color = skin;
    }
    values[i * 3] = color.r;
    values[i * 3 + 1] = color.g;
    values[i * 3 + 2] = color.b;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(values, 3));
  return new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.72, metalness: 0 });
}

/** Aggiunge gonna, cintura, occhi, sopracciglia e labbra alla scultura. */
function addImportedDetails(
  model: THREE.Object3D,
  mesh: THREE.SkinnedMesh,
  materials: THREE.Material[],
  geometries: THREE.BufferGeometry[],
  female: boolean,
  appearance: Appearance,
): void {
  const box = mesh.geometry.boundingBox;
  if (!box) return;
  const height = box.max.y - box.min.y;
  const front = frontFromFeet(mesh.geometry) * height * 0.055;
  const sign = Math.sign(front) || 1;
  const hipY = box.min.y + height * 0.53;
  const dressColor = 0x8f4650;
  const dress = new THREE.MeshStandardMaterial({
    color: dressColor,
    roughness: 0.82,
    side: THREE.DoubleSide,
  });
  const leather = new THREE.MeshStandardMaterial({ color: 0x251b18, roughness: 0.55 });
  const white = new THREE.MeshStandardMaterial({ color: 0xe9e3da, roughness: 0.28 });
  const iris = new THREE.MeshStandardMaterial({ color: 0x4b3422, roughness: 0.22 });
  const pupil = new THREE.MeshStandardMaterial({ color: 0x090807, roughness: 0.2 });
  const lips = new THREE.MeshStandardMaterial({
    color: female ? 0x8f4b4a : new THREE.Color(appearance.skin).multiplyScalar(0.72),
    roughness: 0.6,
  });
  const brows = new THREE.MeshStandardMaterial({ color: appearance.hairColor, roughness: 0.7 });
  const faceSkin = new THREE.MeshStandardMaterial({ color: appearance.skin, roughness: 0.66 });
  const hairMaterial = new THREE.MeshStandardMaterial({
    color: appearance.hairColor,
    roughness: 0.8,
    metalness: 0,
  });
  materials.push(dress, leather, white, iris, pupil, lips, brows, faceSkin, hairMaterial);

  let bodice: THREE.Mesh | null = null;
  let skirt: THREE.Mesh | null = null;
  let belt: THREE.Mesh | null = null;
  if (female) {
    // Corpetto sagomato a macchie di raggio (lathe), non un cilindro dritto:
    // segue vita, seno e spalle e copre anche la schiena senza effetto scatola.
    const profile = [
      new THREE.Vector2(height * 0.095, 0),
      new THREE.Vector2(height * 0.105, height * 0.08),
      new THREE.Vector2(height * 0.115, height * 0.18),
      new THREE.Vector2(height * 0.118, height * 0.26),
      new THREE.Vector2(height * 0.10, height * 0.33),
      new THREE.Vector2(height * 0.085, height * 0.36),
    ];
    const bodiceGeometry = new THREE.LatheGeometry(profile, 32);
    bodice = new THREE.Mesh(bodiceGeometry, dress);
    bodice.position.set(0, hipY, 0);
    bodice.scale.z = 0.78;
    bodice.castShadow = true;
    bodice.receiveShadow = true;
    model.add(bodice);
    geometries.push(bodiceGeometry);
    // Gonna a campana: il vecchio cilindro stretto tagliava i fianchi e
    // sembrava un grembiule rigido. Questo profilo parte dal bacino e si apre.
    const skirtGeometry = new THREE.CylinderGeometry(
      height * 0.105, height * 0.18, height * 0.30, 32, 1, true,
    );
    skirt = new THREE.Mesh(skirtGeometry, dress);
    skirt.position.set(0, hipY - height * 0.15, 0);
    skirt.scale.z = 0.78;
    skirt.castShadow = true;
    model.add(skirt);
    geometries.push(skirtGeometry);

    const beltGeometry = new THREE.CylinderGeometry(
      height * 0.083, height * 0.086, height * 0.022, 32, 1, true,
    );
    belt = new THREE.Mesh(beltGeometry, leather);
    belt.position.set(0, hipY + height * 0.005, 0);
    belt.scale.z = 0.78;
    belt.castShadow = true;
    model.add(belt);
    geometries.push(beltGeometry);
  }

  // La scultura importata è una base senza testa: senza un cranio il volto
  // resterebbe un collo mozzato e i dettagli finirebbero dentro la gola.
  // Costruiamo una testa ellissoidale proporzionata al corpo, la attacchiamo
  // all'osso Head e vi appoggiamo sopra occhi, naso e bocca.
  const headRadiusX = height * 0.058;
  const headRadiusY = height * 0.075;
  const headRadiusZ = height * 0.063;
  const headCenterY = box.max.y + height * 0.045;
  const headGeometry = new THREE.SphereGeometry(1, 24, 18);
  headGeometry.scale(headRadiusX, headRadiusY, headRadiusZ);
  const headMesh = new THREE.Mesh(headGeometry, faceSkin);
  headMesh.name = 'imported-head';
  headMesh.position.set(0, headCenterY, 0);
  headMesh.castShadow = true;
  headMesh.receiveShadow = true;
  headMesh.frustumCulled = false;

  const face = new THREE.Group();
  face.name = 'imported-face';
  face.add(headMesh);
  // Calotta sulla fronte: i capelli importati restano dietro la nuca, ma da
  // soli lasciano la testa calva davanti. La calotta dà l'attaccatura e lascia
  // occhi e bocca scoperti; il ciuffo resta sopra le sopracciglia.
  if (appearance.hairStyle !== 'raso') {
    const capGeometry = new THREE.SphereGeometry(1, 24, 12, 0, Math.PI * 2, 0, Math.PI * 0.36);
    capGeometry.scale(headRadiusX * 1.04, headRadiusY * 1.03, headRadiusZ * 1.04);
    const hairCap = new THREE.Mesh(capGeometry, hairMaterial);
    hairCap.name = 'imported-hair-cap';
    hairCap.position.set(0, headCenterY + height * 0.004, 0);
    hairCap.castShadow = true;
    face.add(hairCap);
    const fringeGeometry = new THREE.SphereGeometry(1, 16, 8);
    fringeGeometry.scale(headRadiusX * 0.9, headRadiusY * 0.2, headRadiusZ * 0.25);
    const fringe = new THREE.Mesh(fringeGeometry, hairMaterial);
    fringe.name = 'imported-hair-fringe';
    fringe.position.set(0, headCenterY + height * 0.047, sign * headRadiusZ * 1.01);
    fringe.castShadow = true;
    face.add(fringe);
  }
  const eyeY = headCenterY + height * 0.012;
  const eyeX = height * 0.024;
  const eyeZ = sign * headRadiusZ * 0.98;
  for (const side of [-1, 1] as const) {
    const sclera = new THREE.Mesh(new THREE.SphereGeometry(height * 0.0095, 10, 8), white);
    sclera.position.set(side * eyeX, eyeY, eyeZ);
    face.add(sclera);
    const irisMesh = new THREE.Mesh(new THREE.SphereGeometry(height * 0.0062, 8, 6), iris);
    irisMesh.position.set(side * eyeX, eyeY, eyeZ + sign * height * 0.0035);
    face.add(irisMesh);
    const pupilMesh = new THREE.Mesh(new THREE.SphereGeometry(height * 0.0032, 8, 6), pupil);
    pupilMesh.position.set(side * eyeX, eyeY, eyeZ + sign * height * 0.0065);
    face.add(pupilMesh);
    const brow = new THREE.Mesh(
      new THREE.BoxGeometry(height * 0.020, height * 0.004, height * 0.004),
      brows,
    );
    brow.position.set(side * eyeX, eyeY + height * 0.022, eyeZ + sign * height * 0.002);
    brow.rotation.z = side * 0.12;
    face.add(brow);
  }
  const nose = new THREE.Mesh(new THREE.SphereGeometry(height * 0.011, 8, 6), faceSkin);
  nose.position.set(0, headCenterY - height * 0.006, sign * headRadiusZ * 1.10);
  face.add(nose);
  const lipMesh = new THREE.Mesh(
    new THREE.BoxGeometry(height * 0.038, height * 0.009, height * 0.006), lips,
  );
  lipMesh.position.set(0, headCenterY - height * 0.037, sign * headRadiusZ * 1.02);
  face.add(lipMesh);
  model.add(face);
  face.traverse((object) => {
    const part = object as THREE.Mesh;
    if (!part.isMesh) return;
    part.castShadow = true;
    geometries.push(part.geometry);
  });

  model.updateMatrixWorld(true);
  const bones = indexBones(model);
  const head = bones.get('head');
  const hips = bones.get('hips');
  if (head) head.attach(face);
  if (hips) {
    if (bodice) hips.attach(bodice);
    if (skirt) hips.attach(skirt);
    if (belt) hips.attach(belt);
  }
}

/** Sostituisce la pelle della mesh RPM con la scultura importata. */
function wearImportedBody(
  model: THREE.Object3D,
  imported: THREE.Object3D,
  appearance: Appearance,
  materials: THREE.Material[],
  geometries: THREE.BufferGeometry[],
  female: boolean,
): THREE.SkinnedMesh | null {
  const source = firstSkinnedMesh(model);
  if (!source) return null;
  const label = female ? 'femminile' : 'maschile';
  console.info(`[personaggi] import ${label}: allineo la scultura al rig RPM`);
  const geometry = alignImportedGeometry(model, source, imported);
  if (!geometry) {
    console.warn(`[personaggi] import ${label}: geometria non allineabile`);
    return null;
  }
  if (!transferSkinWeights(geometry, source.geometry)) {
    console.warn(`[personaggi] import ${label}: trasferimento pesi rifiutato`);
    geometry.dispose();
    return null;
  }
  console.info(
    `[personaggi] import ${label}: pesi trasferiti su ${geometry.getAttribute('position').count} vertici`,
  );
  const dominant = dominantBoneNames(geometry, source.skeleton);
  const material = importedBodyMaterial(appearance, geometry, female, dominant);
  const mesh = new THREE.SkinnedMesh(geometry, material);
  mesh.name = female ? 'imported-female-body' : 'imported-male-body';
  mesh.bind(source.skeleton, source.bindMatrix);
  mesh.bindMode = source.bindMode;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  source.parent?.add(mesh);
  source.visible = false;
  // Nasconde tutta la pelle e tutti i vestiti RPM rimasti nel modello, non
  // soltanto il corpo principale: l'outfit originale (maniche comprese) era
  // ancora disegnato sopra la scultura e faceva sembrare vestito anche le
  // braccia. I capelli, che vivono sotto un gruppo `hair-*`, restano visibili.
  const insideHair = (object: THREE.Object3D): boolean => {
    let node: THREE.Object3D | null = object;
    while (node) {
      if (node.name.startsWith('hair-')) return true;
      node = node.parent;
    }
    return false;
  };
  model.traverse((object) => {
    const rendered = object as THREE.Mesh;
    if (!rendered.isMesh || rendered === mesh) return;
    if (insideHair(rendered) || rendered.name.startsWith('imported-')) return;
    rendered.visible = false;
  });
  materials.push(material);
  geometries.push(geometry);
  addImportedDetails(model, mesh, materials, geometries, female, appearance);
  return mesh;
}

/** Classe che rappresenta un corpo umano nell'ambiente di gioco. */
export class HumanBody {
  readonly group = new THREE.Group();
  private readonly mixer: THREE.AnimationMixer;
  private readonly actions: Record<'idle' | 'walk' | 'run', THREE.AnimationAction>;
  private readonly directionalActions: Record<'stairs' | 'strafeLeft' | 'strafeRight', THREE.AnimationAction>;
  private readonly oneShotActions: Record<HumanAction, THREE.AnimationAction>;
  private readonly drivingAction: THREE.AnimationAction;
  private readonly ownMaterials: THREE.Material[] = [];
  /** Geometrie create solo per questa istanza (corpo importato e dettagli). */
  private readonly ownGeometries: THREE.BufferGeometry[] = [];
  private readonly handBones: THREE.Object3D[] = [];
  private readonly model: THREE.Object3D;
  private importedBodyActive = false;
  private airborne = false;
  private driving = false;
  private wasMoving = false;
  private currentAction: HumanAction | null = null;
  private actionTimeLeft = 0;
  /** Ossa della posa seduta, con la rotazione di riposo da ripristinare. */
  private readonly seatRig: Array<{
    bone: THREE.Object3D;
    rest: THREE.Quaternion;
    role: 'hip' | 'knee' | 'arm' | 'elbow' | 'torso';
    /** Asse di flessione locale: cambia fra gambe (X) e braccia (Y/Z) */
    axis: THREE.Vector3;
  }> = [];
  private readonly seatOffset = new THREE.Quaternion();
  private seatProgress = 0;
  private groundPitch = 0;
  private groundRoll = 0;

  constructor(assets: HumanAssets, appearance: Appearance, options: HumanBodyOptions = {}) {
    const female = appearance.sex === 'donna';
    // Usa il corpo RPM del sesso scelto, con texture umane.
    const proto = female ? assets.female : assets.male;
    const model = cloneSkeleton(proto) as THREE.Object3D;
    this.model = model;

    // Normalizza i nomi delle ossa dello scheletro RPM
    const bones = indexBones(model);

    // Aggiungi capelli se disponibili
    const hairVariants = model.userData.bakedHair ? [] : female ? assets.hair.female : assets.hair.male;
    const head = bones.get('head');
    if (head && hairVariants.length > 0) {
      // Variante stabile per istanza: niente capelli che cambiano a ogni
      // ricostruzione o pedoni tutti identici.
      const seed = options.hairVariant ??
        Math.abs(Math.round(appearance.height * 100) + appearance.hairColor + (female ? 7 : 0));
      const index = Math.abs(Math.floor(seed)) % hairVariants.length;
      const body = firstSkinnedMesh(model);
      body?.geometry.computeBoundingBox();
      const bodyFront = body ? frontFromFeet(body.geometry) : 1;
      head.add(makeHair(hairVariants[index]!, appearance.hairColor, this.ownMaterials, head, bodyFront));
    }

    // Scala del corpo: altezza scelta dall'utente, larghezza dalla corporatura
    const girth = BUILD_GIRTH[appearance.build];
    const size = female ? assets.size.female : assets.size.male;
    const scale = appearance.height / size.height;
    model.position.y = -size.minY;

    const inner = new THREE.Group();
    inner.name = 'human-scale';
    inner.scale.set(scale * girth, scale, scale * girth);
    inner.add(model);
    this.group.add(inner);

    // Colori dei materiali basati sul nome (skin, vestiti, ecc.)
    const colors = outfitColors(appearance);
    const garmentColor = options.outfitTint ?? colors.top;
    const bodyMesh = firstBodyMesh(model) ?? firstSkinnedMesh(model);
    bodyMesh?.geometry.computeBoundingBox();
    const bodyBox = bodyMesh?.geometry.boundingBox;
    const bodyMin = bodyBox?.min.y ?? 0;
    const bodyHeight = bodyBox ? bodyBox.max.y - bodyMin : 1.7;
    const collarMin = bodyMin + bodyHeight * 0.49;
    const collarMax = bodyMin + bodyHeight * 0.635;
    model.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = options.shadow !== false;
      mesh.receiveShadow = true;
      // Il bounding volume della posa di riposo senza questo può far sparire
      // il busto ai bordi dello schermo durante la camminata
      mesh.frustumCulled = false;
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      const cloned = materials.map((mat) => {
        const copy = mat.clone() as THREE.MeshStandardMaterial;
        this.ownMaterials.push(copy);
        copy.envMapIntensity = Math.max(copy.envMapIntensity ?? 1, 0.55);
        const name = copy.name.toLowerCase();
        // Colora i materiali basandosi sul nome dell'osso/mesh
        if (/(casualsuit|elegantsuit|sportsuit|worksuit)/.test(name)) {
          copy.color.setHex(garmentColor);
        } else if (/(top|shirt|coat|jacket|torso|upperbody|highlimbs)/.test(name)) {
          copy.color.setHex(colors.top);
        } else if (/(bottom|pants|trouser|leg|skirt|lowerbody)/.test(name)) {
          copy.color.setHex(colors.bottom);
        } else if (/(shoe|boot|sneaker|foot)/.test(name)) {
          copy.color.setHex(colors.shoes);
        } else if (/(skin|face|head|hand|arm|joint|joints|body)/.test(name)) {
          copy.color.setHex(appearance.skin);
        } else if (/(eye|brow|eyebrow|hair|capelli|short0[0-9])/.test(name)) {
          copy.color.setHex(appearance.hairColor);
        }
        if (options.tint) copy.color.multiply(options.tint);
        if (/\.body$/.test(name)) this.tintNeckFabric(copy, collarMin, collarMax, garmentColor);
        return copy;
      });
      mesh.material = Array.isArray(mesh.material) ? cloned : cloned[0]!;
    });

    this.addHandCovers(model, appearance.skin, options.tint);

    const importedAsset = female ? assets.importedFemale : assets.importedMale;
    if (options.importedBody && importedBodyDebugEnabled() && importedAsset) {
      const imported = wearImportedBody(
        model, importedAsset, appearance, this.ownMaterials, this.ownGeometries, female,
      );
      this.importedBodyActive = imported !== null;
      console.info(
        `[personaggi] corpo importato ${female ? 'femminile' : 'maschile'}: ${this.importedBodyActive ? 'attivo' : 'fallito, resta RPM'}`,
      );
    }

    // Carica e prepara le clip di animazione
    const clips = female ? assets.clips.female : assets.clips.male;
    this.mixer = new THREE.AnimationMixer(model);
    const prepare = (clip: THREE.AnimationClip, weight: number): THREE.AnimationAction => {
      const action = this.mixer.clipAction(clip);
      action.setLoop(THREE.LoopRepeat, Infinity);
      action.setEffectiveWeight(weight);
      action.play();
      return action;
    };
    this.actions = {
      idle: prepare(clips.idle, 1),
      walk: prepare(clips.walkVariants[Math.floor(Math.random() * clips.walkVariants.length)] ?? clips.walk, 0),
      run: prepare(Math.random() < 0.3 ? clips.jog : clips.run, 0),
    };
    this.directionalActions = {
      stairs: prepare(clips.stairs, 0),
      strafeLeft: prepare(clips.strafeLeft, 0),
      strafeRight: prepare(clips.strafeRight, 0),
    };
    const eventClips: Record<HumanAction, THREE.AnimationClip> = {
      jump: clips.jump,
      turnLeft: clips.turnLeft,
      turnRight: clips.turnRight,
      walkTurn: clips.walkTurn,
      turn180: clips.turn180,
      startWalking: clips.startWalking,
      stopWalking: clips.stopWalking,
      enterCar: clips.enterCar,
      exitCar: clips.exitCar,
    };
    this.oneShotActions = Object.fromEntries(
      Object.entries(eventClips).map(([name, clip]) => {
        const action = this.mixer.clipAction(clip);
        action.setLoop(THREE.LoopOnce, 1);
        action.clampWhenFinished = true;
        action.setEffectiveWeight(0);
        return [name, action];
      }),
    ) as Record<HumanAction, THREE.AnimationAction>;
    this.drivingAction = this.mixer.clipAction(clips.driving);
    this.drivingAction.setLoop(THREE.LoopRepeat, Infinity);
    this.drivingAction.setEffectiveWeight(0);
    this.drivingAction.play();
    this.mixer.setTime(options.phase ?? 0);
  }

  /**
   * Il collo MakeHuman è scoperto perché la maglietta finisce a 1,325 m e la
   * maschera taglia il busto più in basso. Coloriamo la pelle del collo e delle
   * spalle come tessuto nello shader del corpo: il bordo sparisce e il viso
   * resta pelle. Non aggiungiamo un colletto 3D che finirebbe dentro il busto.
   */
  private tintNeckFabric(
    material: THREE.MeshStandardMaterial,
    minY: number,
    maxY: number,
    color: number,
  ): void {
    const fabric = new THREE.Color(color).multiplyScalar(0.34);
    material.onBeforeCompile = (shader) => {
      shader.uniforms.collarColor = { value: fabric };
      shader.uniforms.collarMin = { value: minY };
      shader.uniforms.collarMax = { value: maxY };
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying float vNeckY;\nvarying float vNeckX;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvNeckY = position.y;\nvNeckX = position.x;');
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          '#include <common>\nvarying float vNeckY;\nvarying float vNeckX;\nuniform vec3 collarColor;\nuniform float collarMin;\nuniform float collarMax;',
        )
        .replace(
          '#include <color_fragment>',
          '#include <color_fragment>\nfloat neckBand = smoothstep(collarMin, collarMin + 0.02, vNeckY) * (1.0 - smoothstep(collarMax - 0.02, collarMax, vNeckY));\nneckBand *= 1.0 - smoothstep(0.25, 0.34, abs(vNeckX));\ndiffuseColor.rgb = mix(diffuseColor.rgb, collarColor, neckBand);',
        );
    };
    material.customProgramCacheKey = () => 'makehuman-neck-fabric';
    material.needsUpdate = true;
  }

  /**
   * Le clip lasciano le dita aperte e la pelle del palmo si legge come un
   * artiglio. Un pugno cutaneo chiuso, figlio dell'osso mano, copre le falangi
   * e resta attaccato al polso: `poseHands` riduce la mano a 0,01, quindi
   * posizione e scala del pugno compensano quella riduzione.
   */
  private addHandCovers(root: THREE.Object3D, skin: number, tint?: THREE.Color): void {
    const hands: THREE.Bone[] = [];
    root.traverse((object) => {
      if ((object as THREE.Bone).isBone && /^(?:left|right)hand$/.test(boneKey(object.name))) {
        hands.push(object as THREE.Bone);
      }
    });
    if (hands.length === 0) return;
    const color = new THREE.Color(skin);
    if (tint) color.multiply(tint);
    const material = new THREE.MeshStandardMaterial({ color, roughness: 0.72 });
    const geometry = new THREE.SphereGeometry(1, 12, 10);
    this.ownMaterials.push(material);
    this.ownGeometries.push(geometry);
    for (const hand of hands) {
      const fist = new THREE.Mesh(geometry, material);
      fist.name = 'hand-cover';
      // 4,6 cm lungo l'asse della mano, 8 x 10,4 x 6,8 cm nel mondo.
      fist.position.set(0, 4.6, 0);
      fist.scale.set(4.0, 5.2, 3.4);
      fist.castShadow = true;
      fist.receiveShadow = true;
      hand.add(fist);
      this.handBones.push(hand);
    }
  }

  private poseHands(): void {
    for (const hand of this.handBones) hand.scale.setScalar(0.01);
  }

  /** Avanza la locomozione con blend continuo idle → camminata → corsa. */
  playAction(name: HumanAction, duration?: number): void {
    if (this.currentAction) {
      const priority: Record<HumanAction, number> = {
        startWalking: 1,
        stopWalking: 1,
        turnLeft: 2,
        turnRight: 2,
        walkTurn: 2,
        turn180: 3,
        jump: 4,
        enterCar: 5,
        exitCar: 5,
      };
      if (priority[name] <= priority[this.currentAction]) return;
      this.stopAction(this.currentAction);
    }

    const action = this.oneShotActions[name];
    const playFor = Number.isFinite(duration) && duration! > 0 ? duration! : action.getClip().duration;
    action.reset();
    action.timeScale = action.getClip().duration / playFor;
    action.setEffectiveWeight(1).play();
    this.currentAction = name;
    this.actionTimeLeft = playFor;
  }

  setDriving(driving: boolean): void {
    this.driving = driving;
  }

  update(dt: number, speed: number, airborne = false, motion: HumanMotion = {}): void {
    if (airborne && !this.airborne) this.playAction('jump', 0.65);
    if (!airborne && this.airborne && this.currentAction === 'jump') this.stopAction('jump');
    this.airborne = airborne;

    const moving = speed > 0.25;
    if (!this.driving && !airborne && !this.currentAction) {
      if (moving && !this.wasMoving) this.playAction('startWalking', 0.55);
      else if (!moving && this.wasMoving) this.playAction('stopWalking', 0.55);
    }
    this.wasMoving = moving;

    if (this.currentAction) {
      this.actionTimeLeft -= Math.max(0, dt);
      if (this.actionTimeLeft <= 0) this.stopAction(this.currentAction);
    }

    const target = locomotionWeights(speed, GAME.walkSpeed, GAME.runSpeed);
    const current = {
      idle: this.actions.idle.getEffectiveWeight(),
      walk: this.actions.walk.getEffectiveWeight(),
      run: this.actions.run.getEffectiveWeight(),
    };
    const weights = blendLocomotion(current, target, dt);
    const strafe = motion.strafe ?? 0;
    const direction =
      motion.uphill && (motion.forward ?? 0) > 0.1
        ? 'stairs'
        : Math.abs(strafe) > 0.35
          ? strafe < 0
            ? 'strafeLeft'
            : 'strafeRight'
          : null;
    const eventActive = this.currentAction !== null;
    const driving = motion.driving ?? this.driving;
    const suppressLocomotion = airborne || eventActive || driving;
    this.actions.idle.setEffectiveWeight(suppressLocomotion ? 0 : weights.idle);
    this.actions.walk.setEffectiveWeight(suppressLocomotion || direction ? 0 : weights.walk);
    this.actions.run.setEffectiveWeight(suppressLocomotion ? 0 : weights.run);
    for (const key of ['stairs', 'strafeLeft', 'strafeRight'] as const) {
      this.directionalActions[key].setEffectiveWeight(
        suppressLocomotion || direction !== key ? 0 : weights.walk,
      );
    }
    this.actions.walk.timeScale = strideTimeScale('walk', speed, GAME.walkSpeed, GAME.runSpeed);
    this.actions.run.timeScale = strideTimeScale('run', speed, GAME.walkSpeed, GAME.runSpeed);
    this.directionalActions.stairs.timeScale = strideTimeScale('walk', speed, GAME.walkSpeed, GAME.runSpeed);
    this.directionalActions.strafeLeft.timeScale = strideTimeScale('walk', speed, GAME.walkSpeed, GAME.runSpeed);
    this.directionalActions.strafeRight.timeScale = strideTimeScale('walk', speed, GAME.walkSpeed, GAME.runSpeed);
    this.drivingAction.setEffectiveWeight(driving && !eventActive ? 1 : 0);

    // Passo sincronizzato: when walk and run overlap, the lighter clip follows
    // the phase of the heavier one (otherwise feet change rhythm mid-stride)
    const walk = this.actions.walk;
    const run = this.actions.run;
    const walkWeight = walk.getEffectiveWeight();
    const runWeight = run.getEffectiveWeight();
    if (walkWeight > 0.01 && runWeight > 0.01) {
      const walkDuration = walk.getClip().duration;
      const runDuration = run.getClip().duration;
      if (walkWeight >= runWeight) {
        const aligned = syncStridePhase(runDuration, walk.time, walkDuration);
        if (aligned !== null) run.time = aligned;
      } else {
        const aligned = syncStridePhase(walkDuration, run.time, runDuration);
        if (aligned !== null) walk.time = aligned;
      }
    }

    // Ripristina la posa di riposo prima del mixer
    for (const entry of this.seatRig) entry.bone.quaternion.copy(entry.rest);
    this.mixer.update(dt);
    this.poseHands();

    if (!driving && !eventActive && this.seatProgress > 0.001 && this.seatRig.length > 0) {
      const pose = seatPose(this.seatProgress);
      for (const entry of this.seatRig) {
        const angle = pose[entry.role];
        if (Math.abs(angle) < 1e-5) continue;
        this.seatOffset.setFromAxisAngle(entry.axis, angle);
        entry.bone.quaternion.multiply(this.seatOffset);
      }
    }

    // Inclinazione del corpo sul pendio
    const k = 1 - Math.exp(-8 * Math.max(0, dt));
    this.group.rotation.x += (-this.groundPitch * 0.45 - this.group.rotation.x) * k;
    this.group.rotation.z += (this.groundRoll * 0.45 - this.group.rotation.z) * k;
  }

  /** 0 = in piedi, 1 = seduto: blend additivo usato da ingresso/uscita auto. */
  setSeatProgress(progress: number): void {
    this.seatProgress = Number.isFinite(progress) ? Math.max(0, Math.min(1, progress)) : 0;
  }

  private stopAction(name: HumanAction): void {
    const action = this.oneShotActions[name];
    action.stop();
    action.setEffectiveWeight(0);
    if (this.currentAction === name) {
      this.currentAction = null;
      this.actionTimeLeft = 0;
    }
  }

  /** Pendenza sotto i piedi, in radianti (vedi `terrainTilt`). */
  setGroundTilt(pitch: number, roll: number): void {
    this.groundPitch = Number.isFinite(pitch) ? pitch : 0;
    this.groundRoll = Number.isFinite(roll) ? roll : 0;
  }

  /** Corpo visibile: pelle Sketchfab importata o fallback RPM. */
  get bodyKind(): 'imported' | 'rpm' {
    return this.importedBodyActive ? 'imported' : 'rpm';
  }

  get root(): THREE.Object3D {
    return this.model;
  }

  dispose(): void {
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.model);
    for (const material of this.ownMaterials) material.dispose();
    for (const geometry of this.ownGeometries) geometry.dispose();
    // Geometrie e texture del prototipo sono condivise: non si liberano qui
    this.group.clear();
  }
}
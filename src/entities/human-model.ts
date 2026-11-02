import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
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

/**
 * Personaggi umani veri.
 *
 * Il gioco usa il corpo X Bot con scheletro Mixamo e le clip del Locomotion
 * Pack. Un solo rig viene condiviso come prototipo; ogni personaggio riceve
 * una copia indipendente dello scheletro.
 *
 * Un `HumanBody` è un'istanza indipendente (scheletro clonato): geometrie e
 * texture restano una copia sola in memoria anche con venti pedoni in scena.
 */

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

export interface HumanMotion {
  forward?: number;
  strafe?: number;
  uphill?: boolean;
  driving?: boolean;
}

interface HumanFileSet {
  body: string;
  idle: string;
  walk: string;
  walkVariants: string[];
  run: string;
  jog: string;
  jump: string;
  stairs: string;
  strafeLeft: string;
  strafeRight: string;
  turnLeft: string;
  turnRight: string;
  walkTurn: string;
  turn180: string;
  startWalking: string;
  stopWalking: string;
  enterCar: string;
  exitCar: string;
  driving: string;
}

interface HairAssets {
  male: readonly THREE.Object3D[];
  female: readonly THREE.Object3D[];
}

export interface BodySize {
  /** altezza reale della mesh skinning, in unità mondo */
  height: number;
  /** quota del punto più basso, per appoggiare i piedi a terra */
  minY: number;
}

export interface HumanAssets {
  readonly male: THREE.Object3D;
  readonly female: THREE.Object3D;
  readonly size: { male: BodySize; female: BodySize };
  readonly clips: { male: AnimSet; female: AnimSet };
  readonly hair: HairAssets;
}

export const HUMAN_FILES: HumanFileSet = {
  body: 'xbot.fbx',
  idle: 'locomotion-pack/idle.fbx',
  walk: 'locomotion-pack/walking.fbx',
  walkVariants: ['Walking (1).fbx', 'Walking (2).fbx', 'Walking (3).fbx', 'Walking (4).fbx'].map(
    (file) => `locomotion-pack/${file}`,
  ),
  run: 'locomotion-pack/running.fbx',
  jog: 'locomotion-pack/Jogging.fbx',
  jump: 'locomotion-pack/Jump (2).fbx',
  stairs: 'locomotion-pack/Walking Up The Stairs.fbx',
  strafeLeft: 'locomotion-pack/left strafe.fbx',
  strafeRight: 'locomotion-pack/right strafe walking.fbx',
  turnLeft: 'locomotion-pack/left turn 90.fbx',
  turnRight: 'locomotion-pack/Right Turn (2).fbx',
  walkTurn: 'locomotion-pack/Walking Left Turn.fbx',
  turn180: 'locomotion-pack/Walking Turn 180.fbx',
  startWalking: 'locomotion-pack/Start Walking.fbx',
  stopWalking: 'locomotion-pack/Stop Walking.fbx',
  enterCar: 'locomotion-pack/Entering Car.fbx',
  exitCar: 'locomotion-pack/Exiting Car.fbx',
  driving: 'locomotion-pack/Driving.fbx',
};

const PATH_RE = /^(.+)\.(position|quaternion|scale)$/;

type AnimatedFbx = THREE.Group & { animations: THREE.AnimationClip[] };

/**
 * Nome osso confrontabile: FBX/glTF possono rappresentare il prefisso Mixamo
 * con o senza due punti; la normalizzazione li rende confrontabili.
 */
function boneKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .replace(/^mixamorig/, '');
}

function indexBones(root: THREE.Object3D): Map<string, THREE.Object3D> {
  const bones = new Map<string, THREE.Object3D>();
  root.traverse((obj) => {
    if (!obj.name) return;
    const key = boneKey(obj.name);
    if (!bones.has(key)) bones.set(key, obj);
  });
  return bones;
}

function makeHair(source: THREE.Object3D, hairColor: number, materialsOwned: THREE.Material[]): THREE.Group {
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
  fit.scale.set(0.25 / size.x, 0.28 / size.y, 0.24 / size.z);
  fit.position.y = 0.015;
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

/**
 * Misura il corpo nella posa di riposo ricavandola dallo scheletro.
 *
 * `Box3.setFromObject` non funziona: sui modelli con skinning legge il bounding
 * box della geometria, che sta nello spazio di bind — da lì uscivano personaggi
 * alti venti metri o alti venti centimetri. Le ossa invece stanno sempre nello
 * stesso spazio della mesh renderizzata: si misura la loro altezza e si aggiunge
 * il margine di cranio e piedi (circa il 10%, misurato confrontando
 * l'altezza delle ossa con il render ortografico del corpo).
 */
function measureBody(root: THREE.Object3D): BodySize {
  root.updateWorldMatrix(true, true);
  const bones = new THREE.Box3();
  const point = new THREE.Vector3();
  root.traverse((obj) => {
    if ((obj as THREE.Bone).isBone) bones.expandByPoint(obj.getWorldPosition(point));
  });
  const span = bones.max.y - bones.min.y;
  if (!Number.isFinite(span) || span < 0.2) return { height: 1.8, minY: 0 };
  return { height: span * 1.1, minY: bones.min.y - span * 0.02 };
}

/**
 * Porta una clip sul corpo: le tracce sono già scritte per questa riga
 * scheletrica, quindi basta sostituire il nome dell'osso con quello dell'istanza
 * clonata. Le tracce di ossa assenti (le dita, in questi corpi) vengono scartate.
 */
export function bindClip(clip: THREE.AnimationClip, root: THREE.Object3D): THREE.AnimationClip | null {
  const bones = indexBones(root);
  const tracks: THREE.KeyframeTrack[] = [];
  for (const track of clip.tracks) {
    const match = PATH_RE.exec(track.name);
    if (!match) continue;
    const bone = bones.get(boneKey(match[1] ?? ''));
    if (!bone) continue;
    const path = match[2];
    if (path === 'quaternion') {
      tracks.push(new THREE.QuaternionKeyframeTrack(`${bone.name}.quaternion`, track.times, track.values));
    } else if (path === 'position') {
      // La traslazione del bacino contiene il root motion delle clip (e in
      // quelle femminili è in un'unità diversa): lasciandola, il personaggio
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

async function loadFbx(loader: FBXLoader, url: string): Promise<AnimatedFbx> {
  try {
    const asset = await loader.loadAsync(url);
    const withAnimations = asset as THREE.Group & { animations?: unknown };
    if (!Array.isArray(withAnimations.animations)) {
      throw new Error('il file non contiene la lista delle animazioni');
    }
    return withAnimations as AnimatedFbx;
  } catch (err) {
    throw new Error(`modello ${url} non caricato: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function firstClip(fbx: AnimatedFbx): THREE.AnimationClip | null {
  return fbx.animations.find((clip) => clip.tracks.length > 0) ?? null;
}

async function loadRig(
  loader: FBXLoader,
  base: string,
  files: HumanFileSet,
): Promise<{ body: THREE.Object3D; clips: AnimSet }> {
  const keys: Array<Exclude<keyof HumanFileSet, 'body' | 'walkVariants'>> = [
    'idle',
    'walk',
    'run',
    'jog',
    'jump',
    'stairs',
    'strafeLeft',
    'strafeRight',
    'turnLeft',
    'turnRight',
    'walkTurn',
    'turn180',
    'startWalking',
    'stopWalking',
    'enterCar',
    'exitCar',
    'driving',
  ];
  const [body, loadedMotions, loadedWalkVariants] = await Promise.all([
    loadFbx(loader, base + files.body),
    Promise.all(keys.map(async (key) => [key, await loadFbx(loader, base + files[key])] as const)),
    Promise.all(files.walkVariants.map((file) => loadFbx(loader, base + file))),
  ]);
  const motions = new Map(loadedMotions);
  const bind = (fbx: AnimatedFbx, name: string): THREE.AnimationClip => {
    const source = firstClip(fbx);
    if (!source) throw new Error(`clip mancante in ${name}`);
    const clip = bindClip(source, body);
    if (!clip) throw new Error(`nessuna traccia della clip ${name} corrisponde allo scheletro X Bot`);
    return clip;
  };
  const clip = (key: (typeof keys)[number]): THREE.AnimationClip => {
    const fbx = motions.get(key);
    if (!fbx) throw new Error(`clip mancante: ${key}`);
    return bind(fbx, files[key]);
  };
  return {
    body,
    clips: {
      idle: clip('idle'),
      walk: clip('walk'),
      walkVariants: loadedWalkVariants.map((fbx, index) => bind(fbx, files.walkVariants[index]!)),
      run: clip('run'),
      jog: clip('jog'),
      jump: clip('jump'),
      stairs: clip('stairs'),
      strafeLeft: clip('strafeLeft'),
      strafeRight: clip('strafeRight'),
      turnLeft: clip('turnLeft'),
      turnRight: clip('turnRight'),
      walkTurn: clip('walkTurn'),
      turn180: clip('turn180'),
      startWalking: clip('startWalking'),
      stopWalking: clip('stopWalking'),
      enterCar: clip('enterCar'),
      exitCar: clip('exitCar'),
      driving: clip('driving'),
    },
  };
}

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

export async function loadHumanAssets(base = `${import.meta.env.BASE_URL}models/`): Promise<HumanAssets> {
  const [rig, maleHair, femaleHair] = await Promise.all([
    loadRig(new FBXLoader(), base, HUMAN_FILES),
    loadHairVariants(base.replace(/models\/$/, 'characters/'), 'free_male_fashion_hair_collection_01_lowpoly.glb', 'male'),
    loadHairVariants(base.replace(/models\/$/, 'characters/'), 'hair_pack_part_2.glb', 'female'),
  ]);
  const size = measureBody(rig.body);
  return {
    male: rig.body,
    female: rig.body,
    size: { male: size, female: size },
    clips: { male: rig.clips, female: rig.clips },
    hair: { male: maleHair, female: femaleHair },
  };
}

export interface HumanBodyOptions {
  /** ombre proiettate: i pedoni lontani possono risparmiarle */
  shadow?: boolean;
  /** variazione casuale della fase di animazione, per non vederli marciare in sincrono */
  phase?: number;
  /** moltiplicatore di colore per dare varianti di carnagione e capo */
  tint?: THREE.Color;
}

/**
 * Porta il secondo passo alla stessa frazione di falcata del primo.
 *
 * Camminata e corsa sono due clip diverse (durata e falcata diverse): se i pesi
 * si incrociano senza allineare il tempo, durante il blend i piedi scattano e la
 * camminata "slitta". Si prende la fase normalizzata (0…1) della clip che pesa
 * di più e si riporta l'altra su quella fase, come `syncWith` dell'esempio
 * `webgl_animation_skinning_blending` ma senza dipendere dal warping di three.js.
 *
 * Funzione pura: tempi e durate in secondi, ritorna il nuovo tempo della clip
 * da allineare (`null` se non c'è niente da fare).
 */

export class HumanBody {
  readonly group = new THREE.Group();
  private readonly mixer: THREE.AnimationMixer;
  private readonly actions: Record<'idle' | 'walk' | 'run', THREE.AnimationAction>;
  private readonly directionalActions: Record<'stairs' | 'strafeLeft' | 'strafeRight', THREE.AnimationAction>;
  private readonly oneShotActions: Record<HumanAction, THREE.AnimationAction>;
  private readonly drivingAction: THREE.AnimationAction;
  private readonly ownMaterials: THREE.Material[] = [];
  private readonly model: THREE.Object3D;
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
    /** asse di flessione locale: cambia fra gambe (X) e braccia (Y/Z) */
    axis: THREE.Vector3;
  }> = [];
  private readonly seatOffset = new THREE.Quaternion();
  private seatProgress = 0;
  private groundPitch = 0;
  private groundRoll = 0;

  constructor(assets: HumanAssets, appearance: Appearance, options: HumanBodyOptions = {}) {
    const female = appearance.sex === 'donna';
    const proto = female ? assets.female : assets.male;
    const model = cloneSkeleton(proto) as THREE.Object3D;
    this.model = model;

    // Il rig Mixamo non ha una clip "seduto": si piegano le
    // ossa di coscia, polpaccio e braccio con la funzione pura `seatPose`.
    const bones = indexBones(model);
    const head = bones.get('head');
    const hairVariants = female ? assets.hair.female : assets.hair.male;
    if (head && hairVariants.length > 0) {
      head.add(
        makeHair(
          hairVariants[Math.floor(Math.random() * hairVariants.length)]!,
          appearance.hairColor,
          this.ownMaterials,
        ),
      );
    }
    // L'asse di flessione non è lo stesso per tutte le ossa: nelle gambe la
    // rotazione X porta il ginocchio in avanti, nei bracci del rig Mixamo l'osso
    // sta lungo X e ruotare su X lo avvita soltanto. Per portare le mani al
    // volante serve Y sulla spalla e Z sul gomito.
    const bindSeat = (
      keys: string[],
      role: 'hip' | 'knee' | 'arm' | 'elbow' | 'torso',
      axis: THREE.Vector3,
    ): void => {
      for (const key of keys) {
        const bone = bones.get(key);
        if (!bone) continue;
        this.seatRig.push({ bone, rest: bone.quaternion.clone(), role, axis });
        return;
      }
    };
    const AXIS_X = new THREE.Vector3(1, 0, 0);
    // asse obliquo della spalla, misurato sul rig: porta la mano in avanti e
    // verso il centro del volante invece di avvitare il braccio
    const AXIS_ARM_LEFT = new THREE.Vector3(-0.5, 0, 0.8660254);
    const AXIS_ARM_RIGHT = new THREE.Vector3(-0.5, 0, -0.8660254);
    bindSeat(['leftupleg', 'leftthigh'], 'hip', AXIS_X);
    bindSeat(['rightupleg', 'rightthigh'], 'hip', AXIS_X);
    bindSeat(['leftleg', 'leftshin', 'leftcalf'], 'knee', AXIS_X);
    bindSeat(['rightleg', 'rightshin', 'rightcalf'], 'knee', AXIS_X);
    bindSeat(['leftarm', 'leftshoulder'], 'arm', AXIS_ARM_LEFT);
    bindSeat(['rightarm', 'rightshoulder'], 'arm', AXIS_ARM_RIGHT);
    bindSeat(['leftforearm', 'leftlowerarm', 'leftelbow'], 'elbow', AXIS_X);
    bindSeat(['rightforearm', 'rightlowerarm', 'rightelbow'], 'elbow', AXIS_X);
    bindSeat(['spine1', 'spine', 'chest'], 'torso', AXIS_X);

    // scala del corpo: altezza scelta dall'utente, larghezza dalla corporatura
    const girth = BUILD_GIRTH[appearance.build];
    const size = female ? assets.size.female : assets.size.male;
    const scale = appearance.height / size.height;
    model.position.y = -size.minY;

    const inner = new THREE.Group();
    inner.name = 'human-scale';
    inner.scale.set(scale * girth, scale, scale * girth);
    inner.add(model);
    this.group.add(inner);

    const colors = outfitColors(appearance);
    model.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = options.shadow !== false;
      mesh.receiveShadow = true;
      // le mesh skinning hanno il bounding volume della posa di riposo: senza
      // questo, durante la camminata il busto può sparire ai bordi dello schermo
      mesh.frustumCulled = false;
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      const cloned = materials.map((mat) => {
        const copy = mat.clone() as THREE.MeshStandardMaterial;
        this.ownMaterials.push(copy);
        copy.envMapIntensity = Math.max(copy.envMapIntensity ?? 1, 0.55);
        if (copy.name.toLowerCase().includes('highlimbs')) copy.color.setHex(colors.top);
        else if (copy.name.toLowerCase().includes('joints')) copy.color.setHex(appearance.skin);
        if (options.tint) copy.color.multiply(options.tint);
        return copy;
      });
      mesh.material = Array.isArray(mesh.material) ? cloned : cloned[0]!;
    });

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
   * Avanza la locomozione con un blend continuo idle → camminata → corsa.
   *
   * Rispetto al vecchio interruttore a tre stati (che sfumava un'azione alla
   * volta), qui i pesi seguono la velocità con due smoothstep, come
   * nell'esempio `webgl_animation_skinning_blending` di Three.js: a 2 m/s il
   * personaggio è già metà camminata e metà corsa, senza scatti al confine.
   * I pesi vengono poi rinormalizzati a 1, altrimenti durante la transizione
   * la posa di riposo traspare e il corpo sembra afflosciarsi.
   */
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

    // passo sincronizzato: quando camminata e corsa si sovrappongono, la clip
    // che pesa meno segue la fase di quella che pesa di più (altrimenti durante
    // il blend i piedi cambiano ritmo a metà falcata)
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

    // Ripristina la posa di riposo prima del mixer: le ossa non animate dalla
    // clip in uso resterebbero altrimenti con l'offset del frame precedente.
    for (const entry of this.seatRig) entry.bone.quaternion.copy(entry.rest);
    this.mixer.update(dt);

    if (!driving && !eventActive && this.seatProgress > 0.001 && this.seatRig.length > 0) {
      const pose = seatPose(this.seatProgress);
      for (const entry of this.seatRig) {
        const angle = pose[entry.role];
        if (Math.abs(angle) < 1e-5) continue;
        this.seatOffset.setFromAxisAngle(entry.axis, angle);
        entry.bone.quaternion.multiply(this.seatOffset);
      }
    }

    // Inclinazione del corpo sul pendio: piccola e smorzata, altrimenti il
    // personaggio sembra appoggiato di lato su un muro.
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

  get root(): THREE.Object3D {
    return this.model;
  }

  dispose(): void {
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.model);
    for (const material of this.ownMaterials) material.dispose();
    // geometrie e texture sono condivise con il prototipo: non si liberano qui
    this.group.clear();
  }
}

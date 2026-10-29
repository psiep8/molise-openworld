import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js';
import { GAME } from '../config';
import { BUILD_GIRTH, type Appearance } from './appearance';
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
 * Niente più cilindri e sfere: qui si caricano due corpi con skinning e texture
 * da foto (scheletro Ready Player Me, ~15–20 k triangoli, pelle, capelli e
 * vestiti dipinti sulla mappa) e sei clip di motion capture — idle, camminata e
 * corsa per uomo e donna — riprese da attori veri e già ritargettizzate sulla
 * stessa riga scheletrica dei corpi.
 *
 * Un `HumanBody` è un'istanza indipendente (scheletro clonato): geometrie e
 * texture restano una copia sola in memoria anche con venti pedoni in scena.
 */

export interface AnimSet {
  idle: THREE.AnimationClip;
  walk: THREE.AnimationClip;
  run: THREE.AnimationClip;
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
}

export const HUMAN_FILES = {
  male: { body: 'uomo.glb', idle: 'uomo-idle.glb', walk: 'uomo-walk.glb', run: 'uomo-run.glb' },
  female: { body: 'donna.glb', idle: 'donna-idle.glb', walk: 'donna-walk.glb', run: 'donna-run.glb' },
} as const;

const PATH_RE = /^(.+)\.(position|quaternion|scale)$/;

/**
 * Nome osso confrontabile: il loader glTF toglie i due punti, quindi
 * "mixamorig:Hips" e "mixamorigHips" diventano "mixamorighips"; il prefisso
 * Mixamo viene eliminato per far combaciare rig diversi.
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

async function loadGltf(loader: GLTFLoader, url: string): Promise<Awaited<ReturnType<GLTFLoader['loadAsync']>>> {
  try {
    return await loader.loadAsync(url);
  } catch (err) {
    throw new Error(`modello ${url} non caricato: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function firstClip(gltf: Awaited<ReturnType<GLTFLoader['loadAsync']>>): THREE.AnimationClip | null {
  return gltf.animations[0] ?? null;
}

async function loadRig(
  loader: GLTFLoader,
  base: string,
  files: { body: string; idle: string; walk: string; run: string },
): Promise<{ body: THREE.Object3D; clips: AnimSet }> {
  const [body, idle, walk, run] = await Promise.all([
    loadGltf(loader, base + files.body),
    loadGltf(loader, base + files.idle),
    loadGltf(loader, base + files.walk),
    loadGltf(loader, base + files.run),
  ]);
  const bind = (gltf: Awaited<ReturnType<GLTFLoader['loadAsync']>>, fallback?: THREE.AnimationClip): THREE.AnimationClip => {
    const source = firstClip(gltf) ?? fallback;
    if (!source) throw new Error(`clip mancante in ${files.idle}`);
    return bindClip(source, body.scene) ?? source;
  };
  const idleClip = bind(idle);
  return {
    body: body.scene,
    clips: {
      idle: idleClip,
      walk: bind(walk, idleClip),
      run: bind(run, idleClip),
    },
  };
}

export async function loadHumanAssets(base = `${import.meta.env.BASE_URL}models/`): Promise<HumanAssets> {
  const loader = new GLTFLoader();
  const [male, female] = await Promise.all([
    loadRig(loader, base, HUMAN_FILES.male),
    loadRig(loader, base, HUMAN_FILES.female),
  ]);
  return {
    male: male.body,
    female: female.body,
    size: { male: measureBody(male.body), female: measureBody(female.body) },
    clips: { male: male.clips, female: female.clips },
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
  private readonly ownMaterials: THREE.Material[] = [];
  private readonly model: THREE.Object3D;
  /** Ossa della posa seduta, con la rotazione di riposo da ripristinare. */
  private readonly seatRig: Array<{
    bone: THREE.Object3D;
    rest: THREE.Quaternion;
    role: 'hip' | 'knee' | 'arm' | 'torso';
  }> = [];
  private readonly seatOffset = new THREE.Quaternion();
  private readonly seatAxis = new THREE.Vector3(1, 0, 0);
  private seatProgress = 0;
  private groundPitch = 0;
  private groundRoll = 0;

  constructor(assets: HumanAssets, appearance: Appearance, options: HumanBodyOptions = {}) {
    const female = appearance.sex === 'donna';
    const proto = female ? assets.female : assets.male;
    const model = cloneSkeleton(proto) as THREE.Object3D;
    this.model = model;

    // La riga Ready Player Me/Mixamo non ha una clip "seduto": si piegano le
    // ossa di coscia, polpaccio e braccio con la funzione pura `seatPose`.
    const bones = indexBones(model);
    const bindSeat = (keys: string[], role: 'hip' | 'knee' | 'arm' | 'torso'): void => {
      for (const key of keys) {
        const bone = bones.get(key);
        if (!bone) continue;
        this.seatRig.push({ bone, rest: bone.quaternion.clone(), role });
        return;
      }
    };
    bindSeat(['leftupleg', 'leftthigh'], 'hip');
    bindSeat(['rightupleg', 'rightthigh'], 'hip');
    bindSeat(['leftleg', 'leftshin', 'leftcalf'], 'knee');
    bindSeat(['rightleg', 'rightshin', 'rightcalf'], 'knee');
    bindSeat(['leftarm', 'leftshoulder'], 'arm');
    bindSeat(['rightarm', 'rightshoulder'], 'arm');
    bindSeat(['spine1', 'spine', 'chest'], 'torso');

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
      walk: prepare(clips.walk, 0),
      run: prepare(clips.run, 0),
    };
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
  update(dt: number, speed: number): void {
    const target = locomotionWeights(speed, GAME.walkSpeed, GAME.runSpeed);
    const current = {
      idle: this.actions.idle.getEffectiveWeight(),
      walk: this.actions.walk.getEffectiveWeight(),
      run: this.actions.run.getEffectiveWeight(),
    };
    const weights = blendLocomotion(current, target, dt);
    this.actions.idle.setEffectiveWeight(weights.idle);
    this.actions.walk.setEffectiveWeight(weights.walk);
    this.actions.run.setEffectiveWeight(weights.run);
    this.actions.walk.timeScale = strideTimeScale('walk', speed, GAME.walkSpeed, GAME.runSpeed);
    this.actions.run.timeScale = strideTimeScale('run', speed, GAME.walkSpeed, GAME.runSpeed);

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

    if (this.seatProgress > 0.001 && this.seatRig.length > 0) {
      const pose = seatPose(this.seatProgress);
      for (const entry of this.seatRig) {
        const angle = pose[entry.role];
        if (Math.abs(angle) < 1e-5) continue;
        this.seatOffset.setFromAxisAngle(this.seatAxis, angle);
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

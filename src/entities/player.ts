import * as THREE from 'three';
import { GAME } from '../config';
import type { Heightfield } from '../geo/elevation';
import type { BuildingIndex, RoadIndex } from '../geo/osm';
import { clamp } from '../geo/geo';
import { fabricNormal, skinNormal } from '../gfx/detail-textures';
import { HumanBody, type HumanAssets } from './human-model';
import {
  BUILD_GIRTH,
  loadAppearance,
  outfitColors,
  heightScale,
  type Appearance,
  type HairStyle,
} from './appearance';

export interface MoveInput {
  forward: number;
  strafe: number;
  sprint: boolean;
  jump: boolean;
}

type Locomotion = 'idle' | 'walk' | 'run';

const RADIUS = 0.42;
/** Lati dei cilindri del corpo: sotto i 12 il personaggio sembra un esagono. */
const LIMB_SEGMENTS = 14;
/** Il rig base misura ~2,06 m: lo si riporta a 1,75 m prima di applicare l'altezza scelta. */
const RIG_SCALE = 0.85;

function makeBone(name: string, x: number, y: number, z = 0): THREE.Bone {
  const bone = new THREE.Bone();
  bone.name = name;
  bone.position.set(x, y, z);
  return bone;
}

/**
 * Personaggio umanoide procedurale, personalizzabile.
 *
 * Le mesh sono figlie delle ossa (non c'è vertex skinning): ruotando un osso
 * si muove l'arto e tutta la catena sotto di lui, esattamente come in un rig
 * scheletrico. Le animazioni passano da un `AnimationMixer` con clip su
 * `osso.rotation[x]`, con blend pesato tra idle/walk/run e due clip additive
 * (salto e caduta) sommate sopra la camminata — la stessa tecnica dell'esempio
 * three.js `webgl_animation_skinning_additive_blending`.
 *
 * Cambiare aspetto ricostruisce l'avatar nello stesso `Group`, così la scena
 * non deve riaggiungerlo: cambiano mesh, materiali e mixer, non la posizione.
 */
export class Player {
  readonly position = new THREE.Vector3();
  readonly velocity = new THREE.Vector3();
  yaw = 0;
  pitch = 0;
  grounded = true;
  readonly avatar: THREE.Group;
  appearance: Appearance;

  private mixer!: THREE.AnimationMixer;
  private actions!: Record<Locomotion, THREE.AnimationAction>;
  private jumpAction!: THREE.AnimationAction;
  private fallAction!: THREE.AnimationAction;
  /** corpo umano rigged; finché è null vale il rig procedurale */
  private body: HumanBody | null = null;
  private humanAssets: HumanAssets | null = null;
  /** true quando in scena c'è il rig procedurale, da smaltire al primo GLB */
  private proceduralBuilt = false;
  private walkPhase = 0;
  private bob = 0;

  constructor(appearance: Appearance = loadAppearance()) {
    this.appearance = { ...appearance };
    this.avatar = new THREE.Group();
    this.avatar.name = 'player-avatar';
    this.rebuild();
  }

  /** Cambia carnagione, capelli, corporatura o outfit senza perdere la posizione. */
  applyAppearance(appearance: Appearance): void {
    this.appearance = { ...appearance };
    this.rebuild();
    this.syncMesh();
  }

  /**
   * Passa dal rig procedurale al corpo umano vero (GLB con skinning).
   * Chiamato durante il caricamento: se i modelli non arrivano, resta il rig
   * di primitive invece di un personaggio invisibile.
   */
  useHumanModel(assets: HumanAssets): void {
    this.humanAssets = assets;
    this.rebuild();
    this.syncMesh();
  }

  private rebuild(): void {
    if (this.body) {
      this.body.dispose();
      this.body = null;
    }
    this.mixer?.stopAllAction();
    if (this.proceduralBuilt) {
      this.disposeAvatar();
      this.proceduralBuilt = false;
    }
    this.avatar.clear();

    if (this.humanAssets) {
      this.body = new HumanBody(this.humanAssets, this.appearance, { phase: Math.random() * 2 });
      this.avatar.add(this.body.group);
      return;
    }

    this.proceduralBuilt = true;
    const rig = this.buildRig();
    this.avatar.add(rig);

    const clips = this.buildClips();
    this.mixer = new THREE.AnimationMixer(this.avatar);
    this.actions = {
      idle: this.prepare(this.mixer.clipAction(clips.idle), 1),
      walk: this.prepare(this.mixer.clipAction(clips.walk), 0),
      run: this.prepare(this.mixer.clipAction(clips.run), 0),
    };

    this.jumpAction = this.mixer.clipAction(clips.jump);
    this.jumpAction.blendMode = THREE.AdditiveAnimationBlendMode;
    this.jumpAction.setEffectiveWeight(0);
    this.jumpAction.play();

    this.fallAction = this.mixer.clipAction(clips.fall);
    this.fallAction.blendMode = THREE.AdditiveAnimationBlendMode;
    this.fallAction.setEffectiveWeight(0);
    this.fallAction.play();
  }

  private disposeAvatar(): void {
    // solo il rig procedurale possiede le sue geometrie: quelle dei GLB sono
    // condivise tra tutte le istanze e non vanno liberate qui
    if (this.body) return;
    this.avatar.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.geometry.dispose();
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const material of materials) material.dispose();
    });
  }

  private prepare(action: THREE.AnimationAction, weight: number): THREE.AnimationAction {
    action.setEffectiveWeight(weight);
    action.setLoop(THREE.LoopRepeat, Infinity);
    action.play();
    return action;
  }

  // -------------------------------------------------------------------------
  // rig
  // -------------------------------------------------------------------------
  private buildRig(): THREE.Group {
    const look = this.appearance;
    const colors = outfitColors(look);
    const female = look.sex === 'donna';

    const rig = new THREE.Group();
    rig.name = 'player-rig';
    const height = heightScale(look);
    const girth = BUILD_GIRTH[look.build];
    rig.scale.set(girth * RIG_SCALE, height * RIG_SCALE, girth * RIG_SCALE);

    // Tessuti e pelle fisici: il `sheen` dà la peluria dei capi in cotone, il
    // leggero clearcoat della pelle restituisce il riflesso grasso dell'epidermide.
    // Trama del tessuto e pori della pelle: senza normal map i materiali sono
    // superfici perfette, ed è esattamente ciò che fa sembrare un manichino.
    const weave = fabricNormal();
    const pores = skinNormal();
    const top = new THREE.MeshPhysicalMaterial({
      color: colors.top,
      roughness: colors.roughness,
      metalness: colors.metalness,
      normalMap: weave,
      normalScale: new THREE.Vector2(0.45, 0.45),
      sheen: 0.7,
      sheenRoughness: 0.7,
      sheenColor: new THREE.Color(colors.top).lerp(new THREE.Color(0xffffff), 0.5),
      envMapIntensity: 0.5,
    });
    const bottom = new THREE.MeshPhysicalMaterial({
      color: colors.bottom,
      roughness: Math.min(1, colors.roughness + 0.1),
      normalMap: weave,
      normalScale: new THREE.Vector2(0.55, 0.55),
      sheen: 0.5,
      sheenRoughness: 0.8,
      sheenColor: new THREE.Color(colors.bottom).lerp(new THREE.Color(0xffffff), 0.4),
      envMapIntensity: 0.45,
    });
    const shoes = new THREE.MeshPhysicalMaterial({
      color: colors.shoes,
      roughness: 0.7,
      normalMap: weave,
      normalScale: new THREE.Vector2(0.5, 0.5),
      clearcoat: 0.35,
      clearcoatRoughness: 0.35,
      envMapIntensity: 0.6,
    });
    const skin = new THREE.MeshPhysicalMaterial({
      color: look.skin,
      roughness: 0.62,
      normalMap: pores,
      // pori appena accennati: con 0,55 la faccia sembrava una pagnotta
      normalScale: new THREE.Vector2(0.22, 0.22),
      clearcoat: 0.08,
      clearcoatRoughness: 0.55,
      sheen: 0.25,
      sheenRoughness: 0.9,
      sheenColor: 0xffd9c0,
      envMapIntensity: 0.35,
    });
    const accent = new THREE.MeshPhysicalMaterial({
      color: colors.accent,
      roughness: 0.55,
      normalMap: weave,
      normalScale: new THREE.Vector2(0.4, 0.4),
      sheen: 0.4,
      sheenRoughness: 0.6,
    });
    const leather = new THREE.MeshPhysicalMaterial({
      color: 0x2a2118,
      roughness: 0.52,
      normalMap: weave,
      normalScale: new THREE.Vector2(0.8, 0.8),
      clearcoat: 0.25,
      clearcoatRoughness: 0.5,
    });
    const hair = new THREE.MeshPhysicalMaterial({ color: look.hairColor, roughness: 0.62, sheen: 0.5, sheenRoughness: 0.45, envMapIntensity: 0.7 });

    const addMesh = (
      parent: THREE.Object3D,
      geometry: THREE.BufferGeometry,
      material: THREE.Material,
      x = 0,
      y = 0,
      z = 0,
    ): THREE.Mesh => {
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(x, y, z);
      mesh.castShadow = true;
      parent.add(mesh);
      return mesh;
    };

    // Profilo di rivoluzione: il torace non è un cilindro ma una forma che si
    // allarga sulle spalle e si stringe in vita. Appiattito in z dà la sezione
    // ovale di un corpo umano invece del tubo tondo.
    const lathe = (profile: Array<[number, number]>, segments = 16): THREE.LatheGeometry =>
      new THREE.LatheGeometry(
        profile.map(([radius, y]) => new THREE.Vector2(Math.max(0.004, radius), y)),
        segments,
      );

    const hips = makeBone('hips', 0, 0.95);
    rig.add(hips);
    const pelvis = addMesh(
      hips,
      lathe([
        [0.02, -0.27],
        [0.155, -0.25],
        [0.175, -0.13],
        [0.17, 0.01],
        [0.145, 0.08],
        [0.02, 0.09],
      ]),
      bottom,
    );
    pelvis.scale.z = 0.72;

    const spine = makeBone('spine', 0, 0.1);
    hips.add(spine);
    const chest = makeBone('chest', 0, 0.34);
    spine.add(chest);

    const torsoRadius = female ? 0.9 : 1;
    const torso = addMesh(
      spine,
      lathe([
        [0.02, -0.28],
        [0.15, -0.26],
        [0.16, -0.12],
        [0.148, 0.0],
        [0.168 * torsoRadius, 0.14],
        [0.2 * torsoRadius, 0.32],
        [0.205 * torsoRadius, 0.44],
        [0.2 * torsoRadius, 0.52],
        [0.145, 0.575],
        [0.02, 0.6],
      ]),
      top,
    );
    torso.scale.z = female ? 0.66 : 0.7;

    // cintura con fibbia: divide il busto dai pantaloni e dà subito l'idea di
    // una persona vestita invece di un tubo colorato
    const belt = addMesh(hips, new THREE.CylinderGeometry(0.176, 0.18, 0.055, 16, 1, true), leather, 0, 0.0, 0);
    belt.scale.z = female ? 0.7 : 0.74;
    addMesh(hips, new THREE.BoxGeometry(0.06, 0.05, 0.022), new THREE.MeshStandardMaterial({ color: 0xb9a888, roughness: 0.35, metalness: 0.7 }), 0, 0, female ? -0.126 : -0.133);

    // bottoni della camicia lungo l'asse del petto
    const buttonMat = new THREE.MeshStandardMaterial({ color: 0xe6dfd2, roughness: 0.4 });
    for (let i = 0; i < (colors.collar ? 3 : 2); i++) {
      addMesh(chest, new THREE.SphereGeometry(0.0085, 8, 6), buttonMat, 0, 0.02 + i * 0.1, -0.157);
    }

    // deltoidi: coprono l'incastro braccio/spalla, che senza resta un cilindro
    // piantato nel fianco
    const deltoidRadius = female ? 0.052 : 0.062;

    // colletto della maglia: un anello alla base del collo, non un cartello
    // appeso davanti al petto (era il difetto più visibile da davanti)
    addMesh(chest, new THREE.CylinderGeometry(0.077, 0.086, 0.05, 16, 1, true), colors.collar ? accent : top, 0, 0.245, 0);

    if (colors.collar) {
      // camicia sotto la giacca: pannello chiaro sul petto, appoggiato al torso
      addMesh(chest, new THREE.BoxGeometry(0.13, 0.25, 0.022), accent, 0, 0.1, -0.142);
      // due alette del colletto inclinate verso l'esterno
      for (const side of [-1, 1] as const) {
        const flap = addMesh(chest, new THREE.BoxGeometry(0.06, 0.075, 0.02), accent, side * 0.045, 0.2, -0.132);
        flap.rotation.z = side * 0.45;
      }
      if (colors.tie) addMesh(chest, new THREE.BoxGeometry(0.038, 0.2, 0.016), bottom, 0, 0.08, -0.15);
    }

    const neck = makeBone('neck', 0, 0.3);
    chest.add(neck);
    // collo corto e pieno: con 13 cm il testone sembrava infilzato su un bastone
    addMesh(neck, new THREE.CylinderGeometry(0.055, 0.066, 0.1, LIMB_SEGMENTS), skin, 0, 0.04, 0);
    const head = makeBone('head', 0, 0.095);
    neck.add(head);

    // La testa era larga 0,30 m: un quarto dell'altezza del corpo. Da lì veniva
    // metà dell'effetto pupazzo. Il gruppo scala tutto il volto a misura vera
    // (~0,23 m) mantenendo le proporzioni interne.
    const face = new THREE.Group();
    face.name = 'face';
    face.scale.setScalar(0.74);
    head.add(face);

    // cranio ovale + mandibola: due volumi invece di una sfera sola, che a
    // distanza ravvicinata sembrava una palla da biliardo
    const skull = addMesh(face, new THREE.SphereGeometry(0.148, 20, 16), skin, 0, 0.104, 0.004);
    skull.scale.set(1, 1.12, 1.05);
    const jaw = addMesh(face, new THREE.SphereGeometry(0.125, 18, 14), skin, 0, 0.042, -0.012);
    jaw.scale.set(0.8, 0.6, 0.82);
    // zigomi: danno la larghezza del viso sopra la mandibola
    for (const side of [-1, 1] as const) {
      const cheek = addMesh(face, new THREE.SphereGeometry(0.055, 12, 10), skin, side * 0.072, 0.086, -0.086);
      cheek.scale.set(1.1, 0.7, 0.7);
    }
    // orecchie appena accennate, altrimenti il profilo è un uovo
    for (const side of [-1, 1] as const) {
      const ear = addMesh(face, new THREE.SphereGeometry(0.03, 10, 8), skin, side * 0.128, 0.095, 0.008);
      ear.scale.set(0.5, 1, 0.85);
    }

    // occhio vero: sclera, iride e pupilla. Prima era una sfera nera sola, il
    // dettaglio che più di tutti diceva "manichino".
    const sclera = new THREE.MeshStandardMaterial({ color: 0xe9e3da, roughness: 0.25 });
    const iris = new THREE.MeshStandardMaterial({ color: 0x5a4227, roughness: 0.2 });
    const pupil = new THREE.MeshStandardMaterial({ color: 0x0b0a09, roughness: 0.15 });
    const brows = new THREE.MeshStandardMaterial({ color: look.hairColor, roughness: 0.8 });
    const lips = new THREE.MeshStandardMaterial({ color: new THREE.Color(look.skin).multiplyScalar(0.82), roughness: 0.55 });
    for (const side of [-1, 1] as const) {
      const white = addMesh(face, new THREE.SphereGeometry(0.021, 12, 10), sclera, side * 0.049, 0.118, -0.12);
      white.scale.set(1, 0.8, 0.6);
      addMesh(face, new THREE.SphereGeometry(0.011, 10, 8), iris, side * 0.049, 0.117, -0.133);
      addMesh(face, new THREE.SphereGeometry(0.005, 8, 6), pupil, side * 0.049, 0.117, -0.139);
      const brow = addMesh(face, new THREE.BoxGeometry(0.055, 0.012, 0.018), brows, side * 0.052, 0.142, -0.118);
      brow.rotation.z = side * -0.12;
      // palpebra superiore: un filo di pelle sopra l'occhio
      const lid = addMesh(face, new THREE.SphereGeometry(0.02, 10, 6, 0, Math.PI * 2, 0, Math.PI * 0.42), skin, side * 0.049, 0.121, -0.119);
      lid.scale.set(1, 0.9, 0.62);
    }
    const nose = addMesh(face, new THREE.SphereGeometry(0.019, 10, 8), skin, 0, 0.094, -0.132);
    nose.scale.set(0.8, 0.95, 1.15);
    // dorso e narici: senza, il naso resta un pallino incollato
    addMesh(face, new THREE.BoxGeometry(0.022, 0.07, 0.024), skin, 0, 0.112, -0.128).rotation.x = -0.28;
    for (const side of [-1, 1] as const) {
      addMesh(face, new THREE.SphereGeometry(0.0105, 8, 6), skin, side * 0.017, 0.083, -0.138).scale.set(1, 0.8, 0.7);
    }
    addMesh(face, new THREE.BoxGeometry(0.05, 0.012, 0.02), lips, 0, 0.048, -0.121);
    addMesh(face, new THREE.BoxGeometry(0.042, 0.008, 0.016), lips, 0, 0.033, -0.118);

    this.buildHair(face, hair);
    if (look.sex === 'uomo' && look.beard) {
      const beard = addMesh(
        face,
        new THREE.SphereGeometry(0.125, 16, 10, 0, Math.PI * 2, Math.PI * 0.52, Math.PI * 0.42),
        hair,
        0,
        0.05,
        -0.006,
      );
      beard.scale.set(0.86, 0.9, 0.86);
    }
    this.buildHat(face, colors.hat, accent, bottom);

    // spalle più strette: con 0,255 la figura superava il mezzo metro di
    // larghezza e la testa sembrava piccola
    const shoulder = female ? 0.185 : 0.2;
    for (const side of [-1, 1] as const) {
      const tag = side < 0 ? 'L' : 'R';

      const upArm = makeBone(`upArm${tag}`, side * shoulder, 0.225);
      chest.add(upArm);
      // braccio affusolato dalla spalla al gomito: la spalla è la parte più
      // larga del cilindro, così si innesta nel torace senza scalino
      addMesh(upArm, new THREE.SphereGeometry(deltoidRadius, LIMB_SEGMENTS, 10), top, 0, 0.005, 0).scale.set(1, 0.85, 1);
      addMesh(
        upArm,
        new THREE.CylinderGeometry(deltoidRadius, female ? 0.05 : 0.056, 0.27, LIMB_SEGMENTS),
        top,
        0,
        -0.135,
        0,
      );
      const lowArm = makeBone(`lowArm${tag}`, 0, -0.28);
      upArm.add(lowArm);
      addMesh(lowArm, new THREE.SphereGeometry(female ? 0.05 : 0.056, LIMB_SEGMENTS, 10), top, 0, 0.0, 0);
      addMesh(
        lowArm,
        new THREE.CylinderGeometry(female ? 0.05 : 0.055, female ? 0.036 : 0.04, 0.21, LIMB_SEGMENTS),
        top,
        0,
        -0.11,
        0,
      );
      // polsino del capo: interrompe il cilindro della manica e marca il polso
      addMesh(lowArm, new THREE.CylinderGeometry(female ? 0.042 : 0.048, female ? 0.042 : 0.048, 0.032, LIMB_SEGMENTS), accent, 0, -0.205, 0);
      const hand = makeBone(`hand${tag}`, 0, -0.24);
      lowArm.add(hand);
      // palmo con dorso arrotondato e pollice: la sfera unica sembrava un guantone
      const palm = addMesh(hand, new THREE.SphereGeometry(0.045, 12, 10), skin, 0, -0.045, 0);
      palm.scale.set(0.85, 1.35, 0.6);
      const thumb = addMesh(hand, new THREE.CapsuleGeometry(0.013, 0.03, 2, 8), skin, side * 0.03, -0.03, -0.028);
      thumb.rotation.z = side * 0.7;
      // quattro dita: a 1 m si leggono, e il pugno chiuso smette di essere un guanto
      for (let f = 0; f < 4; f++) {
        const finger = addMesh(
          hand,
          new THREE.CapsuleGeometry(0.0085, 0.026 - f * 0.002, 2, 6),
          skin,
          side * (0.016 - f * 0.011),
          -0.072,
          -0.004,
        );
        finger.rotation.x = -0.12;
      }

      const upLeg = makeBone(`upLeg${tag}`, side * 0.11, -0.04);
      hips.add(upLeg);
      // tasca dei pantaloni, leggermente in rilievo
      addMesh(upLeg, new THREE.BoxGeometry(0.072, 0.1, 0.01), bottom, side * 0.03, -0.07, -0.1).rotation.y = side * 0.18;
      addMesh(
        upLeg,
        new THREE.CylinderGeometry(female ? 0.098 : 0.105, female ? 0.078 : 0.082, 0.38, LIMB_SEGMENTS),
        bottom,
        0,
        -0.2,
        0,
      );
      const lowLeg = makeBone(`lowLeg${tag}`, 0, -0.4);
      upLeg.add(lowLeg);
      addMesh(lowLeg, new THREE.SphereGeometry(female ? 0.072 : 0.078, LIMB_SEGMENTS, 10), bottom, 0, 0.01, 0);
      // polpaccio: profilo con il rigonfiamento posteriore
      const calf = addMesh(
        lowLeg,
        new THREE.CylinderGeometry(0.07, 0.046, 0.34, LIMB_SEGMENTS),
        bottom,
        0,
        -0.19,
        0,
      );
      calf.scale.z = 1.05;
      addMesh(lowLeg, new THREE.SphereGeometry(0.062, 12, 10), bottom, 0, -0.1, 0.016).scale.set(0.95, 1.6, 0.9);

      const foot = makeBone(`foot${tag}`, 0, -0.4);
      lowLeg.add(foot);
      // scarpa: suola + tomaia, con la punta arrotondata
      addMesh(foot, new THREE.BoxGeometry(0.115, 0.03, 0.25), shoes, 0, -0.065, 0.05);
      const upper = addMesh(foot, new THREE.BoxGeometry(0.105, 0.07, 0.2), shoes, 0, -0.025, 0.035);
      upper.scale.set(1, 1, 1);
      // lacci: tre traversini chiari sul collo del piede
      for (let k = 0; k < 3; k++) {
        addMesh(foot, new THREE.BoxGeometry(0.07, 0.007, 0.012), new THREE.MeshStandardMaterial({ color: 0xdedad2, roughness: 0.8 }), 0, 0.012, -0.028 + k * 0.026);
      }
      addMesh(foot, new THREE.SphereGeometry(0.055, 12, 10), shoes, 0, -0.03, -0.075).scale.set(0.95, 0.75, 1);
    }

    return rig;
  }

  /** Capelli per stile: una calotta più eventuali ciocche, coda o chignon. */
  private buildHair(head: THREE.Object3D, hair: THREE.Material): void {
    const style: HairStyle = this.appearance.hairStyle;
    if (style === 'raso') return;

    // Il cranio è un'ellisse: la calotta va scalata come lui e lasciata un filo
    // più larga, altrimenti il cuoio capelluto esce dai capelli (bordo seghettato).    // Calotta intera ma spostata indietro: davanti resta dentro il cranio (quindi
    // invisibile) e scopre la fronte, mentre sopra e dietro esce e fa volume.
    // Con la semisfera ampia di prima i capelli coprivano la faccia come un casco.
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.161, 20, 16), hair);
    cap.position.set(0, 0.103, 0.022);
    cap.scale.set(1.01, 1.13, 1.03);
    cap.castShadow = true;
    head.add(cap);

    if (style === 'corto') {
      // frangia alta sulla fronte: abbassata com'era copriva gli occhi
      const fringe = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.035, 0.055), hair);
      fringe.position.set(0, 0.178, -0.108);
      fringe.rotation.x = -0.3;
      fringe.castShadow = true;
      head.add(fringe);
      for (const side of [-1, 1] as const) {
        const sideburn = new THREE.Mesh(new THREE.BoxGeometry(0.022, 0.07, 0.03), hair);
        sideburn.position.set(side * 0.129, 0.09, -0.046);
        sideburn.castShadow = true;
        head.add(sideburn);
      }
    } else if (style === 'coda') {
      const band = new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.012, 6, 12), hair);
      band.position.set(0, 0.02, 0.15);
      band.rotation.x = Math.PI / 2 - 0.5;
      head.add(band);
    }

    if (style === 'riccio') {
      for (const [x, y, z] of [
        [-0.09, 0.17, 0.04],
        [0.09, 0.17, 0.04],
        [0, 0.2, -0.04],
        [0, 0.18, 0.1],
      ] as const) {
        const curl = new THREE.Mesh(new THREE.SphereGeometry(0.062, 8, 6), hair);
        curl.position.set(x, y, z);
        curl.castShadow = true;
        head.add(curl);
      }
    } else if (style === 'coda') {
      const tail = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.028, 0.24, 8), hair);
      tail.position.set(0, 0.03, 0.16);
      tail.rotation.x = -0.5;
      tail.castShadow = true;
      head.add(tail);
    } else if (style === 'lunghi') {
      // massa arrotondata dietro la nuca: la scatola piatta si vedeva come un
      // pannello nero attaccato alla testa
      const back = new THREE.Mesh(new THREE.SphereGeometry(0.13, 14, 12), hair);
      back.position.set(0, -0.04, 0.12);
      back.scale.set(1.02, 1.75, 0.7);
      back.castShadow = true;
      head.add(back);
    } else if (style === 'chignon') {
      const bun = new THREE.Mesh(new THREE.SphereGeometry(0.075, 10, 8), hair);
      bun.position.set(0, 0.15, 0.13);
      bun.castShadow = true;
      head.add(bun);
    }
  }

  private buildHat(head: THREE.Object3D, hat: string, accent: THREE.Material, dark: THREE.Material): void {
    if (hat === 'cap') {
      const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.155, 0.16, 0.09, 12), accent);
      crown.position.set(0, 0.2, 0);
      const visor = new THREE.Mesh(new THREE.BoxGeometry(0.29, 0.025, 0.13), dark);
      visor.position.set(0, 0.17, -0.13);
      crown.castShadow = true;
      visor.castShadow = true;
      head.add(crown, visor);
    } else if (hat === 'band') {
      const band = new THREE.Mesh(new THREE.TorusGeometry(0.152, 0.018, 6, 16), accent);
      band.position.set(0, 0.17, 0);
      band.rotation.x = Math.PI / 2;
      head.add(band);
    } else if (hat === 'fedora') {
      const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.23, 0.23, 0.012, 16), dark);
      brim.position.set(0, 0.19, 0);
      const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.145, 0.13, 12), dark);
      crown.position.set(0, 0.255, 0);
      brim.castShadow = true;
      crown.castShadow = true;
      head.add(brim, crown);
    }
  }

  // -------------------------------------------------------------------------
  // clip
  // -------------------------------------------------------------------------
  private buildClips(): Record<Locomotion | 'jump' | 'fall', THREE.AnimationClip> {
    const track = (path: string, times: number[], values: number[]): THREE.NumberKeyframeTrack =>
      new THREE.NumberKeyframeTrack(path, times, values);
    const swing = (name: string, axis: 'x' | 'y' | 'z', times: number[], values: number[]): THREE.NumberKeyframeTrack =>
      track(`${name}.rotation[${axis}]`, times, values);

    const idle = new THREE.AnimationClip('idle', 4, [
      swing('chest', 'z', [0, 2, 4], [0, 0.02, 0]),
      swing('head', 'y', [0, 2, 4], [0, 0.08, 0]),
      swing('upArmL', 'z', [0, 2, 4], [-0.06, -0.11, -0.06]),
      swing('upArmR', 'z', [0, 2, 4], [0.06, 0.11, 0.06]),
    ]);

    const walkTimes = [0, 0.25, 0.5, 0.75, 1];
    const walk = new THREE.AnimationClip('walk', 1, [
      swing('upLegL', 'x', walkTimes, [0.55, 0, -0.55, 0, 0.55]),
      swing('upLegR', 'x', walkTimes, [-0.55, 0, 0.55, 0, -0.55]),
      swing('lowLegL', 'x', walkTimes, [0.1, 0.45, 0.1, 0.02, 0.1]),
      swing('lowLegR', 'x', walkTimes, [0.1, 0.02, 0.1, 0.45, 0.1]),
      swing('upArmL', 'x', walkTimes, [-0.38, 0, 0.38, 0, -0.38]),
      swing('upArmR', 'x', walkTimes, [0.38, 0, -0.38, 0, 0.38]),
      swing('lowArmL', 'x', walkTimes, [-0.25, -0.35, -0.25, -0.15, -0.25]),
      swing('lowArmR', 'x', walkTimes, [-0.25, -0.15, -0.25, -0.35, -0.25]),
      swing('chest', 'y', [0, 0.5, 1], [0.07, -0.07, 0.07]),
      swing('hips', 'y', walkTimes, [0, 0.012, 0, -0.012, 0]),
    ]);

    const runTimes = [0, 0.175, 0.35];
    const run = new THREE.AnimationClip('run', 0.7, [
      swing('upLegL', 'x', [0, 0.175, 0.35, 0.525, 0.7], [0.95, 0, -0.95, 0, 0.95]),
      swing('upLegR', 'x', [0, 0.175, 0.35, 0.525, 0.7], [-0.95, 0, 0.95, 0, -0.95]),
      swing('lowLegL', 'x', [0, 0.175, 0.35, 0.525, 0.7], [0.3, 1.1, 0.3, 0.1, 0.3]),
      swing('lowLegR', 'x', [0, 0.175, 0.35, 0.525, 0.7], [0.3, 0.1, 0.3, 1.1, 0.3]),
      swing('upArmL', 'x', runTimes, [-0.85, 0, 0.85]),
      swing('upArmR', 'x', runTimes, [0.85, 0, -0.85]),
      swing('spine', 'x', [0, 0.35, 0.7], [0.16, 0.16, 0.16]),
      swing('hips', 'y', [0, 0.35, 0.7], [0.02, -0.02, 0.02]),
    ]);

    // Clip additive: si sommano alla base senza sovrascriverla.
    const jump = new THREE.AnimationClip('jump', 0.55, [
      track('hips.position[y]', [0, 0.25, 0.55], [0, 0.22, 0]),
      swing('upArmL', 'z', [0, 0.55], [0, 0.35]),
      swing('upArmR', 'z', [0, 0.55], [0, -0.35]),
    ]);

    const fall = new THREE.AnimationClip('fall', 0.9, [
      swing('upArmL', 'z', [0, 0.45, 0.9], [0.2, 0.3, 0.2]),
      swing('upArmR', 'z', [0, 0.45, 0.9], [-0.2, -0.3, -0.2]),
      swing('upLegL', 'x', [0, 0.45, 0.9], [0.12, 0.2, 0.12]),
      swing('upLegR', 'x', [0, 0.45, 0.9], [-0.12, -0.2, -0.12]),
    ]);

    return { idle, walk, run, jump, fall };
  }

  // -------------------------------------------------------------------------
  // sim
  // -------------------------------------------------------------------------
  spawn(x: number, z: number, yaw: number, heights: Heightfield): void {
    this.position.set(x, heights.heightAt(x, z), z);
    this.velocity.set(0, 0, 0);
    this.yaw = yaw;
    this.pitch = 0;
    this.grounded = true;
    this.walkPhase = 0;
    this.bob = 0;
    this.mixer?.setTime(0);
    this.syncMesh();
  }

  update(dt: number, input: MoveInput, heights: Heightfield, buildings: BuildingIndex, roads?: RoadIndex): void {
    const fx = -Math.sin(this.yaw);
    const fz = -Math.cos(this.yaw);
    const rx = Math.cos(this.yaw);
    const rz = -Math.sin(this.yaw);

    let dx = fx * input.forward + rx * input.strafe;
    let dz = fz * input.forward + rz * input.strafe;
    const len = Math.hypot(dx, dz);
    if (len > 1e-4) {
      dx /= len;
      dz /= len;
    }
    const speed = input.sprint ? GAME.runSpeed : GAME.walkSpeed;
    const accel = this.grounded ? 16 : 4;
    const k = 1 - Math.exp(-accel * dt);
    this.velocity.x += (dx * speed - this.velocity.x) * k;
    this.velocity.z += (dz * speed - this.velocity.z) * k;

    this.position.x += this.velocity.x * dt;
    this.position.z += this.velocity.z * dt;

    if (input.jump && this.grounded) {
      this.velocity.y = GAME.jumpSpeed;
      this.grounded = false;
    }

    const ground =
      heights.heightAt(this.position.x, this.position.z) +
      (roads ? roads.surfaceOffset(this.position.x, this.position.z) : 0);
    if (this.grounded) {
      // il marciapiede è 18 cm sopra l'asfalto: si sale con un passo, non con
      // un teletrasporto. Oltre mezzo metro (scarpata) si segue il terreno.
      const dy = ground - this.position.y;
      this.position.y = Math.abs(dy) < 0.5 ? this.position.y + dy * (1 - Math.exp(-18 * dt)) : ground;
    } else {
      this.velocity.y -= GAME.gravity * dt;
      this.position.y += this.velocity.y * dt;
      if (this.position.y <= ground) {
        this.position.y = ground;
        this.velocity.y = 0;
        this.grounded = true;
      }
    }

    const fixed = buildings.resolveCircle(this.position.x, this.position.z, RADIUS);
    if (fixed.hit) {
      this.position.x = fixed.x;
      this.position.z = fixed.z;
    }

    const horizontalSpeed = Math.hypot(this.velocity.x, this.velocity.z);
    this.updateAnimation(dt, horizontalSpeed);
    this.syncMesh();
  }

  private updateAnimation(dt: number, horizontalSpeed: number): void {
    this.walkPhase += dt * (2.4 + horizontalSpeed * 0.9);
    this.bob = this.grounded ? Math.abs(Math.sin(this.walkPhase)) * 0.022 * clamp(horizontalSpeed / GAME.runSpeed, 0, 1) : 0;

    if (this.body) {
      this.body.update(dt, horizontalSpeed);
      return;
    }

    const target: Locomotion =
      horizontalSpeed < 0.35 ? 'idle' : horizontalSpeed > GAME.walkSpeed + 0.7 ? 'run' : 'walk';
    const blend = 1 - Math.exp(-9 * dt);
    for (const key of ['idle', 'walk', 'run'] as const) {
      const action = this.actions[key];
      const want = key === target ? 1 : 0;
      const now = action.getEffectiveWeight();
      action.setEffectiveWeight(now + (want - now) * blend);
    }
    this.actions.walk.timeScale = clamp(horizontalSpeed / GAME.walkSpeed, 0.65, 1.6);
    this.actions.run.timeScale = clamp(horizontalSpeed / GAME.runSpeed, 0.8, 1.3);

    // clip additive sopra la camminata
    const rising = !this.grounded && this.velocity.y > 0.4;
    const falling = !this.grounded && this.velocity.y <= 0.4;
    this.jumpAction.setEffectiveWeight(rising ? 1 : 0);
    this.fallAction.setEffectiveWeight(falling ? 1 : 0);

    this.mixer.update(dt);
  }

  syncMesh(): void {
    this.avatar.position.set(this.position.x, this.position.y + this.bob, this.position.z);
    this.avatar.rotation.y = this.yaw;
  }

  eyePosition(out = new THREE.Vector3()): THREE.Vector3 {
    return out.set(this.position.x, this.position.y + Math.max(1.35, this.appearance.height * 0.93), this.position.z);
  }

  forward(out = new THREE.Vector3()): THREE.Vector3 {
    return out.set(-Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), -Math.cos(this.yaw) * Math.cos(this.pitch));
  }
}

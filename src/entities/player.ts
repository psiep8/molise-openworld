import * as THREE from 'three';
import { GAME } from '../config';
import type { Heightfield } from '../geo/elevation';
import type { BuildingIndex } from '../geo/osm';
import { clamp } from '../geo/geo';
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

  private rebuild(): void {
    this.mixer?.stopAllAction();
    this.disposeAvatar();
    this.avatar.clear();

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
    const top = new THREE.MeshPhysicalMaterial({
      color: colors.top,
      roughness: colors.roughness,
      metalness: colors.metalness,
      sheen: 0.7,
      sheenRoughness: 0.7,
      sheenColor: new THREE.Color(colors.top).lerp(new THREE.Color(0xffffff), 0.5),
      envMapIntensity: 0.5,
    });
    const bottom = new THREE.MeshPhysicalMaterial({
      color: colors.bottom,
      roughness: Math.min(1, colors.roughness + 0.1),
      sheen: 0.5,
      sheenRoughness: 0.8,
      sheenColor: new THREE.Color(colors.bottom).lerp(new THREE.Color(0xffffff), 0.4),
      envMapIntensity: 0.45,
    });
    const shoes = new THREE.MeshPhysicalMaterial({
      color: colors.shoes,
      roughness: 0.7,
      clearcoat: 0.35,
      clearcoatRoughness: 0.35,
      envMapIntensity: 0.6,
    });
    const skin = new THREE.MeshPhysicalMaterial({
      color: look.skin,
      roughness: 0.62,
      clearcoat: 0.08,
      clearcoatRoughness: 0.55,
      sheen: 0.25,
      sheenRoughness: 0.9,
      sheenColor: 0xffd9c0,
      envMapIntensity: 0.35,
    });
    const accent = new THREE.MeshPhysicalMaterial({ color: colors.accent, roughness: 0.55, sheen: 0.4, sheenRoughness: 0.6 });
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
        [0.19 * torsoRadius, 0.52],
        [0.115, 0.57],
        [0.02, 0.59],
      ]),
      top,
    );
    torso.scale.z = female ? 0.66 : 0.7;

    // deltoidi: coprono l'incastro braccio/spalla, che senza resta un cilindro
    // piantato nel fianco
    const deltoidRadius = female ? 0.07 : 0.082;

    if (colors.collar) {
      // camicia sotto la giacca: una striscia chiara sul petto
      addMesh(chest, new THREE.BoxGeometry(0.12, 0.26, 0.03), accent, 0, 0.16, -0.19);
      if (colors.tie) addMesh(chest, new THREE.BoxGeometry(0.045, 0.2, 0.02), bottom, 0, 0.14, -0.21);
    }

    const neck = makeBone('neck', 0, 0.3);
    chest.add(neck);
    addMesh(neck, new THREE.CylinderGeometry(0.052, 0.062, 0.11, LIMB_SEGMENTS), skin, 0, 0.02, 0);
    const head = makeBone('head', 0, 0.13);
    neck.add(head);

    // cranio ovale + mandibola: due volumi invece di una sfera sola, che a
    // distanza ravvicinata sembrava una palla da biliardo
    const skull = addMesh(head, new THREE.SphereGeometry(0.148, 20, 16), skin, 0, 0.104, 0.004);
    skull.scale.set(1, 1.12, 1.05);
    const jaw = addMesh(head, new THREE.SphereGeometry(0.125, 18, 14), skin, 0, 0.042, -0.012);
    jaw.scale.set(0.8, 0.6, 0.82);
    // orecchie appena accennate, altrimenti il profilo è un uovo
    for (const side of [-1, 1] as const) {
      const ear = addMesh(head, new THREE.SphereGeometry(0.03, 10, 8), skin, side * 0.128, 0.095, 0.008);
      ear.scale.set(0.5, 1, 0.85);
    }

    const eyes = new THREE.MeshStandardMaterial({ color: 0x1c1a18, roughness: 0.35 });
    const brows = new THREE.MeshStandardMaterial({ color: look.hairColor, roughness: 0.8 });
    const lips = new THREE.MeshStandardMaterial({ color: new THREE.Color(look.skin).multiplyScalar(0.82), roughness: 0.55 });
    for (const side of [-1, 1] as const) {
      addMesh(head, new THREE.SphereGeometry(0.017, 10, 8), eyes, side * 0.049, 0.118, -0.121);
      const brow = addMesh(head, new THREE.BoxGeometry(0.055, 0.012, 0.018), brows, side * 0.052, 0.142, -0.118);
      brow.rotation.z = side * -0.12;
    }
    const nose = addMesh(head, new THREE.SphereGeometry(0.023, 10, 8), skin, 0, 0.094, -0.13);
    nose.scale.set(0.75, 1.05, 1.25);
    addMesh(head, new THREE.BoxGeometry(0.06, 0.014, 0.024), lips, 0, 0.05, -0.118);

    this.buildHair(head, hair);
    if (look.sex === 'uomo' && look.beard) {
      const beard = addMesh(
        head,
        new THREE.SphereGeometry(0.125, 16, 10, 0, Math.PI * 2, Math.PI * 0.52, Math.PI * 0.42),
        hair,
        0,
        0.05,
        -0.006,
      );
      beard.scale.set(0.86, 0.9, 0.86);
    }
    this.buildHat(head, colors.hat, accent, bottom);

    // spalle più strette: con 0,255 la figura superava il mezzo metro di
    // larghezza e la testa sembrava piccola
    const shoulder = female ? 0.2 : 0.22;
    for (const side of [-1, 1] as const) {
      const tag = side < 0 ? 'L' : 'R';

      const upArm = makeBone(`upArm${tag}`, side * shoulder, 0.24);
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
      const hand = makeBone(`hand${tag}`, 0, -0.24);
      lowArm.add(hand);
      // palmo con dorso arrotondato e pollice: la sfera unica sembrava un guantone
      const palm = addMesh(hand, new THREE.SphereGeometry(0.045, 12, 10), skin, 0, -0.045, 0);
      palm.scale.set(0.85, 1.35, 0.6);
      const thumb = addMesh(hand, new THREE.CapsuleGeometry(0.013, 0.03, 2, 8), skin, side * 0.03, -0.03, -0.028);
      thumb.rotation.z = side * 0.7;

      const upLeg = makeBone(`upLeg${tag}`, side * 0.11, -0.04);
      hips.add(upLeg);
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
      addMesh(foot, new THREE.SphereGeometry(0.055, 12, 10), shoes, 0, -0.03, -0.075).scale.set(0.95, 0.75, 1);
    }

    return rig;
  }

  /** Capelli per stile: una calotta più eventuali ciocche, coda o chignon. */
  private buildHair(head: THREE.Bone, hair: THREE.Material): void {
    const style: HairStyle = this.appearance.hairStyle;
    if (style === 'raso') return;

    // Il cranio è un'ellisse: la calotta va scalata come lui e lasciata un filo
    // più larga, altrimenti il cuoio capelluto esce dai capelli (bordo seghettato).
    const cap = new THREE.Mesh(
      new THREE.SphereGeometry(0.153, 20, 14, 0, Math.PI * 2, 0, Math.PI * 0.58),
      hair,
    );
    cap.position.set(0, 0.104, 0.004);
    cap.scale.set(1.02, 1.14, 1.07);
    cap.castShadow = true;
    head.add(cap);

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
      const back = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.42, 0.1), hair);
      back.position.set(0, -0.02, 0.13);
      back.castShadow = true;
      head.add(back);
    } else if (style === 'chignon') {
      const bun = new THREE.Mesh(new THREE.SphereGeometry(0.075, 10, 8), hair);
      bun.position.set(0, 0.15, 0.13);
      bun.castShadow = true;
      head.add(bun);
    }
  }

  private buildHat(head: THREE.Bone, hat: string, accent: THREE.Material, dark: THREE.Material): void {
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
    this.mixer.setTime(0);
    this.syncMesh();
  }

  update(dt: number, input: MoveInput, heights: Heightfield, buildings: BuildingIndex): void {
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

    const ground = heights.heightAt(this.position.x, this.position.z);
    if (this.grounded) {
      this.position.y = ground;
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

    this.walkPhase += dt * (2.4 + horizontalSpeed * 0.9);
    this.bob = this.grounded ? Math.abs(Math.sin(this.walkPhase)) * 0.022 * clamp(horizontalSpeed / GAME.runSpeed, 0, 1) : 0;

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

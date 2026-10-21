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

    const hips = makeBone('hips', 0, 0.95);
    rig.add(hips);
    addMesh(hips, new THREE.BoxGeometry(female ? 0.37 : 0.35, 0.2, female ? 0.24 : 0.22), bottom);

    const spine = makeBone('spine', 0, 0.1);
    hips.add(spine);
    const chest = makeBone('chest', 0, 0.34);
    spine.add(chest);
    addMesh(chest, new THREE.CapsuleGeometry(female ? 0.185 : 0.21, 0.32, 3, 8), top, 0, 0.1, 0);

    if (colors.collar) {
      // camicia sotto la giacca: una striscia chiara sul petto
      addMesh(chest, new THREE.BoxGeometry(0.12, 0.26, 0.03), accent, 0, 0.16, -0.19);
      if (colors.tie) addMesh(chest, new THREE.BoxGeometry(0.045, 0.2, 0.02), bottom, 0, 0.14, -0.21);
    }

    const neck = makeBone('neck', 0, 0.3);
    chest.add(neck);
    addMesh(neck, new THREE.CylinderGeometry(0.06, 0.07, 0.08, 6), skin);
    const head = makeBone('head', 0, 0.13);
    neck.add(head);
    addMesh(head, new THREE.SphereGeometry(0.145, 14, 12), skin, 0, 0.1, 0);
    // occhi e naso: pochi poligoni ma il volto non resta liscio
    const eyes = new THREE.MeshStandardMaterial({ color: 0x1c1a18, roughness: 0.35 });
    for (const side of [-1, 1] as const) {
      addMesh(head, new THREE.SphereGeometry(0.019, 8, 6), eyes, side * 0.052, 0.118, -0.129);
    }
    addMesh(head, new THREE.SphereGeometry(0.022, 6, 5), skin, 0, 0.085, -0.141);
    this.buildHair(head, hair);
    if (look.sex === 'uomo' && look.beard) {
      addMesh(head, new THREE.BoxGeometry(0.17, 0.09, 0.07), hair, 0, 0.035, -0.11);
    }
    this.buildHat(head, colors.hat, accent, bottom);

    const shoulder = female ? 0.235 : 0.255;
    for (const side of [-1, 1] as const) {
      const tag = side < 0 ? 'L' : 'R';

      const upArm = makeBone(`upArm${tag}`, side * shoulder, 0.24);
      chest.add(upArm);
      addMesh(upArm, new THREE.CapsuleGeometry(female ? 0.055 : 0.062, 0.2, 2, 6), top, 0, -0.12, 0);
      const lowArm = makeBone(`lowArm${tag}`, 0, -0.28);
      upArm.add(lowArm);
      addMesh(lowArm, new THREE.CapsuleGeometry(female ? 0.05 : 0.055, 0.18, 2, 6), top, 0, -0.11, 0);
      const hand = makeBone(`hand${tag}`, 0, -0.24);
      lowArm.add(hand);
      addMesh(hand, new THREE.SphereGeometry(0.06, 8, 6), skin, 0, -0.03, 0);

      const upLeg = makeBone(`upLeg${tag}`, side * 0.11, -0.04);
      hips.add(upLeg);
      addMesh(upLeg, new THREE.CapsuleGeometry(female ? 0.082 : 0.088, 0.28, 2, 6), bottom, 0, -0.19, 0);
      const lowLeg = makeBone(`lowLeg${tag}`, 0, -0.4);
      upLeg.add(lowLeg);
      addMesh(lowLeg, new THREE.CapsuleGeometry(0.072, 0.26, 2, 6), bottom, 0, -0.18, 0);
      const foot = makeBone(`foot${tag}`, 0, -0.4);
      lowLeg.add(foot);
      addMesh(foot, new THREE.BoxGeometry(0.15, 0.09, 0.27), shoes, 0, -0.03, 0.06);
    }

    return rig;
  }

  /** Capelli per stile: una calotta più eventuali ciocche, coda o chignon. */
  private buildHair(head: THREE.Bone, hair: THREE.Material): void {
    const style: HairStyle = this.appearance.hairStyle;
    if (style === 'raso') return;

    const cap = new THREE.Mesh(
      new THREE.SphereGeometry(0.152, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.62),
      hair,
    );
    cap.position.set(0, 0.1, 0);
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

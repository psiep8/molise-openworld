import * as THREE from 'three';
import { GAME } from '../config';
import type { Heightfield } from '../geo/elevation';
import type { BuildingIndex } from '../geo/osm';
import { clamp } from '../geo/geo';

export interface MoveInput {
  forward: number;
  strafe: number;
  sprint: boolean;
  jump: boolean;
}

const RADIUS = 0.42;

/** Skeleton joints for a humanoid character. */
export interface SkeletonJoint {
  name: string;
  bone: THREE.Bone;
  children: SkeletonJoint[];
}

/** Human-readable animation clip names. */
export type AnimationName = 'idle' | 'walk' | 'run' | 'jump' | 'fall';

/** Additive animation mixing data. */
export interface AdditiveAction {
  clip: THREE.AnimationClip;
  weight: number;
  enabled: boolean;
}

export class Player {
  readonly position = new THREE.Vector3();
  readonly velocity = new THREE.Vector3();
  yaw = 0;
  pitch = 0;
  grounded = true;
  readonly avatar: THREE.Group;
  private mixer: THREE.AnimationMixer | null = null;
  private readonly clock = new THREE.Clock();
  private readonly actions = new Map<AnimationName, THREE.AnimationAction>();
  private readonly additiveActions = new Map<AnimationName, THREE.AnimationAction>();
  private currentAnimation: AnimationName = 'idle';
  private lastGrounded = true;

  constructor() {
    this.avatar = this.buildAvatar();
    this.initMixer(this.avatar);
  }

  private buildAvatar(): THREE.Group {
    const group = new THREE.Group();
    group.name = 'player-avatar';

    // Create a simple humanoid skeleton
    const skeletonRoot = new THREE.Group();
    skeletonRoot.name = 'skeleton';
    group.add(skeletonRoot);

    // Hip bone
    const hip = new THREE.Bone();
    hip.name = 'hip';
    hip.position.set(0, 0, 0);
    skeletonRoot.add(hip);

    // Left Upper Leg
    const leftUpperLeg = new THREE.Bone();
    leftUpperLeg.name = 'leftUpperLeg';
    leftUpperLeg.position.set(-0.12, -0.5, 0);
    hip.add(leftUpperLeg);
    const leftLowerLeg = new THREE.Bone();
    leftLowerLeg.name = 'leftLowerLeg';
    leftLowerLeg.position.set(0, -0.4, 0);
    leftUpperLeg.add(leftLowerLeg);
    const leftFoot = new THREE.Bone();
    leftFoot.name = 'leftFoot';
    leftFoot.position.set(0, -0.3, 0);
    leftLowerLeg.add(leftFoot);

    // Right Upper Leg
    const rightUpperLeg = new THREE.Bone();
    rightUpperLeg.name = 'rightUpperLeg';
    rightUpperLeg.position.set(0.12, -0.5, 0);
    hip.add(rightUpperLeg);
    const rightLowerLeg = new THREE.Bone();
    rightLowerLeg.name = 'rightLowerLeg';
    rightLowerLeg.position.set(0, -0.4, 0);
    rightUpperLeg.add(rightLowerLeg);
    const rightFoot = new THREE.Bone();
    rightFoot.name = 'rightFoot';
    rightFoot.position.set(0, -0.3, 0);
    rightLowerLeg.add(rightFoot);

    // Spine
    const spine = new THREE.Bone();
    spine.name = 'spine';
    spine.position.set(0, 0.2, 0);
    hip.add(spine);
    const spine2 = new THREE.Bone();
    spine2.name = 'spine2';
    spine2.position.set(0, 0.4, 0);
    spine.add(spine2);

    // Chest
    const chest = new THREE.Bone();
    chest.name = 'chest';
    chest.position.set(0, 0.6, 0);
    spine.add(chest);

    // Neck
    const neck = new THREE.Bone();
    neck.name = 'neck';
    neck.position.set(0, 0.8, 0);
    chest.add(neck);
    const head = new THREE.Bone();
    head.name = 'head';
    head.position.set(0, 0.2, 0);
    neck.add(head);

    // Left Upper Arm
    const leftUpperArm = new THREE.Bone();
    leftUpperArm.name = 'leftUpperArm';
    leftUpperArm.position.set(-0.3, 0.7, 0);
    chest.add(leftUpperArm);
    const leftLowerArm = new THREE.Bone();
    leftLowerArm.name = 'leftLowerArm';
    leftLowerArm.position.set(0, -0.3, 0);
    leftUpperArm.add(leftLowerArm);
    const leftHand = new THREE.Bone();
    leftHand.name = 'leftHand';
    leftHand.position.set(0, -0.2, 0);
    leftLowerArm.add(leftHand);

    // Right Upper Arm
    const rightUpperArm = new THREE.Bone();
    rightUpperArm.name = 'rightUpperArm';
    rightUpperArm.position.set(0.3, 0.7, 0);
    chest.add(rightUpperArm);
    const rightLowerArm = new THREE.Bone();
    rightLowerArm.name = 'rightLowerArm';
    rightLowerArm.position.set(0, -0.3, 0);
    rightUpperArm.add(rightLowerArm);
    const rightHand = new THREE.Bone();
    rightHand.name = 'rightHand';
    rightHand.position.set(0, -0.2, 0);
    rightLowerArm.add(rightHand);

    // Setup bone hierarchy for AnimationMixer
    (skeletonRoot as any).computeBonePoses();

    // Add visual meshes over the skeleton
    const jacket = new THREE.MeshStandardMaterial({ color: 0x2f5d7c, roughness: 0.9 });
    const trousers = new THREE.MeshStandardMaterial({ color: 0x394150, roughness: 1 });
    const skin = new THREE.MeshStandardMaterial({ color: 0xd7a07c, roughness: 0.85 });
    const shoes = new THREE.MeshStandardMaterial({ color: 0x3b2f27, roughness: 1 });

    // Torso
    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.24, 0.52, 3, 8), jacket);
    torso.position.y = 1.12;
    torso.add(new THREE.Bone()); // bind to skeleton
    skeletonRoot.add(torso);

    // Head
    const headMesh = new THREE.Mesh(new THREE.SphereGeometry(0.19, 12, 10), skin);
    headMesh.position.y = 1.66;
    head.add(headMesh);

    // Hips
    const hips = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.18, 0.24), trousers);
    hips.position.y = 0.82;
    hip.add(hips);

    for (const side of [-1, 1]) {
      // Legs
      const leg = new THREE.Group();
      leg.position.set(side * 0.12, 0.82, 0);
      const shin = new THREE.Mesh(new THREE.CapsuleGeometry(0.085, 0.5, 2, 6), trousers);
      shin.position.y = -0.32;
      leg.add(shin);
      const foot = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.1, 0.3), shoes);
      foot.position.set(0, -0.62, -0.06);
      leg.add(foot);
      skeletonRoot.add(leg);

      // Arms
      const arm = new THREE.Group();
      arm.position.set(side * 0.31, 1.36, 0);
      const forearm = new THREE.Mesh(new THREE.CapsuleGeometry(0.06, 0.46, 2, 6), jacket);
      forearm.position.y = -0.26;
      arm.add(forearm);
      skeletonRoot.add(arm);
    }

    // Store skeleton root for pose updates
    ;

    return group;
  }

  spawn(x: number, z: number, yaw: number, heights: Heightfield): void {
    this.position.set(x, heights.heightAt(x, z), z);
    this.velocity.set(0, 0, 0);
    this.yaw = yaw;
    this.pitch = 0;
    this.grounded = true;
    this.lastGrounded = true;
    this.syncMesh();
  }

  /** Initialize the animation mixer with a skeleton. */
  initMixer(avatar: THREE.Group): THREE.AnimationMixer {
    this.mixer = new THREE.AnimationMixer(avatar);
    this.clock = new THREE.Clock();
    // Add idle action (no movement)
    const idleClip = new THREE.AnimationClip('idle', -1, [
      new THREE.KeyframeTrack('hip.position.y', [0, 1], [0, 0, 0]),
      new THREE.KeyframeTrack('hip.rotation.x', [0, 1], [0, Math.PI / 180 * 5]),
    ]);
    const idleAction = this.mixer!.clipAction(idleClip);
    idleAction.setWeight(1);
    idleAction.play();
    this.actions.set('idle', idleAction);

    // Add walk action
    const walkClip = new THREE.AnimationClip('walk', -1, [
      new THREE.KeyframeTrack('hip.position.x', [0, 1], [0, 0.1]),
      new THREE.KeyframeTrack('hip.position.z', [0, 1], [0, -0.1]),
      new THREE.KeyframeTrack('leftUpperLeg.rotation.x', [0, 1], [0, -Math.PI / 2]),
      new THREE.KeyframeTrack('rightUpperLeg.rotation.x', [0, 1], [0, Math.PI / 2]),
      new THREE.KeyframeTrack('leftLowerArm.rotation.x', [0, 1], [0, Math.PI / 4]),
      new THREE.KeyframeTrack('rightLowerArm.rotation.x', [0, 1], [0, -Math.PI / 4]),
    ]);
    const walkAction = this.mixer!.clipAction(walkClip);
    walkAction.setEffectiveWeight(1);
    walkAction.setLoop(THREE.LoopRepeat);
    walkAction.play();
    this.actions.set('walk', walkAction);

    // Additive jump action (added on top of walk)
    const jumpClip = new THREE.AnimationClip('jump', -1, [
      new THREE.KeyframeTrack('hip.position.y', [0, 0.5, 1], [0, 2, 0]),
      new THREE.KeyframeTrack('hip.rotation.x', [0, 0.5, 1], [0, -Math.PI / 10, 0]),
    ]);
    const jumpAction = this.mixer!.clipAction(jumpClip);
    jumpAction.setEffectiveWeight(0); // Start disabled, enabled when jumping
    jumpAction.setLoop(THREE.LoopOnce);
    jumpAction.clampWhenFinished = true;
    this.additiveActions.set('jump', jumpAction);

    // Additive fall action
    const fallClip = new THREE.AnimationClip('fall', -1, [
      new THREE.KeyframeTrack('hip.position.y', [0, 1], [0, -1]),
      new THREE.KeyframeTrack('spine.rotation.z', [0, 1], [0, -Math.PI / 8]),
    ]);
    const fallAction = this.mixer!.clipAction(fallClip);
    fallAction.setEffectiveWeight(0); // Start disabled
    fallAction.setLoop(THREE.LoopRepeat);
    this.additiveActions.set('fall', fallAction);

    // Additive run action (faster walk)
    const runClip = new THREE.AnimationClip('run', -1, [
      new THREE.KeyframeTrack('hip.position.x', [0, 1], [0, 0.2]),
      new THREE.KeyframeTrack('hip.position.z', [0, 1], [0, -0.2]),
      new THREE.KeyframeTrack('leftUpperLeg.rotation.x', [0, 1], [0, -Math.PI]),
      new THREE.KeyframeTrack('rightUpperLeg.rotation.x', [0, 1], [0, Math.PI]),
    ]);
    const runAction = this.mixer!.clipAction(runClip);
    runAction.setEffectiveWeight(0); // Start disabled
    runAction.setLoop(THREE.LoopRepeat);
    this.actions.set('run', runAction);

    this.mixer!.getRootAction().setEffectiveWeight(1);
    this.mixer!.time = 0;
    return this.mixer!;
  }

  /** Update animation mixer and skeleton poses. */
  updateMixer(dt: number, input: MoveInput, heights: Heightfield, buildings: BuildingIndex): void {
    if (!this.mixer) return;

    this.mixer.update(dt);

    // Handle additive blending
    const wasGrounded = this.lastGrounded;
    this.lastGrounded = this.grounded;

    // Switch between walk/run based on sprint
    const speed = input.sprint ? GAME.runSpeed : GAME.walkSpeed;
    const horizontalSpeed = Math.hypot(this.velocity.x, this.velocity.z);

    if (horizontalSpeed > 0.5) {
      // Fast movement - switch to run or additive run
      if (input.sprint && this.currentAnimation !== 'run') {
        this.transitionTo('run');
      }
      // Enable additive jump if jumping
      if (input.jump && !wasGrounded) {
        this.additiveActions.get('jump')?.setEffectiveWeight(1);
      }
    } else {
      // Walking speed - ensure walk action is active
      this.transitionTo('walk');
      // Disable jump additive when grounded
      this.additiveActions.get('jump')?.setEffectiveWeight(0);
    }

    // Update walk/Run bone offsets for additive blending
    this.updateWalkAnimation(dt, horizontalSpeed);
  }

  private transitionTo(newAnim: AnimationName): void {
    // Disable current action
    for (const [name, action] of this.actions) {
      action.setEffectiveWeight(name === newAnim ? 1 : 0);
    }
    this.currentAnimation = newAnim;
  }

  private updateWalkAnimation(dt: number, horizontalSpeed: number): void {
    // Update the walk animation based on speed
    const walkAction = this.actions.get('walk');
    if (walkAction) {
      walkAction.setTimeScale(Math.max(0.5, horizontalSpeed / GAME.walkSpeed));
    }

    // Update additive jump if active
    const jumpAction = this.additiveActions.get('jump');
    if (jumpAction && jumpAction.getEffectiveWeight() > 0) {
      jumpAction.play();
    }

    // Update additive fall if active
    const fallAction = this.additiveActions.get('fall');
    if (fallAction && fallAction.getEffectiveWeight() > 0) {
      fallAction.play();
    }
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

    const prevX = this.position.x;
    const prevZ = this.position.z;
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

    const moved = Math.hypot(this.position.x - prevX, this.position.z - prevZ);
    this.animate(dt, moved / Math.max(dt, 1e-3));
    this.updateMixer(dt, input, heights, buildings);
    this.syncMesh();
  }

  private animate(dt: number, horizontalSpeed: number): void {
    const target = clamp(horizontalSpeed / GAME.runSpeed, 0, 1);
    const stride = this.grounded ? target : 0.2;
    this.walkPhase += dt * (4 + horizontalSpeed * 1.1);
    const swing = Math.sin(this.walkPhase) * 0.62 * stride;
    this.legs[0].rotation.x = swing;
    this.legs[1].rotation.x = -swing;
    this.arms[0].rotation.x = -swing * 0.7;
    this.arms[1].rotation.x = swing * 0.7;
    this.bob = this.grounded ? Math.abs(Math.sin(this.walkPhase)) * 0.035 * stride : 0;
  }

  syncMesh(): void {
    this.avatar.position.set(this.position.x, this.position.y + this.bob, this.position.z);
    this.avatar.rotation.y = this.yaw;
  }

  eyePosition(out = new THREE.Vector3()): THREE.Vector3 {
    return out.set(this.position.x, this.position.y + GAME.eyeHeight, this.position.z);
  }

  forward(out = new THREE.Vector3()): THREE.Vector3 {
    return out.set(-Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), -Math.cos(this.yaw) * Math.cos(this.pitch));
  }
}

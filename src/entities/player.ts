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

export class Player {
  readonly position = new THREE.Vector3();
  readonly velocity = new THREE.Vector3();
  yaw = 0;
  pitch = 0;
  grounded = true;
  readonly avatar: THREE.Group;

  private walkPhase = 0;
  private bob = 0;
  private legs: THREE.Object3D[] = [];
  private arms: THREE.Object3D[] = [];

  constructor() {
    this.avatar = this.buildAvatar();
  }

  private buildAvatar(): THREE.Group {
    const group = new THREE.Group();
    group.name = 'player-avatar';
    const jacket = new THREE.MeshStandardMaterial({ color: 0x2f5d7c, roughness: 0.9 });
    const trousers = new THREE.MeshStandardMaterial({ color: 0x394150, roughness: 1 });
    const skin = new THREE.MeshStandardMaterial({ color: 0xd7a07c, roughness: 0.85 });
    const shoes = new THREE.MeshStandardMaterial({ color: 0x3b2f27, roughness: 1 });

    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.24, 0.52, 3, 8), jacket);
    torso.position.y = 1.12;
    torso.castShadow = true;
    group.add(torso);

    const head = new THREE.Mesh(new THREE.SphereGeometry(0.19, 12, 10), skin);
    head.position.y = 1.66;
    head.castShadow = true;
    group.add(head);

    const hips = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.18, 0.24), trousers);
    hips.position.y = 0.82;
    group.add(hips);

    for (const side of [-1, 1]) {
      const leg = new THREE.Group();
      leg.position.set(side * 0.12, 0.82, 0);
      const shin = new THREE.Mesh(new THREE.CapsuleGeometry(0.085, 0.5, 2, 6), trousers);
      shin.position.y = -0.32;
      shin.castShadow = true;
      leg.add(shin);
      const foot = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.1, 0.3), shoes);
      foot.position.set(0, -0.62, -0.06);
      leg.add(foot);
      group.add(leg);
      this.legs.push(leg);

      const arm = new THREE.Group();
      arm.position.set(side * 0.31, 1.36, 0);
      const forearm = new THREE.Mesh(new THREE.CapsuleGeometry(0.06, 0.46, 2, 6), jacket);
      forearm.position.y = -0.26;
      forearm.castShadow = true;
      arm.add(forearm);
      group.add(arm);
      this.arms.push(arm);
    }

    return group;
  }

  spawn(x: number, z: number, yaw: number, heights: Heightfield): void {
    this.position.set(x, heights.heightAt(x, z), z);
    this.velocity.set(0, 0, 0);
    this.yaw = yaw;
    this.pitch = 0;
    this.grounded = true;
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

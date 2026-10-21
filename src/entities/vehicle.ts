import * as THREE from 'three';
import { CAR, createCarState, speedKmh, stepCar, type CarInput, type CarState } from '../sim/car';
import type { Heightfield } from '../geo/elevation';
import type { BuildingIndex, RoadIndex } from '../geo/osm';
import { clamp } from '../geo/geo';
import { WORLD } from '../config';

const WHEEL_RADIUS = 0.34;
const HALF_TRACK = 0.84;
const HALF_LENGTH = 1.22;

export class Vehicle {
  state: CarState = createCarState(0, 0, 0);
  readonly group: THREE.Group;
  private readonly bodyGroup: THREE.Group;
  private readonly wheels: THREE.Object3D[] = [];
  private readonly frontPivots: THREE.Object3D[] = [];
  private tiltPitch = 0;
  private tiltRoll = 0;
  private wheelSpin = 0;

  constructor() {
    this.group = new THREE.Group();
    this.group.name = 'vehicle';
    this.group.rotation.order = 'YXZ';
    this.bodyGroup = new THREE.Group();
    this.group.add(this.bodyGroup);
    this.build();
  }

  private build(): void {
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0xa6332c, roughness: 0.55, metalness: 0.15, clearcoat: 1.0, clearcoatRoughness: 0.05 });
    const darkMat = new THREE.MeshStandardMaterial({ color: 0x24272a, roughness: 0.8, metalness: 0.2, clearcoat: 0.8, clearcoatRoughness: 0.1 });
    const glassMat = new THREE.MeshStandardMaterial({ color: 0x223442, roughness: 0.15, metalness: 0.5, transmission: 1.0 });
    const lightMat = new THREE.MeshStandardMaterial({
      color: 0xfff3d0,
      emissive: 0xffe6a8,
      emissiveIntensity: 0.7,
      roughness: 0.4,
      clearcoat: 0.3,
      clearcoatRoughness: 0.5,
    });
    const tailMat = new THREE.MeshStandardMaterial({
      color: 0x8f1f1a,
      emissive: 0x5a0d0a,
      emissiveIntensity: 0.4,
      roughness: 0.5,
      clearcoat: 0.5,
      clearcoatRoughness: 0.3,
    });

    const add = (mesh: THREE.Mesh, x: number, y: number, z: number): THREE.Mesh => {
      mesh.position.set(x, y, z);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.bodyGroup.add(mesh);
      return mesh;
    };

    add(new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.58, 3.56), bodyMat), 0, 0.72, 0);
    add(new THREE.Mesh(new THREE.BoxGeometry(1.62, 0.16, 0.9), bodyMat), 0, 1.02, -1.2);
    add(new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.56, 1.86), glassMat), 0, 1.26, 0.12);
    add(new THREE.Mesh(new THREE.BoxGeometry(1.58, 0.08, 1.98), bodyMat), 0, 1.54, 0.12);
    add(new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.2, 0.22), darkMat), 0, 0.56, -1.8);
    add(new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.2, 0.22), darkMat), 0, 0.56, 1.8);

    for (const side of [-1, 1]) {
      const head = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.18, 0.06), lightMat);
      add(head, side * 0.56, 0.86, -1.79);
      const tail = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.2, 0.06), tailMat);
      add(tail, side * 0.62, 0.86, 1.79);
    }

    // portapacchi sul tetto, molto Panda 4x4
    add(new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.06, 0.06), darkMat), 0, 1.62, -0.72);
    add(new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.06, 0.06), darkMat), 0, 1.62, 0.72);
    for (const side of [-1, 1]) {
      add(new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 1.5), darkMat), side * 0.7, 1.62, 0);
    }

    const wheelGeo = new THREE.CylinderGeometry(WHEEL_RADIUS, WHEEL_RADIUS, 0.24, 14);
    wheelGeo.rotateZ(Math.PI / 2);
    const hubGeo = new THREE.CylinderGeometry(WHEEL_RADIUS * 0.45, WHEEL_RADIUS * 0.45, 0.26, 10);
    hubGeo.rotateZ(Math.PI / 2);
    const wheelMat = new THREE.MeshStandardMaterial({ color: 0x17191b, roughness: 0.95, metalness: 0.1, clearcoat: 0.3, clearcoatRoughness: 0.05 });
    const hubMat = new THREE.MeshStandardMaterial({ color: 0x9aa0a4, roughness: 0.4, metalness: 0.7, clearcoat: 0.5, clearcoatRoughness: 0.2 });

    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const pivot = new THREE.Group();
        pivot.position.set(sx * HALF_TRACK, WHEEL_RADIUS, sz * HALF_LENGTH);
        const wheel = new THREE.Mesh(wheelGeo, wheelMat);
        wheel.castShadow = true;
        wheel.add(new THREE.Mesh(hubGeo, hubMat));
        pivot.add(wheel);
        this.group.add(pivot);
        this.wheels.push(wheel);
        if (sz < 0) this.frontPivots.push(pivot);
      }
    }
  }

  get kmh(): number {
    return Math.round(speedKmh(this.state.speed));
  }

  get position(): THREE.Vector3 {
    return this.group.position;
  }

  get yaw(): number {
    return this.state.yaw;
  }

  reset(x: number, z: number, yaw: number, heights: Heightfield): void {
    this.state = createCarState(x, z, yaw);
    const y = heights.heightAt(x, z);
    this.group.position.set(x, y, z);
    this.group.rotation.set(0, yaw, 0);
    this.tiltPitch = 0;
    this.tiltRoll = 0;
  }

  update(dt: number, input: CarInput, heights: Heightfield, roads: RoadIndex, buildings: BuildingIndex): void {
    const onRoad = roads.isOnRoad(this.state.x, this.state.z, 0.4);
    const next = stepCar(
      this.state,
      input,
      { onRoad, groundHeight: (x, z) => heights.heightAt(x, z) },
      dt,
    );

    const clampX = WORLD.halfWidth - 24;
    const clampZ = WORLD.halfHeight - 24;
    next.x = clamp(next.x, -clampX, clampX);
    next.z = clamp(next.z, -clampZ, clampZ);

    // raggio un po' più stretto della carrozzeria: negli alley di paese
    // altrimenti l'auto resta incastrata tra due muri
    const fixed = buildings.resolveCircle(next.x, next.z, 1.05);
    if (fixed.hit) {
      next.x = fixed.x;
      next.z = fixed.z;
      next.speed *= 0.5;
    }

    this.state = next;

    // --- assetto sul terreno (4 punti di contatto) --------------------------
    const fx = -Math.sin(next.yaw);
    const fz = -Math.cos(next.yaw);
    const rx = Math.cos(next.yaw);
    const rz = -Math.sin(next.yaw);
    const hFront = heights.heightAt(next.x + fx * HALF_LENGTH, next.z + fz * HALF_LENGTH);
    const hBack = heights.heightAt(next.x - fx * HALF_LENGTH, next.z - fz * HALF_LENGTH);
    const hRight = heights.heightAt(next.x + rx * HALF_TRACK, next.z + rz * HALF_TRACK);
    const hLeft = heights.heightAt(next.x - rx * HALF_TRACK, next.z - rz * HALF_TRACK);

    const groundY = (hFront + hBack + hRight + hLeft) / 4;
    const targetPitch = Math.atan2(hFront - hBack, HALF_LENGTH * 2);
    const targetRoll = Math.atan2(hRight - hLeft, HALF_TRACK * 2);
    const k = 1 - Math.exp(-10 * dt);
    this.tiltPitch += (targetPitch - this.tiltPitch) * k;
    this.tiltRoll += (targetRoll - this.tiltRoll) * k;

    this.group.position.set(next.x, groundY, next.z);
    this.group.rotation.set(this.tiltPitch, next.yaw, this.tiltRoll);

    // ruote: rotolamento + sterzo
    const steerAngle = next.steer * CAR.maxSteer * 0.95;
    for (const pivot of this.frontPivots) pivot.rotation.y = steerAngle;
    this.wheelSpin += (next.speed / WHEEL_RADIUS) * dt;
    for (const wheel of this.wheels) wheel.rotation.x = this.wheelSpin;
  }
}

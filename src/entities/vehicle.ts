import * as THREE from 'three';
import { createCarState, speedKmh, stepCar, type CarInput, type CarState } from '../sim/car';
import { VEHICLES, getVehicle, loadPaintFor, tuningFor, type VehicleSpec } from '../sim/vehicle-catalog';
import type { Heightfield } from '../geo/elevation';
import type { BuildingIndex, RoadIndex } from '../geo/osm';
import { clamp } from '../geo/geo';
import { WORLD } from '../config';

/**
 * Veicolo giocabile.
 *
 * Lo stato fisico resta quello di `stepCar`; qui c'è solo il modello grafico,
 * ricostruito dai parametri del catalogo (dimensioni, passo, carreggiata,
 * raggio ruota, stile della carrozzeria). Cambiare veicolo non tocca la
 * simulazione: cambiano solo ingombri, assetto e parametri di guida.
 */
export class Vehicle {
  state: CarState = createCarState(0, 0, 0);
  readonly group: THREE.Group;
  spec: VehicleSpec = VEHICLES[0];

  private readonly bodyGroup: THREE.Group;
  private readonly wheels: THREE.Object3D[] = [];
  private readonly frontPivots: THREE.Object3D[] = [];
  private readonly headlights: THREE.SpotLight[] = [];
  private readonly geometries = new Set<THREE.BufferGeometry>();
  private readonly materials = new Set<THREE.Material>();
  private lampMat = new THREE.MeshStandardMaterial();
  private tailMat = new THREE.MeshStandardMaterial();
  private paintMat: THREE.MeshPhysicalMaterial | null = null;
  private tiltPitch = 0;
  private tiltRoll = 0;
  private wheelSpin = 0;

  constructor(spec: VehicleSpec = VEHICLES[0]) {
    this.group = new THREE.Group();
    this.group.name = 'vehicle';
    this.group.rotation.order = 'YXZ';
    this.bodyGroup = new THREE.Group();
    this.group.add(this.bodyGroup);
    this.spec = spec;
    this.build();
  }

  /** Cambia modello a runtime (garage / selezione). */
  setSpec(spec: VehicleSpec): void {
    if (spec.id === this.spec.id) return;
    this.spec = spec;
    this.clear();
    this.build();
  }

  private clear(): void {
    for (const geometry of this.geometries) geometry.dispose();
    for (const material of this.materials) material.dispose();
    this.geometries.clear();
    this.materials.clear();
    this.wheels.length = 0;
    this.frontPivots.length = 0;
    this.headlights.length = 0;
    this.bodyGroup.clear();
    for (const child of [...this.group.children]) {
      if (child !== this.bodyGroup) this.group.remove(child);
    }
  }

  private track<T extends THREE.BufferGeometry>(geometry: T): T {
    this.geometries.add(geometry);
    return geometry;
  }

  private mesh(
    parent: THREE.Object3D,
    geometry: THREE.BufferGeometry,
    material: THREE.Material,
    x: number,
    y: number,
    z: number,
    castShadow = true,
  ): THREE.Mesh {
    this.track(geometry);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(x, y, z);
    mesh.castShadow = castShadow;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  }

  private material(params: THREE.MeshPhysicalMaterialParameters): THREE.MeshPhysicalMaterial {
    const material = new THREE.MeshPhysicalMaterial(params);
    this.materials.add(material);
    return material;
  }

  private build(): void {
    const spec = this.spec;
    const halfLength = spec.length / 2;
    const halfWidth = spec.width / 2;
    const ride = spec.style === 'suv' ? 0.5 : spec.style === 'crossover' ? 0.46 : 0.4;
    const bodyY = ride + spec.height * 0.22;

    const paint = this.material({
      color: loadPaintFor(spec.id, spec.paint),
      roughness: 0.42,
      metalness: 0.25,
      clearcoat: 1,
      clearcoatRoughness: 0.06,
    });
    this.paintMat = paint;
    const trim = this.material({ color: spec.accent, roughness: 0.82, metalness: 0.1, clearcoat: 0.4, clearcoatRoughness: 0.25 });
    // Vetro: trasparenza classica (la `transmission` fisica costa un pass extra
    // di scena e senza environment map risulta sporca).
    const glass = this.material({ color: 0x22323d, roughness: 0.08, metalness: 0.55, transparent: true, opacity: 0.78 });
    const lamp = this.material({
      color: 0xfff3d0,
      emissive: 0xffe6a8,
      emissiveIntensity: 0.6,
      roughness: 0.35,
      clearcoat: 0.4,
      clearcoatRoughness: 0.3,
    });
    const tail = this.material({
      color: 0x8f1f1a,
      emissive: 0x5a0d0a,
      emissiveIntensity: 0.35,
      roughness: 0.45,
      clearcoat: 0.5,
      clearcoatRoughness: 0.2,
    });
    this.lampMat = lamp;
    this.tailMat = tail;

    // scocca
    this.mesh(this.bodyGroup, new THREE.BoxGeometry(spec.width * 0.98, spec.height * 0.24, spec.length * 0.98), paint, 0, bodyY, 0);
    this.mesh(this.bodyGroup, new THREE.BoxGeometry(spec.width, spec.height * 0.16, spec.length * 0.96), trim, 0, bodyY - spec.height * 0.17, 0);

    // abitacolo
    const cabinLength = spec.length * (spec.roof === 'boxy' ? 0.58 : 0.5);
    const cabinHeight = spec.height * (spec.roof === 'boxy' ? 0.4 : 0.34);
    const cabinZ = spec.style === 'trike' ? 0.12 : 0.06;
    const cabin = this.mesh(
      this.bodyGroup,
      new THREE.BoxGeometry(spec.width * 0.9, cabinHeight, cabinLength),
      glass,
      wheelbaseOffset(spec) * 0.12,
      bodyY + spec.height * 0.2,
      cabinZ,
      false,
    );
    if (spec.roof === 'sloped') cabin.rotation.x = -0.06;

    // tetto
    this.mesh(
      this.bodyGroup,
      new THREE.BoxGeometry(spec.width * 0.84, 0.07, cabinLength * 0.96),
      paint,
      cabin.position.x,
      bodyY + spec.height * 0.2 + cabinHeight / 2,
      cabinZ,
    );

    // paraurti e minigonne
    this.mesh(this.bodyGroup, new THREE.BoxGeometry(spec.width * 1.01, spec.height * 0.13, 0.18), trim, 0, bodyY - spec.height * 0.09, -halfLength + 0.05);
    this.mesh(this.bodyGroup, new THREE.BoxGeometry(spec.width * 1.01, spec.height * 0.13, 0.18), trim, 0, bodyY - spec.height * 0.09, halfLength - 0.05);

    // fari e fanali
    for (const side of [-1, 1]) {
      this.mesh(this.bodyGroup, new THREE.BoxGeometry(0.3, 0.14, 0.05), lamp, side * halfWidth * 0.62, bodyY + 0.06, -halfLength + 0.03, false);
      this.mesh(this.bodyGroup, new THREE.BoxGeometry(0.24, 0.16, 0.05), tail, side * halfWidth * 0.66, bodyY + 0.05, halfLength - 0.03, false);
    }

    // dettagli di carrozzeria
    if (spec.style === 'suv' || spec.style === 'crossover') {
      // barre sul tetto
      const roofY = bodyY + spec.height * 0.2 + cabinHeight / 2 + 0.09;
      for (const side of [-1, 1]) {
        this.mesh(this.bodyGroup, new THREE.BoxGeometry(0.05, 0.05, cabinLength * 0.8), trim, side * spec.width * 0.3, roofY, cabinZ);
      }
    }
    if (spec.style === 'trike') {
      // muso stretto: due carenature anteriori
      this.mesh(this.bodyGroup, new THREE.BoxGeometry(0.5, 0.3, 0.5), paint, 0, bodyY - 0.05, -halfLength + 0.25);
    }

    // ruote
    const wheelGeo = new THREE.CylinderGeometry(spec.wheelRadius, spec.wheelRadius, 0.22, 16);
    wheelGeo.rotateZ(Math.PI / 2);
    const hubGeo = new THREE.CylinderGeometry(spec.wheelRadius * 0.48, spec.wheelRadius * 0.48, 0.24, 12);
    hubGeo.rotateZ(Math.PI / 2);
    const rubber = this.material({ color: 0x141618, roughness: 0.96, metalness: 0.05, clearcoat: 0.2, clearcoatRoughness: 0.4 });
    const hub = this.material({ color: 0x9aa0a4, roughness: 0.35, metalness: 0.75, clearcoat: 0.6, clearcoatRoughness: 0.15 });

    const frontZ = -spec.wheelbase / 2;
    const rearZ = spec.wheelbase / 2;
    const frontX = spec.wheelLayout === 'three' ? [0] : [-1, 1];
    for (const side of frontX) {
      this.wheel(wheelGeo, hubGeo, rubber, hub, side * spec.track * 0.5, spec.wheelRadius, frontZ, true);
    }
    for (const side of [-1, 1]) {
      this.wheel(wheelGeo, hubGeo, rubber, hub, side * spec.track * 0.5, spec.wheelRadius, rearZ, false);
    }

    // fari veri (due spot, niente ombre)
    for (const side of [-1, 1]) {
      const beam = new THREE.SpotLight(0xfff0cf, 0, 55, Math.PI / 7, 0.55, 1.2);
      beam.position.set(side * halfWidth * 0.62, bodyY + 0.06, -halfLength + 0.05);
      beam.castShadow = false;
      this.group.add(beam);
      beam.target.position.set(side * halfWidth, -0.4, -18);
      this.group.add(beam.target);
      this.headlights.push(beam);
    }
  }

  private wheel(
    wheelGeo: THREE.BufferGeometry,
    hubGeo: THREE.BufferGeometry,
    rubber: THREE.Material,
    hub: THREE.Material,
    x: number,
    y: number,
    z: number,
    steerable: boolean,
  ): void {
    const pivot = new THREE.Group();
    pivot.position.set(x, y, z);
    const wheel = new THREE.Mesh(this.track(wheelGeo), rubber);
    wheel.castShadow = true;
    wheel.add(new THREE.Mesh(this.track(hubGeo), hub));
    pivot.add(wheel);
    this.group.add(pivot);
    this.wheels.push(wheel);
    if (steerable) this.frontPivots.push(pivot);
  }

  /** Cambia la tinta della carrozzeria senza ricostruire il modello. */
  setPaint(color: number): void {
    if (!this.paintMat) return;
    this.paintMat.color.setHex(color);
    this.paintMat.needsUpdate = true;
  }

  get kmh(): number {
    return Math.round(speedKmh(this.state.speed));
  }

  /** Marcia inserita: -1 retromarcia. */
  get gear(): number {
    return this.state.gear;
  }

  get rpm(): number {
    return this.state.rpm;
  }

  get position(): THREE.Vector3 {
    return this.group.position;
  }

  get yaw(): number {
    return this.state.yaw;
  }

  /** `amount` 0 = giorno, 1 = notte piena. */
  setLights(amount: number): void {
    const on = clamp(amount, 0, 1);
    for (const beam of this.headlights) beam.intensity = 42 * on;
    this.lampMat.emissiveIntensity = 0.5 + 2.6 * on;
    this.tailMat.emissiveIntensity = 0.3 + 1.2 * on;
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
    const spec = this.spec;
    const halfTrack = spec.track / 2;

    const onRoad = roads.isOnRoad(this.state.x, this.state.z, 0.4);
    const next = stepCar(
      this.state,
      input,
      { onRoad, groundHeight: (x, z) => heights.heightAt(x, z) },
      dt,
      tuningFor(spec),
    );

    const clampX = WORLD.halfWidth - 24;
    const clampZ = WORLD.halfHeight - 24;
    next.x = clamp(next.x, -clampX, clampX);
    next.z = clamp(next.z, -clampZ, clampZ);

    const fixed = buildings.resolveCircle(next.x, next.z, Math.min(1.4, spec.width * 0.6));
    if (fixed.hit) {
      next.x = fixed.x;
      next.z = fixed.z;
      next.speed *= 0.5;
    }

    this.state = next;

    // assetto su 4 punti di contatto
    const fx = -Math.sin(next.yaw);
    const fz = -Math.cos(next.yaw);
    const rx = Math.cos(next.yaw);
    const rz = -Math.sin(next.yaw);
    const hFront = heights.heightAt(next.x + fx * spec.wheelbase * 0.5, next.z + fz * spec.wheelbase * 0.5);
    const hBack = heights.heightAt(next.x - fx * spec.wheelbase * 0.5, next.z - fz * spec.wheelbase * 0.5);
    const hRight = heights.heightAt(next.x + rx * halfTrack, next.z + rz * halfTrack);
    const hLeft = heights.heightAt(next.x - rx * halfTrack, next.z - rz * halfTrack);

    const groundY = (hFront + hBack + hRight + hLeft) / 4;
    const targetPitch = Math.atan2(hFront - hBack, spec.wheelbase);
    const targetRoll = Math.atan2(hRight - hLeft, halfTrack * 2);
    const k = 1 - Math.exp(-10 * dt);
    this.tiltPitch += (targetPitch - this.tiltPitch) * k;
    this.tiltRoll += (targetRoll - this.tiltRoll) * k;

    this.group.position.set(next.x, groundY, next.z);
    this.group.rotation.set(this.tiltPitch, next.yaw, this.tiltRoll);

    const steerAngle = next.steer * spec.maxSteer * 0.95;
    for (const pivot of this.frontPivots) pivot.rotation.y = steerAngle;
    this.wheelSpin += (next.speed / spec.wheelRadius) * dt;
    for (const wheel of this.wheels) wheel.rotation.x = this.wheelSpin;
  }

  /** Seleziona un modello per id (usato dal garage). */
  setVehicleById(id: string): void {
    this.setSpec(getVehicle(id));
  }
}

/** Piccolo offset per centrare l'abitacolo sui crossover più lunghi. */
function wheelbaseOffset(spec: VehicleSpec): number {
  return spec.wheelbase - 2.5;
}

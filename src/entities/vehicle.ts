import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
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
  /** Quanto i nastri stradali stanno sopra il terreno (m). */
  private surfaceLift = 0;

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
    const bodyH = spec.height * 0.34;
    const bodyY = ride + bodyH * 0.55;

    // Vernice da auto vera: metallizzato + clearcoat, ambiente riflesso
    const paint = this.material({
      color: loadPaintFor(spec.id, spec.paint),
      roughness: 0.32,
      metalness: 0.6,
      clearcoat: 1,
      clearcoatRoughness: 0.035,
      envMapIntensity: 1.2,
    });
    this.paintMat = paint;
    const trim = this.material({ color: spec.accent, roughness: 0.72, metalness: 0.25, clearcoat: 0.6, clearcoatRoughness: 0.25 });
    const plastic = this.material({ color: 0x1a1c1e, roughness: 0.92, metalness: 0.05 });
    const chrome = this.material({ color: 0xd8dcdf, roughness: 0.2, metalness: 1, clearcoat: 0.9, clearcoatRoughness: 0.08, envMapIntensity: 1.4 });
    // Vetro: trasparenza classica (la `transmission` fisica costa un pass extra
    // di scena e senza environment map risulta sporca).
    const glass = this.material({
      color: 0x0d1a22,
      roughness: 0.04,
      metalness: 0.9,
      transparent: true,
      opacity: 0.84,
      envMapIntensity: 1.7,
    });
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

    const rounded = (w: number, h: number, d: number, radius: number): RoundedBoxGeometry =>
      new RoundedBoxGeometry(w, h, d, 2, Math.min(radius, Math.min(w, h, d) * 0.45));

    // scocca: volume arrotondato + spalla, non un cubo
    this.mesh(this.bodyGroup, rounded(spec.width * 0.99, bodyH, spec.length * 0.97, 0.12), paint, 0, bodyY, 0);
    this.mesh(this.bodyGroup, rounded(spec.width * 0.95, bodyH * 0.55, spec.length * 0.9, 0.08), paint, 0, bodyY + bodyH * 0.42, 0);

    // cofano e baule: due volumi bassi che danno la scaletta della berlina
    this.mesh(this.bodyGroup, rounded(spec.width * 0.9, bodyH * 0.5, spec.length * 0.26, 0.06), paint, 0, bodyY + bodyH * 0.34, -halfLength * 0.64);
    this.mesh(this.bodyGroup, rounded(spec.width * 0.9, bodyH * 0.5, spec.length * 0.2, 0.06), paint, 0, bodyY + bodyH * 0.34, halfLength * 0.68);

    // minigonne e sottoscocca neri: la carrozzeria non "galleggia" più
    this.mesh(this.bodyGroup, rounded(spec.width * 1.0, bodyH * 0.28, spec.length * 0.82, 0.05), plastic, 0, ride + bodyH * 0.12, 0);

    // abitacolo: vetro arrotondato, montanti e tetto lo spezzano in superfici
    const cabinLength = spec.length * (spec.roof === 'boxy' ? 0.56 : 0.48);
    const cabinHeight = spec.height * (spec.roof === 'boxy' ? 0.36 : 0.31);
    const cabinZ = spec.style === 'trike' ? 0.12 : 0.02;
    const cabinX = wheelbaseOffset(spec) * 0.1;
    const cabinY = bodyY + bodyH * 0.42 + cabinHeight * 0.5;
    this.mesh(
      this.bodyGroup,
      rounded(spec.width * 0.88, cabinHeight, cabinLength, 0.14),
      glass,
      cabinX,
      cabinY,
      cabinZ,
      false,
    );

    const roofY = cabinY + cabinHeight / 2;
    this.mesh(this.bodyGroup, rounded(spec.width * 0.82, 0.07, cabinLength * 0.95, 0.03), paint, cabinX, roofY, cabinZ);
    for (const side of [-1, 1]) {
      this.mesh(this.bodyGroup, rounded(0.07, cabinHeight * 1.02, 0.1, 0.02), paint, cabinX + side * spec.width * 0.42, cabinY, cabinZ - cabinLength * 0.42);
      this.mesh(this.bodyGroup, rounded(0.07, cabinHeight * 1.02, 0.1, 0.02), paint, cabinX + side * spec.width * 0.42, cabinY, cabinZ + cabinLength * 0.42);
    }

    // paraurti in plastica, calandra e targa
    this.mesh(this.bodyGroup, rounded(spec.width * 1.0, bodyH * 0.42, 0.2, 0.06), plastic, 0, bodyY - bodyH * 0.32, -halfLength + 0.06);
    this.mesh(this.bodyGroup, rounded(spec.width * 1.0, bodyH * 0.42, 0.2, 0.06), plastic, 0, bodyY - bodyH * 0.32, halfLength - 0.06);
    this.mesh(this.bodyGroup, rounded(spec.width * 0.46, bodyH * 0.34, 0.05, 0.02), plastic, 0, bodyY + bodyH * 0.1, -halfLength + 0.03, false);
    this.mesh(this.bodyGroup, new THREE.BoxGeometry(spec.width * 0.34, 0.02, 0.03), chrome, 0, bodyY + bodyH * 0.22, -halfLength + 0.05, false);
    this.mesh(this.bodyGroup, new THREE.BoxGeometry(0.44, 0.11, 0.02), chrome, 0, bodyY - bodyH * 0.2, halfLength - 0.02, false);

    // labbro anteriore e diffusore posteriore nel colore d'accento
    this.mesh(this.bodyGroup, rounded(spec.width * 0.92, bodyH * 0.12, 0.06, 0.02), trim, 0, bodyY - bodyH * 0.5, -halfLength + 0.02, false);
    this.mesh(this.bodyGroup, rounded(spec.width * 0.92, bodyH * 0.12, 0.06, 0.02), trim, 0, bodyY - bodyH * 0.5, halfLength - 0.02, false);

    // fari affusolati, striscia LED, specchietti e maniglie
    for (const side of [-1, 1]) {
      this.mesh(this.bodyGroup, rounded(0.32, 0.1, 0.07, 0.03), lamp, side * halfWidth * 0.56, bodyY + bodyH * 0.34, -halfLength + 0.04, false);
      this.mesh(this.bodyGroup, new THREE.BoxGeometry(0.26, 0.02, 0.03), lamp, side * halfWidth * 0.56, bodyY + bodyH * 0.25, -halfLength + 0.03, false);
      this.mesh(this.bodyGroup, rounded(0.3, 0.09, 0.06, 0.025), tail, side * halfWidth * 0.58, bodyY + bodyH * 0.32, halfLength - 0.04, false);
      this.mesh(this.bodyGroup, rounded(0.12, 0.07, 0.06, 0.02), paint, side * (spec.width * 0.5 + 0.02), cabinY - 0.05, cabinZ - cabinLength * 0.4, false);
      this.mesh(this.bodyGroup, new THREE.BoxGeometry(0.02, 0.03, 0.14), chrome, side * spec.width * 0.49, bodyY + bodyH * 0.15, cabinZ + 0.1, false);
    }

    // dettagli di carrozzeria
    if (spec.style === 'suv' || spec.style === 'crossover') {
      const rails = roofY + 0.06;
      for (const side of [-1, 1]) {
        this.mesh(this.bodyGroup, rounded(0.05, 0.05, cabinLength * 0.8, 0.02), chrome, cabinX + side * spec.width * 0.3, rails, cabinZ);
      }
    }
    if (spec.style === 'trike') {
      this.mesh(this.bodyGroup, rounded(0.5, bodyH * 0.8, 0.55, 0.08), paint, 0, bodyY - bodyH * 0.1, -halfLength + 0.28);
    }

    // ruote: toro per la gomma, disco e razze per il cerchio
    const rubber = this.material({ color: 0x121416, roughness: 0.95, metalness: 0.05, clearcoat: 0.25, clearcoatRoughness: 0.5 });
    const hub = this.material({ color: 0xb9bec2, roughness: 0.28, metalness: 0.9, clearcoat: 0.8, clearcoatRoughness: 0.1, envMapIntensity: 1.3 });

    const frontZ = -spec.wheelbase / 2;
    const rearZ = spec.wheelbase / 2;
    const frontX = spec.wheelLayout === 'three' ? [0] : [-1, 1];
    for (const side of frontX) {
      this.wheelAt(side * spec.track * 0.5, spec.wheelRadius, frontZ, true, rubber, hub);
    }
    for (const side of [-1, 1]) {
      this.wheelAt(side * spec.track * 0.5, spec.wheelRadius, rearZ, false, rubber, hub);
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

  private wheelAt(
    x: number,
    y: number,
    z: number,
    steerable: boolean,
    rubber: THREE.Material,
    hub: THREE.Material,
  ): void {
    const radius = this.spec.wheelRadius;
    const width = 0.22;

    const pivot = new THREE.Group();
    pivot.position.set(x, y, z);

    // gomma con profilo tondo (toro) e spalla piena, cerchio a razze
    const wheel = new THREE.Group();
    const tire = new THREE.TorusGeometry(radius * 0.78, radius * 0.22, 10, 24);
    tire.rotateY(Math.PI / 2);
    const tireMesh = new THREE.Mesh(this.track(tire), rubber);
    tireMesh.castShadow = true;
    wheel.add(tireMesh);

    const wall = new THREE.CylinderGeometry(radius * 0.78, radius * 0.78, width * 0.9, 20);
    wall.rotateZ(Math.PI / 2);
    wheel.add(new THREE.Mesh(this.track(wall), rubber));

    const rim = new THREE.CylinderGeometry(radius * 0.5, radius * 0.5, width * 0.95, 18);
    rim.rotateZ(Math.PI / 2);
    wheel.add(new THREE.Mesh(this.track(rim), hub));

    const spoke = new THREE.BoxGeometry(width * 0.45, radius * 0.86, radius * 0.1);
    for (let i = 0; i < 5; i++) {
      const piece = new THREE.Mesh(this.track(spoke.clone()), hub);
      piece.rotation.x = (i / 5) * Math.PI * 2;
      wheel.add(piece);
    }
    spoke.dispose();

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

    // l'asfalto è drappeggiato ~20 cm sopra il DEM: senza questo offset le ruote
    // finivano sotto il manto stradale
    const targetLift = onRoad ? 0.205 : 0;
    this.surfaceLift += (targetLift - this.surfaceLift) * k;

    this.group.position.set(next.x, groundY + this.surfaceLift, next.z);
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

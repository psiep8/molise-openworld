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
    // proporzioni: corpo alto (fiancata) + padiglione più basso, non una lastra
    const bodyH = spec.height * 0.4;
    const bodyY = ride + bodyH * 0.5;
    const beltY = ride + bodyH;

    // Vernice da auto vera: metallizzato + clearcoat, ambiente riflesso
    const paint = this.material({
      color: loadPaintFor(spec.id, spec.paint),
      // metallizzato sì, ma non a specchio: col cielo chiaro il cofano
      // rifletteva il bianco e sembrava una lastra di alluminio
      roughness: 0.38,
      metalness: 0.35,
      clearcoat: 0.55,
      clearcoatRoughness: 0.14,
      envMapIntensity: 0.9,
    });
    this.paintMat = paint;
    const trim = this.material({ color: spec.accent, roughness: 0.72, metalness: 0.25, clearcoat: 0.6, clearcoatRoughness: 0.25 });
    const plastic = this.material({ color: 0x1a1c1e, roughness: 0.92, metalness: 0.05 });
    const chrome = this.material({ color: 0xd8dcdf, roughness: 0.2, metalness: 1, clearcoat: 0.9, clearcoatRoughness: 0.08, envMapIntensity: 1.4 });
    // Vetro: trasparenza classica (la `transmission` fisica costa un pass extra
    // di scena e senza environment map risulta sporca).
    const glass = this.material({
      color: 0x1d2a33,
      roughness: 0.06,
      metalness: 0.5,
      transparent: true,
      opacity: 0.62,
      envMapIntensity: 1.6,
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

    /**
     * Prisma con il tetto più stretto e più corto della base: dà il parabrezza
     * inclinato e il lunotto spiovente. Con un box dritto l'abitacolo sembrava
     * una vetrina appoggiata sulla scocca.
     */
    const taper = (
      w: number,
      h: number,
      d: number,
      topW: number,
      topD: number,
      roofShift: number,
    ): THREE.BufferGeometry => {
      const g = new THREE.BoxGeometry(w, h, d, 1, 1, 1);
      const pos = g.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < pos.count; i++) {
        if (pos.getY(i) <= 0) continue;
        pos.setX(i, pos.getX(i) * (topW / w));
        pos.setZ(i, pos.getZ(i) * (topD / d) + roofShift);
      }
      pos.needsUpdate = true;
      g.computeVertexNormals();
      return g;
    };

    // scocca: un volume unico alto, con il muso e la coda leggermente rastremati
    this.mesh(this.bodyGroup, rounded(spec.width * 0.99, bodyH, spec.length * 0.97, 0.16), paint, 0, bodyY, 0);

    // minigonne e sottoscocca neri: la carrozzeria non "galleggia" più
    this.mesh(this.bodyGroup, rounded(spec.width * 1.0, bodyH * 0.3, spec.length * 0.86, 0.05), plastic, 0, ride + bodyH * 0.1, 0);

    // abitacolo: vetro rastremato verso il tetto, montanti sottili
    const cabinLength = spec.length * (spec.roof === 'boxy' ? 0.62 : 0.56);
    const cabinHeight = spec.height * 0.3;
    const cabinZ = spec.style === 'trike' ? 0.12 : spec.length * (spec.roof === 'boxy' ? 0.05 : 0.03);

    // niente pannelli separati su cofano e coda: la superficie superiore della
    // scocca È il cofano. Con la lastra appoggiata sopra sembrava un cassone.
    const cabinX = wheelbaseOffset(spec) * 0.1;
    const cabinY = beltY + cabinHeight * 0.5;
    const roofShift = cabinLength * 0.1;
    const roofW = spec.width * 0.8;
    const roofD = cabinLength * 0.66;
    this.mesh(
      this.bodyGroup,
      taper(spec.width * 0.94, cabinHeight, cabinLength, roofW, roofD, roofShift),
      glass,
      cabinX,
      cabinY,
      cabinZ,
      false,
    );

    const roofY = beltY + cabinHeight;
    this.mesh(this.bodyGroup, rounded(roofW * 1.01, 0.1, roofD * 1.02, 0.04), paint, cabinX, roofY, cabinZ + roofShift);

    // abitacolo vero: senza plancia e sedili il vetro sembrava un buco nero
    const cabinMat = this.material({ color: 0x22262a, roughness: 0.85, metalness: 0.05 });
    this.mesh(this.bodyGroup, rounded(spec.width * 0.8, 0.12, 0.26, 0.04), cabinMat, cabinX, beltY + 0.16, cabinZ - cabinLength * 0.38, false);
    for (const side of [-1, 1]) {
      this.mesh(this.bodyGroup, rounded(0.42, 0.5, 0.5, 0.06), cabinMat, cabinX + side * spec.width * 0.22, beltY + 0.24, cabinZ - 0.02, false);
      this.mesh(this.bodyGroup, rounded(0.4, 0.55, 0.09, 0.04), cabinMat, cabinX + side * spec.width * 0.22, beltY + 0.4, cabinZ + 0.22, false);
    }
    for (const side of [-1, 1]) {
      // montanti anteriori e posteriori sul bordo del padiglione
      this.mesh(this.bodyGroup, rounded(0.05, cabinHeight, 0.07, 0.02), paint, cabinX + side * roofW * 0.5, cabinY, cabinZ - roofD * 0.5 + roofShift * 0.6);
      this.mesh(this.bodyGroup, rounded(0.05, cabinHeight, 0.07, 0.02), paint, cabinX + side * roofW * 0.5, cabinY, cabinZ + roofD * 0.5 + roofShift * 0.2);
      // montante centrale sottile: spezza il vetro laterale in due finestrini
      this.mesh(this.bodyGroup, rounded(0.045, cabinHeight * 0.95, 0.05, 0.015), paint, cabinX + side * roofW * 0.5, cabinY, cabinZ + roofShift * 0.3, false);
    }

    // paraurti nel colore della carrozzeria con labbro nero sotto
    this.mesh(this.bodyGroup, rounded(spec.width * 1.0, bodyH * 0.34, 0.16, 0.06), paint, 0, ride + bodyH * 0.28, -halfLength + 0.06);
    this.mesh(this.bodyGroup, rounded(spec.width * 1.0, bodyH * 0.34, 0.16, 0.06), paint, 0, ride + bodyH * 0.28, halfLength - 0.06);
    this.mesh(this.bodyGroup, rounded(spec.width * 0.96, bodyH * 0.16, 0.2, 0.04), plastic, 0, ride + bodyH * 0.08, -halfLength + 0.06, false);
    this.mesh(this.bodyGroup, rounded(spec.width * 0.96, bodyH * 0.16, 0.2, 0.04), plastic, 0, ride + bodyH * 0.08, halfLength - 0.06, false);

    // calandra: mascherina scura con barra cromata e targa
    this.mesh(this.bodyGroup, rounded(spec.width * 0.5, bodyH * 0.26, 0.05, 0.02), plastic, 0, beltY - bodyH * 0.22, -halfLength + 0.03, false);
    this.mesh(this.bodyGroup, new THREE.BoxGeometry(spec.width * 0.42, 0.022, 0.03), chrome, 0, beltY - bodyH * 0.16, -halfLength + 0.05, false);
    this.mesh(this.bodyGroup, new THREE.BoxGeometry(0.44, 0.11, 0.02), chrome, 0, ride + bodyH * 0.3, halfLength - 0.01, false);

    // labbro anteriore e diffusore posteriore nel colore d'accento
    this.mesh(this.bodyGroup, rounded(spec.width * 0.9, bodyH * 0.1, 0.06, 0.02), trim, 0, ride + bodyH * 0.06, -halfLength + 0.02, false);
    this.mesh(this.bodyGroup, rounded(spec.width * 0.9, bodyH * 0.1, 0.06, 0.02), trim, 0, ride + bodyH * 0.06, halfLength - 0.02, false);

    // fari affusolati, striscia LED, specchietti e maniglie
    for (const side of [-1, 1]) {
      this.mesh(this.bodyGroup, rounded(0.3, 0.11, 0.07, 0.03), lamp, side * halfWidth * 0.55, beltY - bodyH * 0.1, -halfLength + 0.04, false);
      this.mesh(this.bodyGroup, new THREE.BoxGeometry(0.24, 0.018, 0.03), lamp, side * halfWidth * 0.55, beltY - bodyH * 0.03, -halfLength + 0.02, false);
      this.mesh(this.bodyGroup, rounded(0.26, 0.12, 0.06, 0.025), tail, side * halfWidth * 0.58, beltY - bodyH * 0.12, halfLength - 0.03, false);
      this.mesh(this.bodyGroup, rounded(0.12, 0.06, 0.05, 0.02), paint, side * (spec.width * 0.5 - 0.01), beltY + 0.03, cabinZ - cabinLength * 0.36, false);
      this.mesh(this.bodyGroup, new THREE.BoxGeometry(0.02, 0.028, 0.12), chrome, side * spec.width * 0.49, beltY - bodyH * 0.42, cabinZ + 0.12, false);
    }

    // dettagli di carrozzeria
    if (spec.style === 'suv' || spec.style === 'crossover') {
      const rails = roofY + 0.055;
      for (const side of [-1, 1]) {
        this.mesh(this.bodyGroup, rounded(0.05, 0.05, roofD * 0.9, 0.02), chrome, cabinX + side * roofW * 0.36, rails, cabinZ + roofShift);
      }
    }
    if (spec.style === 'trike') {
      this.mesh(this.bodyGroup, rounded(0.5, bodyH * 0.8, 0.55, 0.08), paint, 0, bodyY - bodyH * 0.1, -halfLength + 0.28);
    }

    // ruote: toro per la gomma, disco e razze per il cerchio
    const rubber = this.material({ color: 0x121416, roughness: 0.95, metalness: 0.05, clearcoat: 0.25, clearcoatRoughness: 0.5 });
    const hub = this.material({ color: 0x8e9498, roughness: 0.36, metalness: 0.82, clearcoat: 0.6, clearcoatRoughness: 0.15, envMapIntensity: 1 });

    const frontZ = -spec.wheelbase / 2;
    const rearZ = spec.wheelbase / 2;
    const frontX = spec.wheelLayout === 'three' ? [0] : [-1, 1];
    for (const side of frontX) {
      this.wheelAt(side * spec.track * 0.5, spec.wheelRadius, frontZ, true, rubber, hub);
    }
    for (const side of [-1, 1]) {
      this.wheelAt(side * spec.track * 0.5, spec.wheelRadius, rearZ, false, rubber, hub);
    }

    // passaruota: mezzo toro scuro che raccorda la ruota alla fiancata. Senza,
    // le ruote sembrano appoggiate di fianco al corpo della macchina.
    for (const z of [frontZ, rearZ]) {
      const front = z === frontZ;
      const sides = front && spec.wheelLayout === 'three' ? [0] : [-1, 1];
      for (const side of sides) {
        const arch = new THREE.TorusGeometry(spec.wheelRadius * 1.16, 0.05, 6, 18, Math.PI);
        arch.rotateY(Math.PI / 2);
        this.mesh(this.bodyGroup, arch, plastic, side * spec.width * 0.49, spec.wheelRadius, z, false);
      }
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

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { bodyLean, createCarState, curbImpact, speedKmh, stepCar, type CarInput, type CarState } from '../sim/car';
import { resolveBody } from '../sim/collision';
import {
  VEHICLES,
  getVehicle,
  hasPaintFor,
  loadPaintFor,
  tuningFor,
  type VehicleSpec,
} from '../sim/vehicle-catalog';
import {
  applyPaintFinish,
  choosePaintMaterials,
  isPaintMaterial,
  paintMaterialFrom,
  tintPaint,
} from '../gfx/car-paint';
import type { Heightfield } from '../geo/elevation';
import type { ObstacleIndex } from '../geo/obstacles';
import type { BuildingIndex, RoadIndex } from '../geo/osm';
import type { CityKit } from '../world/citykit';
import type { CarLibrary } from '../world/car-library';
import { preciseBox, splitCarWheels } from './car-wheels';
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
  /**
   * Carrozzeria dipinta di un GLB: materiali clonati per questa istanza (il
   * template è condiviso, tingere quello cambierebbe tutte le auto in scena) e
   * portati a vernice fisica.
   */
  private readonly paintTargets: { material: THREE.MeshPhysicalMaterial; tintable: boolean }[] = [];
  /** fari e fanalini dei GLB: materiali da accendere quando scende la notte */
  private readonly lensMaterials: { material: THREE.MeshStandardMaterial; base: number }[] = [];
  private kit: CityKit | null = null;
  /** auto di serie su GLB (`public/cars/`), separate dal garage dell'utente. */
  private carLibrary: CarLibrary | null = null;
  /** GLB importato dal garage: sostituisce la carrozzeria procedurale. */
  private customModel: THREE.Object3D | null = null;
  /** Ruote separate trovate nel GLB (nomi `wheel-fl`, `wheel-fr`, ecc.). */
  private readonly externalWheels: { node: THREE.Object3D; front: boolean; radius: number }[] = [];
  /** raggio medio delle ruote separate, in metri: il rotolamento deve combaciare col terreno */
  private externalWheelRadius: number | null = null;
  /** environment map del cielo, per vernice e vetri che brillano davvero */
  private environment: THREE.Texture | null = null;
  private readonly envBoost = new Map<THREE.Material, number>();
  private tiltPitch = 0;
  private tiltRoll = 0;
  private wheelSpin = 0;
  /** 0 = giorno, 1 = notte piena: serve a non azzerare il freno quando cambia la luce */
  private nightLevel = 0;
  /** Quanto i nastri stradali stanno sopra il terreno (m). */
  private surfaceLift = 0;
  /** Quota del piano calpestabile all'ultimo frame, per sentire lo scalino. */
  private lastTargetLift = Number.NaN;
  /** Colpo del cordolo ancora da smaltire (m). */
  private bump = 0;
  /** Rollio e beccheggio della carrozzeria (rad). */
  private leanRoll = 0;
  private leanPitch = 0;
  /** Evita di pagare il colpo a ogni frame mentre si resta sul bordo. */
  private curbCooldown = 0;

  constructor(spec: VehicleSpec = VEHICLES[0]) {
    this.group = new THREE.Group();
    this.group.name = 'vehicle';
    this.group.rotation.order = 'YXZ';
    this.bodyGroup = new THREE.Group();
    this.group.add(this.bodyGroup);
    this.spec = spec;
    this.build();
  }

  /** Il kit si carica in parallelo alla mappa: arriva dopo il primo build. */
  setKit(kit: CityKit | null): void {
    this.kit = kit;
    if (this.spec.model && !this.customModel) {
      this.clear();
      this.build();
    }
  }

  /** Libreria delle auto di serie (GLB in `public/cars/`). */
  setCarLibrary(library: CarLibrary | null): void {
    this.carLibrary = library;
    if (this.spec.model && !this.customModel) {
      this.clear();
      this.build();
    }
  }

  /** True se la carrozzeria risponde al cambio tinta (procedurale o vernice del GLB). */
  get paintable(): boolean {
    return this.paintMat !== null || this.paintTargets.some((target) => target.tintable);
  }

  /**
   * Riflessi dell'ambiente: la cubemap PMREM generata dal cielo. Senza, la
   * vernice riflette solo le luci dirette e sembra vernice da modellino (vedi
   * `webgl_materials_car`). L'intensità di base resta quella del materiale:
   * si moltiplica per il boost, così la carrozzeria brilla più del plasticone.
   */
  setEnvironment(map: THREE.Texture | null): void {
    if (map === this.environment) return;
    this.environment = map;
    this.applyEnvironment();
  }

  private applyEnvironment(): void {
    if (!this.environment) return;
    for (const [material, boost] of this.envBoost) {
      const standard = material as THREE.MeshStandardMaterial;
      const base = (standard.userData.baseEnvIntensity as number | undefined) ?? standard.envMapIntensity ?? 1;
      standard.userData.baseEnvIntensity = base;
      standard.envMap = this.environment;
      standard.envMapIntensity = base * boost;
      standard.needsUpdate = true;
    }
  }

  /** Registra un materiale con quanto deve rispondere all'ambiente riflesso. */
  private tune(material: THREE.MeshPhysicalMaterial, boost: number): THREE.MeshPhysicalMaterial {
    this.envBoost.set(material, boost);
    return material;
  }

  /**
   * Cambia modello a runtime (garage / selezione).
   *
   * `externalModel` è un GLB già normalizzato (base a 0, lunghezza reale): se
   * non c'è, lo spec può comunque indicare un modello del city kit.
   */
  setSpec(spec: VehicleSpec, externalModel: THREE.Object3D | null = null): void {
    if (spec.id === this.spec.id && externalModel === this.customModel) return;
    this.spec = spec;
    this.customModel = externalModel;
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
    this.externalWheels.length = 0;
    this.externalWheelRadius = null;
    this.envBoost.clear();
    this.headlights.length = 0;
    this.paintMat = null;
    this.paintTargets.length = 0;
    this.lensMaterials.length = 0;
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
    const external = this.resolveExternal();
    if (external) {
      this.buildExternal(external.object, external.scale);
      return;
    }

    const spec = this.spec;
    const halfLength = spec.length / 2;
    const halfWidth = spec.width / 2;
    const ride = spec.style === 'suv' ? 0.5 : spec.style === 'crossover' ? 0.46 : 0.4;
    // proporzioni: corpo alto (fiancata) + padiglione più basso, non una lastra
    const bodyH = spec.height * 0.4;
    const bodyY = ride + bodyH * 0.5;
    const beltY = ride + bodyH;

    // Vernice da auto vera: vernice + clearcoat spesso (il clearcoat è la
    // lastra di vernice trasparente: riflette il cielo con un alone stretto).
    // L'intensità dell'ambiente la decide `setEnvironment`, con un boost alto:
    // senza riflessi ampi sembra plastica da giocattolo.
    const paint = this.tune(
      this.material({
        color: loadPaintFor(spec.id, spec.paint),
        roughness: 0.3,
        metalness: 0.5,
        clearcoat: 1.0,
        clearcoatRoughness: 0.06,
        envMapIntensity: 1.0,
      }),
      2.4,
    );
    this.paintMat = paint;
    // anche la vernice procedurale passa dal ritocco di saturazione: la palette
    // e i GLB devono mostrare lo stesso colore
    applyPaintFinish(paint);
    const trim = this.tune(this.material({ color: spec.accent, roughness: 0.72, metalness: 0.25, clearcoat: 0.6, clearcoatRoughness: 0.25 }), 1.4);
    const plastic = this.material({ color: 0x1a1c1e, roughness: 0.92, metalness: 0.05 });
    const chrome = this.tune(this.material({ color: 0xd8dcdf, roughness: 0.14, metalness: 1, clearcoat: 1.0, clearcoatRoughness: 0.05 }), 3.2);
    // Vetro: trasparenza classica (la `transmission` fisica costa un pass extra
    // di scena e senza environment map risulta sporca).
    const glass = this.tune(
      this.material({
        color: 0x1d2a33,
        roughness: 0.05,
        metalness: 0.55,
        transparent: true,
        opacity: 0.6,
      }),
      3.0,
    );
    const lamp = this.tune(
      this.material({
        color: 0xfff3d0,
        emissive: 0xffe6a8,
        emissiveIntensity: 0.6,
        roughness: 0.35,
        clearcoat: 0.4,
        clearcoatRoughness: 0.3,
      }),
      1.6,
    );
    const tail = this.tune(
      this.material({
        color: 0x8f1f1a,
        emissive: 0x5a0d0a,
        emissiveIntensity: 0.35,
        roughness: 0.45,
        clearcoat: 0.5,
        clearcoatRoughness: 0.2,
      }),
      1.6,
    );
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

    // calandra: mascherina scura con barra cromata
    this.mesh(this.bodyGroup, rounded(spec.width * 0.5, bodyH * 0.26, 0.05, 0.02), plastic, 0, beltY - bodyH * 0.22, -halfLength + 0.03, false);
    this.mesh(this.bodyGroup, new THREE.BoxGeometry(spec.width * 0.42, 0.022, 0.03), chrome, 0, beltY - bodyH * 0.16, -halfLength + 0.05, false);

    // targhe: anteriore sotto la calandra, posteriore al centro del paraurti.
    // Il piano è appena fuori dal paraurti, così non "affoga" nella carrozzeria.
    const plateMat = this.material({
      map: plateTexture(plateNumber(spec.id)),
      roughness: 0.5,
      metalness: 0.1,
      envMapIntensity: 0.45,
    });
    const plateY = ride + bodyH * 0.29;
    const plateFront = new THREE.PlaneGeometry(0.44, 0.096);
    plateFront.rotateY(Math.PI);
    this.mesh(this.bodyGroup, plateFront, plateMat, 0, plateY, -halfLength - 0.031, false);
    this.mesh(this.bodyGroup, new THREE.PlaneGeometry(0.44, 0.096), plateMat, 0, plateY, halfLength + 0.031, false);

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
    const rubber = this.material({
      color: 0x121416,
      roughness: 0.95,
      metalness: 0.05,
      clearcoat: 0.25,
      clearcoatRoughness: 0.5,
      // battistrada: solchi veri, non una gomma liscia da modellino
      bumpMap: treadTexture(),
      bumpScale: 0.6,
    });
    const hub = this.tune(this.material({ color: 0x8e9498, roughness: 0.36, metalness: 0.82, clearcoat: 0.6, clearcoatRoughness: 0.15 }), 2.0);
    // disco freno: si vede attraverso le razze, è quello che fa "auto vera"
    const discMat = this.tune(this.material({ color: 0x6f7477, roughness: 0.45, metalness: 0.9 }), 1.6);

    const frontZ = -spec.wheelbase / 2;
    const rearZ = spec.wheelbase / 2;
    const frontX = spec.wheelLayout === 'three' ? [0] : [-1, 1];
    for (const side of frontX) {
      this.wheelAt(side * spec.track * 0.5, spec.wheelRadius, frontZ, true, rubber, hub, discMat);
    }
    for (const side of [-1, 1]) {
      this.wheelAt(side * spec.track * 0.5, spec.wheelRadius, rearZ, false, rubber, hub, discMat);
    }

    // terminale di scarico: un tubo cromato sotto la coda
    if (spec.style !== 'trike') {
      const exhaust = new THREE.CylinderGeometry(0.042, 0.05, 0.16, 10);
      exhaust.rotateX(Math.PI / 2);
      this.mesh(this.bodyGroup, exhaust, chrome, halfWidth * 0.5, ride + bodyH * 0.08, halfLength - 0.02, false);
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

    // ombre di contatto sotto le ruote: senza, l'auto sembra "galleggiare"
    // sull'asfalto (le ombre del sole arrivano da lontano e non chiudono il
    // punto in cui la gomma tocca la strada)
    const shadows: { x: number; z: number; r: number }[] = [];
    for (const side of frontX) shadows.push({ x: side * spec.track * 0.5, z: frontZ, r: spec.wheelRadius });
    for (const side of [-1, 1]) shadows.push({ x: side * spec.track * 0.5, z: rearZ, r: spec.wheelRadius });
    this.buildContactShadows(shadows);
    this.applyEnvironment();
  }

  /**
   * Macchia scura morbida sotto ogni ruota: chiude il punto di contatto tra
   * gomma e strada. Quattro quad, una texture condivisa, zero luci.
   */
  private buildContactShadows(spots: { x: number; z: number; r: number }[]): void {
    if (spots.length === 0) return;
    const quad = this.track(new THREE.PlaneGeometry(1, 1));
    quad.rotateX(-Math.PI / 2);
    const material = new THREE.MeshBasicMaterial({
      map: contactShadowTexture(),
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
      color: 0xffffff,
    });
    this.materials.add(material);
    for (const spot of spots) {
      const size = Math.max(0.5, spot.r * 3.4);
      const shadow = this.mesh(this.bodyGroup, quad, material, spot.x, 0.006, spot.z, false);
      shadow.receiveShadow = false;
      shadow.scale.set(size, 1, size);
    }
  }

  /**
   * Carrozzeria esterna: un GLB importato dal garage, un'auto di serie della
   * libreria (`public/cars/`) oppure, se lo spec lo indica, un modello del city
   * kit. In tutti i casi il muso dell'asset è a +Z, mentre il veicolo gioca con
   * il muso a -Z: la rotazione la fa il build.
   */
  private resolveExternal(): { object: THREE.Object3D; scale: number | null } | null {
    if (this.customModel) return { object: this.customModel, scale: null };
    if (!this.spec.model) return null;

    // auto di serie: il template è già normalizzato (lunghezza 1, muso +Z,
    // ruote con perno) e viene riusato a ogni cambio veicolo
    const car = this.carLibrary?.cached(this.spec.model) ?? null;
    if (car) {
      // clonato: la vernice e i perni delle ruote si modificano sull'istanza,
      // così il template resta pulito per il prossimo cambio veicolo
      return { object: car.template.clone(true), scale: this.spec.length / Math.max(0.001, car.size.z) };
    }

    if (!this.kit) return null;
    const asset = this.kit.bySlug(this.spec.model);
    if (!asset) return null;
    // la separazione delle ruote si fa una volta sola sul template e poi viene
    // ereditata da ogni clonazione: senza, ogni cambio veicolo rianalizzerebbe
    // decine di migliaia di triangoli
    splitCarWheels(asset.template);
    // la lunghezza di un'auto del kit corre lungo Z; il resto è larghezza
    const sourceLength = Math.max(0.001, asset.size.z);
    return {
      object: asset.template.clone(true),
      scale: this.spec.length / sourceLength,
    };
  }

  private buildExternal(source: THREE.Object3D, scale: number | null): void {
    const spec = this.spec;
    const pivot = new THREE.Group();
    pivot.name = 'vehicle-external';
    pivot.add(source);
    // muso +Z dell'asset -> muso -Z del gioco
    pivot.rotation.y = Math.PI;
    if (scale !== null) pivot.scale.setScalar(scale);
    pivot.updateMatrixWorld(true);

    // base a terra e centro sull'asse: un GLB può avere il pivot dove vuole.
    // Il calcolo avviene prima di agganciare il pivot al gruppo: altrimenti il
    // bounding box sarebbe in coordinate mondo e, cambiando auto in movimento,
    // il modello si sposterebbe della posizione dell'auto. `preciseBox` conta i
    // vertici: molti GLB ruotano la scocca dentro i nodi e il box OBB mentirebbe.
    const box = preciseBox(pivot);
    const center = box.getCenter(new THREE.Vector3());
    pivot.position.set(-center.x, -box.min.y, -center.z);
    this.bodyGroup.add(pivot);

    // materiali del GLB raccolti per materiale (nome, area, mesh): serve a
    // riconoscere la vernice anche quando il modello usa un unico atlante che
    // copre scocca e cerchi (`_BodySG` dell'Aventador)
    const usage = new Map<
      THREE.Material,
      { name: string; triangles: number; meshes: THREE.Mesh[] }
    >();
    source.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (!(mesh as unknown as { isMesh?: boolean }).isMesh) return;
      const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      const material = list[0];
      mesh.receiveShadow = true;
      mesh.castShadow = !material?.transparent;
      const geometry = mesh.geometry as THREE.BufferGeometry | undefined;
      const positions = geometry?.attributes?.position?.count ?? 0;
      const triangles = (geometry?.index ? geometry.index.count : positions) / 3;
      for (const entry of list) {
        if (!entry) continue;
        const record = usage.get(entry) ?? { name: entry.name ?? '', triangles: 0, meshes: [] };
        record.triangles += triangles;
        if (!record.meshes.includes(mesh)) record.meshes.push(mesh);
        usage.set(entry, record);
      }
    });

    const sharedMaterials = [...usage.keys()];
    // le auto importate dall'utente restano con i materiali del suo file (vedi
    // `garage.ts`): si tinge solo la libreria di serie
    if (source !== this.customModel) {
      const candidates = sharedMaterials.map((material) => ({
        name: material.name ?? '',
        triangles: usage.get(material)?.triangles ?? 0,
      }));
      for (const index of choosePaintMaterials(candidates)) {
        const original = sharedMaterials[index] as THREE.MeshStandardMaterial | undefined;
        if (!original || !(original as unknown as { isMeshStandardMaterial?: boolean }).isMeshStandardMaterial) {
          continue;
        }
        // clonato: il template è condiviso da tutte le istanze dell'auto
        const paint = paintMaterialFrom(original);
        this.materials.add(paint);
        // un atlante unico (scocca + cerchi) si può solo desaturare: tingere il
        // fattore di colore colorerebbe anche gomme e vetri
        this.paintTargets.push({ material: paint, tintable: isPaintMaterial(original.name) });
        this.envBoost.set(paint, 2.2);
        for (const mesh of usage.get(original)?.meshes ?? []) {
          mesh.material = Array.isArray(mesh.material)
            ? mesh.material.map((entry) => (entry === original ? paint : entry))
            : paint;
        }
        usage.delete(original);
      }
    }

    for (const [material, record] of usage) {
      const standard = material as THREE.MeshStandardMaterial;
      if (!(standard as unknown as { isMeshStandardMaterial?: boolean }).isMeshStandardMaterial) continue;
      // i materiali del GLB rispondono all'ambiente come quelli procedurali:
      // carrozzeria e vetri hanno bisogno di più riflesso del resto
      const boost = /paint|glass|chrome|lens|emit|metal|steel|alloy|rub/i.test(record.name) ? 1.9 : 1.25;
      this.envBoost.set(standard, boost);
      // fari e fanalini: di notte l'emissivo del materiale si accende, così il
      // fanale si vede senza aggiungere altre luci alla scena
      if (/(lens|light|fanal|headlight|taillight|stop light)/i.test(record.name) && !standard.transparent) {
        // se il GLB non dichiara un emissivo, la lente prende il proprio colore
        // (bianco davanti, rosso dietro); se lo dichiara, si rispetta l'autore
        if (standard.emissive.getHex() === 0x000000) standard.emissive.copy(standard.color);
        this.lensMaterials.push({ material: standard, base: standard.emissiveIntensity ?? 1 });
      }
    }

    // ruote: se la carrozzeria è un pezzo solo vengono separate (perni al mozzo).
    // Per un GLB importato la geometria originale è di sua proprietà e viene
    // liberata; i template del kit restano intatti (sono condivisi).
    // I template della libreria arrivano già con i perni: rifare l'analisi su
    // una moto a due ruote rischierebbe di trovare quattro "ruote" fantasma.
    let hasHubs = false;
    source.traverse((object) => {
      if (object.name.endsWith('-hub')) hasHubs = true;
    });
    if (!hasHubs) splitCarWheels(source, source === this.customModel);
    this.collectExternalWheels(source);
    this.applyEnvironment();
    // tinta scelta dall'utente (se c'è): altrimenti resta quella del modello
    if (this.paintable && hasPaintFor(spec.id)) {
      this.setPaint(loadPaintFor(spec.id, spec.paint));
    }

    // ombre di contatto sotto le ruote rilevate (o sotto quelle dichiarate)
    const shadowSpots: { x: number; z: number; r: number }[] = [];
    for (const wheel of this.externalWheels) {
      const world = wheel.node.getWorldPosition(new THREE.Vector3());
      const local = this.bodyGroup.worldToLocal(world);
      shadowSpots.push({ x: local.x, z: local.z, r: wheel.radius });
    }
    if (shadowSpots.length === 0) {
      const halfLength = spec.length / 2;
      const halfWidth = spec.width / 2;
      for (const side of [-1, 1]) {
        shadowSpots.push({ x: side * halfWidth * 0.72, z: -halfLength + spec.wheelRadius, r: spec.wheelRadius });
        shadowSpots.push({ x: side * halfWidth * 0.72, z: halfLength - spec.wheelRadius, r: spec.wheelRadius });
      }
    }
    this.buildContactShadows(shadowSpots);

    // fari: gli asset non hanno uno spot, ma la notte serve luce in strada
    const halfWidth = spec.width / 2;
    const halfLength = spec.length / 2;
    for (const side of [-1, 1]) {
      const beam = new THREE.SpotLight(0xfff0cf, 0, 55, Math.PI / 7, 0.55, 1.2);
      beam.position.set(side * halfWidth * 0.62, spec.height * 0.32, -halfLength + 0.06);
      beam.castShadow = false;
      this.group.add(beam);
      beam.target.position.set(side * halfWidth, -0.4, -18);
      this.group.add(beam.target);
      this.headlights.push(beam);
    }
    // se si cambia auto di notte, i fari del nuovo modello devono accendersi
    // subito invece di aspettare il prossimo cambio di luce
    this.setLights(this.nightLevel);
  }

  /**
   * Ruote animate nei GLB importati.
   *
   * Un modello Smooth Voxels esportato in un solo oggetto ha le ruote fuse
   * nella carrozzeria: non si possono girare. Se invece le ruote sono oggetti
   * separati chiamati `wheel-fl`, `wheel-fr`, `wheel-rl`, `wheel-rr`, qui si
   * crea un perno sul centro di ciascuna e si fa sterzare/girare quello.
   *
   * Il raggio si misura sul perno già in scala: così vale sia per i modelli del
   * kit (unità reali) sia per i template della libreria (lunghezza 1).
   */
  private collectExternalWheels(source: THREE.Object3D): void {
    source.updateMatrixWorld(true);
    const fallback = this.spec.wheelRadius;
    const found: { node: THREE.Object3D; front: boolean; radius: number }[] = [];
    const seen = new Set<THREE.Object3D>();
    let radiusSum = 0;
    source.traverse((object) => {
      if (!object.name) return;
      const match = /(?:^|[-_ ])wheel[-_ ]?(fl|fr|rl|rr)$/i.exec(object.name);
      if (!match) return;
      const parent = object.parent;
      if (!parent) return;
      const tag = match[1].toLowerCase();
      const front = tag === 'fl' || tag === 'fr';
      const splitHub = parent.name.endsWith('-hub') ? parent : null;

      // una ruota può avere sotto-nodi che finiscono con lo stesso tag
      // (`wheel-fl` > `ALIAS_Wheel_FL`): si gestisce solo il perno più in alto
      if (!splitHub) {
        for (let ancestor: THREE.Object3D | null = parent; ancestor; ancestor = ancestor.parent) {
          if (ancestor.name.endsWith('-hub')) return;
        }
      }

      // il modello è già stato costruito una volta: il perno esiste e va
      // riusato, altrimenti cambiando auto e tornando indietro le ruote
      // resterebbero ferme
      let hub: THREE.Object3D;
      if (splitHub) {
        if (seen.has(splitHub)) return;
        hub = splitHub;
      } else {
        const world = preciseBox(object).getCenter(new THREE.Vector3());
        const created = new THREE.Group();
        created.name = `${object.name}-hub`;
        created.rotation.order = 'YXZ';
        parent.add(created);
        created.position.copy(parent.worldToLocal(world));
        created.updateMatrixWorld(true);
        created.attach(object);
        hub = created;
      }

      // il raggio è quello dell'ingombro della ruota, non quello dichiarato
      // nello spec: pneumatici più grandi devono rotolare quanto il terreno
      hub.rotation.set(0, 0, 0);
      const size = preciseBox(hub).getSize(new THREE.Vector3());
      const measured = Math.max(size.x, size.y, size.z) / 2;
      const radius = measured > 0.08 && measured < 1.6 ? measured : fallback;
      hub.userData.wheelRadius = radius;

      seen.add(hub);
      found.push({ node: hub, front, radius });
      radiusSum += radius;
    });
    this.externalWheels.push(...found);
    if (found.length > 0) this.externalWheelRadius = radiusSum / found.length;
  }

  private wheelAt(
    x: number,
    y: number,
    z: number,
    steerable: boolean,
    rubber: THREE.Material,
    hub: THREE.Material,
    disc: THREE.Material,
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

    // disco freno dietro il cerchio: si intravede tra le razze
    const brake = new THREE.CylinderGeometry(radius * 0.62, radius * 0.62, 0.026, 18);
    brake.rotateZ(Math.PI / 2);
    wheel.add(new THREE.Mesh(this.track(brake), disc));

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
    if (this.paintMat) {
      this.paintMat.color.setHex(color);
      this.paintMat.needsUpdate = true;
    }
    // nei GLB il colore si applica alla sola scocca: gli atlanti che includono
    // cerchi e vetri restano del colore del modello (vedi `tintable`)
    for (const target of this.paintTargets) {
      if (!target.tintable) continue;
      tintPaint(target.material, color);
    }
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
    this.nightLevel = on;
    for (const beam of this.headlights) beam.intensity = 42 * on;
    this.lampMat.emissiveIntensity = 0.5 + 2.6 * on;
    this.tailMat.emissiveIntensity = 0.3 + 1.2 * on;
    // fari e fanalini del GLB: di giorno spenti, di notte accesi. `setLights`
    // gira a ogni frame, quindi si tocca il materiale solo quando il valore
    // cambia davvero (un `needsUpdate` per frame rifarebbe il programma).
    const lensLevel = on * 1.9;
    for (const lens of this.lensMaterials) {
      const target = lens.base * lensLevel;
      if (Math.abs(lens.material.emissiveIntensity - target) < 0.01) continue;
      lens.material.emissiveIntensity = target;
    }
  }

  reset(x: number, z: number, yaw: number, heights: Heightfield): void {
    this.state = createCarState(x, z, yaw);
    const y = heights.heightAt(x, z);
    this.group.position.set(x, y, z);
    this.group.rotation.set(0, yaw, 0);
    this.tiltPitch = 0;
    this.tiltRoll = 0;
    this.leanPitch = 0;
    this.leanRoll = 0;
  }

  update(
    dt: number,
    input: CarInput,
    heights: Heightfield,
    roads: RoadIndex,
    buildings: BuildingIndex,
    obstacles?: ObstacleIndex,
  ): void {
    const spec = this.spec;
    const halfTrack = spec.track / 2;
    const before = this.state;

    const onRoad = roads.isOnRoad(this.state.x, this.state.z, 0.4);
    // il piano di appoggio include asfalto e marciapiede: la fisica della
    // pendenza deve sentire la stessa quota che si vede
    const groundAt = (x: number, z: number): number => heights.heightAt(x, z) + roads.surfaceOffset(x, z);
    const next = stepCar(
      this.state,
      input,
      { onRoad, groundHeight: groundAt },
      dt,
      tuningFor(spec),
    );

    const clampX = WORLD.halfWidth - 24;
    const clampZ = WORLD.halfHeight - 24;
    next.x = clamp(next.x, -clampX, clampX);
    next.z = clamp(next.z, -clampZ, clampZ);

    // Due cerchi (avantreno e retrotreno) invece di uno solo: il muso non
    // attraversa più muri e pali mentre il centro è ancora in carreggiata.
    // Il raggio è il mezzo ingombro trasversale, la distanza è metà passo.
    const body = resolveBody(
      next.x,
      next.z,
      next.yaw,
      next.speed,
      Math.min(spec.length * 0.35, spec.wheelbase * 0.62),
      Math.min(1.05, spec.width * 0.52),
      [buildings, obstacles],
    );
    next.x = body.x;
    next.z = body.z;
    next.speed = body.speed;

    // lo scalino del cordolo si sente: la carrozzeria sobbalza e l'auto perde
    // un po' di velocità, senza teletrasporti
    const targetLift = roads.surfaceOffset(next.x, next.z);
    // al primo frame non c'è uno scalino da sentire: si registra e basta
    const impact = Number.isFinite(this.lastTargetLift)
      ? curbImpact(this.lastTargetLift, targetLift)
      : { speedFactor: 1, bump: 0 };
    this.lastTargetLift = targetLift;
    this.curbCooldown = Math.max(0, this.curbCooldown - dt);
    if (impact.bump > 0 && this.curbCooldown === 0 && Math.abs(next.speed) > 0.8) {
      next.speed *= impact.speedFactor;
      this.bump = Math.max(this.bump, impact.bump);
      this.curbCooldown = 0.35;
    }
    this.bump *= Math.exp(-9 * dt);

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

    // carrozzeria che si corica in curva e si siede in frenata: usa le derivate
    // di imbardata e velocità, non l'accelerazione laterale dell'auto (che la
    // fisica non espone). Più lento del terreno, come una sospensione.
    const yawRate = dt > 0 ? (next.yaw - before.yaw) / dt : 0;
    const accel = dt > 0 ? (next.speed - before.speed) / dt : 0;
    const lean = bodyLean(next.speed, yawRate, accel);
    const kLean = 1 - Math.exp(-7 * dt);
    this.leanRoll += (lean.roll - this.leanRoll) * kLean;
    this.leanPitch += (lean.pitch - this.leanPitch) * kLean;

    // l'asfalto è drappeggiato sopra il DEM e il marciapiede sta 18 cm più su:
    // la carrozzeria sale con la stessa quota del piano calpestabile
    this.surfaceLift += (targetLift - this.surfaceLift) * k;

    this.group.position.set(next.x, groundY + this.surfaceLift + this.bump, next.z);
    this.group.rotation.set(this.tiltPitch + this.leanPitch, next.yaw, this.tiltRoll + this.leanRoll);

    const steerAngle = next.steer * spec.maxSteer * 0.95;
    for (const pivot of this.frontPivots) pivot.rotation.y = steerAngle;
    // per le ruote esterne si usa il raggio reale della ruota: se la carrozzeria
    // ha pneumatici più grandi o più piccoli dello spec, il rotolamento deve
    // comunque combaciare col terreno (altrimenti la ruota "striscia")
    this.wheelSpin += (next.speed / (this.externalWheelRadius ?? spec.wheelRadius)) * dt;
    for (const wheel of this.wheels) wheel.rotation.x = this.wheelSpin;
    // GLB importati: il muso è stato ruotato di 180°, quindi il verso di
    // rotazione delle ruote è opposto a quello dei modelli procedurali
    for (const wheel of this.externalWheels) {
      if (wheel.front) wheel.node.rotation.y = steerAngle;
      wheel.node.rotation.x = -this.wheelSpin;
    }

    // fanalini: si accendono in frenata e diventano bianchi in retromarcia
    const braking = clamp(input.brake, 0, 1);
    const reversing = next.gear < 0;
    this.tailMat.emissive.setHex(reversing ? 0xfff3dd : 0x5a0d0a);
    this.tailMat.emissiveIntensity = 0.3 + 1.1 * this.nightLevel + (reversing ? 1.4 : 0) + 2.6 * braking;
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

/**
 * Battistrada: solchi trasversali su una spalla scura, usato come `bumpMap`
 * della gomma. È un canvas di 64 px, generato una volta sola e condiviso da
 * tutte le auto: senza, lo pneumatico sembra un copertone liscio da modellino.
 */
let treadCache: THREE.CanvasTexture | null = null;
function treadTexture(): THREE.CanvasTexture {
  if (treadCache) return treadCache;
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = '#9a9a9a';
    ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = '#262626';
    // due scanalature longitudinali + intagli obliqui, come un battistrada vero
    ctx.fillRect(0, size * 0.22, size, size * 0.1);
    ctx.fillRect(0, size * 0.68, size, size * 0.1);
    for (let i = -size; i < size * 2; i += 14) {
      ctx.save();
      ctx.translate(i, 0);
      ctx.rotate(0.35);
      ctx.fillRect(0, 0, 5, size * 2);
      ctx.restore();
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(4, 12);
  tex.anisotropy = 4;
  treadCache = tex;
  return tex;
}

/**
 * Ombra di contatto: disco sfumato da 96 px, condiviso da tutte le ruote.
 * Serve a chiudere il punto in cui la gomma tocca la strada: l'ombra del sole
 * arriva da lontano e nel punto di contatto lascia sempre un alone chiaro.
 */
let contactShadowCache: THREE.CanvasTexture | null = null;
function contactShadowTexture(): THREE.CanvasTexture {
  if (contactShadowCache) return contactShadowCache;
  const size = 96;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    gradient.addColorStop(0, 'rgba(0,0,0,0.9)');
    gradient.addColorStop(0.4, 'rgba(0,0,0,0.55)');
    gradient.addColorStop(0.72, 'rgba(0,0,0,0.18)');
    gradient.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);
  }
  const tex = new THREE.CanvasTexture(canvas);
  contactShadowCache = tex;
  return tex;
}

/**
 * Numero di targa deterministico dall'id del veicolo, nel formato italiano
 * `AB 123 CD`. La sigla di Campobasso sta sulla banda blu, come nelle targhe
 * vere: è un dettaglio minuscolo ma dice subito "siamo in Molise".
 */
function plateNumber(id: string): string {
  let h = 7;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  const letters = 'ABCDEFGHJKLMNPRSTVWXYZ';
  const at = (n: number): string => letters[(h >>> n) % letters.length] ?? 'A';
  return `${at(0)}${at(4)} ${100 + ((h >>> 8) % 900)} ${at(12)}${at(16)}`;
}

/** Targa: canvas 256 x 56, banda blu a sinistra e a destra, caratteri neri. */
function plateTexture(text: string): THREE.CanvasTexture {
  const w = 256;
  const h = 56;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = '#f2f3ef';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#12327d';
    ctx.fillRect(0, 0, 20, h);
    ctx.fillRect(w - 20, 0, 20, h);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 11px Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('CB', 10, h * 0.5);
    ctx.fillText('I', 10, h * 0.22);
    ctx.fillStyle = '#101010';
    ctx.font = 'bold 33px "Arial Narrow", Arial, sans-serif';
    ctx.fillText(text, w * 0.5, h * 0.53);
    ctx.strokeStyle = '#0c1526';
    ctx.lineWidth = 3;
    ctx.strokeRect(1.5, 1.5, w - 3, h - 3);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

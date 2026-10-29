import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { START } from '../config';
import type { Heightfield } from '../geo/elevation';
import { clamp, mulberry32, pointInPolygon } from '../geo/geo';
import type { Area, BuildingIndex, RoadIndex } from '../geo/osm';
import { windUniforms } from '../gfx/wind';
import { COVER_CROP, COVER_DRY, COVER_MEADOW, COVER_WOOD, GroundMask, type CoverClass } from './ground-mask';
import type { PavedArea } from './paved';
import type { ObstacleIndex } from '../geo/obstacles';
import type { WorldKit, WorldSpot } from './worldkit';
import { groundAreaBlocksKit, groundKitSlugAt } from './ground-kit-rules';
import { detailRadiusFor, planGroundCover, type GroundCoverChoice, type GroundCoverPlan, type GroundCoverVariant } from './ground-cover';

/**
 * Dettaglio di prossimità di campi e terreno.
 *
 * Il terreno del gioco è un DEM con una texture di copertura; da vicino manca
 * la materia: zolle vere, grano, stoppie, fango e balle di paglia. Questa classe
 * mette insieme tre sistemi che condividono la stessa maschera locale:
 *
 *  - zolle GLB fotogrammetriche (ruolo `ground`) sopra il DEM, scelte per
 *    copertura (prato, terra, roccia, fango);
 *  - accenti di campo GLB (ruolo `field`) nei coltivi;
 *  - grano procedurale istanziato, molto più denso dei ciuffi d'erba.
 *
 * Il grano e le zolle non sono ostacoli: l'auto ci passa dentro e li piega,
 * come l'erba. Le balle di paglia invece sono solide e finiscono in
 * `ObstacleIndex`; il fango cambia la superficie letta dalla fisica.
 */

const DETAIL_RADIUS = 72;
const REBUILD_DISTANCE = 15;
const MAX_WHEAT = 22000;
/** Quanto tempo per frame può prendersi la semina di un campo (ms). */
const WHEAT_STEP_MS = 4;
const WHEAT_HEIGHT = 1.15;
/** Il grano lontano non si distingue dall'erba: oltre questa distanza è zavorra. */
const WHEAT_RADIUS = 68;

function hash2(x: number, z: number): number {
  const value = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453;
  return value - Math.floor(value);
}

function variantEntries(kit: WorldKit, role: 'ground' | 'field' | 'bale' | 'village') {
  return kit.variants(role).map((asset, index) => ({ asset, index }));
}

function pick<T>(items: readonly T[], seed: number): T | null {
  if (items.length === 0) return null;
  return items[Math.floor(seed * items.length) % items.length] ?? null;
}

function makeWheatTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const rng = mulberry32(0x51a7);
    for (let i = 0; i < 18; i++) {
      const x = 10 + rng() * 108;
      const base = 252;
      const topY = 18 + rng() * 72;
      const bend = (rng() - 0.5) * 34;
      const width = 1.1 + rng() * 1.6;
      const hue = 42 + rng() * 12;
      ctx.strokeStyle = `hsla(${hue}, 58%, ${44 + rng() * 14}%, ${0.82 + rng() * 0.18})`;
      ctx.lineWidth = width;
      ctx.beginPath();
      ctx.moveTo(x, base);
      ctx.quadraticCurveTo(x + bend * 0.25, 120 + rng() * 30, x + bend, topY);
      ctx.stroke();
      // spiga: piccoli chicchi lungo gli ultimi 34 px
      ctx.fillStyle = `hsla(${hue - 4}, 62%, ${50 + rng() * 10}%, 0.92)`;
      for (let k = 0; k < 5; k++) {
        const t = k / 4;
        const hx = x + bend * t;
        const hy = topY + (1 - t) * 34;
        ctx.beginPath();
        ctx.ellipse(hx + (k % 2 ? 2.5 : -2.5), hy, 2.1, 4.1, 0.25, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  return texture;
}

function wheatGeometry(): THREE.BufferGeometry {
  // Due quadi incrociati bastano: il terzo aggiungeva solo overdraw e
  // fragment cost su un materiale alpha-tested.
  const planes: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 2; i++) {
    const plane = new THREE.PlaneGeometry(0.72, WHEAT_HEIGHT, 1, 1);
    plane.translate(0, WHEAT_HEIGHT / 2, 0);
    plane.rotateY((i * Math.PI) / 2);
    planes.push(plane);
  }
  const merged = mergeGeometries(planes, false);
  for (const plane of planes) plane.dispose();
  return merged;
}

function applyWheatWind(material: THREE.MeshLambertMaterial): void {
  const { uTime, uWind } = windUniforms();
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uTime;
    shader.uniforms.uWind = uWind;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform float uTime;
        uniform vec2 uWind;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        #ifdef USE_INSTANCING
          vec3 wheatPos = vec3( instanceMatrix[ 3 ][ 0 ], instanceMatrix[ 3 ][ 1 ], instanceMatrix[ 3 ][ 2 ] );
        #else
          vec3 wheatPos = vec3( 0.0 );
        #endif
        float wheatBend = clamp( position.y / ${WHEAT_HEIGHT.toFixed(3)}, 0.0, 1.0 );
        float wheatPhase = wheatPos.x * 0.21 + wheatPos.z * 0.17;
        float wheatSway = sin( uTime * 1.35 + wheatPhase ) * 0.055 + sin( uTime * 2.7 + wheatPhase * 1.7 ) * 0.018;
        transformed.x += wheatSway * wheatBend * wheatBend * uWind.x;
        transformed.z += wheatSway * wheatBend * wheatBend * uWind.y;`,
      );
  };
  material.customProgramCacheKey = () => 'wheat-field-wind-v1';
  material.needsUpdate = true;
}

/** Zolle di terreno, accenti di campo, grano e fango intorno al giocatore. */
export class WorldFieldDetail {
  readonly group = new THREE.Group();
  private readonly mask = new GroundMask(DETAIL_RADIUS);
  private readonly groundVariants: ReturnType<typeof variantEntries>;
  private readonly fieldVariants: ReturnType<typeof variantEntries>;
  private readonly smallGround: ReturnType<typeof variantEntries>;
  private readonly largeGround: ReturnType<typeof variantEntries>;
  private readonly wheat: THREE.InstancedMesh;
  private readonly dummy = new THREE.Object3D();
  private readonly wheatColor = new THREE.Color();
  private meshes: THREE.Object3D[] = [];
  private originX = Number.NaN;
  private originZ = Number.NaN;
  private density = -1;
  private budget = 0;
  private cropBudget = 0;
  private active = false;
  /** bagnato 0…1: decide quante zolle di fango entrano nel piano. */
  private wetness = 0;
  private mud: { x: number; z: number; radius: number }[] = [];
  /** metriche dell'ultimo piano: copertura, buchi, LOD e triangoli stimati. */
  private plan: GroundCoverPlan | null = null;
  private detailPlan: GroundCoverPlan | null = null;
  /** durata dell'ultima ricostruzione: misura il rischio di hitch. */
  private planMs = 0;
  /** semina in corso, divisa su più frame per non bloccare il gioco. */
  private wheatJob: {
    x: number;
    z: number;
    heights: Heightfield;
    wanted: number;
    rng: () => number;
    i: number;
    j: number;
    used: number;
    /** spighe ancora valide del campo precedente, per non svuotare il campo */
    carry: number;
  } | null = null;

  constructor(
    private readonly kit: WorldKit,
    private readonly paved: readonly PavedArea[] = [],
    private readonly surfaceAt?: (x: number, z: number) => string | null,
  ) {
    this.group.name = 'world-field-detail';
    this.groundVariants = variantEntries(this.kit, 'ground');
    this.fieldVariants = variantEntries(this.kit, 'field');
    this.smallGround = this.groundVariants.filter(({ asset }) => asset.size.x < 8);
    this.largeGround = this.groundVariants.filter(({ asset }) => asset.size.x >= 8);
    this.wheat = new THREE.InstancedMesh(
      wheatGeometry(),
      new THREE.MeshLambertMaterial({
        map: makeWheatTexture(),
        alphaTest: 0.34,
        side: THREE.DoubleSide,
        color: 0xffffff,
      }),
      MAX_WHEAT,
    );
    this.wheat.name = 'world-wheat';
    this.wheat.frustumCulled = false;
    this.wheat.castShadow = false;
    this.wheat.receiveShadow = false;
    this.wheat.count = 0;
    this.wheat.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.wheat.setColorAt(0, this.wheatColor.set(0xffffff));
    applyWheatWind(this.wheat.material as THREE.MeshLambertMaterial);
    this.group.add(this.wheat);
  }

  /**
   * Il fango è fisica, non solo un decal: sotto le ruote la superficie diventa
   * `mud` (aderenza 0,35, affondamento 0,65) solo quando la pioggia ha davvero
   * formato la pozza. Con il terreno asciutto le stesse celle sono terra.
   */
  surfaceOverride(x: number, z: number): string | null {
    for (const spot of this.mud) {
      const dx = x - spot.x;
      const dz = z - spot.z;
      if (dx * dx + dz * dz <= spot.radius * spot.radius) {
        return this.wetness > 0.25 ? 'mud' : 'dirt';
      }
    }
    return null;
  }

  /** Copertura dell'ultimo piano: diagnostica e test, non rendering. */
  coverageStats(): {
    ground: GroundCoverPlan | null;
    detail: GroundCoverPlan | null;
    milliseconds: number;
  } {
    return { ground: this.plan, detail: this.detailPlan, milliseconds: this.planMs };
  }

  /** Fattore di velocità dentro il grano (1 = campo aperto). */
  factorAt(x: number, z: number): number {
    if (!this.active) return 1;
    const fx = (x - this.mask.originX) / this.mask.cellSize;
    const fz = (z - this.mask.originZ) / this.mask.cellSize;
    if (fx < 0 || fz < 0 || fx >= this.mask.n || fz >= this.mask.n) return 1;
    const i = Math.floor(fx);
    const j = Math.floor(fz);
    const cover = this.mask.coverAt(i, j);
    if (this.mask.isBlocked(i, j)) return 1;
    return cover === COVER_CROP || cover === COVER_DRY ? 0.9 : 1;
  }

  update(
    x: number,
    z: number,
    heights: Heightfield,
    roads: RoadIndex,
    buildings: BuildingIndex,
    areas: readonly Area[],
    groundBudget: number,
    cropDensity: number,
    weather: { wetness?: number } = {},
  ): void {
    const budget = Math.max(0, Math.round(groundBudget));
    const crop = clamp(cropDensity, 0, 1);
    const wetness = clamp(weather.wetness ?? 0, 0, 1);
    if (budget <= 0 && crop <= 0.01) {
      this.setVisible(false);
      return;
    }
    this.setVisible(true);
    // La semina del frame precedente va avanti anche quando non c'è una nuova
    // ricostruzione da fare: è l'unica operazione pesante divisa a fette, e se
    // avanzasse solo dopo un rebuild il campo resterebbe a metà finché non ci
    // si allontana di 15 m.
    this.stepWheat();
    if (
      this.active &&
      Number.isFinite(this.originX) &&
      Math.hypot(x - this.originX, z - this.originZ) < this.rebuildDistance() &&
      Math.abs(budget - this.budget) < 1 &&
      Math.abs(crop - this.density) < 0.05 &&
      // il fango dipende dalla pioggia: un acquazzone deve rifare il piano,
      // una variazione di 2% no (altrimenti si ricostruisce a ogni frame)
      Math.abs(wetness - this.wetness) < 0.08
    ) {
      return;
    }
    this.wetness = wetness;
    this.originX = x;
    this.originZ = z;
    this.budget = budget;
    this.cropBudget = crop;
    // senza questo la guardia di sopra non scatta mai e l'intera maschera
    // (e il grano) viene ricostruita a ogni frame: 28 ms di CPU per frame.
    this.density = crop;
    this.active = true;
    this.mud = [];
    const startedAt = typeof performance !== 'undefined' ? performance.now() : 0;

    // Keep the entire visual/physical road cross-section clear of loose GLB
    // ground tiles; shoulders and ditches are built from the same road profile.
    this.mask.build(x, z, heights, roads, buildings, 3.4, 0.7, this.paved, areas);

    const groundSpots: WorldSpot[] = [];
    const fieldSpots: WorldSpot[] = [];
    const groundAreas = areas.filter(
      (area) =>
        area.bounds.maxX >= x - 65 &&
        area.bounds.minX <= x + 65 &&
        area.bounds.maxZ >= z - 65 &&
        area.bounds.minZ <= z + 65,
    );
    const smallCap = Math.ceil(budget * 0.18);
    const largeCap = budget - smallCap;

    // Varianti ampie in un anello di qualità scalabile: la griglia è ordinata
    // dal giocatore verso l'esterno, così il tetto per preset non lascia il
    // terreno vicino scoperto solo perché l'iterazione partiva da nord-ovest.
    // Griglia contigua, non più estrazioni casuali: ogni cella libera riceve
    // una zolla e le scale si sovrappongono dell'8%. Il raggio nasce dal budget
    // (`groundDetail`: 8/22/38/54) e arriva al massimo a 60 m.
    const largeVariants = this.groundVariantMeta(this.largeGround);
    const minimumLargeFootprint = this.largeGround.reduce(
      (size, entry) => Math.min(size, entry.asset.size.x, entry.asset.size.z),
      18,
    );
    const largeStep = Math.max(13, Math.min(18, minimumLargeFootprint * 0.92));
    this.plan = planGroundCover({
      x,
      z,
      budget: largeCap,
      spacing: largeStep,
      maxRadius: 60,
      heightAt: (sx, sz) => this.mask.heightAt(sx, sz),
      variantAt: (px, pz, seed, slopeDegrees) => {
        if (groundAreaBlocksKit(px, pz, groundAreas)) return null;
        const i = Math.floor((px - this.mask.originX) / this.mask.cellSize);
        const j = Math.floor((pz - this.mask.originZ) / this.mask.cellSize);
        if (i < 0 || j < 0 || i >= this.mask.n || j >= this.mask.n) return null;
        if (this.mask.isBlocked(i, j)) return null;
        const cover = this.mask.coverAt(i, j);
        const surface = this.surfaceAt?.(px, pz) ?? null;
        const roadDistance = roads.distanceFromRoad(px, pz);
        const chosen = this.pickGround(cover, surface, slopeDegrees, roadDistance, seed, wetness);
        if (!chosen) return null;
        const asset = largeVariants.get(chosen.index);
        if (!asset) return null;
        if (chosen.asset.slug === 'ground-mud') {
          this.mud.push({ x: px, z: pz, radius: Math.max(3, chosen.asset.size.x * 0.44) });
        }
        return { asset } satisfies GroundCoverChoice;
      },
    });
    groundSpots.push(...this.plan.spots);

    // Fotogrammetrie piccole solo come dettaglio vicino ai piedi, anch'esse su
    // griglia contigua: riempiono i buchi fra le zolle grandi dove si guarda
    // da vicino, senza spendere triangoli a 60 m.
    const smallStep = Math.max(
      4,
      Math.min(5, (this.smallGround[0]?.asset.size.x ?? 5) * 0.92),
    );
    const smallRadius = detailRadiusFor(smallCap, smallStep);
    const smallVariants = this.groundVariantMeta(this.smallGround);
    this.detailPlan = planGroundCover({
      x,
      z,
      budget: smallCap,
      spacing: smallStep,
      maxRadius: smallRadius,
      heightAt: (sx, sz) => this.mask.heightAt(sx, sz),
      lift: 0.042,
      variantAt: (px, pz, seed, slopeDegrees) => {
        if (groundAreaBlocksKit(px, pz, groundAreas)) return null;
        const i = Math.floor((px - this.mask.originX) / this.mask.cellSize);
        const j = Math.floor((pz - this.mask.originZ) / this.mask.cellSize);
        if (i < 0 || j < 0 || i >= this.mask.n || j >= this.mask.n) return null;
        if (this.mask.isBlocked(i, j)) return null;
        const cover = this.mask.coverAt(i, j);
        const surface = this.surfaceAt?.(px, pz) ?? null;
        const roadDistance = roads.distanceFromRoad(px, pz);
        if (
          !groundKitSlugAt({
            cover,
            slopeDegrees,
            distanceToRoad: roadDistance,
            surface,
            seed,
          })
        ) {
          return null;
        }
        const list = this.smallGround;
        const entry = list[Math.floor(hash2(px - 1, pz + 2) * list.length)];
        const asset = entry ? smallVariants.get(entry.index) : undefined;
        if (!asset) return null;
        return {
          asset,
          scale: 0.9 + hash2(px - 9, pz + 6) * 0.2,
          yaw: hash2(px + 7, pz - 2) * Math.PI * 2,
        } satisfies GroundCoverChoice;
      },
    });
    groundSpots.push(...this.detailPlan.spots);

    // accenti di campo: i GLB di coltivo/stoppie danno scala e materia dove il
    // grano procedurale non arriva (bordi, capezzagne, campi riposati)
    const fieldCap = Math.max(2, Math.round(8 * this.cropBudget));
    let fieldUsed = 0;
    if (this.fieldVariants.length > 0 && fieldCap > 0) {
      for (let gz = Math.ceil(this.mask.originZ / 16) * 16; gz < this.mask.originZ + this.mask.n * this.mask.cellSize; gz += 16) {
        if (fieldUsed >= fieldCap) break;
        for (let gx = Math.ceil(this.mask.originX / 16) * 16; gx < this.mask.originX + this.mask.n * this.mask.cellSize; gx += 16) {
          if (fieldUsed >= fieldCap) break;
          const seed = hash2(gx + 17, gz - 23);
          if (seed > 0.34) continue;
          const px = gx + (hash2(gx + 4, gz + 8) - 0.5) * 9;
          const pz = gz + (hash2(gx - 6, gz - 4) - 0.5) * 9;
          if (Math.hypot(px - x, pz - z) > DETAIL_RADIUS - 12) continue;
          const i = Math.floor((px - this.mask.originX) / this.mask.cellSize);
          const j = Math.floor((pz - this.mask.originZ) / this.mask.cellSize);
          if (i < 0 || j < 0 || i >= this.mask.n || j >= this.mask.n) continue;
          if (this.mask.isBlocked(i, j)) continue;
          const cover = this.mask.coverAt(i, j);
          const surface = this.surfaceAt?.(px, pz) ?? null;
          if (cover === COVER_WOOD) continue;
          if (cover === COVER_MEADOW && surface !== 'dirt') continue;
          if (heights.slopeAt(px, pz) > 9) continue;
          const chosen = this.pickField(seed, fieldUsed);
          if (!chosen) continue;
          const scale = clamp(7 / Math.max(chosen.asset.size.x, 1), 0.18, 1.15);
          fieldSpots.push({
            x: px,
            y: this.mask.heightAt(px, pz) + 0.03,
            z: pz,
            yaw: hash2(gx - 3, gz + 13) * Math.PI * 2,
            scale,
            variant: chosen.index,
          });
          fieldUsed++;
        }
      }
    }

    this.rebuildMeshes(groundSpots, fieldSpots);
    this.rebuildWheat(x, z, heights);
    if (typeof performance !== 'undefined') this.planMs = performance.now() - startedAt;
  }

  private pickField(seed: number, used: number) {
    const hero = this.fieldVariants.find(({ asset }) => asset.hero);
    if (hero && used === 0 && seed > 0.72) return hero;
    const ordinary = this.fieldVariants.filter(({ asset }) => !asset.hero);
    return pick(ordinary.length ? ordinary : this.fieldVariants, seed);
  }

  /** Metadati delle varianti per il pianificatore puro della copertura. */
  private groundVariantMeta(
    entries: ReturnType<typeof variantEntries>,
  ): Map<number, GroundCoverVariant> {
    const out = new Map<number, GroundCoverVariant>();
    for (const { asset, index } of entries) {
      out.set(index, {
        slug: asset.slug,
        footprint: Math.min(asset.size.x, asset.size.z),
        variant: index,
        triangles: asset.triangles,
      });
    }
    return out;
  }

  private pickGround(
    cover: CoverClass,
    surface: string | null,
    slopeDegrees: number,
    distanceToRoad: number,
    seed: number,
    wetness: number,
  ) {
    const slug = groundKitSlugAt({ cover, surface, slopeDegrees, distanceToRoad, seed, wetness });
    if (!slug) return null;
    const selected = this.largeGround.find(({ asset }) => asset.slug === slug);
    return selected ?? pick(this.largeGround, seed);
  }

  private rebuildMeshes(groundSpots: WorldSpot[], fieldSpots: WorldSpot[]): void {
    for (const mesh of this.meshes) this.group.remove(mesh);
    for (const mesh of this.meshes) {
      mesh.traverse((object) => {
        if (object instanceof THREE.InstancedMesh) object.dispose();
      });
    }
    this.meshes = [];
    if (groundSpots.length) {
      const ground = this.kit.instances('ground', groundSpots, { castShadow: false, receiveShadow: true });
      ground.name = 'world-ground-patches';
      this.meshes.push(ground);
      this.group.add(ground);
    }
    if (fieldSpots.length) {
      const field = this.kit.instances('field', fieldSpots, { castShadow: false, receiveShadow: true });
      field.name = 'world-field-patches';
      this.meshes.push(field);
      this.group.add(field);
    }
  }

  /**
   * Distanza oltre la quale rifare il piano.
   *
   * Il raggio di copertura nasce dal budget (`plan.radius`), quindi la soglia lo
   * segue: un preset basso copre ~22 m e non può permettersi di aspettare 26 m,
   * uno alto arriva a ~46 m e può saltare qualche metro in più. A 120 km/h ogni
   * metro in più è un hitch in meno.
   */
  private rebuildDistance(): number {
    const radius = this.plan?.radius ?? 0;
    return clamp(radius * 0.45, REBUILD_DISTANCE, 26);
  }

  /**
   * Avvia la semina di un campo. Il lavoro vero è in `stepWheat`: una griglia
   * piena di campioni di superficie e quota costa ~35 ms, che su un frame da 16
   * è uno scatto visibile. Qui si azzera soltanto lo stato del lavoro.
   */
  private rebuildWheat(x: number, z: number, heights: Heightfield): void {
    const wanted = Math.round(MAX_WHEAT * this.cropBudget);
    if (wanted < 32) {
      this.wheatJob = null;
      this.wheat.count = 0;
      return;
    }
    this.wheatJob = {
      x,
      z,
      heights,
      wanted,
      rng: mulberry32(Math.round(x * 7 + z * 11) | 1),
      i: 0,
      j: 0,
      used: 0,
      // le istanze oltre `used` sono ancora quelle del campo precedente, in
      // posizioni vere: meglio vederle che vedere il campo svuotarsi e riempirsi
      carry: this.wheat.count,
    };
    this.stepWheat(WHEAT_STEP_MS);
  }

  /**
   * Un passo di semina entro un budget di tempo. Conserva indici e stato del
   * generatore, quindi la sequenza di istanze è identica a quella del ciclo
   * unico: cambia solo in quanti frame viene distribuita.
   *
   * Ritorna `true` quando il campo è completo.
   */
  private stepWheat(budgetMs = WHEAT_STEP_MS): boolean {
    const job = this.wheatJob;
    if (!job) return true;
    const clock = typeof performance !== 'undefined' ? () => performance.now() : () => 0;
    const started = clock();
    const cell = this.mask.cellSize;
    const rng = job.rng;
    const heights = job.heights;
    while (job.used < job.wanted && job.j < this.mask.n) {
      if (job.i >= this.mask.n) {
        job.j += 1;
        job.i = 0;
        continue;
      }
      const i = job.i;
      const j = job.j;
      job.i += 1;
      if (this.mask.isBlocked(i, j)) continue;
      const cover = this.mask.coverAt(i, j);
      if (cover === COVER_WOOD) continue;
      const pz = this.mask.originZ + (j + 0.5) * cell;
      const px = this.mask.originX + (i + rng()) * cell;
      const pzJitter = pz + (rng() - 0.5) * cell;
      const surface = this.surfaceAt?.(px, pzJitter) ?? null;
      if (cover === COVER_MEADOW && surface !== 'dirt') continue;
      if (Math.hypot(px - job.x, pzJitter - job.z) > WHEAT_RADIUS) continue;
      if (rng() > 0.58 + this.cropBudget * 0.38) continue;
      const slope = heights.slopeAt(px, pzJitter);
      if (slope > 16) continue;
      const heightScale = 0.74 + rng() * 0.52;
      const spread = 0.82 + rng() * 0.34;
      this.dummy.position.set(px, this.mask.heightAt(px, pzJitter) - 0.02, pzJitter);
      this.dummy.rotation.set(0, rng() * Math.PI * 2, 0);
      this.dummy.scale.set(spread, heightScale, spread);
      this.dummy.updateMatrix();
      const used = job.used;
      this.wheat.setMatrixAt(used, this.dummy.matrix);
      const dry = cover === COVER_DRY || rng() > 0.3;
      this.wheatColor.setHSL(
        dry ? 0.13 + rng() * 0.025 : 0.2 + rng() * 0.03,
        dry ? 0.48 : 0.38,
        dry ? 0.48 + rng() * 0.1 : 0.42 + rng() * 0.09,
      );
      this.wheat.setColorAt(used, this.wheatColor);
      job.used = used + 1;
      if (clock() - started >= budgetMs) {

        // le istanze già seminate si vedono: il campo cresce invece di apparire
        // tutto insieme dopo mezzo secondo
        this.wheat.count = Math.max(job.used, Math.min(job.carry, MAX_WHEAT));
        this.wheat.instanceMatrix.needsUpdate = true;
        if (this.wheat.instanceColor) this.wheat.instanceColor.needsUpdate = true;
        return false;
      }
    }
    this.wheat.count = job.used;
    this.wheat.instanceMatrix.needsUpdate = true;
    if (this.wheat.instanceColor) this.wheat.instanceColor.needsUpdate = true;
    this.wheatJob = null;
    return true;
  }

  private setVisible(visible: boolean): void {
    this.group.visible = visible;
    if (!visible) {
      this.wheat.count = 0;
      this.wheatJob = null;
    }
  }

  dispose(): void {
    for (const mesh of this.meshes) {
      mesh.traverse((object) => {
        if (object instanceof THREE.InstancedMesh) object.dispose();
      });
    }
    this.meshes = [];
    this.wheatJob = null;
    this.wheat.geometry.dispose();
    (this.wheat.material as THREE.Material).dispose();
  }
}

/**
 * Balle di paglia sparse nei coltivi. Sono pochi oggetti ma solidi: senza una
 * voce in `ObstacleIndex` l'auto attraverserebbe una balla da 300 kg come se
 * fosse nebbia.
 */
export function buildStrawBales(
  kit: WorldKit,
  osm: { areas: readonly Area[] },
  heights: Heightfield,
  roads: RoadIndex,
  buildings: BuildingIndex,
  obstacles: ObstacleIndex,
  surfaceAt: ((x: number, z: number) => string | null) | null,
  count = 36,
): THREE.Group {
  const group = new THREE.Group();
  group.name = 'world-straw-bales';
  const variants = kit.variants('bale');
  if (variants.length === 0) return group;
  const rng = mulberry32(0xba1e5);
  const spots: WorldSpot[] = [];
  const farmland = osm.areas.filter((area) =>
    ['farmland', 'farm', 'orchard', 'vineyard', 'allotments'].includes(area.kind),
  );
  for (let attempt = 0; attempt < 3200 && spots.length < count; attempt++) {
    const angle = rng() * Math.PI * 2;
    const radius = 120 + Math.sqrt(rng()) * 1320;
    const x = START.x + Math.cos(angle) * radius;
    const z = START.z + Math.sin(angle) * radius;
    if (roads.isOnRoad(x, z, 2.5) || buildings.hitsCircle(x, z, 2.2)) continue;
    if (heights.slopeAt(x, z) > 11) continue;
    const surface = surfaceAt?.(x, z) ?? null;
    const inField = farmland.some(
      (area) =>
        x >= area.bounds.minX &&
        x <= area.bounds.maxX &&
        z >= area.bounds.minZ &&
        z <= area.bounds.maxZ &&
        pointInPolygon(x, z, area.points),
    );
    if (!inField && surface !== 'dirt') continue;
    if (spots.some((spot) => Math.hypot(spot.x - x, spot.z - z) < 22)) continue;
    const variant = Math.floor(rng() * variants.length);
    const asset = variants[variant]!;
    const scale = 0.9 + rng() * 0.18;
    const y = heights.heightAt(x, z) - 0.04;
    spots.push({ x, y, z, yaw: rng() * Math.PI * 2, scale, variant });
    obstacles.add(x, z, Math.max(0.62, asset.size.x * 0.34 * scale), 'straw-bale');
  }
  if (spots.length) {
    const meshes = kit.instances('bale', spots, { castShadow: true, receiveShadow: true });
    meshes.name = 'world-bales';
    group.add(meshes);
  }
  return group;
}

/**
 * Scene di villaggio Metazeon: fotogrammetrie larghe 150-170 m. Si cercano
 * conche o pianori lontani dal paese per non far galleggiare i tetti; sono
 * scenografie, non edifici giocabili.
 */
export function buildVillageScenes(
  kit: WorldKit,
  heights: Heightfield,
  roads: RoadIndex,
  count: number,
): THREE.Group {
  const group = new THREE.Group();
  group.name = 'world-villages';
  const variants = kit.variants('village');
  if (count <= 0 || variants.length === 0) return group;
  const rng = mulberry32(0x7e11a6e);
  const spots: WorldSpot[] = [];
  for (let attempt = 0; attempt < 500 && spots.length < Math.min(count, variants.length); attempt++) {
    const angle = rng() * Math.PI * 2;
    const radius = 1350 + rng() * 1450;
    const x = START.x + Math.cos(angle) * radius;
    const z = START.z + Math.sin(angle) * radius;
    if (roads.isOnRoad(x, z, 80)) continue;
    let min = Infinity;
    let max = -Infinity;
    for (let dz = -65; dz <= 65; dz += 26) {
      for (let dx = -65; dx <= 65; dx += 26) {
        const h = heights.heightAt(x + dx, z + dz);
        min = Math.min(min, h);
        max = Math.max(max, h);
      }
    }
    if (max - min > 9) continue;
    if (spots.some((spot) => Math.hypot(spot.x - x, spot.z - z) < 900)) continue;
    const variant = Math.floor(rng() * variants.length);
    spots.push({ x, y: min - 0.45, z, yaw: rng() * Math.PI * 2, scale: 0.94 + rng() * 0.1, variant });
  }
  if (spots.length) {
    const meshes = kit.instances('village', spots, { castShadow: false, receiveShadow: true });
    meshes.name = 'world-village-scenes';
    group.add(meshes);
  }
  return group;
}

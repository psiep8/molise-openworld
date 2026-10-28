/**
 * Cintura di montagne oltre il DEM.
 *
 * Il terreno giocabile è il DEM reale (14 × 12 km) con il mosaico Sentinel locale, ma lo
 * streaming si ferma a 1,5–3,1 km dalla camera: oltre c'è solo la nebbia. Da qui
 * l'idea dell'esempio `webgl_geometry_terrain` di Three.js, portata su un mondo
 * vero: **non** un terreno procedurale al posto del DEM, ma un anello di
 * montagne a bassa risoluzione che continua il paesaggio oltre il bordo.
 *
 * Regole che rendono l'anello invisibile come "finto":
 *
 * 1. **dentro il mondo l'altezza è il DEM**, campionato con la stessa
 *    `Heightfield`, quindi il bordo combacia invece di fare un gradino;
 * 2. **fuori dal mondo** entra un rumore frattale *ridged* (creste, non colline
 *    tonde) che cresce con la distanza dal bordo: i crinali veri del Molise
 *    possono superare i 1.000 m e qui non si inventa una pianura;
 * 3. **una sola mesh** (≈ 12.000 triangoli, una draw call) che segue la camera
 *    a scatti di poche centinaia di metri: le vette non "nuotano".
 *
 * Il materiale è Lambert con colori per vertice e la nebbia della scena attiva:
 * le montagne lontane si sciolgono nell'aria come quelle vere.
 */

import * as THREE from 'three';
import type { Heightfield } from '../geo/elevation';

/** Raggio interno: si sovrappone ai chunk già caricati, senza lasciare buchi. */
const DEFAULT_INNER = 2_000;
/** Raggio esterno: dentro il far plane della camera (12 km). */
const DEFAULT_OUTER = 11_000;
const RINGS = 34;
const SEGMENTS = 160;
/** Di quanto si sposta la camera prima di ricampionare le altezze. */
const REBUILD_STEP = 350;

const GRASS = new THREE.Color(0x6f7d52);
const FOREST = new THREE.Color(0x4e6144);
const ROCK = new THREE.Color(0x8f8d84);
const HAZE = new THREE.Color(0x9fb0bb);

/** Hash deterministico: due run diverse devono dare la stessa montagna. */
function hash2(ix: number, iz: number): number {
  let h = Math.imul(ix, 0x27d4eb2d) ^ Math.imul(iz, 0x165667b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 0xffffffff;
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

/** Rumore valore 2D in [-1, 1] (interpolazione morbida, nessuna texture). */
export function valueNoise2(x: number, z: number): number {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = smooth(x - ix);
  const fz = smooth(z - iz);
  const a = hash2(ix, iz);
  const b = hash2(ix + 1, iz);
  const c = hash2(ix, iz + 1);
  const d = hash2(ix + 1, iz + 1);
  const top = a + (b - a) * fx;
  const bottom = c + (d - c) * fx;
  return (top + (bottom - top) * fz) * 2 - 1;
}

/** Somma di ottave: le creste grandi con il dettaglio sopra. */
export function fbm2(x: number, z: number, octaves = 4): number {
  let sum = 0;
  let amplitude = 1;
  let total = 0;
  let frequency = 1;
  for (let i = 0; i < octaves; i++) {
    sum += valueNoise2(x * frequency, z * frequency) * amplitude;
    total += amplitude;
    amplitude *= 0.5;
    frequency *= 2.03;
  }
  return sum / total;
}

/**
 * Rumore "ridged": `1 - |n|` crea creste appuntite invece di dune morbide. È
 * quello che distingue una catena appenninica da una collina.
 */
export function ridged2(x: number, z: number, octaves = 4): number {
  let sum = 0;
  let amplitude = 1;
  let total = 0;
  let frequency = 1;
  for (let i = 0; i < octaves; i++) {
    const n = 1 - Math.abs(valueNoise2(x * frequency, z * frequency));
    sum += n * n * amplitude;
    total += amplitude;
    amplitude *= 0.5;
    frequency *= 2.07;
  }
  return sum / total;
}

export interface FarTerrainBounds {
  halfWidth: number;
  halfHeight: number;
  centerX: number;
  centerZ: number;
}

/** Quanto si è fuori dal rettangolo del DEM, in metri (0 dentro). */
export function distanceOutside(x: number, z: number, bounds: FarTerrainBounds): number {
  const dx = Math.max(0, Math.abs(x - bounds.centerX) - bounds.halfWidth);
  const dz = Math.max(0, Math.abs(z - bounds.centerZ) - bounds.halfHeight);
  return Math.hypot(dx, dz);
}

/**
 * Quota della cintura lontana: dentro il DEM è il DEM, fuori sono le montagne.
 * Funzione pura (nessun `THREE`) così è testabile senza WebGL.
 */
export function farHeight(x: number, z: number, heights: Heightfield, bounds: FarTerrainBounds): number {
  const base = heights.heightAt(x, z);
  const outside = distanceOutside(x, z, bounds);
  if (outside <= 0) return base;
  // la rampa evita il gradino sul bordo: 0 m al confine, piena dopo 3,5 km
  const ramp = smooth(Math.min(1, outside / 3_500));
  const ridge = ridged2(x / 5_400, z / 5_400, 4);
  const detail = fbm2(x / 1_400, z / 1_400, 3);
  const height = base + ramp * (ridge * 780 - 120) + ramp * detail * 140;
  return height;
}

export interface FarTerrainOptions {
  innerRadius?: number;
  outerRadius?: number;
}

export class FarTerrain {
  readonly group = new THREE.Group();
  private readonly geometry = new THREE.BufferGeometry();
  private readonly material: THREE.MeshLambertMaterial;
  private readonly mesh: THREE.Mesh;
  private readonly bounds: FarTerrainBounds;
  private innerRadius: number;
  private readonly outerRadius: number;
  private lastX = Number.NaN;
  private lastZ = Number.NaN;
  private built = false;

  constructor(
    private readonly heights: Heightfield,
    options: FarTerrainOptions = {},
  ) {
    const meta = heights.meta;
    this.bounds = {
      halfWidth: ((meta.nx - 1) * meta.step) / 2,
      halfHeight: ((meta.nz - 1) * meta.step) / 2,
      centerX: meta.originX + ((meta.nx - 1) * meta.step) / 2,
      centerZ: meta.originZ + ((meta.nz - 1) * meta.step) / 2,
    };
    this.innerRadius = options.innerRadius ?? DEFAULT_INNER;
    this.outerRadius = options.outerRadius ?? DEFAULT_OUTER;

    this.material = new THREE.MeshLambertMaterial({
      vertexColors: true,
      // senza questo l'anello si spegnerebbe al tramonto mentre il resto del
      // paesaggio resta illuminato dal sole
      side: THREE.FrontSide,
    });
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.name = 'far-terrain';
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;
    this.mesh.matrixAutoUpdate = true;
    // l'anello è enorme e sempre davanti alla camera: il culling per bounding
    // sphere costerebbe solo un calcolo sbagliato
    this.mesh.frustumCulled = false;
    this.group.name = 'far-terrain';
    this.group.add(this.mesh);
    this.buildIndex();
  }

  /** Triangoli della mesh (diagnostica e test). */
  get triangles(): number {
    return RINGS * SEGMENTS * 2;
  }

  get visible(): boolean {
    return this.group.visible;
  }

  setVisible(value: boolean): void {
    this.group.visible = value;
  }

  /**
   * Allinea il raggio interno al raggio di streaming del preset: con `minimal`
   * i chunk arrivano a 1,5 km, quindi l'anello deve partire da lì.
   */
  setInnerRadius(radius: number): void {
    const next = Math.max(800, Math.min(3_000, radius));
    if (Math.abs(next - this.innerRadius) < 50) return;
    this.innerRadius = next;
    this.lastX = Number.NaN;
  }

  /** Sposta e ricampiona l'anello quando la camera si è mossa abbastanza. */
  update(x: number, z: number, force = false): void {
    if (!force && this.built && Math.hypot(x - this.lastX, z - this.lastZ) < REBUILD_STEP) return;
    this.lastX = x;
    this.lastZ = z;
    this.rebuild(x, z);
    this.built = true;
  }

  private buildIndex(): void {
    const vertices = (RINGS + 1) * SEGMENTS;
    const index = new Uint32Array(RINGS * SEGMENTS * 6);
    let cursor = 0;
    for (let ring = 0; ring < RINGS; ring++) {
      for (let seg = 0; seg < SEGMENTS; seg++) {
        const next = (seg + 1) % SEGMENTS;
        const a = ring * SEGMENTS + seg;
        const b = ring * SEGMENTS + next;
        const c = (ring + 1) * SEGMENTS + seg;
        const d = (ring + 1) * SEGMENTS + next;
        // verso antiorario visto dall'alto: la faccia guarda il cielo
        index[cursor++] = a;
        index[cursor++] = b;
        index[cursor++] = c;
        index[cursor++] = b;
        index[cursor++] = d;
        index[cursor++] = c;
      }
    }
    this.geometry.setIndex(new THREE.BufferAttribute(index, 1));
    this.geometry.setAttribute(
      'position',
      new THREE.BufferAttribute(new Float32Array(vertices * 3), 3).setUsage(THREE.DynamicDrawUsage),
    );
    this.geometry.setAttribute(
      'color',
      new THREE.BufferAttribute(new Float32Array(vertices * 3), 3).setUsage(THREE.DynamicDrawUsage),
    );
    this.geometry.setAttribute(
      'normal',
      new THREE.BufferAttribute(new Float32Array(vertices * 3), 3).setUsage(THREE.DynamicDrawUsage),
    );
  }

  private rebuild(cx: number, cz: number): void {
    const position = this.geometry.getAttribute('position') as THREE.BufferAttribute;
    const color = this.geometry.getAttribute('color') as THREE.BufferAttribute;
    const pos = position.array as Float32Array;
    const col = color.array as Float32Array;
    const ratio = this.outerRadius / this.innerRadius;
    const scratch = new THREE.Color();

    let i = 0;
    for (let ring = 0; ring <= RINGS; ring++) {
      // distribuzione geometrica: fitta vicino (dove l'occhio vede il rilievo),
      // rada lontano (dove conta solo la silhouette)
      const t = ring / RINGS;
      const radius = this.innerRadius * Math.pow(ratio, t);
      for (let seg = 0; seg < SEGMENTS; seg++) {
        const angle = (seg / SEGMENTS) * Math.PI * 2;
        const x = cx + Math.cos(angle) * radius;
        const z = cz + Math.sin(angle) * radius;
        const h = farHeight(x, z, this.heights, this.bounds);
        // Sotto il terreno vero: la maglia dei chunk è più grossa del DEM
        // (9,5 m per vertice), quindi sulla cresta la superficie interpolata può
        // stare qualche metro sotto la quota esatta. Con un margine che si
        // chiude in 400 m l'anello non affiora nella fascia di sovrapposizione.
        const drop = 2 + 10 * (1 - THREE.MathUtils.smoothstep(radius, this.innerRadius, this.innerRadius + 400));
        pos[i] = x;
        pos[i + 1] = h - drop;
        pos[i + 2] = z;

        // colore per quota e distanza: prato in basso, faggeta a mezza costa,
        // roccia sui crinali, e un velo d'aria con la distanza
        const outside = distanceOutside(x, z, this.bounds);
        const altitude = h - 420;
        scratch.copy(GRASS);
        scratch.lerp(FOREST, THREE.MathUtils.smoothstep(altitude, 60, 520));
        scratch.lerp(ROCK, THREE.MathUtils.smoothstep(altitude, 620, 1_050));
        scratch.lerp(HAZE, 0.18 + 0.34 * THREE.MathUtils.smoothstep(outside, 0, 7_000));
        col[i] = scratch.r;
        col[i + 1] = scratch.g;
        col[i + 2] = scratch.b;
        i += 3;
      }
    }

    position.needsUpdate = true;
    color.needsUpdate = true;
    // le normali si ricavano dai triangoli: 6.000 vertici, una volta ogni 350 m
    this.geometry.computeVertexNormals();
    this.geometry.computeBoundingSphere();
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
    this.group.clear();
  }
}

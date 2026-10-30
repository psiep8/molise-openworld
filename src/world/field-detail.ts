import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { START } from '../config';
import type { Heightfield } from '../geo/elevation';
import { mulberry32, pointInPolygon } from '../geo/geo';
import type { Area, BuildingIndex, RoadIndex } from '../geo/osm';
import { windUniforms } from '../gfx/wind';
import { StreamedCells, type CellStreamStats, type CellWriter } from './cell-stream';
import { COVER_CROP, COVER_DRY, COVER_MEADOW, COVER_WOOD, type CoverClass } from './ground-mask';
import { AreaLookup, LocalGround } from './local-ground';
import type { PavedArea } from './paved';
import type { ObstacleIndex } from '../geo/obstacles';
import type { WorldKit, WorldSpot } from './worldkit';

/**
 * Dettaglio di prossimitÃ  di campi e terreno.
 *
 * Il terreno del gioco Ã¨ un DEM con una texture di copertura; da vicino manca
 * la materia. Qui c'Ã¨ il grano procedurale istanziato: spighe vere, fitte, che
 * ondeggiano col vento e piegano quando l'auto ci passa dentro. Le zolle GLB
 * fotogrammetriche sono state ritirate (vedi il costruttore): coprivano il
 * prato con lastre ripetute. Le balle di paglia restano solide e finiscono in
 * `ObstacleIndex`.
 *
 * Il grano era la parte piÃ¹ cara di tutta la ricostruzione (35 ms su 50) e
 * veniva riseminato per intero ogni 15 m: qui vive nelle stesse **celle
 * stabili** dell'erba (`cell-stream.ts`), con dissolvenza e budget per frame.
 */

/** Raggio del campo di grano: oltre non si distingue dall'erba. */
const WHEAT_RADIUS = 88;
/** Cella del grano: piÃ¹ grande dell'erba, i campi sono distese continue. */
const WHEAT_CELL = 16;
/** Spighe per mÂ² in un coltivo alla densitÃ  piena. */
const WHEAT_PER_M2 = 2.6;
const MAX_WHEAT = 26000;
const MAX_WHEAT_PER_CELL = 1100;
const WHEAT_HEIGHT = 0.8;

function makeWheatTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const rng = mulberry32(0x51a7);
    // PiÃ¹ spighe per ciuffo: con 18 lame su 128 px il campo sembrava un
    // insieme di bastoncini radi invece di una coltura fitta.
    for (let i = 0; i < 26; i++) {
      const x = 6 + rng() * 116;
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
        uniform vec2 uWind;
        attribute float aFade;`,
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
        transformed.z += wheatSway * wheatBend * wheatBend * uWind.y;
        // dissolvenza di cella: la spiga cresce dal suolo
        transformed *= aFade;`,
      );
  };
  material.customProgramCacheKey = () => 'wheat-field-wind-v2';
  material.needsUpdate = true;
}

/** Zolle di terreno, accenti di campo, grano e fango intorno al giocatore. */
export class WorldFieldDetail {
  readonly group = new THREE.Group();
  private readonly wheat: THREE.InstancedMesh;
  private readonly stream: StreamedCells;
  private readonly ground = new LocalGround();
  private readonly areas = new AreaLookup();
  private readonly wheatColor = new THREE.Color();
  private readonly coverage = new Map<number, CoverClass>();
  private density = 0;
  private bound = false;
  /** bagnato 0â€¦1: decide quante zolle di fango entrano nel piano. */
  private wetness = 0;
  private mud: { x: number; z: number; radius: number }[] = [];

  constructor(
    private readonly paved: readonly PavedArea[] = [],
    private readonly surfaceAt?: (x: number, z: number) => string | null,
  ) {
    this.group.name = 'world-field-detail';
    // Le zolle fotogrammetriche (18-22 m) sono state ritirate dal mondo.
    //
    // Da vicino dovevano dare materia al prato, ma erano scansioni di terra e
    // pietraia: in mezzo a un campo diventavano lastre grigie ripetute, con i
    // bordi dei triangoli visibili e il prato vero che spariva sotto. Il
    // terreno procedurale (copertura + erba a istanze) Ã¨ piÃ¹ coerente, non ha
    // cuciture e costa zero draw call. Restano il grano, le balle e i casali,
    // che sono oggetti riconoscibili e non tappeti.
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

    this.stream = new StreamedCells(
      [{ mesh: this.wheat, maxPerCell: MAX_WHEAT_PER_CELL, colored: true }],
      (cx, cz, band, writer) => this.buildCell(cx, cz, band, writer),
      {
        cellSize: WHEAT_CELL,
        radius: WHEAT_RADIUS,
        budgetMs: 1.5,
        seed: 0x51a7,
        leadSeconds: 1,
        fadeIn: 0.5,
        bandRebuild: false,
      },
    );
  }

  /**
   * Il fango Ã¨ fisica, non solo un decal: sotto le ruote la superficie diventa
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
  coverageStats(): { ground: null; detail: null; milliseconds: number } {
    return { ground: null, detail: null, milliseconds: this.stream.metrics.lastBuildMs };
  }

  /** Fattore di velocitÃ  dentro il grano (1 = campo aperto). */
  factorAt(x: number, z: number): number {
    if (this.coverage.size === 0) return 1;
    const cx = Math.floor(x / WHEAT_CELL);
    const cz = Math.floor(z / WHEAT_CELL);
    const cover = this.coverage.get((cx + 32768) * 65536 + (cz + 32768));
    if (cover === undefined) return 1;
    return cover === COVER_CROP || cover === COVER_DRY ? 0.9 : 1;
  }

  /** Diagnostica del grano a celle (`__molise`). */
  streamingStats(): CellStreamStats {
    const m = this.stream.metrics;
    return {
      ...m,
      lastBuildMs: Math.round(m.lastBuildMs * 10) / 10,
      averageBuildMs: Math.round(m.averageBuildMs * 100) / 100,
      maxBuildMs: Math.round(m.maxBuildMs * 10) / 10,
    };
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
    motion: { vx?: number; vz?: number; dt?: number } = {},
  ): void {
    const crop = Math.max(0, Math.min(1, cropDensity));
    this.wetness = Math.max(0, Math.min(1, weather.wetness ?? 0));
    if (crop <= 0.01 && groundBudget <= 0) {
      this.group.visible = false;
      return;
    }
    this.group.visible = true;
    if (!this.bound || this.heightfield !== heights) {
      this.ground.bind(heights, roads, buildings);
      this.heightfield = heights;
      this.bound = true;
    }
    this.density = crop;
    this.areas.refresh(areas);
    this.stream.setDensity(crop);
    this.stream.update(x, z, motion.vx ?? 0, motion.vz ?? 0, motion.dt ?? 1 / 60);
  }

  private heightfield: Heightfield | null = null;

  /** Grano di una cella: solo coltivi e macchie secche, mai il bosco. */
  private buildCell(cx: number, cz: number, _band: number, writer: CellWriter): void {
    const size = WHEAT_CELL;
    const ox = cx * size;
    const oz = cz * size;
    const centreX = ox + size / 2;
    const centreZ = oz + size / 2;
    const ground = this.ground;
    ground.prepare(centreX, centreZ, size * 0.75 + 6, this.areas.near(centreX, centreZ, size * 0.75 + 6), this.paved);

    // copertura del centro: una cella di grano in mezzo al prato non ha senso
    const centreCover = ground.cover(centreX, centreZ);
    this.rememberCover(cx, cz, centreCover);
    const wanted = Math.round(size * size * WHEAT_PER_M2 * this.density);
    if (wanted <= 0) return;

    writer.begin(0);
    for (let n = 0; n < wanted; n++) {
      const px = ox + writer.random() * size;
      const pz = oz + writer.random() * size;
      const cover = ground.cover(px, pz);
      if (cover === COVER_WOOD) continue;
      if (cover === COVER_MEADOW) {
        // il prato Ã¨ dell'erba: ci cresce grano solo su terra lavorata
        if ((this.surfaceAt?.(px, pz) ?? null) !== 'dirt') continue;
      }
      if (cover === COVER_CROP && writer.random() > 0.92) continue;
      if (cover === COVER_DRY && writer.random() > 0.6) continue;
      if (!ground.free(px, pz, 0.6, 0.4)) continue;
      if (ground.slope(px, pz) > 16) continue;
      const heightScale = 0.74 + writer.random() * 0.52;
      const spread = 0.82 + writer.random() * 0.34;
      if (!writer.add(
        px,
        ground.height(px, pz) - 0.02,
        pz,
        writer.random() * Math.PI * 2,
        spread,
        heightScale,
        spread,
      )) break;
      const dry = cover === COVER_DRY || writer.random() > 0.3;
      this.wheatColor.setHSL(
        dry ? 0.13 + writer.random() * 0.025 : 0.2 + writer.random() * 0.03,
        dry ? 0.48 : 0.38,
        dry ? 0.48 + writer.random() * 0.1 : 0.42 + writer.random() * 0.09,
      );
      writer.rgb(this.wheatColor.r, this.wheatColor.g, this.wheatColor.b);
    }
  }

  private rememberCover(cx: number, cz: number, cover: CoverClass): void {
    if (this.coverage.size > 4000) this.coverage.clear();
    this.coverage.set((cx + 32768) * 65536 + (cz + 32768), cover);
  }

  dispose(): void {
    this.stream.dispose();
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


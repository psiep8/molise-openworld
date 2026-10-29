import * as THREE from 'three';
import { START } from '../config';
import type { Heightfield } from '../geo/elevation';
import { boundsOf, mulberry32, pointInPolygon, type Pt } from '../geo/geo';
import type { Building, BuildingIndex, OsmData, RoadIndex } from '../geo/osm';
import type { ObstacleIndex } from '../geo/obstacles';
import type { QualityLevel } from '../gfx/quality';
import { COVER_CROP, COVER_MEADOW, COVER_WOOD, GroundMask } from './ground-mask';
import { insidePaved, type PavedArea } from './paved';
import { WorldHitField } from './world-hits';
import type { WorldAsset, WorldHitMesh, WorldKit, WorldRole, WorldSpot } from './worldkit';

/**
 * World props: il mondo riempito con i GLB del world kit.
 *
 * Il paese ha le case vere di OSM, il rilievo ha il DEM e la sua foto: quello che
 * mancava erano gli oggetti che si vedono camminando in campagna — alberi veri,
 * sottobosco, ciuffi d'erba fotografati, sassi sui pendii, un cartello su una
 * provinciale e qualche casale. Qui vengono piazzati in modo **deterministico**
 * (seed fissi, niente `Math.random`) dentro il raggio visibile da Palata, con un
 * tetto di istanze che dipende dal preset grafico.
 *
 * Regole che valgono per tutti:
 *  - niente sopra strade, marciapiedi, piazze, edifici o pendii impraticabili;
 *  - prima si piazzano le case (le loro impronte entrano nell'indice delle
 *    collisioni), poi alberi e cespugli, così nessuno cresce dentro un muro;
 *  - ogni categoria ha il suo RNG: aggiungere un cartello non cambia la
 *    posizione degli alberi già visti in una sessione precedente.
 */

export interface WorldPropBudget {
  /** alberi ad alto dettaglio (2 varianti da ~17k triangoli) */
  tree: number;
  /** sottobosco e piante basse: le varianti più leggere del vegetation pack */
  shrub: number;
  /** alberi low-poly lontani: pochi triangoli, riempiono l'orizzonte */
  distantTree: number;
  rock: number;
  sign: number;
  house: number;
  /** ciuffi d'erba fotografici intorno al giocatore */
  grass: number;
}

const BUDGETS: Record<QualityLevel, WorldPropBudget> = {
  minimal: { tree: 0, shrub: 0, distantTree: 0, rock: 0, sign: 0, house: 0, grass: 0 },
  low: { tree: 8, shrub: 150, distantTree: 240, rock: 22, sign: 4, house: 0, grass: 110 },
  medium: { tree: 22, shrub: 320, distantTree: 620, rock: 55, sign: 7, house: 2, grass: 190 },
  high: { tree: 40, shrub: 560, distantTree: 1050, rock: 90, sign: 10, house: 4, grass: 300 },
  ultra: { tree: 58, shrub: 760, distantTree: 1400, rock: 120, sign: 12, house: 6, grass: 400 },
};

export function worldPropBudget(quality: QualityLevel): WorldPropBudget {
  return BUDGETS[quality];
}

/** Raggio entro cui si pianta: oltre, il mondo è solo rilievo e foto. */
const OUTER_RADIUS = 2500;
/** Fascia attorno al centro di Palata dove non si aggiungono alberi. */
const TOWN_CLEAR = 130;
/** Distanza minima fra due casali aggiunti. */
const HOUSE_GAP = 190;
const WATER_GAP = 24;
const MAX_FOOTPRINT_RISE = 1.1;

function rotatedRect(
  cx: number,
  cz: number,
  width: number,
  depth: number,
  yaw: number,
  shrink = 0.92,
): Pt[] {
  const hw = (width * shrink) / 2;
  const hd = (depth * shrink) / 2;
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  const corner = (x: number, z: number): Pt => ({
    x: cx + x * c + z * s,
    z: cz - x * s + z * c,
  });
  return [corner(-hw, -hd), corner(hw, -hd), corner(hw, hd), corner(-hw, hd)];
}

function footprint(points: Pt[], height: number): Building {
  const bounds = boundsOf(points);
  return {
    height,
    points,
    bounds,
    area: Math.max(1, (bounds.maxX - bounds.minX) * (bounds.maxZ - bounds.minZ)),
  };
}

/**
 * Rotazione che mette il **fronte** del cartello contro il senso di marcia.
 *
 * Le facce leggibili dei cinque cartelli del pack stanno sul lato -X locale (a
 * `yaw = 0` si vedono di taglio da davanti): con questa rotazione il vettore
 * `(-1, 0, 0)` ruotato finisce su `(-tx, -tz)`, cioè verso chi arriva.
 */
export function signYaw(tx: number, tz: number): number {
  return Math.atan2(-tz, tx);
}

function localRise(heights: Heightfield, points: readonly Pt[]): number {
  let min = heights.heightAt(points[0]!.x, points[0]!.z);
  let max = min;
  for (let i = 1; i < points.length; i++) {
    const h = heights.heightAt(points[i]!.x, points[i]!.z);
    if (h < min) min = h;
    if (h > max) max = h;
  }
  return max - min;
}

/** Distanza dal corso d'acqua più vicino (solo per i casali, pochi tentativi). */
function distanceToWater(osm: OsmData, x: number, z: number, limit: number): number {
  let best = limit * limit;
  for (const water of osm.waterways) {
    for (const p of water.points) {
      const dx = p.x - x;
      const dz = p.z - z;
      const d2 = dx * dx + dz * dz;
      if (d2 < best) best = d2;
    }
  }
  return Math.sqrt(best);
}

/** Varianti utilizzabili: le più leggere, per non pagare troppi shader diversi. */
function lightVariants(kit: WorldKit, role: WorldRole, maxVariants: number, maxTris: number): WorldAsset[] {
  return kit
    .variants(role)
    .filter((asset) => asset.triangles <= maxTris)
    .sort((a, b) => a.triangles - b.triangles)
    .slice(0, maxVariants);
}

export interface WorldPropsResult {
  group: THREE.Group;
  trees: number;
  shrubs: number;
  distantTrees: number;
  rocks: number;
  signs: number;
  houses: number;
  /** alberi e cartelli che reagiscono all'urto dell'auto */
  hits: WorldHitField;
  /** macchie di sottobosco che rallentano chi cammina dentro */
  shrubField: WorldShrubField;
}

/**
 * Piazzamento di alberi, sottobosco, sassi, cartelli e casali.
 *
 * Va chiamata **dopo** i casali del city kit ma **prima** di vegetazione, erba e
 * alberi procedurali: le impronte delle case qui aggiunte devono essere già
 * nell'indice, altrimenti ci cresce sopra un bosco.
 */
export function buildWorldProps(
  osm: OsmData,
  heights: Heightfield,
  roads: RoadIndex,
  buildings: BuildingIndex,
  obstacles: ObstacleIndex,
  kit: WorldKit,
  quality: QualityLevel,
  paved: readonly PavedArea[] = [],
): WorldPropsResult {
  const group = new THREE.Group();
  group.name = 'world-props';
  const budget = worldPropBudget(quality);
  const empty: WorldPropsResult = {
    group,
    trees: 0,
    shrubs: 0,
    distantTrees: 0,
    rocks: 0,
    signs: 0,
    houses: 0,
    hits: new WorldHitField(),
    shrubField: new WorldShrubField([], []),
  };
  if (!kit) return empty;

  const trees = lightVariants(kit, 'tree', 2, 60000);
  const shrubs = lightVariants(kit, 'shrub', 12, 1400);
  const distant = lightVariants(kit, 'tree-distant', 6, 400);
  const rocks = lightVariants(kit, 'rock', 5, 5000);
  // i cartelli europei fotografici sono 3,7–4,8k triangoli: con il vecchio
  // tetto a 2.000 restavano fuori e si vedevano solo le sagome low-poly
  const signs = lightVariants(kit, 'sign', 8, 6000);
  const houses = kit.variants('house').slice(0, 1);

  const treeSpots: WorldSpot[] = [];
  const shrubSpots: WorldSpot[] = [];
  const distantSpots: WorldSpot[] = [];
  const rockSpots: WorldSpot[] = [];
  const signSpots: WorldSpot[] = [];
  const houseSpots: WorldSpot[] = [];

  const rng = mulberry32(0x7a12c3);
  const treeRng = mulberry32(0x11e3);
  const shrubRng = mulberry32(0x5ab2);
  const distantRng = mulberry32(0x2211);
  const rockRng = mulberry32(0x9fc4);
  const signRng = mulberry32(0x3bd7);
  const houseRng = mulberry32(0x44e1);

  const fromHome = (x: number, z: number): number => Math.hypot(x - START.x, z - START.z);

  const free = (x: number, z: number, pad: number): boolean => {
    if (fromHome(x, z) > OUTER_RADIUS) return false;
    if (roads.isOnRoad(x, z, pad)) return false;
    if (buildings.hitsCircle(x, z, pad + 1.2)) return false;
    if (insidePaved(x, z, paved)) return false;
    return true;
  };

  const addTree = (x: number, z: number, scale: number): void => {
    if (trees.length === 0 || treeSpots.length >= budget.tree) return;
    if (!free(x, z, 1.4)) return;
    if (heights.slopeAt(x, z) > 30) return;
    if (treeSpots.some((spot) => Math.hypot(spot.x - x, spot.z - z) < 8)) return;
    const variant = Math.floor(treeRng() * trees.length);
    treeSpots.push({
      x,
      y: heights.heightAt(x, z) - 0.05,
      z,
      yaw: treeRng() * Math.PI * 2,
      scale,
      variant,
    });
    // il tronco è solido: senza questo l'auto attraversa un albero di 10 m.
    // Raggio stretto (non la chioma) così si passa sotto i rami bassi
    const asset = trees[variant]!;
    obstacles.add(x, z, Math.max(0.22, Math.min(0.45, asset.size.x * 0.22)) * scale, 'world-tree');
  };

  const addShrub = (x: number, z: number, scale: number): void => {
    if (shrubs.length === 0 || shrubSpots.length >= budget.shrub) return;
    if (!free(x, z, 0.6)) return;
    if (heights.slopeAt(x, z) > 32) return;
    shrubSpots.push({
      x,
      y: heights.heightAt(x, z) - 0.03,
      z,
      yaw: shrubRng() * Math.PI * 2,
      scale,
      variant: Math.floor(shrubRng() * shrubs.length),
    });
  };

  const addDistant = (x: number, z: number, scale: number): void => {
    if (distant.length === 0 || distantSpots.length >= budget.distantTree) return;
    if (!free(x, z, 1.2)) return;
    const variant = Math.floor(distantRng() * distant.length);
    distantSpots.push({
      x,
      y: heights.heightAt(x, z) - 0.06,
      z,
      yaw: distantRng() * Math.PI * 2,
      scale,
      variant,
    });
    // anche le sagome lontane sono alberi veri: il tronco ferma l'auto, la
    // chioma no (sono low-poly da 5–8 m, si passa sotto senza problemi)
    obstacles.add(x, z, Math.max(0.2, distant[variant]!.size.x * 0.12) * scale, 'world-tree-far');
  };

  const addRock = (x: number, z: number, scale: number): void => {
    if (rocks.length === 0 || rockSpots.length >= budget.rock) return;
    if (!free(x, z, 0.9)) return;
    if (heights.slopeAt(x, z) < 7) return;
    const variant = Math.floor(rockRng() * rocks.length);
    rockSpots.push({
      x,
      y: heights.heightAt(x, z) - 0.12 * scale,
      z,
      yaw: rockRng() * Math.PI * 2,
      scale,
      variant,
    });
    const asset = rocks[variant]!;
    obstacles.add(x, z, Math.max(0.35, Math.min(asset.size.x, asset.size.z) * 0.35) * scale, 'world-rock');
  };

  // ---------------------------------------------------------------------------
  // 1. Ciglio delle strade: alberi veri nei tratti aperti, sottobosco sempre
  // ---------------------------------------------------------------------------
  for (const road of osm.roads) {
    if (treeSpots.length >= budget.tree && shrubSpots.length >= budget.shrub) break;
    if (road.width < 3.2 || road.points.length < 2) continue;
    let since = 30 + rng() * 120;
    for (let i = 1; i < road.points.length; i++) {
      const a = road.points[i - 1]!;
      const b = road.points[i]!;
      const seg = Math.hypot(b.x - a.x, b.z - a.z);
      if (seg < 1e-3) continue;
      since += seg;
      if (since < 60) continue;
      since = 0;
      const tx = (b.x - a.x) / seg;
      const tz = (b.z - a.z) / seg;
      const side = rng() < 0.5 ? 1 : -1;
      const off = road.width / 2 + 4 + rng() * 6;
      const x = b.x - tz * side * off;
      const z = b.z + tx * side * off;
      if (fromHome(x, z) < TOWN_CLEAR) continue;
      // albero vero solo ogni tanto: due varianti da 17k triangoli non possono
      // fare da filare, e il paesaggio ha già 14.000 alberi procedurali
      if (rng() < 0.22) addTree(x, z, 0.9 + rng() * 0.3);
      if (shrubRng() < 0.75) addShrub(x + (rng() - 0.5) * 5, z + (rng() - 0.5) * 5, 0.8 + rng() * 0.6);
    }
  }

  // ---------------------------------------------------------------------------
  // 2. Boschi e macchie OSM: il sottobosco è quello che manca al terreno
  // ---------------------------------------------------------------------------
  const TREE_KINDS = new Set(['wood', 'forest', 'scrub', 'orchard', 'park']);
  for (const area of osm.areas) {
    if (!TREE_KINDS.has(area.kind)) continue;
    if (shrubSpots.length >= budget.shrub && distantSpots.length >= budget.distantTree) break;
    const b = area.bounds;
    const step = area.kind === 'orchard' ? 16 : 14;
    const chance = area.kind === 'wood' || area.kind === 'forest' ? 0.34 : area.kind === 'orchard' ? 0.28 : 0.18;
    for (let z = b.minZ; z <= b.maxZ; z += step) {
      for (let x = b.minX; x <= b.maxX; x += step) {
        const px = x + (rng() - 0.5) * step;
        const pz = z + (rng() - 0.5) * step;
        if (!pointInPolygon(px, pz, area.points)) continue;
        if (rng() > chance) continue;
        addShrub(px, pz, 0.8 + rng() * 0.7);
        if (rng() < 0.06) addTree(px, pz, 0.85 + rng() * 0.4);
        if (rng() < 0.55) addDistant(px + (rng() - 0.5) * 8, pz + (rng() - 0.5) * 8, 0.9 + rng() * 0.5);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // 3. Campi, crinali e cigli: macchie sparse, sassi sulle pendenze
  // ---------------------------------------------------------------------------
  const cell = 46;
  for (let z = -OUTER_RADIUS; z <= OUTER_RADIUS; z += cell) {
    for (let x = -OUTER_RADIUS; x <= OUTER_RADIUS; x += cell) {
      if (shrubSpots.length >= budget.shrub && distantSpots.length >= budget.distantTree) break;
      const px = x + (rng() - 0.5) * cell;
      const pz = z + (rng() - 0.5) * cell;
      const distance = fromHome(px, pz);
      if (distance < TOWN_CLEAR || distance > OUTER_RADIUS) continue;
      if (rng() < 0.26) addShrub(px, pz, 0.75 + rng() * 0.6);
      else if (rng() < 0.03) addTree(px, pz, 0.8 + rng() * 0.5);
      if (distance > 380 && rng() < 0.34) {
        addDistant(px + (rng() - 0.5) * 26, pz + (rng() - 0.5) * 26, 0.8 + rng() * 0.6);
      }
      if (rng() < 0.16) addRock(px + (rng() - 0.5) * 18, pz + (rng() - 0.5) * 18, 0.6 + rng() * 0.9);
    }
  }

  // ---------------------------------------------------------------------------
  // 4. Cartelli lungo le provinciali (pochi, con collisione sul palo)
  // ---------------------------------------------------------------------------
  if (signs.length > 0 && budget.sign > 0) {
    for (const road of osm.roads) {
      if (signSpots.length >= budget.sign) break;
      if (road.width < 4.4 || road.points.length < 2) continue;
      let since = 200 + signRng() * 400;
      for (let i = 1; i < road.points.length && signSpots.length < budget.sign; i++) {
        const a = road.points[i - 1]!;
        const b = road.points[i]!;
        const seg = Math.hypot(b.x - a.x, b.z - a.z);
        if (seg < 1e-3) continue;
        since += seg;
        if (since < 780) continue;
        since = 0;
        const tx = (b.x - a.x) / seg;
        const tz = (b.z - a.z) / seg;
        const side = signRng() < 0.5 ? 1 : -1;
        const off = road.width / 2 + 7 + signRng() * 5;
        const x = b.x - tz * side * off;
        const z = b.z + tx * side * off;
        const distance = fromHome(x, z);
        if (distance < TOWN_CLEAR + 200 || distance > 2300) continue;
        if (!free(x, z, 2)) continue;
        if (heights.slopeAt(x, z) > 10) continue;
        // il cartello guarda chi arriva, non la carreggiata: di profilo non si
        // leggerebbe niente (vedi `signYaw`)
        const yaw = signYaw(tx, tz);
        signSpots.push({
          x,
          y: heights.heightAt(x, z),
          z,
          yaw,
          scale: 0.9 + signRng() * 0.2,
          variant: Math.floor(signRng() * signs.length),
        });
        obstacles.add(x, z, 0.45, 'sign');
      }
    }
  }

  // ---------------------------------------------------------------------------
  // 5. Casali di campagna: pochi, con impronta solida e piazzale libero
  // ---------------------------------------------------------------------------
  if (houses.length > 0 && budget.house > 0) {
    const asset = houses[0]!;
    for (const road of osm.roads) {
      if (houseSpots.length >= budget.house) break;
      if (road.width < 3 || road.points.length < 2) continue;
      let since = 300 + houseRng() * 500;
      for (let i = 1; i < road.points.length && houseSpots.length < budget.house; i++) {
        const a = road.points[i - 1]!;
        const b = road.points[i]!;
        const seg = Math.hypot(b.x - a.x, b.z - a.z);
        if (seg < 1e-3) continue;
        since += seg;
        if (since < 640) continue;
        since = 0;
        const tx = (b.x - a.x) / seg;
        const tz = (b.z - a.z) / seg;
        const side = houseRng() < 0.5 ? 1 : -1;
        const off = road.width / 2 + 16 + houseRng() * 14;
        const x = b.x - tz * side * off;
        const z = b.z + tx * side * off;
        const distance = fromHome(x, z);
        if (distance < 420 || distance > 2300) continue;
        if (houseSpots.some((spot) => Math.hypot(spot.x - x, spot.z - z) < HOUSE_GAP)) continue;
        if (!free(x, z, 10)) continue;
        const scale = 0.94 + houseRng() * 0.2;
        const yaw = Math.atan2(tx, tz) + (houseRng() < 0.5 ? 0 : Math.PI) + (houseRng() - 0.5) * 0.2;
        const points = rotatedRect(x, z, asset.size.x * scale, asset.size.z * scale, yaw);
        if (localRise(heights, points) > MAX_FOOTPRINT_RISE) continue;
        if (heights.slopeAt(x, z) > 8) continue;
        if (distanceToWater(osm, x, z, WATER_GAP) < WATER_GAP) continue;
        houseSpots.push({
          x,
          y: heights.heightAt(x, z) - 0.08,
          z,
          yaw,
          scale,
          variant: 0,
        });
        buildings.add(footprint(points, asset.size.y * scale));
        obstacles.add(x, z, Math.max(asset.size.x, asset.size.z) * 0.42, 'world-house');
      }
    }
  }

  // ---------------------------------------------------------------------------
  // 6. Istanze
  // ---------------------------------------------------------------------------
  // alberi, cespugli e cartelli tengono un attributo di urto per istanza:
  // l'auto che li prende li fa piegare (vedi `world/world-hits.ts`). Per i
  // cespugli non c'è collisione, solo l'onda visiva del passaggio.
  const treeHits: WorldHitMesh[] = [];
  const shrubHits: WorldHitMesh[] = [];
  const signHits: WorldHitMesh[] = [];
  if (treeSpots.length) group.add(kit.instances('tree', treeSpots, { castShadow: true, hits: treeHits }));
  if (shrubSpots.length) group.add(kit.instances('shrub', shrubSpots, { castShadow: false, hits: shrubHits }));
  if (distantSpots.length) group.add(kit.instances('tree-distant', distantSpots, { castShadow: false }));
  if (rockSpots.length) group.add(kit.instances('rock', rockSpots, { castShadow: true }));
  if (signSpots.length) group.add(kit.instances('sign', signSpots, { castShadow: true, hits: signHits }));
  if (houseSpots.length) group.add(kit.instances('house', houseSpots, { castShadow: true }));

  const hits = new WorldHitField();
  hits.register('tree', treeSpots, treeHits);
  hits.register('shrub', shrubSpots, shrubHits);
  hits.register('sign', signSpots, signHits);

  return {
    group,
    trees: treeSpots.length,
    shrubs: shrubSpots.length,
    distantTrees: distantSpots.length,
    rocks: rockSpots.length,
    signs: signSpots.length,
    houses: houseSpots.length,
    hits,
    shrubField: new WorldShrubField(shrubSpots, shrubs),
  };
}

/**
 * Sottobosco attraversabile: rallenta il passo di chi ci cammina dentro.
 *
 * Il tappeto procedurale ha già `ScatterVegetation.movementFactorAt`, ma i
 * cespugli del world kit sono istanze a parte: senza questo si attraverserebbero
 * felci e rovi alla stessa velocità dell'asfalto. Non sono ostacoli (l'auto e il
 * pedone ci passano), solo attrito: griglia spaziale da 8 m, 0,55 nel folto.
 */
export class WorldShrubField {
  private readonly cell = 8;
  private readonly grid = new Map<number, { x: number; z: number; radius: number }[]>();

  constructor(spots: readonly WorldSpot[], assets: readonly WorldAsset[]) {
    for (const spot of spots) {
      const asset = assets[spot.variant ?? 0];
      if (!asset) continue;
      const radius = Math.max(0.35, Math.max(asset.size.x, asset.size.z) * 0.4) * (spot.scale ?? 1);
      const key = this.key(Math.floor(spot.x / this.cell), Math.floor(spot.z / this.cell));
      const list = this.grid.get(key);
      const entry = { x: spot.x, z: spot.z, radius };
      if (list) list.push(entry);
      else this.grid.set(key, [entry]);
    }
  }

  private key(cx: number, cz: number): number {
    return (cx + 8192) * 16384 + (cz + 8192);
  }

  /** 1 = passo libero, 0,55 = dentro una macchia. */
  factorAt(x: number, z: number): number {
    if (this.grid.size === 0) return 1;
    const cx = Math.floor(x / this.cell);
    const cz = Math.floor(z / this.cell);
    for (let ix = cx - 1; ix <= cx + 1; ix++) {
      for (let iz = cz - 1; iz <= cz + 1; iz++) {
        const list = this.grid.get(this.key(ix, iz));
        if (!list) continue;
        for (const entry of list) {
          if (Math.hypot(x - entry.x, z - entry.z) < entry.radius) return 0.55;
        }
      }
    }
    return 1;
  }
}

const GRASS_RADIUS = 34;
/** Ciuffi veri richiesti a densità piena (poi ridotti dal preset). */
const GRASS_MAX = 400;

/**
 * Erba fotografata intorno al giocatore.
 *
 * L'erba procedurale (`world/grass.ts`) fa il tappeto con 180.000 piccoli
 * ciuffi: qui si aggiungono poche centinaia di ciuffi veri, modellati, che si
 * vedono quando ci si ferma a guardare l'erba da mezzo metro. Il campo si
 * ricostruisce quando ci si allontana, come quello procedurale, ma con numeri
 * molto più piccoli (max 400 istanze su ultra).
 */
export class WorldGrass {
  readonly group = new THREE.Group();
  private readonly mask = new GroundMask(GRASS_RADIUS);
  private readonly valid: Uint32Array;
  private meshes: THREE.Object3D[] = [];
  private originX = Number.NaN;
  private originZ = Number.NaN;
  private density = -1;
  private readonly variants: WorldAsset[];
  /** Superficie landcover: evita ciuffi verdi sopra un campo arato. */
  private surfaceAt: ((x: number, z: number) => string | null) | null = null;

  constructor(
    private readonly kit: WorldKit,
    private readonly paved: readonly PavedArea[] = [],
  ) {
    this.valid = new Uint32Array(this.mask.n * this.mask.n);
    this.variants = kit
      .variants('grass')
      .filter((asset) => asset.triangles <= 2500)
      .sort((a, b) => a.triangles - b.triangles)
      .slice(0, 7);
    this.group.name = 'world-grass';
  }

  /** Collega la classificazione landcover alla distribuzione dei ciuffi. */
  setSurfaceProvider(provider: ((x: number, z: number) => string | null) | null): void {
    this.surfaceAt = provider;
  }

  update(
    x: number,
    z: number,
    heights: Heightfield,
    roads: RoadIndex,
    buildings: BuildingIndex,
    density: number,
    areas: OsmData['areas'] = [],
  ): void {
    if (this.variants.length === 0) return;
    const d = Math.max(0, Math.min(1, density));
    if (d <= 0.01) {
      for (const mesh of this.meshes) mesh.visible = false;
      return;
    }
    for (const mesh of this.meshes) mesh.visible = true;
    if (
      Number.isFinite(this.originX) &&
      Math.hypot(x - this.originX, z - this.originZ) < 12 &&
      Math.abs(d - this.density) < 0.12
    ) {
      return;
    }
    this.originX = x;
    this.originZ = z;
    this.density = d;

    this.mask.build(x, z, heights, roads, buildings, 0.6, 0.3, this.paved, areas);
    const n = this.mask.n;
    const cell = this.mask.cellSize;
    let count = 0;
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        if (!this.mask.isBlocked(i, j)) this.valid[count++] = j * n + i;
      }
    }
    if (count === 0) return;

    const wanted = Math.round(GRASS_MAX * d);
    const rng = mulberry32(Math.round(x * 13 + z * 7) | 1);
    const spots: WorldSpot[] = [];
    for (let placed = 0; placed < wanted; placed++) {
      const idx = this.valid[Math.floor(rng() * count)]!;
      const i = idx % n;
      const j = (idx - i) / n;
      const px = this.mask.originX + (i + rng()) * cell;
      const pz = this.mask.originZ + (j + rng()) * cell;
      const distance = Math.hypot(px - x, pz - z);
      if (distance > GRASS_RADIUS) continue;
      // niente ciuffi veri su un campo arato o sulla macchia secca: l'erba
      // fotografata segue la copertura reale del suolo, non un disco uniforme
      const cover = this.mask.coverAt(i, j);
      const coverChance =
        cover === COVER_MEADOW ? 1 : cover === COVER_WOOD ? 0.62 : cover === COVER_CROP ? 0.16 : 0.06;
      if (rng() > coverChance) continue;
      // il landcover è più preciso delle aree OSM: su terra nuda o roccia
      // restano solo poche erbacce, non un prato completo
      const surface = this.surfaceAt?.(px, pz);
      if (surface === 'dirt' && rng() > 0.04) continue;
      if (surface === 'rock' && rng() > 0.02) continue;
      // vicino ai piedi i ciuffi contano; sul bordo del raggio sarebbero
      // puntini sparsi: densità decrescente come nel tappeto procedurale
      if (distance > GRASS_RADIUS * 0.55 && rng() > 0.55) continue;
      spots.push({
        x: px,
        y: this.mask.heightAt(px, pz) - 0.02,
        z: pz,
        yaw: rng() * Math.PI * 2,
        scale: 0.65 + rng() * 0.65,
        variant: Math.floor(rng() * this.variants.length),
      });
    }

    for (const mesh of this.meshes) this.group.remove(mesh);
    this.meshes = [];
    if (spots.length) {
      const group = this.kit.instances('grass', spots, { castShadow: false, receiveShadow: true });
      this.meshes.push(group);
      this.group.add(group);
    }
  }

  dispose(): void {
    for (const mesh of this.meshes) this.group.remove(mesh);
    this.meshes = [];
  }
}

import * as THREE from 'three';
import type { Heightfield } from '../geo/elevation';
import { mulberry32, type Pt } from '../geo/geo';
import type { BuildingIndex, OsmData, RoadIndex } from '../geo/osm';
import { pbr } from '../gfx/textures';
import { resample } from './roads';

/**
 * Geometria di contorno del paesaggio: i confini che nelle foto satellite si
 * vedono ma che il DEM non ha.
 *
 * Tre famiglie, tutte derivate da dati reali (nessuna invenzione):
 *
 * - **muretti a secco** sui confini di campo: gli anelli OSM (`meadow`,
 *   `grassland`, `wood`, `scrub`) e i confini estratti dal landcover
 *   (`parcels.json`, dove la classe di copertura cambia senza poligone OSM)
 *   — stessi conci del modulo `dry-stone`;
 * - **recinzioni** attorno a vigne, frutteti e aie (`vineyard`, `orchard`,
 *   `farmyard`): pali in legno con due fili, tipici dei poderi;
 * - **fossi** lungo i corsi d'acqua minori (`waterway=ditch`): una sezione a
 *   V campionata sul DEM, con rive rialzate di ~28 cm e letto fangoso, sotto
 *   il nastro d'acqua che `buildWater` ci mette già sopra.
 *
 * Ogni postazione usa gli stessi filtri delle altre strutture del gioco: non
 * si piazza sull'asfalto, dentro un edificio, o su pendenze dove un muro non
 * starebbe in piedi. Le tre mesh sono tre draw call totali.
 */

// 24.000 conci = ~290k triangoli in una draw call: il cordolo stradale da solo
// ne fa 600k, quindi il budget c'è — e un cap più basso troncherebbe i muri
// a metà confine invece di tagliarne interi
export const MAX_WALL_BLOCKS = 24000;
export const MAX_POSTS = 4000;
export const MAX_RAILS = 8000;

/** Poligoni che in Molise finiscono con un muretto sul confine. */
const WALL_KINDS = new Set(['meadow', 'grassland', 'wood', 'scrub']);
/** Poligoni che in Molise finiscono con una recensione/filare. */
const FENCE_KINDS = new Set(['vineyard', 'orchard', 'farmyard']);

export interface BoundarySample {
  x: number;
  z: number;
  /**
   * `rotation.y` che allinea un box lungo sull'asse X alla direzione di
   * marcia del lato: `atan2(-tz, tx)`. (Non `atan2(tx, tz)`: quella mette
   * il box di traverso rispetto al lato — vedi dry-stone.ts.)*
   */
  yaw: number;
}

/**
 * Confini di campo estratti da `npm run landcover` (parcels.json): celle
 * della griglia fusa a 4 m dove la classe di copertura cambia. Ogni
 * elemento di `w`/`f` è una tripla `[i, j, d]`: il segmento è il bordo condiviso
 * tra la cella (i,j) e la sua destra (d=0) o la sua sotto (d=1), in unità
 * di griglia. `w` = confine con il bosco (muretto), `f` = confine tra campi.
 */
export interface Parcels {
  generatedAt?: string;
  cell: number;
  originX: number;
  originZ: number;
  w: number[];
  f: number[];
}

/**
 * Carica i confini di campo se esistono (opzionale: senza landcover il gioco
 * parte lo stesso e i muretti restano quelli degli anelli OSM).
 */
export async function loadParcels(base = './geo/'): Promise<Parcels | null> {
  try {
    const res = await fetch(`${base}landcover/parcels.json`);
    if (!res.ok) return null;
    const json = (await res.json()) as Parcels;
    if (typeof json?.cell !== 'number' || !Array.isArray(json?.w) || !Array.isArray(json?.f)) {
      return null;
    }
    return json;
  } catch {
    return null;
  }
}

/**
 * Anelli chiusi i cui vertici hanno lunghezza `>= 3` e la classe è in `kinds`.
 * Funzione pura: è il filtro che decide dove può nascere una geometria.
 */
export function boundaryRings(
  areas: readonly { kind: string; points: readonly Pt[] }[],
  kinds: ReadonlySet<string>,
): Pt[][] {
  const out: Pt[][] = [];
  for (const area of areas) {
    if (!kinds.has(area.kind)) continue;
    if (area.points.length < 3) continue;
    out.push(area.points as Pt[]);
  }
  return out;
}

/**
 * Campione un tratto di percorso a passo costante. `closed` chiude l'ultimo
 * lato sul primo vertice (anello); altrimenti il residuo del passo si perde
 * alla fine (polilinea aperta). Il residuo passa da un lato al successivo,
 * così i campioni restano uniformi anche tra lati di lunghezza diversa.
 */
function walkPath(points: readonly Pt[], step: number, closed: boolean): BoundarySample[] {
  const out: BoundarySample[] = [];
  const n = points.length;
  const edges = closed ? n : n - 1;
  let next = 0; // distanza del prossimo campione dall'inizio del lato corrente
  for (let i = 0; i < edges; i++) {
    const a = points[i]!;
    const b = points[(i + 1) % n]!;
    const seg = Math.hypot(b.x - a.x, b.z - a.z);
    if (seg < 1e-6) continue;
    const tx = (b.x - a.x) / seg;
    const tz = (b.z - a.z) / seg;
    // rotazione che allinea il box (lungo X) al lato: vedi BoundarySample
    const yaw = Math.atan2(-tz, tx);
    let s = next;
    while (s < seg - 1e-6) {
      out.push({ x: a.x + tx * s, z: a.z + tz * s, yaw });
      s += step;
    }
    next = s - seg;
  }
  return out;
}

/**
 * Campiona l'intero perimetro di un anello con passo costante, chiudendo
 * l'ultimo lato sul primo vertice e portando il resto del passo da un lato
 * al successivo (così due anelli adiacenti con lati sfasati restano comunque
 * uniformi). Funzione pura, testata in `tests/field-boundaries.test.ts`.
 */
export function boundarySamples(ring: readonly Pt[], step: number): BoundarySample[] {
  return walkPath(ring, step, true);
}

/** Come `boundarySamples` ma per una polilinea aperta (non chiude il giro). */
export function polylineSamples(path: readonly Pt[], step: number): BoundarySample[] {
  return walkPath(path, step, false);
}

/** Griglia grezza per il controllo di duplicato tra anelli confinanti. */
function cellKey(x: number, z: number): string {
  return `${Math.round(x / 3)},${Math.round(z / 3)}`;
}

interface PlacedMatrix {
  matrix: THREE.Matrix4;
  tint: THREE.Color;
}

function pushInstance(
  list: PlacedMatrix[],
  dummy: THREE.Object3D,
  tint: THREE.Color,
  max: number,
): boolean {
  if (list.length >= max) return false;
  list.push({ matrix: dummy.matrix.clone(), tint: tint.clone() });
  return true;
}

function makeInstanced(
  geo: THREE.BufferGeometry,
  mat: THREE.Material,
  list: PlacedMatrix[],
  name: string,
): THREE.InstancedMesh | null {
  if (!list.length) return null;
  const mesh = new THREE.InstancedMesh(geo, mat, list.length);
  mesh.name = name;
  for (let i = 0; i < list.length; i++) {
    mesh.setMatrixAt(i, list[i]!.matrix);
    mesh.setColorAt(i, list[i]!.tint);
  }
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

/**
 * Muretti e recinzioni sui confini di campo, fossi lungo i fossi veri.
 * Restituisce sempre un gruppo (vuoto se i dati non ci sono): il chiamante
 * lo aggiunge alla scena senza condizioni.
 */
export function buildFieldBoundaries(
  osm: OsmData,
  heights: Heightfield,
  roads: RoadIndex,
  buildings: BuildingIndex,
  renderer: THREE.WebGLRenderer,
  parcels: Parcels | null = null,
): THREE.Group {
  const group = new THREE.Group();
  group.name = 'field-boundaries';
  const rng = mulberry32(0x5ea1);
  const dummy = new THREE.Object3D();
  const tint = new THREE.Color();

  const wallCells = new Set<string>();
  const fenceCells = new Set<string>();
  const walls: PlacedMatrix[] = [];
  const posts: PlacedMatrix[] = [];
  const rails: PlacedMatrix[] = [];
  const stoneBase = new THREE.Color(0xd6cab4);
  const woodBase = new THREE.Color(0x6f5f4a);

  // ---- muretti a secco: prima sugli anelli OSM, poi sui confini ----------
  // stessa `wallCells` per entrambe le sorgenti: dove i due confini si
  // sovrappongono il secondo viene buttato invece di piazzare un concio doppio
  const placeWall = (s: BoundarySample): void => {
    if (walls.length >= MAX_WALL_BLOCKS) return;
    const key = cellKey(s.x, s.z);
    if (wallCells.has(key)) return;
    if (roads.isOnRoad(s.x, s.z, 1.0)) return;
    if (buildings.hitsCircle(s.x, s.z, 1.1)) return;
    if (heights.slopeAt(s.x, s.z) > 26) return;
    wallCells.add(key);
    if (rng() < 0.14) return; // tratti crollati, come su strada
    const y = heights.heightAt(s.x, s.z);
    dummy.position.set(s.x, y + 0.3, s.z);
    dummy.rotation.set(
      (rng() - 0.5) * 0.06,
      s.yaw + (rng() - 0.5) * 0.1,
      (rng() - 0.5) * 0.05,
    );
    const h = 0.82 + rng() * 0.26;
    dummy.scale.set(0.94 + rng() * 0.12, h / 0.8, 0.9 + rng() * 0.2);
    dummy.updateMatrix();
    pushInstance(walls, dummy, tint.copy(stoneBase).multiplyScalar(0.78 + rng() * 0.36), MAX_WALL_BLOCKS);
  };

  for (const ring of boundaryRings(osm.areas, WALL_KINDS)) {
    for (const s of boundarySamples(ring, 2.4)) placeWall(s);
  }

  // confini estratti dal landcover: segmenti assi-allineati lunghi `cell`.
  // L'ordine di scansione del file darebbe tutti i muri all'angolo in alto a
  // sinistra della mappa una volta raggiunto il cap, quindi i segmenti vengono
  // prima mescolati con un RNG a seme fisso (copertura uniforme e
  // riproducibile a ogni run).
  if (parcels) {
    const { cell, originX, originZ } = parcels;
    const segs: [number, number, number, number][] = [];
    for (const list of [parcels.w, parcels.f]) {
      for (let n = 0; n + 2 < list.length; n += 3) {
        const i = list[n]!;
        const j = list[n + 1]!;
        const d = list[n + 2]!;
        const x1 = originX + (d === 0 ? (i + 1) * cell : i * cell);
        const z1 = originZ + (d === 0 ? j * cell : (j + 1) * cell);
        segs.push([x1, z1, d === 0 ? x1 : x1 + cell, d === 0 ? z1 + cell : z1]);
      }
    }
    for (let i = segs.length - 1; i > 0; i--) {
      const k = Math.floor(rng() * (i + 1));
      const t = segs[i]!;
      segs[i] = segs[k]!;
      segs[k] = t;
    }
    for (const [x1, z1, x2, z2] of segs) {
      if (walls.length >= MAX_WALL_BLOCKS) break;
      for (const s of polylineSamples(
        [
          { x: x1, z: z1 },
          { x: x2, z: z2 },
        ],
        2.4,
      )) {
        placeWall(s);
      }
    }
  }

  // ---- recinzioni: pali più due fili -------------------------------------
  for (const ring of boundaryRings(osm.areas, FENCE_KINDS)) {
    let lastPost: { x: number; z: number; y: number } | null = null;
    for (const s of boundarySamples(ring, 2.4)) {
      const fits =
        posts.length < MAX_POSTS &&
        !fenceCells.has(cellKey(s.x, s.z)) &&
        !roads.isOnRoad(s.x, s.z, 1.0) &&
        !buildings.hitsCircle(s.x, s.z, 1.0) &&
        heights.slopeAt(s.x, s.z) <= 32;
      if (!fits) {
        lastPost = null;
        continue;
      }
      fenceCells.add(cellKey(s.x, s.z));
      const y = heights.heightAt(s.x, s.z);
      dummy.position.set(s.x, y + 0.55, s.z);
      dummy.rotation.set((rng() - 0.5) * 0.04, s.yaw + (rng() - 0.5) * 0.08, (rng() - 0.5) * 0.04);
      dummy.scale.set(1, 0.92 + rng() * 0.2, 1);
      dummy.updateMatrix();
      pushInstance(posts, dummy, tint.copy(woodBase).multiplyScalar(0.8 + rng() * 0.4), MAX_POSTS);

      // filo tra questo palo e il precedente, se la distanza è plausibile
      if (lastPost && rails.length < MAX_RAILS) {
        const dx = s.x - lastPost.x;
        const dz = s.z - lastPost.z;
        const gap = Math.hypot(dx, dz);
        if (gap >= 0.8 && gap <= 4.2) {
          const yaw = Math.atan2(-dz / gap, dx / gap);
          const midY = (y + lastPost.y) / 2;
          for (const railH of [0.42, 0.86]) {
            if (rails.length >= MAX_RAILS) break;
            dummy.position.set(lastPost.x + dx / 2, midY + railH, lastPost.z + dz / 2);
            dummy.rotation.set(0, yaw, 0);
            dummy.scale.set(gap, 1, 1);
            dummy.updateMatrix();
            pushInstance(rails, dummy, tint.copy(woodBase).multiplyScalar(0.82 + rng() * 0.3), MAX_RAILS);
          }
        }
      }
      lastPost = { x: s.x, z: s.z, y };
    }
  }

  if (walls.length) {
    const geo = new THREE.BoxGeometry(2.5, 0.8, 0.55);
    const mat = new THREE.MeshStandardMaterial({
      ...pbr(renderer, 'stonewall', { repeat: 1, normal: true, rough: true }),
      color: 0xffffff,
      roughness: 1,
      metalness: 0,
      normalScale: new THREE.Vector2(1.2, 1.2),
      envMapIntensity: 0.32,
    });
    const mesh = makeInstanced(geo, mat, walls, 'field-wall-blocks');
    if (mesh) group.add(mesh);
  }
  if (posts.length) {
    const geo = new THREE.BoxGeometry(0.09, 1.15, 0.09);
    const mat = new THREE.MeshStandardMaterial({
      ...pbr(renderer, 'bark', { repeat: 1, normal: false, rough: true }),
      color: 0xffffff,
      roughness: 0.94,
      metalness: 0,
      envMapIntensity: 0.25,
    });
    const mesh = makeInstanced(geo, mat, posts, 'fence-posts');
    if (mesh) group.add(mesh);
  }
  if (rails.length) {
    const geo = new THREE.BoxGeometry(1, 0.05, 0.03);
    const mat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.92,
      metalness: 0,
      envMapIntensity: 0.2,
    });
    const mesh = makeInstanced(geo, mat, rails, 'fence-rails');
    if (mesh) group.add(mesh);
  }

  // ---- fossi --------------------------------------------------------------
  const ditchGeo = buildDitchGeometry(osm.waterways, heights);
  if (ditchGeo) {
    const ditchMat = new THREE.MeshStandardMaterial({
      ...pbr(renderer, 'gravel', { repeat: 1, normal: true, rough: true }),
      vertexColors: true,
      roughness: 1,
      metalness: 0,
      envMapIntensity: 0.2,
      polygonOffset: true,
      polygonOffsetFactor: -3,
      polygonOffsetUnits: -3,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(ditchGeo, ditchMat);
    mesh.name = 'field-ditches';
    mesh.receiveShadow = true;
    group.add(mesh);
  }

  return group;
}

/**
 * Sezione a V di un fosso, campionata sul DEM.
 *
 * Cinque vertici per stazione: bordo (quota terreno +2 cm), riva (+28 cm),
 * letto (+5 cm), riva opposta, bordo opposto. Il fosso non può scavare sotto
 * il terreno (la mesh del terreno lo coprirebbe): la rialzazione delle rive
 * con un letto scuro legge come canale, e sotto c'è già il nastro d'acqua di
 * `buildWater`. Funzione pura rispetto a `heights`, testata nei test.
 */
export function buildDitchGeometry(
  waterways: readonly { type: string; points: readonly Pt[] }[],
  heights: Heightfield,
): THREE.BufferGeometry | null {
  const OFFSETS = [-1.7, -0.95, 0, 0.95, 1.7];
  const LIFTS = [0.02, 0.28, 0.05, 0.28, 0.02];
  const VS = [0, 0.22, 0.5, 0.78, 1];
  // fango umido nel letto, erba sulle rive, sfumatura verso il terreno
  const COLORS = [0x98a07c, 0x7c8a58, 0x4b463c, 0x7c8a58, 0x98a07c];

  const positions: number[] = [];
  const uvs: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  const col = new THREE.Color();

  for (const w of waterways) {
    if (w.type !== 'ditch') continue;
    const pts = resample(w.points as Pt[], 3);
    if (pts.length < 2) continue;

    const base = positions.length / 3;
    let run = 0;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i]!;
      const prev = pts[Math.max(0, i - 1)]!;
      const next = pts[Math.min(pts.length - 1, i + 1)]!;
      const tx = next.x - prev.x;
      const tz = next.z - prev.z;
      const tl = Math.hypot(tx, tz) || 1;
      const nx = -tz / tl;
      const nz = tx / tl;
      if (i > 0) run += Math.hypot(p.x - pts[i - 1]!.x, p.z - pts[i - 1]!.z);
      for (let k = 0; k < OFFSETS.length; k++) {
        const off = OFFSETS[k]!;
        const vx = p.x + nx * off;
        const vz = p.z + nz * off;
        const vy = heights.heightAt(vx, vz) + LIFTS[k]!;
        positions.push(vx, vy, vz);
        uvs.push(run / 4, VS[k]!);
        col.setHex(COLORS[k]!);
        colors.push(col.r, col.g, col.b);
      }
    }
    const stations = pts.length;
    for (let i = 0; i < stations - 1; i++) {
      for (let g = 0; g < OFFSETS.length - 1; g++) {
        const a = base + i * OFFSETS.length + g;
        const b = a + 1;
        const c = base + (i + 1) * OFFSETS.length + g;
        const d = c + 1;
        indices.push(a, b, d, a, d, c);
      }
    }
  }

  if (!indices.length) return null;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

import * as THREE from 'three';
import type { GroundSampler } from '../geo/ground';
import type { Heightfield } from '../geo/elevation';
import type { ObstacleIndex } from '../geo/obstacles';
import type { OsmData } from '../geo/osm';
import { bridgeElevations, roadPolyline } from './roads';
import type { WorldAsset, WorldKit, WorldSpot } from './worldkit';

export interface GuardrailOptions {
  /** tetto di campate; evita di riempire la scena su un preset basso */
  maxSpans?: number;
  /** false = nessun guardrail (preset minimal/low) */
  enabled?: boolean;
  /** se presente, il nastro diventa solido anche per auto e pedoni */
  obstacles?: ObstacleIndex;
  /**
   * Se il kit ha il ruolo `guardrail`, la barriera è fatta di moduli GLB
   * (10 m l'uno, 524 triangoli): niente più lamiera procedurale davanti alle
   * fotogrammetrie. La variante pesante resta limitata ai ponti e il terminale
   * chiude le tratte. Senza kit si torna al W-beam procedurale, dichiarato
   * come fallback.
   */
  kit?: WorldKit | null;
}

interface RailSpan {
  x: number;
  y: number;
  z: number;
  yaw: number;
  length: number;
  bridge: boolean;
  /** larghezza della strada: le provinciali larghe vogliono la variante pesante */
  width: number;
  /** estremi del nastro, per appoggiare i moduli GLB alla quota giusta */
  ax: number;
  az: number;
  bx: number;
  bz: number;
  baseA: number;
  baseB: number;
  /** primo/ultimo modulo di una tratta: lì va il terminale */
  tipStart: boolean;
  tipEnd: boolean;
}

interface Post {
  x: number;
  y: number;
  z: number;
  yaw: number;
}

/** Distanza della barriera dal bordo asfalto. */
const OFFSET = 0.72;
const POST_HEIGHT = 0.92;
const RAIL_Y = 0.62;

/**
 * Sonda di scarpata.
 *
 * Il DEM ha dettaglio reale di circa 30 m: a 1,2 m dal ciglio campiona la
 * stessa cella dell'asfalto e non vede mai il salto. Il dislivello va quindi
 * misurato qualche metro fuori, dove il terreno che scende è quello che vede
 * anche l'occhio dal finestrino.
 */
const DROP_PROBE = 5;
/** Dislivello minimo fra strada e terreno perché serva una barriera. */
const DROP_MIN = 1.0;
/** Pendenza laterale minima (dislivello / distanza). */
const DROP_SLOPE = 0.12;
/** Interruzioni più corte di così fra due tratti si chiudono. */
const MERGE_GAP = 40;
/** Tratti più corti di così si scartano: una stecca di 10 m non è un guardrail. */
const MIN_RUN = 40;
/** Passo dei pali. */
const POST_STEP = 4;
/**
 * Lunghezza massima di una campata di nastro.
 *
 * I nodi OSM possono distare centinaia di metri (una provinciale dritta ha un
 * nodo ogni 800 m): una campata unica sarebbe una trave rigida tesa fra due
 * punti, che sui saliscendi del terreno entra nella strada da una parte ed
 * esce dall'altra. Il nastro si spezza quindi in pezzi corti, ognuno appoggiato
 * alla quota della strada in quel punto.
 */
const RAIL_PIECE = 24;
/**
 * Allungamento massimo del modulo GLB lungo la tratta.
 *
 * Il pezzo è lungo 10 m: accostarlo senza sovrapposizioni lascerebbe giunti
 * visibili in curva. Con 1,16× (11,6 m al passo, 2% di sovrapposizione) i pali
 * restano dritti e la rete scende di circa il 15% di triangoli.
 */
const GLB_STRETCH = 1.16;
/** Tetto ai moduli pesanti: 8.900 triangoli l'uno, si concedono solo ai ponti. */
const HEAVY_MODULES = 120;

/**
 * Chiude le interruzioni corte e scarta i tratti corti.
 *
 * Un guardrail vero è un nastro continuo di decine o centinaia di metri, non
 * una stecca ogni tanto. La regola sul DEM invece si accende e si spegne di
 * segmento in segmento (i nodi OSM distano 24 m di media): senza questo
 * passaggio la barriera compariva in 1.500 pezzi da tre metri sparsi per la
 * mappa. `on` e `lengths` sono paralleli e riferiti agli stessi segmenti.
 */
export function mergeRuns(
  on: boolean[],
  lengths: number[],
  gap = MERGE_GAP,
  minRun = MIN_RUN,
): boolean[] {
  const out = on.slice();
  // fusione: le buche sotto `gap` metri diventano barriera anche loro
  let i = 0;
  while (i < out.length) {
    if (out[i]) {
      i++;
      continue;
    }
    let j = i;
    let missing = 0;
    while (j < out.length && !out[j]) {
      missing += lengths[j] ?? 0;
      j++;
    }
    if (j < out.length && missing <= gap) for (let k = i; k < j; k++) out[k] = true;
    i = j;
  }
  // scarto: i tratti rimasti sotto `minRun` metri spariscono
  let start = -1;
  let run = 0;
  for (let k = 0; k <= out.length; k++) {
    if (k < out.length && out[k]) {
      if (start < 0) start = k;
      run += lengths[k] ?? 0;
    } else if (start >= 0) {
      if (run < minRun) for (let q = start; q < k; q++) out[q] = false;
      start = -1;
      run = 0;
    }
  }
  return out;
}

/**
 * Distanza massima di un punto intermedio dalla corda fra gli estremi.
 * Zero su un rettilineo, cresce nelle curve.
 */
function sagitta(line: { x: number; z: number }[], from: number, to: number): number {
  const a = line[from]!;
  const b = line[to]!;
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const len = Math.hypot(dx, dz) || 1;
  let worst = 0;
  for (let i = from + 1; i < to; i++) {
    const p = line[i]!;
    // distanza punto-retta: nella curva la corda passa dentro l'arco
    worst = Math.max(worst, Math.abs((p.x - a.x) * dz - (p.z - a.z) * dx) / len);
  }
  return worst;
}

/**
 * Stazioni delle campate: lunghe `target` metri, ma accorciate nelle curve.
 *
 * Una campata è una trave dritta: su una curva stretta una corda da 24 m taglia
 * l'angolo e la barriera finisce fuori dall'asfalto (fino a 6 m, misurato sul
 * Molise). La stazione si chiude quindi anche quando la corda si stacca dalla
 * polilinea più di `maxSagitta`.
 */
export function railStations(
  line: { x: number; z: number }[],
  target = RAIL_PIECE,
  maxSagitta = 0.35,
): { x: number; z: number }[] {
  if (line.length < 2) return line.slice();
  const out = [line[0]!];
  let start = 0;
  while (start < line.length - 1) {
    let end = start + 1;
    while (end < line.length - 1) {
      const next = end + 1;
      const chord = Math.hypot(line[next]!.x - line[start]!.x, line[next]!.z - line[start]!.z);
      if (chord >= target) break;
      if (end > start + 1 && sagitta(line, start, next) > maxSagitta) break;
      end = next;
    }
    out.push(line[end]!);
    start = end;
  }
  return out;
}

/** Vero se fra la strada e il terreno a `probe` metri serve una barriera. */
export function needsRail(roadY: number, terrainOut: number, probe = DROP_PROBE): boolean {
  const drop = roadY - terrainOut;
  return drop >= DROP_MIN && drop / probe > DROP_SLOPE;
}

/**
 * Guardrail a doppia onda semplificato.
 *
 * Il criterio non è "ovunque": un guardrail in mezzo a un campo coltivato è
 * finto. Viene messo dove serve davvero, cioè sui ponti e sul lato a valle
 * delle strade di campagna che corrono sopra il terreno circostante — la
 * scarpata si misura con `needsRail` e diventa un tratto continuo con
 * `mergeRuns`. In paese, lungo i marciapiedi, non compare.
 *
 * Due sole InstancedMesh (pali e nastro) tengono il costo a due draw call.
 */
export function buildGuardrails(
  osm: OsmData,
  heights: Heightfield,
  ground: GroundSampler,
  options: GuardrailOptions = {},
): { group: THREE.Group; spans: number; modules: number } {
  const maxSpans = Math.max(0, options.maxSpans ?? 2400);
  const group = new THREE.Group();
  group.name = 'guardrails';
  if (options.enabled === false || maxSpans === 0) return { group, spans: 0, modules: 0 };

  const rails: RailSpan[] = [];
  const posts: Post[] = [];

  /** Un tratto della polilinea stradale, con quello che serve al nastro. */
  interface Piece {
    on: boolean;
    length: number;
    ax: number;
    az: number;
    bx: number;
    bz: number;
    yaw: number;
    baseA: number;
    baseB: number;
    bridge: boolean;
  }

  for (const road of osm.roads) {
    if (road.width < 3.4) continue;
    const half = road.width / 2;
    // La strada che si vede, non i nodi OSM grezzi: la barriera deve seguire
    // l'asfalto anche in curva (vedi `roadPolyline`). Le campate arrivano da
    // `railStations`, che le accorcia dove la corda taglierebbe l'angolo.
    const pts = railStations(roadPolyline(road));
    const deck = road.bridge ? bridgeElevations(road, pts) : null;
    // I marciapiedi segnalano il costruito: niente guardrail fra le case, ma
    // una provinciale che attraversa il paese può averne fuori. La maschera è
    // calcolata sui nodi OSM e va riportata sui punti grafici, una volta sola.
    const spans = road.walkSpans;
    const town = spans
      ? pts.map((p) => {
          let best = Infinity;
          let index = 0;
          for (let k = 0; k < road.points.length; k++) {
            const q = road.points[k]!;
            const d = (q.x - p.x) ** 2 + (q.z - p.z) ** 2;
            if (d < best) {
              best = d;
              index = k;
            }
          }
          return spans[index] === true;
        })
      : null;
    const inTown = (i: number): boolean =>
      town !== null && town[Math.min(Math.max(i, 0), town.length - 1)] === true;
    for (const side of [-1, 1]) {
      const pieces: Piece[] = [];
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1]!;
        const b = pts[i]!;
        let tx = b.x - a.x;
        let tz = b.z - a.z;
        const length = Math.hypot(tx, tz);
        if (length < 0.8) continue;
        tx /= length;
        tz /= length;
        const bridge = road.bridge === true;
        const baseA = deck ? deck[i - 1]! : ground.heightAt(a.x, a.z);
        const baseB = deck ? deck[i]! : ground.heightAt(b.x, b.z);
        let on = false;
        if (bridge) {
          on = true;
        } else if (!inTown(i - 1) && !inTown(i)) {
          const ux = -tz * side;
          const uz = tx * side;
          // il dislivello si misura dal ciglio, non dalla mezzeria: sul pendio
          // traversale la mezzeria sta già un metro più in alto del terreno
          // sotto il ciglio, e misurando da lì la barriera compariva anche su
          // pendii dolci (170 km di guardrail invece di 66)
          const mx = (a.x + b.x) / 2 + ux * (half + OFFSET);
          const mz = (a.z + b.z) / 2 + uz * (half + OFFSET);
          const edge = heights.heightAt(mx, mz);
          const out = heights.heightAt(mx + ux * DROP_PROBE, mz + uz * DROP_PROBE);
          on = needsRail(edge, out);
        }
        pieces.push({
          on,
          length,
          ax: a.x,
          az: a.z,
          bx: b.x,
          bz: b.z,
          yaw: Math.atan2(tx, tz),
          baseA,
          baseB,
          bridge,
        });
      }
      if (!pieces.length) continue;
      const keep = mergeRuns(
        pieces.map((p) => p.on),
        pieces.map((p) => p.length),
      );

      // Il taglio sul tetto di campate avviene per tratti interi: mezzo
      // guardrail che finisce nel vuoto è peggio di un guardrail in meno.
      let i = 0;
      while (i < keep.length) {
        if (!keep[i]) {
          i++;
          continue;
        }
        let j = i;
        while (j < keep.length && keep[j]) j++;
        if (rails.length + (j - i) > maxSpans) break;
        const firstOfRun = rails.length;
        for (let k = i; k < j; k++) {
          const piece = pieces[k]!;
          const ux = -Math.cos(piece.yaw) * side;
          const uz = Math.sin(piece.yaw) * side;
          const off = half + OFFSET;
          // Sul ponte la quota è quella preparata dell'impalcato (lineare fra i
          // due imbocchi, come il nastro stradale); fuori, è la superficie
          // della strada sotto la campata.
          const surfaceAt = (t: number): number => {
            if (piece.bridge) return piece.baseA + (piece.baseB - piece.baseA) * t;
            const x = piece.ax + (piece.bx - piece.ax) * t + ux * off;
            const z = piece.az + (piece.bz - piece.az) * t + uz * off;
            return ground.heightAt(x, z);
          };
          const tipStart = rails.length === firstOfRun;
          rails.push({
            x: (piece.ax + piece.bx) / 2 + ux * off,
            y: (piece.baseA + piece.baseB) / 2 + RAIL_Y,
            z: (piece.az + piece.bz) / 2 + uz * off,
            yaw: piece.yaw,
            length: piece.length + 0.12,
            bridge: piece.bridge,
            width: road.width,
            ax: piece.ax + ux * off,
            az: piece.az + uz * off,
            bx: piece.bx + ux * off,
            bz: piece.bz + uz * off,
            baseA: piece.baseA,
            baseB: piece.baseB,
            tipStart,
            tipEnd: k === j - 1,
          });
          // pali ogni 4 m circa, ognuno alla quota della strada in quel punto
          const steps = Math.max(1, Math.round(piece.length / POST_STEP));
          for (let s = 0; s < steps; s++) {
            const t = s / steps;
            posts.push({
              x: piece.ax + (piece.bx - piece.ax) * t + ux * off,
              y: surfaceAt(t),
              z: piece.az + (piece.bz - piece.az) * t + uz * off,
              yaw: piece.yaw,
            });
          }
        }
        i = j;
      }
    }
  }

  if (!rails.length) return { group, spans: 0, modules: 0 };

  // Collisione: una barriera è fatta di pali, ma l'auto non deve passare negli
  // spazi. Si registrano cerchi ravvicinati lungo il nastro, non solo sui pali.
  if (options.obstacles) {
    for (const rail of rails) {
      const steps = Math.max(1, Math.ceil(rail.length / 2.2));
      for (let k = 0; k <= steps; k++) {
        const t = k / steps;
        const dx = Math.sin(rail.yaw) * (t - 0.5) * rail.length;
        const dz = Math.cos(rail.yaw) * (t - 0.5) * rail.length;
        options.obstacles.add(rail.x + dx, rail.z + dz, 0.09, 'guardrail');
      }
    }
  }

  // Moduli GLB: la barriera che si vede è quella fotogrammetrica. Il modulo
  // base è lungo 10 m e costa 524 triangoli; la variante pesante (8.900) si
  // concede solo ai ponti, con un tetto, e il terminale chiude le tratte.
  const kitAssets = options.kit?.variants('guardrail') ?? [];
  const baseAsset = kitAssets.find((a) => a.slug === 'guardrail') ?? kitAssets[0];
  if (baseAsset) {
    const heavyAsset = kitAssets.find((a) => a.slug === 'guardrail-heavy') ?? null;
    const terminalAsset = kitAssets.find((a) => a.slug === 'guardrail-terminal') ?? null;
    const variants: WorldAsset[] = [baseAsset];
    if (heavyAsset) variants.push(heavyAsset);
    if (terminalAsset) variants.push(terminalAsset);
    const variantOf = (asset: WorldAsset): number => variants.indexOf(asset);
    const axisLength = (asset: WorldAsset): number => Math.max(asset.size.x, asset.size.z);
    const yawAlong = (asset: WorldAsset, tx: number, tz: number): number =>
      asset.size.x >= asset.size.z ? Math.atan2(-tz, tx) : Math.atan2(tx, tz);

    const spots: WorldSpot[] = [];
    let heavyLeft = HEAVY_MODULES;
    for (const rail of rails) {
      const dx = rail.bx - rail.ax;
      const dz = rail.bz - rail.az;
      const length = Math.hypot(dx, dz) || rail.length;
      const tx = dx / length;
      const tz = dz / length;
      const heavy = rail.bridge && heavyAsset !== null && heavyLeft > 0;
      const asset = heavy ? heavyAsset! : baseAsset;
      const moduleLength = axisLength(asset);
      const step = Math.max(1, moduleLength * GLB_STRETCH);
      const count = Math.max(1, Math.ceil(length / step));
      const actual = length / count;
      // un pezzo più corto del modulo resta a scala 1 e si sovrappone ai vicini,
      // invece di schiacciare pali e lamiera
      const stretch = Math.max(1, actual / moduleLength);
      const zLong = asset.size.z >= asset.size.x;
      for (let i = 0; i < count; i++) {
        const t = (i + 0.5) / count;
        const x = rail.ax + dx * t;
        const z = rail.az + dz * t;
        const surface = rail.bridge
          ? rail.baseA + (rail.baseB - rail.baseA) * t
          : ground.heightAt(x, z);
        spots.push({
          x,
          // i pali affondano di 8 cm: nessuna barriera sospesa sul ciglio
          y: surface - 0.08,
          z,
          yaw: yawAlong(asset, tx, tz),
          scale: 1,
          scaleX: zLong ? 1 : stretch,
          scaleZ: zLong ? stretch : 1,
          variant: variantOf(asset),
        });
        if (heavy) heavyLeft--;
      }
      if (terminalAsset) {
        const half = axisLength(terminalAsset) / 2;
        const put = (x: number, z: number, surface: number): void => {
          spots.push({
            x,
            y: surface - 0.06,
            z,
            yaw: yawAlong(terminalAsset, tx, tz),
            scale: 1,
            variant: variantOf(terminalAsset),
          });
        };
        if (rail.tipStart) {
          const x = rail.ax + tx * half;
          const z = rail.az + tz * half;
          put(x, z, rail.bridge ? rail.baseA : ground.heightAt(x, z));
        }
        if (rail.tipEnd) {
          const x = rail.bx - tx * half;
          const z = rail.bz - tz * half;
          put(x, z, rail.bridge ? rail.baseB : ground.heightAt(x, z));
        }
      }
    }
    const glb = options.kit!.instances('guardrail', spots, { variants, castShadow: false });
    glb.name = 'guardrails';
    glb.userData.kit = true;
    return { group: glb, spans: rails.length, modules: spots.length };
  }

  // Fallback dichiarato: senza kit il nastro procedurale resta la barriera.
  const metal = new THREE.MeshStandardMaterial({
    color: 0x9aa0a2,
    metalness: 0.65,
    roughness: 0.48,
  });
  const railProfile = new THREE.Shape();
  railProfile.moveTo(-0.07, -0.14);
  railProfile.lineTo(0.07, -0.14);
  railProfile.lineTo(0.07, -0.11);
  railProfile.lineTo(0.02, -0.075);
  railProfile.lineTo(0.07, -0.04);
  railProfile.lineTo(0.07, 0.04);
  railProfile.lineTo(0.02, 0.075);
  railProfile.lineTo(0.07, 0.11);
  railProfile.lineTo(0.07, 0.14);
  railProfile.lineTo(-0.07, 0.14);
  railProfile.lineTo(-0.07, 0.11);
  railProfile.lineTo(-0.02, 0.075);
  railProfile.lineTo(-0.07, 0.04);
  railProfile.lineTo(-0.07, -0.04);
  railProfile.lineTo(-0.02, -0.075);
  railProfile.lineTo(-0.07, -0.11);
  railProfile.closePath();
  const railGeo = new THREE.ExtrudeGeometry(railProfile, {
    depth: 1,
    bevelEnabled: true,
    bevelSegments: 1,
    bevelSize: 0.006,
    bevelThickness: 0.006,
  });
  railGeo.computeVertexNormals();
  const postGeo = new THREE.BoxGeometry(0.08, POST_HEIGHT, 0.12);
  const railMesh = new THREE.InstancedMesh(railGeo, metal, rails.length);
  const postMesh = new THREE.InstancedMesh(postGeo, metal, posts.length);
  railMesh.name = 'guardrail-rails';
  postMesh.name = 'guardrail-posts';
  railMesh.castShadow = false;
  railMesh.receiveShadow = true;
  postMesh.castShadow = false;
  postMesh.receiveShadow = true;

  const dummy = new THREE.Object3D();
  rails.forEach((rail, i) => {
    dummy.position.set(rail.x, rail.y, rail.z);
    dummy.rotation.set(0, rail.yaw, 0);
    dummy.scale.set(1, rail.bridge ? 1.18 : 1, rail.length);
    dummy.updateMatrix();
    railMesh.setMatrixAt(i, dummy.matrix);
  });
  posts.forEach((post, i) => {
    dummy.position.set(post.x, post.y + POST_HEIGHT / 2, post.z);
    dummy.rotation.set(0, post.yaw, 0);
    dummy.scale.set(1, 1, 1);
    dummy.updateMatrix();
    postMesh.setMatrixAt(i, dummy.matrix);
  });
  railMesh.instanceMatrix.needsUpdate = true;
  postMesh.instanceMatrix.needsUpdate = true;
  group.add(railMesh, postMesh);
  return { group, spans: rails.length, modules: 0 };
}

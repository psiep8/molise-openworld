import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Heightfield } from '../geo/elevation';
import { hashInt, type Pt } from '../geo/geo';
import type { Building, OsmData } from '../geo/osm';
import { clamp } from '../geo/geo';
import { pbr, pbrColorRepeated } from '../gfx/textures';
import { planHipRoof, type HipRoofPlan, type Pt3 } from './roof';

// Intonaci chiari: molti paesi molisani sono tinteggiati di bianco o crema.
// Con la texture d'intonaco moltiplicata sopra, tinte più scure andavano a
// finire sul marrone.
const WALL_COLORS = [0xf3ecdd, 0xfaf5ea, 0xe9dfc9, 0xf5e8d4, 0xf1e6d2, 0xe6dac4, 0xefe3cd, 0xfdf8ee];
/**
 * Tinte per le facciate in pietra e in mattoni: la texture dà la grana e il
 * colore di base, la tinta per edificio aggiunge solo calore o grigiore.
 */
const STONE_COLORS = [0xd9cdba, 0xcfc2ad, 0xe0d5c2, 0xc8bda9, 0xd4c9b6];
const BRICK_COLORS = [0xd8bda4, 0xcdb198, 0xe0c6ae, 0xc6a98f];

/**
 * Famiglie di facciata. Il Molise vero alterna intonaco tinteggiato, pietra a
 * vista nel centro storico e qualche casa in mattoni: senza questa varietà due
 * case vicine sembrano lo stesso prefabbricato.
 */
type FacadeFamily = 'plaster' | 'plaster2' | 'stone' | 'brick';

/**
 * Quanto dettaglio hanno le facciate. Lo decide il preset grafico: `simple`
 * tiene la sagoma della casa (muri, tetto, zoccolo, cornicione, comignolo,
 * portone, vetri) e rinuncia a cornici, davanzali, persiane, pluviali,
 * cantonali e balconi, che da soli valgono oltre due milioni di triangoli.
 */
export type BuildingDetail = 'full' | 'simple';

export interface BuildingOptions {
  detail?: BuildingDetail;
}

function facadeFamily(area: number, seed: number): FacadeFamily {
  const h = hashInt(seed, 41) % 100;
  // case piccole (centro storico) più spesso in pietra a vista
  if (area < 130 && h < 52) return 'stone';
  if (area < 130 && h < 60) return 'brick';
  if (h < 44) return 'plaster';
  if (h < 82) return 'plaster2';
  if (h < 92) return 'stone';
  return 'brick';
}

/**
 * Quanto sono accese le finestre: 0 di giorno, 1 a notte piena. Il materiale
 * delle finestre accese è unico per tutto il paese (una sola mesh), quindi basta
 * cambiargli l'emissività: nessuna draw call in più, nessuna luce in più.
 */
let litGlassMaterial: THREE.MeshStandardMaterial | null = null;

export function setWindowGlow(amount: number): void {
  if (!litGlassMaterial) return;
  const on = clamp(amount, 0, 1);
  litGlassMaterial.emissiveIntensity = 0.02 + 1.9 * on;
}
/**
 * Tinte chiare: il colore dei coppi arriva dalla texture CC0, qui si varia solo
 * la luminosità/calore per casa, senza scurire il laterizio.
 */
const ROOF_COLORS = [0xffffff, 0xf2e8df, 0xe8dbd0, 0xf7eee6, 0xdfd2c7];

function applyColor(geometry: THREE.BufferGeometry, color: THREE.Color): void {
  const count = geometry.attributes.position.count;
  const array = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    array[i * 3] = color.r;
    array[i * 3 + 1] = color.g;
    array[i * 3 + 2] = color.b;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(array, 3));
}

function centroid(points: Pt[]): Pt {
  let x = 0;
  let z = 0;
  for (const p of points) {
    x += p.x;
    z += p.z;
  }
  return { x: x / points.length, z: z / points.length };
}

/** Box colorato e non indicizzato, così si fonde con le altre decorazioni. */
function solidBox(
  w: number,
  h: number,
  d: number,
  x: number,
  y: number,
  z: number,
  color: THREE.Color,
  rotY = 0,
): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d).toNonIndexed();
  if (rotY) g.rotateY(rotY);
  g.translate(x, y, z);
  applyColor(g, color);
  return g;
}

/**
 * Fascia orizzontale (cornicione) lungo il perimetro dell'impronta: facce
 * esterne più il filo superiore, che è quello che disegna l'ombra sulla facciata.
 * Costruita a mano perché ExtrudeGeometry non è indicizzata e non si fonderebbe
 * con i box delle decorazioni.
 */
function bandGeometry(
  points: Pt[],
  center: Pt,
  scale: number,
  y0: number,
  y1: number,
  color: THREE.Color,
): THREE.BufferGeometry {
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const ring = points.map((p) => ({
    x: center.x + (p.x - center.x) * scale,
    z: center.z + (p.z - center.z) * scale,
  }));
  const inner = points.map((p) => ({
    x: center.x + (p.x - center.x) * (scale - 0.035),
    z: center.z + (p.z - center.z) * (scale - 0.035),
  }));

  const tri = (
    ax: number,
    ay: number,
    az: number,
    bx: number,
    by: number,
    bz: number,
    cx: number,
    cy: number,
    cz: number,
    nx: number,
    ny: number,
    nz: number,
    u0: number,
    u1: number,
    u2: number,
  ): void => {
    positions.push(ax, ay, az, bx, by, bz, cx, cy, cz);
    normals.push(nx, ny, nz, nx, ny, nz, nx, ny, nz);
    uvs.push(u0, 0, u1, 1, u2, 0.5);
  };

  let travelled = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    const ia = inner[i];
    const ib = inner[(i + 1) % ring.length];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const len = Math.hypot(dx, dz);
    if (len < 1e-3) continue;
    // normale esterna dell'edge, con il verso corretto rispetto al centro
    let nx = dz / len;
    let nz = -dx / len;
    const mx = (a.x + b.x) / 2 - center.x;
    const mz = (a.z + b.z) / 2 - center.z;
    if (nx * mx + nz * mz < 0) {
      nx = -nx;
      nz = -nz;
    }
    const u0 = travelled / 4;
    const u1 = (travelled + len) / 4;
    // parete esterna
    tri(a.x, y0, a.z, b.x, y0, b.z, b.x, y1, b.z, nx, 0, nz, u0, u1, u1);
    tri(a.x, y0, a.z, b.x, y1, b.z, a.x, y1, a.z, nx, 0, nz, u0, u1, u0);
    // filo superiore, verso l'interno
    tri(a.x, y1, a.z, b.x, y1, b.z, ib.x, y1, ib.z, 0, 1, 0, u0, u1, u1);
    tri(a.x, y1, a.z, ib.x, y1, ib.z, ia.x, y1, ia.z, 0, 1, 0, u0, u1, u0);
    travelled += len;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  applyColor(geometry, color);
  return geometry;
}

/**
 * Geometria del tetto a padiglione: una falda per lato più il colmo.
 * Il verso delle facce viene corretto in base alla normale, così vale per
 * impronte OSM con orientamento orario o antiorario.
 */
function buildHipGeometry(plan: HipRoofPlan, tile = 2.7): THREE.BufferGeometry {
  const positions: number[] = [];
  const uvs: number[] = [];

  const pushTri = (
    a: Pt3,
    b: Pt3,
    c: Pt3,
    ua: [number, number],
    ub: [number, number],
    uc: [number, number],
  ): void => {
    // componente y della normale: deve guardare in alto
    const ny = (b.z - a.z) * (c.x - a.x) - (b.x - a.x) * (c.z - a.z);
    const verts = ny < 0 ? [a, c, b] : [a, b, c];
    const uv = ny < 0 ? [ua, uc, ub] : [ua, ub, uc];
    for (let i = 0; i < 3; i++) {
      positions.push(verts[i].x, verts[i].y, verts[i].z);
      uvs.push(uv[i][0], uv[i][1]);
    }
  };

  let uCursor = 0;
  for (const slope of plan.slopes) {
    const [a, b, c, d] = slope.corners;
    const u0 = uCursor / tile;
    const u1 = (uCursor + slope.eaveLength) / tile;
    const v1 = slope.slopeLength / tile;
    pushTri(a, b, c, [u0, 0], [u1, 0], [u1, v1]);
    pushTri(a, c, d, [u0, 0], [u1, v1], [u0, v1]);
    uCursor += slope.eaveLength;
  }

  // colmo: superficie piana triangolata con l'utility di Three.js
  const ring2 = plan.ridgeRing.map((p) => new THREE.Vector2(p.x, -p.z));
  const uvFor = (p: { x: number; z: number }): [number, number] => [p.x / tile, p.z / tile];
  const at = (p: { x: number; z: number }): Pt3 => ({ x: p.x, y: plan.ridgeY, z: p.z });
  for (const [i, j, k] of THREE.ShapeUtils.triangulateShape(ring2, [])) {
    const pi = plan.ridgeRing[i];
    const pj = plan.ridgeRing[j];
    const pk = plan.ridgeRing[k];
    pushTri(at(pi), at(pj), at(pk), uvFor(pi), uvFor(pj), uvFor(pk));
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.computeVertexNormals();
  return geometry;
}

interface BuildingParts {
  wall: THREE.BufferGeometry;
  roof: THREE.BufferGeometry;
  base: THREE.BufferGeometry;
  trim: THREE.BufferGeometry[];
  /** vetri: materiale a parte, perché devono riflettere il cielo */
  glass: THREE.BufferGeometry[];
  /** famiglia di facciata: decide texture e tinta del muro */
  family: FacadeFamily;
}

interface EdgeInfo {
  a: Pt;
  b: Pt;
  len: number;
  ex: number;
  ez: number;
  nx: number;
  nz: number;
  angle: number;
  mx: number;
  mz: number;
}

/** Tutti i lati dell'impronta, dal più lungo, con normale esterna. */
function edgesOf(points: Pt[], center: Pt): EdgeInfo[] {
  const edges: EdgeInfo[] = [];
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    if (len < 1e-3) continue;
    const ex = (b.x - a.x) / len;
    const ez = (b.z - a.z) / len;
    let nx = ez;
    let nz = -ex;
    const mx = (a.x + b.x) / 2;
    const mz = (a.z + b.z) / 2;
    if (nx * (mx - center.x) + nz * (mz - center.z) < 0) {
      nx = -nx;
      nz = -nz;
    }
    edges.push({ a, b, len, ex, ez, nx, nz, angle: Math.atan2(-ez, ex), mx, mz });
  }
  edges.sort((p, q) => q.len - p.len);
  return edges;
}

/** Lato più lungo dell'impronta, con normale esterna: è la facciata nobile. */
function longestEdge(points: Pt[], center: Pt): EdgeInfo | null {
  return edgesOf(points, center)[0] ?? null;
}

/**
 * Finestra in geometria: cornice in pietra a filo, vetro arretrato, davanzale a
 * sporto e (a volte) le persiane aperte ai lati.
 *
 * Prima la finestra era **disegnata sulla texture dell'intonaco** e ripetuta a
 * ogni 3,3 m su tutte le pareti: da lì veniva l'effetto "case di cartone", con
 * vani tutti uguali, senza spessore e senza ombra. Qui ogni vano ha cornice,
 * davanzale e vetro veri, tanto da leggere l'ombra che la cornice getta sul muro.
 */
function addWindow(
  trim: THREE.BufferGeometry[],
  glass: THREE.BufferGeometry[],
  edge: EdgeInfo,
  offset: number,
  y: number,
  w: number,
  h: number,
  frame: THREE.Color,
  stone: THREE.Color,
  shutters: THREE.Color | null,
  simple = false,
): void {
  const cx = edge.mx + edge.ex * offset + edge.nx * 0.02;
  const cz = edge.mz + edge.ez * offset + edge.nz * 0.02;
  const f = 0.075;

  // vetro: pannello scuro appena arretrato rispetto alla cornice
  glass.push(solidBox(w, h, 0.025, cx, y, cz, new THREE.Color(0x243038), edge.angle));
  // `simple`: resta il vetro (la finestra si legge lo stesso) e si risparmiano
  // cornice, traversi, davanzale e persiane, cioè quasi tutta la geometria
  if (simple) return;

  // montanti e traversi
  for (const side of [-1, 1] as const) {
    trim.push(
      solidBox(
        f,
        h + f * 2,
        0.1,
        cx + edge.ex * side * (w / 2 + f / 2),
        y,
        cz + edge.ez * side * (w / 2 + f / 2),
        frame,
        edge.angle,
      ),
    );
  }
  trim.push(solidBox(w + f * 2, f, 0.1, cx, y + h / 2 + f / 2, cz, frame, edge.angle));

  // davanzale: sporge di 12 cm sul muro e getta l'ombra sotto il vano
  trim.push(
    solidBox(
      w + 0.26,
      0.085,
      0.24,
      cx + edge.nx * 0.07,
      y - h / 2 - 0.042,
      cz + edge.nz * 0.07,
      stone,
      edge.angle,
    ),
  );

  if (shutters) {
    // persiane aperte ai lati: pannelli appoggiati al muro, inclinati di 15°
    const sw = w * 0.48;
    for (const side of [-1, 1] as const) {
      const px = cx + edge.ex * side * (w / 2 + sw / 2 + 0.02) + edge.nx * 0.035;
      const pz = cz + edge.ez * side * (w / 2 + sw / 2 + 0.02) + edge.nz * 0.035;
      trim.push(solidBox(sw, h, 0.035, px, y, pz, shutters, edge.angle + side * 0.12));
    }
  }
}

function buildOne(
  b: Building,
  heights: Heightfield,
  seed: number,
  detail: BuildingDetail = 'full',
): BuildingParts {
  const simple = detail === 'simple';
  const c = centroid(b.points);
  // quota del terreno sotto tutta l'impronta: il muro parte dal punto più basso,
  // così sul lato in discesa non resta il vuoto sotto la casa. Lo zoccolo in
  // pietra copre il dislivello sul lato in salita.
  let groundMin = heights.heightAt(c.x, c.z);
  for (const p of b.points) groundMin = Math.min(groundMin, heights.heightAt(p.x, p.z));
  const base = groundMin - 0.25;
  const shape = new THREE.Shape(b.points.map((p) => new THREE.Vector2(p.x, -p.z)));
  const wall = new THREE.ExtrudeGeometry(shape, { depth: b.height, bevelEnabled: false, steps: 1 });
  wall.rotateX(-Math.PI / 2);
  wall.translate(0, base, 0);

  // ExtrudeGeometry usa v = 1 - altezza: la negazione raddrizza la finestra
  const wallUv = wall.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < wallUv.count; i++) wallUv.setY(i, -wallUv.getY(i));
  wallUv.needsUpdate = true;

  // tetto a falde con sporto; se l'impronta è troppo irregolare resta piatto
  const overhang = 1.045;
  const footprint = b.points.map((p) => ({
    x: c.x + (p.x - c.x) * overhang,
    z: c.z + (p.z - c.z) * overhang,
  }));
  const roofTop = base + b.height + 0.05;
  const rise = clamp(Math.sqrt(Math.max(4, b.area)) * 0.16, 1, 3.2);
  const plan = planHipRoof(footprint, roofTop, rise);
  let roof: THREE.BufferGeometry;
  let ridgeY = roofTop;
  if (plan) {
    roof = buildHipGeometry(plan);
    ridgeY = plan.ridgeY;
  } else {
    const roofShape = new THREE.Shape(footprint.map((p) => new THREE.Vector2(p.x, -p.z)));
    // non indicizzato come le falde: mergeGeometries esige attributi compatibili
    roof = new THREE.ShapeGeometry(roofShape).toNonIndexed();
    roof.rotateX(-Math.PI / 2);
    roof.translate(0, roofTop, 0);
  }

  const family = facadeFamily(b.area, seed);
  const palette = family === 'stone' ? STONE_COLORS : family === 'brick' ? BRICK_COLORS : WALL_COLORS;
  const wallColor = new THREE.Color(palette[hashInt(seed, 3) % palette.length]);
  const roofColor = new THREE.Color(ROOF_COLORS[hashInt(seed, 11) % ROOF_COLORS.length]);
  const shade = 0.92 + (hashInt(seed, 5) % 100) / 700;
  wallColor.multiplyScalar(shade);
  roofColor.multiplyScalar(shade);
  applyColor(wall, wallColor);
  applyColor(roof, roofColor);

  // zoccolo in pietra: fascia di ~0,5 m sopra il terreno, leggermente a sporto.
  // Senza, le case sembrano scatole appoggiate sull'erba.
  const plinth = b.points.map((p) => ({
    x: c.x + (p.x - c.x) * 1.02,
    z: c.z + (p.z - c.z) * 1.02,
  }));
  const plinthShape = new THREE.Shape(plinth.map((p) => new THREE.Vector2(p.x, -p.z)));
  const plinthGeo = new THREE.ExtrudeGeometry(plinthShape, { depth: 1.15, bevelEnabled: false, steps: 1 });
  plinthGeo.rotateX(-Math.PI / 2);
  plinthGeo.translate(0, base, 0);
  applyColor(plinthGeo, new THREE.Color(0x8f8579).multiplyScalar(0.9 + (hashInt(seed, 13) % 60) / 400));

  // ---------------------------------------------------------------------------
  // decorazioni: cornicione, comignolo, pluviali, balcone
  // ---------------------------------------------------------------------------
  const trim: THREE.BufferGeometry[] = [];
  const glass: THREE.BufferGeometry[] = [];
  const stone = new THREE.Color(0xe9e1cf).multiplyScalar(0.94 + (hashInt(seed, 7) % 60) / 500);
  const eaveY = base + b.height + 0.02;

  // cornicione sotto la gronda: 24 cm di aggetto, quello che disegna l'ombra
  trim.push(bandGeometry(b.points, c, 1.035, eaveY - 0.3, eaveY - 0.04, stone));

  // -------------------------------------------------------------------------
  // profondità vera della facciata
  // -------------------------------------------------------------------------
  const zinc = new THREE.Color(0x8e908d);

  // fasce marcapiano: una per piano, a sporto di 1,4 cm. Sono le linee
  // orizzontali che danno la scansione dei piani; con la sola normal map la
  // facciata restava un foglio di carta.
  const floors = Math.max(1, Math.round(b.height / 3.1));
  const floorTrim = stone.clone().multiplyScalar(0.97);
  if (!simple) {
    for (let f = 1; f < floors; f++) {
      const y = base + (b.height * f) / floors;
      trim.push(bandGeometry(b.points, c, 1.014, y - 0.07, y + 0.07, floorTrim));
    }
  }

  // cantonali: blocchi in pietra agli spigoli, quello che fa sembrare la casa
  // murata e non stampata in un pezzo solo
  if (!simple && b.area > 28 && b.points.length <= 10) {
    const quoin = stone.clone().multiplyScalar(0.9);
    const half = 0.15;
    for (const p of b.points) {
      const qx = c.x + (p.x - c.x) * 1.006;
      const qz = c.z + (p.z - c.z) * 1.006;
      trim.push(solidBox(half * 2, b.height * 0.995, half * 2, qx, base + b.height * 0.4975, qz, quoin));
    }
  }

  // grondaia in zinco appesa al filo della gronda, su tutti i lati
  const gutterY = eaveY + 0.01;
  for (let i = 0; !simple && i < b.points.length; i++) {
    const a = b.points[i];
    const next = b.points[(i + 1) % b.points.length];
    const len = Math.hypot(next.x - a.x, next.z - a.z);
    if (len < 2) continue;
    const ex = (next.x - a.x) / len;
    const ez = (next.z - a.z) / len;
    let nx = ez;
    let nz = -ex;
    const mx = (a.x + next.x) / 2;
    const mz = (a.z + next.z) / 2;
    if (nx * (mx - c.x) + nz * (mz - c.z) < 0) {
      nx = -nx;
      nz = -nz;
    }
    trim.push(
      solidBox(len + 0.08, 0.1, 0.13, mx + nx * 0.075, gutterY, mz + nz * 0.075, zinc, Math.atan2(-ez, ex)),
    );
  }

  // portone sulla facciata più lunga: stipiti, architrave, battente scuro e
  // soglia in pietra che sporge sul marciapiede
  const edge = longestEdge(b.points, c);
  if (edge && b.area > 26 && b.height > 3.4) {
    const doorW = 1.2;
    const doorH = Math.min(2.25, b.height - 0.7);
    const dx = edge.mx + edge.nx * 0.03;
    const dz = edge.mz + edge.nz * 0.03;
    // il portone parte dal terreno *davanti a lui*, non dalla base più bassa:
    // sul lato in salita la base era sotto il prato e la porta spariva
    const doorGround = heights.heightAt(edge.mx, edge.mz);
    const doorBottom = clamp(doorGround, base, base + b.height - doorH - 0.3);
    const jamb = 0.13;
    for (const side of [-1, 1] as const) {
      const px = dx + edge.ex * side * (doorW / 2 + jamb / 2);
      const pz = dz + edge.ez * side * (doorW / 2 + jamb / 2);
      trim.push(solidBox(jamb, doorH + 0.2, 0.16, px, doorBottom + (doorH + 0.2) / 2, pz, stone, edge.angle));
    }
    trim.push(
      solidBox(doorW + jamb * 2, 0.16, 0.18, dx, doorBottom + doorH + 0.1, dz, stone, edge.angle),
    );
    trim.push(
      solidBox(
        doorW,
        doorH,
        0.07,
        dx - edge.nx * 0.05,
        doorBottom + doorH / 2,
        dz - edge.nz * 0.05,
        new THREE.Color(0x4a3323),
        edge.angle,
      ),
    );
    const threshold = new THREE.Color(0xb5ab99);
    trim.push(
      solidBox(
        1.55,
        0.14,
        0.55,
        edge.mx + edge.nx * 0.22,
        doorBottom + 0.02,
        edge.mz + edge.nz * 0.22,
        threshold,
        edge.angle,
      ),
    );
  }

  const chimneyColor = wallColor.clone().multiplyScalar(0.98);
  if (hashInt(seed, 17) % 10 < 7) {
    // camino largo e basso: i primi erano troppo stretti e sembravano antenne
    const width = 0.8 + (hashInt(seed, 19) % 40) / 130;
    const dx = ((hashInt(seed, 23) % 60) - 30) / 100;
    const dz = ((hashInt(seed, 29) % 60) - 30) / 100;
    const top = ridgeY + 0.55;
    const bottom = ridgeY - 1.6;
    trim.push(solidBox(width, top - bottom, width, c.x + dx, (top + bottom) / 2, c.z + dz, chimneyColor));
    // cappello del comignolo
    trim.push(solidBox(width * 1.35, 0.1, width * 1.35, c.x + dx, top + 0.05, c.z + dz, new THREE.Color(0x9c9285)));
  }

  if (!simple && hashInt(seed, 31) % 10 < 6) {
    // due pluviali ai vertici più esterni in x: bastano a rompere il muro liscio
    let left = b.points[0];
    let right = b.points[0];
    for (const p of b.points) {
      if (p.x < left.x) left = p;
      if (p.x > right.x) right = p;
    }
    const pipeTop = eaveY - 0.35;
    const pipeBottom = base + 0.35;
    for (const p of [left, right]) {
      trim.push(solidBox(0.1, pipeTop - pipeBottom, 0.1, p.x, (pipeTop + pipeBottom) / 2, p.z, zinc));
    }
  }

  // ---------------------------------------------------------------------------
  // finestre: vani veri, non disegnati nella texture
  // ---------------------------------------------------------------------------
  const hasBalcony = !simple && b.area > 85 && b.height >= 6.2 && hashInt(seed, 37) % 3 < 2;
  if (b.area >= 20 && b.height >= 2.6 && b.points.length <= 14) {
    const shutters = hashInt(seed, 41) % 10 < 7
      ? new THREE.Color([0x4c5d49, 0x5a4635, 0x67706e, 0x3f4a3d][hashInt(seed, 43) % 4]!)
      : null;
    const frame = stone.clone().multiplyScalar(1.02);
    const floors = Math.max(1, Math.round(b.height / 3.1));
    const floorH = b.height / floors;
    const winW = 0.95;
    const winH = Math.min(1.4, floorH * 0.47);
    const balconyY = base + b.height * 0.46;
    // Prima si raccolgono tutti i vani possibili, poi se ne tengono al massimo
    // MAX_WINDOWS distribuiti in modo uniforme: un tetto al numero senza
    // selezione lasciava una facciata completamente cieca.
    const MAX_WINDOWS = 16;
    const candidates: { side: EdgeInfo; off: number; y: number }[] = [];
    edgesOf(b.points, c).forEach((side, index) => {
      if (index > 3) return;
      const margin = 0.95;
      const usable = side.len - margin * 2;
      if (usable < 1.2) return;
      const count = Math.max(1, Math.min(4, Math.floor(usable / 2.55)));
      const step = usable / count;
      for (let f = 0; f < floors; f++) {
        for (let k = 0; k < count; k++) {
          const off = -usable / 2 + step * (k + 0.5);
          // al piano terra la finestra parte dal terreno *lì*, non dalla base
          // più bassa: sul lato in salita finiva mezza sotto il prato
          const wx = side.mx + side.ex * off + side.nx * 0.02;
          const wz = side.mz + side.ez * off + side.nz * 0.02;
          const localGround = heights.heightAt(wx, wz);
          const wy =
            f === 0
              ? localGround + 1.6
              : base + floorH * f + floorH * 0.56;
          if (wy + winH / 2 > base + (f === 0 ? floorH : b.height) - 0.25) continue;
          // il portone sta al centro della facciata nobile: niente finestra lì
          if (f === 0 && index === 0 && Math.abs(off) < 1.25) continue;
          // il balcone occupa il centro della facciata al piano intermedio
          if (
            hasBalcony &&
            index === 0 &&
            Math.abs(wy - balconyY) < floorH * 0.55 &&
            Math.abs(off) < side.len * 0.3
          ) {
            continue;
          }
          candidates.push({ side, off, y: wy });
        }
      }
    });
    const take = Math.min(candidates.length, MAX_WINDOWS);
    const stride = candidates.length > take ? candidates.length / take : 1;
    for (let i = 0; i < take; i++) {
      const pick = candidates[Math.floor(i * stride)]!;
      addWindow(trim, glass, pick.side, pick.off, pick.y, winW, winH, frame, stone, shutters, simple);
    }
  }

  // balconi solo sulle case a due piani con facciata abbastanza lunga
  if (hasBalcony) {
    if (edge && edge.len > 4) {
      const ex = edge.ex;
      const ez = edge.ez;
      const nx = edge.nx;
      const nz = edge.nz;
      const mx = edge.mx;
      const mz = edge.mz;
      const angle = edge.angle;
      const slabW = edge.len * 0.55;
      const depth = 0.95;
      const y = base + b.height * 0.46;
      const px = mx + nx * (depth / 2 + 0.05);
      const pz = mz + nz * (depth / 2 + 0.05);
      trim.push(solidBox(slabW, 0.14, depth, px, y, pz, stone, angle));
      const iron = new THREE.Color(0x35393b);
      // corrimano e barre verticali
      const railY = y + 1.0;
      const railX = mx + nx * (depth + 0.02);
      const railZ = mz + nz * (depth + 0.02);
      trim.push(solidBox(slabW, 0.06, 0.06, railX, railY, railZ, iron, angle));
      for (let k = 0; k <= 6; k++) {
        const t = k / 6 - 0.5;
        const bx = mx + ex * slabW * t + nx * (depth + 0.02);
        const bz = mz + ez * slabW * t + nz * (depth + 0.02);
        trim.push(solidBox(0.035, 1.0, 0.035, bx, y + 0.5, bz, iron, angle));
      }
    }
  }

  return { wall, roof, base: plinthGeo, trim, glass, family };
}

/**
 * Edifici estrusi dalle impronte OSM (altezza da tag o stimata).
 * Muri e tetti in due mesh, decorazioni in una terza, tutte con materiali
 * condivisi: poche draw call anche con migliaia di case.
 */
export function buildBuildings(
  osm: OsmData,
  heights: Heightfield,
  renderer: THREE.WebGLRenderer,
  options: BuildingOptions = {},
): { group: THREE.Group; count: number } {
  const detail = options.detail ?? 'full';
  const group = new THREE.Group();
  group.name = 'buildings';
  const walls: THREE.BufferGeometry[] = [];
  const wallsByFamily: Record<FacadeFamily, THREE.BufferGeometry[]> = {
    plaster: [],
    plaster2: [],
    stone: [],
    brick: [],
  };
  const roofs: THREE.BufferGeometry[] = [];
  const bases: THREE.BufferGeometry[] = [];
  const trims: THREE.BufferGeometry[] = [];
  const glasses: THREE.BufferGeometry[] = [];
  /** finestre accese: vetro emissivo, pilotato da `setWindowGlow` */
  const glassesLit: THREE.BufferGeometry[] = [];

  osm.buildings.forEach((b, i) => {
    if (b.points.length < 3 || b.area < 6) return;
    const seed = i * 31 + Math.round(b.height * 10);
    try {
      const out = buildOne(b, heights, seed, detail);
      walls.push(out.wall);
      wallsByFamily[out.family].push(out.wall);
      roofs.push(out.roof);
      bases.push(out.base);
      for (const t of out.trim) trims.push(t);
      // un terzo circa delle case ha le luci accese: la finestra accesa è
      // geometria a parte, così di notte si vede la stanza illuminata
      const lit = hashInt(seed, 53) % 100 < 34;
      for (const g of out.glass) (lit ? glassesLit : glasses).push(g);
    } catch {
      // geometria degenere: la saltiamo
    }
  });

  // Intonaco vero al posto della texture con la finestra stampata: le finestre
  // ora sono geometria, il muro è solo muro (grana, crepe, macchie di umidità).
  const plaster = pbr(renderer, 'plaster', { color: false, repeat: 0.5 });
  // Le UV delle falde sono già in unità di 2,7 m: repeat 2 → un tile ogni ~1,35 m
  const tiles = pbr(renderer, 'rooftiles', { repeat: 2, normal: true, rough: true });

  /**
   * Materiale di facciata per famiglia: ognuno ha la sua grana PBR e la tinta
   * per edificio arriva dal vertex color. `repeat` è alto perché le UV del muro
   * sono in metri: 0,5 → un tile ogni 2 m.
   */
  const wallMaterial = (
    key: 'plaster' | 'plaster2' | 'stonewall' | 'brick',
    repeat: number,
    bump: number,
  ): THREE.MeshStandardMaterial => {
    const set = pbr(renderer, key, { color: false, normal: true, rough: true, repeat });
    const color = pbrColorRepeated(renderer, key, repeat);
    return new THREE.MeshStandardMaterial({
      vertexColors: true,
      map: color,
      normalMap: set.normalMap,
      normalScale: new THREE.Vector2(bump, bump),
      roughnessMap: set.roughnessMap,
      roughness: 1,
      metalness: 0,
      envMapIntensity: 0.4,
    });
  };
  const wallMats: Record<FacadeFamily, THREE.MeshStandardMaterial> = {
    plaster: wallMaterial('plaster', 0.5, 0.75),
    plaster2: wallMaterial('plaster2', 0.5, 0.8),
    stone: wallMaterial('stonewall', 0.75, 1.0),
    brick: wallMaterial('brick', 0.9, 0.9),
  };
  // Vetro: riflette il cielo, quindi materiale proprio (liscio e un filo metallico)
  const glassMat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.12,
    metalness: 0.35,
    envMapIntensity: 1.15,
  });
  // Finestre accese: stesso vetro, ma emissivo caldo. Di giorno resta spento e
  // la finestra si comporta come le altre; di notte circa un terzo delle case
  // si accende, ed è ciò che fa leggere un paese abitato.
  const glassLitMat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    color: 0x2b2620,
    roughness: 0.3,
    metalness: 0.2,
    emissive: 0xffca82,
    emissiveIntensity: 0.02,
    envMapIntensity: 0.7,
  });
  litGlassMaterial = glassLitMat;
  const roofMat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    ...tiles,
    normalScale: new THREE.Vector2(1.1, 1.1),
    roughness: 1,
    metalness: 0,
    envMapIntensity: 0.6,
  });
  const trimMat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    normalMap: plaster.normalMap,
    roughnessMap: plaster.roughnessMap,
    normalScale: new THREE.Vector2(0.6, 0.6),
    roughness: 0.92,
    metalness: 0,
    envMapIntensity: 0.35,
    // le fasce sono costruite a mano: il culling non deve mangiarsele
    side: THREE.DoubleSide,
  });

  // una mesh per famiglia di facciata: 4 draw call invece di 1, ma il paese
  // smette di sembrare intonacato con lo stesso secchio
  for (const family of Object.keys(wallsByFamily) as FacadeFamily[]) {
    const parts = wallsByFamily[family];
    if (!parts.length) continue;
    const merged = mergeGeometries(parts, false);
    if (!merged) continue;
    const mesh = new THREE.Mesh(merged, wallMats[family]);
    mesh.name = `walls-${family}`;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  if (roofs.length) {
    const merged = mergeGeometries(roofs, false);
    if (merged) {
      const mesh = new THREE.Mesh(merged, roofMat);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);
    }
  }
  if (bases.length) {
    const merged = mergeGeometries(bases, false);
    if (merged) {
      const mesh = new THREE.Mesh(
        merged,
        new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.96, metalness: 0, envMapIntensity: 0.3 }),
      );
      mesh.name = 'plinths';
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);
    }
  }
  if (trims.length) {
    const merged = mergeGeometries(trims, false);
    if (merged) {
      const mesh = new THREE.Mesh(merged, trimMat);
      mesh.name = 'building-trim';
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);
    }
  }
  if (glasses.length) {
    const merged = mergeGeometries(glasses, false);
    if (merged) {
      const mesh = new THREE.Mesh(merged, glassMat);
      mesh.name = 'building-glass';
      mesh.receiveShadow = true;
      group.add(mesh);
    }
  }
  if (glassesLit.length) {
    const merged = mergeGeometries(glassesLit, false);
    if (merged) {
      const mesh = new THREE.Mesh(merged, glassLitMat);
      mesh.name = 'building-glass-lit';
      mesh.receiveShadow = true;
      group.add(mesh);
    }
  }

  for (const g of walls) g.dispose();
  for (const g of roofs) g.dispose();
  for (const g of bases) g.dispose();
  for (const g of trims) g.dispose();
  for (const g of glasses) g.dispose();
  for (const g of glassesLit) g.dispose();

  if (import.meta.env.DEV) console.debug(`[edifici] ${walls.length} case, ${glasses.length} vetri`);
  return { group, count: walls.length };
}

import type { Pt } from '../geo/geo';
import type { Road } from '../geo/osm';

/**
 * Rotatorie ricavate dalla geometria OSM.
 *
 * In OSM una rotatoria è una way chiusa (`junction=roundabout`), ma il file
 * `osm.json` del progetto non conserva quel tag: le strade arrivano con la
 * sola classe. La forma però basta — anello chiuso, quasi circolare e di
 * raggio piccolo — e il riconoscimento geometrico funziona anche sui bundle
 * XYZ e sui dati già committati, senza rigenerare il mondo.
 *
 * Il centro dell'anello non è coperto dai nastri stradali: resta il prato.
 * Qui si costruisce la corona lastricata che sta dentro la carreggiata e la
 * faccia verticale del cordolo dell'isola, come in una rotatoria italiana.
 */
export interface RoundaboutRing {
  center: Pt;
  /** Raggio medio della mezzeria dell'anello. */
  meanRadius: number;
  /** Larghezza della carreggiata. */
  width: number;
  /** Bordo interno della carreggiata: da qui in dentro non c'è asfalto. */
  outerRadius: number;
  /** Bordo interno della corona lastricata (inizio dell'isola). */
  innerRadius: number;
  /** Larghezza della corona lastricata. */
  apronWidth: number;
  segments: number;
}

export const ROUNDABOUT = {
  minRadius: 4,
  maxRadius: 35,
  /** max/mean: un anello rettangolare ha deviazioni molto più alte. */
  roundness: 1.35,
  minInnerRadius: 2.5,
  minPoints: 6,
  closedTolerance: 1.5,
  maxWidth: 12,
  /** Larghezza massima della corona lastricata. */
  apronWidth: 2,
  apronShare: 0.35,
  /** Quota della corona sopra il piano stradale. */
  apronHeight: 0.045,
  /** Cordolo dell'isola: scende sotto l'asfalto e sotto il piano del prato. */
  sink: 0.24,
  step: 2,
} as const;

/** Classi che non sono carreggiate percorribili da un'auto. */
const NON_DRIVABLE = new Set([
  'footway',
  'path',
  'cycleway',
  'pedestrian',
  'steps',
  'bridleway',
  'corridor',
  'track',
]);

function distance(a: Pt, b: Pt): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

function sameRing(ring: RoundaboutRing, other: RoundaboutRing): boolean {
  return (
    distance(ring.center, other.center) < 4 &&
    Math.abs(ring.meanRadius - other.meanRadius) < 2.5
  );
}

/** Due estremi di way più vicini di così appartengono allo stesso nodo OSM. */
const JOIN_TOLERANCE = 2.5;
/** Un giro completo di rotatoria non passa per più di queste way. */
const MAX_RING_WAYS = 16;
/** Una way di rotatoria è corta: un blocco urbano intero non lo è. */
const MAX_RING_WAY_LENGTH = 120;

function isRingCandidate(road: Road): boolean {
  return (
    !road.bridge &&
    !road.tunnel &&
    road.paved &&
    !NON_DRIVABLE.has(road.type) &&
    road.width >= 3 &&
    road.width <= ROUNDABOUT.maxWidth &&
    road.points.length >= 2
  );
}

function ringLength(points: readonly Pt[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += distance(points[i - 1]!, points[i]!);
  }
  return total;
}

/** Toglie i vertici consecutivi coincidenti che i way spezzati ripetono. */
function cleanRingPoints(points: readonly Pt[]): Pt[] {
  const out: Pt[] = [];
  for (const point of points) {
    const last = out[out.length - 1];
    if (last && Math.hypot(point.x - last.x, point.z - last.z) < 0.05) continue;
    out.push(point);
  }
  const first = out[0];
  const last = out[out.length - 1];
  if (first && last && out.length > 1 && Math.hypot(first.x - last.x, first.z - last.z) < 0.05) {
    out.pop();
  }
  return out;
}

/**
 * Trasforma una sequenza di punti in un anello di rotatoria, se la forma è
 * credibile. Scarta anelli troppo grandi (tangenziali, piazze) e troppo
 * irregolari (piazzali, cortili, parcheggi).
 */
function ringFromPoints(points: readonly Pt[], width: number): RoundaboutRing | null {
  const unique = cleanRingPoints(points);
  if (unique.length < ROUNDABOUT.minPoints) return null;
  let sx = 0;
  let sz = 0;
  for (const point of unique) {
    sx += point.x;
    sz += point.z;
  }
  const center = { x: sx / unique.length, z: sz / unique.length };
  let sum = 0;
  let farthest = 0;
  for (const point of unique) {
    const radius = distance(point, center);
    sum += radius;
    if (radius > farthest) farthest = radius;
  }
  const meanRadius = sum / unique.length;
  if (meanRadius < ROUNDABOUT.minRadius || meanRadius > ROUNDABOUT.maxRadius) return null;
  if (farthest > meanRadius * ROUNDABOUT.roundness) return null;

  const outerRadius = meanRadius - width / 2;
  if (outerRadius < ROUNDABOUT.minInnerRadius) return null;
  const apronWidth = Math.min(ROUNDABOUT.apronWidth, outerRadius * ROUNDABOUT.apronShare);
  if (apronWidth < 0.5) return null;
  return {
    center,
    meanRadius,
    width,
    outerRadius,
    innerRadius: outerRadius - apronWidth,
    apronWidth,
    segments: Math.max(24, Math.min(96, Math.round((2 * Math.PI * meanRadius) / ROUNDABOUT.step))),
  };
}

interface RingEndpoint {
  road: number;
  /** 0 = primo punto del way, 1 = ultimo */
  end: 0 | 1;
  x: number;
  z: number;
}

/** Direzione con cui si **esce** dall'estremo entrando nella way. */
function outwardFromEndpoint(points: readonly Pt[], end: 0 | 1): Pt {
  const a = end === 0 ? points[0]! : points[points.length - 1]!;
  const b = end === 0 ? points[1]! : points[points.length - 2]!;
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const length = Math.hypot(dx, dz) || 1;
  return { x: dx / length, z: dz / length };
}

function orientation(points: readonly Pt[], from: 0 | 1): Pt[] {
  return from === 0 ? points.slice() : points.slice().reverse();
}

function turn(a: Pt, b: Pt): number {
  // più piccolo è l'angolo, più la way continua il giro invece di entrare
  // nell'approccio radiale della rotatoria
  return Math.acos(Math.max(-1, Math.min(1, a.x * b.x + a.z * b.z)));
}

/**
 * Unisce più way aperte in un anello.
 *
 * In OSM una rotatoria è spesso spezzata in una way per ogni innesto: ogni
 * tratto finisce sul nodo dell'approccio. Il giro si ricostruisce partendo da
 * un tratto, entrando dal nodo iniziale e scegliendo a ogni estremo la way che
 * prosegue con la curvatura minore (l'approccio radiale gira molto di più).
 * La forma finale deve comunque passare i controlli di `ringFromPoints`.
 */
function stitchedRings(roads: readonly Road[]): RoundaboutRing[] {
  const candidates: number[] = [];
  for (const [index, road] of roads.entries()) {
    if (!isRingCandidate(road)) continue;
    const points = road.points;
    // le way chiuse sono già gestite dal giro semplice
    if (distance(points[0]!, points[points.length - 1]!) <= ROUNDABOUT.closedTolerance) continue;
    if (ringLength(points) > MAX_RING_WAY_LENGTH) continue;
    candidates.push(index);
  }
  if (candidates.length < 2) return [];

  const endpoints: RingEndpoint[] = [];
  for (const index of candidates) {
    const points = roads[index]!.points;
    endpoints.push({ road: index, end: 0, x: points[0]!.x, z: points[0]!.z });
    endpoints.push({
      road: index,
      end: 1,
      x: points[points.length - 1]!.x,
      z: points[points.length - 1]!.z,
    });
  }

  const cell = JOIN_TOLERANCE;
  const buckets = new Map<string, number[]>();
  const bucketKey = (x: number, z: number): string =>
    `${Math.floor(x / cell)},${Math.floor(z / cell)}`;
  for (const [index, endpoint] of endpoints.entries()) {
    const key = bucketKey(endpoint.x, endpoint.z);
    const list = buckets.get(key);
    if (list) list.push(index);
    else buckets.set(key, [index]);
  }

  const nearby = (endpoint: RingEndpoint): number[] => {
    const out: number[] = [];
    const cx = Math.floor(endpoint.x / cell);
    const cz = Math.floor(endpoint.z / cell);
    for (let ix = cx - 1; ix <= cx + 1; ix++) {
      for (let iz = cz - 1; iz <= cz + 1; iz++) {
        for (const index of buckets.get(`${ix},${iz}`) ?? []) {
          const candidate = endpoints[index]!;
          if (candidate.road === endpoint.road) continue;
          if (Math.hypot(candidate.x - endpoint.x, candidate.z - endpoint.z) > JOIN_TOLERANCE) continue;
          out.push(index);
        }
      }
    }
    return out;
  };

  const rings: RoundaboutRing[] = [];
  for (const startIndex of candidates) {
    for (const startEnd of [0, 1] as const) {
      const start = roads[startIndex]!;
      const used = new Set<number>([startIndex]);
      let points = orientation(start.points, startEnd);
      let widthSum = start.width;
      let wayCount = 1;
      let exitEndpoint = startEnd === 0 ? start.points[start.points.length - 1]! : start.points[0]!;
      let success = false;

      for (let step = 0; step < MAX_RING_WAYS; step++) {
        const incomingPoints = points;
        const incoming = outwardFromEndpoint(
          orientation(incomingPoints, 0),
          1,
        );
        // `outwardFromEndpoint(orientation(...), 1)` = direzione di arrivo
        // all'estremo di uscita, cioè il contrario dell'uscita appena percorsa
        const incomingDir = { x: -incoming.x, z: -incoming.z };

        const here: RingEndpoint = {
          road: -1,
          end: 0,
          x: exitEndpoint.x,
          z: exitEndpoint.z,
        };
        const choices = nearby(here)
          .map((index) => endpoints[index]!)
          .filter((endpoint) => {
            if (endpoint.road === startIndex) {
              return endpoint.end === startEnd;
            }
            return !used.has(endpoint.road);
          })
          .map((endpoint) => {
            const next = roads[endpoint.road]!;
            const outgoing = outwardFromEndpoint(next.points, endpoint.end);
            return { endpoint, outgoing, angle: turn(incomingDir, outgoing) };
          })
          .sort((a, b) => a.angle - b.angle);
        const choice = choices[0];
        if (!choice) break;

        if (choice.endpoint.road === startIndex) {
          success = true;
          break;
        }

        const next = roads[choice.endpoint.road]!;
        used.add(choice.endpoint.road);
        widthSum += next.width;
        wayCount++;
        const oriented = orientation(next.points, choice.endpoint.end);
        if (points.length && oriented.length) {
          // il primo punto è il nodo condiviso, già presente
          points = [...points, ...oriented.slice(1)];
        } else {
          points = [...points, ...oriented];
        }
        exitEndpoint = oriented[oriented.length - 1]!;
      }

      if (!success || wayCount < 2) continue;
      // il giro si chiude: il punto iniziale non va duplicato
      const ring = ringFromPoints(points, widthSum / wayCount);
      if (!ring) continue;
      if (rings.some((existing) => sameRing(existing, ring))) continue;
      rings.push(ring);
      // evita di ricostruire lo stesso anello partendo dagli altri tratti
      break;
    }
  }
  return rings;
}

/**
 * Trova gli anelli che sembrano rotatorie.
 *
 * Prima considera le way già chiuse, poi unisce le way aperte che si toccano:
 * nelle mappe OSM una rotatoria è spesso una way per ogni innesto, e senza
 * questa seconda passata il centro resterebbe prato su metà delle rotatorie.
 */
export function detectRoundabouts(roads: readonly Road[]): RoundaboutRing[] {
  const rings: RoundaboutRing[] = [];
  const add = (ring: RoundaboutRing | null): void => {
    if (!ring) return;
    if (rings.some((existing) => sameRing(existing, ring))) return;
    rings.push(ring);
  };

  for (const road of roads) {
    if (!isRingCandidate(road)) continue;
    const points = road.points;
    if (points.length < ROUNDABOUT.minPoints + 1) continue;
    const first = points[0]!;
    const last = points[points.length - 1]!;
    if (distance(first, last) > ROUNDABOUT.closedTolerance) continue;
    // il punto di chiusura duplicato si toglie in `ringFromPoints`
    add(ringFromPoints(points, road.width));
  }

  for (const ring of stitchedRings(roads)) add(ring);
  return rings.sort((a, b) => a.center.z - b.center.z || a.center.x - b.center.x);
}

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

export interface ApronMesh {
  positions: number[];
  normals: number[];
  colors: number[];
  uvs: number[];
  indices: number[];
}

export interface RoundaboutSurface {
  heightAt(x: number, z: number): number;
  normalAt(x: number, z: number, radius?: number): { x: number; y: number; z: number };
}

const emptyMesh = (): ApronMesh => ({
  positions: [],
  normals: [],
  colors: [],
  uvs: [],
  indices: [],
});

function vertex(
  mesh: ApronMesh,
  x: number,
  y: number,
  z: number,
  normal: { x: number; y: number; z: number },
  color: Rgb,
  u: number,
  v: number,
): number {
  const index = mesh.positions.length / 3;
  mesh.positions.push(x, y, z);
  mesh.normals.push(normal.x, normal.y, normal.z);
  mesh.colors.push(color.r, color.g, color.b);
  mesh.uvs.push(u, v);
  return index;
}

function quad(
  mesh: ApronMesh,
  a: number,
  b: number,
  c: number,
  d: number,
): void {
  mesh.indices.push(a, b, c, a, c, d);
}

/**
 * Geometria della corona lastricata e del cordolo dell'isola.
 *
 * `lift` è la quota del piano stradale già comprensiva del micro-offset; la
 * corona sta `apronHeight` sopra, il cordolo scende `sink` sotto.
 */
export function buildRoundaboutAprons(
  rings: readonly RoundaboutRing[],
  surface: RoundaboutSurface,
  surfaceColor: Rgb,
  curbColor: Rgb,
  lift: number,
): { surface: ApronMesh; curb: ApronMesh } {
  const top = emptyMesh();
  const curb = emptyMesh();
  const apronTop = lift + ROUNDABOUT.apronHeight;
  const curbBottom = lift - ROUNDABOUT.sink;

  for (const ring of rings) {
    for (let i = 0; i < ring.segments; i++) {
      const a0 = (i / ring.segments) * Math.PI * 2;
      const a1 = ((i + 1) / ring.segments) * Math.PI * 2;
      const c0 = Math.cos(a0);
      const s0 = Math.sin(a0);
      const c1 = Math.cos(a1);
      const s1 = Math.sin(a1);
      const ox0 = ring.center.x + c0 * ring.outerRadius;
      const oz0 = ring.center.z + s0 * ring.outerRadius;
      const ox1 = ring.center.x + c1 * ring.outerRadius;
      const oz1 = ring.center.z + s1 * ring.outerRadius;
      const ix0 = ring.center.x + c0 * ring.innerRadius;
      const iz0 = ring.center.z + s0 * ring.innerRadius;
      const ix1 = ring.center.x + c1 * ring.innerRadius;
      const iz1 = ring.center.z + s1 * ring.innerRadius;
      const n0 = surface.normalAt((ox0 + ix0) / 2, (oz0 + iz0) / 2, 4);
      const n1 = surface.normalAt((ox1 + ix1) / 2, (oz1 + iz1) / 2, 4);
      const u0 = (a0 * ring.meanRadius) / 6;
      const u1 = (a1 * ring.meanRadius) / 6;
      const outerV = ring.apronWidth / 6;
      const o0 = top.positions.length / 3;
      vertex(top, ox0, surface.heightAt(ox0, oz0) + apronTop, oz0, n0, surfaceColor, u0, 0);
      vertex(top, ox1, surface.heightAt(ox1, oz1) + apronTop, oz1, n1, surfaceColor, u1, 0);
      vertex(top, ix1, surface.heightAt(ix1, iz1) + apronTop, iz1, n1, surfaceColor, u1, outerV);
      vertex(top, ix0, surface.heightAt(ix0, iz0) + apronTop, iz0, n0, surfaceColor, u0, outerV);
      quad(top, o0, o0 + 1, o0 + 2, o0 + 3);

      // faccia esterna del cordolo: normale verso la carreggiata (fuori dal centro)
      const curbTop0 = surface.heightAt(ix0, iz0) + apronTop;
      const curbTop1 = surface.heightAt(ix1, iz1) + apronTop;
      const curbBottom0 = surface.heightAt(ix0, iz0) + curbBottom;
      const curbBottom1 = surface.heightAt(ix1, iz1) + curbBottom;
      const c0i = curb.positions.length / 3;
      vertex(curb, ix0, curbTop0, iz0, { x: c0, y: 0, z: s0 }, curbColor, u0, 1);
      vertex(curb, ix1, curbTop1, iz1, { x: c1, y: 0, z: s1 }, curbColor, u1, 1);
      vertex(curb, ix1, curbBottom1, iz1, { x: c1, y: 0, z: s1 }, curbColor, u1, 0);
      vertex(curb, ix0, curbBottom0, iz0, { x: c0, y: 0, z: s0 }, curbColor, u0, 0);
      quad(curb, c0i, c0i + 1, c0i + 2, c0i + 3);
    }
  }
  return { surface: top, curb };
}

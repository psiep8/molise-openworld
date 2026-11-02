import * as THREE from 'three';
import { latLonToWorld } from '../config';
import type { Heightfield } from '../geo/elevation';
import { AREA_COLORS } from '../geo/osm';
import type { GeoAreaFeature, GeoPoint, WorldDataTile } from '../geo/world-tiles';
import type { LocalBounds } from './streamed-world';

/**
 * Superfici dei tile geografici: aree (acqua, abitato, cave) e copertura del
 * suolo (boschi, prati, coltivi).
 *
 * Sono poligoni OSM chiusi, non una griglia raster: si drappeggiano sul DEM
 * locale a triangoli, con un piccolo sollevamento per non litigare con il
 * terreno. Fuori dal bbox locale comanda OSM locale, quindi i poligoni che lo
 * toccano vengono saltati (stessa regola di strade ed edifici).
 */

export interface StreamedAreaStats {
  areas: number;
  landcover: number;
  pois: number;
  triangles: number;
  /** poligoni saltati perché dentro il DEM locale (li disegna già lì OSM) */
  skipped: number;
}

export interface StreamedAreaResult {
  group: THREE.Group;
  stats: StreamedAreaStats;
}

/** Ricopre una feature con i triangoli del suo anello, drappeggiati sul DEM. */
export function buildStreamedAreas(
  tile: WorldDataTile,
  heights: Heightfield,
  localBounds: LocalBounds,
): StreamedAreaResult {
  const group = new THREE.Group();
  group.name = `streamed-areas-${tile.tile.z}/${tile.tile.x}/${tile.tile.y}`;
  const stats: StreamedAreaStats = {
    areas: 0,
    landcover: 0,
    pois: tile.pois.length,
    triangles: 0,
    skipped: 0,
  };

  const surfaces: { feature: GeoAreaFeature; landcover: boolean }[] = [
    ...tile.landcover.map((feature) => ({ feature, landcover: true })),
    ...tile.areas.map((feature) => ({ feature, landcover: false })),
  ];
  if (surfaces.length === 0) return { group, stats };

  const positions: number[] = [];
  const colors: number[] = [];
  const color = new THREE.Color();

  for (const { feature, landcover } of surfaces) {
    const points = feature.points.map(project);
    if (points.length < 3) continue;
    if (overlapsLocal(points, localBounds)) {
      stats.skipped++;
      continue;
    }
    const ring = dedupeRing(points);
    if (ring.length < 3) continue;
    const colorHex = AREA_COLORS[feature.kind] ?? (landcover ? 0x8a9a63 : 0x8d8677);
    color.setHex(colorHex);

    // Acqua e superfici piatte: un solo livello, altrimenti sui pendii il
    // poligono "sale" come una collina d'acqua.
    const flat = !landcover || feature.kind === 'water';
    const waterLevel = flat
      ? median(ring.map((point) => heights.heightAt(point.x, point.z))) + 0.12
      : 0;
    const lift = landcover ? 0.06 : 0.1;

    const contour = ring.map((point) => new THREE.Vector2(point.x, -point.z));
    let triangles: number[][];
    try {
      triangles = THREE.ShapeUtils.triangulateShape(contour, []);
    } catch {
      continue;
    }
    const at = (point: { x: number; z: number }): { x: number; y: number; z: number } => ({
      x: point.x,
      y: flat ? waterLevel : heights.heightAt(point.x, point.z) + lift,
      z: point.z,
    });

    for (const [i, j, k] of triangles) {
      const a = ring[i];
      const b = ring[j];
      const c = ring[k];
      if (!a || !b || !c) continue;
      pushDraped(positions, colors, color, [at(a), at(b), at(c)], heights, flat ? waterLevel : null, lift);
    }

    if (landcover) stats.landcover++;
    else stats.areas++;
  }

  stats.triangles = positions.length / 9;
  if (positions.length === 0) return { group, stats };

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 1,
    metalness: 0,
    // le superfici stanno pochi centimetri sopra il terreno: senza offset il
    // paesaggio "sfarfalla" a distanza
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'streamed-areas';
  mesh.receiveShadow = true;
  mesh.castShadow = false;
  group.add(mesh);
  return { group, stats };
}

/**
 * Triangolo drappeggiato: se i lati superano ~90 m si spezza verso il centro,
 * altrimenti una collina dentro un campo resta un piano che sprofonda.
 */
function pushDraped(
  positions: number[],
  colors: number[],
  color: THREE.Color,
  triangle: { x: number; y: number; z: number }[],
  heights: Heightfield,
  flatY: number | null,
  lift: number,
  depth = 0,
): void {
  const [a, b, c] = triangle as [
    { x: number; y: number; z: number },
    { x: number; y: number; z: number },
    { x: number; y: number; z: number },
  ];
  const longest = Math.max(
    Math.hypot(a.x - b.x, a.z - b.z),
    Math.hypot(b.x - c.x, b.z - c.z),
    Math.hypot(c.x - a.x, c.z - a.z),
  );
  if (longest > 90 && depth < 3) {
    const mx = (a.x + b.x + c.x) / 3;
    const mz = (a.z + b.z + c.z) / 3;
    const mid = {
      x: mx,
      y: flatY ?? heights.heightAt(mx, mz) + lift,
      z: mz,
    };
    pushDraped(positions, colors, color, [a, b, mid], heights, flatY, lift, depth + 1);
    pushDraped(positions, colors, color, [b, c, mid], heights, flatY, lift, depth + 1);
    pushDraped(positions, colors, color, [c, a, mid], heights, flatY, lift, depth + 1);
    return;
  }
  for (const point of [a, b, c]) {
    positions.push(point.x, point.y, point.z);
    colors.push(color.r, color.g, color.b);
  }
}

function project(point: GeoPoint): { x: number; z: number } {
  const world = latLonToWorld(point.lat, point.lon);
  return { x: world.x, z: world.z };
}

function dedupeRing(points: { x: number; z: number }[]): { x: number; z: number }[] {
  const out: { x: number; z: number }[] = [];
  for (const point of points) {
    const last = out[out.length - 1];
    if (last && Math.abs(last.x - point.x) < 0.01 && Math.abs(last.z - point.z) < 0.01) continue;
    out.push(point);
  }
  if (out.length > 1) {
    const first = out[0]!;
    const last = out[out.length - 1]!;
    if (Math.abs(last.x - first.x) < 0.01 && Math.abs(last.z - first.z) < 0.01) out.pop();
  }
  return out;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)]!;
}

function overlapsLocal(points: readonly { x: number; z: number }[], bounds: LocalBounds): boolean {
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const point of points) {
    minX = Math.min(minX, point.x);
    maxX = Math.max(maxX, point.x);
    minZ = Math.min(minZ, point.z);
    maxZ = Math.max(maxZ, point.z);
  }
  return minX <= bounds.maxX && maxX >= bounds.minX && minZ <= bounds.maxZ && maxZ >= bounds.minZ;
}

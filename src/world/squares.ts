import * as THREE from 'three';
import type { Heightfield } from '../geo/elevation';
import { ROAD_LIFT, type OsmData, type Square } from '../geo/osm';
import { ROAD_PROFILE } from './road-profile';
import type { CityKit } from './citykit';
import type { PavedArea } from './paved';

/**
 * Piazze OSM (`area=yes` / `place=square`).
 *
 * Sono way chiusi con `highway=residential` o `pedestrian`: se restano nella
 * lista delle strade, `buildRoads` disegna asfalto e cordolo solo lungo il
 * perimetro e il centro resta erba. Una piazza vera è una superficie continua:
 * qui il poligono viene triangolato, drappeggiato sul DEM e rialzato alla quota
 * del marciapiede, con un cordolo perimetrale basso.
 *
 * Fuori restano le piazze della chiesa (`piazza.ts`), che hanno già una
 * geometria e un arredo propri.
 */

export interface SquaresResult {
  group: THREE.Group;
  /** Aree da passare a erba, vegetazione e quota calpestabile. */
  paved: PavedArea[];
}

/** Quota della lastra: sopra il marciapiede procedurale di 1 cm. */
const SQUARE_LIFT = ROAD_LIFT + ROAD_PROFILE.curbHeight + 0.015;

function squareSurface(square: Square, heights: Heightfield): THREE.BufferGeometry | null {
  const points = square.points;
  if (points.length < 3) return null;
  const shape = new THREE.Shape(points.map((p) => new THREE.Vector2(p.x, -p.z)));
  const geometry = new THREE.ShapeGeometry(shape);
  geometry.rotateX(-Math.PI / 2);
  const position = geometry.getAttribute('position') as THREE.BufferAttribute;
  const uv = new Float32Array(position.count * 2);
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i);
    const z = position.getZ(i);
    position.setY(i, heights.heightAt(x, z) + SQUARE_LIFT);
    // lastre metriche: la texture non si stira cambiando la forma della piazza
    uv[i * 2] = x / 4;
    uv[i * 2 + 1] = z / 4;
  }
  position.needsUpdate = true;
  geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geometry.computeVertexNormals();
  return geometry;
}

/** Cordolo basso lungo il bordo: dà lo scalino verso l'asfalto. */
function buildKerb(square: Square, heights: Heightfield): THREE.BufferGeometry | null {
  const points = square.points;
  if (points.length < 3) return null;
  const positions: number[] = [];
  const indices: number[] = [];
  for (let i = 0; i < points.length; i++) {
    const a = points[i]!;
    const b = points[(i + 1) % points.length]!;
    const base = positions.length / 3;
    const ay = heights.heightAt(a.x, a.z);
    const by = heights.heightAt(b.x, b.z);
    // top sul filo della lastra, bottom sul velo d'asfalto
    positions.push(a.x, ay + SQUARE_LIFT, a.z);
    positions.push(b.x, by + SQUARE_LIFT, b.z);
    positions.push(b.x, by + ROAD_LIFT, b.z);
    positions.push(a.x, ay + ROAD_LIFT, a.z);
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

export function buildSquares(osm: OsmData, heights: Heightfield, kit: CityKit | null): SquaresResult {
  const group = new THREE.Group();
  group.name = 'squares';
  const paved: PavedArea[] = [];
  const squares = osm.squares ?? [];
  if (squares.length === 0) return { group, paved };

  const baseMaterial =
    kit?.material('plaza', 'paving', { repeat: [1, 1] }) ??
    kit?.material('sidewalk', 'footway_flags', { repeat: [0.55, 0.5], white: true }) ??
    null;
  const surfaceMaterial = baseMaterial
    ? baseMaterial.clone()
    : new THREE.MeshStandardMaterial({ color: 0x9c9a92, roughness: 0.96, metalness: 0 });
  surfaceMaterial.side = THREE.DoubleSide;
  surfaceMaterial.polygonOffset = true;
  surfaceMaterial.polygonOffsetFactor = -1;
  surfaceMaterial.polygonOffsetUnits = -1;
  const kerbMaterial =
    kit?.material('sidewalk', 'granite_kerb', { repeat: [1, 1], white: true })?.clone() ??
    new THREE.MeshStandardMaterial({ color: 0xb9b3a6, roughness: 0.95, metalness: 0 });
  kerbMaterial.side = THREE.DoubleSide;

  for (const square of squares) {
    const geometry = squareSurface(square, heights);
    if (!geometry) continue;
    const mesh = new THREE.Mesh(geometry, surfaceMaterial);
    mesh.name = `square-paving:${square.name}`;
    mesh.receiveShadow = true;
    group.add(mesh);

    const kerbGeometry = buildKerb(square, heights);
    if (kerbGeometry) {
      const kerb = new THREE.Mesh(kerbGeometry, kerbMaterial);
      kerb.name = `square-kerb:${square.name}`;
      kerb.receiveShadow = true;
      group.add(kerb);
    }

    const b = square.bounds;
    paved.push({
      x: (b.minX + b.maxX) * 0.5,
      z: (b.minZ + b.maxZ) * 0.5,
      yaw: 0,
      halfW: (b.maxX - b.minX) * 0.5,
      halfD: (b.maxZ - b.minZ) * 0.5,
      points: square.points,
      lift: SQUARE_LIFT,
    });
  }

  return { group, paved };
}

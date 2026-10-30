import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { CHUNK_SIZE, TERRAIN_SEGMENTS } from '../src/config';
import { Heightfield, type HeightMeta } from '../src/geo/elevation';
import { createTerrainSurface, TERRAIN_MESH_STEP, terrainMeshHeightAt } from '../src/geo/terrain-surface';

/** DEM sintetico ma non piatto: una collina e una sella, niente planarità. */
function bumpyHeights(origin = -100, size = 1200, step = 5): Heightfield {
  const nx = Math.round(size / step) + 1;
  const nz = nx;
  const meta: HeightMeta = {
    source: 'test',
    license: 'test',
    attribution: 'test',
    encoding: 'int16-le, decimetri',
    step,
    nx,
    nz,
    originX: origin,
    originZ: origin,
    lat: 41.87,
    lon: 14.775,
    metersPerDegLat: 111145,
    metersPerDegLon: 83014,
    minElevation: 0,
    maxElevation: 500,
    generatedAt: 'test',
  };
  const data = new Int16Array(nx * nz);
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const x = origin + i * step;
      const z = origin + j * step;
      const h =
        300 +
        26 * Math.sin(x / 115) * Math.cos(z / 97) +
        9 * Math.sin(x / 41 + z / 33) +
        4 * Math.cos(z / 23);
      data[j * nx + i] = Math.round(h * 10);
    }
  }
  return new Heightfield(meta, data);
}

/** La mesh vera del terreno, con gli stessi vertici e indici di `terrain.ts`. */
function terrainPlane(heights: Heightfield, chunkX = 0, chunkZ = 0): THREE.Mesh {
  const geometry = new THREE.PlaneGeometry(CHUNK_SIZE, CHUNK_SIZE, TERRAIN_SEGMENTS, TERRAIN_SEGMENTS);
  geometry.rotateX(-Math.PI / 2);
  geometry.translate((chunkX + 0.5) * CHUNK_SIZE, 0, (chunkZ + 0.5) * CHUNK_SIZE);
  const position = geometry.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < position.count; i++) {
    position.setY(i, heights.heightAt(position.getX(i), position.getZ(i)));
  }
  position.needsUpdate = true;
  const material = new THREE.MeshBasicMaterial();
  return new THREE.Mesh(geometry, material);
}

/** Quota della mesh in un punto, interpolando i triangoli veri. */
function meshHeight(mesh: THREE.Mesh, x: number, z: number): number {
  const geometry = mesh.geometry as THREE.BufferGeometry;
  const position = geometry.getAttribute('position') as THREE.BufferAttribute;
  const index = geometry.getIndex()!;
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  for (let t = 0; t < index.count; t += 3) {
    a.fromBufferAttribute(position, index.getX(t));
    b.fromBufferAttribute(position, index.getX(t + 1));
    c.fromBufferAttribute(position, index.getX(t + 2));
    const tri = new THREE.Triangle(
      new THREE.Vector3(a.x, 0, a.z),
      new THREE.Vector3(b.x, 0, b.z),
      new THREE.Vector3(c.x, 0, c.z),
    );
    const point = new THREE.Vector3(x, 0, z);
    if (!tri.containsPoint(point)) continue;
    const d = tri.getBarycoord(point, new THREE.Vector3());
    if (!d) continue;
    return a.y * d.x + b.y * d.y + c.y * d.z;
  }
  throw new Error(`punto fuori dalla mesh: ${x}, ${z}`);
}

describe('superficie della mesh del terreno', () => {
  it('riproduce la triangolazione di PlaneGeometry', () => {
    const heights = bumpyHeights();
    const mesh = terrainPlane(heights);
    // punti sparsi, compresi i bordi cella e le diagonali
    const points: [number, number][] = [
      [12.3, 44.7],
      [100, 100],
      [9.5 * 3, 9.5 * 3],
      [4.75, 4.75],
      [9.5 * 7 + 0.01, 9.5 * 2 + 3],
      [800.4, 305.2],
      [456, 456],
    ];
    for (const [x, z] of points) {
      // 4 decimali: le posizioni dei vertici in three.js sono float32
      expect(terrainMeshHeightAt(heights, x, z)).toBeCloseTo(meshHeight(mesh, x, z), 4);
    }
  });

  it('vale anche nei chunk lontani dall\'origine', () => {
    const heights = bumpyHeights();
    const mesh = terrainPlane(heights, 2, -1);
    for (const [x, z] of [
      [2 * CHUNK_SIZE + 31.7, -CHUNK_SIZE + 44.2],
      [2 * CHUNK_SIZE + 9.5 * 17, -CHUNK_SIZE + 9.5 * 33],
    ] as const) {
      expect(terrainMeshHeightAt(heights, x, z)).toBeCloseTo(meshHeight(mesh, x, z), 4);
    }
  });

  it('il campionatore con cache dà gli stessi numeri del campionamento puro', () => {
    const heights = bumpyHeights();
    const surface = createTerrainSurface(heights);
    let checked = 0;
    for (let x = 12; x < 900; x += 37.3) {
      for (let z = 18; z < 900; z += 41.9) {
        expect(surface.heightAt(x, z)).toBeCloseTo(terrainMeshHeightAt(heights, x, z), 9);
        // la seconda volta arriva dalla cache: deve restare identica
        expect(surface.heightAt(x, z)).toBe(surface.heightAt(x, z));
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(200);
  });

  it('la normale del campionatore segue la mesh, non il DEM', () => {
    const heights = bumpyHeights();
    const surface = createTerrainSurface(heights);
    const normal = surface.normalAt(455, 455, 5);
    const eps = 5;
    expect(normal.x).toBeCloseTo(surface.heightAt(455 - eps, 455) - surface.heightAt(455 + eps, 455), 9);
    expect(normal.z).toBeCloseTo(surface.heightAt(455, 455 - eps) - surface.heightAt(455, 455 + eps), 9);
    expect(normal.y).toBe(2 * eps);
  });

  it('resta continua sul bordo del chunk', () => {
    const heights = bumpyHeights();
    const before = terrainMeshHeightAt(heights, CHUNK_SIZE - 0.001, 300);
    const after = terrainMeshHeightAt(heights, CHUNK_SIZE + 0.001, 300);
    expect(Math.abs(after - before)).toBeLessThan(0.01);
    const beforeZ = terrainMeshHeightAt(heights, 300, CHUNK_SIZE - 0.001);
    const afterZ = terrainMeshHeightAt(heights, 300, CHUNK_SIZE + 0.001);
    expect(Math.abs(afterZ - beforeZ)).toBeLessThan(0.01);
  });

  it('non è il DEM bilineare: è la superficie che si vede', () => {
    const heights = bumpyHeights();
    // su una collina, a metà fra due vertici della mesh, la corda passa sotto
    let worst = 0;
    for (let x = 20; x < 900; x += 7.3) {
      for (let z = 20; z < 900; z += 11.1) {
        worst = Math.max(worst, Math.abs(terrainMeshHeightAt(heights, x, z) - heights.heightAt(x, z)));
      }
    }
    // se le due superfici fossero uguali questo test non avrebbe senso:
    // la mesh da 9,5 m taglia i dossi del DEM a 5 m
    expect(worst).toBeGreaterThan(0.05);
    expect(TERRAIN_MESH_STEP).toBeCloseTo(9.5, 6);
  });

  it('rifiuta coordinate non finite', () => {
    const heights = bumpyHeights();
    expect(() => terrainMeshHeightAt(heights, Number.NaN, 0)).toThrow();
    expect(() => terrainMeshHeightAt(heights, 0, Number.POSITIVE_INFINITY)).toThrow();
  });
});

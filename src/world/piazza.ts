import * as THREE from 'three';
import type { Heightfield } from '../geo/elevation';
import { pointInPolygon } from '../geo/geo';
import type { Building, BuildingIndex, RoadIndex } from '../geo/osm';
import type { CityKit } from './citykit';
import type { PavedArea } from './paved';
import type { WorldKit } from './worldkit';

/**
 * Sagrato/piazza davanti alla chiesa.
 *
 * Il materiale è quello del kit (`realistic-plaza-paving-01`, parte `paving`),
 * ma la geometria non è la tile da 12 m: la piazza è un piano drappeggiato sul
 * DEM, con UV metriche (una mattonata ogni 12 m), perché una lastra rigida su
 * un pendio molisano resterebbe sospesa da un lato.
 *
 * La piazza sta **davanti alla facciata**, cioè sul +Z locale della chiesa, e
 * non entra nell'indice delle collisioni: si cammina sopra. La sua impronta
 * viene invece passata a erba e vegetazione (`paved.ts`), che altrimenti ci
 * farebbero crescere sopra i ciuffi.
 *
 * Se la chiesa è stata piazzata su un pendio troppo forte o contro una strada,
 * la piazza si restringe; se non c'è spazio, non si costruisce affatto.
 */

const Z_START = 7.4;
const SIZES: [number, number][] = [
  [16, 12],
  [13, 10],
  [10, 8],
];

export interface Piazza {
  group: THREE.Group;
  area: PavedArea;
}

export function buildChurchPiazza(
  church: {
    spot: { x: number; z: number; yaw: number; floor: number };
    footprint: Building;
  },
  heights: Heightfield,
  roads: RoadIndex,
  buildings: BuildingIndex,
  kit: CityKit,
  worldKit: WorldKit | null = null,
): Piazza | null {
  const paving = kit.material('plaza', 'paving', { repeat: [1, 1] });
  if (!paving) return null;
  const kerbMaterial = kit.material('sidewalk', 'granite_kerb', { repeat: [1, 1] });

  const { x, z, yaw } = church.spot;
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);
  const toWorld = (lx: number, lz: number): { x: number; z: number } => ({
    x: x + lx * cos + lz * sin,
    z: z - lx * sin + lz * cos,
  });

  let width = 0;
  let depth = 0;
  for (const [w, d] of SIZES) {
    const halfW = w / 2;
    let ok = true;
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 0; i <= 4 && ok; i++) {
      for (let j = 0; j <= 3 && ok; j++) {
        const lx = -halfW + (i / 4) * w;
        const lz = Z_START + (j / 3) * d;
        const p = toWorld(lx, lz);
        const h = heights.heightAt(p.x, p.z);
        lo = Math.min(lo, h);
        hi = Math.max(hi, h);
        if (heights.slopeAt(p.x, p.z) > 16) {
          ok = false;
          break;
        }
        // la piazza può appoggiarsi alla chiesa (sotto i gradini), non a una casa
        if (pointInPolygon(p.x, p.z, church.footprint.points)) continue;
        if (roads.isOnRoad(p.x, p.z, 0.4) || buildings.hitsCircle(p.x, p.z, 0.5)) ok = false;
      }
    }
    // su un dislivello di oltre un metro non è una piazza, è una rampa
    if (ok && hi - lo <= 1.1) {
      width = w;
      depth = d;
      break;
    }
  }
  if (width === 0) return null;

  const halfW = width / 2;
  const halfD = depth / 2;
  const group = new THREE.Group();
  group.name = 'church-piazza';

  // piano drappeggiato sul terreno, 14 × 8 segmenti
  const NX = 14;
  const NZ = 8;
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  for (let j = 0; j <= NZ; j++) {
    for (let i = 0; i <= NX; i++) {
      const lx = -halfW + (i / NX) * width;
      const lz = Z_START + (j / NZ) * depth;
      const p = toWorld(lx, lz);
      positions.push(p.x, heights.heightAt(p.x, p.z) + 0.05, p.z);
      uvs.push((lx + halfW) / 12, (lz - Z_START) / 12);
    }
  }
  for (let j = 0; j < NZ; j++) {
    for (let i = 0; i < NX; i++) {
      const a = j * (NX + 1) + i;
      const b = a + 1;
      const c = a + (NX + 1);
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const pavingMesh = new THREE.Mesh(geometry, paving);
  pavingMesh.name = 'piazza-paving';
  pavingMesh.receiveShadow = true;
  group.add(pavingMesh);

  // cordolo in granito sui tre lati aperti del sagrato
  if (kerbMaterial) {
    const kerbGeo = new THREE.BoxGeometry(0.3, 0.16, 1);
    const spots: { x: number; y: number; z: number; yaw: number; len: number }[] = [];
    const step = 1.5;
    // solo il lato aperto: il lato della chiesa è già chiuso dai gradini
    for (let lx = -halfW; lx <= halfW + 0.001; lx += step) {
      const p = toWorld(Math.min(lx + step / 2, halfW), Z_START + depth - 0.15);
      spots.push({
        x: p.x,
        y: heights.heightAt(p.x, p.z) + 0.05,
        z: p.z,
        yaw: yaw + Math.PI / 2,
        len: step,
      });
    }
    for (let lz = Z_START + step; lz < Z_START + depth; lz += step) {
      for (const lx of [-halfW, halfW]) {
        const p = toWorld(lx, Math.min(lz + step / 2, Z_START + depth));
        spots.push({
          x: p.x,
          y: heights.heightAt(p.x, p.z) + 0.05,
          z: p.z,
          yaw,
          len: step,
        });
      }
    }
    const mesh = new THREE.InstancedMesh(kerbGeo, kerbMaterial, spots.length);
    mesh.name = 'piazza-kerb';
    const dummy = new THREE.Object3D();
    spots.forEach((s, i) => {
      dummy.position.set(s.x, s.y + 0.08, s.z);
      dummy.rotation.set(0, s.yaw, 0);
      dummy.scale.set(1, 1, s.len);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }

  // due panchine ai lati, rivolte verso il centro
  if (kit.has('bench')) {
    const centerZ = Z_START + depth / 2;
    const benches = [-1, 1].map((side) => {
      const p = toWorld(side * (halfW - 1.15), centerZ);
      return {
        x: p.x,
        y: heights.heightAt(p.x, p.z) + 0.05,
        z: p.z,
        yaw: yaw - side * (Math.PI / 2),
      };
    });
    group.add(kit.instances('bench', benches, { castShadow: true }));
  }

  const center = toWorld(0, Z_START + depth / 2);
  // arredo minuto del world kit: due fioriere davanti e due lampioni da
  // sentiero sul fondo. Sono riserve piccole che qui hanno un posto vero,
  // senza aggiungere nuovi sistemi di piazzamento.
  if (worldKit) {
    if (worldKit.has('planter')) {
      const planters = [-1, 1].map((side) => {
        const p = toWorld(side * (halfW - 1), Z_START + 1.2);
        return {
          x: p.x,
          y: heights.heightAt(p.x, p.z) + 0.05,
          z: p.z,
          yaw,
        };
      });
      group.add(worldKit.instances('planter', planters, { castShadow: true }));
    }
    if (worldKit.has('pathlight')) {
      const lights = [-1, 1].map((side) => {
        const p = toWorld(side * (halfW - 1.1), Z_START + depth - 1.1);
        return {
          x: p.x,
          y: heights.heightAt(p.x, p.z) + 0.05,
          z: p.z,
          yaw,
        };
      });
      group.add(worldKit.instances('pathlight', lights, { castShadow: true }));
    }
  }
  return {
    group,
    area: { x: center.x, z: center.z, yaw, halfW: halfW + 0.4, halfD: halfD + 0.2 },
  };
}

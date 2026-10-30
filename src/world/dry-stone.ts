import * as THREE from 'three';
import type { Heightfield } from '../geo/elevation';
import { mulberry32 } from '../geo/geo';
import type { BuildingIndex, OsmData, RoadIndex } from '../geo/osm';
import { pbr } from '../gfx/textures';

/** Oltre questo numero di conci il muretto non cresce più (draw call unica). */
const MAX_BLOCKS = 6000;

/**
 * Muretti a secco lungo le strade di campagna.
 *
 * È l'elemento che più di ogni altro dice "Molise": pietre irregolari
 * accumulate a secco, alte poco meno di un metro, che seguono il bordo della
 * strada e ogni tanto crollano. Sono un solo `InstancedMesh` di conci con la
 * texture della pietra: qualche migliaio di blocchi costa una draw call.
 *
 * I muretti si mettono solo ai lati delle strade sterrate (quelle asfaltate
 * hanno già cordolo e marciapiede) e mai dentro una casa o un'altra strada.
 */
export function buildDryStoneWalls(
  osm: OsmData,
  heights: Heightfield,
  roads: RoadIndex,
  buildings: BuildingIndex,
  renderer: THREE.WebGLRenderer,
): THREE.Group {
  const group = new THREE.Group();
  group.name = 'dry-stone-walls';
  const rng = mulberry32(0x9a11);
  const matrices: THREE.Matrix4[] = [];
  const tints: THREE.Color[] = [];
  const dummy = new THREE.Object3D();
  const tint = new THREE.Color();
  const base = new THREE.Color(0xd6cab4);

  for (const road of osm.roads) {
    // solo le sterrate: in paese il cordolo basta e avanza
    if (road.paved || road.points.length < 3) continue;
    // un muretto su un lato solo: due muri che fiancheggiano la via sono rari
    const side = rng() < 0.5 ? -1 : 1;
    const offset = road.width / 2 + 2.3 + rng() * 1.4;

    for (let i = 1; i < road.points.length && matrices.length < MAX_BLOCKS; i++) {
      const a = road.points[i - 1];
      const b = road.points[i];
      const seg = Math.hypot(b.x - a.x, b.z - a.z);
      if (seg < 0.01) continue;
      const tx = (b.x - a.x) / seg;
      const tz = (b.z - a.z) / seg;
      const px = -tz;
      const pz = tx;
      // il concio è lungo 2,5 m sull'asse X: per allinearlo alla tangente
      // (tx, tz) serve atan2(-tz, tx). Con atan2(tx, tz) i blocchi stavano
      // ruotati di 90°: muri di denti staccati invece che una linea continua
      const yaw = Math.atan2(-tz, tx);

      // un concio ogni 2,4 m, con qualche vuoto (tratti crollati)
      for (let s = 0; s < seg; s += 2.4) {
        if (matrices.length >= MAX_BLOCKS) break;
        if (rng() < 0.16) continue;
        const x = a.x + tx * s + px * offset * side;
        const z = a.z + tz * s + pz * offset * side;
        if (roads.isOnRoad(x, z, 1.4)) continue;
        if (buildings.hitsCircle(x, z, 1.2)) continue;
        if (heights.slopeAt(x, z) > 26) continue;

        const y = heights.heightAt(x, z);
        dummy.position.set(x, y + 0.3, z);
        dummy.rotation.set((rng() - 0.5) * 0.06, yaw + (rng() - 0.5) * 0.1, (rng() - 0.5) * 0.05);
        // altezza irregolare: 55-85 cm fuori terra, il resto interrato
        const h = 0.82 + rng() * 0.26;
        dummy.scale.set(0.94 + rng() * 0.12, h / 0.8, 0.9 + rng() * 0.2);
        dummy.updateMatrix();
        matrices.push(dummy.matrix.clone());
        tint.copy(base).multiplyScalar(0.78 + rng() * 0.36);
        tints.push(tint.clone());
      }
    }
  }

  if (!matrices.length) return group;

  const geo = new THREE.BoxGeometry(2.5, 0.8, 0.55);
  const mat = new THREE.MeshStandardMaterial({
    ...pbr(renderer, 'stonewall', { repeat: 1, normal: true, rough: true }),
    color: 0xffffff,
    roughness: 1,
    metalness: 0,
    normalScale: new THREE.Vector2(1.2, 1.2),
    envMapIntensity: 0.32,
  });
  const mesh = new THREE.InstancedMesh(geo, mat, matrices.length);
  mesh.name = 'dry-stone-blocks';
  matrices.forEach((m, i) => {
    mesh.setMatrixAt(i, m);
    mesh.setColorAt(i, tints[i]);
  });
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  group.add(mesh);
  return group;
}

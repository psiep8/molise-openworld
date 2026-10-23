import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Heightfield } from '../geo/elevation';
import { mulberry32 } from '../geo/geo';
import type { BuildingIndex, OsmData, RoadIndex } from '../geo/osm';

/** Distanza tra un palo e il successivo (m). */
const SPACING = 38;
/** Oltre questo numero di pali non si va: resta una sola draw call per i pali. */
const MAX_POLES = 800;
/** Quanti segmenti disegnano la curva del filo tra due pali. */
const WIRE_SEGMENTS = 6;

/**
 * Pali della luce e fili lungo le strade asfaltate.
 *
 * È il dettaglio che riempie il cielo sopra le strade di campagna: un palo ogni
 * 38 m, con traversa e tre fili che pendono fra un palo e l'altro. I fili sono
 * `LineSegments` (una draw call), i pali un `InstancedMesh` (un'altra): due
 * chiamate in tutto, per un effetto che da lontano si nota subito.
 *
 * I pali non finiscono in mezzo alla strada, dentro una casa o su un pendio
 * troppo ripido; i fili non vengono tesi attraverso i buchi (distanza > 50 m).
 */
export function buildPowerLines(
  osm: OsmData,
  heights: Heightfield,
  roads: RoadIndex,
  buildings: BuildingIndex,
): THREE.Group {
  const group = new THREE.Group();
  group.name = 'power-lines';
  const rng = mulberry32(0x51a7);

  const poles: { x: number; y: number; z: number; yaw: number }[] = [];
  const wire: number[] = [];

  /** Punti d'attacco dei fili sulla traversa, in coordinate mondo. */
  const anchors = (p: { x: number; y: number; z: number; yaw: number }): THREE.Vector3[] => {
    const px = Math.cos(p.yaw);
    const pz = -Math.sin(p.yaw);
    return [-0.58, 0, 0.58].map((d) =>
      new THREE.Vector3(p.x + px * d, p.y + 7.1, p.z + pz * d),
    );
  };

  const connect = (a: typeof poles[number], b: typeof poles[number]): void => {
    const from = anchors(a);
    const to = anchors(b);
    const span = Math.hypot(b.x - a.x, b.z - a.z);
    if (span > 52) return;
    const sag = 0.45 + span * 0.006;
    for (let w = 0; w < 3; w++) {
      let prev = from[w]!;
      for (let s = 1; s <= WIRE_SEGMENTS; s++) {
        const t = s / WIRE_SEGMENTS;
        const p = from[w]!.clone().lerp(to[w]!, t);
        // parabola: massimo abbassamento a metà campata
        p.y -= sag * 4 * t * (1 - t);
        wire.push(prev.x, prev.y, prev.z, p.x, p.y, p.z);
        prev = p;
      }
    }
  };

  for (const road of osm.roads) {
    if (!road.paved || road.points.length < 3) continue;
    if (poles.length >= MAX_POLES) break;
    // lato scelto una volta per strada, così la linea non zigzaga
    const side = rng() < 0.5 ? -1 : 1;
    const offset = road.width / 2 + 2.0 + rng() * 0.8;
    let carried = 0;
    let next = 14 + rng() * SPACING;
    let last: typeof poles[number] | null = null;

    for (let i = 1; i < road.points.length && poles.length < MAX_POLES; i++) {
      const a = road.points[i - 1]!;
      const b = road.points[i]!;
      const seg = Math.hypot(b.x - a.x, b.z - a.z);
      if (seg < 0.01) continue;
      const tx = (b.x - a.x) / seg;
      const tz = (b.z - a.z) / seg;
      const px = -tz;
      const pz = tx;
      const yaw = Math.atan2(tx, tz);

      while (next <= carried + seg) {
        const t = (next - carried) / seg;
        const x = a.x + (b.x - a.x) * t + px * offset * side;
        const z = a.z + (b.z - a.z) * t + pz * offset * side;
        const y = heights.heightAt(x, z);
        const blocked =
          roads.isOnRoad(x, z, 1.5) ||
          buildings.hitsCircle(x, z, 1.5) ||
          heights.slopeAt(x, z) > 27;
        if (!blocked) {
          const pole = { x, y, z, yaw };
          if (last) connect(last, pole);
          poles.push(pole);
          last = pole;
        }
        next += SPACING;
      }
      carried += seg;
    }
  }

  if (poles.length) {
    const trunk = new THREE.CylinderGeometry(0.09, 0.14, 7.5, 6);
    trunk.translate(0, 3.75, 0);
    const arm = new THREE.BoxGeometry(1.42, 0.09, 0.09);
    arm.translate(0, 6.85, 0);
    const geo = mergeGeometries([trunk, arm], false) ?? trunk;
    trunk.dispose();
    arm.dispose();

    const wood = new THREE.MeshStandardMaterial({
      color: 0x6f6250,
      roughness: 0.92,
      metalness: 0.02,
      envMapIntensity: 0.25,
    });
    const mesh = new THREE.InstancedMesh(geo, wood, poles.length);
    mesh.name = 'power-poles';
    const dummy = new THREE.Object3D();
    poles.forEach((p, i) => {
      dummy.position.set(p.x, p.y, p.z);
      dummy.rotation.set(0, p.yaw, 0);
      dummy.scale.setScalar(0.94 + (i % 7) * 0.016);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.castShadow = true;
    mesh.receiveShadow = false;
    group.add(mesh);
  }

  if (wire.length) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(wire, 3));
    const mat = new THREE.LineBasicMaterial({ color: 0x2b2b2a, transparent: true, opacity: 0.9 });
    const lines = new THREE.LineSegments(geo, mat);
    lines.name = 'power-wires';
    group.add(lines);
  }

  return group;
}

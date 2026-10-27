import * as THREE from 'three';
import type { GroundSampler } from '../geo/ground';
import type { Heightfield } from '../geo/elevation';
import type { ObstacleIndex } from '../geo/obstacles';
import type { OsmData, Road } from '../geo/osm';

export interface GuardrailOptions {
  /** tetto di campate; evita di riempire la scena su un preset basso */
  maxSpans?: number;
  /** false = nessun guardrail (preset minimal/low) */
  enabled?: boolean;
  /** se presente, il nastro diventa solido anche per auto e pedoni */
  obstacles?: ObstacleIndex;
}

interface RailSpan {
  x: number;
  y: number;
  z: number;
  yaw: number;
  length: number;
  bridge: boolean;
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
 * Guardrail a doppia onda semplificato.
 *
 * Il criterio non è "ovunque": un guardrail in mezzo a un campo coltivato è
 * finto. Viene messo solo dove serve davvero, cioè sui ponti e sul lato a
 * valle delle strade di campagna con un dislivello rispetto al DEM. In paese,
 * lungo i marciapiedi, non compare.
 *
 * Due sole InstancedMesh (pali e nastro) tengono il costo a due draw call.
 */
export function buildGuardrails(
  osm: OsmData,
  heights: Heightfield,
  ground: GroundSampler,
  options: GuardrailOptions = {},
): { group: THREE.Group; spans: number } {
  const maxSpans = Math.max(0, options.maxSpans ?? 2400);
  const group = new THREE.Group();
  group.name = 'guardrails';
  if (options.enabled === false || maxSpans === 0) return { group, spans: 0 };

  const rails: RailSpan[] = [];
  const posts: Post[] = [];

  const baseAt = (road: Road, i: number, x: number, z: number): number => {
    const prepared = road.elevations?.[i];
    if (prepared !== undefined && (road.bridge || road.tunnel)) return prepared;
    return ground.heightAt(x, z);
  };

  for (const road of osm.roads) {
    if (road.width < 3.4) continue;
    const half = road.width / 2;
    for (let i = 1; i < road.points.length; i++) {
      if (rails.length >= maxSpans) break;
      const a = road.points[i - 1]!;
      const b = road.points[i]!;
      let tx = b.x - a.x;
      let tz = b.z - a.z;
      const length = Math.hypot(tx, tz);
      if (length < 0.8) continue;
      tx /= length;
      tz /= length;
      const yaw = Math.atan2(tx, tz);
      const baseA = baseAt(road, i - 1, a.x, a.z);
      const baseB = baseAt(road, i, b.x, b.z);
      const base = (baseA + baseB) / 2;
      const bridge = road.bridge === true;
      // I marciapiedi segnalano il costruito: niente guardrail fra le case,
      // ma una provinciale che attraversa il paese può averne fuori.
      const inTown = road.walkSpans ? road.walkSpans[i - 1] === true || road.walkSpans[i] === true : false;
      if (inTown && !bridge) continue;

      for (const side of [-1, 1]) {
        if (rails.length >= maxSpans) break;
        const ox = -tz * side * (half + OFFSET);
        const oz = tx * side * (half + OFFSET);
        const outer = 1.2;
        const sampleX = (a.x + b.x) / 2 + ox * outer;
        const sampleZ = (a.z + b.z) / 2 + oz * outer;
        const terrain = heights.heightAt(sampleX, sampleZ);
        const drop = base - terrain;
        const slope = heights.slopeAt(sampleX, sampleZ);
        const needed = bridge || (drop > 1.15 && slope > 0.12);
        if (!needed) continue;
        rails.push({
          x: (a.x + b.x) / 2 + ox,
          y: base + RAIL_Y,
          z: (a.z + b.z) / 2 + oz,
          yaw,
          length: length + 0.12,
          bridge,
        });
        posts.push({
          x: b.x + ox,
          y: baseB,
          z: b.z + oz,
          yaw,
        });
      }
    }
  }

  if (!rails.length) return { group, spans: 0 };

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

  const metal = new THREE.MeshStandardMaterial({
    color: 0x9aa0a2,
    metalness: 0.65,
    roughness: 0.48,
  });
  const railGeo = new THREE.BoxGeometry(0.09, 0.28, 1);
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
  return { group, spans: rails.length };
}

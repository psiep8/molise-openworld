import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { TREES_MAX, WORLD } from '../config';
import type { Heightfield } from '../geo/elevation';
import { mulberry32, pointInPolygon } from '../geo/geo';
import type { BuildingIndex, OsmData, RoadIndex } from '../geo/osm';
import { foliageSet, pbr } from '../gfx/textures';
import { windTimeUniform } from '../gfx/wind';

const TREE_KINDS = new Set(['wood', 'forest', 'scrub', 'orchard', 'park']);
const FOLIAGE_COLORS = [0x8ba86a, 0x9cb477, 0xa8bd82, 0x7f9a5f, 0xb2c48e];

/**
 * Alberi istanziati ma non più "a blocchi":
 *
 *  - **tronco** conico a 8 lati con corteccia PBR fotografica;
 *  - **chioma** formata da un nucleo scuro (dà volume da lontano) e da sei
 *    quad di foglie fotografiche con alpha reale (`foliageSet`), che è quello
 *    che toglie l'effetto Minecraft da vicino;
 *  - **vento**: le foglie ondeggiando in base al tempo e alla posizione
 *    dell'albero, con ampiezza crescente con l'altezza.
 *
 * Le istanze riusano le matrici già calcolate per il posizionamento; il colore
 * per albero varia la tinta della chioma senza cambiare materiale.
 */
export function buildVegetation(
  osm: OsmData,
  heights: Heightfield,
  roads: RoadIndex,
  buildings: BuildingIndex,
  renderer: THREE.WebGLRenderer,
): { group: THREE.Group; count: number } {
  const rng = mulberry32(0x5eed);
  const placements: { x: number; y: number; z: number; s: number; rot: number; color: number }[] = [];

  const tryPlace = (px: number, pz: number, minScale = 0.72, maxScale = 1.47, margin = 1.6): boolean => {
    if (placements.length >= TREES_MAX) return false;
    if (heights.slopeAt(px, pz) > 34) return false;
    if (roads.isOnRoad(px, pz, margin)) return false;
    if (buildings.resolveCircle(px, pz, 2.6).hit) return false;
    placements.push({
      x: px,
      y: heights.heightAt(px, pz),
      z: pz,
      s: minScale + rng() * (maxScale - minScale),
      rot: rng() * Math.PI * 2,
      color: FOLIAGE_COLORS[Math.floor(rng() * FOLIAGE_COLORS.length)],
    });
    return true;
  };

  for (const area of osm.areas) {
    if (!TREE_KINDS.has(area.kind)) continue;
    const b = area.bounds;
    // boschi più fitti: con 25 m il crinale restava a chiazze e da lontano si
    // vedeva il terreno nudo dove invece c'è il querceto
    const step = area.kind === 'orchard' ? 16 : area.kind === 'park' ? 20 : 17;
    for (let z = b.minZ; z <= b.maxZ; z += step) {
      for (let x = b.minX; x <= b.maxX; x += step) {
        if (placements.length >= TREES_MAX) break;
        const px = x + (rng() - 0.5) * step * 0.9;
        const pz = z + (rng() - 0.5) * step * 0.9;
        if (!pointInPolygon(px, pz, area.points)) continue;
        if (heights.slopeAt(px, pz) > 34) continue;
        tryPlace(px, pz);
      }
    }
  }

  // Filari lungo le strade: in campagna ogni via ha i suoi alberi a bordo
  // campo, ed è quello che dà profondità alla strada quando la si percorre.
  for (const road of osm.roads) {
    if (road.width < 3.4) continue;
    let since = 0;
    for (let i = 1; i < road.points.length; i++) {
      const a = road.points[i - 1];
      const b = road.points[i];
      const seg = Math.hypot(b.x - a.x, b.z - a.z);
      since += seg;
      if (since < 34) continue;
      since = 0;
      if (rng() > 0.62) continue;
      let tx = b.x - a.x;
      let tz = b.z - a.z;
      const len = Math.hypot(tx, tz) || 1;
      tx /= len;
      tz /= len;
      const side = rng() < 0.5 ? 1 : -1;
      const off = road.width / 2 + 4.2 + rng() * 5.5;
      const px = b.x - tz * side * off;
      const pz = b.z + tx * side * off;
      tryPlace(px, pz, 0.8, 1.5, 2.2);
    }
  }

  // Alberi sparsi nei campi e sui crinali: riempiono le distanze e rendono il
  // paesaggio tridimensionale anche a 1-2 km, dove il DEM da solo è liscio.
  const cell = 52;
  for (let z = -WORLD.halfHeight; z < WORLD.halfHeight; z += cell) {
    for (let x = -WORLD.halfWidth; x < WORLD.halfWidth; x += cell) {
      const roll = rng();
      if (roll > 0.34) continue;
      const px = x + (rng() - 0.5) * cell;
      const pz = z + (rng() - 0.5) * cell;
      // sulle pendenze forti gli alberi si diradano, sui crinali restano
      const slope = heights.slopeAt(px, pz);
      if (slope > 33) continue;
      if (slope > 24 && rng() > 0.4) continue;
      tryPlace(px, pz, 0.75, 1.55, 2.4);
    }
  }

  const group = new THREE.Group();
  group.name = 'vegetation';
  if (placements.length === 0) return { group, count: 0 };

  // tronco: conico, 8 lati (abbastanza rotondo da non sembrare un pentagono)
  const trunkGeo = new THREE.CylinderGeometry(0.12, 0.27, 2.4, 8, 2);
  trunkGeo.translate(0, 1.2, 0);
  const trunkMat = new THREE.MeshStandardMaterial({
    ...pbr(renderer, 'bark', { repeat: 2 }),
    color: 0xffffff,
    roughness: 1,
    metalness: 0,
    normalScale: new THREE.Vector2(0.8, 0.8),
    envMapIntensity: 0.4,
  });

  // nucleo scuro della chioma: da lontano tiene la massa, da vicino non si nota
  const coreGeo = new THREE.SphereGeometry(1.3, 8, 6);
  coreGeo.scale(1, 1.18, 1);
  coreGeo.translate(0, 3.35, 0);
  const coreMat = new THREE.MeshStandardMaterial({
    color: 0x3d5324,
    roughness: 1,
    metalness: 0,
    envMapIntensity: 0.35,
  });

  // foglie: sei quad incrociati dentro il volume della chioma
  const leafGeo = buildCrownCards();
  const leafMat = new THREE.MeshStandardMaterial({
    ...foliageSet(renderer),
    roughness: 1,
    metalness: 0,
    side: THREE.DoubleSide,
    alphaTest: 0.45,
    normalScale: new THREE.Vector2(0.6, 0.6),
    envMapIntensity: 0.5,
  });
  const uTime = windTimeUniform();
  leafMat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uTime;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        #ifdef USE_INSTANCING
          vec3 windOrigin = vec3( instanceMatrix[ 3 ][ 0 ], instanceMatrix[ 3 ][ 1 ], instanceMatrix[ 3 ][ 2 ] );
        #else
          vec3 windOrigin = vec3( 0.0 );
        #endif
        float windPhase = windOrigin.x * 0.35 + windOrigin.z * 0.27;
        float windHeight = clamp( ( position.y - 1.7 ) / 2.6, 0.0, 1.0 );
        float windSway = sin( uTime * 1.6 + windPhase ) * 0.17 + sin( uTime * 2.9 + windPhase * 1.7 ) * 0.05;
        transformed.x += windSway * windHeight;
        transformed.z += windSway * 0.55 * windHeight;`,
      );
  };
  leafMat.customProgramCacheKey = () => 'foliage-wind-v1';

  const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, placements.length);
  const cores = new THREE.InstancedMesh(coreGeo, coreMat, placements.length);
  const leaves = new THREE.InstancedMesh(leafGeo, leafMat, placements.length);
  for (const mesh of [trunks, cores, leaves]) {
    mesh.castShadow = true;
    mesh.receiveShadow = false;
  }

  const dummy = new THREE.Object3D();
  const color = new THREE.Color();
  placements.forEach((p, i) => {
    dummy.position.set(p.x, p.y - 0.15, p.z);
    dummy.rotation.set(0, p.rot, 0);
    dummy.scale.setScalar(p.s);
    dummy.updateMatrix();
    trunks.setMatrixAt(i, dummy.matrix);
    cores.setMatrixAt(i, dummy.matrix);
    leaves.setMatrixAt(i, dummy.matrix);
    color.setHex(p.color).multiplyScalar(0.9 + (i % 17) / 90);
    cores.setColorAt(i, color.clone().multiplyScalar(0.55));
    leaves.setColorAt(i, color);
  });
  for (const mesh of [trunks, cores, leaves]) {
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }

  group.add(trunks, cores, leaves);
  return { group, count: placements.length };
}

/**
 * Sei quad da 2,6 m distribuiti a caso dentro un ellissoide: ogni card mostra
 * l'intera texture di foglie, così la chioma sembra finta di rami e non di
 * riquadri ripetuti.
 */
function buildCrownCards(): THREE.BufferGeometry {
  const rng = mulberry32(0xc0ffee);
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 6; i++) {
    const size = 2.4 + rng() * 0.6;
    const g = new THREE.PlaneGeometry(size, size);
    // quota: distribuita sulla parte alta del tronco (2.4 m) fino alla cima
    const y = 2.5 + rng() * 1.9;
    // raggio massimo a metà chioma, stretto in cima e in basso
    const bulge = Math.max(0.35, 1 - Math.abs(y - 3.5) / 1.7);
    const ang = (i / 6) * Math.PI * 2 + rng() * 0.8;
    const rad = (0.25 + rng() * 0.75) * bulge * 1.25;
    g.rotateY(rng() * Math.PI * 2);
    g.rotateX((rng() - 0.5) * 0.7);
    g.translate(Math.cos(ang) * rad, y, Math.sin(ang) * rad);
    parts.push(g);
  }
  const merged = mergeGeometries(parts, false);
  for (const g of parts) g.dispose();
  if (!merged) return new THREE.PlaneGeometry(2.6, 2.6).translate(0, 3.3, 0);
  merged.computeBoundingSphere();
  return merged;
}

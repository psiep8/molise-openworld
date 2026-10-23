import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { TREES_MAX, WORLD } from '../config';
import type { Heightfield } from '../geo/elevation';
import { mulberry32, pointInPolygon } from '../geo/geo';
import type { BuildingIndex, OsmData, RoadIndex } from '../geo/osm';
import { foliageSet, pbr } from '../gfx/textures';
import { windTimeUniform } from '../gfx/wind';
import { insidePaved, type PavedArea } from './paved';

const TREE_KINDS = new Set(['wood', 'forest', 'scrub', 'orchard', 'park']);
const FOLIAGE_COLORS = [0x8ba86a, 0x9cb477, 0xa8bd82, 0x7f9a5f, 0xb2c48e];
/** Ulivi: fogliame grigio-verde, quello che rende riconoscibile un uliveto. */
const OLIVE_COLORS = [0x9dab86, 0x8f9d78, 0xa8b492, 0x93a07c];
/** Cipressi: verde molto scuro, quasi nero contro il cielo. */
const CYPRESS_COLORS = [0x35502e, 0x2e4629, 0x3d5a34];
/** Specie: latifoglia (roverella, quercia), ulivo, cipresso. */
type TreeKind = 'broadleaf' | 'olive' | 'cypress';

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
  paved: readonly PavedArea[] = [],
): { group: THREE.Group; count: number } {
  const rng = mulberry32(0x5eed);
  const placements: { x: number; y: number; z: number; s: number; rot: number; color: number; kind: TreeKind }[] = [];

  const tryPlace = (
    px: number,
    pz: number,
    minScale = 0.72,
    maxScale = 1.47,
    margin = 1.6,
    kind: TreeKind = 'broadleaf',
  ): boolean => {
    if (placements.length >= TREES_MAX) return false;
    if (heights.slopeAt(px, pz) > 34) return false;
    if (roads.isOnRoad(px, pz, margin)) return false;
    if (buildings.hitsCircle(px, pz, 2.6)) return false;
    if (insidePaved(px, pz, paved)) return false;
    const palette = kind === 'olive' ? OLIVE_COLORS : kind === 'cypress' ? CYPRESS_COLORS : FOLIAGE_COLORS;
    placements.push({
      x: px,
      y: heights.heightAt(px, pz),
      z: pz,
      s: minScale + rng() * (maxScale - minScale),
      rot: rng() * Math.PI * 2,
      color: palette[Math.floor(rng() * palette.length)],
      kind,
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
        // gli uliveti sono ulivi; nei boschi ogni tanto un cipresso isolato
        const kind: TreeKind = area.kind === 'orchard' ? 'olive' : rng() < 0.05 ? 'cypress' : 'broadleaf';
        tryPlace(px, pz, 0.72, 1.47, 1.6, kind);
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
      const kind: TreeKind = rng() < 0.1 ? 'cypress' : 'broadleaf';
      tryPlace(px, pz, 0.8, 1.5, 2.2, kind);
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
      const kind: TreeKind = rng() < 0.05 ? 'cypress' : 'broadleaf';
      tryPlace(px, pz, 0.75, 1.55, 2.4, kind);
    }
  }

  const group = new THREE.Group();
  group.name = 'vegetation';
  if (placements.length === 0) return { group, count: 0 };

  // vento condiviso da tutte le chiome: ampiezza crescente con l'altezza
  const uTime = windTimeUniform();
  const applyWind = (material: THREE.MeshStandardMaterial, sway: number, cacheKey: string): void => {
    material.onBeforeCompile = (shader) => {
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
        transformed.x += windSway * ${sway.toFixed(3)} * windHeight;
        transformed.z += windSway * ${(sway * 0.55).toFixed(3)} * windHeight;`,
        );
    };
    material.customProgramCacheKey = () => cacheKey;
  };

  // ---- latifoglie (roverella, quercia): tronco, nucleo, sei quad di foglie ----
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
  const coreGeo = new THREE.SphereGeometry(1.3, 8, 6);
  coreGeo.scale(1, 1.18, 1);
  coreGeo.translate(0, 3.35, 0);
  const coreMat = new THREE.MeshStandardMaterial({
    color: 0x3d5324,
    roughness: 1,
    metalness: 0,
    envMapIntensity: 0.35,
  });
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
  applyWind(leafMat, 1, 'foliage-wind-v1');

  // ---- ulivo: tronco corto e nodoso, chioma bassa e larga, fogliame grigio ----
  const oliveTrunkGeo = new THREE.CylinderGeometry(0.17, 0.36, 1.6, 7, 2);
  oliveTrunkGeo.translate(0, 0.8, 0);
  const oliveCoreGeo = new THREE.SphereGeometry(1.5, 8, 6);
  oliveCoreGeo.scale(1, 0.72, 1);
  oliveCoreGeo.translate(0, 2.55, 0);

  // ---- cipresso: cono stretto e scuro, il segno del paesaggio molisano ----
  const cypressParts: THREE.BufferGeometry[] = [];
  const cypressTrunk = new THREE.CylinderGeometry(0.09, 0.16, 0.9, 6);
  cypressTrunk.translate(0, 0.45, 0);
  cypressParts.push(cypressTrunk);
  const cypressCone = new THREE.ConeGeometry(0.62, 5.6, 9, 4);
  cypressCone.translate(0, 3.5, 0);
  cypressParts.push(cypressCone);
  const cypressGeo = mergeGeometries(cypressParts, false) ?? cypressCone;
  for (const g of cypressParts) g.dispose();
  const cypressMat = new THREE.MeshStandardMaterial({
    color: 0x3a5630,
    roughness: 1,
    metalness: 0,
    normalMap: pbr(renderer, 'bark', { color: false, normal: true, rough: false, repeat: 2 }).normalMap,
    normalScale: new THREE.Vector2(0.35, 0.35),
    envMapIntensity: 0.3,
  });
  applyWind(cypressMat, 0.35, 'cypress-wind-v1');

  const broadleaf = placements.filter((p) => p.kind === 'broadleaf');
  const olives = placements.filter((p) => p.kind === 'olive');
  const cypresses = placements.filter((p) => p.kind === 'cypress');

  // ---- sottobosco: cespugli ai piedi degli alberi, quello che riempie il vuoto
  // tra il prato e la chioma e toglie l'aria di "alberi piantati sul nulla" ---
  const bushList: typeof placements = [];
  const bushRng = mulberry32(0x8bad);
  for (const p of placements) {
    if (bushList.length >= 2600) break;
    if (bushRng() > 0.3) continue;
    const a = bushRng() * Math.PI * 2;
    const d = 1.5 + bushRng() * 2.6;
    const x = p.x + Math.cos(a) * d;
    const z = p.z + Math.sin(a) * d;
    if (roads.isOnRoad(x, z, 1.3)) continue;
    if (buildings.hitsCircle(x, z, 1.1)) continue;
    if (heights.slopeAt(x, z) > 30) continue;
    bushList.push({
      x,
      y: heights.heightAt(x, z),
      z,
      s: 0.55 + bushRng() * 0.65,
      rot: bushRng() * Math.PI * 2,
      color: FOLIAGE_COLORS[Math.floor(bushRng() * FOLIAGE_COLORS.length)],
      kind: 'broadleaf',
    });
  }
  // tre quad di foglie bassi: un cespuglio, non un albero in miniatura
  const bushParts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 3; i++) {
    const card = new THREE.PlaneGeometry(1.5, 1.1);
    card.rotateY((i / 3) * Math.PI);
    card.translate((bushRng() - 0.5) * 0.45, 0.58 + bushRng() * 0.22, (bushRng() - 0.5) * 0.45);
    bushParts.push(card);
  }
  const bushGeo = mergeGeometries(bushParts, false) ?? bushParts[0];
  for (const g of bushParts) g.dispose();

  const dummy = new THREE.Object3D();
  const color = new THREE.Color();

  /** Riempie le matrici di un gruppo di istanze e restituisce le mesh. */
  const buildSet = (
    list: typeof placements,
    parts: { geo: THREE.BufferGeometry; mat: THREE.Material; core?: boolean; scale?: [number, number, number] }[],
  ): THREE.InstancedMesh[] => {
    if (!list.length) return [];
    const meshes = parts.map((p) => new THREE.InstancedMesh(p.geo, p.mat, list.length));
    list.forEach((p, i) => {
      dummy.position.set(p.x, p.y - 0.15, p.z);
      dummy.rotation.set(0, p.rot, 0);
      const sc = parts[0].scale ?? [1, 1, 1];
      dummy.scale.set(p.s * sc[0], p.s * sc[1], p.s * sc[2]);
      dummy.updateMatrix();
      meshes.forEach((mesh, k) => {
        mesh.setMatrixAt(i, dummy.matrix);
        color.setHex(p.color).multiplyScalar(0.9 + ((i * 7 + k) % 17) / 90);
        // il nucleo della chioma è sempre più scuro delle foglie
        if (parts[k].core) color.multiplyScalar(0.55);
        mesh.setColorAt(i, color);
      });
    });
    for (const mesh of meshes) {
      mesh.castShadow = true;
      mesh.receiveShadow = false;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
    return meshes;
  };

  const meshes: THREE.InstancedMesh[] = [
    ...buildSet(broadleaf, [
      { geo: trunkGeo, mat: trunkMat },
      { geo: coreGeo, mat: coreMat, core: true },
      { geo: leafGeo, mat: leafMat },
    ]),
    ...buildSet(olives, [
      { geo: oliveTrunkGeo, mat: trunkMat, scale: [1.08, 1, 1.08] },
      { geo: oliveCoreGeo, mat: coreMat, core: true, scale: [1.12, 1, 1.12] },
      { geo: leafGeo, mat: leafMat, scale: [1.15, 0.82, 1.15] },
    ]),
    ...buildSet(cypresses, [{ geo: cypressGeo, mat: cypressMat }]),
    // i cespugli non hanno nucleo né tronco: solo foglie basse
    ...buildSet(bushList, [{ geo: bushGeo, mat: leafMat }]),
  ];

  group.add(...meshes);
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

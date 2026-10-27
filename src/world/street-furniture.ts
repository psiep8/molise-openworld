import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Heightfield } from '../geo/elevation';
import { clamp, distanceToSegment2, mulberry32, type Pt } from '../geo/geo';
import type { ObstacleIndex } from '../geo/obstacles';
import { CURB_HEIGHT, ROAD_LIFT, type BuildingIndex, type OsmData } from '../geo/osm';
import { pbr } from '../gfx/textures';
import type { CityKit } from './citykit';
import type { QualityLevel } from '../gfx/quality';

/** Punto di impianto di un lampione: `yaw` punta il braccio verso la strada. */
export interface LampSpot {
  x: number;
  z: number;
  yaw: number;
}

const POLE_HEIGHT = 6.2;
const ARM_REACH = 1.15;

/**
 * Lampioni stradali.
 *
 * Il palo è un cilindro affusolato, il braccio un tubo inclinato e la testa un
 * corpo in ghisa con il vetro sotto. La luce vera è un pool di `PointLight`
 * riusate sulle lanterne più vicine alla camera: accendere un punto luce per
 * ognuno dei ~600 lampioni ucciderebbe il frame rate, mentre 6 luci intorno al
 * giocatore bastano a far leggere l'illuminazione pubblica di notte.
 *
 * Di giorno le lanterne restano spente (emissive a zero), così il gruppo non
 * consuma né luce né draw call aggiuntive.
 */
export class StreetLights {
  readonly group = new THREE.Group();
  private readonly headMaterial: THREE.MeshStandardMaterial;
  private readonly glassMaterial: THREE.MeshStandardMaterial;
  private readonly pool: THREE.PointLight[] = [];
  private readonly spots: { x: number; y: number; z: number }[] = [];

  constructor(spots: LampSpot[], heights: Heightfield, renderer: THREE.WebGLRenderer, maxLights = 7) {
    this.group.name = 'street-lights';
    if (spots.length === 0) {
      this.headMaterial = new THREE.MeshStandardMaterial();
      this.glassMaterial = new THREE.MeshStandardMaterial();
      return;
    }

    const metal = pbr(renderer, 'concrete', { color: false, normal: true, rough: true });
    // palo zincato/cemento chiaro: il grigio quasi nero con metalness 0,55
    // rifletteva il cielo come un tubo di plastica nera
    const poleMat = new THREE.MeshStandardMaterial({
      color: 0x848a8e,
      roughness: 0.7,
      metalness: 0.3,
      ...metal,
      normalScale: new THREE.Vector2(0.25, 0.25),
      envMapIntensity: 0.55,
    });
    this.headMaterial = new THREE.MeshStandardMaterial({
      color: 0x22262a,
      roughness: 0.55,
      metalness: 0.5,
      emissive: 0xffd8a2,
      emissiveIntensity: 0,
      envMapIntensity: 0.7,
    });
    this.glassMaterial = new THREE.MeshStandardMaterial({
      color: 0xfff3d8,
      emissive: 0xffd08a,
      emissiveIntensity: 0,
      roughness: 0.25,
      metalness: 0,
    });

    // palo: base più larga e fusto affusolato (i pali cilindrici sembrano pali
    // della luce temporanea, non lanterne di paese)
    const poleGeo = new THREE.CylinderGeometry(0.052, 0.105, POLE_HEIGHT, 10, 3);
    poleGeo.translate(0, POLE_HEIGHT / 2, 0);
    const baseGeo = new THREE.CylinderGeometry(0.14, 0.17, 0.34, 12);
    baseGeo.translate(0, 0.17, 0);
    const armGeo = new THREE.BoxGeometry(0.075, 0.075, ARM_REACH);
    const headGeo = new THREE.CylinderGeometry(0.2, 0.12, 0.26, 8, 1);
    headGeo.translate(0, 0.05, 0);
    const capGeo = new THREE.ConeGeometry(0.24, 0.13, 8);
    capGeo.translate(0, 0.25, 0);
    const glassGeo = new THREE.CylinderGeometry(0.13, 0.09, 0.16, 8, 1);
    glassGeo.translate(0, -0.16, 0);

    const poles = new THREE.InstancedMesh(poleGeo, poleMat, spots.length);
    const bases = new THREE.InstancedMesh(baseGeo, poleMat, spots.length);
    const arms = new THREE.InstancedMesh(armGeo, poleMat, spots.length);
    const heads = new THREE.InstancedMesh(headGeo, this.headMaterial, spots.length);
    const caps = new THREE.InstancedMesh(capGeo, this.headMaterial, spots.length);
    const glasses = new THREE.InstancedMesh(glassGeo, this.glassMaterial, spots.length);
    for (const mesh of [poles, bases, arms, heads, caps, glasses]) {
      mesh.castShadow = true;
      mesh.receiveShadow = false;
    }

    const dummy = new THREE.Object3D();
    const armY = POLE_HEIGHT - 0.55;
    spots.forEach((spot, i) => {
      const y = heights.heightAt(spot.x, spot.z);
      this.spots.push({ x: spot.x, y: y + armY, z: spot.z });
      // lanterna in cima al braccio, un filo sopra il marciapiede
      const hx = spot.x + Math.sin(spot.yaw) * ARM_REACH;
      const hz = spot.z + Math.cos(spot.yaw) * ARM_REACH;

      dummy.position.set(spot.x, y, spot.z);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.setScalar(1);
      dummy.updateMatrix();
      poles.setMatrixAt(i, dummy.matrix);
      bases.setMatrixAt(i, dummy.matrix);

      dummy.position.set(spot.x, y + armY + 0.04, spot.z);
      dummy.rotation.set(0.18, spot.yaw, 0);
      dummy.updateMatrix();
      arms.setMatrixAt(i, dummy.matrix);

      dummy.position.set(hx, y + armY + 0.06, hz);
      dummy.rotation.set(0, spot.yaw, 0);
      dummy.updateMatrix();
      heads.setMatrixAt(i, dummy.matrix);
      caps.setMatrixAt(i, dummy.matrix);
      glasses.setMatrixAt(i, dummy.matrix);
    });
    for (const mesh of [poles, bases, arms, heads, caps, glasses]) {
      mesh.instanceMatrix.needsUpdate = true;
      this.group.add(mesh);
    }

    for (let i = 0; i < maxLights; i++) {
      const light = new THREE.PointLight(0xffd7a0, 0, 48, 2);
      light.visible = false;
      this.group.add(light);
      this.pool.push(light);
    }
  }

  /** `night` 0…1: alza le emissive e accende le lanterne vicine alla camera. */
  update(camera: THREE.Vector3, night: number): void {
    this.headMaterial.emissiveIntensity = night * 0.9;
    this.glassMaterial.emissiveIntensity = night * 9;
    if (this.spots.length === 0) return;

    if (night < 0.06) {
      for (const light of this.pool) light.visible = false;
      return;
    }

    // selezione parziale: i lampioni più vicini alla camera, senza ordinare tutti
    const chosen: { index: number; d: number }[] = [];
    for (let i = 0; i < this.spots.length; i++) {
      const s = this.spots[i];
      const d = (s.x - camera.x) ** 2 + (s.z - camera.z) ** 2;
      if (d > 62 * 62) continue;
      if (chosen.length < this.pool.length) {
        chosen.push({ index: i, d });
        if (chosen.length === this.pool.length) chosen.sort((a, b) => a.d - b.d);
      } else if (d < chosen[chosen.length - 1].d) {
        chosen[chosen.length - 1] = { index: i, d };
        chosen.sort((a, b) => a.d - b.d);
      }
    }

    for (let i = 0; i < this.pool.length; i++) {
      const light = this.pool[i];
      const pick = chosen[i];
      if (!pick) {
        light.visible = false;
        continue;
      }
      const s = this.spots[pick.index];
      light.position.set(s.x, s.y - 0.3, s.z);
      light.intensity = 190 * night;
      light.visible = true;
    }
  }
}

export type SignKind = 'stop' | 'yield' | 'speed';

/** Segnaletica verticale: octagono STOP, triangolo dare precedenza, disco 50. */
export function buildSigns(
  osm: OsmData,
  heights: Heightfield,
  buildings: BuildingIndex,
  _renderer: THREE.WebGLRenderer,
  // il kit non serve più per il palo (vedi sotto): resta in firma per non
  // toccare i chiamanti
  _kit?: CityKit | null,
  // i pali sono ostacoli veri: senza, l'auto li attraversa
  obstacles?: ObstacleIndex,
): THREE.Group {
  const group = new THREE.Group();
  group.name = 'road-signs';
  const rng = mulberry32(0x51a9);
  const placements: { x: number; z: number; yaw: number; kind: SignKind }[] = [];

  for (const road of osm.roads) {
    if (!road.paved || road.width < 4) continue;
    let since = 0;
    for (let i = 1; i < road.points.length; i++) {
      const a = road.points[i - 1];
      const b = road.points[i];
      const seg = Math.hypot(b.x - a.x, b.z - a.z);
      since += seg;
      if (since < 55) continue;
      // segnali solo dove c'è il paese: in aperta campagna sarebbero assurdi
      let built = false;
      for (const bd of buildings.near(b.x, b.z)) {
        if (
          b.x > bd.bounds.minX - 34 &&
          b.x < bd.bounds.maxX + 34 &&
          b.z > bd.bounds.minZ - 34 &&
          b.z < bd.bounds.maxZ + 34
        ) {
          built = true;
          break;
        }
      }
      if (!built) continue;
      since = 0;
      let tx = b.x - a.x;
      let tz = b.z - a.z;
      const len = Math.hypot(tx, tz) || 1;
      tx /= len;
      tz /= len;
      const side = rng() < 0.5 ? 1 : -1;
      const off = road.width / 2 + 1.35;
      const x = b.x - tz * side * off;
      const z = b.z + tx * side * off;
      if (heights.slopeAt(x, z) > 22) continue;
      // il segnale guarda contro il senso di marcia del lato su cui sta
      const yaw = Math.atan2(-tx * side, -tz * side);
      const roll = rng();
      const kind: SignKind = roll < 0.34 ? 'stop' : roll < 0.7 ? 'yield' : 'speed';
      placements.push({ x, z, yaw, kind });
      obstacles?.add(x, z, 0.09);
      if (placements.length > 700) break;
    }
    if (placements.length > 700) break;
  }

  if (placements.length === 0) return group;

  // Palo sempre procedurale: un cilindro zincato da 4 cm.
  //
  // Prima si usava la parte `ss_galv` del cartello del kit (28.000 triangoli:
  // bulloni, piastra, staffe). Istanziata su ~350 cartelli faceva **nove milioni
  // di triangoli** per dei pali che a due metri sono un tubo grigio. È uno dei
  // tagli più grossi di tutta la scalata qualità, e non si vede.
  const poleMat = new THREE.MeshStandardMaterial({
    color: 0x9aa2a6,
    roughness: 0.45,
    metalness: 0.6,
  });
  const poleGeo = new THREE.CylinderGeometry(0.035, 0.04, 2.45, 8);
  poleGeo.translate(0, 1.225, 0);
  // quota della faccia: il bordo basso del cartello resta sopra i 2 m
  const faceY = 2.45;
  const faceZ = 0.055;
  // i cartelli stanno sul marciapiede: asfalto rialzato + cordolo
  const baseLift = ROAD_LIFT + CURB_HEIGHT + 0.005;
  const poles = new THREE.InstancedMesh(poleGeo, poleMat, placements.length);
  poles.castShadow = true;
  poles.receiveShadow = true;
  const dummy = new THREE.Object3D();

  const textures: Record<SignKind, THREE.CanvasTexture> = {
    stop: signTexture('stop'),
    yield: signTexture('yield'),
    speed: signTexture('speed'),
  };
  const geometries: Record<SignKind, THREE.BufferGeometry> = {
    stop: faceGeometry('stop'),
    yield: faceGeometry('yield'),
    speed: faceGeometry('speed'),
  };
  const counts: Record<SignKind, number> = { stop: 0, yield: 0, speed: 0 };
  for (const p of placements) counts[p.kind]++;

  const meshes: Record<SignKind, THREE.InstancedMesh> = {
    stop: new THREE.InstancedMesh(
      geometries.stop,
      new THREE.MeshStandardMaterial({ map: textures.stop, roughness: 0.5, metalness: 0.1, side: THREE.DoubleSide }),
      Math.max(1, counts.stop),
    ),
    yield: new THREE.InstancedMesh(
      geometries.yield,
      new THREE.MeshStandardMaterial({
        map: textures.yield,
        roughness: 0.42,
        metalness: 0.1,
        transparent: true,
        alphaTest: 0.4,
        side: THREE.DoubleSide,
      }),
      Math.max(1, counts.yield),
    ),
    speed: new THREE.InstancedMesh(
      geometries.speed,
      new THREE.MeshStandardMaterial({ map: textures.speed, roughness: 0.5, metalness: 0.1, side: THREE.DoubleSide }),
      Math.max(1, counts.speed),
    ),
  };
  const cursor: Record<SignKind, number> = { stop: 0, yield: 0, speed: 0 };

  placements.forEach((p, i) => {
    const y = heights.heightAt(p.x, p.z) + baseLift;
    dummy.position.set(p.x, y, p.z);
    dummy.rotation.set(0, 0, 0);
    dummy.scale.setScalar(1);
    dummy.updateMatrix();
    poles.setMatrixAt(i, dummy.matrix);

    // la faccia sta davanti al palo, all'altezza della piastra del kit
    dummy.position.set(p.x + Math.sin(p.yaw) * faceZ, y + faceY, p.z + Math.cos(p.yaw) * faceZ);
    dummy.rotation.set(0, p.yaw, 0);
    dummy.updateMatrix();
    const mesh = meshes[p.kind];
    mesh.setMatrixAt(cursor[p.kind]++, dummy.matrix);
  });

  poles.instanceMatrix.needsUpdate = true;
  group.add(poles);
  for (const kind of ['stop', 'yield', 'speed'] as const) {
    const mesh = meshes[kind];
    if (counts[kind] === 0) continue;
    mesh.count = counts[kind];
    mesh.instanceMatrix.needsUpdate = true;
    mesh.castShadow = true;
    group.add(mesh);
  }
  return group;
}

/**
 * Geometria della faccia, con le UV calcolate **dopo** l'orientamento.
 *
 * Ruotare una `CircleGeometry` con `rotateZ` sposta i vertici ma non le UV:
 * la scritta STOP finiva inclinata di 22,5° e il triangolo della precedenza
 * mostrava l'immagine ruotata. Qui posizioni e UV nascono insieme, quindi il
 * disegno del canvas cade esattamente sulla sagoma.
 */
function faceGeometry(kind: SignKind): THREE.BufferGeometry {
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const push = (x: number, y: number, u: number, v: number): number => {
    const i = positions.length / 3;
    positions.push(x, y, 0);
    uvs.push(u, v);
    return i;
  };

  if (kind === 'yield') {
    // triangolo equilatero, punta in basso, con le UV dei tre vertici
    const r = 0.46;
    const bottom = push(0, -r, 0.5, 0);
    const right = push(r * 0.866, r * 0.5, 0.5 + 0.866 / 2, 0.75);
    const left = push(-r * 0.866, r * 0.5, 0.5 - 0.866 / 2, 0.75);
    indices.push(bottom, right, left);
  } else if (kind === 'stop') {
    // ottagono con il lato piatto in alto, come il cartello vero
    const r = 0.38;
    const center = push(0, 0, 0.5, 0.5);
    const ring: number[] = [];
    for (let i = 0; i < 8; i++) {
      const a = Math.PI / 8 + (i / 8) * Math.PI * 2;
      const x = Math.cos(a) * r;
      const y = Math.sin(a) * r;
      ring.push(push(x, y, 0.5 + Math.cos(a) / 2, 0.5 + Math.sin(a) / 2));
    }
    for (let i = 0; i < 8; i++) indices.push(center, ring[i]!, ring[(i + 1) % 8]!);
  } else {
    // disco: 24 spicchi
    const r = 0.31;
    const center = push(0, 0, 0.5, 0.5);
    const ring: number[] = [];
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2;
      const x = Math.cos(a) * r;
      const y = Math.sin(a) * r;
      ring.push(push(x, y, 0.5 + Math.cos(a) / 2, 0.5 + Math.sin(a) / 2));
    }
    for (let i = 0; i < 24; i++) indices.push(center, ring[i]!, ring[(i + 1) % 24]!);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

/** Faccia del cartello disegnata su canvas: nessun asset esterno. */
function signTexture(kind: SignKind): THREE.CanvasTexture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas 2d non disponibile');
  const c = size / 2;
  ctx.clearRect(0, 0, size, size);

  if (kind === 'stop') {
    ctx.fillStyle = '#b81f26';
    ctx.beginPath();
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
      const r = size * 0.5;
      const x = c + Math.cos(a) * r;
      const y = c + Math.sin(a) * r;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fill();
    // bordo bianco disegnato dentro la sagoma, se no lo taglia la geometria
    ctx.strokeStyle = '#f4f1ea';
    ctx.lineWidth = size * 0.035;
    ctx.beginPath();
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
      const r = size * 0.47;
      const x = c + Math.cos(a) * r;
      const y = c + Math.sin(a) * r;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.stroke();
    ctx.fillStyle = '#f7f4ee';
    ctx.font = `bold ${size * 0.27}px Arial, Helvetica, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('STOP', c, c + size * 0.01);
  } else if (kind === 'yield') {
    // dare precedenza italiano: triangolo bianco con bordo rosso, punta in
    // basso. Il bordo è disegnato *dentro* la sagoma: la geometria è il
    // triangolo esatto delle UV, quindi uno stroke centrato sul bordo
    // verrebbe tagliato a metà.
    ctx.fillStyle = '#b81f26';
    ctx.beginPath();
    ctx.moveTo(c, size * 1.02);
    ctx.lineTo(-size * 0.02, size * 0.24);
    ctx.lineTo(size * 1.02, size * 0.24);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#f4f1ea';
    ctx.beginPath();
    ctx.moveTo(c, size * 0.88);
    ctx.lineTo(size * 0.13, size * 0.32);
    ctx.lineTo(size * 0.87, size * 0.32);
    ctx.closePath();
    ctx.fill();
  } else {
    ctx.fillStyle = '#f6f3ec';
    ctx.beginPath();
    ctx.arc(c, c, size * 0.46, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#b81f26';
    ctx.lineWidth = size * 0.1;
    ctx.stroke();
    ctx.fillStyle = '#1c1c1c';
    ctx.font = `bold ${size * 0.4}px Arial, Helvetica, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('50', c, c + size * 0.02);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  return texture;
}

/**
 * Targhe con il nome della via, dai nomi OSM.
 *
 * In un paese italiano il nome della strada è una targa bianca, bordo blu,
 * lettere nere, montata su un palo o sul muro. Qui sta sul palo a bordo
 * marciapiede, all'inizio del tratto costruito, una volta per nome e con
 * almeno 900 m tra due targhe omonime (Via Roma esiste in ogni paese).
 *
 * Il nome è disegnato su canvas: nessun asset esterno e funziona anche senza
 * kit. Se il nome OSM è vuoto o è solo un numero civico, la targa non si mette.
 */
export function buildStreetNames(
  osm: OsmData,
  heights: Heightfield,
  buildings: BuildingIndex,
  obstacles?: ObstacleIndex,
): THREE.Group {
  const group = new THREE.Group();
  group.name = 'street-names';
  const rng = mulberry32(0x6e21);
  const placed: { x: number; z: number; yaw: number; name: string }[] = [];
  const byName = new Map<string, { x: number; z: number }[]>();
  const MAX = 60;

  for (const road of osm.roads) {
    if (placed.length >= MAX) break;
    const name = road.name.trim();
    if (!road.paved || road.width < 3.4 || name.length < 3) continue;
    if (!/[a-zà-ù]/i.test(name)) continue;
    const seen = byName.get(name) ?? [];
    if (seen.length >= 2) continue;

    for (let i = 1; i < road.points.length; i++) {
      const a = road.points[i - 1];
      const b = road.points[i];
      const seg = Math.hypot(b.x - a.x, b.z - a.z);
      if (seg < 1e-3) continue;
      // solo dentro il costruito: in campagna una targa col nome della via
      // provinciale non esiste
      let built = false;
      for (const bd of buildings.near(b.x, b.z)) {
        if (
          b.x > bd.bounds.minX - 30 &&
          b.x < bd.bounds.maxX + 30 &&
          b.z > bd.bounds.minZ - 30 &&
          b.z < bd.bounds.maxZ + 30
        ) {
          built = true;
          break;
        }
      }
      if (!built) continue;

      const tx = (b.x - a.x) / seg;
      const tz = (b.z - a.z) / seg;
      const side = rng() < 0.5 ? 1 : -1;
      // 1,05 m oltre il ciglio: sul marciapiede, non in carreggiata
      const x = b.x - tz * side * (road.width / 2 + 1.05);
      const z = b.z + tx * side * (road.width / 2 + 1.05);
      if (heights.slopeAt(x, z) > 16) continue;
      if (buildings.hitsCircle(x, z, 0.6)) continue;
      if (seen.some((s) => Math.hypot(s.x - x, s.z - z) < 900)) break;

      // la faccia guarda la strada
      const yaw = Math.atan2(tz * side, -tx * side);
      placed.push({ x, z, yaw, name });
      obstacles?.add(x, z, 0.08);
      seen.push({ x, z });
      byName.set(name, seen);
      break;
    }
  }

  if (placed.length === 0) return group;

  const poleMat = new THREE.MeshStandardMaterial({ color: 0x8f979c, roughness: 0.5, metalness: 0.55 });
  const poleGeo = new THREE.CylinderGeometry(0.032, 0.038, 2.55, 8);
  poleGeo.translate(0, 1.275, 0);
  const poles = new THREE.InstancedMesh(poleGeo, poleMat, placed.length);
  poles.castShadow = true;
  const backMat = new THREE.MeshStandardMaterial({ color: 0x7c8186, roughness: 0.55, metalness: 0.4 });
  const backGeo = new THREE.BoxGeometry(1.26, 0.34, 0.03);
  const backs = new THREE.InstancedMesh(backGeo, backMat, placed.length);
  const plateGeo = new THREE.PlaneGeometry(1.2, 0.3);
  const dummy = new THREE.Object3D();

  placed.forEach((p, i) => {
    // il palo è piantato nel marciapiede rialzato, non nel terreno sotto
    const y = heights.heightAt(p.x, p.z) + ROAD_LIFT + CURB_HEIGHT + 0.005;
    dummy.position.set(p.x, y, p.z);
    dummy.rotation.set(0, 0, 0);
    dummy.scale.setScalar(1);
    dummy.updateMatrix();
    poles.setMatrixAt(i, dummy.matrix);

    // normale della faccia, per staccare la targa dal palo
    const nx = Math.sin(p.yaw);
    const nz = Math.cos(p.yaw);
    dummy.position.set(p.x + nx * 0.035, y + 2.4, p.z + nz * 0.035);
    dummy.rotation.set(0, p.yaw, 0);
    dummy.updateMatrix();
    backs.setMatrixAt(i, dummy.matrix);

    const plate = new THREE.Mesh(
      plateGeo,
      new THREE.MeshStandardMaterial({
        map: streetNameTexture(p.name),
        roughness: 0.62,
        metalness: 0.05,
        envMapIntensity: 0.5,
      }),
    );
    plate.position.set(p.x + nx * 0.055, y + 2.4, p.z + nz * 0.055);
    plate.rotation.y = p.yaw;
    plate.castShadow = true;
    group.add(plate);
  });
  poles.instanceMatrix.needsUpdate = true;
  backs.instanceMatrix.needsUpdate = true;
  group.add(poles, backs);
  return group;
}

/** Targa bianca, bordo blu, nome della via: canvas 384 × 96. */
function streetNameTexture(name: string): THREE.CanvasTexture {
  const w = 384;
  const h = 96;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas 2d non disponibile');
  ctx.fillStyle = '#f4f1e8';
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = '#1f3d6b';
  ctx.lineWidth = 7;
  ctx.strokeRect(5, 5, w - 10, h - 10);
  ctx.fillStyle = '#161616';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const label = name.toLocaleUpperCase('it-IT');
  let size = 38;
  do {
    ctx.font = `bold ${size}px Arial Narrow, Arial, Helvetica, sans-serif`;
    size -= 2;
  } while (ctx.measureText(label).width > w - 40 && size > 16);
  ctx.fillText(label, w / 2, h / 2 + 2);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

/** Panche e cestini nelle piazze: arredo minimo ma rompe il vuoto dei marciapiedi. */
export function buildStreetProps(
  osm: OsmData,
  heights: Heightfield,
  buildings: BuildingIndex,
  renderer: THREE.WebGLRenderer,
  kit?: CityKit | null,
  quality: QualityLevel = 'high',
): THREE.Group {
  const group = new THREE.Group();
  group.name = 'street-props';
  const rng = mulberry32(0x2b71);
  const benches: { x: number; y: number; z: number; rot: number }[] = [];
  let placed = 0;

  // Panche solo lungo le strade asfaltate, davanti a una casa e rivolte verso
  // la carreggiata. Prima venivano messe a caso attorno agli edifici grandi:
  // finivano nei campi, dietro le case o in mezzo alla strada.
  const paved = osm.roads.filter((r) => r.paved && r.width >= 4.5);
  // griglia dei tratti di strada: 2.193 case × ~30.000 punti sarebbe troppo
  const CELL = 80;
  const roadCells = new Map<string, { ax: number; az: number; bx: number; bz: number; w: number }[]>();
  for (const road of paved) {
    for (let i = 1; i < road.points.length; i++) {
      const a = road.points[i - 1];
      const b = road.points[i];
      const seg = { ax: a.x, az: a.z, bx: b.x, bz: b.z, w: road.width };
      for (let ix = Math.floor(Math.min(a.x, b.x) / CELL); ix <= Math.floor(Math.max(a.x, b.x) / CELL); ix++) {
        for (let iz = Math.floor(Math.min(a.z, b.z) / CELL); iz <= Math.floor(Math.max(a.z, b.z) / CELL); iz++) {
          const key = `${ix},${iz}`;
          let list = roadCells.get(key);
          if (!list) {
            list = [];
            roadCells.set(key, list);
          }
          list.push(seg);
        }
      }
    }
  }

  for (const b of buildings.all) {
    if (placed >= 90) break;
    if (b.area < 70) continue;
    // non tutte le case hanno la panca davanti
    if (rng() > 0.3) continue;
    const c = { x: (b.bounds.minX + b.bounds.maxX) / 2, z: (b.bounds.minZ + b.bounds.maxZ) / 2 };
    const bx = Math.floor(c.x / CELL);
    const bz = Math.floor(c.z / CELL);
    let best: { x: number; z: number; d: number; w: number; nx: number; nz: number } | null = null;
    for (let ix = bx - 1; ix <= bx + 1; ix++) {
      for (let iz = bz - 1; iz <= bz + 1; iz++) {
        const list = roadCells.get(`${ix},${iz}`);
        if (!list) continue;
        for (const s of list) {
          const d = distanceToSegment2(c.x, c.z, s.ax, s.az, s.bx, s.bz);
          if (d < s.w / 2 + 2.6 || d > 13) continue;
          if (best && d >= best.d) continue;
          // piede della perpendicolare e normale che punta verso la casa
          const dx = s.bx - s.ax;
          const dz = s.bz - s.az;
          const len2 = dx * dx + dz * dz || 1;
          const t = clamp(((c.x - s.ax) * dx + (c.z - s.az) * dz) / len2, 0, 1);
          const fx = s.ax + dx * t;
          const fz = s.az + dz * t;
          const nlen = Math.hypot(c.x - fx, c.z - fz) || 1;
          best = { x: fx, z: fz, d, w: s.w, nx: (c.x - fx) / nlen, nz: (c.z - fz) / nlen };
        }
      }
    }
    if (!best) continue;

    // 1,1 m oltre il bordo dell'asfalto, sul lato della casa
    const x = best.x + best.nx * (best.w / 2 + 1.1);
    const z = best.z + best.nz * (best.w / 2 + 1.1);
    if (heights.slopeAt(x, z) > 14) continue;
    // niente panche dentro un'altra casa
    if (buildings.hitsCircle(x, z, 0.7)) continue;
    const y = heights.heightAt(x, z);
    // la seduta guarda la strada, lo schienale sta verso la casa
    const ux = -best.nx;
    const uz = -best.nz;
    const rot = Math.atan2(ux, uz);
    benches.push({ x, y, z, rot });
    placed++;
  }

  if (benches.length === 0) return group;

  // Con il kit: panchine reali (doghe, ghisa, vite) e cestini accanto a una
  // panchina su tre. Restano istanziati, quindi il costo è per parte, non per
  // panchina.
  if (kit?.has('bench')) {
    // panchina del kit: 21k triangoli l'una. Il tetto per preset evita che un
    // paese con 90 case diventi 1,9 milioni di triangoli solo di panchine.
    const limit: Record<QualityLevel, number> = { minimal: 0, low: 6, medium: 12, high: 24, ultra: 32 };
    const visible = benches.slice(0, limit[quality]);
    group.add(
      kit.instances(
        'bench',
        visible.map((b) => ({ x: b.x, y: b.y, z: b.z, yaw: b.rot })),
        { castShadow: true },
      ),
    );
    if (kit.has('bin')) {
      const bins = visible
        .filter((_, i) => i % 3 === 0)
        .map((b) => {
          const x = b.x + Math.cos(b.rot) * 1.15;
          const z = b.z - Math.sin(b.rot) * 1.15;
          return { x, y: heights.heightAt(x, z), z, yaw: b.rot };
        })
        .filter((b) => !buildings.hitsCircle(b.x, b.z, 0.55) && heights.slopeAt(b.x, b.z) <= 14);
      if (bins.length) group.add(kit.instances('bin', bins, { castShadow: true }));
    }
    return group;
  }

  // Fallback procedurale (kit assente): doghe a scatole e ferro per le gambe.
  const wood = new THREE.Color(0x8a5f37);
  const iron = new THREE.Color(0x2c3033);
  const parts: THREE.BufferGeometry[] = [];
  for (const b of benches) {
    const ux = Math.sin(b.rot);
    const uz = Math.cos(b.rot);
    const seat = new THREE.BoxGeometry(1.55, 0.07, 0.46).toNonIndexed();
    seat.rotateY(b.rot);
    seat.translate(b.x, b.y + 0.45, b.z);
    setColor(seat, wood);
    parts.push(seat);
    const back = new THREE.BoxGeometry(1.55, 0.42, 0.06).toNonIndexed();
    back.rotateY(b.rot);
    back.translate(b.x - ux * 0.2, b.y + 0.68, b.z - uz * 0.2);
    setColor(back, wood);
    parts.push(back);
    for (const side of [-0.62, 0.62]) {
      const leg = new THREE.BoxGeometry(0.07, 0.45, 0.5).toNonIndexed();
      leg.rotateY(b.rot);
      leg.translate(b.x + Math.cos(b.rot) * side, b.y + 0.22, b.z - Math.sin(b.rot) * side);
      setColor(leg, iron);
      parts.push(leg);
    }
  }
  const merged = mergeGeometries(parts, false);
  for (const g of parts) g.dispose();
  if (!merged) return group;
  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    ...pbr(renderer, 'bark', { color: false, normal: true, rough: true }),
    normalScale: new THREE.Vector2(0.35, 0.35),
    roughness: 0.82,
    metalness: 0.05,
    envMapIntensity: 0.4,
  });
  const mesh = new THREE.Mesh(merged, mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);
  return group;
}

function setColor(geometry: THREE.BufferGeometry, color: THREE.Color): void {
  const count = geometry.attributes.position.count;
  const array = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    array[i * 3] = color.r;
    array[i * 3 + 1] = color.g;
    array[i * 3 + 2] = color.b;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(array, 3));
}

/**
 * Chiusini e caditoie sull'asfalto.
 *
 * Sono pochi centimetri di ghisa, ma sono una delle cose che si vedono di più
 * camminando per strada: senza, la carreggiata sembra un nastro nuovo. I
 * chiusini (tondi, in mezzo alla corsia) e le caditoie (rettangolari, a filo
 * del cordolo) sono due `InstancedMesh`, quindi il costo è di due draw call.
 */
export function buildRoadDrainage(osm: OsmData, heights: Heightfield): THREE.Group {
  const group = new THREE.Group();
  group.name = 'road-drainage';
  const rng = mulberry32(0x51dc);
  const covers: THREE.Matrix4[] = [];
  const grates: THREE.Matrix4[] = [];
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const one = new THREE.Vector3(1, 1, 1);
  const pos = new THREE.Vector3();

  for (const road of osm.roads) {
    if (!road.paved || road.points.length < 2) continue;
    let travelled = 0;
    // un chiusino ogni ~34 m, una caditoia ogni ~26 m: mai regolari
    let nextCover = 20 + rng() * 18;
    let nextGrate = 12 + rng() * 14;
    for (let i = 1; i < road.points.length; i++) {
      const a = road.points[i - 1];
      const b = road.points[i];
      const seg = Math.hypot(b.x - a.x, b.z - a.z);
      if (seg < 0.01) continue;
      const tx = (b.x - a.x) / seg;
      const tz = (b.z - a.z) / seg;
      const px = -tz;
      const pz = tx;
      const yaw = Math.atan2(tx, tz);
      travelled += seg;

      if (travelled >= nextCover) {
        nextCover = travelled + 26 + rng() * 22;
        const off = (rng() - 0.5) * road.width * 0.4;
        const x = b.x + px * off;
        const z = b.z + pz * off;
        q.setFromAxisAngle(up, yaw);
        pos.set(x, heights.heightAt(x, z) + 0.215, z);
        covers.push(m.compose(pos, q, one).clone());
      }
      if (travelled >= nextGrate) {
        nextGrate = travelled + 20 + rng() * 16;
        const side = rng() < 0.5 ? -1 : 1;
        const off = side * (road.width / 2 - 0.42);
        const x = b.x + px * off;
        const z = b.z + pz * off;
        q.setFromAxisAngle(up, yaw);
        pos.set(x, heights.heightAt(x, z) + 0.208, z);
        grates.push(m.compose(pos, q, one).clone());
      }
    }
  }

  const iron = new THREE.MeshStandardMaterial({
    color: 0x4a4d50,
    roughness: 0.72,
    metalness: 0.55,
    envMapIntensity: 0.5,
    map: manholeTexture(),
  });

  if (covers.length) {
    const geo = new THREE.CylinderGeometry(0.34, 0.34, 0.05, 20);
    const mesh = new THREE.InstancedMesh(geo, iron, covers.length);
    covers.forEach((mat, i) => mesh.setMatrixAt(i, mat));
    mesh.instanceMatrix.needsUpdate = true;
    mesh.receiveShadow = true;
    mesh.name = 'manholes';
    group.add(mesh);
  }
  if (grates.length) {
    const geo = new THREE.BoxGeometry(0.56, 0.035, 0.36);
    const grate = new THREE.MeshStandardMaterial({ color: 0x33373a, roughness: 0.68, metalness: 0.6, envMapIntensity: 0.5 });
    const mesh = new THREE.InstancedMesh(geo, grate, grates.length);
    grates.forEach((mat, i) => mesh.setMatrixAt(i, mat));
    mesh.instanceMatrix.needsUpdate = true;
    mesh.receiveShadow = true;
    mesh.name = 'grates';
    group.add(mesh);
  }

  return group;
}

/** Ghisa: cerchi concentrici, qualche granello di ruggine, nessuna scritta. */
function manholeTexture(): THREE.CanvasTexture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = '#52555a';
    ctx.fillRect(0, 0, size, size);
    ctx.strokeStyle = '#3d4045';
    ctx.lineWidth = 3;
    for (const r of [16, 26, 36, 46]) {
      ctx.beginPath();
      ctx.arc(size / 2, size / 2, r, 0, Math.PI * 2);
      ctx.stroke();
    }
    // motivo a raggiera, come i chiusini veri
    ctx.strokeStyle = '#44474c';
    ctx.lineWidth = 2;
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(size / 2 + Math.cos(a) * 16, size / 2 + Math.sin(a) * 16);
      ctx.lineTo(size / 2 + Math.cos(a) * 60, size / 2 + Math.sin(a) * 60);
      ctx.stroke();
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

export type { Pt };

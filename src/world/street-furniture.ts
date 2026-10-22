import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Heightfield } from '../geo/elevation';
import { mulberry32, type Pt } from '../geo/geo';
import type { BuildingIndex, OsmData } from '../geo/osm';
import { pbr } from '../gfx/textures';

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
    const poleMat = new THREE.MeshStandardMaterial({
      color: 0x2f3437,
      roughness: 0.62,
      metalness: 0.55,
      ...metal,
      normalScale: new THREE.Vector2(0.25, 0.25),
      envMapIntensity: 0.8,
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
      const light = new THREE.PointLight(0xffd7a0, 0, 34, 2);
      light.visible = false;
      this.group.add(light);
      this.pool.push(light);
    }
  }

  /** `night` 0…1: alza le emissive e accende le lanterne vicine alla camera. */
  update(camera: THREE.Vector3, night: number): void {
    this.headMaterial.emissiveIntensity = night * 0.55;
    this.glassMaterial.emissiveIntensity = night * 6.5;
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
      light.intensity = 26 * night;
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
      if (placements.length > 700) break;
    }
    if (placements.length > 700) break;
  }

  if (placements.length === 0) return group;

  const poleMat = new THREE.MeshStandardMaterial({ color: 0x9aa2a6, roughness: 0.45, metalness: 0.6 });
  const poleGeo = new THREE.CylinderGeometry(0.035, 0.04, 2.1, 8);
  poleGeo.translate(0, 1.05, 0);
  const poles = new THREE.InstancedMesh(poleGeo, poleMat, placements.length);
  poles.castShadow = true;
  const dummy = new THREE.Object3D();

  const textures: Record<SignKind, THREE.CanvasTexture> = {
    stop: signTexture('stop'),
    yield: signTexture('yield'),
    speed: signTexture('speed'),
  };
  const geometries: Record<SignKind, THREE.BufferGeometry> = {
    stop: new THREE.CircleGeometry(0.38, 8),
    yield: new THREE.CircleGeometry(0.42, 3),
    speed: new THREE.CircleGeometry(0.31, 24),
  };
  geometries.stop.rotateZ(Math.PI / 8);
  geometries.yield.rotateZ(Math.PI / 2);
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
    const y = heights.heightAt(p.x, p.z);
    dummy.position.set(p.x, y, p.z);
    dummy.rotation.set(0, 0, 0);
    dummy.updateMatrix();
    poles.setMatrixAt(i, dummy.matrix);

    // il disco sta 2 m da terra, leggermente inclinato verso la strada
    dummy.position.set(p.x, y + 1.95, p.z);
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
      const r = size * 0.48;
      const x = c + Math.cos(a) * r;
      const y = c + Math.sin(a) * r;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#f4f1ea';
    ctx.lineWidth = size * 0.05;
    ctx.stroke();
    ctx.fillStyle = '#f7f4ee';
    ctx.font = `bold ${size * 0.27}px Arial, Helvetica, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('STOP', c, c + size * 0.01);
  } else if (kind === 'yield') {
    ctx.fillStyle = '#f4f1ea';
    ctx.beginPath();
    ctx.moveTo(c, size * 0.07);
    ctx.lineTo(size * 0.94, size * 0.86);
    ctx.lineTo(size * 0.06, size * 0.86);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#b81f26';
    ctx.lineWidth = size * 0.12;
    ctx.stroke();
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

/** Panche e cestini nelle piazze: arredo minimo ma rompe il vuoto dei marciapiedi. */
export function buildStreetProps(
  _osm: OsmData,
  heights: Heightfield,
  buildings: BuildingIndex,
  renderer: THREE.WebGLRenderer,
): THREE.Group {
  const group = new THREE.Group();
  group.name = 'street-props';
  const rng = mulberry32(0x2b71);
  const benches: THREE.BufferGeometry[] = [];
  let placed = 0;

  for (const b of buildings.all) {
    if (placed >= 220) break;
    if (b.area < 90) continue;
    if (rng() > 0.42) continue;
    const c = { x: (b.bounds.minX + b.bounds.maxX) / 2, z: (b.bounds.minZ + b.bounds.maxZ) / 2 };
    const angle = rng() * Math.PI * 2;
    const dist = Math.max(b.bounds.maxX - b.bounds.minX, b.bounds.maxZ - b.bounds.minZ) / 2 + 2.4;
    const x = c.x + Math.cos(angle) * dist;
    const z = c.z + Math.sin(angle) * dist;
    if (heights.slopeAt(x, z) > 18) continue;
    const y = heights.heightAt(x, z);
    const rot = -angle;
    // doghe della seduta + schienale, ferro battuto per le gambe
    const wood = new THREE.Color(0x8a5f37);
    const iron = new THREE.Color(0x2c3033);
    const seat = new THREE.BoxGeometry(1.55, 0.07, 0.46).toNonIndexed();
    seat.rotateY(rot);
    seat.translate(x, y + 0.45, z);
    setColor(seat, wood);
    benches.push(seat);
    const back = new THREE.BoxGeometry(1.55, 0.42, 0.06).toNonIndexed();
    back.rotateY(rot);
    back.translate(x - Math.cos(rot) * 0.19, y + 0.68, z + Math.sin(rot) * 0.19);
    setColor(back, wood);
    benches.push(back);
    for (const side of [-0.62, 0.62]) {
      const leg = new THREE.BoxGeometry(0.07, 0.45, 0.5).toNonIndexed();
      leg.rotateY(rot);
      leg.translate(x + Math.cos(rot + Math.PI / 2) * side, y + 0.22, z + Math.sin(rot + Math.PI / 2) * side);
      setColor(leg, iron);
      benches.push(leg);
    }
    placed++;
  }

  if (benches.length === 0) return group;
  const merged = mergeGeometries(benches, false);
  for (const g of benches) g.dispose();
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

export type { Pt };

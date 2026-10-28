import fs from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { preciseBox, splitCarWheels } from '../src/entities/car-wheels';
import { type CarManifestEntry } from '../src/world/car-library';

(globalThis as any).self = globalThis;
(globalThis as any).window = globalThis;
(globalThis as any).document = {
  createElement: () => ({ setAttribute: () => {}, getContext: () => null })
};

(THREE as any).ImageLoader.prototype.load = function(url: string, onLoad: any) {
  const dummy = { width: 1, height: 1 };
  if (onLoad) setTimeout(() => onLoad(dummy), 0);
  return dummy;
};

if (typeof globalThis.createImageBitmap === 'undefined') {
  (globalThis as any).createImageBitmap = async () => ({ width: 1, height: 1, close: () => {} });
}

const CARS = path.join(process.cwd(), 'public', 'cars');
const manifest = JSON.parse(fs.readFileSync(path.join(CARS, 'manifest.json'), 'utf8'));

// Copy of car-library functions:
const WHEEL_TAG = /(?:wheel|ruota)[-_ ]?(fl|fr|rl|rr|lf|rf|lr|bl|br)(?![a-z0-9])/i;
const TIRE_TAG = /(?:^|[-_ .#])(?:tire|tyre|rim)[-_ ]?(fl|fr|rl|rr|lf|rf|lr|bl|br)(?![a-z0-9])/i;
const CORNER_TAG = /(?:^|[-_ .#])(fl|fr|rl|rr|lf|rf|lr|bl|br)(?=$|[-_ .#])/i;
const FRONT_WORDS = /(?:front|anteriore|avantreno)[-_ ]?(left|right|sinistra|destra)[-_ ]?(?:wheel|ruota)/i;
const REAR_WORDS = /(?:rear|retro|posteriore)[-_ ]?(left|right|sinistra|destra)[-_ ]?(?:wheel|ruota)/i;
const BRAKE_PART = /caliper|pinza|brakes?\b|freno/i;
const NOT_A_WHEEL = /caliper|pinza|brakes?\b|freno|steering|volante|mirror|specchietto|seat|sedile|targa|plate/i;

function canonicalCorner(tag: string): 'fl' | 'fr' | 'rl' | 'rr' {
  const value = tag.toLowerCase();
  if (value === 'lf') return 'fl';
  if (value === 'rf') return 'fr';
  if (value === 'lr' || value === 'bl') return 'rl';
  if (value === 'br') return 'rr';
  return value as 'fl' | 'fr' | 'rl' | 'rr';
}

function tagFromName(name: string): string | null {
  if (/(?:^|[-_ ])front[-_ ]?wheel$/i.test(name)) return 'fl';
  if (/(?:^|[-_ ])rear[-_ ]?wheel$/i.test(name)) return 'rl';
  if (/(?:^|[-_ ])(?:front|anteriore)[-_ ]?weel$/i.test(name)) return 'fl';
  if (/(?:^|[-_ ])(?:rear|back|posteriore)[-_ ]?weel$/i.test(name)) return 'rl';
  const direct = WHEEL_TAG.exec(name);
  if (direct) return canonicalCorner(direct[1]);
  const tire = TIRE_TAG.exec(name);
  if (tire) return canonicalCorner(tire[1]);
  const front = FRONT_WORDS.exec(name);
  if (front) return front[1].toLowerCase().startsWith('l') || front[1].toLowerCase().startsWith('s') ? 'fl' : 'fr';
  const rear = REAR_WORDS.exec(name);
  if (rear) return rear[1].toLowerCase().startsWith('l') || rear[1].toLowerCase().startsWith('s') ? 'rl' : 'rr';
  return null;
}

function depthOf(object: THREE.Object3D): number {
  let depth = 0;
  for (let parent = object.parent; parent; parent = parent.parent) depth++;
  return depth;
}

function isInsideHub(object: THREE.Object3D): boolean {
  for (let parent = object.parent; parent; parent = parent.parent) {
    if (parent.name.endsWith('-hub')) return true;
  }
  return false;
}

function makeHub(template: THREE.Group, node: THREE.Object3D, tag: string): THREE.Group {
  const box = preciseBox(node);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const hub = new THREE.Group();
  hub.name = `wheel-${tag}-hub`;
  hub.position.copy(center);
  hub.rotation.order = 'YXZ';
  hub.userData.wheelRadius = Math.max(size.x, size.y, size.z) / 2;
  template.add(hub);
  hub.updateMatrixWorld(true);
  hub.attach(node);
  node.name = `wheel-${tag}`;
  return hub;
}

function isAncestor(ancestor: THREE.Object3D, object: THREE.Object3D): boolean {
  for (let parent = object.parent; parent; parent = parent.parent) {
    if (parent === ancestor) return true;
  }
  return false;
}

function sameCorner(name: string, tag: string): boolean {
  const match = CORNER_TAG.exec(name);
  return match ? canonicalCorner(match[1]) === tag : false;
}

function detachBrakeParts(wheel: THREE.Object3D, template: THREE.Group): void {
  const moving: THREE.Object3D[] = [];
  wheel.traverse((object) => {
    if (object !== wheel && BRAKE_PART.test(object.name)) moving.push(object);
  });
  for (const object of moving) {
    if (isInsideHub(object)) continue;
    if (moving.some((other) => other !== object && isAncestor(other, object))) continue;
    template.attach(object);
  }
}

function declaredWheels(template: THREE.Group): { node: THREE.Object3D; tag: string }[] {
  const candidates: { node: THREE.Object3D; tag: string; depth: number }[] = [];
  template.traverse((object) => {
    if (!object.name || isInsideHub(object)) return;
    if (BRAKE_PART.test(object.name)) return;
    const tag = tagFromName(object.name);
    if (!tag) return;
    let node = object;
    while (node.parent && node.parent !== template && sameCorner(node.parent.name, tag)) node = node.parent;
    candidates.push({ node, tag, depth: depthOf(node) });
  });
  candidates.sort((a, b) => a.depth - b.depth);

  const chosen: { node: THREE.Object3D; tag: string }[] = [];
  const tags = new Set<string>();
  for (const candidate of candidates) {
    if (tags.has(candidate.tag)) continue;
    if (chosen.some((other) => isAncestor(other.node, candidate.node))) continue;
    tags.add(candidate.tag);
    chosen.push({ node: candidate.node, tag: candidate.tag });
  }
  return chosen;
}

function geometricWheels(template: THREE.Group, box: THREE.Box3): number {
  const size = box.getSize(new THREE.Vector3());
  const width = Math.max(size.x, 0.2);
  const height = Math.max(size.y, 0.2);
  const length = Math.max(size.z, 0.2);

  const targets = [
    new THREE.Vector3(-width * 0.42, 0, length * 0.33),
    new THREE.Vector3(width * 0.42, 0, length * 0.33),
    new THREE.Vector3(-width * 0.42, 0, -length * 0.33),
    new THREE.Vector3(width * 0.42, 0, -length * 0.33),
  ];

  const candidates: { mesh: THREE.Mesh; center: THREE.Vector3 }[] = [];
  template.traverse((object) => {
    const mesh = object as THREE.Mesh & { isInstancedMesh?: boolean; isSkinnedMesh?: boolean };
    if (!mesh.isMesh || !mesh.visible || mesh.isInstancedMesh || mesh.isSkinnedMesh) return;
    if (isInsideHub(object) || NOT_A_WHEEL.test(object.name)) return;
    const meshBox = preciseBox(mesh);
    if (meshBox.isEmpty()) return;
    const s = meshBox.getSize(new THREE.Vector3());
    const [d0, d1, d2] = [s.x, s.y, s.z].sort((a, b) => b - a);
    if (d0 < 0.05 || d0 > 0.32) return;
    if (d1 / d0 < 0.78) return;
    if (d2 / d0 > 0.72) return;
    const center = meshBox.getCenter(new THREE.Vector3());
    if (center.y > box.min.y + height * 0.55) return;
    if (Math.abs(center.x - (box.min.x + box.max.x) / 2) < width * 0.18) return;
    if (Math.abs(center.z - (box.min.z + box.max.z) / 2) < length * 0.15) return;
    candidates.push({ mesh, center });
  });
  if (candidates.length < 4) return 0;

  const clusters: { target: THREE.Vector3; items: THREE.Mesh[] }[] = targets.map((target) => ({ target, items: [] }));
  const limit = Math.max(width, 0.3) * 0.62;
  for (const candidate of candidates) {
    let best = -1;
    let bestDistance = Infinity;
    for (let i = 0; i < clusters.length; i++) {
      const target = clusters[i].target;
      const distance = Math.hypot(candidate.center.x - target.x, candidate.center.z - target.z);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = i;
      }
    }
    if (best >= 0 && bestDistance <= limit) clusters[best].items.push(candidate.mesh);
  }
  if (clusters.some((cluster) => cluster.items.length === 0)) return 0;

  let wheels = 0;
  for (let i = 0; i < clusters.length; i++) {
    const items = clusters[i].items;
    const union = new THREE.Box3();
    for (const mesh of items) union.union(preciseBox(mesh));
    if (union.isEmpty()) continue;
    const center = union.getCenter(new THREE.Vector3());
    const hub = new THREE.Group();
    hub.name = `wheel-${['fl', 'fr', 'rl', 'rr'][i]}-hub`;
    hub.position.copy(center);
    hub.rotation.order = 'YXZ';
    const unionSize = union.getSize(new THREE.Vector3());
    hub.userData.wheelRadius = Math.max(unionSize.x, unionSize.y, unionSize.z) / 2;
    template.add(hub);
    hub.updateMatrixWorld(true);
    for (const mesh of items) hub.attach(mesh);
    wheels++;
  }
  return wheels;
}

function normalize(root: THREE.Object3D, entry: CarManifestEntry): THREE.Group {
  const scene = root;
  scene.updateMatrixWorld(true);

  const orient = new THREE.Group();
  orient.name = 'car-orient';
  orient.rotation.y = THREE.MathUtils.degToRad(entry.yaw ?? 0);
  orient.add(scene);

  const template = new THREE.Group();
  template.name = `car:${entry.slug}`;
  template.add(orient);
  template.updateMatrixWorld(true);

  const raw = preciseBox(template);
  const rawSize = raw.getSize(new THREE.Vector3());
  const long = Math.max(rawSize.x, rawSize.z);
  const scale = 1 / Math.max(0.001, long);
  orient.scale.setScalar(scale);
  template.updateMatrixWorld(true);

  const scaled = preciseBox(template);
  const center = scaled.getCenter(new THREE.Vector3());
  orient.position.set(-center.x, -scaled.min.y, -center.z);
  template.updateMatrixWorld(true);

  return template;
}

async function testAll() {
  const loader = new GLTFLoader();
  
  for (const car of manifest.cars) {
    const file = path.join(CARS, car.file);
    if (!fs.existsSync(file)) continue;
    const buf = fs.readFileSync(file);
    const arrayBuffer = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    
    const gltf = await new Promise<any>((resolve, reject) => {
      loader.parse(arrayBuffer, '', resolve, reject);
    });

    const template = normalize(gltf.scene, car);
    const box = preciseBox(template);
    const size = box.getSize(new THREE.Vector3());

    let wheels = 0;
    let method = 'none';
    const declared = declaredWheels(template);
    const twoWheeler =
      declared.length === 2 &&
      declared.some((wheel) => wheel.tag === 'fl') &&
      declared.some((wheel) => wheel.tag === 'rl');
    if (declared.length >= 4 || twoWheeler) {
      method = 'declared';
      for (const { node, tag } of declared) {
        detachBrakeParts(node, template);
        makeHub(template, node, tag);
        wheels++;
      }
    } else if (declared.length === 0) {
      wheels = geometricWheels(template, box);
      if (wheels > 0) method = 'geometric';
    }
    if (wheels === 0) {
      const split = splitCarWheels(template, false);
      wheels = split?.wheels ?? 0;
      if (wheels > 0) method = 'split';
    }

    const hubs: { name: string; pos: THREE.Vector3; radius: number }[] = [];
    template.traverse((obj) => {
      if (obj.name.endsWith('-hub')) {
        hubs.push({ name: obj.name, pos: obj.position.clone(), radius: Number(obj.userData.wheelRadius) });
      }
    });

    console.log(`\n=== ${car.slug} ===`);
    console.log(`  size: [${size.x.toFixed(2)}, ${size.y.toFixed(2)}, ${size.z.toFixed(2)}] (aspect W/L: ${(size.x/size.z).toFixed(2)})`);
    console.log(`  wheels: ${wheels} (${method}) | hubs: ${hubs.length}`);
    for (const h of hubs) {
      console.log(`    ${h.name} pos=[${h.pos.x.toFixed(2)}, ${h.pos.y.toFixed(2)}, ${h.pos.z.toFixed(2)}] r=${h.radius.toFixed(3)}`);
    }
  }
}

testAll().catch(console.error);

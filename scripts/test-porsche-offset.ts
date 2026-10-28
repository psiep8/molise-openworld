import fs from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { preciseBox } from '../src/entities/car-wheels';

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

async function testPorsche() {
  const loader = new GLTFLoader();
  const buf = fs.readFileSync(path.join(CARS, 'mistery_porsche.glb'));
  const gltf = await new Promise<any>((resolve, reject) => {
    loader.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), '', resolve, reject);
  });

  const orient = new THREE.Group();
  orient.add(gltf.scene);
  const template = new THREE.Group();
  template.add(orient);
  template.updateMatrixWorld(true);

  const raw = preciseBox(template);
  const rawSize = raw.getSize(new THREE.Vector3());
  const long = Math.max(rawSize.x, rawSize.z);
  orient.scale.setScalar(1 / long);
  template.updateMatrixWorld(true);

  const scaled = preciseBox(template);
  const center = scaled.getCenter(new THREE.Vector3());
  orient.position.set(-center.x, -scaled.min.y, -center.z);
  template.updateMatrixWorld(true);

  // Now simulate buildExternal
  const specLength = 4.52; // from catalog
  const sourceLength = THREE.MathUtils.clamp(scaled.getSize(new THREE.Vector3()).z, 0.001, 100);
  const scale = specLength / sourceLength;

  const pivot = new THREE.Group();
  const source = template.clone(true);
  pivot.add(source);
  pivot.rotation.y = Math.PI;
  pivot.scale.setScalar(scale);
  pivot.updateMatrixWorld(true);

  const box = preciseBox(pivot);
  console.log('Porsche pivot box: min.y=', box.min.y, 'max.y=', box.max.y);
  
  // Find where the wheels are in pivot
  pivot.traverse(obj => {
    if (/wheel.*tire|tyre/i.test(obj.name)) {
      const b = preciseBox(obj);
      console.log(`  wheel mesh "${obj.name}": minY=${b.min.y.toFixed(3)}, maxY=${b.max.y.toFixed(3)}, center=${b.getCenter(new THREE.Vector3()).toArray().map(v=>+v.toFixed(3))}`);
    }
  });

  // Check what mesh produces box.min.y
  pivot.traverse(obj => {
    if ((obj as any).isMesh) {
      const b = preciseBox(obj);
      if (b.min.y < box.min.y + 0.1) {
        console.log(`  LOWEST MESH: "${obj.name}" minY=${b.min.y.toFixed(3)}, maxY=${b.max.y.toFixed(3)}`);
      }
    }
  });
}

testPorsche().catch(console.error);

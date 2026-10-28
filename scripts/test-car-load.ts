import fs from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

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

const buf = fs.readFileSync('public/cars/2011_fiat_punto.glb');
const loader = new GLTFLoader();
const arrayBuffer = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);

loader.parse(arrayBuffer, '', (gltf) => {
  console.log('SUCCESS! Parsed punto scene:', gltf.scene.name, 'children:', gltf.scene.children.length);
  process.exit(0);
}, (err) => {
  console.error('Error parsing GLTF:', err);
  process.exit(1);
});

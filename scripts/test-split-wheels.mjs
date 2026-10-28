import fs from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';
import { preciseBox, splitCarWheels } from '../src/entities/car-wheels';

const CARS = path.join(process.cwd(), 'public', 'cars');

function readGlb(file) {
  const buffer = fs.readFileSync(file);
  let offset = 12;
  let json = null;
  let binBuffer = null;
  while (offset < buffer.length) {
    const length = buffer.readUInt32LE(offset);
    const type = buffer.readUInt32LE(offset + 4);
    const chunk = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === 0x4e4f534a) json = JSON.parse(chunk.toString('utf8'));
    else if (type === 0x004e4942) binBuffer = chunk;
    offset += 8 + length + ((4 - (length % 4)) % 4);
  }
  return { json, binBuffer };
}

function buildThreeScene(glb) {
  const { json, binBuffer } = glb;
  const root = new THREE.Group();

  function getBufferData(accessorIdx) {
    const acc = json.accessors[accessorIdx];
    const bv = json.bufferViews[acc.bufferView];
    const start = (bv.byteOffset || 0) + (acc.byteOffset || 0);
    const byteLength = acc.count * (acc.type === 'VEC3' ? 12 : acc.type === 'VEC2' ? 8 : acc.type === 'SCALAR' ? 4 : 4);
    const slice = binBuffer.subarray(start, start + (bv.byteLength || byteLength));
    return { acc, slice };
  }

  const geometries = json.meshes.map(mesh => {
    const prim = mesh.primitives[0];
    if (!prim || prim.attributes.POSITION === undefined) return null;
    const geom = new THREE.BufferGeometry();
    const posData = getBufferData(prim.attributes.POSITION);
    const posArray = new Float32Array(posData.slice.buffer, posData.slice.byteOffset, posData.acc.count * 3);
    geom.setAttribute('position', new THREE.BufferAttribute(posArray, 3));

    if (prim.indices !== undefined) {
      const idxData = getBufferData(prim.indices);
      let idxArray;
      if (idxData.acc.componentType === 5123) { // UNSIGNED_SHORT
        idxArray = new Uint16Array(idxData.slice.buffer, idxData.slice.byteOffset, idxData.acc.count);
      } else if (idxData.acc.componentType === 5125) { // UNSIGNED_INT
        idxArray = new Uint32Array(idxData.slice.buffer, idxData.slice.byteOffset, idxData.acc.count);
      }
      if (idxArray) geom.setIndex(new THREE.BufferAttribute(idxArray, 1));
    }
    return geom;
  });

  const nodes = json.nodes.map((n, i) => {
    const grp = n.mesh !== undefined && geometries[n.mesh] 
      ? new THREE.Mesh(geometries[n.mesh], new THREE.MeshStandardMaterial({ name: json.materials?.[json.meshes[n.mesh].primitives[0]?.material]?.name || '' }))
      : new THREE.Group();
    grp.name = n.name || `node_${i}`;
    if (n.translation) grp.position.fromArray(n.translation);
    if (n.rotation) grp.quaternion.fromArray(n.rotation);
    if (n.scale) grp.scale.fromArray(n.scale);
    return grp;
  });

  json.nodes.forEach((n, i) => {
    if (n.children) {
      n.children.forEach(c => nodes[i].add(nodes[c]));
    }
  });

  const sceneNodes = json.scenes?.[0]?.nodes || [0];
  sceneNodes.forEach(sn => root.add(nodes[sn]));
  root.updateMatrixWorld(true);
  return root;
}

for (const slug of ['2011_fiat_punto.glb', 'audi_novulari.glb', 'bmw_inspired_1930s_saloon_car.glb']) {
  console.log(`\n=================== TESTING ${slug} ===================`);
  const glb = readGlb(path.join(CARS, slug));
  const scene = buildThreeScene(glb);

  // Normalize like car-library:
  const orient = new THREE.Group();
  orient.add(scene);
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

  console.log('Normalized box:', preciseBox(template).getSize(new THREE.Vector3()));
  
  // Try splitCarWheels
  const res = splitCarWheels(template, false);
  console.log('splitCarWheels result:', res);

  template.traverse(obj => {
    if (obj.name.includes('hub') || obj.name.includes('wheel')) {
      const box = preciseBox(obj);
      console.log(`  found object: "${obj.name}" parent: "${obj.parent?.name}" pos:`, obj.position, 'size:', box.getSize(new THREE.Vector3()), 'center:', box.getCenter(new THREE.Vector3()));
    }
  });
}

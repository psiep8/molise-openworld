import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import { metalRough, prune, dedup, weld, simplify, textureCompress } from '@gltf-transform/functions';
import sharp from 'sharp';

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
await MeshoptEncoder.ready;
await MeshoptSimplifier.ready;
const doc = await io.read('incoming-glb/oak_trees_pack_17var_lods_seasons_gameready.glb');
const root = doc.getRoot();
const names = ['Big_oak_tree__001_LOD0', 'Big_oak_tree__001_LOD1', 'Large_oak_tree_003_LOD0', 'Large_oak_tree_003_LOD1', 'Medium_oak_tree__003_LOD0', 'Medium_oak_tree__003_LOD1'];
const selected = new Set(names);
const keep = new Set();
for (const name of names) {
  const node = root.listNodes().find((entry) => entry.getName() === name);
  let current = node;
  while (current) {
    keep.add(current);
    current = current.getParentNode();
  }
}
for (const scene of root.listScenes()) {
  const walk = (parent) => {
    for (const child of [...parent.listChildren()]) {
      if (!keep.has(child)) parent.removeChild(child);
      else walk(child);
    }
  };
  walk(scene);
}
console.log('after detach nodes', root.listNodes().length, 'meshes', root.listMeshes().length);
for (const name of names) {
  const node = root.listNodes().find((entry) => entry.getName() === name);
  console.log(name, Boolean(node), node?.getParentNode()?.getName(), node?.listChildren().length);
}
await doc.transform(prune(), dedup(), weld());
console.log('after prune nodes', root.listNodes().length, 'meshes', root.listMeshes().length);
for (const name of names) console.log(name, Boolean(root.listNodes().find((entry) => entry.getName() === name)));
const tris = () => {
  let total = 0;
  for (const mesh of root.listMeshes()) for (const p of mesh.listPrimitives()) {
    const pos = p.getAttribute('POSITION'); const idx = p.getIndices();
    if (pos) total += Math.round((idx ? idx.getCount() : pos.getCount()) / 3);
  }
  return total;
};
console.log('tris before simplify', tris());
await doc.transform(simplify({ simplifier: MeshoptSimplifier, ratio: 0.5, error: 0.01 }));
console.log('after simplify nodes', root.listNodes().length, 'meshes', root.listMeshes().length, 'tris', tris());
for (const name of names) console.log(name, Boolean(root.listNodes().find((entry) => entry.getName() === name)));
await doc.transform(metalRough(), prune(), dedup(), weld());
await doc.transform(textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [1024, 1024], quality: 82 }));
await doc.transform(prune(), dedup());
console.log('after surface nodes', root.listNodes().length, 'meshes', root.listMeshes().length, 'tris', tris());
for (const name of names) console.log(name, Boolean(root.listNodes().find((entry) => entry.getName() === name)));

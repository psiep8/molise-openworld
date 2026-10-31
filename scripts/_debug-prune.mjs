import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read('incoming-glb/oak_trees_pack_17var_lods_seasons_gameready.glb');
const root = doc.getRoot();
const names = ['Big_oak_tree__001_LOD0', 'Big_oak_tree__001_LOD0'];
const keep = new Set();
for (const name of names) {
  const node = root.listNodes().find((entry) => entry.getName() === name);
  console.log('found', name, Boolean(node), node?.getParentNode()?.getName());
  let current = node;
  while (current) {
    keep.add(current);
    current = current.getParentNode();
  }
}
console.log('keep', [...keep].map((n) => n.getName()));
for (const scene of root.listScenes()) {
  console.log('scene', scene.getName(), 'children', scene.listChildren().length, scene.listChildren().map((n) => n.getName()));
  const prune = (parent) => {
    for (const child of [...parent.listChildren()]) {
      if (!keep.has(child)) parent.removeChild(child);
      else prune(child);
    }
  };
  prune(scene);
}
console.log('after nodes', root.listNodes().length);
console.log('after meshes', root.listMeshes().length);

import { NodeIO, getBounds } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';

const files = process.argv.slice(2);
await MeshoptDecoder.ready;
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.decoder': MeshoptDecoder });

for (const file of files) {
  const doc = await io.read(file);
  let best = null;
  for (const node of doc.getRoot().listNodes()) {
    const children = node.listChildren();
    if (!best || children.length > best.listChildren().length) best = node;
  }
  const nodes = best ? best.listChildren() : [];
  console.log(`\n### ${file} — root children ${nodes.length}`);
  let index = 0;
  for (const node of nodes) {
    index++;
    const box = getBounds(node);
    const size = [box.max[0] - box.min[0], box.max[1] - box.min[1], box.max[2] - box.min[2]];
    let tris = 0;
    let meshes = 0;
    const materials = new Set();
    node.traverse((n) => {
      const mesh = n.getMesh();
      if (!mesh) return;
      meshes++;
      for (const prim of mesh.listPrimitives()) {
        const pos = prim.getAttribute('POSITION');
        const idx = prim.getIndices();
        if (!pos) continue;
        tris += Math.round((idx ? idx.getCount() : pos.getCount()) / 3);
        materials.add(prim.getMaterial()?.getName() ?? '');
      }
    });
    console.log(
      `${String(index).padStart(2)} ${node.getName() ?? '-'} | h=${size[1].toFixed(2)} w=${size[0].toFixed(2)} d=${size[2].toFixed(2)} | tris=${tris} meshes=${meshes} | mats=${[...materials].slice(0, 4).join(',')}`,
    );
  }
}

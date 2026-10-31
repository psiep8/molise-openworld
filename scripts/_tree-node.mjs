import { NodeIO, getBounds } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';

const file = process.argv[2];
const names = process.argv.slice(3);
await MeshoptDecoder.ready;
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
const doc = await io.read(file);
const root = doc.getRoot();

for (const name of names) {
  const node = root.listNodes().find((n) => n.getName() === name);
  if (!node) {
    console.log('### missing', name);
    continue;
  }
  console.log('###', name);
  const walk = (n, depth) => {
    const b = getBounds(n);
    const s = [b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]];
    let tris = 0;
    const mesh = n.getMesh();
    if (mesh) {
      for (const prim of mesh.listPrimitives()) {
        const pos = prim.getAttribute('POSITION');
        const idx = prim.getIndices();
        if (pos) tris += Math.round((idx ? idx.getCount() : pos.getCount()) / 3);
      }
    }
    console.log(
      `${'  '.repeat(depth)}${n.getName() || '(mesh)'} h=${s[1].toFixed(2)} w=${s[0].toFixed(2)} d=${s[2].toFixed(2)} tris=${tris} mesh=${Boolean(mesh)}`,
    );
    for (const child of n.listChildren()) walk(child, depth + 1);
  };
  walk(node, 0);
}

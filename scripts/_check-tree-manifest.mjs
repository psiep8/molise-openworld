import { NodeIO, getBounds } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import { readFile } from 'node:fs/promises';

await MeshoptDecoder.ready;
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
const manifest = JSON.parse(await readFile('public/worldkit/manifest.json', 'utf8'));
const files = new Map();
for (const entry of manifest.models) {
  if (!entry.file.includes('tree-') || !entry.file.includes('pack')) continue;
  if (!files.has(entry.file)) files.set(entry.file, await io.read(`public/worldkit/${entry.file}`));
  const doc = files.get(entry.file);
  const nodes = entry.nodes
    .map((name) => doc.getRoot().listNodes().find((n) => n.getName() === name))
    .filter(Boolean);
  let tris = 0;
  for (const node of nodes) {
    const visit = (n) => {
      const mesh = n.getMesh();
      if (mesh) {
        for (const p of mesh.listPrimitives()) {
          const pos = p.getAttribute('POSITION');
          const idx = p.getIndices();
          if (pos) tris += Math.round((idx ? idx.getCount() : pos.getCount()) / 3);
        }
      }
      for (const c of n.listChildren()) visit(c);
    };
    visit(node);
  }
  const box = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
  for (const node of nodes) {
    const b = getBounds(node);
    for (let i = 0; i < 3; i++) {
      box.min[i] = Math.min(box.min[i], b.min[i]);
      box.max[i] = Math.max(box.max[i], b.max[i]);
    }
  }
  const h = nodes.length ? box.max[1] - box.min[1] : 0;
  console.log(
    `${entry.slug.padEnd(26)} ${entry.role.padEnd(13)} nodes=${nodes.length}/${entry.nodes.length} h=${h.toFixed(2)} tris=${tris}`,
  );
}

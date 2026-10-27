import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { describe, expect, it } from 'vitest';
import { preciseBox, splitCarWheels } from '../src/entities/car-wheels';

/** Quattro ruote locali (Z-up) più una carrozzeria, tutte nella stessa mesh. */
function zUpCar(merged = false): THREE.Group {
  const rot = new THREE.Group();
  rot.rotation.x = -Math.PI / 2;

  const geometries: THREE.BufferGeometry[] = [];
  for (const x of [-0.9, 0.9]) {
    for (const y of [-0.55, 0.55]) {
      const wheel = new THREE.BoxGeometry(0.3, 0.1, 0.3);
      wheel.translate(x, y, 0.3);
      geometries.push(wheel);
    }
  }
  const body = new THREE.BoxGeometry(3, 1.2, 0.7);
  body.translate(0, 0, 0.55);
  if (merged) geometries.push(body);

  const wheels = new THREE.Mesh(
    mergeGeometries(geometries, false)!,
    new THREE.MeshStandardMaterial(),
  );
  wheels.name = merged ? 'body' : 'car-body-with-wheels';

  if (merged) {
    rot.add(wheels);
  } else {
    const bodyMesh = new THREE.Mesh(body, new THREE.MeshStandardMaterial());
    bodyMesh.name = 'body';
    rot.add(bodyMesh, wheels);
  }
  const source = new THREE.Group();
  source.add(rot);
  source.updateMatrixWorld(true);
  return source;
}

describe('splitCarWheels', () => {
  it('riconosce quattro ruote anche se la mesh è coricata da un nodo Z-up', () => {
    const source = zUpCar();
    const result = splitCarWheels(source, true);

    expect(result).not.toBeNull();
    expect(result!.wheels).toBe(4);
    expect(result!.radius).toBeGreaterThan(0.1);
    const hubs: string[] = [];
    source.traverse((object) => {
      if (object.name.endsWith('-hub')) hubs.push(object.name);
    });
    expect(hubs.sort()).toEqual(['wheel-fl-hub', 'wheel-fr-hub', 'wheel-rl-hub', 'wheel-rr-hub']);
  });

  it('rimette la carrozzeria nella radice del template, senza doppia scala', () => {
    const source = zUpCar(true);
    const result = splitCarWheels(source, true);

    expect(result!.wheels).toBe(4);
    const body = source.children.find((child) => child.name === 'body') as THREE.Mesh | undefined;
    expect(body).toBeDefined();
    const size = preciseBox(body!).getSize(new THREE.Vector3());
    expect(size.x).toBeCloseTo(3, 1);
    expect(size.y).toBeCloseTo(0.7, 1);
  });
});

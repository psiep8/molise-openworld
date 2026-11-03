import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import { describe, expect, it } from 'vitest';
import { bindClip, HUMAN_FILES } from '../src/entities/human-model';

function loadFbx(file: string): THREE.Group & { animations: THREE.AnimationClip[] } {
  const buffer = readFileSync(new URL(`../public/models/${file}`, import.meta.url));
  const data = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
  return new FBXLoader().parse(data, '') as THREE.Group & { animations: THREE.AnimationClip[] };
}

function loadGlbSkeleton(file: string): THREE.Object3D {
  const buffer = readFileSync(new URL(`../public/models/${file}`, import.meta.url));
  const jsonLength = buffer.readUInt32LE(12);
  const doc = JSON.parse(buffer.toString('utf8', 20, 20 + jsonLength).trim()) as {
    nodes: Array<{
      name?: string;
      children?: number[];
      translation?: [number, number, number];
      rotation?: [number, number, number, number];
      scale?: [number, number, number];
    }>;
    skins: Array<{ joints: number[] }>;
    scenes: Array<{ nodes: number[] }>;
    scene?: number;
  };
  const joints = new Set(doc.skins.flatMap((skin) => skin.joints));
  const nodes = doc.nodes.map((node, index) => {
    const object = joints.has(index) ? new THREE.Bone() : new THREE.Group();
    object.name = node.name ?? '';
    if (node.translation) object.position.fromArray(node.translation);
    if (node.rotation) object.quaternion.fromArray(node.rotation);
    if (node.scale) object.scale.fromArray(node.scale);
    return object;
  });
  doc.nodes.forEach((node, index) => {
    for (const child of node.children ?? []) nodes[index]!.add(nodes[child]!);
  });
  const root = new THREE.Group();
  for (const sceneNode of doc.scenes[doc.scene ?? 0]!.nodes) root.add(nodes[sceneNode]!);
  return root;
}

describe('Rig Mixamo e corpi GLB', () => {
  it('binds the locomotion, turning and vehicle clips and animates a clone', () => {
    const body = loadFbx(HUMAN_FILES.sourceRig);
    let skinnedMeshes = 0;
    body.traverse((object) => {
      if ((object as THREE.SkinnedMesh).isSkinnedMesh) skinnedMeshes++;
    });
    expect(skinnedMeshes).toBeGreaterThan(0);

    const files = [
      HUMAN_FILES.idle,
      HUMAN_FILES.walk,
      ...HUMAN_FILES.walkVariants,
      HUMAN_FILES.run,
      HUMAN_FILES.jog,
      HUMAN_FILES.jump,
      HUMAN_FILES.stairs,
      HUMAN_FILES.strafeLeft,
      HUMAN_FILES.strafeRight,
      HUMAN_FILES.turnLeft,
      HUMAN_FILES.turnRight,
      HUMAN_FILES.walkTurn,
      HUMAN_FILES.turn180,
      HUMAN_FILES.startWalking,
      HUMAN_FILES.stopWalking,
      HUMAN_FILES.enterCar,
      HUMAN_FILES.exitCar,
      HUMAN_FILES.driving,
    ];
    const clips = files.map((file) => {
      const source = loadFbx(file).animations.find((clip) => clip.tracks.length > 0);
      if (!source) throw new Error(`FBX clip missing: ${file}`);
      const bound = bindClip(source, body);
      if (!bound) throw new Error(`FBX clip has no tracks for X Bot: ${file}`);
      return bound;
    });
    expect(clips).toHaveLength(files.length);

    const model = clone(body);
    const bones: Array<{ bone: THREE.Bone; rest: THREE.Quaternion }> = [];
    model.traverse((object) => {
      const bone = object as THREE.Bone;
      if (bone.isBone) bones.push({ bone, rest: bone.quaternion.clone() });
    });
    const mixer = new THREE.AnimationMixer(model);
    mixer.clipAction(clips[1]!).play();
    mixer.update(0.25);
    const changedBones = bones.filter(({ bone, rest }) => bone.quaternion.angleTo(rest) > 1e-4).length;
    expect(changedBones).toBeGreaterThan(0);
    mixer.stopAllAction();
  }, 15_000);

  it('i corpi visibili sono GLB con skin e ossa Mixamo, non X Bot', () => {
    for (const file of [HUMAN_FILES.maleBody, HUMAN_FILES.femaleBody]) {
      expect(file.endsWith('.glb')).toBe(true);
      const body = loadGlbSkeleton(file);
      let bones = 0;
      body.traverse((object) => { if ((object as THREE.Bone).isBone) bones++; });
      expect(bones).toBeGreaterThan(40);
      const names = new Set<string>();
      body.traverse((object) => names.add(object.name.toLowerCase()));
      for (const required of ['hips', 'spine', 'head', 'leftarm', 'rightarm', 'leftupleg', 'rightupleg']) {
        expect(names.has(required)).toBe(true);
      }
    }
    expect(HUMAN_FILES.sourceRig).not.toBe(HUMAN_FILES.maleBody);
  });

  it('misura i corpi e copre tutte le ossa richieste dalla camminata', () => {
    const source = loadFbx(HUMAN_FILES.walk).animations.find((clip) => clip.tracks.length > 0);
    if (!source) throw new Error('FBX walking clip missing');
    const required = new Set(
      source.tracks
        .map((track) => track.name.split('.')[0]!.replace(/^mixamorig:?/i, '').toLowerCase())
        .filter(Boolean),
    );
    expect(required.size).toBeGreaterThan(40);

    for (const [file, expected] of [
      [HUMAN_FILES.maleBody, 1.69],
      [HUMAN_FILES.femaleBody, 1.61],
    ] as const) {
      const body = loadGlbSkeleton(file);
      body.updateMatrixWorld(true);
      const names = new Set<string>();
      const heights: number[] = [];
      body.traverse((object) => {
        names.add(object.name.toLowerCase());
        const bone = object as THREE.Bone;
        if (!bone.isBone) return;
        const world = new THREE.Vector3();
        bone.getWorldPosition(world);
        heights.push(world.y);
      });
      const span = Math.max(...heights) - Math.min(...heights);
      expect(span, file).toBeGreaterThan(expected - 0.02);
      expect(span, file).toBeLessThan(expected + 0.02);
      expect([...required].filter((name) => !names.has(name)), file).toEqual([]);
    }
  });

  it('binds the walking clip to the realistic female rig and moves her legs', () => {
    const body = loadGlbSkeleton('donna.glb');
    const sourceRig = loadFbx(HUMAN_FILES.sourceRig);
    const source = loadFbx(HUMAN_FILES.walk).animations.find((clip) => clip.tracks.length > 0);
    if (!source) throw new Error('FBX walking clip missing');
    const bound = bindClip(source, body, sourceRig);
    if (!bound) throw new Error('FBX walking clip has no tracks for the female rig');

    const model = clone(body);
    const lowerLegKeys = new Set(['leftupleg', 'rightupleg', 'leftleg', 'rightleg']);
    const legs: Array<{ bone: THREE.Bone; rest: THREE.Quaternion }> = [];
    model.traverse((object) => {
      const bone = object as THREE.Bone;
      if (bone.isBone && lowerLegKeys.has(bone.name.toLowerCase())) {
        legs.push({ bone, rest: bone.quaternion.clone() });
      }
    });
    expect(legs).toHaveLength(4);

    const mixer = new THREE.AnimationMixer(model);
    mixer.clipAction(bound).play();
    mixer.update(0.25);
    const movingLegs = legs.filter(({ bone, rest }) => bone.quaternion.angleTo(rest) > 1e-4);
    expect(movingLegs.length).toBeGreaterThan(0);
    mixer.stopAllAction();
  });
});

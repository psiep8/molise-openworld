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

describe('X Bot FBX rig', () => {
  it('binds the locomotion, turning and vehicle clips and animates a clone', () => {
    const body = loadFbx(HUMAN_FILES.body);
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
  });
});

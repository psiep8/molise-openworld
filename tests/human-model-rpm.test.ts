import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { bindClip, HUMAN_FILES } from '../src/entities/human-model';

const modelsDir = join(process.cwd(), 'public', 'models');

interface GlbJson {
  animations?: Array<{ channels?: Array<{ target?: { node?: number } }> }>;
  nodes?: Array<{ name?: string }>;
}

function glbJson(file: string): GlbJson {
  const buffer = readFileSync(join(modelsDir, file));
  const jsonLength = buffer.readUInt32LE(12);
  return JSON.parse(buffer.subarray(20, 20 + jsonLength).toString('utf8')) as GlbJson;
}

function glbSummary(file: string): { animations: number; nodes: number } {
  const json = glbJson(file);
  return {
    animations: Array.isArray(json.animations) ? json.animations.length : 0,
    nodes: Array.isArray(json.nodes) ? json.nodes.length : 0,
  };
}

function animationTargets(file: string): string[] {
  const json = glbJson(file);
  const nodes = json.nodes ?? [];
  const names = (json.animations ?? []).flatMap((animation) =>
    (animation.channels ?? []).map((channel) => nodes[channel.target?.node ?? -1]?.name ?? ''),
  );
  return [...new Set(names.filter(Boolean))];
}

function filesIn(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? filesIn(path) : [path];
  });
}

describe('Animazioni GLB RPM', () => {
  it('le tre clip del runtime sono GLB con almeno un nodo e un’animazione', () => {
    for (const key of ['idle', 'walk', 'run'] as const) {
      const summary = glbSummary(HUMAN_FILES[key]);
      expect(summary.animations, key).toBeGreaterThan(0);
      expect(summary.nodes, key).toBeGreaterThan(0);
    }
  });

  it('non carica righe sorgente o file di animazione esterni', () => {
    expect('sourceRig' in HUMAN_FILES).toBe(false);
    expect(existsSync(join(modelsDir, 'xbot.fbx'))).toBe(false);
    expect(existsSync(join(modelsDir, 'locomotion-pack'))).toBe(false);
    expect(filesIn(modelsDir).filter((file) => file.toLowerCase().endsWith('.fbx'))).toEqual([]);
  });

  it('la camminata si lega allo scheletro del corpo RPM', () => {
    const body = new THREE.Group();
    for (const node of glbJson(HUMAN_FILES.femaleBody).nodes ?? []) {
      if (!node.name) continue;
      const bone = new THREE.Bone();
      bone.name = node.name;
      body.add(bone);
    }
    const tracks = animationTargets(HUMAN_FILES.walk).map(
      (name) => new THREE.QuaternionKeyframeTrack(`${name}.quaternion`, [0, 1], [0, 0, 0, 1, 0, 0, 0, 1]),
    );
    const bound = bindClip(new THREE.AnimationClip('walk', 1, tracks), body);
    expect(bound).not.toBeNull();
    expect(bound!.tracks.length).toBeGreaterThan(0);
  });

  it('riconosce le ossa Mixamo con prefisso dei corpi MakeHuman', () => {
    const body = new THREE.Group();
    const hips = new THREE.Bone();
    hips.name = 'mixamorig:Hips';
    body.add(hips);
    const head = new THREE.Bone();
    head.name = 'mixamorig:Head';
    body.add(head);
    const clip = new THREE.AnimationClip('walk', 1, [
      new THREE.QuaternionKeyframeTrack('Hips.quaternion', [0, 1], [0, 0, 0, 1, 0, 0, 0, 1]),
    ]);

    const bound = bindClip(clip, body);

    expect(bound).not.toBeNull();
    expect(bound!.tracks.map((track) => track.name)).toEqual(['mixamorig:Hips.quaternion']);
  });
});

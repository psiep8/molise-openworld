import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { parse } from 'posecode-parser';
import { buildMannequin, buildTimeline } from 'posecode-render';

/**
 * I movimenti Posecode sono dati, non codice: un refuso in un canale o una
 * durata negativa non fa fallire il build, ma rompe il personaggio in scena.
 * Questo test li analizza tutti come farebbe `npm run check:movements`, senza
 * aprire un browser.
 */

const SOURCES = import.meta.glob('../src/posecode/movements/*.posecode', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

const EXPECTED = [
  'idle-breathe',
  'look-around',
  'pick-up',
  'run',
  'squat',
  'stretch',
  'walk',
  'wave',
];

const files = Object.entries(SOURCES)
  .map(([path, source]) => ({ name: path.split('/').pop()?.replace('.posecode', '') ?? path, source }))
  .sort((a, b) => a.name.localeCompare(b.name));

function maxAngleDelta(a: Map<string, THREE.Euler>, b: Map<string, THREE.Euler>): number {
  const qa = new THREE.Quaternion();
  const qb = new THREE.Quaternion();
  let max = 0;
  for (const [id, ea] of a) {
    const eb = b.get(id);
    if (!eb) continue;
    qa.setFromEuler(ea);
    qb.setFromEuler(eb);
    max = Math.max(max, (qa.angleTo(qb) * 180) / Math.PI);
  }
  return max;
}

describe('movimenti Posecode', () => {
  it('copre tutti i movimenti previsti dallo studio', () => {
    expect(files.map((file) => file.name)).toEqual(EXPECTED);
  });

  for (const file of files) {
    describe(file.name, () => {
      const result = parse(file.source);

      it('analizza senza errori né avvisi', () => {
        expect(result.errors).toEqual([]);
        expect(result.warnings).toEqual([]);
        expect(result.ir).not.toBeNull();
      });

      it('descrive un movimento umanoide con fasi positive', () => {
        const ir = result.ir;
        expect(ir).not.toBeNull();
        if (!ir) return;
        expect(ir.rig).toBe('humanoid');
        expect(ir.name.length).toBeGreaterThan(0);
        expect(ir.repeat).toBeGreaterThanOrEqual(1);
        expect(ir.phases.length).toBeGreaterThan(0);
        for (const phase of ir.phases) {
          expect(phase.durationSec).toBeGreaterThan(0);
          expect(phase.durationSec).toBeLessThan(30);
        }
      });

      it('costruisce una timeline coerente', () => {
        const ir = result.ir;
        expect(ir).not.toBeNull();
        if (!ir) return;
        const timeline = buildTimeline(ir);
        expect(timeline.duration).toBeGreaterThan(0);
        expect(timeline.segments).toHaveLength(ir.phases.length);
        expect(timeline.bonesUsed.length).toBeGreaterThan(0);
        for (const segment of timeline.segments) {
          expect(segment.end).toBeGreaterThan(segment.start);
        }
      });

      it('chiude il ciclo senza scatti', () => {
        const ir = result.ir;
        expect(ir).not.toBeNull();
        if (!ir) return;
        const timeline = buildTimeline(ir);
        const mannequin = buildMannequin();

        const snapshot = (time: number): Map<string, THREE.Euler> => {
          timeline.sample(time, mannequin.bones);
          const pose = new Map<string, THREE.Euler>();
          for (const [id, bone] of mannequin.bones) {
            pose.set(id, new THREE.Euler(bone.rotation.x, bone.rotation.y, bone.rotation.z, 'XYZ'));
          }
          return pose;
        };

        const looped = ir.repeat > 1 || /walk|run|idle/.test(file.name);
        if (!looped) return;
        const seam = maxAngleDelta(snapshot(0), snapshot(Math.max(0, timeline.duration - 0.001)));
        expect(seam).toBeLessThan(2.5);
      });
    });
  }
});

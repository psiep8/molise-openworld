import { describe, expect, it } from 'vitest';
import {
  createRoadProfile,
  ROAD_PROFILE,
  roadProfileReach,
  ruralProfilePoints,
  sampleRoadProfile,
  sidewalkWidthForRoad,
} from '../src/world/road-profile';

describe('cross-section stradale', () => {
  it('condivide carreggiata, cordolo e marciapiede con quote continue', () => {
    const profile = createRoadProfile({ width: 6, paved: true, sidewalkWidth: sidewalkWidthForRoad(6) });
    expect(sampleRoadProfile(2.9, profile, 0.2)).toEqual({ kind: 'road', offset: 0.2 });
    expect(sampleRoadProfile(3.1, profile, 0.2)).toEqual({
      kind: 'sidewalk',
      offset: 0.2 + ROAD_PROFILE.curbHeight,
    });
    expect(roadProfileReach(profile)).toBeCloseTo(3 + 0.22 + 1.45);
    expect(sampleRoadProfile(roadProfileReach(profile) + 0.01, profile, 0.2)).toBeNull();
  });

  it('costruisce banchina, cunetta trapezoidale e raccordo esattamente sul DEM', () => {
    const profile = createRoadProfile({ width: 6, paved: true });
    const lift = 0.2;
    const points = ruralProfilePoints(profile, lift);
    expect(points).toHaveLength(4);
    expect(sampleRoadProfile(3 + ROAD_PROFILE.shoulderWidth, profile, lift)?.offset).toBeCloseTo(lift - 0.05);
    for (const point of points) {
      expect(sampleRoadProfile(point.distance, profile, lift)?.offset).toBeCloseTo(point.offset, 8);
    }

    const bottom = points[1]!;
    const start = points[0]!;
    const exit = points[2]!;
    const downAngle = (Math.atan(Math.abs((bottom.offset - start.offset) / (bottom.distance - start.distance))) * 180) / Math.PI;
    const upAngle = (Math.atan(Math.abs((exit.offset - bottom.offset) / (exit.distance - bottom.distance))) * 180) / Math.PI;
    expect(downAngle).toBeLessThanOrEqual(33);
    expect(upAngle).toBeLessThanOrEqual(33);
    expect(points.at(-1)!.offset).toBe(0);
    expect(roadProfileReach(profile) - profile.halfWidth).toBeCloseTo(3.4);
    expect(sampleRoadProfile(roadProfileReach(profile), profile, lift)?.offset).toBe(0);
    expect(sampleRoadProfile(roadProfileReach(profile) + 0.03, profile, lift)).toBeNull();
  });

  it('non estende il profilo fuori dalla carreggiata sui ponti', () => {
    const profile = createRoadProfile({ width: 6, paved: true, bridge: true });
    expect(roadProfileReach(profile)).toBe(3);
    expect(sampleRoadProfile(3.01, profile, 0.2)).toBeNull();
  });

  it('rifiuta dimensioni non finite o non positive', () => {
    expect(() => createRoadProfile({ width: 0, paved: true })).toThrow(RangeError);
    expect(() => createRoadProfile({ width: Number.NaN, paved: false })).toThrow(RangeError);
  });
});

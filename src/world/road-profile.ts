/**
 * Pure transverse road profile shared by the rendered ribbons and RoadIndex.
 * Distances are measured from the road centreline; offsets are relative to the
 * DEM, so the outside of the profile rejoins the same terrain used by physics.
 */
export interface RoadProfile {
  halfWidth: number;
  paved: boolean;
  sidewalkWidth: number;
  bridge: boolean;
  tunnel: boolean;
}

export interface RoadProfilePoint {
  distance: number;
  offset: number;
}

export interface RoadSurfaceProfilePoint {
  kind: 'road' | 'sidewalk' | 'shoulder';
  offset: number;
}

export const ROAD_PROFILE = {
  curbWidth: 0.22,
  curbHeight: 0.18,
  shoulderWidth: 0.72,
  ditchDepth: 0.3,
  ditchWidth: 1.4,
  vergeWidth: 1.28,
  shoulderDrop: 0.05,
} as const;

export function sidewalkWidthForRoad(width: number): number {
  if (!Number.isFinite(width) || width <= 0) throw new RangeError(`Larghezza stradale non valida: ${width}`);
  return width >= 6 ? 1.45 : 1.15;
}

export function createRoadProfile(input: {
  width: number;
  paved: boolean;
  sidewalkWidth?: number;
  bridge?: boolean;
  tunnel?: boolean;
}): RoadProfile {
  if (!Number.isFinite(input.width) || input.width <= 0) {
    throw new RangeError(`Larghezza stradale non valida: ${input.width}`);
  }
  const sidewalkWidth = input.paved ? Math.max(0, input.sidewalkWidth ?? 0) : 0;
  if (!Number.isFinite(sidewalkWidth)) throw new RangeError('Larghezza marciapiede non valida');
  return {
    halfWidth: input.width / 2,
    paved: input.paved,
    sidewalkWidth,
    bridge: input.bridge === true,
    tunnel: input.tunnel === true,
  };
}

/** Raggio esterno della sezione; fuori da questo punto governa il DEM nudo. */
export function roadProfileReach(profile: RoadProfile): number {
  if (profile.bridge || profile.tunnel) return profile.halfWidth;
  if (profile.sidewalkWidth > 0) {
    return profile.halfWidth + ROAD_PROFILE.curbWidth + profile.sidewalkWidth;
  }
  return profile.paved
    ? profile.halfWidth + ROAD_PROFILE.shoulderWidth + ROAD_PROFILE.ditchWidth + ROAD_PROFILE.vergeWidth
    : profile.halfWidth;
}

/** Stazioni del fosso e della scarpata, per ciascun lato della carreggiata. */
export function ruralProfilePoints(profile: RoadProfile, lift: number): RoadProfilePoint[] {
  if (!profile.paved || profile.sidewalkWidth > 0 || profile.bridge || profile.tunnel) return [];
  const shoulderEdge = profile.halfWidth + ROAD_PROFILE.shoulderWidth;
  const ditchStart = shoulderEdge;
  const ditchBottom = ditchStart + ROAD_PROFILE.ditchWidth * 0.65;
  const ditchExit = ditchStart + ROAD_PROFILE.ditchWidth;
  const vergeEdge = ditchExit + ROAD_PROFILE.vergeWidth;
  return [
    { distance: ditchStart, offset: lift - ROAD_PROFILE.shoulderDrop },
    { distance: ditchBottom, offset: -ROAD_PROFILE.ditchDepth },
    { distance: ditchExit, offset: 0 },
    { distance: vergeEdge, offset: 0 },
  ];
}

/**
 * Sample the walking/driving surface at a centreline distance. A null result
 * means the point is back on the DEM. Bridge and tunnel decks have no roadside
 * profile, matching their rendered deck geometry.
 */
export function sampleRoadProfile(
  distance: number,
  profile: RoadProfile,
  lift: number,
): RoadSurfaceProfilePoint | null {
  if (!Number.isFinite(distance) || distance < 0 || !Number.isFinite(lift)) return null;
  if (distance <= profile.halfWidth) return { kind: 'road', offset: lift };
  if (profile.bridge || profile.tunnel) return null;

  if (profile.sidewalkWidth > 0) {
    const sidewalkEdge = profile.halfWidth + ROAD_PROFILE.curbWidth + profile.sidewalkWidth;
    return distance <= sidewalkEdge
      ? { kind: 'sidewalk', offset: lift + ROAD_PROFILE.curbHeight }
      : null;
  }

  if (!profile.paved) return null;
  const shoulderEdge = profile.halfWidth + ROAD_PROFILE.shoulderWidth;
  if (distance <= shoulderEdge) return { kind: 'shoulder', offset: lift - ROAD_PROFILE.shoulderDrop };

  const points = ruralProfilePoints(profile, lift);
  const outer = points.at(-1)!;
  if (distance > outer.distance + 0.02) return null;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    if (distance > b.distance + 0.02) continue;
    const t = Math.max(
      0,
      Math.min(1, (distance - a.distance) / Math.max(1e-6, b.distance - a.distance)),
    );
    return {
      kind: 'shoulder',
      offset: a.offset + (b.offset - a.offset) * t,
    };
  }
  return null;
}

export interface PbfGeoPoint {
  lat: number;
  lon: number;
}

export interface PbfWay {
  id: number;
  tags: Record<string, string>;
  refs: number[];
}

export interface PbfExtract {
  nodes: Map<number, PbfGeoPoint>;
  ways: PbfWay[];
  blocks: number;
}

export function decodeOsmPbf(
  buffer: Buffer,
  options?: {
    keepNode?: (point: PbfGeoPoint) => boolean;
    keepWay?: (
      tags: Record<string, string>,
      refs: number[],
      nodes: Map<number, PbfGeoPoint>,
    ) => boolean;
  },
): PbfExtract;

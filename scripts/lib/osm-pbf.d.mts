export interface PbfGeoPoint {
  lat: number;
  lon: number;
}

export interface PbfWay {
  id: number;
  tags: Record<string, string>;
  refs: number[];
}

export interface PbfTaggedNode extends PbfGeoPoint {
  id: number;
  tags: Record<string, string>;
}

export interface PbfExtract {
  nodes: Map<number, PbfGeoPoint>;
  ways: PbfWay[];
  blocks: number;
  /** nodi con tag (POI) raccolti da `keepTaggedNode` */
  taggedNodes: PbfTaggedNode[];
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
    keepTaggedNode?: (tags: Record<string, string>, point: PbfGeoPoint) => boolean;
  },
): PbfExtract;

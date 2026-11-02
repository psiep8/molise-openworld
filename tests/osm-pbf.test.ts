import { describe, expect, it } from 'vitest';
import { decodeOsmPbf } from '../scripts/lib/osm-pbf.mjs';

/** Mini-encoder protobuf: costruisce un PBF valido senza dipendenze. */
function varint(value: number): number[] {
  let rest = Math.max(0, Math.round(value));
  const out: number[] = [];
  while (rest > 0x7f) {
    out.push((rest & 0x7f) | 0x80);
    rest = Math.floor(rest / 128);
  }
  out.push(rest);
  return out;
}

function zigzag(value: number): number {
  return value < 0 ? value * -2 - 1 : value * 2;
}

function tag(field: number, wire: number): number[] {
  return varint(field * 8 + wire);
}

function bytesField(field: number, bytes: number[]): number[] {
  return [...tag(field, 2), ...varint(bytes.length), ...bytes];
}

function varintField(field: number, value: number): number[] {
  return [...tag(field, 0), ...varint(value)];
}

function packedSint(field: number, values: number[]): number[] {
  return bytesField(field, values.flatMap((value) => varint(zigzag(value))));
}

function packedUint(field: number, values: number[]): number[] {
  return bytesField(field, values.flatMap((value) => varint(value)));
}

function fileBlock(type: string, payload: number[]): Buffer {
  // `datasize` è la lunghezza del messaggio Blob (campo + payload), non del
  // solo payload: il decoder usa quel numero per ritagliare i byte del Blob
  const blob = Buffer.from(bytesField(1, payload));
  const header = Buffer.from([
    ...bytesField(1, [...Buffer.from(type, 'utf8')]),
    ...varintField(3, blob.length),
  ]);
  // la lunghezza in testa riguarda il solo BlobHeader, non il Blob che segue
  const length = Buffer.alloc(4);
  length.writeUInt32BE(header.length, 0);
  return Buffer.concat([length, header, blob]);
}

function delta(values: number[]): number[] {
  let previous = 0;
  return values.map((value) => {
    const next = value - previous;
    previous = value;
    return next;
  });
}

function buildFixture(): Buffer {
  const strings = ['highway', 'secondary', 'name', 'Via Roma', 'building', 'yes'];
  const stringTable = strings.flatMap((value) => bytesField(1, [...Buffer.from(value, 'utf8')]));

  const ids = [101, 102, 103];
  const lats = [418_905_000, 418_907_000, 418_907_000];
  const lons = [147_854_000, 147_854_000, 147_862_000];
  const dense = [
    ...packedSint(1, delta(ids)),
    ...packedSint(8, delta(lats)),
    ...packedSint(9, delta(lons)),
  ];

  const wayRefs = delta([101, 102, 103, 101]);
  const road = [
    ...varintField(1, 10),
    ...packedUint(2, [0, 2]),
    ...packedUint(3, [1, 3]),
    ...packedSint(8, wayRefs),
  ];
  const building = [
    ...varintField(1, 11),
    ...packedUint(2, [4, 2]),
    ...packedUint(3, [5, 3]),
    ...packedSint(8, delta([101, 102, 103, 101])),
  ];

  const group = [...bytesField(2, dense), ...bytesField(3, road), ...bytesField(3, building)];
  const block = [
    ...bytesField(1, stringTable),
    ...bytesField(2, group),
    ...varintField(17, 100),
    ...varintField(18, 1000),
  ];
  return fileBlock('OSMData', block);
}

describe('decoder OSM PBF', () => {
  const extract = decodeOsmPbf(buildFixture());

  it('legge i nodi densi con granularità di 100 nanogradi', () => {
    expect(extract.blocks).toBe(1);
    expect(extract.nodes.size).toBe(3);
    const first = extract.nodes.get(101)!;
    expect(first.lat).toBeCloseTo(41.8905, 6);
    expect(first.lon).toBeCloseTo(14.7854, 6);
  });

  it('risolve tag e riferimenti delle way', () => {
    expect(extract.ways).toHaveLength(2);
    const road = extract.ways.find((way) => way.id === 10)!;
    expect(road.tags.highway).toBe('secondary');
    expect(road.tags.name).toBe('Via Roma');
    expect(road.refs).toEqual([101, 102, 103, 101]);
    const building = extract.ways.find((way) => way.id === 11)!;
    expect(building.tags.building).toBe('yes');
  });

  it('filtra nodi e way su richiesta', () => {
    const filtered = decodeOsmPbf(buildFixture(), {
      keepNode: (point) => point.lat > 41.8906,
      keepWay: (tags) => tags.building === 'yes',
    });
    expect(filtered.nodes.size).toBe(2);
    expect(filtered.ways.map((way) => way.id)).toEqual([11]);
  });

  it('rifiuta un file troncato senza andare in loop', () => {
    const truncated = buildFixture().subarray(0, 20);
    const result = decodeOsmPbf(truncated);
    expect(result.ways).toEqual([]);
  });
});

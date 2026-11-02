/**
 * Lettore minimale di OSM PBF (protobuf + zlib), senza dipendenze.
 *
 * Serve al generatore di tile: gli estratti Geofabrik sono PBF e non si vuole
 * aggiungere una libreria solo per leggerli. Si supportano i messaggi che
 * contano per strade ed edifici: `DenseNodes`, `Node`, `Way` e la string table.
 * Relazioni, cronologia e metadati vengono saltati.
 *
 * Il file è una sequenza di blocchi: [lunghezza BE][BlobHeader][Blob]. Il Blob
 * contiene un `PrimitiveBlock` compresso con zlib (oppure grezzo).
 */
import { inflateSync } from 'node:zlib';

const NANO = 1e-9;

class Proto {
  constructor(buffer, start = 0, end = buffer.length) {
    this.buffer = buffer;
    this.offset = start;
    this.end = end;
  }

  get done() {
    return this.offset >= this.end;
  }

  /** Varint senza segno, moltiplicando invece di usare shift (gli id superano 2^32). */
  varint() {
    let result = 0;
    let scale = 1;
    let byte;
    do {
      if (this.offset >= this.end) throw new Error('PBF troncato: varint incompleto');
      byte = this.buffer[this.offset++];
      result += (byte & 0x7f) * scale;
      scale *= 128;
    } while (byte & 0x80);
    return result;
  }

  /** sint64: zigzag. */
  sint() {
    const value = this.varint();
    return value % 2 === 0 ? value / 2 : -(value + 1) / 2;
  }

  bytes() {
    const length = this.varint();
    const start = this.offset;
    if (start + length > this.end) throw new Error('PBF troncato: campo a lunghezza eccessiva');
    this.offset += length;
    return this.buffer.subarray(start, this.offset);
  }

  skip(wire) {
    if (wire === 0) this.varint();
    else if (wire === 1) this.offset += 8;
    else if (wire === 2) {
      // attenzione: `offset += varint()` userebbe il vecchio offset e perderebbe
      // i byte del varint stesso, sfalsando tutto il resto del messaggio
      const length = this.varint();
      this.offset += length;
    }
    else if (wire === 5) this.offset += 4;
    else throw new Error(`PBF: wire type non gestito (${wire})`);
  }
}

function readBlobHeader(buffer) {
  const reader = new Proto(buffer);
  const header = { type: '', datasize: 0 };
  while (!reader.done) {
    const key = reader.varint();
    const field = key >>> 3;
    const wire = key & 7;
    if (field === 1 && wire === 2) header.type = reader.bytes().toString('utf8');
    else if (field === 3 && wire === 0) header.datasize = reader.varint();
    else reader.skip(wire);
  }
  return header;
}

function readBlob(buffer) {
  const reader = new Proto(buffer);
  let raw = null;
  let zlib = null;
  while (!reader.done) {
    const key = reader.varint();
    const field = key >>> 3;
    const wire = key & 7;
    if (field === 1 && wire === 2) raw = reader.bytes();
    else if (field === 3 && wire === 2) zlib = reader.bytes();
    else reader.skip(wire);
  }
  if (raw) return raw;
  if (zlib) return inflateSync(zlib);
  throw new Error('PBF: blocco senza dati (raw/zlib)');
}

function readStringTable(buffer) {
  const reader = new Proto(buffer);
  const strings = [];
  while (!reader.done) {
    const key = reader.varint();
    const field = key >>> 3;
    const wire = key & 7;
    if (field === 1 && wire === 2) strings.push(reader.bytes());
    else reader.skip(wire);
  }
  const decoder = new TextDecoder();
  return strings.map((value) => decoder.decode(value));
}

function readPackedSigned(buffer) {
  const reader = new Proto(buffer);
  const values = [];
  while (!reader.done) values.push(reader.sint());
  return values;
}

/** Indici della string table: uint32, niente zigzag. */
function readPackedUnsigned(buffer) {
  const reader = new Proto(buffer);
  const values = [];
  while (!reader.done) values.push(reader.varint());
  return values;
}

function decodeDenseNodes(buffer, table, nodes, keepNode, granularity, latOffset, lonOffset) {
  const reader = new Proto(buffer);
  let ids = null;
  let lats = null;
  let lons = null;
  while (!reader.done) {
    const key = reader.varint();
    const field = key >>> 3;
    const wire = key & 7;
    if (field === 1 && wire === 2) ids = readPackedSigned(reader.bytes());
    else if (field === 8 && wire === 2) lats = readPackedSigned(reader.bytes());
    else if (field === 9 && wire === 2) lons = readPackedSigned(reader.bytes());
    else reader.skip(wire);
  }
  if (!ids || !lats || !lons || ids.length !== lats.length || ids.length !== lons.length) return;
  let id = 0;
  let lat = 0;
  let lon = 0;
  for (let i = 0; i < ids.length; i++) {
    id += ids[i];
    lat += lats[i];
    lon += lons[i];
    const point = {
      lat: (latOffset + granularity * lat) * NANO,
      lon: (lonOffset + granularity * lon) * NANO,
    };
    if (!keepNode || keepNode(point)) nodes.set(id, point);
  }
  void table;
}

function decodeNode(buffer, table, nodes, keepNode, granularity, latOffset, lonOffset) {
  const reader = new Proto(buffer);
  let id = 0;
  let lat = 0;
  let lon = 0;
  while (!reader.done) {
    const key = reader.varint();
    const field = key >>> 3;
    const wire = key & 7;
    if (field === 1 && wire === 0) id = reader.sint();
    else if (field === 8 && wire === 0) lat = reader.sint();
    else if (field === 9 && wire === 0) lon = reader.sint();
    else reader.skip(wire);
  }
  const point = {
    lat: (latOffset + granularity * lat) * NANO,
    lon: (lonOffset + granularity * lon) * NANO,
  };
  if (!keepNode || keepNode(point)) nodes.set(id, point);
  void table;
}

function decodeWay(buffer, table, ways, keepWay, nodes) {
  const reader = new Proto(buffer);
  let id = 0;
  let keys = null;
  let vals = null;
  let refs = null;
  while (!reader.done) {
    const key = reader.varint();
    const field = key >>> 3;
    const wire = key & 7;
    if (field === 1 && wire === 0) id = reader.varint();
    else if (field === 2 && wire === 2) keys = readPackedUnsigned(reader.bytes());
    else if (field === 3 && wire === 2) vals = readPackedUnsigned(reader.bytes());
    else if (field === 8 && wire === 2) refs = readPackedSigned(reader.bytes());
    else reader.skip(wire);
  }
  if (!refs || refs.length < 2) return;
  const tags = {};
  if (keys && vals) {
    for (let i = 0; i < Math.min(keys.length, vals.length); i++) {
      const name = table[keys[i]];
      if (name) tags[name] = table[vals[i]] ?? '';
    }
  }
  let ref = 0;
  const resolved = [];
  for (const delta of refs) {
    ref += delta;
    resolved.push(ref);
  }
  // il chiamante può scartare le way che non toccano nessun nodo tenuto:
  // su un estratto regionale sono milioni di oggetti in meno in memoria
  if (keepWay && !keepWay(tags, resolved, nodes)) return;
  ways.push({ id, tags, refs: resolved });
}

function decodePrimitiveBlock(buffer, nodes, ways, keepNode, keepWay) {
  const reader = new Proto(buffer);
  let table = [];
  const groups = [];
  let granularity = 100;
  let latOffset = 0;
  let lonOffset = 0;
  while (!reader.done) {
    const key = reader.varint();
    const field = key >>> 3;
    const wire = key & 7;
    if (field === 1 && wire === 2) table = readStringTable(reader.bytes());
    else if (field === 2 && wire === 2) groups.push(reader.bytes());
    else if (field === 17 && wire === 0) granularity = reader.varint();
    else if (field === 19 && wire === 0) latOffset = reader.varint();
    else if (field === 20 && wire === 0) lonOffset = reader.varint();
    else reader.skip(wire);
  }

  for (const group of groups) {
    const groupReader = new Proto(group);
    while (!groupReader.done) {
      const key = groupReader.varint();
      const field = key >>> 3;
      const wire = key & 7;
      if (field === 1 && wire === 2) {
        decodeNode(groupReader.bytes(), table, nodes, keepNode, granularity, latOffset, lonOffset);
      } else if (field === 2 && wire === 2) {
        decodeDenseNodes(groupReader.bytes(), table, nodes, keepNode, granularity, latOffset, lonOffset);
      } else if (field === 3 && wire === 2) {
        decodeWay(groupReader.bytes(), table, ways, keepWay, nodes);
      } else {
        groupReader.skip(wire);
      }
    }
  }
}

/**
 * Decodifica un file `.osm.pbf`.
 *
 * - `keepNode(point)`: scarta i nodi fuori dall'area di interesse (fondamentale
 *   su un estratto regionale: sono decine di milioni);
 * - `keepWay(tags)`: tiene solo le way che servono (strade, edifici).
 */
export function decodeOsmPbf(buffer, options = {}) {
  const nodes = new Map();
  const ways = [];
  const keepNode = options.keepNode;
  const keepWay = options.keepWay;
  let offset = 0;
  let blocks = 0;
  while (offset + 4 <= buffer.length) {
    const headerLength = buffer.readUInt32BE(offset);
    offset += 4;
    if (!(headerLength > 0) || offset + headerLength > buffer.length) break;
    const header = readBlobHeader(buffer.subarray(offset, offset + headerLength));
    offset += headerLength;
    if (!(header.datasize > 0) || offset + header.datasize > buffer.length) break;
    const blob = buffer.subarray(offset, offset + header.datasize);
    offset += header.datasize;
    blocks++;
    if (header.type !== 'OSMData') continue;
    try {
      decodePrimitiveBlock(readBlob(blob), nodes, ways, keepNode, keepWay);
    } catch (error) {
      // file troncato (download parziale o estratto tagliato): ci si ferma al
      // ultimo blocco completo invece di restituire dati a metà
      if (options.strict) throw error;
      break;
    }
  }
  return { nodes, ways, blocks };
}

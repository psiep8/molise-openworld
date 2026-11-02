import { describe, expect, it } from 'vitest';
import { buildTiles, parseOsmXml } from '../scripts/build-world-tiles.mjs';
import { parseWorldDataTile } from '../src/geo/world-tiles';

const xml = `<?xml version="1.0" encoding="UTF-8"?>
<osm version="0.6">
  <node id="1" lat="41.8905" lon="14.7854"/>
  <node id="2" lat="41.8907" lon="14.7854"/>
  <node id="3" lat="41.8907" lon="14.7862"/>
  <node id="4" lat="41.8905" lon="14.7862"/>
  <node id="5" lat="41.9100" lon="14.8100"/>
  <node id="6" lat="41.9102" lon="14.8100"/>

  <way id="10">
    <nd ref="1"/><nd ref="2"/>
    <tag k="highway" v="secondary"/>
    <tag k="name" v="Via Roma"/>
    <tag k="maxspeed" v="50 km/h"/>
  </way>

  <way id="11">
    <nd ref="1"/><nd ref="2"/><nd ref="3"/><nd ref="4"/><nd ref="1"/>
    <tag k="building" v="yes"/>
    <tag k="building:levels" v="3"/>
  </way>

  <way id="12">
    <nd ref="1"/><nd ref="2"/><nd ref="3"/>
    <tag k="building" v="yes"/>
  </way>

  <way id="13">
    <nd ref="1"/><nd ref="999"/>
    <tag k="highway" v="track"/>
  </way>

  <way id="14">
    <nd ref="5"/><nd ref="6"/>
    <tag k="highway" v="track"/>
    <tag k="surface" v="gravel"/>
  </way>
</osm>`;

const attribution = '© OpenStreetMap contributors (ODbL)';

describe('generatore di tile geografici', () => {
  it('legge nodi, way e tag dell’estratto OSM', () => {
    const extract = parseOsmXml(xml);
    expect(extract.nodes.size).toBe(6);
    expect(extract.ways).toHaveLength(5);
    expect(extract.ways[0]?.tags.highway).toBe('secondary');
    expect(extract.ways[0]?.refs).toEqual([1, 2]);
  });

  it('mette ogni feature nel tile del suo primo punto', () => {
    const tiles = buildTiles(parseOsmXml(xml), { zoom: 14, attribution });
    expect(tiles.size).toBe(2);
    const bundles = [...tiles.values()];
    expect(bundles.every((bundle) => bundle.schemaVersion === 1)).toBe(true);
  });

  it('mappa classi stradali, larghezze e superfici', () => {
    const tiles = buildTiles(parseOsmXml(xml), { zoom: 14, attribution });
    const roads = [...tiles.values()].flatMap((tile) => tile.roads);
    expect(roads.map((road) => road.id)).toEqual(['way/10', 'way/14']);
    const secondary = roads.find((road) => road.id === 'way/10')!;
    expect(secondary.type).toBe('secondary');
    expect(secondary.width).toBeCloseTo(8.5, 6);
    expect(secondary.paved).toBe(true);
    expect(secondary.maxspeed).toBe(50);
    const track = roads.find((road) => road.id === 'way/14')!;
    expect(track.paved).toBe(false);
    expect(track.surface).toBe('gravel');
  });

  it('stima l’altezza dagli edifici e scarta anelli aperti o troppo piccoli', () => {
    const tiles = buildTiles(parseOsmXml(xml), { zoom: 14, attribution });
    const buildings = [...tiles.values()].flatMap((tile) => tile.buildings);
    expect(buildings).toHaveLength(1);
    expect(buildings[0]!.height).toBeCloseTo(9.3, 6);
    // l'anello chiuso perde il punto di chiusura duplicato
    expect(buildings[0]!.points).toHaveLength(4);
  });

  it('l’output è un bundle valido per il parser del client', () => {
    const tiles = buildTiles(parseOsmXml(xml), { zoom: 14, attribution });
    for (const [key, bundle] of tiles) {
      const parsed = parseWorldDataTile(JSON.stringify(bundle), bundle.tile);
      expect(`${parsed.tile.z}/${parsed.tile.x}/${parsed.tile.y}`).toBe(key);
      expect(parsed.attribution).toBe(attribution);
    }
  });

  it('rispetta il ritaglio geografico richiesto', () => {
    const tiles = buildTiles(parseOsmXml(xml), {
      zoom: 14,
      attribution,
      bbox: { minLat: 41.905, minLon: 14.805, maxLat: 41.92, maxLon: 14.815 },
    });
    const roads = [...tiles.values()].flatMap((tile) => tile.roads);
    expect(roads.map((road) => road.id)).toEqual(['way/14']);
  });

  it('rifiuta un’attribuzione mancante', () => {
    expect(() => buildTiles(parseOsmXml(xml), { zoom: 14, attribution: '  ' })).toThrow('attribuzione');
  });
});

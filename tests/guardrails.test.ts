import fs from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { Heightfield } from '../src/geo/elevation';
import { Heightfield as RealHeightfield, type HeightMeta } from '../src/geo/elevation';
import type { GroundSampler } from '../src/geo/ground';
import { loadOsm, type OsmData, type Road } from '../src/geo/osm';
import { buildGuardrails, mergeRuns, needsRail, railStations } from '../src/world/guardrails';
import { roadPolyline } from '../src/world/roads';

describe('fusione dei tratti', () => {
  it('chiude una buca corta e tiene il tratto lungo', () => {
    // 60 m di barriera, 20 m di buca, 60 m di barriera: deve diventare un nastro solo
    const on = [true, true, false, true, true];
    const lengths = [30, 30, 20, 30, 30];
    expect(mergeRuns(on, lengths)).toEqual([true, true, true, true, true]);
  });

  it('non chiude una buca più lunga della soglia', () => {
    const on = [true, true, false, true, true];
    const lengths = [30, 30, 80, 30, 30];
    expect(mergeRuns(on, lengths)).toEqual([true, true, false, true, true]);
  });

  it('scarta i tratti più corti di 40 m', () => {
    // 30 m, buca lunga, 30 m: sotto soglia entrambi
    expect(mergeRuns([true, false, true], [30, 200, 30])).toEqual([false, false, false]);
    // a 45 m il tratto è una barriera vera e resta
    expect(mergeRuns([true, false, true], [45, 200, 45])).toEqual([true, false, true]);
  });

  it('regge liste vuote e tratti a filo soglia', () => {
    expect(mergeRuns([], [])).toEqual([]);
    expect(mergeRuns([true], [40])).toEqual([true]);
    expect(mergeRuns([true], [39.9])).toEqual([false]);
  });
});

describe('stazioni delle campate', () => {
  it('su un rettilineo tiene il passo richiesto', () => {
    const line = [];
    for (let i = 0; i <= 200; i += 5) line.push({ x: 0, z: i });
    const stations = railStations(line, 24);
    for (let i = 1; i < stations.length; i++) {
      const d = Math.hypot(stations[i]!.x - stations[i - 1]!.x, stations[i]!.z - stations[i - 1]!.z);
      expect(d).toBeGreaterThanOrEqual(20);
      expect(d).toBeLessThan(30);
    }
  });

  it('accorcia le campate in curva: la corda non taglia l\'angolo', () => {
    // cerchio di raggio 25 m: una corda da 24 m taglierebbe l'angolo di metri
    const line: { x: number; z: number }[] = [];
    for (let i = 0; i <= 240; i++) {
      const a = i * 0.1;
      line.push({ x: Math.cos(a) * 25, z: Math.sin(a) * 25 });
    }
    const stations = railStations(line, 24, 0.35);
    expect(stations.length).toBeGreaterThan(10);
    for (let i = 1; i < stations.length; i++) {
      const from = line.indexOf(stations[i - 1]!);
      const to = line.indexOf(stations[i]!);
      expect(to).toBeGreaterThan(from);
      const a = line[from]!;
      const b = line[to]!;
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const len = Math.hypot(dx, dz) || 1;
      for (let k = from + 1; k < to; k++) {
        const p = line[k]!;
        const deviation = Math.abs((p.x - a.x) * dz - (p.z - a.z) * dx) / len;
        expect(deviation).toBeLessThanOrEqual(0.351);
      }
    }
  });

  it('regge le polilinee degeneri', () => {
    expect(railStations([], 24)).toHaveLength(0);
    expect(railStations([{ x: 1, z: 1 }], 24)).toHaveLength(1);
  });
});

describe('soglia della scarpata', () => {
  it('accetta un metro di dislivello a cinque metri', () => {
    expect(needsRail(100, 99)).toBe(true);
  });

  it('rifiuta il terreno quasi in piano', () => {
    // 0,5 m a 5 m: è una banchina, non una scarpata
    expect(needsRail(100, 99.5)).toBe(false);
  });

  it('rifiuta un pendio dolce anche se scende molto lontano', () => {
    // a 1,2 m il salto non esiste: era la regola vecchia, che non scattava mai
    expect(needsRail(100, 100 - 1.3, 1.2)).toBe(true);
  });
});

/** Terreno di prova: strada lungo z, il suolo scende dalla parte di x < 0. */
function hillside(x: number, z: number, fall = 0.3): number {
  void z;
  return 50 + Math.min(0, x) * fall;
}

function stubHeights(fn: (x: number, z: number) => number): Heightfield {
  return { heightAt: (x: number, z: number) => fn(x, z) } as unknown as Heightfield;
}

function stubGround(fn: (x: number, z: number) => number): GroundSampler {
  return {
    heightAt: (x: number, z: number) => fn(x, z),
    sampleAt: () => ({
      y: 0,
      lift: 0,
      kind: 'terrain' as const,
      onRoad: false,
      paved: false,
      surface: 'terrain',
    }),
  };
}

/** Strada dritta lungo z, `count` nodi a `step` metri. */
function straightRoad(config: Partial<Road> & { walkSpans?: boolean[] } = {}): OsmData {
  const points = [];
  for (let i = 0; i <= 20; i++) points.push({ x: 0, z: i * 20 });
  const road = {
    type: 'secondary',
    name: '',
    width: 6,
    paved: true,
    surface: 'asphalt',
    points,
    bounds: { minX: 0, maxX: 0, minZ: 0, maxZ: 400 },
    ...config,
  } as unknown as Road;
  return {
    generatedAt: '',
    attribution: '',
    stats: {},
    places: [],
    roads: [road],
    buildings: [],
    areas: [],
    waterways: [],
  } as unknown as OsmData;
}

/**
 * Per ogni campata, il minimo scarto fra la distanza dalla mezzeria di una
 * strada e la semilarghezza di quella strada: 0,72 m è un guardrail a filo del
 * ciglio. Griglia a 50 m per non confrontare 3.500 campate con 150.000 segmenti.
 */
function nearestRoadDistance(osm: OsmData, mesh: THREE.InstancedMesh): number[] {
  const cell = 50;
  const grid = new Map<string, { ax: number; az: number; bx: number; bz: number; half: number }[]>();
  const key = (i: number, j: number): string => `${i}:${j}`;
  // riferimento: la polilinea grafica, cioè l'asfalto che si vede, non i nodi
  // OSM grezzi (una provinciale ha un nodo ogni 800 m e la corda se ne stacca)
  for (const road of osm.roads) {
    const line = roadPolyline(road);
    for (let i = 1; i < line.length; i++) {
      const a = line[i - 1]!;
      const b = line[i]!;
      const k = key(Math.floor(a.x / cell), Math.floor(a.z / cell));
      const list = grid.get(k) ?? [];
      list.push({ ax: a.x, az: a.z, bx: b.x, bz: b.z, half: road.width / 2 });
      grid.set(k, list);
    }
  }
  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const out: number[] = [];
  for (let i = 0; i < mesh.count; i++) {
    mesh.getMatrixAt(i, matrix);
    position.setFromMatrixPosition(matrix);
    let best = Infinity;
    const ci = Math.floor(position.x / cell);
    const cj = Math.floor(position.z / cell);
    for (let di = -1; di <= 1; di++) {
      for (let dj = -1; dj <= 1; dj++) {
        for (const s of grid.get(key(ci + di, cj + dj)) ?? []) {
          // distanza punto-segmento: la polilinea ha punti ogni 3 m e la
          // distanza al punto più vicino da sola gonfierebbe la misura
          const dx = s.bx - s.ax;
          const dz = s.bz - s.az;
          const len2 = dx * dx + dz * dz || 1;
          const t = Math.min(1, Math.max(0, ((position.x - s.ax) * dx + (position.z - s.az) * dz) / len2));
          const d = Math.hypot(s.ax + dx * t - position.x, s.az + dz * t - position.z);
          best = Math.min(best, d - s.half);
        }
      }
    }
    out.push(best);
  }
  return out;
}

/** Somma della lunghezza dei nastri istanziati, in metri. */
function railMeters(group: THREE.Group): { spans: number; meters: number } {
  const mesh = group.children.find((c) => c.name === 'guardrail-rails') as
    | THREE.InstancedMesh
    | undefined;
  if (!mesh) return { spans: 0, meters: 0 };
  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const scale = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  let meters = 0;
  for (let i = 0; i < mesh.count; i++) {
    mesh.getMatrixAt(i, matrix);
    matrix.decompose(position, quaternion, scale);
    meters += scale.z;
  }
  return { spans: mesh.count, meters };
}

describe('guardrail sul terreno', () => {
  it('mette la barriera solo sul lato che scende', () => {
    const heights = stubHeights(hillside);
    const { group, spans } = buildGuardrails(
      straightRoad(),
      heights,
      stubGround(hillside),
      { maxSpans: 10_000 },
    );
    // una campata ogni ~24 m sui 400 m di strada: solo il lato che scende
    expect(spans).toBeGreaterThanOrEqual(10);
    expect(spans).toBeLessThanOrEqual(20);
    const rails = group.children.find((c) => c.name === 'guardrail-rails') as THREE.InstancedMesh;
    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    for (let i = 0; i < rails.count; i++) {
      rails.getMatrixAt(i, matrix);
      position.setFromMatrixPosition(matrix);
      // il lato che scende è quello a x negativa: nessun nastro a monte
      expect(position.x).toBeLessThan(-3.5);
    }
    expect(railMeters(group).meters).toBeGreaterThan(390);
  });

  it('su un piano non mette nulla', () => {
    const flat = () => 50;
    const { spans } = buildGuardrails(straightRoad(), stubHeights(flat), stubGround(flat), {
      maxSpans: 10_000,
    });
    expect(spans).toBe(0);
  });

  it('in paese, lungo i marciapiedi, non compare', () => {
    const road = straightRoad({ walkSpans: new Array(21).fill(true) });
    const { spans } = buildGuardrails(road, stubHeights(hillside), stubGround(hillside), {
      maxSpans: 10_000,
    });
    expect(spans).toBe(0);
  });

  it('sul ponte lo mette da entrambi i lati', () => {
    const road = straightRoad({ bridge: true, elevations: new Array(21).fill(60) });
    const { group, spans } = buildGuardrails(road, stubHeights(() => 0), stubGround(() => 0), {
      maxSpans: 10_000,
    });
    expect(spans % 2).toBe(0);
    // due nastri da 400 m: uno per lato
    expect(railMeters(group).meters).toBeGreaterThan(780);
    expect(railMeters(group).meters).toBeLessThan(820);
  });

  it('scarta la scarpata di pochi metri', () => {
    // solo i primi 20 m scendono: sotto la soglia di tratto minimo
    const short = (x: number, z: number): number => (z < 20 ? hillside(x, z) : 50);
    const { spans } = buildGuardrails(
      straightRoad(),
      stubHeights(short),
      stubGround(short),
      { maxSpans: 10_000 },
    );
    expect(spans).toBe(0);
  });

  it('col tetto di campate taglia tratti interi, non a metà', () => {
    // due tratti separati: 200 m in salita (nodi 0-10) e 140 m più avanti,
    // con 60 m di pianura in mezzo (troppi perché la fusione li unisca)
    const twoRuns = (x: number, z: number): number =>
      z <= 200 || z >= 260 ? hillside(x, z) : 50;
    const heights = stubHeights(twoRuns);
    const ten = buildGuardrails(straightRoad(), heights, stubGround(twoRuns), {
      maxSpans: 10,
    });
    // il primo tratto (200 m) ci sta, il secondo (140 m) non entra tutto: si
    // salta intero, invece di lasciare una barriera che finisce nel vuoto
    expect(railMeters(ten.group).meters).toBeGreaterThan(150);
    expect(railMeters(ten.group).meters).toBeLessThan(260);
    const roomy = buildGuardrails(straightRoad(), heights, stubGround(twoRuns), {
      maxSpans: 100,
    });
    expect(roomy.spans).toBeGreaterThan(ten.spans);
    expect(railMeters(roomy.group).meters).toBeGreaterThan(330);
  });
});

describe('guardrail sui dati veri', () => {
  const geo = path.join('public', 'geo');
  const ready = fs.existsSync(path.join(geo, 'heights.bin')) && fs.existsSync(path.join(geo, 'osm.json'));
  const run = ready ? it : it.skip;

  run('copre le scarpate del mondo reale', async () => {
    const meta = JSON.parse(
      fs.readFileSync(path.join(geo, 'heights.json'), 'utf8'),
    ) as HeightMeta;
    const buf = fs.readFileSync(path.join(geo, 'heights.bin'));
    const heights = new RealHeightfield(
      meta,
      new Int16Array(buf.buffer, buf.byteOffset, buf.byteLength / 2),
    );
    const rawOsm = fs.readFileSync(path.join(geo, 'osm.json'), 'utf8');
    const realFetch = globalThis.fetch;
    (globalThis as { fetch: unknown }).fetch = async (url: string | URL) =>
      String(url).endsWith('osm.json')
        ? new Response(rawOsm, { status: 200, headers: { 'content-type': 'application/json' } })
        : realFetch(url);
    const osm = await loadOsm('guardrails-test/');

    // la quota di partenza è il DEM: nel gioco è la superficie stradale, cioè
    // il DEM più il velo dell'asfalto (10-15 cm), che aggiunge qualche tratto
    const ground = stubGround((x, z) => heights.heightAt(x, z));
    const { group, spans } = buildGuardrails(osm, heights, ground, { maxSpans: 1_000_000 });
    const { meters } = railMeters(group);
    console.log(
      `guardrail: ${spans} campate, ${(meters / 1000).toFixed(1)} km su 574 km di rete`,
    );

    // Ogni campata deve stare sul bordo di una strada vera: a mezza larghezza
    // più 0,72 m dalla mezzeria. Una barriera in mezzo al campo sarebbe il
    // difetto peggiore, e non si vede dai test di conteggio.
    const mesh = group.children.find((c) => c.name === 'guardrail-rails') as THREE.InstancedMesh;
    const onRoad = nearestRoadDistance(osm, mesh);
    // Lo scarto è rispetto alla strada più vicina per *ciglio*: una campata
    // sulla provinciale può avere a due metri una pista stretta, e misurando
    // contro quella risulterebbe fuori posto pur essendo al suo posto.
    const worst = Math.max(...onRoad);
    // 1,8 m lascia spazio alla corda della campata in curva e ai tornanti
    // dove il segmento più vicino è un altro pezzo della stessa strada
    const far = onRoad.filter((d) => d > 1.8).length;
    console.log(
      `campate sul bordo strada: ${spans - far}/${spans} (scarto massimo ${worst.toFixed(2)} m oltre il ciglio)`,
    );
    expect(far).toBe(0);
    // con la regola vecchia (1,15 m a 1,2 m) i tratti erano 1.500 spezzoni da
    // meno di un metro in tutto: qui ci si aspetta una rete di decine di km
    expect(meters).toBeGreaterThan(15_000);
    expect(meters).toBeLessThan(120_000);
    expect(spans).toBeGreaterThan(100);
  }, 120_000);
});

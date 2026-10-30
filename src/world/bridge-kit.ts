import * as THREE from 'three';
import { START } from '../config';
import type { Pt } from '../geo/geo';
import { roadLift, type OsmData, type Road } from '../geo/osm';
import { bridgeElevations, roadPolyline } from './roads';
import type { WorldAsset, WorldKit, WorldSpot } from './worldkit';

/**
 * Impalcati GLB sui ponti OSM.
 *
 * `world/roads.ts` disegna già il nastro stradale del ponte alla quota
 * interpolata fra le due testate (`bridgeElevations`): quella resta l'unica
 * superficie con fisica e collisioni. Qui si aggiunge la struttura che il
 * nastro procedurale non ha, riusando i moduli fotogrammetrici del world kit.
 *
 * Differenze fra i due moduli:
 *  - `bridge-modular` (CC BY) è un concio da 20 m con piano stradale a 2,07 m
 *    sopra la base normalizzata: si allunga/allarga per coprire la campata.
 *  - `bridge-highway` (CC BY-NC) è un viadotto alto 20,21 m con piano a
 *    19,31 m: entra solo nella build non commerciale e solo sulla campata più
 *    lunga, dove i piloni trovano senso.
 *
 * Regole:
 *  - nessuna collisione: la carreggiata procedurale resta quella che si guida;
 *  - i moduli seguono la tangente della spline, quindi in curva non sporgono;
 *  - il tetto per preset (`quality.bridges`) si conta in moduli e si consuma
 *    partendo dai ponti più vicini alla casa: niente campate a metà.
 */

export interface BridgeResult {
  group: THREE.Group;
  /** ponti OSM che hanno ricevuto almeno un modulo */
  bridges: number;
  /** moduli `bridge-modular` piazzati */
  modules: number;
  /** moduli `bridge-highway` piazzati (solo non commerciale) */
  highwayModules: number;
}

/** Piano stradale sopra la base normalizzata, misurato nei GLB originali. */
const DECK_OFFSET: Readonly<Record<string, number>> = {
  'bridge-modular': 2.07,
  'bridge-highway': 19.31,
};

interface ModuleSpec {
  asset: WorldAsset;
  /** lunghezza del concio lungo l'asse stradale (m) */
  length: number;
  /** larghezza del piano stradale (m) */
  width: number;
  longAxis: 'x' | 'z';
  deckOffset: number;
}

interface BridgeSpan {
  index: number;
  road: Road;
  points: Pt[];
  cumulative: number[];
  deck: number[];
  total: number;
  distance: number;
}

interface Sample {
  x: number;
  z: number;
  tx: number;
  tz: number;
  deck: number;
}

function specFor(asset: WorldAsset): ModuleSpec | null {
  const deckOffset = DECK_OFFSET[asset.slug];
  if (deckOffset === undefined) return null;
  const longAxis = asset.size.x >= asset.size.z ? 'x' : 'z';
  const length = longAxis === 'x' ? asset.size.x : asset.size.z;
  const width = longAxis === 'x' ? asset.size.z : asset.size.x;
  if (length < 1 || width < 0.5) return null;
  return { asset, length, width, longAxis, deckOffset };
}

function cumulativeLengths(points: readonly Pt[]): number[] {
  const out = new Array<number>(points.length).fill(0);
  for (let i = 1; i < points.length; i++) {
    out[i] = out[i - 1]! + Math.hypot(points[i]!.x - points[i - 1]!.x, points[i]!.z - points[i - 1]!.z);
  }
  return out;
}

/** Punto, tangente e quota d'impalcato a `s` metri dall'inizio della spline. */
function sampleAt(span: BridgeSpan, s: number): Sample | null {
  const { points, cumulative, deck } = span;
  if (points.length < 2) return null;
  const total = span.total;
  if (total < 1e-3) return null;
  const distance = Math.min(Math.max(s, 0), total - 1e-4);
  // ricerca binaria: le campate lunghe hanno centinaia di punti
  let lo = 0;
  let hi = points.length - 1;
  while (lo + 1 < hi) {
    const mid = (lo + hi) >> 1;
    if (cumulative[mid]! <= distance) lo = mid;
    else hi = mid;
  }
  const a = points[lo]!;
  const b = points[hi]!;
  const seg = cumulative[hi]! - cumulative[lo]!;
  const t = seg > 1e-4 ? (distance - cumulative[lo]!) / seg : 0;
  const tx = seg > 1e-4 ? (b.x - a.x) / seg : 1;
  const tz = seg > 1e-4 ? (b.z - a.z) / seg : 0;
  return {
    x: a.x + (b.x - a.x) * t,
    z: a.z + (b.z - a.z) * t,
    tx,
    tz,
    deck: deck[lo]! + (deck[hi]! - deck[lo]!) * t,
  };
}

function collectSpans(osm: OsmData): BridgeSpan[] {
  const spans: BridgeSpan[] = [];
  for (let index = 0; index < osm.roads.length; index++) {
    const road = osm.roads[index]!;
    if (!road.bridge || road.tunnel || road.points.length < 2) continue;
    const points = roadPolyline(road);
    if (points.length < 2) continue;
    const deck = bridgeElevations(road, points);
    if (!deck || deck.length !== points.length) continue;
    const cumulative = cumulativeLengths(points);
    const total = cumulative[cumulative.length - 1] ?? 0;
    // un ponticello di 2 m non è una campata: il modulo sarebbe più grande
    // del torrente che attraversa
    if (total < 4) continue;
    let distance = Infinity;
    for (const point of points) {
      distance = Math.min(distance, Math.hypot(point.x - START.x, point.z - START.z));
    }
    spans.push({ index, road, points, cumulative, deck, total, distance });
  }
  return spans;
}

export function buildBridgeKit(osm: OsmData, kit: WorldKit, budget: number): BridgeResult {
  const group = new THREE.Group();
  group.name = 'bridge-kit';
  const total = Math.max(0, Math.round(budget));
  const variants = kit.variants('bridge');
  const specs = variants.map(specFor).filter((spec): spec is ModuleSpec => spec !== null);
  if (total === 0 || specs.length === 0) {
    return { group, bridges: 0, modules: 0, highwayModules: 0 };
  }

  const modular = specs.find((spec) => spec.asset.slug === 'bridge-modular') ?? specs[0]!;
  const highway = specs.find((spec) => spec.asset.slug === 'bridge-highway') ?? null;
  // il viadotto da 20 m è un'eccezione: una sola campata, quella più lunga,
  // e solo se il budget la copre interamente
  const spans = collectSpans(osm).sort((a, b) => a.distance - b.distance);
  const longest = spans.reduce<BridgeSpan | null>(
    (best, span) => (best === null || span.total > best.total ? span : best),
    null,
  );

  const spots: WorldSpot[] = [];
  let remaining = total;
  let bridges = 0;
  let modules = 0;
  let highwayModules = 0;

  const variantOf = (asset: WorldAsset): number => Math.max(0, variants.indexOf(asset));

  const lay = (span: BridgeSpan, spec: ModuleSpec, count: number): number => {
    const step = span.total / count;
    const scaleLength = step / spec.length;
    const targetWidth = Math.max(2.5, span.road.width + 0.7);
    const scaleWidth = targetWidth / spec.width;
    const lift = roadLift(span.index, span.road.paved);
    const variant = variantOf(spec.asset);
    const isHighway = spec.asset.slug === 'bridge-highway';
    for (let i = 0; i < count; i++) {
      const sample = sampleAt(span, (i + 0.5) * step);
      if (!sample) continue;
      // il piano del modulo resta appena sotto l'asfalto procedurale: il
      // nastro resta la superficie su cui si guida, il GLB è la struttura
      const y = sample.deck + lift - spec.deckOffset - 0.03;
      const yaw = spec.longAxis === 'x'
        ? Math.atan2(-sample.tz, sample.tx)
        : Math.atan2(sample.tx, sample.tz);
      spots.push({
        x: sample.x,
        y,
        z: sample.z,
        yaw,
        scaleX: spec.longAxis === 'x' ? scaleLength : scaleWidth,
        scaleZ: spec.longAxis === 'x' ? scaleWidth : scaleLength,
        variant,
      });
      if (isHighway) highwayModules++;
      else modules++;
    }
    return count;
  };

  for (const span of spans) {
    if (remaining <= 0) break;
    const preferred = span === longest && highway ? highway : modular;
    const count = Math.max(1, Math.ceil(span.total / (preferred.length * 0.98)));
    if (count > remaining) continue;
    lay(span, preferred, count);
    remaining -= count;
    bridges++;
  }

  // Un ponte lontano non deve entrare nella shadow map: l'InstancedMesh è uno
  // solo per tutto il mondo e non si può cullare per campata.
  if (spots.length > 0) group.add(kit.instances('bridge', spots, { castShadow: false }));
  return { group, bridges, modules, highwayModules };
}

import * as THREE from 'three';
import { START } from '../config';
import type { Heightfield } from '../geo/elevation';
import { mulberry32 } from '../geo/geo';
import { roadLift, type BuildingIndex, type OsmData, type RoadIndex } from '../geo/osm';
import type { QualityLevel } from '../gfx/quality';
import type { CityKit, KitSpot } from './citykit';

/**
 * Arredo del kit: paese **e campagna**.
 *
 * Dentro Palata: alberi sui marciapiedi e auto in sosta, a distanza regolare,
 * nel senso di marcia. Fuori dal paese gli stessi modelli servono a riempire i
 * vuoti che il terreno da solo non racconta: siepi lungo le strade di
 * campagna, rovi ai bordi, canneti lungo i torrenti, pietraie sui pendii e un
 * relitto in un fosso. Sono tutti elementi che in Molise ci sono davvero e che
 * a 20 m non hanno dettagli da leggere, quindi il low-poly non si nota.
 *
 * Tutto è deterministico (`mulberry32` con seed fisso), limitato dal preset
 * grafico e limitato a un raggio da casa: sono modelli da 0,4k a 65k triangoli,
 * non card, e fuori dalla vista non servono.
 */

// `minimal` non carica nemmeno il kit (preset `kit: false`), ma le mappe
// restano complete per non lasciare buchi se un giorno lo farà.
const TREE_LIMIT: Record<QualityLevel, number> = { minimal: 0, low: 0, medium: 10, high: 22, ultra: 32 };
const CAR_LIMIT: Record<QualityLevel, number> = { minimal: 0, low: 4, medium: 10, high: 18, ultra: 24 };
const HEDGE_LIMIT: Record<QualityLevel, number> = { minimal: 0, low: 48, medium: 120, high: 220, ultra: 340 };
const BUSH_LIMIT: Record<QualityLevel, number> = { minimal: 0, low: 30, medium: 80, high: 150, ultra: 220 };
const REED_LIMIT: Record<QualityLevel, number> = { minimal: 0, low: 24, medium: 70, high: 130, ultra: 190 };
const ROCK_LIMIT: Record<QualityLevel, number> = { minimal: 0, low: 24, medium: 64, high: 120, ultra: 170 };
const BOULDER_LIMIT: Record<QualityLevel, number> = { minimal: 0, low: 2, medium: 4, high: 8, ultra: 10 };
const TREE_RADIUS = 760;
const CAR_RADIUS = 560;
const SCENERY_RADIUS = 2400;
/** Lunghezza a cui si portano le auto low-poly prima di parcheggiarle. */
const LOW_CAR_LENGTH = 4.3;

/** Tinte plausibili per una berlina in un paese: niente colori da showroom. */
const CAR_COLORS = [
  0xe8e6e1, 0xb9bcc0, 0x8f9498, 0x4a4e52, 0x24272a, 0x7c1f22, 0x1d3a5f, 0x2c4a3a, 0xb7a98c,
  0x5c5148, 0xd9d4c6, 0x3c3f44,
];

export interface CityPropsResult {
  group: THREE.Group;
  trees: number;
  cars: number;
  hedges: number;
  bushes: number;
  reeds: number;
  rocks: number;
  wrecks: number;
}

export function buildCityProps(
  osm: OsmData,
  heights: Heightfield,
  roads: RoadIndex,
  buildings: BuildingIndex,
  kit: CityKit,
  quality: QualityLevel,
): CityPropsResult {
  const group = new THREE.Group();
  group.name = 'city-props';
  const rng = mulberry32(0x9c17);
  const treeLimit = TREE_LIMIT[quality];
  const hedgeLimit = HEDGE_LIMIT[quality];
  const bushLimit = BUSH_LIMIT[quality];
  const reedLimit = REED_LIMIT[quality];
  const rockLimit = ROCK_LIMIT[quality];
  const boulderLimit = BOULDER_LIMIT[quality];
  const carLimit = CAR_LIMIT[quality];
  // `minimal` non carica il kit, ma se un giorno lo facesse: nessun limite
  // attivo significa nessun giro su 1.090 strade per piazzare zero oggetti.
  if (treeLimit + hedgeLimit + bushLimit + reedLimit + rockLimit + boulderLimit + carLimit === 0) {
    return { group, trees: 0, cars: 0, hedges: 0, bushes: 0, reeds: 0, rocks: 0, wrecks: 0 };
  }
  const treeSpots: KitSpot[] = [];
  const carSpots: (KitSpot & { color: number })[] = [];
  const lowCarSpots: KitSpot[] = [];
  const lowCars = kit.variants('car-lowpoly');
  const hedgeSpots: KitSpot[] = [];
  const bushSpots: KitSpot[] = [];
  const reedSpots: KitSpot[] = [];
  const rockSpots: KitSpot[] = [];
  const boulderSpots: KitSpot[] = [];
  const wreckSpots: KitSpot[] = [];

  const inTown = (x: number, z: number): boolean => {
    for (const building of buildings.near(x, z)) {
      if (
        x > building.bounds.minX - 30 &&
        x < building.bounds.maxX + 30 &&
        z > building.bounds.minZ - 30 &&
        z < building.bounds.maxZ + 30
      ) {
        return true;
      }
    }
    return false;
  };

  const inStartRadius = (x: number, z: number, radius: number): boolean =>
    Math.hypot(x - START.x, z - START.z) <= radius;

  // ---------------------------------------------------------------------------
  // Paese: alberi sui marciapiedi e auto in sosta
  // ---------------------------------------------------------------------------
  for (const [roadIndex, road] of osm.roads.entries()) {
    if (!road.paved || road.width < 4) continue;
    const walkWidth = road.width >= 6 ? 1.8 : 1.45;
    let sinceTree = 0;
    let sinceCar = 0;

    for (let i = 1; i < road.points.length; i++) {
      const a = road.points[i - 1];
      const b = road.points[i];
      const seg = Math.hypot(b.x - a.x, b.z - a.z);
      if (seg < 1e-3) continue;
      sinceTree += seg;
      sinceCar += seg;
      const tx = (b.x - a.x) / seg;
      const tz = (b.z - a.z) / seg;

      if (treeSpots.length < treeLimit && sinceTree >= 26) {
        sinceTree = 0;
        if (inTown(b.x, b.z) && inStartRadius(b.x, b.z, TREE_RADIUS)) {
          const side = rng() < 0.5 ? 1 : -1;
          const off = road.width / 2 + 0.22 + Math.min(0.8, walkWidth / 2);
          const x = b.x - tz * side * off;
          const z = b.z + tx * side * off;
          if (
            !roads.isOnRoad(x, z, 0.6, roadIndex) &&
            !buildings.hitsCircle(x, z, 1.6) &&
            heights.slopeAt(x, z) <= 12 &&
            treeSpots.every((t) => Math.hypot(t.x - x, t.z - z) > 6)
          ) {
            treeSpots.push({
              x,
              y: heights.heightAt(x, z),
              z,
              yaw: rng() * Math.PI * 2,
              scale: 0.88 + rng() * 0.22,
            });
          }
        }
      }

      if (carSpots.length + lowCarSpots.length < carLimit && sinceCar >= 28) {
        sinceCar = 0;
        const fromHome = Math.hypot(b.x - START.x, b.z - START.z);
        if (fromHome > CAR_RADIUS) continue;
        // senso di marcia scelto per strada: la sosta sta sulla destra
        const forward = ((roadIndex + Math.floor(i / 12)) % 2 === 0 ? 1 : -1) as 1 | -1;
        const fx = tx * forward;
        const fz = tz * forward;
        // destra rispetto al verso: (fz, -fx)
        // 1,15 m dal bordo: la carrozzeria (2,07 m) resta dentro l'asfalto
        const x = b.x + fz * (road.width / 2 - 1.15);
        const z = b.z - fx * (road.width / 2 - 1.15);
        if (
          fromHome < 9 ||
          roads.isOnRoad(x, z, 0.5, roadIndex) ||
          buildings.hitsCircle(x, z, 1.3) ||
          heights.slopeAt(x, z) > 9 ||
          treeSpots.some((t) => Math.hypot(t.x - x, t.z - z) < 2.6)
        ) {
          continue;
        }
        const y = heights.heightAt(x, z) + roadLift(roadIndex, true);
        const yaw = Math.atan2(fx, fz);
        // Le berline low-poly hanno il davanti a +Z (verificato sui fari rossi
        // del modello, che stanno a -Z), quindi si parcheggiano nello stesso
        // verso della fotorealistica. Lontano da casa si alternano, così il
        // parcheggio non è un monoblocco; vicino allo spawn resta solo quella
        // del kit fotorealistico, che a 3 m regge il confronto.
        if (lowCars.length > 0 && fromHome > 150 && rng() < 0.45) {
          const variant = Math.floor(rng() * lowCars.length);
          const length = lowCars[variant].size.z || 3;
          lowCarSpots.push({ x, y, z, yaw, scale: LOW_CAR_LENGTH / length, variant });
        } else {
          carSpots.push({
            x,
            y,
            z,
            yaw,
            color: CAR_COLORS[Math.floor(rng() * CAR_COLORS.length)],
          });
        }
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Siepi (e rovi ai bordi) lungo le strade di campagna
  //
  // I muretti a secco stanno già lungo le sterrate; quindi le siepi vanno sulle
  // asfaltate strette, che è dove in Molise si vedono davvero: tratti di 25–60
  // m, poi un varco, poi di nuovo. Sempre fuori dal paese: in via non c'è posto.
  // ---------------------------------------------------------------------------
  if (kit.has('hedge')) {
    for (const road of osm.roads) {
      if (!road.paved || road.width < 3.2 || road.width > 6.4) continue;
      const side = rng() < 0.5 ? 1 : -1;
      const offset = road.width / 2 + 2.6 + rng() * 1.2;
      let runLeft = 0;
      let gapLeft = 12 + rng() * 48;

      for (let i = 1; i < road.points.length; i++) {
        if (hedgeSpots.length >= hedgeLimit) break;
        const a = road.points[i - 1];
        const b = road.points[i];
        const seg = Math.hypot(b.x - a.x, b.z - a.z);
        if (seg < 1e-3) continue;
        const tx = (b.x - a.x) / seg;
        const tz = (b.z - a.z) / seg;

        for (let s = 0; s < seg; s += 4.15) {
          if (hedgeSpots.length >= hedgeLimit) break;
          if (gapLeft > 0) {
            gapLeft -= 4.15;
            continue;
          }
          if (runLeft <= 0) runLeft = 6 + Math.floor(rng() * 16);
          runLeft--;

          const x = a.x + tx * s - tz * side * offset;
          const z = a.z + tz * s + tx * side * offset;
          if (!inStartRadius(x, z, SCENERY_RADIUS)) continue;
          if (inTown(x, z)) continue;
          if (roads.isOnRoad(x, z, 1.2) || buildings.hitsCircle(x, z, 1.4)) continue;
          if (heights.slopeAt(x, z) > 16) continue;

          hedgeSpots.push({
            x,
            y: heights.heightAt(x, z),
            z,
            yaw: Math.atan2(tx, tz),
            scale: 0.95 + rng() * 0.2,
            variant: 0,
          });

          // un rovo ogni tanto, appoggiato alla siepe verso il campo
          if (bushSpots.length < bushLimit && rng() < 0.18) {
            const out = offset + 1.2 + rng() * 1.1;
            const bx = a.x + tx * s - tz * side * out;
            const bz = a.z + tz * s + tx * side * out;
            if (
              !roads.isOnRoad(bx, bz, 1) &&
              !buildings.hitsCircle(bx, bz, 1) &&
              heights.slopeAt(bx, bz) <= 18
            ) {
              bushSpots.push({
                x: bx,
                y: heights.heightAt(bx, bz),
                z: bz,
                yaw: rng() * Math.PI * 2,
                scale: 0.75 + rng() * 0.5,
                variant: 0,
              });
            }
          }

          if (runLeft === 0) gapLeft = 10 + rng() * 38;
        }
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Canneti lungo i torrenti: la vegetazione che segna l'acqua anche da lontano
  // ---------------------------------------------------------------------------
  if (kit.has('reed')) {
    for (const water of osm.waterways) {
      for (let i = 1; i < water.points.length && reedSpots.length < reedLimit; i++) {
        const a = water.points[i - 1];
        const b = water.points[i];
        const seg = Math.hypot(b.x - a.x, b.z - a.z);
        if (seg < 1e-3) continue;
        const tx = (b.x - a.x) / seg;
        const tz = (b.z - a.z) / seg;
        for (let s = 0; s < seg; s += 7) {
          if (reedSpots.length >= reedLimit) break;
          if (rng() > 0.42) continue;
          const side = rng() < 0.5 ? 1 : -1;
          const off = 1.8 + rng() * 2.6;
          const x = a.x + tx * s - tz * side * off;
          const z = a.z + tz * s + tx * side * off;
          if (!inStartRadius(x, z, SCENERY_RADIUS)) continue;
          if (roads.isOnRoad(x, z, 1) || buildings.hitsCircle(x, z, 1.2)) continue;
          if (heights.slopeAt(x, z) > 18) continue;
          reedSpots.push({
            x,
            y: heights.heightAt(x, z),
            z,
            yaw: rng() * Math.PI * 2,
            scale: 0.7 + rng() * 0.65,
            variant: 0,
          });
        }
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Pietre: pietraie e massi sui pendii, più qualche masso vero del kit
  //
  // Sui terreni piani un masso isolato sembra un errore; sui pendii e sulle
  // scarpate è quello che affiora dappertutto in Molise.
  // ---------------------------------------------------------------------------
  if (kit.has('rock')) {
    const rockVariants = Math.max(1, kit.variants('rock').length);
    const cell = 46;
    for (let z = START.z - SCENERY_RADIUS; z <= START.z + SCENERY_RADIUS; z += cell) {
      if (rockSpots.length + boulderSpots.length >= rockLimit + boulderLimit) break;
      for (let x = START.x - SCENERY_RADIUS; x <= START.x + SCENERY_RADIUS; x += cell) {
        if (rockSpots.length + boulderSpots.length >= rockLimit + boulderLimit) break;
        if (rng() > 0.3) continue;
        const px = x + (rng() - 0.5) * cell;
        const pz = z + (rng() - 0.5) * cell;
        if (!inStartRadius(px, pz, SCENERY_RADIUS)) continue;
        const slope = heights.slopeAt(px, pz);
        if (slope < 9 || slope > 42) continue;
        if (roads.isOnRoad(px, pz, 2.2) || buildings.hitsCircle(px, pz, 2.5)) continue;
        if (inTown(px, pz)) continue;
        const spot: KitSpot = {
          x: px,
          y: heights.heightAt(px, pz),
          z: pz,
          yaw: rng() * Math.PI * 2,
          scale: 0.8 + rng() * 0.9,
          variant: Math.floor(rng() * rockVariants),
        };
        // 1 su 8 è il masso fotorealistico: costa 25k triangoli, quindi pochi
        if (kit.has('boulder') && boulderSpots.length < boulderLimit && rng() < 0.13) {
          boulderSpots.push({ ...spot, scale: 0.9 + rng() * 0.8 });
        } else if (rockSpots.length < rockLimit) {
          rockSpots.push(spot);
        }
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Un relitto in un fosso, fuori dal paese
  //
  // Le auto in sosta hanno bisogno del senso di marcia; un relitto no: sta di
  // traverso, magari con il muso nel fosso. È il posto giusto per il modello
  // low-poly, che in mezzo alla strada si noterebbe.
  // ---------------------------------------------------------------------------
  if (kit.has('wreck')) {
    let best: KitSpot | null = null;
    for (const road of osm.roads) {
      if (best) break;
      if (!road.paved || road.width < 3.4 || road.width > 6.2) continue;
      for (let i = 1; i < road.points.length && !best; i++) {
        const a = road.points[i - 1];
        const b = road.points[i];
        const seg = Math.hypot(b.x - a.x, b.z - a.z);
        if (seg < 1e-3) continue;
        const tx = (b.x - a.x) / seg;
        const tz = (b.z - a.z) / seg;
        const side = rng() < 0.5 ? 1 : -1;
        const off = road.width / 2 + 2.1;
        const x = b.x - tz * side * off;
        const z = b.z + tx * side * off;
        const d = Math.hypot(x - START.x, z - START.z);
        if (d < 520 || d > 1700) continue;
        if (inTown(x, z) || buildings.hitsCircle(x, z, 3)) continue;
        if (roads.isOnRoad(x, z, 1.6) || heights.slopeAt(x, z) > 12) continue;
        if (rng() > 0.25) continue;
        best = {
          x,
          y: heights.heightAt(x, z),
          z,
          yaw: Math.atan2(tx, tz) + (rng() - 0.5) * 1.3,
          scale: 1.45 + rng() * 0.12,
          variant: 0,
        };
      }
    }
    if (best) wreckSpots.push(best);
  }

  // ---------------------------------------------------------------------------
  // Istanze
  // ---------------------------------------------------------------------------
  if (treeSpots.length && kit.has('tree-street')) {
    group.add(kit.instances('tree-street', treeSpots, { castShadow: true, receiveShadow: true }));
  }
  if (carSpots.length && kit.has('car')) {
    group.add(kit.instances('car', carSpots, { castShadow: true, receiveShadow: true, tintPaint: true }));
  }
  if (lowCarSpots.length && lowCars.length) {
    group.add(kit.instances('car-lowpoly', lowCarSpots, { castShadow: true, receiveShadow: true }));
  }
  // siepi, rovi e canneti non proiettano ombre: sono centinaia di migliaia di
  // triangoli e l'ombra di una siepe a bordo strada non si nota
  if (hedgeSpots.length && kit.has('hedge')) {
    group.add(kit.instances('hedge', hedgeSpots, { castShadow: false, receiveShadow: true }));
  }
  if (bushSpots.length && kit.has('bush')) {
    group.add(kit.instances('bush', bushSpots, { castShadow: false, receiveShadow: true }));
  }
  if (reedSpots.length && kit.has('reed')) {
    group.add(kit.instances('reed', reedSpots, { castShadow: false, receiveShadow: true }));
  }
  if (rockSpots.length && kit.has('rock')) {
    group.add(kit.instances('rock', rockSpots, { castShadow: true, receiveShadow: true }));
  }
  if (boulderSpots.length && kit.has('boulder')) {
    group.add(kit.instances('boulder', boulderSpots, { castShadow: true, receiveShadow: true }));
  }
  if (wreckSpots.length && kit.has('wreck')) {
    group.add(kit.instances('wreck', wreckSpots, { castShadow: true, receiveShadow: true }));
  }

  return {
    group,
    trees: treeSpots.length,
    cars: carSpots.length + lowCarSpots.length,
    hedges: hedgeSpots.length,
    bushes: bushSpots.length,
    reeds: reedSpots.length,
    rocks: rockSpots.length + boulderSpots.length,
    wrecks: wreckSpots.length,
  };
}

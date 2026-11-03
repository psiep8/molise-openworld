import * as THREE from 'three';
import { HAIR_COLORS, SKINS, type Appearance, type HairStyle } from '../entities/appearance';
import { HumanBody, type HumanAssets } from '../entities/human-model';
import { footHeights, terrainTilt } from '../entities/locomotion';
import type { Pt } from '../geo/geo';
import type { GroundSampler } from '../geo/ground';
import type { BuildingIndex, OsmData } from '../geo/osm';

/**
 * Pedoni del paese.
 *
 * Prima di questo modulo il mondo era disabitato: strade, case e lampioni senza
 * una persona. Qui un certo numero di umani rigged cammina sui marciapiedi
 * seguendo le polilinee delle strade asfaltate, con altezza presa dal DEM,
 * passo preso dalle clip di motion capture e velocità leggermente diversa l'uno
 * dall'altro (chi va a spasso, chi va di fretta).
 *
 * Tre difetti corretti rispetto alla prima versione:
 *
 *  - le rotte erano offsettate di 1,15 m dal bordo strada **senza guardare le
 *    case**: nei vicoli stretti il percorso cadeva dentro le impronte e i
 *    pedoni attraversavano i muri. Ora ogni punto viene provato contro
 *    `BuildingIndex` e, se serve, riavvicinato alla strada; se non c'è spazio
 *    la rotta si scarta;
 *  - a runtime ogni pedone vicino viene spinto fuori dagli edifici, così anche
 *    un punto di rotta sfuggito non lo fa "dissolvere dentro la casa";
 *  - il respawn a 175 m era un teletrasporto secco e `visible = false` a 210 m
 *    faceva sparire le persone di colpo. Ora c'è una dissolvenza di 0,45 s e il
 *    riciclo avviene solo lontano, mai a vista ravvicinata.
 *
 * Il costo resta contenuto: corpi clonati da due prototipi, animazione solo
 * entro 120 m, dissolvenza e collisione leggera per tutti.
 */

interface Route {
  points: Pt[];
  cum: number[];
  length: number;
}

interface Walker {
  body: HumanBody;
  route: Route;
  s: number;
  speed: number;
  dir: 1 | -1;
  /** secondi di sosta: ogni tanto si ferma, come una persona vera */
  wait: number;
  /** 1 = pienamente visibile, 0 = dissolto */
  fade: number;
  /** -1 in dissolvenza d'uscita, 1 in entrata, 0 ferma */
  fading: -1 | 0 | 1;
  /** scarto laterale temporaneo per evitare l'auto */
  offsetX: number;
  offsetZ: number;
}

const ANIM_RADIUS = 120;
const VISIBLE_RADIUS = 190;
const RESPAWN_RADIUS = 165;
const SIDEWALK_OFFSET = 1.15;
const FADE_TIME = 0.45;

/**
 * Costruisce una rotta parallela al bordo strada. `anchor` è il punto sul bordo
 * dell'asfalto; i candidati si allontanano sempre meno dalla strada finché uno
 * non è libero da edifici. Se nessuno lo è, la rotta non esiste.
 */
export function makeRoute(
  points: Pt[],
  side: 1 | -1,
  offset: number,
  buildings?: BuildingIndex,
): Route | null {
  const out: Pt[] = [];
  const candidates = [
    offset,
    Math.max(0.75, offset - 0.35),
    Math.max(0.6, offset - 0.7),
    Math.max(0.5, offset * 0.5),
  ];
  for (let i = 0; i < points.length; i++) {
    const prev = points[Math.max(0, i - 1)]!;
    const next = points[Math.min(points.length - 1, i + 1)]!;
    let dx = next.x - prev.x;
    let dz = next.z - prev.z;
    const len = Math.hypot(dx, dz);
    if (len < 1e-4) continue;
    dx /= len;
    dz /= len;
    let chosen: Pt | null = null;
    for (const distance of candidates) {
      const p = {
        x: points[i]!.x + side * -dz * distance,
        z: points[i]!.z + side * dx * distance,
      };
      if (buildings && buildings.resolveCircle(p.x, p.z, 0.35).hit) continue;
      chosen = p;
      break;
    }
    // punto occupato da un muro su tutti i raggi: meglio perdere la rotta che
    // far camminare una persona dentro il salotto
    if (!chosen) return null;
    out.push(chosen);
  }
  if (out.length < 2) return null;
  const cum = [0];
  for (let i = 1; i < out.length; i++) {
    cum.push(cum[i - 1]! + Math.hypot(out[i]!.x - out[i - 1]!.x, out[i]!.z - out[i - 1]!.z));
  }
  const length = cum[cum.length - 1]!;
  if (length < 30) return null;
  return { points: out, cum, length };
}

function sampleRoute(route: Route, s: number): { x: number; z: number; dx: number; dz: number } {
  const { points, cum } = route;
  let lo = 0;
  let hi = cum.length - 1;
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1;
    if (cum[mid]! <= s) lo = mid;
    else hi = mid;
  }
  const a = points[lo]!;
  const b = points[hi]!;
  const seg = cum[hi]! - cum[lo]! || 1;
  const t = Math.min(1, Math.max(0, (s - cum[lo]!) / seg));
  return {
    x: a.x + (b.x - a.x) * t,
    z: a.z + (b.z - a.z) * t,
    dx: (b.x - a.x) / seg,
    dz: (b.z - a.z) / seg,
  };
}

const FEMALE_HAIR: readonly HairStyle[] = ['coda', 'lunghi', 'chignon', 'riccio', 'corto'];
const MALE_HAIR: readonly HairStyle[] = ['raso', 'corto', 'riccio', 'corto'];

/** Aspetto casuale ma credibile: più gente di mezza età che ventenni a caso. */
function randomLook(rng: () => number): Appearance {
  const female = rng() < 0.52;
  const build = rng() < 0.25 ? 'robusto' : rng() < 0.5 ? 'snello' : 'normale';
  const height = female ? 1.55 + rng() * 0.25 : 1.62 + rng() * 0.28;
  const skin = SKINS[Math.floor(rng() * SKINS.length)]!.color;
  const hairColor = HAIR_COLORS[Math.floor(rng() * HAIR_COLORS.length)]!.color;
  const hairStyles = female ? FEMALE_HAIR : MALE_HAIR;
  const hairStyle = hairStyles[Math.floor(rng() * hairStyles.length)]!;
  return {
    sex: female ? 'donna' : 'uomo',
    height,
    build,
    skin,
    hairStyle,
    hairColor,
    // Il viso e i capelli sono già vari; il vestiario resta neutro finché non
    // arrivano i capi definitivi. Così il paese non è una fila di cloni.
    beard: !female && rng() < 0.32,
    outfit: 'casual',
    tone: 'classico',
  };
}

export class Pedestrians {
  readonly group = new THREE.Group();
  private readonly walkers: Walker[] = [];
  private readonly routes: Route[] = [];
  private readonly rng: () => number;

  constructor(
    assets: HumanAssets,
    osm: OsmData,
    /** quota del marciapiede/asfalto/ponte: la stessa usata da giocatore e auto */
    private readonly ground: GroundSampler,
    focus: { x: number; z: number },
    count = 16,
    seed = 1,
    private readonly buildings?: BuildingIndex,
  ) {
    this.group.name = 'pedestrians';
    // generatore deterministico: la stessa scena a ogni avvio
    let state = seed >>> 0;
    this.rng = () => {
      state = (state * 1664525 + 1013904223) >>> 0;
      return state / 0x100000000;
    };

    for (const road of osm.roads) {
      if (!road.paved || road.points.length < 2) continue;
      if (road.width < 4) continue;
      const offset = road.width / 2 + SIDEWALK_OFFSET;
      for (const side of [1, -1] as const) {
        const route = makeRoute(road.points, side, offset, buildings);
        if (route) this.routes.push(route);
      }
    }
    if (this.routes.length === 0) return;

    for (let i = 0; i < count; i++) {
      const route = this.routes[Math.floor(this.rng() * this.routes.length)]!;
      const look = randomLook(this.rng);
      const tone = 0.88 + this.rng() * 0.2;
      const tint = new THREE.Color(tone, tone * (0.96 + this.rng() * 0.08), tone * (0.94 + this.rng() * 0.1));
      const body = new HumanBody(assets, look, {
        phase: this.rng() * 3,
        tint,
        importedBody: true,
      });
      this.group.add(body.group);
      const walker: Walker = {
        body,
        route,
        s: this.rng() * route.length,
        speed: 0.95 + this.rng() * 0.65,
        dir: this.rng() < 0.5 ? 1 : -1,
        wait: 0,
        fade: 1,
        fading: 0,
        offsetX: 0,
        offsetZ: 0,
      };
      // all'avvio i pedoni vanno messi dove si vede il giocatore, non sparsi
      // per tutto il comune: il paese deve sembrare vivo subito
      if (!this.placeNear(walker, focus, 90)) walker.s = this.rng() * route.length;
      this.walkers.push(walker);
    }
  }

  /** Sposta i pedoni e aggiorna solo quelli abbastanza vicini da vedersi. */
  update(dt: number, focus: { x: number; z: number }, vehicle?: { x: number; z: number }): void {
    for (const walker of this.walkers) {
      if (walker.wait > 0) {
        walker.wait -= dt;
      } else {
        walker.s += walker.speed * walker.dir * dt;
        if (walker.s > walker.route.length) walker.s -= walker.route.length;
        if (walker.s < 0) walker.s += walker.route.length;
        if (this.rng() < dt * 0.012) walker.wait = 4 + this.rng() * 11;
      }

      const pos = sampleRoute(walker.route, walker.s);
      // scarto per evitare l'auto: si riassorbe in ~1 s, come un passo di lato
      walker.offsetX *= Math.exp(-1.4 * dt);
      walker.offsetZ *= Math.exp(-1.4 * dt);
      let px = pos.x + walker.offsetX;
      let pz = pos.z + walker.offsetZ;
      if (vehicle) {
        const vx = px - vehicle.x;
        const vz = pz - vehicle.z;
        const distance = Math.hypot(vx, vz);
        if (distance < 2.6) {
          // la persona si fa da parte nella direzione opposta alla macchina
          const push = (2.6 - distance) * 0.7;
          const nx = distance > 1e-4 ? vx / distance : 1;
          const nz = distance > 1e-4 ? vz / distance : 0;
          walker.offsetX += nx * push;
          walker.offsetZ += nz * push;
          px += nx * push;
          pz += nz * push;
          walker.wait = Math.max(walker.wait, 0.35);
        }
      }
      // un punto di rotta sfuggito non deve far entrare la persona nel muro
      if (this.buildings) {
        const fixed = this.buildings.resolveCircle(px, pz, 0.3);
        if (fixed.hit) {
          px = fixed.x;
          pz = fixed.z;
          walker.wait = Math.max(walker.wait, 0.5);
        }
      }

      const y = this.ground.heightAt(px, pz);
      const dist = Math.hypot(px - focus.x, pz - focus.z);

      // dissolvenza invece del teletrasporto secco: prima si sfuma, poi si
      // ricicla lontano; rientro in dissolvenza, mai un pop a vista
      if (dist > RESPAWN_RADIUS && walker.fading === 0) walker.fading = -1;
      if (walker.fading < 0) {
        walker.fade = Math.max(0, walker.fade - dt / FADE_TIME);
        if (walker.fade <= 0) {
          this.respawn(walker, focus);
          walker.fade = 0;
          walker.fading = 1;
        }
      } else if (walker.fading > 0) {
        walker.fade = Math.min(1, walker.fade + dt / FADE_TIME);
        if (walker.fade >= 1) walker.fading = 0;
      }
      const scale = Math.max(0.001, walker.fade);
      walker.body.group.scale.setScalar(scale);

      // il modello guarda verso +z: l'angolo va calcolato sulla direzione di marcia
      const yaw = Math.atan2(pos.dx * walker.dir, pos.dz * walker.dir);
      const heightAt = (qx: number, qz: number): number => this.ground.heightAt(qx, qz);
      // i due piedi stanno sul marciapiede vero, non sulla quota del centro:
      // sul cordolo e sulle pendenze il corpo non deve galleggiare né affondare
      const feet = dist < ANIM_RADIUS ? footHeights(heightAt, px, pz, yaw) : null;
      walker.body.group.position.set(px, feet?.average ?? y, pz);
      walker.body.group.rotation.y = yaw;
      walker.body.group.visible = dist < VISIBLE_RADIUS && walker.fade > 0.01;
      if (dist < ANIM_RADIUS) {
        const tilt = terrainTilt(heightAt, px, pz, yaw);
        walker.body.setGroundTilt(tilt.pitch, tilt.roll);
        walker.body.update(dt, walker.wait > 0 ? 0 : walker.speed);
      }
    }
  }

  private respawn(walker: Walker, focus: { x: number; z: number }): void {
    // cerca una rotta che passi vicino al giocatore: meglio un giro a vuoto che
    // un pedone che sparisce dietro una collina per non tornare più
    if (!this.placeNear(walker, focus, 120)) walker.s = this.rng() * walker.route.length;
    walker.offsetX = 0;
    walker.offsetZ = 0;
  }

  /** Mette il pedone su un tratto di marciapiede entro `radius` dal punto dato. */
  private placeNear(walker: Walker, focus: { x: number; z: number }, radius: number): boolean {
    for (let attempt = 0; attempt < 12; attempt++) {
      const route = this.routes[Math.floor(this.rng() * this.routes.length)]!;
      for (let i = 0; i < route.points.length; i += 2) {
        const p = route.points[i]!;
        if (Math.hypot(p.x - focus.x, p.z - focus.z) < radius) {
          walker.route = route;
          walker.s = Math.min(route.length, route.cum[i]! + this.rng() * 12);
          walker.dir = this.rng() < 0.5 ? 1 : -1;
          return true;
        }
      }
    }
    return false;
  }

  get count(): number {
    return this.walkers.length;
  }

  dispose(): void {
    for (const walker of this.walkers) walker.body.dispose();
    this.walkers.length = 0;
    this.group.clear();
  }
}

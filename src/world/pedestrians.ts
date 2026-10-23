import * as THREE from 'three';
import type { Appearance } from '../entities/appearance';
import { HumanBody, type HumanAssets } from '../entities/human-model';
import type { Heightfield } from '../geo/elevation';
import type { Pt } from '../geo/geo';
import { CURB_HEIGHT, ROAD_LIFT, type OsmData } from '../geo/osm';

/**
 * Pedoni del paese.
 *
 * Prima di questo modulo il mondo era disabitato: strade, case e lampioni senza
 * una persona. Qui un certo numero di umani rigged cammina sui marciapiedi
 * seguendo le polilinee delle strade asfaltate, con altezza presa dal DEM,
 * passo preso dalle clip di motion capture e velocità leggermente diversa l'uno
 * dall'altro (chi va a spasso, chi va di fretta).
 *
 * Il costo è contenuto in tre modi: i corpi sono clonati da due soli prototipi,
 * l'animazione si aggiorna solo entro 90 m e chi è oltre 200 m viene riciclato
 * vicino al giocatore invece di restare in scena.
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
}

const ANIM_RADIUS = 90;
const VISIBLE_RADIUS = 210;
const RESPAWN_RADIUS = 175;
const SIDEWALK_OFFSET = 1.15;

function makeRoute(points: Pt[], side: 1 | -1, offset: number): Route | null {
  const out: Pt[] = [];
  for (let i = 0; i < points.length; i++) {
    const prev = points[Math.max(0, i - 1)]!;
    const next = points[Math.min(points.length - 1, i + 1)]!;
    let dx = next.x - prev.x;
    let dz = next.z - prev.z;
    const len = Math.hypot(dx, dz);
    if (len < 1e-4) continue;
    dx /= len;
    dz /= len;
    out.push({ x: points[i]!.x + side * -dz * offset, z: points[i]!.z + side * dx * offset });
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

/** Aspetto casuale ma credibile: più gente di mezza età che ventenni a caso. */
function randomLook(rng: () => number): Appearance {
  const female = rng() < 0.5;
  const build = rng() < 0.25 ? 'robusto' : rng() < 0.5 ? 'snello' : 'normale';
  const height = female ? 1.55 + rng() * 0.25 : 1.62 + rng() * 0.28;
  return {
    sex: female ? 'donna' : 'uomo',
    height,
    build,
    skin: 0xd7a07c,
    hairStyle: 'corto',
    hairColor: 0x53382a,
    beard: false,
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
    private readonly heights: Heightfield,
    focus: { x: number; z: number },
    count = 16,
    seed = 1,
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
        const route = makeRoute(road.points, side, offset);
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
      });
      this.group.add(body.group);
      const walker: Walker = {
        body,
        route,
        s: this.rng() * route.length,
        speed: 0.95 + this.rng() * 0.65,
        dir: this.rng() < 0.5 ? 1 : -1,
        wait: 0,
      };
      // all'avvio i pedoni vanno messi dove si vede il giocatore, non sparsi
      // per tutto il comune: il paese deve sembrare vivo subito
      if (!this.placeNear(walker, focus, 90)) walker.s = this.rng() * route.length;
      this.walkers.push(walker);
    }
  }

  /** Sposta i pedoni e aggiorna solo quelli abbastanza vicini da vedersi. */
  update(dt: number, focus: { x: number; z: number }): void {
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
      // il marciapiede è rialzato sopra il terreno: senza questa quota i piedi
      // finiscono dentro il cordolo
      const y = this.heights.heightAt(pos.x, pos.z) + ROAD_LIFT + CURB_HEIGHT;
      const dx = pos.x - focus.x;
      const dz = pos.z - focus.z;
      const dist = Math.hypot(dx, dz);

      if (dist > RESPAWN_RADIUS) {
        this.respawn(walker, focus);
        continue;
      }

      walker.body.group.position.set(pos.x, y, pos.z);
      // il modello guarda verso +z: l'angolo va calcolato sulla direzione di marcia
      walker.body.group.rotation.y = Math.atan2(pos.dx * walker.dir, pos.dz * walker.dir);
      walker.body.group.visible = dist < VISIBLE_RADIUS;
      if (dist < ANIM_RADIUS) walker.body.update(dt, walker.wait > 0 ? 0 : walker.speed);
    }
  }

  private respawn(walker: Walker, focus: { x: number; z: number }): void {
    // cerca una rotta che passi vicino al giocatore: meglio un giro a vuoto che
    // un pedone che sparisce dietro una collina per non tornare più
    if (!this.placeNear(walker, focus, 120)) walker.s = this.rng() * walker.route.length;
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


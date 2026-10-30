import { clamp } from '../geo/geo';
import { groundGridCells, terrainSlopeAt } from './ground-kit-rules';
import type { WorldSpot } from './worldkit';

/**
 * Copertura continua del suolo con zolle GLB.
 *
 * Il vecchio piazzamento sceglieva le celle a caso (`seed > coverChance`) e
 * lasciava buchi di decine di metri, proprio dove il satellite è più spiaccicato.
 * Qui il piano è deterministico e **contiguo**: ogni cella libera della griglia
 * riceve una zolla, scalata abbastanza da sovrapporsi ai vicini; le celle
 * occupate da strada, acqua, costruito o pendio restano fuori perché lì c'è già
 * una superficie vera (asfalto, tetti, roccia).
 *
 * Le distanze sono divise in due livelli: `lod 1` vicino al giocatore (zolle
 * scelte da copertura e superficie), `lod 2` oltre la soglia (solo copertura,
 * niente dettaglio fotogrammetrico piccolo). Il piano è puro e senza Three.js,
 * quindi è misurabile e riusabile anche fuori dal rendering.
 */

export interface GroundCoverVariant {
  /** slug del manifest, per diagnostica e scelta della variante */
  slug: string;
  /** impronta orizzontale minima dopo la normalizzazione, in metri */
  footprint: number;
  /** indice della variante nella lista del ruolo (`kit.variants('ground')`) */
  variant: number;
  triangles: number;
}

export interface GroundCoverChoice {
  asset: GroundCoverVariant;
  /** moltiplicatore extra sulla scala (dettaglio piccolo, zolle di bordo) */
  scale?: number;
  /** rotazione forzata; se assente si alterna 0 / 90° per cella */
  yaw?: number;
}

export interface GroundCoverOptions {
  x: number;
  z: number;
  /** numero massimo di istanze: il preset decide quanto terreno rivestire */
  budget: number;
  /** passo della griglia in metri; deve coprire l'impronta minima */
  spacing: number;
  /** oltre questo raggio non si pianta nulla (default 60 m) */
  maxRadius?: number;
  /** quota della zolla; il piano non conosce Three.js né il sampler */
  heightAt: (x: number, z: number) => number;
  /** scelta della variante; `null` = cella non piantabile (strada, acqua, casa) */
  variantAt: (x: number, z: number, seed: number, slopeDegrees: number) => GroundCoverChoice | null;
  /** sollevamento sopra il DEM per evitare z-fighting (default 0,035 m) */
  lift?: number;
  /** seme stabile per rotazioni e scelte; default derivato dal centro */
  seed?: number;
}

export interface GroundCoverPlan {
  spots: WorldSpot[];
  /** passo usato, in metri */
  spacing: number;
  /** raggio effettivamente coperto dal budget */
  radius: number;
  /** celle della griglia considerate */
  cells: number;
  /** celle non piantabili (strada, acqua, costruito, pendio) */
  blocked: number;
  /** celle piantate / celle piantabili: 1 = nessun buco */
  coverage: number;
  /** celle piantate / celle totali: misura il peso delle zone non piantabili */
  fill: number;
  near: number;
  far: number;
  /** stima dei triangoli istanziati, per il budget del preset */
  triangles: number;
}

const DEFAULT_MAX_RADIUS = 60;
const DEFAULT_LIFT = 0.015;
/**
 * Spostamenti provati quando il centro della cella cade su strada o casa.
 * In paese il passo della griglia (16 m) cade quasi sempre su un edificio: se
 * la cella venisse scartata, il cortile e il prato dietro la casa resterebbero
 * al mosaico satellite. Con uno scivolamento di un terzo del passo la zolla
 * trova lo spazio libero e copre comunque la cella.
 */
const NUDGES: readonly (readonly [number, number])[] = [
  [0.33, 0],
  [-0.33, 0],
  [0, 0.33],
  [0, -0.33],
  [0.24, 0.24],
  [-0.24, 0.24],
  [0.24, -0.24],
  [-0.24, -0.24],
];

function hash2(x: number, z: number): number {
  const value = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453;
  return value - Math.floor(value);
}

function emptyPlan(spacing: number): GroundCoverPlan {
  return {
    spots: [],
    spacing,
    radius: 0,
    cells: 0,
    blocked: 0,
    coverage: 1,
    fill: 0,
    near: 0,
    far: 0,
    triangles: 0,
  };
}

/**
 * Piano contiguo delle zolle intorno a un punto.
 *
 * Il raggio nasce dal budget (`spacing * sqrt(budget / π)`), non da un numero
 * fisso: con 22 zolle il preset medio copre ~40 m, con 54 arriva a 60. Così il
 * terreno vicino non resta scoperto solo perché il tetto del preset è basso.
 */
export function planGroundCover(options: GroundCoverOptions): GroundCoverPlan {
  const {
    x,
    z,
    budget,
    spacing,
    maxRadius = DEFAULT_MAX_RADIUS,
    heightAt,
    variantAt,
    lift = DEFAULT_LIFT,
    seed = hash2(x, z),
  } = options;

  const count = Math.max(0, Math.floor(budget));
  if (!(spacing > 0) || !Number.isFinite(spacing)) {
    throw new RangeError(`Passo di copertura non valido: ${spacing}`);
  }
  if (!Number.isFinite(x) || !Number.isFinite(z) || !Number.isFinite(maxRadius)) {
    throw new RangeError('Centro o raggio di copertura non validi');
  }
  if (count === 0) return emptyPlan(spacing);

  const radius = Math.max(
    spacing * 0.5,
    Math.min(Math.max(0, maxRadius), spacing * Math.sqrt(count / Math.PI)),
  );
  const spots: WorldSpot[] = [];
  let cells = 0;
  let blocked = 0;
  let near = 0;
  let far = 0;
  let triangles = 0;
  const nearRadius = Math.min(radius, spacing * 1.9);

  // `groundGridCells` include le celle il cui centro cade nel disco e le ordina
  // dal giocatore verso l'esterno: il budget taglia prima ciò che è lontano.
  for (const cell of groundGridCells(x, z, radius, spacing)) {
    if (spots.length >= count) break;
    cells++;
    let px = cell.x;
    let pz = cell.z;
    let cellSeed = hash2(px + seed * 7.1, pz - seed * 3.7);
    let slope = terrainSlopeAt(heightAt, px, pz);
    let choice = variantAt(px, pz, cellSeed, slope.degrees);
    if (!choice) {
      // Centro occupato da casa o carreggiata: si prova a scivolare dentro la
      // cella invece di lasciare un buco di 16 m nel suolo del paese.
      for (const [dx, dz] of NUDGES) {
        const nx = cell.x + dx * spacing;
        const nz = cell.z + dz * spacing;
        const nseed = hash2(nx + seed * 7.1, nz - seed * 3.7);
        const nslope = terrainSlopeAt(heightAt, nx, nz);
        const nchoice = variantAt(nx, nz, nseed, nslope.degrees);
        if (!nchoice) continue;
        px = nx;
        pz = nz;
        cellSeed = nseed;
        slope = nslope;
        choice = nchoice;
        break;
      }
    }
    if (!choice) {
      blocked++;
      continue;
    }
    const footprint = Math.max(0.5, choice.asset.footprint);
    // Sovrapposizione del 16%: con l'8% bastava una pendenza o un bordo di
    // zolla inclinato perché si aprisse una fessura da cui si vedeva il
    // mosaico satellite. Le zolle si accavallano, il suolo resta continuo.
    const scale = clamp((spacing * 1.16) / footprint, 1, 2.6) * (choice.scale ?? 1);
    const distance = Math.hypot(px - x, pz - z);
    const lod = distance <= nearRadius ? 1 : 2;
    // Quota dal centro (la zolla è già inclinata col gradiente locale) ma con
    // un sollevamento minimo: appoggiata più in alto, sugli dossi gli angoli
    // restano sospesi e da sotto si vede il mosaico satellite.
    spots.push({
      x: px,
      y: heightAt(px, pz) + lift,
      z: pz,
      yaw: choice.yaw ?? (cellSeed < 0.5 ? 0 : Math.PI / 2),
      slopeX: slope.x,
      slopeZ: slope.z,
      scale,
      variant: choice.asset.variant,
      lod,
    });
    if (lod === 1) near++;
    else far++;
    triangles += choice.asset.triangles;
  }

  const plantable = cells - blocked;
  return {
    spots,
    spacing,
    radius,
    cells,
    blocked,
    coverage: plantable > 0 ? spots.length / plantable : 1,
    fill: cells > 0 ? spots.length / cells : 0,
    near,
    far,
    triangles,
  };
}

/**
 * Soglia del dettaglio piccolo: oltre questa distanza la fotogrammetria da 5 m
 * non aggiunge nulla che si veda, quindi si tengono solo le zolle grandi.
 */
export function detailRadiusFor(budget: number, spacing: number): number {
  const count = Math.max(0, Math.floor(budget));
  if (count === 0 || !(spacing > 0)) return 0;
  // il dettaglio vicino resta entro ~24 m: è l'area in cui si distinguono i
  // fili d'erba e le impronte, non un secondo strato su tutto il campo
  return Math.min(24, spacing * Math.sqrt(count / Math.PI));
}

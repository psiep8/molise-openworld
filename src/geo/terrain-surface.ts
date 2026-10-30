import { CHUNK_SIZE, TERRAIN_SEGMENTS } from '../config';
import type { Heightfield } from './elevation';

/**
 * Quota della superficie del terreno **disegnata**.
 *
 * Il terreno non è il DEM: è una mesh di triangoli con passo
 * `CHUNK_SIZE / TERRAIN_SEGMENTS` (9,5 m). Fra un vertice e l'altro la
 * superficie è lineare, mentre `heightAt` interpola bilinearmente il DEM a
 * 5 m: sono due superfici diverse.
 *
 * Usare il DEM per la strada e la mesh per il prato significava che, in un
 * avvallamento o su un crinale, la mesh del terreno scavalcava il nastro
 * d'asfalto e la foto satellitare (verde) restava sopra la carreggiata. Il
 * nastro e la fisica leggono ora questa funzione, quindi l'asfalto sta sempre
 * `lift` metri sopra ciò che si vede.
 */
export const TERRAIN_MESH_STEP = CHUNK_SIZE / TERRAIN_SEGMENTS;

/**
 * Superficie del terreno visibile, campionabile senza allocazioni.
 *
 * La usano le strade (che la interrogano milioni di volte: qui c'è una cache
 * dei vertici della mesh) e la fisica (un punto per volta, senza cache).
 */
export interface TerrainSurface {
  heightAt(x: number, z: number): number;
  normalAt(x: number, z: number, eps?: number): { x: number; y: number; z: number };
}

/** Chiavi della cache dei vertici: coordinate di griglia con segno. */
const GRID_OFFSET = 1 << 16;
const GRID_STRIDE = 1 << 18;

/** Quanti vertici tenere: oltre, si riparte (le strade restano locali). */
const CACHE_LIMIT = 150_000;

/**
 * Quota della mesh del terreno in (x, z).
 *
 * I vertici della mesh stanno sulla griglia globale di passo 9,5 m (i chunk
 * sono allineati a multipli di `CHUNK_SIZE`), quindi basta la parte intera di
 * `x / passo`. Ogni cella è divisa dalla diagonale che va da (i, j+1) a
 * (i+1, j), cioè `fx + fz = 1`: è la triangolazione di `PlaneGeometry` dopo la
 * rotazione su X.
 */
export function terrainMeshHeightAt(
  heights: Heightfield,
  x: number,
  z: number,
  cache?: Map<number, number>,
): number {
  if (!Number.isFinite(x) || !Number.isFinite(z)) {
    throw new Error(`terrainMeshHeightAt: coordinate non finite (${x}, ${z})`);
  }
  const gx = x / TERRAIN_MESH_STEP;
  const gz = z / TERRAIN_MESH_STEP;
  const i = Math.floor(gx);
  const j = Math.floor(gz);
  const fx = gx - i;
  const fz = gz - j;

  const h00 = vertexHeight(heights, i, j, cache);
  const h10 = vertexHeight(heights, i + 1, j, cache);
  const h01 = vertexHeight(heights, i, j + 1, cache);
  if (fx + fz <= 1) return h00 + (h10 - h00) * fx + (h01 - h00) * fz;
  const h11 = vertexHeight(heights, i + 1, j + 1, cache);
  return h11 + (h01 - h11) * (1 - fx) + (h10 - h11) * (1 - fz);
}

function vertexHeight(
  heights: Heightfield,
  i: number,
  j: number,
  cache?: Map<number, number>,
): number {
  const x = i * TERRAIN_MESH_STEP;
  const z = j * TERRAIN_MESH_STEP;
  if (!cache) return heights.heightAt(x, z);
  if (i + GRID_OFFSET < 0 || j + GRID_OFFSET < 0) return heights.heightAt(x, z);
  const key = (i + GRID_OFFSET) * GRID_STRIDE + (j + GRID_OFFSET);
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  const value = heights.heightAt(x, z);
  if (cache.size >= CACHE_LIMIT) cache.clear();
  cache.set(key, value);
  return value;
}

/**
 * Campionatore della superficie visibile con cache dei vertici.
 *
 * Un nastro da 6 m tocca gli stessi quattro vertici della mesh per cinque
 * colonne di fila: senza cache ogni vertice costava quattro `heightAt`, con la
 * cache una volta sola. È la differenza fra qualche secondo e qualche decimo
 * nel disegno di tutte le strade.
 */
export function createTerrainSurface(heights: Heightfield): TerrainSurface {
  const cache = new Map<number, number>();
  return {
    heightAt(x: number, z: number): number {
      return terrainMeshHeightAt(heights, x, z, cache);
    },
    normalAt(x: number, z: number, eps = 4): { x: number; y: number; z: number } {
      const hL = terrainMeshHeightAt(heights, x - eps, z, cache);
      const hR = terrainMeshHeightAt(heights, x + eps, z, cache);
      const hU = terrainMeshHeightAt(heights, x, z - eps, cache);
      const hD = terrainMeshHeightAt(heights, x, z + eps, cache);
      return { x: hL - hR, y: 2 * eps, z: hU - hD };
    },
  };
}

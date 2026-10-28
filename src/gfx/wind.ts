import * as THREE from 'three';

/**
 * Registro condiviso per le animazioni di superficie che girano ogni frame:
 *
 *  - il **vento** (ciuffi d'erba e foglie delle chiome): uno uniform `uTime`
 *    comune a tutti i materiali che se ne servono in `onBeforeCompile`;
 *  - lo **scorrimento** delle normali dell'acqua: offset UV che avanzano nel
 *    tempo su texture dedicate (mai su quelle condivise con altri materiali).
 *
 * Un solo punto di aggiornamento, chiamato dal loop di gioco.
 */
interface Swayer {
  uTime: THREE.IUniform<number>;
  uWind: THREE.IUniform<THREE.Vector2>;
}

interface Roller {
  texture: THREE.Texture;
  speedU: number;
  speedV: number;
}

const swayers: Swayer[] = [];
const rollers: Roller[] = [];
const wind: THREE.IUniform<THREE.Vector2> = { value: new THREE.Vector2(0, 0) };
let elapsed = 0;

/** Uniform condivisi da assegnare agli shader delle piante mosse dal vento. */
export function windUniforms(): { uTime: THREE.IUniform<number>; uWind: THREE.IUniform<THREE.Vector2> } {
  const uTime: THREE.IUniform<number> = { value: 0 };
  swayers.push({ uTime, uWind: wind });
  return { uTime, uWind: wind };
}

/** Aggiorna intensità e direzione in base al vento reale (velocità in km/h). */
export function setWind(speedKmh: number, directionDegrees: number): void {
  if (!Number.isFinite(speedKmh) || !Number.isFinite(directionDegrees)) {
    throw new Error('Velocità e direzione del vento devono essere numeri finiti');
  }
  const strength = Math.min(2.4, Math.max(0, speedKmh) / 30);
  const direction = (directionDegrees * Math.PI) / 180;
  wind.value.set(-Math.sin(direction) * strength, -Math.cos(direction) * strength);
}

/**
 * Tempo condiviso delle animazioni di vento, in secondi. Serve a chi deve
 * datare un evento nello stesso orologio degli shader (per esempio l'urto di
 * un cartello: `uTime` del vertice parte da qui).
 */
export function windTime(): number {
  return elapsed;
}

/** Fa scorrere una texture (normali dell'acqua) a velocità costante, in UV/secondo. */
export function registerScroll(texture: THREE.Texture, speedU: number, speedV: number): void {
  rollers.push({ texture, speedU, speedV });
}

/** Da chiamare una volta per frame. */
export function updateWind(dt: number): void {
  elapsed += dt;
  for (const swayer of swayers) swayer.uTime.value = elapsed;
  for (const roller of rollers) {
    if (roller.speedU !== 0) {
      roller.texture.offset.x = (roller.texture.offset.x + roller.speedU * dt) % 1;
    }
    if (roller.speedV !== 0) {
      roller.texture.offset.y = (roller.texture.offset.y + roller.speedV * dt) % 1;
    }
  }
}

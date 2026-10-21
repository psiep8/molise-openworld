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
}

interface Roller {
  texture: THREE.Texture;
  speedU: number;
  speedV: number;
}

const swayers: Swayer[] = [];
const rollers: Roller[] = [];
let elapsed = 0;

/** Uniform del tempo da passare a `shader.uniforms.uTime` in onBeforeCompile. */
export function windTimeUniform(): THREE.IUniform<number> {
  const uTime: THREE.IUniform<number> = { value: 0 };
  swayers.push({ uTime });
  return uTime;
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

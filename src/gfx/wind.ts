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

/** Passaggio dell'auto: l'erba e i cespugli si piegano senza collisioni. */
const carPos: THREE.IUniform<THREE.Vector2> = { value: new THREE.Vector2(1e6, 1e6) };
const carVelocity: THREE.IUniform<THREE.Vector2> = { value: new THREE.Vector2() };
const carSpeed: THREE.IUniform<number> = { value: 0 };

export function vehiclePassUniforms(): {
  uCarPos: THREE.IUniform<THREE.Vector2>;
  uCarVel: THREE.IUniform<THREE.Vector2>;
  uCarSpeed: THREE.IUniform<number>;
} {
  return { uCarPos: carPos, uCarVel: carVelocity, uCarSpeed: carSpeed };
}

/** Aggiornato una volta per frame dal gioco, prima dei campi di vegetazione. */
export function setVehiclePass(x: number, z: number, vx: number, vz: number, speed: number): void {
  carPos.value.set(x, z);
  carVelocity.value.set(vx, vz);
  carSpeed.value = Math.max(0, speed);
}

/**
 * Pezzo di vertex shader condiviso: allontana i vertici dalla sagoma dell'auto.
 * `origin` è la posizione dell'istanza, `bend` il peso 0…1 sulla punta,
 * `height` l'altezza in metri della pianta.
 */
export function vehiclePassSnippet(origin: string, bend: string, height: string): string {
  return `
        vec2 vpDelta = ${origin}.xz - uCarPos;
        float vpSpeed = length( uCarVel );
        // rettangolo dell'auto (2,45 × 1,10 m) orientato sulla direzione di
        // marcia: il cerchietto da 2,6 m lasciava i fili sotto i paraurti
        vec2 vpForward = vpSpeed > 0.15 ? uCarVel / vpSpeed : vec2( 0.0, 1.0 );
        vec2 vpSide = vec2( -vpForward.y, vpForward.x );
        float vpAlong = abs( dot( vpDelta, vpForward ) );
        float vpAcross = abs( dot( vpDelta, vpSide ) );
        float vpOutside = max( max( vpAlong - 2.45, vpAcross - 1.10 ), 0.0 );
        float vpInside = 1.0 - smoothstep( 0.0, 0.6, vpOutside );
        // sotto la scocca l'erba si sdraia anche ad auto ferma: era il filo
        // che bucava paraurti e cofano da fermi
        transformed.y *= mix( 1.0, 0.16, vpInside );
        float vpMotion = smoothstep( 0.05, 0.8, vpSpeed );
        vec2 vpDirection = vpDelta / max( 0.001, length( vpDelta ) );
        float vpAmplitude = vpInside * ( 0.16 + 0.5 * vpMotion ) * ${height} * ( 0.35 + 0.65 * ${bend} );
        transformed.x += vpDirection.x * vpAmplitude;
        transformed.z += vpDirection.y * vpAmplitude;`;
}

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

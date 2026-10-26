/**
 * Vernice delle auto, anche per i modelli GLB.
 *
 * I GLB arrivano da editor e showroom diversi, quindi la carrozzeria non ha una
 * convenzione unica: c'è `carpaint`, `Body_Color`, `M_CarPaint_NoRV1`,
 * `punto-body`, `Body Paint`… e in alcuni modelli un unico atlante chiamato
 * `_BodySG` che copre scocca e cerchi. Questo modulo:
 *
 * 1. **riconosce** i materiali che sono vernice (per nome, con un ripiego per
 *    area quando il modello ha un solo materiale dominante);
 * 2. **porta la vernice a vernice vera**: clearcoat, rugosità e metallo da
 *    carrozzeria, invece dei valori da editor (il DafDefender esportato a
 *    roughness 0,98 sembrava plastica opaca);
 * 3. **abbassa la saturazione dell'albedo** con un'uniform condivisa, così i
 *    rossi da fiammifero e i blu da caramella dei GLB tornano colori da auto.
 *    È un ritocco al solo materiale della carrozzeria, non alla scena.
 */

import * as THREE from 'three';
import { clamp } from '../geo/geo';

/** Nomi che indicano la carrozzeria dipinta. */
const PAINT_NAME =
  /(carpaint|car[_ -]?paint|body ?paint|body[ _-]?colou?r|bodycolor|punto-body|carrozzeria|paintwork)/i;

/** Materiali che non sono mai carrozzeria, anche se il nome contiene "body". */
const NOT_PAINT =
  /(glass|window|windshield|vetro|cristallo|lunotto|lens|light|luce|emit|plate|targa|tire|tyre|rubber|pneumatic|gomma|rim\b|cerch|wheel|ruota|brake|freno|interior|interno|leather|pelle|seat|sedile|carpet|tappet|chrome|crom|metal|steel|alloy|trim|grill|caliper|pinza|logo|badge|mirror|specchietto|plastic|plastica|underside|chassis|telaio|shadow|ombra)/i;

/** Vero se il nome del materiale è carrozzeria dipinta. */
export function isPaintMaterial(name: string | null | undefined): boolean {
  if (!name) return false;
  if (NOT_PAINT.test(name)) return false;
  return PAINT_NAME.test(name);
}

export interface PaintCandidate {
  name: string;
  /** triangoli della mesh (o delle mesh) che usano il materiale */
  triangles: number;
}

/**
 * Sceglie i materiali di carrozzeria. Prima per nome; se il modello è un
 * atlante unico (`_BodySG` dell'Aventador) si prende il materiale dominante per
 * area, purché copra almeno un terzo della scena e il modello non abbia
 * un'infinità di materiali (segno che è un modello dettagliato per parti, dove
 * il ripiego indovinerebbe a caso).
 */
export function choosePaintMaterials(candidates: readonly PaintCandidate[]): number[] {
  const named: number[] = [];
  candidates.forEach((candidate, index) => {
    if (isPaintMaterial(candidate.name)) named.push(index);
  });
  if (named.length > 0) return named;

  if (candidates.length === 0 || candidates.length > 6) return [];
  const plausible = candidates
    .map((candidate, index) => ({ candidate, index }))
    .filter(({ candidate }) => candidate.name === '' || !NOT_PAINT.test(candidate.name));
  if (plausible.length === 0) return [];
  const total = candidates.reduce((sum, candidate) => sum + Math.max(1, candidate.triangles), 0);
  const best = plausible.reduce((a, b) => (b.candidate.triangles > a.candidate.triangles ? b : a));
  return best.candidate.triangles / total >= 0.35 ? [best.index] : [];
}

const STORAGE_KEY = 'molise.paint.saturation';
/** 0,7 toglie il "rosso fiammifero" senza spegnere il colore. */
const DEFAULT_SATURATION = 0.7;

function readStored(): number | null {
  try {
    if (typeof window === 'undefined') return null;
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const value = Number(raw);
    return Number.isFinite(value) ? clamp(value, 0.35, 1) : null;
  } catch {
    return null;
  }
}

/** Uniform condivisa da tutti i materiali verniciati: un solo valore da cambiare. */
export const paintSaturation: { value: number } = { value: readStored() ?? DEFAULT_SATURATION };

export function loadPaintSaturation(): number {
  return readStored() ?? DEFAULT_SATURATION;
}

/** Imposta (e salva) la saturazione della vernice, 0,35–1. */
export function setPaintSaturation(value: number): number {
  const next = Number.isFinite(value) ? clamp(value, 0.35, 1) : paintSaturation.value;
  paintSaturation.value = next;
  try {
    if (typeof window !== 'undefined') window.localStorage.setItem(STORAGE_KEY, String(next));
  } catch {
    // localStorage può essere disabilitato: il valore vale per la sessione
  }
  return next;
}

/**
 * Inserisce il ritocco di saturazione nello shader del materiale.
 *
 * Si agisce dopo `map_fragment`, cioè sull'albedo (colore × texture) e prima
 * della luce: così si desatura la vernice, non i riflessi del cielo. La stessa
 * uniform vale per tutti i materiali verniciati, quindi si aggiorna una volta
 * sola dal menu Impostazioni.
 *
 * Per i modelli con il colore cotto nella texture (l'Audi ha una mappa blu, il
 * Defender grigio-verde) il colore del materiale non basta: moltiplicare una
 * tinta rossa per una mappa blu dà nero. Con `uPaintTintOn` l'albedo diventa
 * **tinta × luminanza** della texture, quindi il dettaglio (macchie, riflessi
 * del clearcoat) resta e il colore è quello scelto.
 */
export function applyPaintFinish(material: THREE.MeshStandardMaterial): void {
  if (material.userData.paintFinish === true) return;
  material.userData.paintFinish = true;
  const tint = { value: new THREE.Color(0x000000) };
  const tintOn = { value: 0 };
  material.userData.paintTint = tint;
  material.userData.paintTintOn = tintOn;
  const previous = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    previous?.call(material, shader, renderer);
    shader.uniforms.uPaintSaturation = paintSaturation as THREE.IUniform<number>;
    shader.uniforms.uPaintTint = tint as THREE.IUniform<THREE.Color>;
    shader.uniforms.uPaintTintOn = tintOn as THREE.IUniform<number>;
    shader.fragmentShader = shader.fragmentShader
      .replace(
        'void main() {',
        'uniform float uPaintSaturation;\nuniform vec3 uPaintTint;\nuniform float uPaintTintOn;\nvoid main() {',
      )
      .replace(
        '#include <map_fragment>',
        [
          '#include <map_fragment>',
          "  // vernice: l'albedo della texture resta come dettaglio, il colore no",
          '  float paintLuma = dot( diffuseColor.rgb, vec3( 0.2126, 0.7152, 0.0722 ) );',
          '  vec3 paintTinted = uPaintTint * clamp( 0.55 + 1.6 * paintLuma, 0.45, 1.25 );',
          '  diffuseColor.rgb = mix( diffuseColor.rgb, paintTinted, uPaintTintOn );',
          "  // saturazione: si abbassa quella della carrozzeria, non dell'intera scena",
          '  paintLuma = dot( diffuseColor.rgb, vec3( 0.2126, 0.7152, 0.0722 ) );',
          '  diffuseColor.rgb = mix( vec3( paintLuma ), diffuseColor.rgb, uPaintSaturation );',
        ].join('\n'),
      );
  };
  material.needsUpdate = true;
}

/**
 * Applica la tinta scelta alla carrozzeria di un GLB.
 *
 * - vernice senza texture (Ferrari, Punto): basta il colore del materiale;
 * - vernice con il colore nella texture (Audi, Defender): la si sostituisce
 *   nello shader, altrimenti si otterrebbe tinta × mappa = nero.
 */
export function tintPaint(material: THREE.MeshStandardMaterial, color: number): void {
  if (!material.map) {
    material.color.setHex(color);
    material.needsUpdate = true;
    return;
  }
  const tint = material.userData.paintTint as THREE.IUniform<THREE.Color> | undefined;
  const tintOn = material.userData.paintTintOn as THREE.IUniform<number> | undefined;
  if (!tint || !tintOn) return;
  (tint.value as THREE.Color).setHex(color);
  tintOn.value = 1;
}

/**
 * Da materiale Standard a vernice fisica: clearcoat, riflessi stretti e
 * rugosità da carrozzeria. Se il GLB porta già una mappa di rugosità la si
 * rispetta (è informazione dell'autore), ma si tolgono gli estremi da editor.
 */
export function paintMaterialFrom(source: THREE.MeshStandardMaterial): THREE.MeshPhysicalMaterial {
  const paint = new THREE.MeshPhysicalMaterial();
  const alreadyPhysical = (source as unknown as { isMeshPhysicalMaterial?: boolean }).isMeshPhysicalMaterial === true;
  if (alreadyPhysical) {
    // il GLB usava già KHR_materials_clearcoat/sheen: si tengono quei dati
    paint.copy(source as THREE.MeshPhysicalMaterial);
  } else {
    // `MeshPhysicalMaterial.copy` non accetta un materiale Standard come
    // sorgente (legge `clearcoatNormalScale`, che lì non esiste): si copia lo
    // strato Standard con la sua stessa implementazione e lo si completa qui.
    const copyStandard = THREE.MeshStandardMaterial.prototype.copy as unknown as (
      this: THREE.MeshPhysicalMaterial,
      source: THREE.MeshStandardMaterial,
    ) => THREE.MeshPhysicalMaterial;
    copyStandard.call(paint, source);
  }
  paint.name = source.name;
  // La carrozzeria di un GLB da showroom è spesso metalness 0,9 con roughness
  // 0,1: in gioco diventa uno specchio che rimanda il cielo come una macchia
  // bianca. La vernice stradale è dielettrica, il riflesso lo dà il clearcoat.
  if (!source.roughnessMap) {
    paint.roughness = 0.45;
    paint.metalness = clamp(source.metalness, 0.04, 0.28);
  } else {
    paint.roughness = clamp(source.roughness, 0.3, 0.72);
    paint.metalness = clamp(source.metalness, 0.04, 0.35);
  }
  paint.clearcoat = 1;
  paint.clearcoatRoughness = 0.16;
  // il boost dell'ambiente arriva da `Vehicle.setEnvironment`: qui si parte
  // da un valore basso, così nemmeno un GLB con envMapIntensity 3 acceca
  paint.envMapIntensity = Math.min(paint.envMapIntensity ?? 1, 1);
  applyPaintFinish(paint);
  paint.needsUpdate = true;
  return paint;
}

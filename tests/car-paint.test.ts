import * as THREE from 'three';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  applyPaintFinish,
  choosePaintMaterials,
  isPaintMaterial,
  loadPaintSaturation,
  paintMaterialFrom,
  paintSaturation,
  setPaintSaturation,
  tintPaint,
} from '../src/gfx/car-paint';

/** Nomi presi davvero dai GLB in `public/cars/` (glTF, non inventati). */
const GLB_PAINT = [
  'car_Audi_R8_Coupe_Performance_quattro_2023_carpaint',
  'M_CarPaint_NoRV_singleSided',
  'M_CarPaint_NoRV_singleSided1',
  'M_CarPaint_NoRV1',
  'M_CarPaint_NoRV2',
  'M_CarPaint_NoRV3',
  'Body_Color',
  'Body Paint',
  'punto-body',
];

const GLB_NOT_PAINT = [
  'M_Glass_WindowsSimple1',
  'shared_tires_lowprofile',
  'shared_calipers_01',
  'shared_licenseplate',
  'M_LightsRed',
  'M_LightsWhite',
  'punto-chrome',
  'punto-tire',
  'punto-glass',
  'Tire',
  'Rim',
  'car_Audi_R8_Coupe_Performance_quattro_glass',
  'M_578_858_366______TRIM_tags1_SingleMaterial',
];

describe('riconoscimento della vernice nei GLB', () => {
  it('riconosce i materiali di carrozzeria dei sei modelli', () => {
    for (const name of GLB_PAINT) expect(isPaintMaterial(name), name).toBe(true);
  });

  it('non scambia vetri, gomme, cromature e luci per carrozzeria', () => {
    for (const name of GLB_NOT_PAINT) expect(isPaintMaterial(name), name).toBe(false);
  });

  it('senza nome non indovina', () => {
    expect(isPaintMaterial('')).toBe(false);
    expect(isPaintMaterial(null)).toBe(false);
  });
});

describe('scelta dei materiali da verniciare', () => {
  it('prende tutti i materiali con nome di carrozzeria (Cupra: cinque varianti)', () => {
    const chosen = choosePaintMaterials([
      { name: 'M_CarPaint_NoRV_singleSided', triangles: 12_000 },
      { name: 'M_Glass_WindowsSimple1', triangles: 900 },
      { name: 'M_CarPaint_NoRV1', triangles: 4_000 },
      { name: 'M_Metal_NoRV', triangles: 2_000 },
    ]);
    expect(chosen).toEqual([0, 2]);
  });

  it('ripiega sul materiale dominante quando il modello ha un atlante unico (Aventador)', () => {
    const chosen = choosePaintMaterials([
      { name: '_Lamborghini_AventadorLamborghini_Aventador_BodySG', triangles: 60_000 },
      { name: '_Lamborghini_AventadorLamborghini_Aventador_GlassSG', triangles: 2_000 },
    ]);
    expect(chosen).toEqual([0]);
  });

  it('non ripiega su modelli scomposti per parti: meglio nessuna tinta che una sbagliata', () => {
    const parts = Array.from({ length: 9 }, (_, i) => ({
      name: `GENGP${i}`,
      triangles: 1_000,
    }));
    expect(choosePaintMaterials(parts)).toEqual([]);
  });

  it('non ripiega se il materiale dominante è troppo piccolo per essere la scocca', () => {
    expect(
      choosePaintMaterials([
        { name: 'GENGA', triangles: 320 },
        { name: 'GENGB', triangles: 340 },
        { name: 'GENGC', triangles: 340 },
      ]),
    ).toEqual([]);
  });

  it('un modello senza materiali resta com’è', () => {
    expect(choosePaintMaterials([])).toEqual([]);
  });
});

describe('saturazione della vernice', () => {
  let stored: Record<string, string> = {};

  beforeEach(() => {
    stored = {};
    vi.stubGlobal('window', {
      localStorage: {
        getItem: (key: string) => stored[key] ?? null,
        setItem: (key: string, value: string) => {
          stored[key] = value;
        },
      },
    });
  });

  it('parte dall’82%: il rosso da auto, non da fiammifero', () => {
    expect(loadPaintSaturation()).toBeCloseTo(0.82, 5);
  });

  it('accetta il valore scelto dalle impostazioni e lo salva', () => {
    expect(setPaintSaturation(0.6)).toBeCloseTo(0.6, 5);
    expect(paintSaturation.value).toBeCloseTo(0.6, 5);
    expect(loadPaintSaturation()).toBeCloseTo(0.6, 5);
    expect(stored['molise.paint.saturation']).toBe('0.6');
  });

  it('tiene il valore dentro i limiti utili (35–100%)', () => {
    expect(setPaintSaturation(0.05)).toBeCloseTo(0.35, 5);
    expect(setPaintSaturation(4)).toBeCloseTo(1, 5);
    // un valore non numerico non deve azzerare la vernice scelta
    expect(setPaintSaturation(Number.NaN)).toBeCloseTo(1, 5);
  });
});

describe('finitura della vernice', () => {
  it('porta un materiale da editor a clearcoat da carrozzeria', () => {
    const source = new THREE.MeshStandardMaterial({
      name: 'Body Paint',
      color: 0xff0000,
      roughness: 0.98,
      metalness: 0,
    });
    const paint = paintMaterialFrom(source);
    expect(paint.clearcoat).toBe(1);
    expect(paint.clearcoatRoughness).toBeLessThan(0.1);
    expect(paint.roughness).toBeCloseTo(0.32, 5);
    expect(paint.metalness).toBeGreaterThanOrEqual(0.25);
    expect(paint.color.getHex()).toBe(0xff0000);
    expect(paint).not.toBe(source);
  });

  it('tiene il clearcoat già dichiarato dal GLB (KHR_materials_clearcoat)', () => {
    const source = new THREE.MeshPhysicalMaterial({
      name: 'car paint',
      color: 0x204080,
      clearcoat: 0.4,
      clearcoatRoughness: 0.2,
    });
    const paint = paintMaterialFrom(source);
    // la vernice del gioco porta il clearcoat a 1, ma non perde gli altri dati
    expect(paint.clearcoat).toBe(1);
    expect(paint.color.getHex()).toBe(0x204080);
    expect(paint.userData.paintFinish).toBe(true);
  });

  it('desatura l’albedo nello shader, non i riflessi', () => {
    const paint = paintMaterialFrom(new THREE.MeshStandardMaterial({ color: 0xff0000 }));
    const shader = {
      uniforms: {} as Record<string, THREE.IUniform>,
      vertexShader: 'void main() { gl_Position = vec4(0.0); }',
      fragmentShader: '#include <common>\nvoid main() {\n#include <map_fragment>\n}',
    };
    paint.onBeforeCompile(
      shader as unknown as THREE.WebGLProgramParametersWithUniforms,
      null as unknown as THREE.WebGLRenderer,
    );
    expect(shader.uniforms.uPaintSaturation).toBe(paintSaturation);
    expect(shader.fragmentShader).toContain('uniform float uPaintSaturation;');
    expect(shader.fragmentShader).toContain('mix( vec3( paintLuma ), diffuseColor.rgb, uPaintSaturation )');
    // la tinta nello shader: serve ai modelli con il colore cotto nella texture
    expect(shader.uniforms.uPaintTint).toBeDefined();
    expect(shader.uniforms.uPaintTintOn).toBeDefined();
    expect(shader.fragmentShader).toContain('uniform vec3 uPaintTint;');
    expect(shader.fragmentShader).toContain('mix( diffuseColor.rgb, paintTinted, uPaintTintOn )');
  });

  it('tinge col colore del materiale quando non c’è texture (Ferrari, Punto)', () => {
    const paint = paintMaterialFrom(new THREE.MeshStandardMaterial({ color: 0xcd262e }));
    tintPaint(paint, 0x1f4f8a);
    expect(paint.color.getHex()).toBe(0x1f4f8a);
    expect(paint.userData.paintTintOn.value).toBe(0);
  });

  it('tinge nello shader quando il colore è nella texture (Audi blu, Defender grigio)', () => {
    const map = new THREE.Texture();
    const paint = paintMaterialFrom(new THREE.MeshStandardMaterial({ color: 0x0000ff, map }));
    tintPaint(paint, 0xa6332c);
    // il materiale resta com’è: la moltiplicazione colore × mappa darebbe nero
    expect(paint.color.getHex()).toBe(0x0000ff);
    expect(paint.userData.paintTintOn.value).toBe(1);
    expect((paint.userData.paintTint.value as THREE.Color).getHex()).toBe(0xa6332c);
  });

  it('non applica la finitura due volte allo stesso materiale', () => {
    const paint = paintMaterialFrom(new THREE.MeshStandardMaterial({ color: 0x00ff00 }));
    const before = paint.onBeforeCompile;
    applyPaintFinish(paint);
    expect(paint.onBeforeCompile).toBe(before);
    expect(paint.userData.paintFinish).toBe(true);
  });
});

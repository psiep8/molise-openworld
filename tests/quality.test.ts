import { describe, expect, it } from 'vitest';
import {
  QUALITY_ORDER,
  QUALITY_PRESETS,
  classifyQuality,
  isQualityLevel,
  nextQuality,
  type QualityLevel,
} from '../src/gfx/quality';

describe('preset grafici', () => {
  it('ha un preset per ogni livello, con il livello giusto dentro', () => {
    for (const level of QUALITY_ORDER) {
      expect(QUALITY_PRESETS[level].level).toBe(level);
      expect(QUALITY_PRESETS[level].label.length).toBeGreaterThan(2);
    }
  });

  it('scende di costo dal minimo all’ultra', () => {
    const ordered = QUALITY_ORDER.map((level) => QUALITY_PRESETS[level]);
    for (let i = 1; i < ordered.length; i++) {
      const small = ordered[i - 1]!;
      const big = ordered[i]!;
      expect(big.trees).toBeGreaterThanOrEqual(small.trees);
      expect(big.grassDensity).toBeGreaterThanOrEqual(small.grassDensity);
      expect(big.pedestrians).toBeGreaterThanOrEqual(small.pedestrians);
      expect(big.viewRadius).toBeGreaterThanOrEqual(small.viewRadius);
      expect(big.pixelRatio).toBeGreaterThanOrEqual(small.pixelRatio);
      expect(big.shadowMapSize).toBeGreaterThanOrEqual(small.shadowMapSize);
      expect(big.pointLights).toBeGreaterThanOrEqual(small.pointLights);
      // una volta arrivato il dettaglio pieno, i preset più alti lo tengono
      if (small.buildingDetail === 'full') expect(big.buildingDetail).toBe('full');
    }
  });

  it('il preset di compatibilità è quello che rinuncia a tutto', () => {
    const minimal = QUALITY_PRESETS.minimal;
    expect(minimal.post).toBe(false);
    expect(minimal.shadows).toBe(false);
    expect(minimal.antialias).toBe(false);
    expect(minimal.grassDensity).toBeGreaterThanOrEqual(QUALITY_PRESETS.low.grassDensity);
    expect(minimal.pedestrians).toBe(0);
    expect(minimal.kit).toBe(false);
    expect(minimal.weather).toBe('light');
    expect(minimal.buildingDetail).toBe('simple');
    expect(minimal.drainage).toBe(false);
    expect(minimal.trees).toBeGreaterThan(1000);
    expect(minimal.renderScaleFloor).toBeLessThan(QUALITY_PRESETS.ultra.renderScaleFloor);
    // la copertura del suolo costa campioni: sul preset di compatibilità è spenta
    expect(minimal.landcover).toBe('off');
    expect(minimal.landcoverRadius).toBe(0);
  });

  it('spegne lo streaming geografico sui preset leggeri', () => {
    expect(QUALITY_PRESETS.minimal.streamedWorld).toBe(false);
    expect(QUALITY_PRESETS.low.streamedWorld).toBe(false);
    for (const level of ['medium', 'high', 'ultra'] as const) {
      expect(QUALITY_PRESETS[level].streamedWorld).toBe(true);
    }
  });

  it('accende la copertura del suolo solo dove c’è margine', () => {
    expect(QUALITY_PRESETS.low.landcover).toBe('base');
    expect(QUALITY_PRESETS.low.landcoverRadius).toBe(0);
    for (const level of ['medium', 'high', 'ultra'] as const) {
      expect(QUALITY_PRESETS[level].landcover).toBe('full');
      expect(QUALITY_PRESETS[level].landcoverRadius).toBeGreaterThanOrEqual(1400);
    }
    // il raggio non scende mai salendo di preset
    expect(QUALITY_PRESETS.high.landcoverRadius).toBeGreaterThanOrEqual(QUALITY_PRESETS.medium.landcoverRadius);
    expect(QUALITY_PRESETS.ultra.landcoverRadius).toBeGreaterThanOrEqual(QUALITY_PRESETS.high.landcoverRadius);
  });

  it('il tasto G fa il giro completo e torna al minimo', () => {
    let level: QualityLevel = 'minimal';
    const seen: QualityLevel[] = [level];
    for (let i = 1; i < QUALITY_ORDER.length; i++) {
      level = nextQuality(level);
      seen.push(level);
    }
    expect(seen).toEqual([...QUALITY_ORDER]);
    expect(nextQuality(level)).toBe('minimal');
  });

  it('riconosce i livelli validi compreso minimal', () => {
    expect(isQualityLevel('minimal')).toBe(true);
    expect(isQualityLevel('low')).toBe(true);
    expect(isQualityLevel('ultra')).toBe(true);
    expect(isQualityLevel('potato')).toBe(false);
    expect(isQualityLevel(null)).toBe(false);
  });
});

describe('classifyQuality', () => {
  it('manda il rendering software al preset di compatibilità', () => {
    expect(classifyQuality({ renderer: 'ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)))', cores: 8, memory: 8 })).toBe('minimal');
    expect(classifyQuality({ renderer: 'llvmpipe (LLVM 15.0.7, 256 bits)', cores: 16, memory: 8 })).toBe('minimal');
    expect(classifyQuality({ renderer: 'Microsoft Basic Render Driver', cores: 8, memory: 8 })).toBe('minimal');
  });

  it('tratta le GPU integrate come macchine leggere', () => {
    expect(
      classifyQuality({ renderer: 'ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11 vs_5_0 ps_5_0)', cores: 4, memory: 8 }),
    ).toBe('low');
    expect(
      classifyQuality({ renderer: 'ANGLE (Intel, Intel(R) Iris(R) Xe Graphics Direct3D11 vs_5_0 ps_5_0)', cores: 8, memory: 8 }),
    ).toBe('medium');
  });

  it('non promette il preset alto a una CPU debole', () => {
    expect(classifyQuality({ renderer: '', cores: 2, memory: 8 })).toBe('minimal');
    expect(classifyQuality({ renderer: '', cores: 4, memory: 8 })).toBe('low');
    expect(classifyQuality({ renderer: '', cores: 4, memory: 4 })).toBe('low');
  });

  it('alza il preset solo su macchine con margine', () => {
    expect(
      classifyQuality({ renderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0)', cores: 12, memory: 8 }),
    ).toBe('high');
    expect(classifyQuality({ renderer: '', cores: 8, memory: 8 })).toBe('high');
    expect(classifyQuality({ renderer: '', cores: 8, memory: 4 })).toBe('low');
  });

  it('sui telefoni resta prudente', () => {
    expect(classifyQuality({ renderer: 'Adreno (TM) 640', cores: 8, memory: 6, mobile: true })).toBe('low');
    expect(classifyQuality({ renderer: 'Mali-G52', cores: 4, memory: 4, mobile: true })).toBe('minimal');
  });
});

describe('antialiasing nei preset', () => {
  it('chi ha la pipeline la usa per l’AA, non solo per il bloom', () => {
    for (const level of QUALITY_ORDER) {
      const preset = QUALITY_PRESETS[level];
      if (preset.postAA) {
        // con il post-processing si disegna su una texture: senza MSAA sui
        // target l'antialias del canvas non serve a niente
        expect(preset.msaaSamples).toBeGreaterThan(0);
        expect(preset.sharpen).toBeGreaterThan(0);
        expect(preset.antialias).toBe(true);
      }
    }
  });

  it('il preset di compatibilità resta senza MSAA', () => {
    expect(QUALITY_PRESETS.minimal.msaaSamples).toBe(0);
    expect(QUALITY_PRESETS.minimal.postAA).toBe(false);
  });

  it('non promette più pixel del necessario', () => {
    for (const level of QUALITY_ORDER) {
      const preset = QUALITY_PRESETS[level];
      expect(preset.pixelRatio).toBeLessThanOrEqual(2);
      expect(preset.sharpen).toBeLessThanOrEqual(0.5);
    }
  });
});

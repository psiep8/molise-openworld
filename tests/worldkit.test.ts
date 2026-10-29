import { existsSync, readFileSync, statSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * Il world kit è **versionato**: se il manifest e i GLB non tornano, ogni clone
 * e ogni build di produzione si rompono in un modo silenzioso (un albero che
 * non compare, una casa senza collisione). Questi test leggono i file veri.
 */

const ROOT = 'public/worldkit';
const manifest = JSON.parse(readFileSync(`${ROOT}/manifest.json`, 'utf8')) as {
  version: number;
  bytes: number;
  models: {
    slug: string;
    role: string;
    file: string;
    height: number;
    width: number;
    depth: number;
    triangles: number;
    bytes: number;
    usage: string;
    /** motivo della dismissione per `usage: "retired"` */
    retiredReason?: string;
    normalize?: 'height' | 'footprint';
    scaleTo?: number;
    nonCommercial?: boolean;
    hero?: boolean;
    credits: { title: string; author: string; license: string; source: string };
  }[];
};

const ROLES = new Set([
  'tree',
  'shrub',
  'tree-distant',
  'rock',
  'grass',
  'grass-hero',
  'sign',
  'house',
  'ground',
  'field',
  'bale',
  'village',
  'sidewalk',
  'curb',
  'guardrail',
  'streetlight',
  'bridge',
  'planter',
  'pathlight',
  'spare',
]);

/** Nessun file versionato può superare il limite per-file di GitHub. */
const MAX_FILE_BYTES = 95 * 1024 * 1024;

describe('worldkit manifest', () => {
  it('contiene modelli per tutti i ruoli piazzati', () => {
    const roles = new Set(manifest.models.map((model) => model.role));
    for (const role of [
      'tree',
      'shrub',
      'tree-distant',
      'rock',
      'grass',
      'grass-hero',
      'sign',
      'house',
      'ground',
      'field',
      'bale',
      'sidewalk',
      'curb',
      'guardrail',
      'streetlight',
      'bridge',
      'planter',
      'pathlight',
    ]) {
      expect(roles.has(role), `ruolo mancante: ${role}`).toBe(true);
    }
  });

  it('ha slug unici e file presenti', () => {
    const slugs = new Set<string>();
    for (const model of manifest.models) {
      expect(slugs.has(model.slug), `slug duplicato: ${model.slug}`).toBe(false);
      slugs.add(model.slug);
      const path = `${ROOT}/${model.file}`;
      expect(existsSync(path), `file mancante: ${model.file}`).toBe(true);
      const size = statSync(path).size;
      expect(size).toBe(model.bytes);
      expect(size).toBeLessThan(MAX_FILE_BYTES);
    }
  });

  it('dichiara ruoli validi, misure plausibili e geometria non vuota', () => {
    for (const model of manifest.models) {
      expect(ROLES.has(model.role), `ruolo sconosciuto: ${model.role}`).toBe(true);
      // le zolle fotogrammetriche possono essere piani perfetti (altezza 0):
      // è proprio per questo che si normalizzano sull'impronta orizzontale
      expect(model.height).toBeGreaterThanOrEqual(model.role === 'ground' ? 0 : 0.01);
      // le scene di villaggio sono grandi 150–170 m in orizzontale e possono
      // superare i 40 m in verticale; gli altri modelli restano molto sotto
      expect(model.height).toBeLessThan(model.role === 'village' ? 140 : 40);
      expect(model.width).toBeGreaterThanOrEqual(0);
      expect(model.depth).toBeGreaterThanOrEqual(0);
      expect(model.triangles).toBeGreaterThan(0);
      // i modelli piazzati devono restare leggeri perché sono istanziati a
      // centinaia; le riserve (scan di terreni) possono essere più pesanti ma
      // non vengono caricate all'avvio
      // gli asset `hero` sono fotogrammetrie di fili d'erba separati che
      // meshoptimizer non può ridurre: ne esiste al massimo un esemplare in
      // scena, quindi il budget è più alto ma resta sotto i 500k.
      const placedLimit = model.hero ? 500_000 : 100_000;
      expect(model.triangles).toBeLessThan(model.usage === 'placed' ? placedLimit : 700_000);
      expect(['placed', 'retired']).toContain(model.usage);
      // una riserva senza motivo esplicito tornerebbe un "lasciato lì" opaco
      if (model.usage === 'retired') {
        expect(model.retiredReason?.length ?? 0, `motivo mancante per ${model.slug}`).toBeGreaterThan(10);
      }
    }
  });

  it('non lascia riserve ambigue: ogni modello è piazzato o ritirato con motivo', () => {
    expect(manifest.models.some((model) => model.usage === 'reserve')).toBe(false);
  });

  it('normalizza le fotogrammetrie di terreno sull\'impronta, non sull\'altezza', () => {
    const ground = manifest.models.filter((model) => model.role === 'ground');
    expect(ground.length, 'nessuna zolla di terreno importata').toBeGreaterThan(0);
    for (const model of ground) {
      expect(model.normalize, `normalizzazione errata su ${model.slug}`).toBe('footprint');
      expect(model.scaleTo).toBeGreaterThan(1);
      expect(model.width).toBeGreaterThan(1);
      // un piano da 602 m non deve diventare largo chilometri
      expect(model.width).toBeLessThan(40);
      expect(model.depth).toBeLessThan(40);
    }
  });

  it('porta i crediti di ogni modello e licenze ridistribuibili', () => {
    for (const model of manifest.models) {
      const { title, author, license } = model.credits;
      expect(title.length, `titolo mancante per ${model.slug}`).toBeGreaterThan(0);
      expect(author.length, `autore mancante per ${model.slug}`).toBeGreaterThan(0);
      // niente Sketchfab Standard: quei file non possono stare nel repo
      expect(license, `licenza non ridistribuibile su ${model.slug}`).toMatch(/^CC-(BY|BY-SA|BY-NC)-4\.0$|^CC0/);
    }
  });

  it('resta sotto il budget di peso del repository', () => {
    expect(manifest.bytes).toBe(manifest.models.reduce((sum, model) => sum + model.bytes, 0));
    expect(manifest.bytes).toBeLessThan(90 * 1024 * 1024);
  });
});

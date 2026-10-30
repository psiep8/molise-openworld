import * as THREE from 'three';
import { mulberry32 } from '../geo/geo';

/**
 * Popolamento continuo a celle.
 *
 * Il dettaglio vicino (erba, grano) veniva ricostruito in blocco ogni 15-18 m:
 * una maschera rasterizzata su tutto il disco (70-90 ms), tre `InstancedMesh`
 * riallocati e riempiti a mano, poi il vecchio campo spariva e il nuovo
 * compariva di colpo. A 120 km/h succedeva ogni mezzo secondo: erano gli scatti
 * che si vedevano passando in campagna.
 *
 * Qui il disco è diviso in celle stabili (chiave `cx,cz` + seme deterministico)
 * e ogni cella possiede un intervallo di slot del proprio `InstancedMesh`.
 * Quando il giocatore si sposta:
 *
 *  - le celle che entrano vengono pianificate **dentro un budget di tempo per
 *    frame** (2-3 ms), in ordine di distanza dal punto previsto fra un secondo
 *    (quindi davanti all'auto si è già pronti);
 *  - le celle che escono dissolvono e restituiscono gli slot, senza toccare le
 *    altre;
 *  - i buffer si aggiornano per intervalli (`addUpdateRange`), non per intero.
 *
 * Il risultato è che non esiste più una soglia che fa "rifare tutto": il mondo
 * cresce e cala di continuo, e un hitch non blocca mai il frame.
 */

/** Fasce di distanza del dettaglio: 0-30, 30-60, 60-95, oltre. */
export const DETAIL_BANDS = [30, 60, 95] as const;
/** Isteresi in metri prima di rifare una cella per cambio di fascia. */
export const BAND_HYSTERESIS = 4;

/** Fascia di dettaglio per una data distanza dal giocatore. */
export function bandForDistance(distance: number): number {
  let band = 0;
  while (band < DETAIL_BANDS.length && distance >= DETAIL_BANDS[band]!) band++;
  return band;
}

/**
 * Seme stabile di una cella. Dipende solo da coordinate, fascia e seme del
 * campo: la stessa cella ha sempre la stessa vegetazione, in ogni sessione.
 */
export function cellSeed(cx: number, cz: number, band: number, seed: number): number {
  let hash = (seed ^ 0x9e3779b9) >>> 0;
  hash = Math.imul(hash ^ (cx | 0), 0x85ebca6b) >>> 0;
  hash = Math.imul(hash ^ (cz | 0), 0xc2b2ae35) >>> 0;
  hash = Math.imul(hash ^ (band | 0), 0x27d4eb2f) >>> 0;
  hash ^= hash >>> 15;
  return hash >>> 0;
}

/** Chiave numerica compatta per una cella (le coordinate stanno in ±2^15 celle). */
export function cellKeyOf(cx: number, cz: number): number {
  return (cx + 32768) * 65536 + (cz + 32768);
}

function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}

/** Frazione pseudo-casuale stabile di un intero (per il dissolve per istanza). */
function hashFraction(i: number): number {
  let h = Math.imul(i ^ 0x9e3779b9, 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  return (h >>> 8) / 16777216;
}

/** Cronometro tollerante agli ambienti senza `performance` (test Node). */
function clock(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

interface FreeRun {
  start: number;
  len: number;
}

/**
 * Distributore di intervalli di slot.
 *
 * Le celle occupano run contigui (una `addUpdateRange` per cella invece di una
 * per istanza). Alla liberazione i run si fondono con i vicini, così la
 * frammentazione non cresce e `highWater` resta vicino alle istanze davvero in
 * uso: `mesh.count` non disegna la coda mai occupata.
 */
export class SlotRuns {
  readonly capacity: number;
  highWater = 0;
  private readonly free: FreeRun[];

  constructor(capacity: number) {
    this.capacity = Math.max(0, Math.floor(capacity));
    this.free = this.capacity > 0 ? [{ start: 0, len: this.capacity }] : [];
  }

  /** Slot liberi (diagnostica e test). */
  freeSlots(): number {
    let total = 0;
    for (const run of this.free) total += run.len;
    return total;
  }

  /** Prenota `count` slot contigui, arrotondati ad `align`. */
  acquire(count: number, align = 8): { start: number; count: number } | null {
    if (count <= 0) return null;
    const want = Math.ceil(count / align) * align;
    let best = -1;
    let bestLen = Infinity;
    for (let i = 0; i < this.free.length; i++) {
      const len = this.free[i]!.len;
      if (len >= want && len < bestLen) {
        best = i;
        bestLen = len;
      }
    }
    if (best < 0) return null;
    const run = this.free[best]!;
    const start = run.start;
    if (run.len === want) this.free.splice(best, 1);
    else {
      run.start += want;
      run.len -= want;
    }
    if (start + want > this.highWater) this.highWater = start + want;
    return { start, count: want };
  }

  /** Restituisce uno slot run alla lista, fondendolo con i vicini. */
  release(start: number, count: number): void {
    if (count <= 0) return;
    let index = 0;
    while (index < this.free.length && this.free[index]!.start < start) index++;
    const before = this.free[index - 1];
    const after = this.free[index];
    const end = start + count;
    if (before && before.start + before.len === start) {
      before.len += count;
      if (after && before.start + before.len === after.start) {
        before.len += after.len;
        this.free.splice(index, 1);
      }
    } else if (after && end === after.start) {
      after.start = start;
      after.len += count;
    } else {
      this.free.splice(index, 0, { start, len: count });
    }
    // la coda libera non deve restare nella `count` della mesh
    const tail = this.free[this.free.length - 1];
    if (!tail) this.highWater = 0;
    else if (tail.start + tail.len >= this.highWater) this.highWater = tail.start;
  }
}

/** Un layer = una `InstancedMesh` alimentata dalle celle. */
export interface CellLayer {
  mesh: THREE.InstancedMesh;
  /** Tetto di istanze per cella: determina lo spazio riservato a ogni cella. */
  maxPerCell: number;
  /** Colore per istanza (`InstancedBufferAttribute` già inizializzato). */
  colored?: boolean;
}

/** Autore dei contenuti di una cella, in coordinate mondo. */
export type CellBuilder = (cx: number, cz: number, band: number, writer: CellWriter) => void;

/**
 * Buffer di scrittura di una cella.
 *
 * Il costruttore disegna nelle matrici "di comodo" (niente oggetti temporanei
 * per istanza), poi `StreamedCells` copia il blocco nel buffer della mesh e lo
 * carica sulla GPU come un solo intervallo.
 */
export class CellWriter {
  readonly counts: Int32Array;
  readonly matrices: Float32Array[];
  readonly colors: Float32Array[];
  private layer = 0;
  private rng: () => number = mulberry32(1);

  constructor(layerMax: readonly number[], private readonly colored: readonly boolean[]) {
    this.counts = new Int32Array(layerMax.length);
    this.matrices = layerMax.map((max) => new Float32Array(max * 16));
    this.colors = layerMax.map((max) => new Float32Array(max * 3));
  }

  reseed(seed: number): void {
    this.rng = mulberry32(seed);
    this.counts.fill(0);
    this.layer = 0;
  }

  random(): number {
    return this.rng();
  }

  /** Seleziona il layer su cui scrivono le prossime `add`. */
  begin(layer: number): void {
    this.layer = layer;
  }

  /** Aggiunge un'istanza ruotata su Y, con base a `y`. */
  add(x: number, y: number, z: number, yaw: number, sx: number, sy: number, sz: number): boolean {
    const max = this.matrices[this.layer]!.length / 16;
    const index = this.counts[this.layer]!;
    if (index >= max) return false;
    const m = this.matrices[this.layer]!;
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    const o = index * 16;
    m[o] = c * sx;
    m[o + 1] = 0;
    m[o + 2] = -s * sx;
    m[o + 3] = 0;
    m[o + 4] = 0;
    m[o + 5] = sy;
    m[o + 6] = 0;
    m[o + 7] = 0;
    m[o + 8] = s * sz;
    m[o + 9] = 0;
    m[o + 10] = c * sz;
    m[o + 11] = 0;
    m[o + 12] = x;
    m[o + 13] = y;
    m[o + 14] = z;
    m[o + 15] = 1;
    this.counts[this.layer] = index + 1;
    return true;
  }

  /** Colore dell'ultima istanza aggiunta al layer corrente. */
  rgb(r: number, g: number, b: number): void {
    const index = this.counts[this.layer]! - 1;
    if (index < 0 || !this.colored[this.layer]) return;
    const c = this.colors[this.layer]!;
    c[index * 3] = r;
    c[index * 3 + 1] = g;
    c[index * 3 + 2] = b;
  }
}

export interface CellStreamStats {
  cells: number;
  queued: number;
  instances: number;
  builds: number;
  lastBuildMs: number;
  averageBuildMs: number;
  maxBuildMs: number;
  evicted: number;
}

export interface CellStreamOptions {
  cellSize: number;
  /** Raggio entro cui le celle esistono. */
  radius: number;
  /** Oltre questo raggio escono (con dissolvenza). Default: raggio + mezza cella. */
  keepRadius?: number;
  /** Tempo massimo per frame speso a costruire celle (ms). */
  budgetMs?: number;
  /** Durata della dissolvenza di entrata/uscita (s). */
  fadeIn?: number;
  fadeOut?: number;
  /** Anticipo della coda: il mondo davanti si prepara con ~1 s di vantaggio. */
  leadSeconds?: number;
  seed: number;
  /** Celle massime costruite in un frame. */
  maxCellsPerFrame?: number;
  /**
   * Se `true` (default) la cella si rifà quando cambia fascia di distanza.
   * Il grano non ne ha bisogno: la sua densità non dipende dalla fascia, e
   * rifarlo a ogni soglia era solo lavoro (e un cambio di pattern) in più.
   */
  bandRebuild?: boolean;
  /** Densità corrente (0…1); le celle nuove seguono, le vecchie si rifanno piano. */
  density?: number;
}

interface Run {
  start: number;
  count: number;
  used: number;
  /** opacità corrente 0…1 */
  t: number;
  target: number;
}

interface Generation {
  runs: (Run | null)[];
}

interface Cell {
  cx: number;
  cz: number;
  key: number;
  x: number;
  z: number;
  band: number;
  density: number;
  gens: Generation[];
  /**
   * Cella senza contenuto (tutta strada, tutta casa, o nessun coltivo).
   * Resta in mappa come promemoria: senza questo flag la scansione la
   * riproporrebbe a ogni passo e il grano rifarebbe 6.000 piani in mezzo
   * minuto su un paese dove non cresce nulla.
   */
  empty: boolean;
}

interface PendingCell {
  cx: number;
  cz: number;
  band: number;
  priority: number;
}

/**
 * Il campo di celle: tiene il conto, la coda e i buffer, e delega il contenuto
 * a un `CellBuilder`. Non conosce il tipo di vegetazione.
 */
export class StreamedCells {
  readonly writer: CellWriter;
  private readonly cells = new Map<number, Cell>();
  private readonly pools: SlotRuns[];
  private readonly fadeAttributes: THREE.InstancedBufferAttribute[];
  private pending: PendingCell[] = [];
  private pendingKeys = new Set<number>();
  private density: number;
  private stats: CellStreamStats = {
    cells: 0,
    queued: 0,
    instances: 0,
    builds: 0,
    lastBuildMs: 0,
    averageBuildMs: 0,
    maxBuildMs: 0,
    evicted: 0,
  };
  private readonly options: Required<Omit<CellStreamOptions, 'seed' | 'density'>> & { seed: number };
  private started = false;

  constructor(
    private readonly layers: readonly CellLayer[],
    private readonly builder: CellBuilder,
    options: CellStreamOptions,
  ) {
    this.options = {
      cellSize: options.cellSize,
      radius: options.radius,
      keepRadius: options.keepRadius ?? options.radius + options.cellSize * 0.5,
      budgetMs: options.budgetMs ?? 2.5,
      fadeIn: options.fadeIn ?? 0.45,
      fadeOut: options.fadeOut ?? 0.3,
      leadSeconds: options.leadSeconds ?? 1,
      maxCellsPerFrame: options.maxCellsPerFrame ?? 8,
      bandRebuild: options.bandRebuild ?? true,
      seed: options.seed,
    };
    this.density = options.density ?? 1;
    this.pools = layers.map((layer) => new SlotRuns(layer.mesh.instanceMatrix.count));
    this.writer = new CellWriter(
      layers.map((layer) => layer.maxPerCell),
      layers.map((layer) => layer.colored === true),
    );
    this.fadeAttributes = layers.map((layer) => {
      const array = new Float32Array(layer.mesh.instanceMatrix.count);
      const attribute = new THREE.InstancedBufferAttribute(array, 1);
      attribute.setUsage(THREE.DynamicDrawUsage);
      // gli slot non ancora assegnati restano a zero: la mesh non li disegna
      // perché la matrice è nulla, ma in più non costano frammenti.
      layer.mesh.geometry.setAttribute('aFade', attribute);
      return attribute;
    });
    for (const layer of layers) {
      // three inizializza tutte le matrici all'identità: gli slot mai usati
      // verrebbero disegnati in (0, 0, 0), cioè un ciuffo d'erba sull'origine
      // del mondo. Si azzerano una volta e restano azzerati (le liberazioni
      // riscrivono il proprio run a zero).
      (layer.mesh.instanceMatrix.array as Float32Array).fill(0);
      layer.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      layer.mesh.count = 0;
    }
  }

  /** Metriche dell'ultimo frame (diagnostica e test). */
  get metrics(): CellStreamStats {
    let instances = 0;
    for (const cell of this.cells.values()) {
      for (const gen of cell.gens) {
        for (const run of gen.runs) if (run) instances += run.used;
      }
    }
    this.stats.cells = this.cells.size;
    this.stats.queued = this.pending.length;
    this.stats.instances = instances;
    return this.stats;
  }

  /** Densità 0…1: le celle nuove la seguono, le altre si rifanno a poco a poco. */
  setDensity(density: number): void {
    this.density = Math.max(0, Math.min(1, density));
  }

  /**
   * Aggiorna il campo intorno al giocatore.
   *
   * `vx`/`vz` sono la velocità (m/s): servono solo alla priorità, così le celle
   * davanti all'auto vengono costruite prima di quelle alle spalle.
   */
  update(x: number, z: number, vx = 0, vz = 0, dt = 1 / 60): void {
    const started = clock();
    const size = this.options.cellSize;
    const radius = this.options.radius;
    const keep = this.options.keepRadius;
    const lead = this.options.leadSeconds;
    const px = x + vx * lead;
    const pz = z + vz * lead;

    // 1. fascia e uscita delle celle esistenti
    for (const cell of this.cells.values()) {
      const distance = Math.hypot(cell.x - x, cell.z - z);
      if (distance > keep) {
        if (cell.empty) this.cells.delete(cell.key);
        else for (const gen of cell.gens) for (const run of gen.runs) if (run) run.target = 0;
        continue;
      }
      if (distance > radius) continue;
      if (!this.options.bandRebuild) continue;
      const band = bandForDistance(distance);
      if (band === cell.band) continue;
      const threshold = band < cell.band ? DETAIL_BANDS[band]! : DETAIL_BANDS[cell.band - 1]!;
      if (Math.abs(distance - threshold) < BAND_HYSTERESIS) continue;
      // fascia diversa (o densità molto diversa): la cella si rifà in dissolvenza
      this.enqueue(cell.cx, cell.cz, band, px, pz);
    }

    // 2. densità cambiata in modo sensibile (preset adattivo): le celle
    // esistenti si rifanno a poco a poco, partendo da quelle vicine, invece di
    // restare alla densità vecchia finché non cambia la fascia
    if (this.lastDensity === null) this.lastDensity = this.density;
    else if (Math.abs(this.density - this.lastDensity) >= 0.1) {
      this.lastDensity = this.density;
      for (const cell of this.cells.values()) {
        // una cella vuota non ha motivo di rifarsi se la densità scende
        if (cell.empty && this.density <= cell.density + 1e-6) continue;
        if (Math.hypot(cell.x - x, cell.z - z) <= radius) {
          this.enqueue(cell.cx, cell.cz, cell.band, x, z);
        }
      }
    }

    // 3. celle mancanti dentro il raggio
    if (!this.started || this.shouldScan(x, z)) {
      this.scan(x, z, px, pz, size, radius);
      this.started = true;
      this.lastScanX = x;
      this.lastScanZ = z;
    }

    // 4. costruzione a budget, prima le celle più avanti nel senso di marcia
    let built = 0;
    const budget = this.options.budgetMs;
    while (this.pending.length > 0 && built < this.options.maxCellsPerFrame) {
      if (built > 0 && clock() - started >= budget) break;
      const next = this.pending.shift()!;
      this.pendingKeys.delete(cellKeyOf(next.cx, next.cz));
      this.build(next);
      built++;
    }

    this.advanceFades(dt);

    for (let i = 0; i < this.layers.length; i++) {
      this.layers[i]!.mesh.count = this.pools[i]!.highWater;
    }
    this.stats.queued = this.pending.length;
  }

  private lastScanX = Number.NaN;
  private lastScanZ = Number.NaN;
  private lastDensity: number | null = null;
  /** una cella non ha trovato slot: la griglia va riscandita appena si liberano */
  private needsScan = false;

  /** Riscandisce la griglia solo quando ci si è mossi di un quarto di cella. */
  private shouldScan(x: number, z: number): boolean {
    const step = this.options.cellSize * 0.25;
    return (
      this.needsScan ||
      !Number.isFinite(this.lastScanX) ||
      Math.hypot(x - this.lastScanX, z - this.lastScanZ) > step
    );
  }

  private scan(x: number, z: number, px: number, pz: number, size: number, radius: number): void {
    this.needsScan = false;
    const minCx = Math.floor((x - radius) / size);
    const maxCx = Math.floor((x + radius) / size);
    const minCz = Math.floor((z - radius) / size);
    const maxCz = Math.floor((z + radius) / size);
    for (let cz = minCz; cz <= maxCz; cz++) {
      for (let cx = minCx; cx <= maxCx; cx++) {
        const key = cellKeyOf(cx, cz);
        if (this.cells.has(key) || this.pendingKeys.has(key)) continue;
        const centreX = (cx + 0.5) * size;
        const centreZ = (cz + 0.5) * size;
        const distance = Math.hypot(centreX - x, centreZ - z);
        if (distance > radius) continue;
        this.enqueue(cx, cz, bandForDistance(distance), px, pz);
      }
    }
    this.pending.sort((a, b) => a.priority - b.priority);
  }

  private enqueue(cx: number, cz: number, band: number, px: number, pz: number): void {
    const key = cellKeyOf(cx, cz);
    if (this.pendingKeys.has(key)) return;
    const centreX = (cx + 0.5) * this.options.cellSize;
    const centreZ = (cz + 0.5) * this.options.cellSize;
    this.pending.push({
      cx,
      cz,
      band,
      priority: Math.hypot(centreX - px, centreZ - pz),
    });
    this.pendingKeys.add(key);
    this.pending.sort((a, b) => a.priority - b.priority);
  }

  private build(entry: PendingCell): void {
    const started = clock();
    const size = this.options.cellSize;
    const key = cellKeyOf(entry.cx, entry.cz);
    let cell = this.cells.get(key);
    if (!cell) {
      cell = {
        cx: entry.cx,
        cz: entry.cz,
        key,
        x: (entry.cx + 0.5) * size,
        z: (entry.cz + 0.5) * size,
        band: entry.band,
        density: this.density,
        gens: [],
        empty: false,
      };
      this.cells.set(key, cell);
    }
    const previousBand = cell.band;
    cell.band = entry.band;
    cell.density = this.density;

    this.writer.reseed(cellSeed(entry.cx, entry.cz, entry.band, this.options.seed));
    this.builder(entry.cx, entry.cz, entry.band, this.writer);

    // Cella vuota: niente strada, niente prato, nessun coltivo. Si ricorda il
    // risultato (con la densità con cui è stato ottenuto) e non si riprova
    // finché la densità non sale o la fascia non cambia.
    let total = 0;
    for (let i = 0; i < this.layers.length; i++) total += this.writer.counts[i]!;
    if (total === 0) {
      cell.empty = true;
      cell.band = entry.band;
      cell.density = this.density;
      for (const previous of cell.gens) {
        for (const run of previous.runs) if (run) run.target = 0;
      }
      this.stats.builds++;
      this.stats.lastBuildMs = clock() - started;
      return;
    }
    cell.empty = false;

    const gen: Generation = { runs: [] };
    let failed = false;
    for (let i = 0; i < this.layers.length; i++) {
      const count = this.writer.counts[i]!;
      if (count <= 0) {
        gen.runs.push(null);
        continue;
      }
      const pool = this.pools[i]!;
      const slot = pool.acquire(count);
      if (!slot) {
        failed = true;
        break;
      }
      const layer = this.layers[i]!;
      const matrix = layer.mesh.instanceMatrix;
      const matrixArray = matrix.array as Float32Array;
      matrixArray.set(this.writer.matrices[i]!.subarray(0, count * 16), slot.start * 16);
      // il riempimento dell'allineamento resta a scala zero: non deve disegnare
      // l'istanza identità che three mette di default
      matrixArray.fill(0, (slot.start + count) * 16, (slot.start + slot.count) * 16);
      matrix.addUpdateRange(slot.start * 16, slot.count * 16);
      matrix.needsUpdate = true;
      if (layer.colored && layer.mesh.instanceColor) {
        const colorArray = layer.mesh.instanceColor.array as Float32Array;
        colorArray.set(this.writer.colors[i]!.subarray(0, count * 3), slot.start * 3);
        layer.mesh.instanceColor.addUpdateRange(slot.start * 3, slot.count * 3);
        layer.mesh.instanceColor.needsUpdate = true;
      }
      gen.runs.push({ start: slot.start, count: slot.count, used: count, t: 0, target: 1 });
    }

    if (failed) {
      // Mezza cella (il prato senza il ciglio, o viceversa) si vedrebbe come
      // un buco nel tappeto: si restituisce tutto e si riprova quando il pool
      // avrà spazio. Le celle già presenti restano quelle di prima.
      for (let i = 0; i < gen.runs.length; i++) {
        const run = gen.runs[i];
        if (run) this.release(i, run);
      }
      cell.band = previousBand;
      if (cell.gens.length === 0) this.cells.delete(key);
      this.needsScan = true;
      return;
    }

    // la generazione precedente della stessa cella esce in dissolvenza: il
    // cambio di densità non si vede come uno scatto
    for (const previous of cell.gens) {
      for (const run of previous.runs) if (run) run.target = 0;
    }
    cell.gens.push(gen);

    const elapsed = clock() - started;
    this.stats.builds++;
    this.stats.lastBuildMs = elapsed;
    this.stats.maxBuildMs = Math.max(this.stats.maxBuildMs, elapsed);
    this.stats.averageBuildMs = this.stats.averageBuildMs * 0.9 + elapsed * 0.1;
  }

  /** Fa avanzare le dissolvenze e libera gli slot delle generazioni spente. */
  private advanceFades(dt: number): void {
    const fadeIn = this.options.fadeIn;
    const fadeOut = this.options.fadeOut;
    for (const cell of this.cells.values()) {
      let alive = false;
      for (let g = cell.gens.length - 1; g >= 0; g--) {
        const gen = cell.gens[g]!;
        let empty = true;
        for (let i = 0; i < this.layers.length; i++) {
          const run = gen.runs[i];
          if (!run) continue;
          if (run.t !== run.target) {
            const step = dt / Math.max(0.001, run.target > run.t ? fadeIn : fadeOut);
            run.t = run.target > run.t ? Math.min(run.target, run.t + step) : Math.max(run.target, run.t - step);
            this.writeFade(i, run);
          }
          if (run.t <= 0) {
            this.release(i, run);
            gen.runs[i] = null;
            continue;
          }
          empty = false;
        }
        if (empty) {
          cell.gens.splice(g, 1);
          this.stats.evicted++;
        } else {
          alive = true;
        }
      }
      // le celle vuote restano in mappa come promemoria: rifarle ogni passo
      // era il motivo per cui il grano contava migliaia di piani inutili
      if (!alive && !cell.empty) this.cells.delete(cell.key);
    }
  }

  private writeFade(layerIndex: number, run: Run): void {
    const attribute = this.fadeAttributes[layerIndex]!;
    const array = attribute.array as Float32Array;
    const stagger = 0.28;
    for (let i = 0; i < run.used; i++) {
      const slot = run.start + i;
      const delay = hashFraction(slot) * stagger;
      const local = Math.min(1, Math.max(0, (run.t - delay) / (1 - stagger)));
      array[slot] = smoothstep(local);
    }
    // gli slot di riempimento restano a zero
    for (let i = run.used; i < run.count; i++) array[run.start + i] = 0;
    attribute.addUpdateRange(run.start, run.count);
    attribute.needsUpdate = true;
  }

  private release(layerIndex: number, run: Run): void {
    const layer = this.layers[layerIndex]!;
    const matrix = layer.mesh.instanceMatrix.array as Float32Array;
    matrix.fill(0, run.start * 16, (run.start + run.count) * 16);
    layer.mesh.instanceMatrix.addUpdateRange(run.start * 16, run.count * 16);
    layer.mesh.instanceMatrix.needsUpdate = true;
    const fade = this.fadeAttributes[layerIndex]!;
    (fade.array as Float32Array).fill(0, run.start, run.start + run.count);
    fade.addUpdateRange(run.start, run.count);
    fade.needsUpdate = true;
    this.pools[layerIndex]!.release(run.start, run.count);
  }

  dispose(): void {
    for (const cell of this.cells.values()) {
      for (const gen of cell.gens) {
        for (let i = 0; i < this.layers.length; i++) {
          const run = gen.runs[i];
          if (run) this.pools[i]!.release(run.start, run.count);
        }
      }
    }
    this.cells.clear();
    this.pending = [];
    this.pendingKeys.clear();
  }
}

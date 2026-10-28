import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Heightfield } from '../geo/elevation';
import { mulberry32 } from '../geo/geo';
import type { Area, BuildingIndex, RoadIndex } from '../geo/osm';
import { windUniforms } from '../gfx/wind';
import { COVER_CROP, COVER_DRY, COVER_WOOD, GroundMask } from './ground-mask';
import type { PavedArea } from './paved';

/** Raggio del tappeto d'erba intorno al giocatore (m). */
const RADIUS = 150;
const MAX_TUFTS = 180000;
/** Oltre questa distanza il campo viene ricostruito. */
const REBUILD_DISTANCE = 18;

/**
 * Densità del tappeto alla distanza data: pieno entro 20 m, poi dirada fino a
 * un decimo sul bordo dei 110 m. Con un raggio di 40 m l'erba finiva di colpo
 * e oltre restava solo la foto satellite: il confine si vedeva come un cerchio.
 */
function tuftLod(distance: number): number {
  if (distance <= 20) return 1;
  const t = Math.min(1, (distance - 20) / (RADIUS - 20));
  return Math.max(0.07, Math.pow(1 - t, 1.5));
}

/** Scala verticale naturale: sterpaglie e bordi di campo possono superare 1,5 m. */
export function grassBladeHeightScale(
  cover: 0 | 1 | 2 | 3,
  roadDistance: number,
  tallRoll: number,
  heightRoll: number,
): number {
  if (![roadDistance, tallRoll, heightRoll].every(Number.isFinite)) {
    throw new RangeError('I parametri di crescita dell’erba devono essere finiti');
  }
  const verge = roadDistance >= 2.7 && roadDistance <= 6.4;
  const tallChance =
    cover === COVER_DRY ? 0.42 :
    cover === COVER_CROP ? 0.015 :
    cover === COVER_WOOD ? 0.025 :
    verge ? 0.2 : 0.06;
  const height = Math.max(0, Math.min(1, heightRoll));
  if (tallRoll >= tallChance) return 1.8 + height * 1.6;
  return 7.5 + height * 2.5;
}

/** Altezza del ciuffo in metri, prima della scala per istanza. */
const TUFT_HEIGHT = 0.17;
/** Altezza del fiore in metri: sotto l'erba alta, si vede solo da vicino. */
const FLOWER_HEIGHT = 0.32;

/**
 * Tinta dell'erba per copertura del suolo: nel bosco è più scura e fredda, nel
 * coltivo più gialla, sulla macchia più secca. Era il pezzo che mancava perché
 * il prato sembrasse sempre lo stesso tappeto anche sotto i querceti.
 */
const WOOD_TINT = new THREE.Color(0.72, 0.85, 0.66);
const CROP_TINT = new THREE.Color(1.06, 0.98, 0.72);
const DRY_TINT = new THREE.Color(1.02, 0.9, 0.64);

/**
 * Lavoro di ricostruzione spezzato sui frame.
 *
 * La maschera e le due `InstancedMesh` si preparano subito; matrici e colori
 * vengono riempiti a piccoli blocchi, così il picco non arriva mai al loop di
 * rendering. `phase` separa i ciuffi principali dal ciglio stradale.
 */
interface GrassJob {
  x: number;
  z: number;
  density: number;
  target: number;
  edgeTarget: number;
  flowerTarget: number;
  rng: () => number;
  mesh: THREE.InstancedMesh;
  edgeMesh: THREE.InstancedMesh;
  flowerMesh: THREE.InstancedMesh;
  dummy: THREE.Object3D;
  color: THREE.Color;
  palette: number[];
  flowerPalette: number[];
  valid: number;
  perCell: number;
  acc: number;
  cursor: number;
  placed: number;
  edges: number;
  flowers: number;
  phase: 'tufts' | 'flowers' | 'edges';
  heights: Heightfield;
  roads: RoadIndex;
  buildings: BuildingIndex;
}

/**
 * Erba a ciuffi.
 *
 * Ogni ciuffo è un quad incrociato con una texture di lame disegnata su canvas
 * e ritagliata con `alphaTest`: niente rettangoli verdi, ma fili d'erba veri
 * anche a pochi metri. Tutto sta in un `InstancedMesh` (una draw call) e
 * ondeggia nel vertex shader con il vento condiviso di `gfx/wind`.
 *
 * Il campo insegue il giocatore e si ricostruisce solo quando ci si allontana.
 */
export class GrassField {
  readonly group = new THREE.Group();
  private readonly geometry: THREE.BufferGeometry;
  private readonly material: THREE.MeshStandardMaterial;
  private readonly bladeTexture: THREE.CanvasTexture;
  private readonly flowerGeometry: THREE.BufferGeometry;
  private readonly flowerMaterial: THREE.MeshStandardMaterial;
  private readonly flowerTexture: THREE.CanvasTexture;
  private mesh: THREE.InstancedMesh | null = null;
  private edge: THREE.InstancedMesh | null = null;
  private flowers: THREE.InstancedMesh | null = null;
  private originX = Number.NaN;
  private originZ = Number.NaN;
  private density = -1;
  /** Maschera strada/edificio/pendio riusata a ogni ricostruzione. */
  private readonly mask = new GroundMask(RADIUS);
  /** Celle della maschera libere: riempite a ogni rebuild senza allocare. */
  private readonly validCells = new Uint32Array(this.mask.n * this.mask.n);
  /** Ricostruzione in corso, spezzata sui frame. */
  private job: GrassJob | null = null;

  constructor(private readonly paved: readonly PavedArea[] = []) {
    this.geometry = GrassField.buildGeometry();
    this.bladeTexture = GrassField.buildBladeTexture();
    this.flowerGeometry = GrassField.buildFlowerGeometry();
    this.flowerTexture = GrassField.buildFlowerTexture();
    const { uTime, uWind } = windUniforms();
    this.material = new THREE.MeshStandardMaterial({
      map: this.bladeTexture,
      alphaTest: 0.45,
      // con i target MSAA attivi, l'alpha-to-coverage trasforma il ritaglio
      // dei fili d'erba in una transizione morbida invece che in un bordo
      // seghettato: è la differenza più visibile sull'erba da vicino
      alphaToCoverage: true,
      side: THREE.DoubleSide,
      // il ciuffo è scuro alla base e chiaro in punta (colore per vertice):
      // è quello che toglie l'effetto "foglia ritagliata" e dà profondità
      vertexColors: true,
      roughness: 0.95,
      metalness: 0,
      envMapIntensity: 0.45,
    });
    this.material.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = uTime;
      shader.uniforms.uWind = uWind;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uTime;\nuniform vec2 uWind;')
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
          #ifdef USE_INSTANCING
            vec3 tuftPos = vec3( instanceMatrix[ 3 ][ 0 ], instanceMatrix[ 3 ][ 1 ], instanceMatrix[ 3 ][ 2 ] );
          #else
            vec3 tuftPos = vec3( 0.0 );
          #endif
          float tuftBend = clamp( position.y / ${TUFT_HEIGHT.toFixed(2)}, 0.0, 1.0 );
          float tuftPhase = tuftPos.x * 0.42 + tuftPos.z * 0.31;
          float tuftSway = sin( uTime * 1.9 + tuftPhase ) * 0.085 + sin( uTime * 3.4 + tuftPhase * 1.7 ) * 0.03;
          float tuftScaleY = min( 10.0, length( instanceMatrix[ 1 ].xyz ) );
          transformed.x += tuftSway * tuftScaleY * 0.28 * tuftBend * tuftBend * uWind.x;
          transformed.z += tuftSway * tuftScaleY * 0.28 * tuftBend * tuftBend * uWind.y;`,
        );
    };
    this.material.customProgramCacheKey = () => 'grass-wind-v2';

    // i fiori ondeggiano con la stessa formula dei ciuffi, ma partendo dalla
    // propria altezza: il gambo si piega, la corolla resta su
    this.flowerMaterial = new THREE.MeshStandardMaterial({
      map: this.flowerTexture,
      alphaTest: 0.5,
      alphaToCoverage: true,
      side: THREE.DoubleSide,
      vertexColors: true,
      roughness: 0.9,
      metalness: 0,
      envMapIntensity: 0.4,
    });
    this.flowerMaterial.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = uTime;
      shader.uniforms.uWind = uWind;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uTime;\nuniform vec2 uWind;')
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
          #ifdef USE_INSTANCING
            vec3 flowerPos = vec3( instanceMatrix[ 3 ][ 0 ], instanceMatrix[ 3 ][ 1 ], instanceMatrix[ 3 ][ 2 ] );
          #else
            vec3 flowerPos = vec3( 0.0 );
          #endif
          float flowerBend = clamp( position.y / ${FLOWER_HEIGHT.toFixed(2)}, 0.0, 1.0 );
          float flowerPhase = flowerPos.x * 0.42 + flowerPos.z * 0.31;
          float flowerSway = sin( uTime * 1.9 + flowerPhase ) * 0.05 + sin( uTime * 3.4 + flowerPhase * 1.7 ) * 0.018;
          transformed.x += flowerSway * flowerBend * flowerBend * uWind.x;
          transformed.z += flowerSway * flowerBend * flowerBend * uWind.y;`,
        );
    };
    this.flowerMaterial.customProgramCacheKey = () => 'grass-flower-wind-v1';

    this.group.name = 'grass';
    this.group.matrixAutoUpdate = false;
  }

  /**
   * Tre quad incrociati, con la base a y = 0.
   *
   * Due soli quad lasciavano vedere il prato "a croce" quando si guarda
   * radente; il terzo a 45° chiude il ciuffo da ogni angolo, con un costo di
   * due triangoli per istanza. Il gradiente di colore per vertice (scuro al
   * suolo, chiaro in punta) simula l'auto-ombreggiatura dei fili d'erba.
   */
  private static buildGeometry(): THREE.BufferGeometry {
    // ciuffi più larghi: a parità di istanze coprono più suolo e il prato
    // smette di sembrare una griglia di puntini verdi
    const blade = new THREE.PlaneGeometry(0.27, TUFT_HEIGHT, 1, 1);
    blade.translate(0, TUFT_HEIGHT / 2, 0);
    const parts: THREE.BufferGeometry[] = [blade];
    for (const angle of [Math.PI / 3, (Math.PI * 2) / 3]) {
      const copy = blade.clone();
      copy.rotateY(angle);
      parts.push(copy);
    }
    const merged = mergeGeometries(parts, false);
    const geometry = merged ?? blade;
    for (const part of parts) if (part !== geometry) part.dispose();
    const position = geometry.getAttribute('position');
    const colors = new Float32Array(position.count * 3);
    for (let i = 0; i < position.count; i++) {
      const t = Math.max(0, Math.min(1, position.getY(i) / TUFT_HEIGHT));
      // base al 48%, punta piena: il ciuffo non è un quad verde piatto
      const shade = 0.48 + 0.52 * t;
      colors[i * 3] = shade;
      colors[i * 3 + 1] = shade;
      colors[i * 3 + 2] = shade;
    }
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    return geometry;
  }

  /**
   * Texture dei fili d'erba: sfondo trasparente, lame affusolate di verdi
   * diversi, qualche punta secca. Serve `alphaTest`, non la trasparenza, per
   * non pagare l'ordinamento dei 5000 ciuffi.
   */
  private static buildBladeTexture(): THREE.CanvasTexture {
    const size = 256;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('canvas 2d non disponibile');
    ctx.clearRect(0, 0, size, size);
    const rng = mulberry32(0x9a55);

    const blades = 150;
    for (let i = 0; i < blades; i++) {
      const baseX = 8 + rng() * (size - 16);
      const baseY = size - 2;
      const height = size * (0.45 + rng() * 0.5);
      const lean = (rng() - 0.5) * size * 0.5;
      const tipX = baseX + lean;
      const tipY = baseY - height;
      const ctrlX = baseX + lean * 0.35;
      const ctrlY = baseY - height * 0.55;

      // verde con variazione di luminosità e punta più chiara
      const hue = 78 + rng() * 26;
      const light = 32 + rng() * 22;
      ctx.strokeStyle = `hsl(${hue.toFixed(0)} 34% ${light.toFixed(0)}%)`;
      ctx.lineCap = 'round';
      // lame sottili: con tratti spessi il ciuffo legge come una foglia, non erba
      ctx.lineWidth = 0.65 + rng() * 0.85;
      ctx.beginPath();
      ctx.moveTo(baseX, baseY);
      ctx.quadraticCurveTo(ctrlX, ctrlY, tipX, tipY);
      ctx.stroke();
    }
    // punte secche
    for (let i = 0; i < 5; i++) {
      const baseX = 10 + rng() * (size - 20);
      const baseY = size - 2;
      const tipX = baseX + (rng() - 0.5) * 30;
      const tipY = baseY - size * (0.5 + rng() * 0.35);
      ctx.strokeStyle = 'rgba(150, 132, 74, 0.85)';
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.moveTo(baseX, baseY);
      ctx.quadraticCurveTo(baseX + 6, baseY - 40, tipX, tipY);
      ctx.stroke();
    }

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    // l'erba si guarda radente mentre si cammina: con anisotropia bassa il
    // ciuffo lontano diventa una macchia verde sfocata
    texture.anisotropy = 8;
    texture.needsUpdate = true;
    return texture;
  }

  /**
   * Fiori di campo: tre quad incrociati piccoli, base a y = 0.
   *
   * Il gambo è alto quanto basta perché la corolla esca dall'erba bassa; il
   * gradiente per vertice scurisce la base, così il fiore non sembra un
   * adesivo colorato appoggiato sul prato.
   */
  private static buildFlowerGeometry(): THREE.BufferGeometry {
    const petal = new THREE.PlaneGeometry(0.2, FLOWER_HEIGHT, 1, 1);
    petal.translate(0, FLOWER_HEIGHT / 2, 0);
    const parts: THREE.BufferGeometry[] = [petal];
    for (const angle of [Math.PI / 3, (Math.PI * 2) / 3]) {
      const copy = petal.clone();
      copy.rotateY(angle);
      parts.push(copy);
    }
    const merged = mergeGeometries(parts, false);
    const geometry = merged ?? petal;
    for (const part of parts) if (part !== geometry) part.dispose();
    const position = geometry.getAttribute('position');
    const colors = new Float32Array(position.count * 3);
    for (let i = 0; i < position.count; i++) {
      const t = Math.max(0, Math.min(1, position.getY(i) / FLOWER_HEIGHT));
      // il gambo in ombra, la corolla in piena luce
      const shade = 0.58 + 0.42 * t;
      colors[i * 3] = shade;
      colors[i * 3 + 1] = shade;
      colors[i * 3 + 2] = shade;
    }
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    return geometry;
  }

  /**
   * Texture del fiore: gambo verde e corolle quasi bianche, perché la tinta
   * arriva dal colore per istanza (bianco, giallo, viola, papavero). Se le
   * corolle fossero già colorate nella texture, il colore per istanza le
   * moltiplicherebbe e i fiori uscirebbero tutti spenti.
   */
  private static buildFlowerTexture(): THREE.CanvasTexture {
    const size = 64;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('canvas 2d non disponibile');
    ctx.clearRect(0, 0, size, size);
    const rng = mulberry32(0xf10e);

    // gambo: due fili sottili che partono dal basso, mai perfettamente dritti
    for (const lean of [-4, 5]) {
      ctx.strokeStyle = 'rgba(58, 84, 40, 0.95)';
      ctx.lineWidth = 1.6;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(size / 2 + lean * 0.4, size);
      ctx.quadraticCurveTo(size / 2 + lean * 1.6, size * 0.62, size / 2 + lean * 2.2, size * 0.34);
      ctx.stroke();
    }
    // corolle: petali chiari attorno a un centro appena più saturo
    for (let i = 0; i < 3; i++) {
      const cx = size / 2 + (rng() - 0.5) * 20;
      const cy = size * (0.18 + rng() * 0.24);
      const r = 4.5 + rng() * 3.5;
      ctx.fillStyle = 'rgba(255, 252, 240, 0.98)';
      for (let p = 0; p < 5; p++) {
        const a = (p / 5) * Math.PI * 2 + rng() * 0.3;
        ctx.beginPath();
        ctx.arc(cx + Math.cos(a) * r * 0.62, cy + Math.sin(a) * r * 0.62, r * 0.5, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = 'rgba(214, 190, 120, 0.95)';
      ctx.beginPath();
      ctx.arc(cx, cy, r * 0.34, 0, Math.PI * 2);
      ctx.fill();
    }

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    // l'erba si guarda radente mentre si cammina: con anisotropia bassa il
    // ciuffo lontano diventa una macchia verde sfocata
    texture.anisotropy = 8;
    texture.needsUpdate = true;
    return texture;
  }

  /** `density` 0…1 (dal preset grafico). Ricostruisce solo se serve. */
  update(
    x: number,
    z: number,
    heights: Heightfield,
    roads: RoadIndex,
    buildings: BuildingIndex,
    density: number,
    areas: readonly Area[] = [],
  ): void {
    const d = Math.max(0, Math.min(1, density));
    if (d <= 0.01) {
      if (this.job) this.cancelJob();
      if (this.mesh) this.mesh.visible = false;
      if (this.edge) this.edge.visible = false;
      if (this.flowers) this.flowers.visible = false;
      return;
    }
    if (this.mesh) this.mesh.visible = true;
    if (this.edge) this.edge.visible = true;
    if (this.flowers) this.flowers.visible = true;

    const moved = Math.hypot(x - this.originX, z - this.originZ);
    if (this.job) {
      const stale =
        Math.abs(d - this.job.density) > 0.1 ||
        Math.hypot(x - this.job.x, z - this.job.z) > REBUILD_DISTANCE * 1.5;
      if (stale) this.cancelJob();
    }
    if (!this.job && (!this.mesh || moved > REBUILD_DISTANCE || Math.abs(d - this.density) > 0.1)) {
      this.startJob(x, z, heights, roads, buildings, d, areas);
    }
    // La costruzione è spezzata su più frame: il picco da ~40 ms (matrici e
    // colori di 82.000 istanze) diventa un budget di 4 ms per frame. Il campo
    // vecchio resta visibile finché il nuovo non è pronto.
    if (this.job) this.stepJob(4);
    this.group.position.set(0, 0, 0);
  }

  private startJob(
    x: number,
    z: number,
    heights: Heightfield,
    roads: RoadIndex,
    buildings: BuildingIndex,
    density: number,
    areas: readonly Area[] = [],
  ): void {
    this.originX = x;
    this.originZ = z;
    this.density = density;

    // una sola rasterizzazione di strade/edifici/pendio: le 480.000 query
    // per rifiuto casuale diventano una lookup su array
    this.mask.build(x, z, heights, roads, buildings, 2.7, 0.5, this.paved, areas);
    const n = this.mask.n;
    const cellSize = this.mask.cellSize;
    let valid = 0;
    // somma dei pesi di densità: serve a normalizzare `perCell`, altrimenti
    // allargando il raggio l'erba vicina diventerebbe più rada
    let weightSum = 0;
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        if (this.mask.isBlocked(i, j)) continue;
        this.validCells[valid++] = j * n + i;
        const cx = this.mask.originX + (i + 0.5) * cellSize;
        const cz = this.mask.originZ + (j + 0.5) * cellSize;
        weightSum += tuftLod(Math.hypot(cx - x, cz - z));
      }
    }

    const target = Math.round(MAX_TUFTS * density);
    const mesh = new THREE.InstancedMesh(this.geometry, this.material, target);
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.frustumCulled = false;

    const edgeTarget = Math.round(9000 * density);
    const edgeMesh = new THREE.InstancedMesh(this.geometry, this.material, edgeTarget);
    edgeMesh.castShadow = false;
    edgeMesh.receiveShadow = false;
    edgeMesh.frustumCulled = false;

    // fiori radi: un prato fiorito è chiazze, non un tappeto di corolle
    const flowerTarget = Math.max(60, Math.round(1400 * density));
    const flowerMesh = new THREE.InstancedMesh(this.flowerGeometry, this.flowerMaterial, flowerTarget);
    flowerMesh.castShadow = false;
    flowerMesh.receiveShadow = false;
    flowerMesh.frustumCulled = false;

    this.job = {
      x,
      z,
      density,
      target,
      edgeTarget,
      flowerTarget,
      rng: mulberry32(Math.round(x * 31 + z * 17) | 1),
      mesh,
      edgeMesh,
      flowerMesh,
      dummy: new THREE.Object3D(),
      color: new THREE.Color(),
      // verdi leggermente spenti, con qualche tono più secco: un prato
      // molisano non è un tappeto da campo da golf
      palette: [0x7d8f5c, 0x8a9b68, 0x748455, 0x93a26f, 0x7f8f5f, 0x8d9260],
      // bianco e giallo sono i più comuni, il papavero è l'accento
      flowerPalette: [0xf2f0dc, 0xf2f0dc, 0xe8cf63, 0xe8cf63, 0xb08ac0, 0xc4483a],
      valid,
      perCell: weightSum > 0 ? target / weightSum : 0,
      acc: 0,
      cursor: 0,
      placed: 0,
      edges: 0,
      flowers: 0,
      phase: 'tufts',
      heights,
      roads,
      buildings,
    };
  }

  private stepJob(budgetMs: number): void {
    const job = this.job;
    if (!job) return;
    const t0 = performance.now();
    const n = this.mask.n;
    const cell = this.mask.cellSize;

    if (job.phase === 'tufts') {
      while (job.cursor < job.valid && job.placed < job.target) {
        const idx = this.validCells[job.cursor++]!;
        const i = idx % n;
        const j = (idx - i) / n;
        const baseX = this.mask.originX + i * cell;
        const baseZ = this.mask.originZ + j * cell;
        const lod = tuftLod(Math.hypot(baseX + cell * 0.5 - job.x, baseZ + cell * 0.5 - job.z));
        job.acc += job.perCell * lod;
        let count = Math.floor(job.acc);
        job.acc -= count;
        if (count <= 0) continue;
        if (count > job.target - job.placed) count = job.target - job.placed;
        // lungo le strade l'erba resta corta e si allunga verso i campi: sul
        // ciglio (2,7 m) è al 55%, da 6 m in poi è piena
        const roadDist = this.mask.roadDistance(i, j);
        const verge = 0.55 + 0.45 * Math.min(1, Math.max(0, (roadDist - 2.7) / 3.3));
        // copertura del suolo: nel bosco l'erba è rada e corta, nel coltivo
        // bassa e giallastra, sulla macchia più secca
        const cover = this.mask.coverAt(i, j);
        if (cover === COVER_WOOD) count = Math.max(1, Math.round(count * 0.55));
        else if (cover === COVER_CROP) count = Math.max(1, Math.round(count * 0.8));
        const coverScale = cover === COVER_CROP ? 0.6 : cover === COVER_WOOD || cover === COVER_DRY ? 0.74 : 1;
        for (let k = 0; k < count; k++) {
          const px = baseX + job.rng() * cell;
          const pz = baseZ + job.rng() * cell;
          const py = this.mask.heightAt(px, pz);
          job.dummy.position.set(px, py - 0.02, pz);
          job.dummy.rotation.set(0, job.rng() * Math.PI, 0);
          // i ciuffi lontani sono più radi ma leggermente più grandi, così
          // il passaggio dal tappeto pieno al prato rado non si legge
          const baseScale = (0.6 + job.rng() * 0.45) * verge * (1 + (1 - lod) * 0.4);
          const heightScale = grassBladeHeightScale(cover, roadDist, job.rng(), job.rng());
          const widthScale = baseScale * coverScale;
          job.dummy.scale.set(widthScale, baseScale * heightScale, widthScale);
          job.dummy.updateMatrix();
          job.mesh.setMatrixAt(job.placed, job.dummy.matrix);
          job.color
            .setHex(job.palette[Math.floor(job.rng() * job.palette.length)]!)
            .multiplyScalar(0.92 + job.rng() * 0.16);
          if (cover === COVER_WOOD) job.color.multiply(WOOD_TINT);
          else if (cover === COVER_CROP) job.color.multiply(CROP_TINT);
          else if (cover === COVER_DRY) job.color.multiply(DRY_TINT);
          job.mesh.setColorAt(job.placed, job.color);
          job.placed++;
        }
        if ((job.cursor & 63) === 0 && performance.now() - t0 > budgetMs) return;
      }
      job.phase = 'flowers';
    }

    if (job.phase === 'flowers') {
      // le celle si pescano a caso su tutte quelle libere: scorrerle in ordine
      // metterebbe i fiori in un angolo del campo invece che nel prato intero
      let guard = job.flowerTarget * 8;
      while (job.flowers < job.flowerTarget && guard-- > 0) {
        const idx = this.validCells[Math.floor(job.rng() * job.valid)]!;
        const i = idx % n;
        const j = (idx - i) / n;
        // sul ciglio battuto e sulle pendenze forti non crescono fiori
        if (this.mask.roadDistance(i, j) < 3.2) continue;
        // nel bosco e nei campi lavorati i fiori di campo non ci sono
        const cover = this.mask.coverAt(i, j);
        if (cover === COVER_WOOD && job.rng() < 0.85) continue;
        if (cover === COVER_CROP && job.rng() < 0.95) continue;
        const px = this.mask.originX + (i + job.rng()) * cell;
        const pz = this.mask.originZ + (j + job.rng()) * cell;
        // i fiori restano un fatto di primo piano: oltre 50 m sarebbero
        // puntini bianchi sparsi senza senso
        if (Math.hypot(px - job.x, pz - job.z) > 50) continue;
        if (job.heights.slopeAt(px, pz) > 26) continue;
        const py = this.mask.heightAt(px, pz);
        job.dummy.position.set(px, py - 0.02, pz);
        job.dummy.rotation.set(0, job.rng() * Math.PI * 2, 0);
        const scale = 0.7 + job.rng() * 0.6;
        job.dummy.scale.set(scale, scale * (0.85 + job.rng() * 0.3), scale);
        job.dummy.updateMatrix();
        job.flowerMesh.setMatrixAt(job.flowers, job.dummy.matrix);
        job.color
          .setHex(job.flowerPalette[Math.floor(job.rng() * job.flowerPalette.length)]!)
          .multiplyScalar(0.94 + job.rng() * 0.12);
        job.flowerMesh.setColorAt(job.flowers, job.color);
        job.flowers++;
        if ((job.flowers & 63) === 0 && performance.now() - t0 > budgetMs) return;
      }
      job.phase = 'edges';
      this.buildEdges(job);
    }

    this.commitJob(job);
  }

  /** Erba che sconfina sull'asfalto: una fascia di ~30 cm sul ciglio. */
  private buildEdges(job: GrassJob): void {
    if (job.edgeTarget <= 0) return;
    // campionamento diretto dei cigli: costo proporzionale ai metri di
    // strada, non a 190.000 tentativi casuali nel disco
    job.roads.forEachRoadEdge(job.x, job.z, RADIUS, 0.28, (ex, ez) => {
      if (job.edges >= job.edgeTarget) return;
      const px = ex + (job.rng() - 0.5) * 0.22;
      const pz = ez + (job.rng() - 0.5) * 0.22;
      // dentro un'altra carreggiata (incrocio) l'erba non cresce
      if (job.roads.isOnRoad(px, pz, -0.06)) return;
      if (job.buildings.hitsCircle(px, pz, 0.3)) return;
      if (job.heights.slopeAt(px, pz) > 30) return;
      const py = job.heights.heightAt(px, pz);
      job.dummy.position.set(px, py - 0.02, pz);
      job.dummy.rotation.set(0, job.rng() * Math.PI, 0);
      const scale = 0.55 + job.rng() * 0.4;
      job.dummy.scale.set(scale, scale * (0.9 + job.rng() * 0.5), scale);
      job.dummy.updateMatrix();
      job.edgeMesh.setMatrixAt(job.edges, job.dummy.matrix);
      // erba di bordo più secca e polverosa: è quella che prende lo sporco
      job.color.setHex(
        job.edges % 3 === 0 ? 0x949167 : job.palette[Math.floor(job.rng() * job.palette.length)]!,
      );
      // il ciglio è più chiaro e polveroso, non più verde del prato
      job.color.multiplyScalar(0.95 + job.rng() * 0.18);
      job.edgeMesh.setColorAt(job.edges, job.color);
      job.edges++;
    });
  }

  private commitJob(job: GrassJob): void {
    job.mesh.count = job.placed;
    job.mesh.instanceMatrix.needsUpdate = true;
    if (job.mesh.instanceColor) job.mesh.instanceColor.needsUpdate = true;
    job.edgeMesh.count = job.edges;
    job.edgeMesh.instanceMatrix.needsUpdate = true;
    if (job.edgeMesh.instanceColor) job.edgeMesh.instanceColor.needsUpdate = true;
    job.flowerMesh.count = job.flowers;
    job.flowerMesh.instanceMatrix.needsUpdate = true;
    if (job.flowerMesh.instanceColor) job.flowerMesh.instanceColor.needsUpdate = true;

    if (this.mesh) {
      this.group.remove(this.mesh);
      this.mesh.dispose();
    }
    if (this.edge) {
      this.group.remove(this.edge);
      this.edge.dispose();
    }
    if (this.flowers) {
      this.group.remove(this.flowers);
      this.flowers.dispose();
    }
    this.mesh = job.mesh;
    this.edge = job.edgeMesh;
    this.flowers = job.flowerMesh;
    this.group.add(job.mesh);
    this.group.add(job.edgeMesh);
    this.group.add(job.flowerMesh);
    this.job = null;
  }

  private cancelJob(): void {
    const job = this.job;
    if (!job) return;
    job.mesh.dispose();
    job.edgeMesh.dispose();
    job.flowerMesh.dispose();
    this.job = null;
  }

  dispose(): void {
    if (this.job) this.cancelJob();
    if (this.mesh) {
      this.group.remove(this.mesh);
      this.mesh.dispose();
      this.mesh = null;
    }
    if (this.edge) {
      this.group.remove(this.edge);
      this.edge.dispose();
      this.edge = null;
    }
    if (this.flowers) {
      this.group.remove(this.flowers);
      this.flowers.dispose();
      this.flowers = null;
    }
    this.geometry.dispose();
    this.material.dispose();
    this.bladeTexture.dispose();
    this.flowerGeometry.dispose();
    this.flowerMaterial.dispose();
    this.flowerTexture.dispose();
  }
}

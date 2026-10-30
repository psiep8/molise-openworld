import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Heightfield } from '../geo/elevation';
import { mulberry32 } from '../geo/geo';
import type { Area, BuildingIndex, RoadIndex } from '../geo/osm';
import { vehiclePassSnippet, vehiclePassUniforms, windUniforms } from '../gfx/wind';
import { StreamedCells, type CellStreamStats, type CellWriter } from './cell-stream';
import { COVER_CROP, COVER_DRY, COVER_WOOD, type CoverClass } from './ground-mask';
import { AreaLookup, LocalGround } from './local-ground';
import type { PavedArea } from './paved';

/**
 * Erba a ciuffi.
 *
 * Ogni ciuffo è un quad incrociato con una texture di lame disegnata su canvas
 * e ritagliata con `alphaTest`: niente rettangoli verdi, ma fili d'erba veri
 * anche a pochi metri. Tutto sta in un `InstancedMesh` (una draw call) e
 * ondeggia nel vertex shader con il vento condiviso di `gfx/wind`.
 *
 * Il campo non si ricostruisce più in blocco: è un insieme di **celle stabili**
 * (`cell-stream.ts`), ognuna con il proprio intervallo di slot. Entrando nel
 * raggio le celle nascono in dissolvenza (0,45 s) e con un budget di tempo per
 * frame; uscendo si spengono e restituiscono gli slot. A 120 km/h non c'è più
 * la soglia che rifaceva 130.000 ciuffi in un colpo: gli scatti erano quelli.
 */
const CELL = 14;
const RADIUS = 150;
/** Ciuffi per m² in ciascuna fascia di distanza (0-30, 30-60, 60-95, 95+). */
const BAND_DENSITY = [9, 5.4, 2.7, 1.05] as const;
const MAX_TUFTS = 160000;
const MAX_EDGES = 26000;
const MAX_FLOWERS = 5000;
const MAX_EDGES_PER_CELL = 160;
const MAX_FLOWERS_PER_CELL = 8;
/** Passo di campionamento del ciglio: un ciuffo ogni 28 cm di strada. */
const EDGE_STEP = 0.28;
/** Massimo di ciuffi per cella: cella piena nella fascia più vicina. */
const CellTuftMax = Math.ceil(CELL * CELL * BAND_DENSITY[0]!);

/** Scala verticale naturale: sterpaglie e bordi di campo possono superare 1,5 m. */
export function grassBladeHeightScale(
  cover: CoverClass,
  roadDistance: number,
  tallRoll: number,
  heightRoll: number,
): number {
  if (![roadDistance, tallRoll, heightRoll].every(Number.isFinite)) {
    throw new RangeError('I parametri di crescita dell’erba devono essere finiti');
  }
  const verge = roadDistance >= 2.7 && roadDistance <= 6.4;
  // Erba di ottobre: alta, ma non un canneto uniforme. Metà dei ciuffi sono
  // sterpaglie da 70-110 cm, un terzo erba media e il resto prato basso: è la
  // stratificazione che si vede nel campo (e nel riferimento), mentre una
  // sola altezza per tutti legge come una siepe di bambù.
  const tallChance =
    cover === COVER_DRY ? 0.58 :
    cover === COVER_CROP ? 0.02 :
    cover === COVER_WOOD ? 0.28 :
    verge ? 0.6 : 0.5;
  const midChance = 0.35;
  const height = Math.max(0, Math.min(1, heightRoll));
  if (tallRoll < tallChance) return 4.4 + height * 2.6;
  if (tallRoll < tallChance + midChance) return 2.4 + height * 1.4;
  return 1.2 + height * 0.9;
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

/** Palette dei ciuffi: verdi caldi e chiari, con qualche tono secco. */
const PALETTE = [0xa9b982, 0xb7c48f, 0x9fb075, 0xc2cc9a, 0xadb98a, 0xb5bb8f] as const;
/** Bianco e giallo sono i più comuni, il papavero è l'accento. */
const FLOWER_PALETTE = [0xf2f0dc, 0xf2f0dc, 0xe8cf63, 0xe8cf63, 0xb08ac0, 0xc4483a] as const;

export interface GrassMotion {
  vx?: number;
  vz?: number;
  dt?: number;
}

export class GrassField {
  readonly group = new THREE.Group();
  private readonly geometry: THREE.BufferGeometry;
  private readonly material: THREE.MeshStandardMaterial;
  private readonly bladeTexture: THREE.CanvasTexture;
  private readonly flowerGeometry: THREE.BufferGeometry;
  private readonly flowerMaterial: THREE.MeshStandardMaterial;
  private readonly flowerTexture: THREE.CanvasTexture;
  private readonly tufts: THREE.InstancedMesh;
  private readonly edges: THREE.InstancedMesh;
  private readonly flowers: THREE.InstancedMesh;
  private readonly stream: StreamedCells;
  private readonly ground: LocalGround;
  private readonly areas = new AreaLookup();
  private readonly scratchColor = new THREE.Color();
  private density = 0;

  constructor(
    private readonly paved: readonly PavedArea[] = [],
  ) {
    this.geometry = GrassField.buildGeometry();
    this.bladeTexture = GrassField.buildBladeTexture();
    this.flowerGeometry = GrassField.buildFlowerGeometry();
    this.flowerTexture = GrassField.buildFlowerTexture();
    const { uTime, uWind } = windUniforms();
    const passUniforms = vehiclePassUniforms();
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
      Object.assign(shader.uniforms, passUniforms);
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          '#include <common>\nuniform float uTime;\nuniform vec2 uWind;\nuniform vec2 uCarPos;\nuniform float uCarSpeed;\nattribute float aFade;',
        )
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
          transformed.z += tuftSway * tuftScaleY * 0.28 * tuftBend * tuftBend * uWind.y;${vehiclePassSnippet('tuftPos', 'tuftBend', 'tuftScaleY * 0.17')}
          // dissolvenza di cella: il ciuffo cresce dal suolo, non appare
          transformed *= aFade;`,
        );
    };
    this.material.customProgramCacheKey = () => 'grass-wind-v3';

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
      Object.assign(shader.uniforms, passUniforms);
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          '#include <common>\nuniform float uTime;\nuniform vec2 uWind;\nuniform vec2 uCarPos;\nuniform float uCarSpeed;\nattribute float aFade;',
        )
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
          float flowerScaleY = min( 10.0, length( instanceMatrix[ 1 ].xyz ) );
          transformed.x += flowerSway * flowerBend * flowerBend * uWind.x;
          transformed.z += flowerSway * flowerBend * flowerBend * uWind.y;${vehiclePassSnippet('flowerPos', 'flowerBend', 'flowerScaleY * 0.32')}
          transformed *= aFade;`,
        );
    };
    this.flowerMaterial.customProgramCacheKey = () => 'grass-flower-wind-v2';

    this.tufts = GrassField.buildLayer(this.geometry, this.material, MAX_TUFTS);
    this.tufts.name = 'grass-tufts';
    // il ciglio usa la stessa geometria ma un attributo di dissolvenza suo:
    // l'attributo vive sulla geometria, quindi serve una copia
    this.edges = GrassField.buildLayer(this.geometry.clone(), this.material, MAX_EDGES);
    this.edges.name = 'grass-edge';
    this.flowers = GrassField.buildLayer(this.flowerGeometry, this.flowerMaterial, MAX_FLOWERS);
    this.flowers.name = 'grass-flowers';
    this.group.add(this.tufts, this.edges, this.flowers);
    this.group.name = 'grass';
    this.group.matrixAutoUpdate = false;

    this.ground = new LocalGround();
    this.stream = new StreamedCells(
      [
        { mesh: this.tufts, maxPerCell: CellTuftMax, colored: true },
        { mesh: this.edges, maxPerCell: MAX_EDGES_PER_CELL, colored: true },
        { mesh: this.flowers, maxPerCell: MAX_FLOWERS_PER_CELL, colored: true },
      ],
      (cx, cz, band, writer) => this.buildCell(cx, cz, band, writer),
      { cellSize: CELL, radius: RADIUS, budgetMs: 2.5, seed: 0x9a55, leadSeconds: 1 },
    );
  }

  private static buildLayer(
    geometry: THREE.BufferGeometry,
    material: THREE.Material,
    capacity: number,
  ): THREE.InstancedMesh {
    const mesh = new THREE.InstancedMesh(geometry, material, capacity);
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.frustumCulled = false;
    mesh.count = 0;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    // il colore per istanza deve esistere prima del primo upload
    mesh.setColorAt(0, new THREE.Color(0xffffff));
    return mesh;
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
    // Ciuffi larghi: a parità di istanze coprono più suolo e il prato non
    // sembra una fila di spazzolini verdi sul terreno nudo.
    const blade = new THREE.PlaneGeometry(0.48, TUFT_HEIGHT, 1, 1);
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
      // base al 62%, punta piena: il ciuffo non è un quad verde piatto, ma non
      // deve nemmeno diventare nero contro il prato chiaro del terreno
      const shade = 0.74 + 0.26 * t;
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
      const hue = 72 + rng() * 34;
      // Lame chiare e giallastre come l'erba di ottobre: a luminosità 32-54%
      // il ciuffo controluce diventava quasi nero.
      const light = 50 + rng() * 22;
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

  /** Metriche del popolamento (diagnostica e `__molise`). */
  /** Densità 0…1 (dal preset grafico). Le celle nuove la seguono. */
  update(
    x: number,
    z: number,
    heights: Heightfield,
    roads: RoadIndex,
    buildings: BuildingIndex,
    density: number,
    areas: readonly Area[] = [],
    motion: GrassMotion = {},
  ): void {
    const d = Math.max(0, Math.min(1, density));
    if (d <= 0.01) {
      this.group.visible = false;
      return;
    }
    this.group.visible = true;
    // il mondo è pronto: collega terreno e indici alla prima chiamata
    if (!this.worldReady) {
      this.installWorld(heights, roads, buildings);
      this.worldReady = true;
    } else {
      // un cambio di mappa (bundle geografici ricaricati) cambia gli indici
      if (this.heights !== heights) this.installWorld(heights, roads, buildings);
    }
    this.areas.refresh(areas);
    this.stream.setDensity(d);
    this.density = d;
    this.stream.update(x, z, motion.vx ?? 0, motion.vz ?? 0, motion.dt ?? 1 / 60);
  }

  private worldReady = false;
  private heights: Heightfield | null = null;

  private installWorld(heights: Heightfield, roads: RoadIndex, buildings: BuildingIndex): void {
    this.heights = heights;
    this.ground.bind(heights, roads, buildings);
  }

  /**
   * Piano di una cella: ciuffi, ciglio e fiori.
   *
   * È tutto locale alla cella: la maschera di 600×600 celle non esiste più e
   * con lei i 70-90 ms di blocco a ogni soglia di distanza.
   */
  private buildCell(cx: number, cz: number, band: number, writer: CellWriter): void {
    const size = CELL;
    const ox = cx * size;
    const oz = cz * size;
    const centreX = ox + size / 2;
    const centreZ = oz + size / 2;
    const ground = this.ground;
    ground.prepare(centreX, centreZ, size * 0.75 + 8, this.areas.near(centreX, centreZ, size * 0.75 + 8), this.paved);

    const density = BAND_DENSITY[band] ?? BAND_DENSITY[3];
    const scale = this.density;

    // --- ciuffi -----------------------------------------------------------
    writer.begin(0);
    const target = Math.round(size * size * density * scale);
    for (let n = 0; n < target; n++) {
      const px = ox + writer.random() * size;
      const pz = oz + writer.random() * size;
      const cover = ground.cover(px, pz);
      // nello sporco il tappeto resta, ma dirada; sul lastricato no
      if (cover === COVER_WOOD && writer.random() > 0.55) continue;
      if (cover === COVER_CROP && writer.random() > 0.8) continue;
      if (!ground.free(px, pz, 1.6, 0.5)) continue;
      if (ground.slope(px, pz) > 30) continue;
      const roadDist = ground.roadDistance(px, pz);
      // lungo le strade l'erba resta corta e si allunga verso i campi: sul
      // ciglio (2,7 m) è al 55%, da 6 m in poi è piena
      const verge = 0.55 + 0.45 * Math.min(1, Math.max(0, (roadDist - 2.7) / 3.3));
      // La taglia NON dipende dalla fascia: se cambiasse, al passaggio di
      // soglia tutti i ciuffi della cella cambierebbero dimensione insieme e
      // l'erba sembrerebbe "scendere" e rifarsi.
      const baseScale = (0.6 + writer.random() * 0.45) * verge;
      const heightScale = grassBladeHeightScale(cover, roadDist, writer.random(), writer.random());
      const coverScale = cover === COVER_CROP ? 0.6 : cover === COVER_WOOD || cover === COVER_DRY ? 0.74 : 1;
      const widthScale = baseScale * coverScale;
      const y = ground.height(px, pz) - 0.02;
      if (!writer.add(px, y, pz, writer.random() * Math.PI, widthScale, baseScale * heightScale, widthScale)) {
        break;
      }
      this.scratchColor
        .setHex(PALETTE[Math.floor(writer.random() * PALETTE.length)]!)
        .multiplyScalar(0.92 + writer.random() * 0.16);
      if (cover === COVER_WOOD) this.scratchColor.multiply(WOOD_TINT);
      else if (cover === COVER_CROP) this.scratchColor.multiply(CROP_TINT);
      else if (cover === COVER_DRY) this.scratchColor.multiply(DRY_TINT);
      writer.rgb(this.scratchColor.r, this.scratchColor.g, this.scratchColor.b);
    }
    // --- ciglio -----------------------------------------------------------
    writer.begin(1);
    const edgesPerCell = Math.round(MAX_EDGES_PER_CELL * scale);
    let edges = 0;
    for (const s of ground.roadSegments) {
      if (edges >= edgesPerCell) break;
      const dx = s.bx - s.ax;
      const dz = s.bz - s.az;
      const len = Math.hypot(dx, dz);
      if (len < 1e-3) continue;
      const nx = -dz / len;
      const nz = dx / len;
      const steps = Math.max(1, Math.ceil(len / EDGE_STEP));
      const side = s.w + 0.18;
      for (let i = 0; i <= steps && edges < edgesPerCell; i++) {
        const t = i / steps;
        const bx = s.ax + dx * t;
        const bz = s.az + dz * t;
        for (let k = -1; k <= 1; k += 2) {
          const ex = bx + nx * side * k;
          const ez = bz + nz * side * k;
          if (ex < ox || ex >= ox + size || ez < oz || ez >= oz + size) continue;
          const px = ex + (writer.random() - 0.5) * 0.22;
          const pz = ez + (writer.random() - 0.5) * 0.22;
          // in paese il ciglio è il marciapiede: nessun ciuffo sulle lastre
          if (!ground.free(px, pz, -0.06, 0.3)) continue;
          if (ground.slope(px, pz) > 30) continue;
          const grassScale = 0.55 + writer.random() * 0.4;
          const y = ground.height(px, pz) - 0.02;
          if (!writer.add(
            px,
            y,
            pz,
            writer.random() * Math.PI,
            grassScale,
            grassScale * (0.9 + writer.random() * 0.5),
            grassScale,
          )) break;
          // erba di bordo più secca e polverosa: è quella che prende lo sporco
          this.scratchColor.setHex(
            edges % 3 === 0 ? 0x949167 : PALETTE[Math.floor(writer.random() * PALETTE.length)]!,
          );
          this.scratchColor.multiplyScalar(0.95 + writer.random() * 0.18);
          writer.rgb(this.scratchColor.r, this.scratchColor.g, this.scratchColor.b);
          edges++;
        }
      }
    }

    // --- fiori ------------------------------------------------------------
    // un prato fiorito è chiazze, non un tappeto di corolle: pochi, e solo
    // nel primo piano (oltre 50 m sarebbero puntini bianchi senza senso)
    if (band <= 2) writer.begin(2);
    const flowers = band <= 2 ? Math.round(MAX_FLOWERS_PER_CELL * scale * 0.6) : 0;
    for (let n = 0; n < flowers; n++) {
      const px = ox + writer.random() * size;
      const pz = oz + writer.random() * size;
      const cover = ground.cover(px, pz);
      // nel bosco e nei campi lavorati i fiori di campo non ci sono
      if (cover === COVER_WOOD && writer.random() < 0.85) continue;
      if (cover === COVER_CROP && writer.random() < 0.95) continue;
      if (ground.roadDistance(px, pz) < 3.2) continue;
      if (!ground.free(px, pz, 0.4, 0.4)) continue;
      if (ground.slope(px, pz) > 26) continue;
      const scaleF = 0.7 + writer.random() * 0.6;
      if (!writer.add(
        px,
        ground.height(px, pz) - 0.02,
        pz,
        writer.random() * Math.PI * 2,
        scaleF,
        scaleF * (0.85 + writer.random() * 0.3),
        scaleF,
      )) break;
      this.scratchColor
        .setHex(FLOWER_PALETTE[Math.floor(writer.random() * FLOWER_PALETTE.length)]!)
        .multiplyScalar(0.94 + writer.random() * 0.12);
      writer.rgb(this.scratchColor.r, this.scratchColor.g, this.scratchColor.b);
    }
  }

  /** Diagnostica del popolamento a celle (`__molise`). */
  streamingStats(): CellStreamStats & { radius: number; cellSize: number } {
    const m = this.stream.metrics;
    return {
      ...m,
      lastBuildMs: Math.round(m.lastBuildMs * 10) / 10,
      averageBuildMs: Math.round(m.averageBuildMs * 100) / 100,
      maxBuildMs: Math.round(m.maxBuildMs * 10) / 10,
      radius: RADIUS,
      cellSize: CELL,
    };
  }

  dispose(): void {
    this.stream.dispose();
    this.group.clear();
    this.geometry.dispose();
    this.material.dispose();
    this.bladeTexture.dispose();
    this.flowerGeometry.dispose();
    this.flowerMaterial.dispose();
    this.flowerTexture.dispose();
  }
}

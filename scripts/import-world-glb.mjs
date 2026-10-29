#!/usr/bin/env node
/**
 * Importa i GLB del "world kit" in `public/worldkit/`.
 *
 * Perché uno script e non una copia a mano: gli originali sono scan Sketchfab da
 * 700 MB (fino a 2 milioni di triangoli l'uno, materiali specular-glossiness che
 * three.js non legge più) e su GitHub un file oltre i 100 MB viene rifiutato.
 * Qui ogni modello viene normalizzato in PBR, semplificato, quantizzato e
 * compresso con meshopt, poi scritto **nel repository**: a differenza del city
 * kit (`npm run kit`) e delle auto, questi file sono versionati, quindi ogni
 * clone/pull e ogni build di produzione li ha senza passaggi esterni.
 *
 * Uso:
 *   # metti lo zip estratto in `incoming-glb/` (cartella ignorata da git)
 *   npm run worldkit                 # rigenera tutto
 *   npm run worldkit -- --only=tree  # solo gli slug che contengono "tree"
 *   npm run worldkit -- --check      # non scrive: verifica manifest e file
 *
 * Cosa fa, per ogni modello:
 *   1. isola il nodo (o l'intera scena) e scarta materiali/texture non usati;
 *   2. converte KHR_materials_pbrSpecularGlossiness in metal-rough;
 *   3. unisce le primitive per materiale, salda i vertici e semplifica fino al
 *      budget di triangoli dello slot;
 *   4. ridimensiona le texture (webp) e comprime la geometria (KHR_mesh_quantization
 *      + EXT_meshopt_compression, decoder incluso in three);
 *   5. scrive `public/worldkit/models/<slug>.glb` e aggiorna manifest/attribuzione.
 *
 * I modelli con licenza *Sketchfab Standard* non sono ridistribuibili e restano
 * fuori dal repository (come le auto fuori lista): lo script li salta e lo dice.
 */
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { NodeIO, getBounds } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import {
  cloneDocument,
  dedup,
  join,
  meshopt,
  metalRough,
  prune,
  quantize,
  simplify,
  textureCompress,
  weld,
} from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';

const SRC_DIR = path.resolve('incoming-glb');
const OUT_DIR = path.resolve('public/worldkit');
const MODEL_DIR = path.join(OUT_DIR, 'models');
const MANIFEST = path.join(OUT_DIR, 'manifest.json');
const ATTRIBUTION = path.join(OUT_DIR, 'ATTRIBUTION.md');

const args = new Set(process.argv.slice(2));
const checkOnly = args.has('--check');
/** Rigenera solo i file filtrati, conservando le voci già presenti nel manifest. */
const merge = args.has('--merge');
const onlyArg = [...args].find((a) => a.startsWith('--only='));
const only = onlyArg
  ? onlyArg
      .slice('--only='.length)
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean)
  : null;
const fileArg = [...args].find((a) => a.startsWith('--file='))?.slice('--file='.length).toLowerCase() ?? null;

/** Budget di triangoli e lato massimo delle texture, per famiglia di modello. */
const BUDGET = {
  tree: { tris: 18000, texture: 1024 },
  fieldTree: { tris: 1200, texture: 512 },
  distantTree: { tris: 220, texture: 512 },
  shrub: { tris: 900, texture: 512 },
  grass: { tris: 1600, texture: 512 },
  rock: { tris: 4000, texture: 512 },
  house: { tris: 45000, texture: 1024 },
  sign: { tris: 5000, texture: 512 },
  ground: { tris: 18000, texture: 1024 },
  groundSmall: { tris: 7000, texture: 512 },
  field: { tris: 12000, texture: 1024 },
  bale: { tris: 6500, texture: 512 },
  village: { tris: 38000, texture: 1024 },
  sidewalk: { tris: 12000, texture: 512 },
  curb: { tris: 10000, texture: 512 },
  guardrail: { tris: 3200, texture: 512 },
  streetlight: { tris: 7000, texture: 512 },
  bridge: { tris: 40000, texture: 1024 },
  spare: { tris: 9000, texture: 1024 },
};

/**
 * Cura dei modelli.
 *
 * `role` è il contratto col motore (`src/world/worldkit.ts`): il mondo cerca il
 * ruolo, non il nome del file. `height` è l'altezza reale a cui il modello viene
 * portato nel gioco (m): così un albero da 45 unità e uno da 7 diventano tutti
 * alberi di 9 m e il piazzamento può ragionare in metri.
 */
const SOURCES = [
  {
    file: 'realistic_trees_pack_of_2_free.glb',
    usage: 'placed',
    assets: [
      {
        slug: 'tree-real-a',
        name: 'Albero realistico A',
        role: 'tree',
        height: 12,
        budget: 'tree',
        nodes: ['Tree_Bark_0', 'Tree_Leaves_2'],
      },
      {
        slug: 'tree-real-b',
        name: 'Albero realistico B',
        role: 'tree',
        height: 10.5,
        budget: 'tree',
        nodes: ['Tree_Bark.001_1', 'Tree_Leaves.001_3'],
      },
    ],
  },
  {
    // attenzione: è un pack di **sottobosco** (felci, origano, camomilla, bambù
    // sacro), alto 0,2–1,3 m. Non è una collezione di alberi: va piazzato come
    // cespuglio, alla sua scala, altrimenti diventa una liana di 10 metri
    file: 'vegetation_pack.glb',
    usage: 'placed',
    pack: { total: 300000, texture: 512 },
    auto: 'plants',
  },
  {
    file: 'low_poly_forest_tree_pack.glb',
    usage: 'placed',
    pack: { total: 3800, texture: 512 },
    auto: 'forest',
  },
  {
    file: 'roadside_billboards_with_iconstext_ue.glb',
    usage: 'placed',
    pack: { total: 6000, texture: 512 },
    auto: 'signs',
  },
  {
    file: 'casa_di_abitazione.glb',
    usage: 'placed',
    assets: [
      {
        slug: 'rural-house',
        name: 'Casa di abitazione',
        role: 'house',
        height: 8,
        budget: 'house',
      },
    ],
  },
  {
    file: 'rock_terrain.glb',
    usage: 'placed',
    assets: [
      {
        slug: 'rock-outcrop',
        name: 'Affioramento roccioso',
        role: 'rock',
        height: 2.4,
        budget: 'rock',
      },
    ],
  },
  // --- erba da primo piano ---------------------------------------------------
  {
    file: 'grass.glb',
    usage: 'placed',
    pack: { total: 60000, texture: 512 },
    assets: [
      { slug: 'grass-cosmic-a', name: 'Erba di campo A', role: 'grass', height: 0.62, budget: 'grass', nodes: ['Grass1'] },
      { slug: 'grass-cosmic-b', name: 'Erba di campo B', role: 'grass', height: 0.55, budget: 'grass', nodes: ['GrassAutumn3'] },
    ],
  },
  {
    // questi due "tile" sono zolle fotografate da 83k e 18k triangoli: come
    // ciuffo da istanziare centinaia di volte sono insostenibili, ma poche
    // istanze vicino alla camera (ruolo `grass-hero`) valgono l'intero prato
    file: 'grass (1).glb',
    usage: 'placed',
    pack: { total: 60000, texture: 512 },
    assets: [
      { slug: 'grass-tile-a', name: 'Zolla d\u2019erba fitta', role: 'grass-hero', height: 0.8, budget: 'spare', nodes: ['Tile_1'] },
      { slug: 'grass-tile-b', name: 'Zolla d\u2019erba rada', role: 'grass-hero', height: 0.7, budget: 'spare', nodes: ['Tile_2'] },
    ],
  },
  {
    file: 'simple_grass_chunks.glb',
    usage: 'placed',
    pack: { total: 30000, texture: 512 },
    assets: [
      { slug: 'grass-chunk-a', name: 'Ciuffi d\u2019erba A', role: 'grass', height: 0.5, budget: 'grass', nodes: ['rostlinka_07c'] },
      { slug: 'grass-chunk-b', name: 'Ciuffi d\u2019erba B', role: 'grass', height: 0.45, budget: 'grass', nodes: ['r12_a'] },
    ],
  },
  {
    // il modello "hero" del trifoglio è una fioriera da esposizione, con il
    // vaso: in mezzo a un prato non c'entra. Resta in riserva per un giardino
    file: 'clover_spring.glb',
    usage: 'reserve',
    pack: { total: 30000, texture: 512 },
    assets: [
      { slug: 'clover-planter', name: 'Fioriera di trifoglio', role: 'spare', height: 0.5, budget: 'spare', nodes: ['clover_spring_hero'] },
    ],
  },
  {
    file: 'grass_patches.glb',
    usage: 'placed',
    pack: { total: 2200, texture: 512 },
    assets: [
      { slug: 'grass-patch-a', name: 'Zolla d\u2019erba A', role: 'grass', height: 0.35, budget: 'grass', nodes: ['grasspatch1'] },
      { slug: 'grass-patch-b', name: 'Zolla d\u2019erba B', role: 'grass', height: 0.4, budget: 'grass', nodes: ['grasspatch2'] },
      { slug: 'grass-patch-c', name: 'Zolla d\u2019erba C', role: 'grass', height: 0.32, budget: 'grass', nodes: ['grasspatch3'] },
    ],
  },
  {
    file: 'realtime_grass.glb',
    usage: 'placed',
    pack: { total: 30000, texture: 512 },
    assets: [{ slug: 'grass-realtime', name: 'Erba a lame', role: 'grass', height: 0.45, budget: 'grass' }],
  },
  {
    file: 'hand_painted_grasses.glb',
    usage: 'placed',
    pack: { total: 1200, texture: 512 },
    assets: [{ slug: 'grass-painted', name: 'Erba dipinta', role: 'grass', height: 0.55, budget: 'grass' }],
  },

  // --- suolo, campi e arredo agricolo ---------------------------------------
  // Questi scan sono fotogrammetrie di terreno e coltivi. Il `footprint` è la
  // dimensione orizzontale a cui viene portato il modello: un piano da 602 m
  // (mud_material) non può essere normalizzato in altezza, altrimenti diventa
  // largo chilometri. Il runtime userà `normalize: "footprint"`.
  {
    file: 'photoscanned_patch_of_ground.glb',
    usage: 'placed',
    assets: [
      {
        slug: 'ground-photo-small',
        name: 'Zolla di terra fotografata',
        role: 'ground',
        footprint: 5,
        budget: 'groundSmall',
      },
    ],
  },
  {
    file: 'ground (1).glb',
    usage: 'placed',
    assets: [
      {
        slug: 'ground-meadow-tile',
        name: 'Terra di prato',
        role: 'ground',
        footprint: 18,
        budget: 'ground',
      },
    ],
  },
  {
    file: 'ground_2.glb',
    usage: 'placed',
    assets: [
      {
        slug: 'ground-field-tile',
        name: 'Terra di campo',
        role: 'ground',
        footprint: 20,
        budget: 'ground',
      },
    ],
  },
  {
    file: 'ground.glb',
    usage: 'placed',
    assets: [
      {
        slug: 'ground-bank-tile',
        name: 'Terra di scarpata',
        role: 'ground',
        footprint: 22,
        budget: 'ground',
      },
    ],
  },
  {
    file: 'mud_material.glb',
    usage: 'placed',
    assets: [
      {
        slug: 'ground-mud',
        name: 'Fango',
        role: 'ground',
        footprint: 16,
        budget: 'ground',
        muddy: true,
      },
    ],
  },
  {
    file: 'a_round_bundle_of_straw_in_the_field.glb',
    usage: 'placed',
    assets: [
      {
        slug: 'straw-bale',
        name: 'Balla di paglia',
        role: 'bale',
        height: 1.35,
        budget: 'bale',
      },
    ],
  },
  {
    file: 'dry_thin_grass.glb',
    usage: 'placed',
    assets: [
      {
        slug: 'field-dry-grass',
        name: 'Erba secca sottile',
        role: 'field',
        footprint: 3.4,
        budget: 'field',
      },
    ],
  },
  {
    file: 'maria_tach_field.glb',
    usage: 'placed',
    assets: [
      {
        slug: 'field-maria',
        name: 'Campo Maria',
        role: 'field',
        footprint: 30,
        budget: 'field',
        // fotogrammetria di fili d'erba separati: meshoptimizer non può
        // collassare componenti disconnesse, resta un asset "hero" da 450k
        // triangoli. Il runtime ne piazza al massimo un esemplare.
        hero: true,
      },
    ],
  },
  {
    file: 'field_and_garden.glb',
    usage: 'placed',
    assets: [
      {
        slug: 'field-garden',
        name: 'Campo e orto',
        role: 'field',
        footprint: 34,
        budget: 'field',
      },
    ],
  },
  // CC BY-NC: entra nel repo (attribuzione obbligatoria) ma il caricatore lo
  // esclude quando `VITE_COMMERCIAL_BUILD=1`. La build demo locale è non
  // commerciale; per una build commerciale questi due file non si usano.
  {
    file: 'green_field.glb',
    usage: 'placed',
    assets: [
      {
        slug: 'field-green',
        name: 'Campo verde',
        role: 'field',
        footprint: 12,
        budget: 'field',
        nonCommercial: true,
      },
    ],
  },
  {
    file: 'green_field_greener.glb',
    usage: 'placed',
    assets: [
      {
        slug: 'field-green-lush',
        name: 'Campo verde fitto',
        role: 'field',
        footprint: 12,
        budget: 'field',
        nonCommercial: true,
      },
    ],
  },
  // Scene Metazeon: 200–370 m di fotogrammetria. Vengono ridotte a ~150 m e
  // restano avantieri lontani, fuori dalla zona guidabile vicino a Palata.
  {
    file: 'village_country_road_farm_transformer_tower.glb',
    usage: 'placed',
    assets: [
      {
        slug: 'village-country-road',
        name: 'Villaggio, strada e torre',
        role: 'village',
        footprint: 155,
        budget: 'village',
      },
    ],
  },
  {
    file: 'village_farmland_and_irrigation_canal.glb',
    usage: 'placed',
    assets: [
      {
        slug: 'village-canal',
        name: 'Villaggio con canale',
        role: 'village',
        footprint: 150,
        budget: 'village',
      },
    ],
  },
  {
    file: 'village_farmland_and_irrigation_canal (1).glb',
    usage: 'placed',
    assets: [
      {
        slug: 'village-canal-wide',
        name: 'Villaggio con canale (largo)',
        role: 'village',
        footprint: 170,
        budget: 'village',
      },
    ],
  },

  // --- arredo stradale: ruoli nuovi, piazzati lungo le strade ---------------
  // Marciapiedi, cordoli, guardrail e lampioni erano le 26 riserve del vecchio
  // manifest. Ora hanno un ruolo vero e vengono caricati solo se il preset li
  // usa (`quality.roadside`). Il manto procedurale resta l'unica superficie
  // guidabile: questi GLB sono dettaglio visivo e collisioni ai bordi.
  {
    file: 'sidewalk_8m_long_-_hq.glb',
    usage: 'placed',
    assets: [
      {
        slug: 'sidewalk-8m',
        name: 'Marciapiede 8 m',
        role: 'sidewalk',
        footprint: 8.1,
        budget: 'sidewalk',
      },
    ],
  },
  {
    file: 'hq_free_long_sidewalk_3.glb',
    usage: 'placed',
    assets: [
      {
        slug: 'sidewalk-long',
        name: 'Marciapiede lungo',
        role: 'sidewalk',
        footprint: 6.1,
        budget: 'sidewalk',
      },
    ],
  },
  {
    file: 'rocky_curb_scan.glb',
    usage: 'placed',
    assets: [
      {
        slug: 'curb-stone',
        name: 'Cordolo in pietra',
        role: 'curb',
        footprint: 2.8,
        budget: 'curb',
      },
    ],
  },
  {
    file: 'guardrail_road.glb',
    usage: 'placed',
    assets: [
      {
        slug: 'guardrail',
        name: 'Guardrail',
        role: 'guardrail',
        footprint: 10,
        budget: 'guardrail',
      },
    ],
  },
  {
    file: 'guardrail_and_terminal.glb',
    usage: 'placed',
    assets: [
      {
        slug: 'guardrail-terminal',
        name: 'Guardrail e terminale',
        role: 'guardrail',
        footprint: 4.3,
        budget: 'guardrail',
      },
    ],
  },
  {
    file: 'roadside_guard.glb',
    usage: 'placed',
    assets: [
      {
        slug: 'guardrail-heavy',
        name: 'Protezione stradale',
        role: 'guardrail',
        footprint: 7.7,
        budget: 'guardrail',
      },
    ],
  },
  {
    file: 'light_pole.glb',
    usage: 'placed',
    assets: [
      {
        slug: 'streetlight-pole',
        name: 'Palo della luce',
        role: 'streetlight',
        height: 6,
        budget: 'streetlight',
      },
    ],
  },
  {
    file: 'ligh_pole.glb',
    usage: 'placed',
    assets: [
      {
        slug: 'streetlight-lamp',
        name: 'Lampione',
        role: 'streetlight',
        height: 7,
        budget: 'streetlight',
      },
    ],
  },
  {
    // pack modulare: i pezzi sono figli diretti del contenitore. Sidewalk 1/2
    // sono quasi gratis (10 tri) e danno subito un modulo da 10 e 17 m.
    file: 'road_modular.glb',
    usage: 'placed',
    assets: [
      {
        slug: 'sidewalk-module-a',
        name: 'Marciapiede modulare A',
        role: 'sidewalk',
        footprint: 10.52,
        budget: 'sidewalk',
        nodes: ['Sidewalk 1_0_73'],
      },
      {
        slug: 'sidewalk-module-b',
        name: 'Marciapiede modulare B',
        role: 'sidewalk',
        footprint: 16.9,
        budget: 'sidewalk',
        nodes: ['Sidewalk 2_1_75'],
      },
      {
        slug: 'streetlight-dual',
        name: 'Lampione doppio',
        role: 'streetlight',
        height: 7.8,
        budget: 'streetlight',
        nodes: ['Dual light pole.000_38_9'],
      },
      {
        slug: 'streetlight-single',
        name: 'Lampione singolo',
        role: 'streetlight',
        height: 7.8,
        budget: 'streetlight',
        nodes: ['Light pole.001_27_21'],
      },
      {
        slug: 'sign-stop-modular',
        name: 'Cartello STOP modulare',
        role: 'sign',
        height: 2.38,
        budget: 'sign',
        nodes: ['Stop sign_45_87'],
      },
    ],
  },
  {
    // cordoli sottili del pack città: 5,4 m e 1,1 m, una draw call ciascuno
    file: 'modular_city_road_pack__game_ready.glb',
    usage: 'placed',
    assets: [
      {
        slug: 'curb-modular-long',
        name: 'Cordolo modulare lungo',
        role: 'curb',
        footprint: 5.43,
        budget: 'curb',
        nodes: ['Plane.004_19'],
      },
      {
        slug: 'curb-modular-short',
        name: 'Cordolo modulare corto',
        role: 'curb',
        footprint: 1.14,
        budget: 'curb',
        nodes: ['Plane.003_18'],
      },
      {
        slug: 'sign-modular',
        name: 'Segnale modulare',
        role: 'sign',
        height: 2.4,
        budget: 'sign',
        nodes: ['Cylinder_14'],
      },
    ],
  },
  {
    // cartelli europei veri: sei facce leggibili, semplificate a 5k tri
    file: 'road_signs_pack.glb',
    usage: 'placed',
    assets: ['01', '02', '05', '09', '12', '14'].map((id, index) => ({
      slug: `sign-eu-${id}`,
      name: `Cartello europeo ${id}`,
      role: 'sign',
      height: 2.9,
      budget: 'sign',
      nodes: [`vm_ST_sign_${id}`],
      variant: index,
    })),
  },
  // CC BY-NC: entra nel repo con attribuzione, ma il caricatore lo esclude
  // quando `VITE_COMMERCIAL_BUILD=1`.
  {
    file: 'tall_green_field.glb',
    usage: 'placed',
    assets: [
      {
        slug: 'field-tall-green',
        name: 'Campo alto e verde',
        role: 'field',
        footprint: 16.35,
        budget: 'field',
        nonCommercial: true,
      },
    ],
  },
  {
    file: 'modular_bridge__low_poly__game_ready.glb',
    usage: 'reserve',
    assets: [
      {
        slug: 'bridge-modular',
        name: 'Ponte modulare',
        role: 'bridge',
        footprint: 18,
        budget: 'bridge',
      },
    ],
  },
  {
    file: 'highway_bridge_chinese_style.glb',
    usage: 'reserve',
    assets: [
      {
        slug: 'bridge-highway',
        name: 'Ponte autostradale',
        role: 'bridge',
        footprint: 20,
        budget: 'bridge',
        nonCommercial: true,
      },
    ],
  },

  // --- altre riserve: nel repo, non caricate all'avvio ----------------------
  { file: 'big_terrain.glb', usage: 'reserve', pack: { total: 30000, texture: 512, role: 'spare', height: 12, name: 'Terreno grande' } },
  { file: 'terrain.glb', usage: 'reserve', pack: { total: 24000, texture: 512, role: 'spare', height: 8, name: 'Terreno' } },
  { file: 'terrain (1).glb', usage: 'reserve', pack: { total: 30000, texture: 512, role: 'spare', height: 8, name: 'Terreno (FNG)' } },
  { file: 'road_terrain.glb', usage: 'reserve', pack: { total: 6000, texture: 512, role: 'spare', height: 3, name: 'Terreno di strada' } },
  { file: 'snow_road_raw_scan_freebie.glb', usage: 'reserve', pack: { total: 30000, texture: 512, role: 'spare', height: 4, name: 'Strada innevata' } },
  { file: 'hq_tracks_in_wet_sand_and_mud.glb', usage: 'reserve', pack: { total: 30000, texture: 512, role: 'spare', height: 3, name: 'Tracce nel fango' } },
  { file: 'realistic_walkway.glb', usage: 'reserve', pack: { total: 12000, texture: 512, role: 'spare', height: 1, name: 'Passerella' } },
  { file: 'electric_light_pole.glb', usage: 'reserve', pack: { total: 8000, texture: 512, role: 'spare', height: 9, name: 'Palo elettrico' } },
  { file: 'sci-fi_path_light_pole_low_poly.glb', usage: 'reserve', pack: { total: 900, texture: 512, role: 'spare', height: 4, name: 'Lampione da sentiero' } },
  { file: 'rain_drops_circles__download__like_please.glb', usage: 'reserve', pack: { total: 100, texture: 256, role: 'spare', height: 0.5, name: 'Cerchi di pioggia' } },
  { file: 'falling_snow_loop.glb', usage: 'reserve', pack: { total: 1800, texture: 256, role: 'spare', height: 3, name: 'Neve che cade' } },
  { file: 'santa_maria_del_rosario_venice_italy.glb', usage: 'reserve', pack: { total: 30000, texture: 512, role: 'spare', height: 18, name: 'Chiesa (Venezia)' } },
  { file: 'via_s._gemini_viterbo_-_italy.glb', usage: 'reserve', pack: { total: 30000, texture: 512, role: 'spare', height: 8, name: 'Via S. Gemini' } },
  { file: 'low_poly_tree_scene_free.glb', usage: 'reserve', pack: { total: 40000, texture: 512, role: 'spare', height: 15, name: 'Scena di bosco' } },
  { file: 'old_street_pack.glb', usage: 'reserve', pack: { total: 9000, texture: 512, role: 'spare', height: 7, name: 'Vecchio quartiere' } },
  { file: 'road__highway.glb', usage: 'reserve', pack: { total: 9000, texture: 512, role: 'spare', height: 6, name: 'Svincolo autostradale' } },
  { file: 'city_infrastructure_map_3.glb', usage: 'reserve', pack: { total: 30000, texture: 1024, role: 'spare', height: 16.5, name: 'Infrastruttura urbana' } },
];

/** Licenze che permettono di versionare il file nel repository. */
const REDISTRIBUTABLE = /^(CC-BY(-SA|-NC)?-4\.0|CC0)/i;

const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  // l'estensione meshopt scrive gli accessor al salvataggio e ha bisogno
  // dell'encoder registrato sull'IO (vedi EXTMeshoptCompression)
  .registerDependencies({ 'meshopt.encoder': MeshoptEncoder });

const log = (msg) => console.log(msg);

function slugify(text) {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function meshTriangles(document) {
  let tris = 0;
  for (const mesh of document.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const indices = prim.getIndices();
      const position = prim.getAttribute('POSITION');
      if (!position) continue;
      tris += Math.round((indices ? indices.getCount() : position.getCount()) / 3);
    }
  }
  return tris;
}

/** I nodi diretti del contenitore più affollato: nei pack è dove stanno i modelli. */
function packNodes(document) {
  let best = null;
  for (const node of document.getRoot().listNodes()) {
    const children = node.listChildren();
    if (!best || children.length > best.listChildren().length) best = node;
  }
  return best ? best.listChildren() : [];
}

function subtreeMaterials(node) {
  const names = new Set();
  const visit = (entry) => {
    const mesh = entry.getMesh();
    if (mesh) for (const prim of mesh.listPrimitives()) names.add(prim.getMaterial()?.getName() ?? '');
    for (const child of entry.listChildren()) visit(child);
  };
  visit(node);
  return [...names];
}

function worldSize(node) {
  const box = getBounds(node);
  return {
    width: box.max[0] - box.min[0],
    height: box.max[1] - box.min[1],
    depth: box.max[2] - box.min[2],
  };
}

/**
 * Dimensioni finali nel gioco.
 *
 * I modelli verticali (alberi, case) si normalizzano sull'altezza. I piani di
 * terreno fotogrammetrici hanno altezza quasi zero: normalizzarli sull'asse Y
 * li farebbe diventare larghi chilometri. Per quelli si usa `footprint`, cioè
 * la dimensione orizzontale.
 */
function normalizedSize(size, entry) {
  if (entry.footprint) {
    const scale = entry.footprint / Math.max(size.width, size.depth, 0.001);
    return {
      width: size.width * scale,
      height: size.height * scale,
      depth: size.depth * scale,
      scaleTo: entry.footprint,
      normalize: 'footprint',
    };
  }
  const target = entry.height ?? 1;
  const scale = target / Math.max(size.height, 0.0001);
  return {
    width: size.width * scale,
    height: size.height * scale,
    depth: size.depth * scale,
    scaleTo: undefined,
    normalize: 'height',
  };
}

function stripUnlit(document) {
  for (const material of document.getRoot().listMaterials()) {
    const unlit = material.getExtension('KHR_materials_unlit');
    if (unlit) unlit.dispose();
  }
}

/**
 * Rende compatibili le primitive per `join`.
 *
 * Gli scan Sketchfab spesso hanno una mesh per ogni pezzo della scena con
 * attributi leggermente diversi (un pezzo con le tangenti, uno con UV2, uno
 * senza normali). `join` allora rinuncia e la semplificazione lavora su 22
 * mesh separate: un campo di fili d'erba resta a 450.000 triangoli. Qui si
 * tolgono gli attributi che non servono e si fondono le primitive dello stesso
 * materiale, così meshoptimizer può davvero scendere al budget.
 */
function unifyForJoin(document) {
  for (const mesh of document.getRoot().listMeshes()) {
    for (const primitive of mesh.listPrimitives()) {
      for (const name of ['TANGENT', 'TEXCOORD_1', 'TEXCOORD_2', 'COLOR_0', 'JOINTS_0', 'WEIGHTS_0']) {
        if (primitive.getAttribute(name)) primitive.setAttribute(name, null);
      }
      for (const target of primitive.listTargets()) primitive.removeTarget(target);
    }
  }
}

function isolate(document, names) {
  const root = document.getRoot();
  const scene = document.createScene('asset');
  const selected = [];
  for (const name of names) {
    const node = root.listNodes().find((entry) => entry.getName() === name);
    if (!node) throw new Error(`nodo "${name}" non trovato`);
    // Nel pack il nodo eredita scala e rotazione dai contenitori Sketchfab
    // (`0.01` sui cartelli, `-90°` sul modello): togliendolo dal padre senza
    // cuocere la world matrix diventerebbe 100 volte piú grande o coricato.
    selected.push({ node, world: node.getWorldMatrix() });
  }
  for (const entry of selected) {
    const node = entry.node;
    const parent = node.getParentNode();
    if (parent) parent.removeChild(node);
    node.setMatrix(entry.world);
    scene.addChild(node);
  }
  for (const other of root.listScenes()) if (other !== scene) other.dispose();
  return scene;
}

/**
 * Semplifica al budget richiesto.
 *
 * Il rapporto da solo non basta: meshoptimizer si ferma quando l'errore supera
 * la soglia, e su uno scan stradale con dettaglio fine resta al 30% dei
 * triangoli anche chiedendone l'1,5%. Si allenta l'errore a ogni giro, così un
 * modello di riserva da 2 milioni di triangoli scende davvero sotto il MB.
 */
async function simplifyTo(document, targetTris) {
  let tris = meshTriangles(document);
  if (tris <= targetTris) return tris;
  for (const error of [0.01, 0.05, 0.15, 0.4, 1]) {
    const ratio = Math.max(0.004, (targetTris / tris) * 0.96);
    await document.transform(
      simplify({ simplifier: MeshoptSimplifier, ratio, error, lockBorder: false }),
    );
    tris = meshTriangles(document);
    if (tris <= targetTris * 1.12) break;
  }
  return tris;
}

/** PBR + texture ridotte: una volta sola per file, prima di clonare i modelli. */
async function prepareSurface(document, textureSize) {
  await document.transform(metalRough());
  stripUnlit(document);
  await document.transform(prune(), dedup(), weld());
  if (textureSize > 0) {
    await document.transform(
      textureCompress({
        encoder: sharp,
        targetFormat: 'webp',
        resize: [textureSize, textureSize],
        quality: 82,
      }),
    );
  }
  await document.transform(prune(), dedup());
}

/** Geometria compatta: quantizzazione + meshopt (decoder incluso in three). */
async function compressGeometry(document) {
  await document.transform(quantize(), prune(), dedup());
  await document.transform(meshopt({ encoder: MeshoptEncoder, level: 'high' }));
}

function setProvenance(document, meta) {
  const asset = document.getRoot().getAsset();
  asset.generator = 'molise-openworld worldkit importer';
  asset.extras = {
    title: meta.title,
    author: meta.author,
    license: meta.license,
    source: meta.source,
    note: 'Modello ottimizzato (geometria semplificata, texture ridotte, meshopt) per il gioco Molise Open World.',
  };
}

function buildAutoEntries(definition, document) {
  const nodes = packNodes(document);
  const entries = [];
  const mode = definition.auto;
  let index = 0;
  for (const node of nodes) {
    if (!node) continue;
    const name = node.getName() ?? `node-${index}`;
    const size = worldSize(node);
    const tris = (() => {
      let total = 0;
      const visit = (n) => {
        const mesh = n.getMesh();
        if (mesh) {
          for (const prim of mesh.listPrimitives()) {
            const indices = prim.getIndices();
            const position = prim.getAttribute('POSITION');
            if (!position) continue;
            total += Math.round((indices ? indices.getCount() : position.getCount()) / 3);
          }
        }
        for (const child of n.listChildren()) visit(child);
      };
      visit(node);
      return total;
    })();
    if (tris < 20) continue;
    index++;
    if (mode === 'plants') {
      // le targhette di testo del catalogo Sketchfab sono mesh, non piante
      const materials = subtreeMaterials(node);
      if (materials.some((material) => /^text/i.test(material)) || /^Text/i.test(name)) continue;
      // altezza reale del file (il pack è già in metri dopo la scala del padre),
      // con un minimo per non avere piante invisibili
      const height = Math.min(1.8, Math.max(0.3, size.height * 1.05));
      entries.push({
        slug: `veg-${String(index).padStart(2, '0')}`,
        name: `Sottobosco ${index}`,
        role: 'shrub',
        height: Number(height.toFixed(2)),
        budget: 'shrub',
        nodes: [name],
      });
    } else if (mode === 'forest') {
      if (/^rocks/i.test(name)) {
        entries.push({
          slug: `forest-rock-${String(index).padStart(2, '0')}`,
          name: `Sasso di bosco ${index}`,
          role: 'rock',
          height: 0.7 + (index % 4) * 0.3,
          budget: 'rock',
          nodes: [name],
        });
      } else {
        entries.push({
          slug: `distant-tree-${String(index).padStart(2, '0')}`,
          name: `Albero lontano ${index}`,
          role: 'tree-distant',
          height: name.startsWith('Tree_Branches') ? 5 : 8 + (index % 4),
          budget: 'distantTree',
          nodes: [name],
        });
      }
    } else if (mode === 'signs') {
      entries.push({
        slug: `sign-${slugify(name) || index}`,
        name: `Cartello stradale ${index}`,
        role: 'sign',
        height: 2.2,
        budget: 'sign',
        nodes: [name],
      });
    }
  }
  return entries;
}

function resolveDefinition(definition) {
  if (definition.assets) return definition.assets;
  return [];
}

async function main() {
  if (!checkOnly) await mkdir(MODEL_DIR, { recursive: true });
  await MeshoptEncoder.ready;
  await MeshoptSimplifier.ready;

  const available = new Set((await readdir(SRC_DIR)).filter((f) => f.endsWith('.glb')));
  const manifest = {
    version: 1,
    generator: 'scripts/import-world-glb.mjs',
    note: 'GLB ottimizzati e versionati: ogni clone/pull e ogni build li contiene. Ruoli e crediti qui sotto.',
    models: [],
  };
  const credits = new Map();
  const skipped = [];
  let priorModels = [];
  if (merge) {
    try {
      const prior = JSON.parse(await readFile(MANIFEST, 'utf8'));
      priorModels = Array.isArray(prior.models) ? prior.models : [];
      for (const model of priorModels) credits.set(`prior:${model.slug}`, model.credits);
    } catch {
      log('! --merge: manifest precedente assente, riparto da zero');
    }
  }

  for (const definition of SOURCES) {
    if (!available.has(definition.file)) {
      log(`! manca ${definition.file}, salto`);
      continue;
    }
    if (fileArg && !definition.file.toLowerCase().includes(fileArg)) continue;
    const sourcePath = path.join(SRC_DIR, definition.file);
    log(`\n== ${definition.file} (${((await stat(sourcePath)).size / 1e6).toFixed(1)} MB)`);
    const document = await io.read(sourcePath);
    const asset = document.getRoot().getAsset();
    const extras = asset.extras ?? {};
    const licenseRaw = String(extras.license ?? 'sconosciuta');
    // i GLB Sketchfab scrivono "CC-BY-4.0 (http://…)": il manifest tiene
    // l'identificativo, l'URL resta nella pagina di attribuzione
    const license = licenseRaw.split(/\s+/)[0];
    if (!REDISTRIBUTABLE.test(license)) {
      skipped.push({ file: definition.file, title: extras.title ?? definition.file, license: licenseRaw });
      log(`   licenza ${license}: non ridistribuibile, resta fuori dal repo`);
      continue;
    }
    const meta = {
      title: String(extras.title ?? definition.file),
      author: String(extras.author ?? 'autore non indicato'),
      license,
      source: String(extras.source ?? ''),
    };
    credits.set(definition.file, meta);

    // Un solo passaggio di semplificazione per file: nei pack i modelli
    // condividono le stesse texture, e semplificare il documento intero evita
    // di rileggere 120 MB una volta per variante.
    // alcune famiglie (es. l'erba) dichiarano i singoli nodi ma condividono il
    // budget texture del file: per loro vale il ramo esplicito
    const pack = definition.assets ? null : definition.pack;
    if (pack) {
      const target = pack.total ?? 20000;
      const before = meshTriangles(document);
      if (pack.role) {
        // file "riserva": una sola mesh scena, nessuna estrazione
        const tris = await simplifyTo(document, target);
        await prepareSurface(document, pack.texture ?? 512);
        await compressGeometry(document);
        const scene = document.getRoot().listScenes()[0];
        const size = scene ? worldSize(scene) : { width: 1, height: 1, depth: 1 };
        const slug = slugify(pack.name ?? definition.file.replace(/\.glb$/i, ''));
        const nonCommercial = /-NC/i.test(license);
        setProvenance(document, meta);
        const bytes = await io.writeBinary(document);
        if (!checkOnly) await writeFile(path.join(MODEL_DIR, `${slug}.glb`), bytes);
        manifest.models.push({
          slug,
          name: pack.name ?? slug,
          role: pack.role,
          file: `models/${slug}.glb`,
          nodes: [],
          height: Number((pack.height ?? 2).toFixed(2)),
          width: Number(size.width.toFixed(2)),
          depth: Number(size.depth.toFixed(2)),
          triangles: tris,
          bytes: bytes.byteLength,
          usage: definition.usage,
          normalize: 'height',
          nonCommercial,
          credits: meta,
        });
        log(`   ${slug}: ${before} -> ${tris} tris, ${(bytes.byteLength / 1e6).toFixed(2)} MB`);
        continue;
      }

      const autoEntries = buildAutoEntries(definition, document);
      const entryNames = new Set(autoEntries.flatMap((entry) => entry.nodes));
      // toglie dalla scena i nodi che non diventano asset (piani d'appoggio,
      // terra, oggetti minuscoli) prima di semplificare: non devono rubare
      // budget né finire nelle texture
      for (const node of packNodes(document)) {
        if (!entryNames.has(node.getName())) {
          const parent = node.getParentNode();
          if (parent) parent.removeChild(node);
        }
      }
      const tris = await simplifyTo(document, target);
      // le texture si riducono una volta sola: i cloni condividono le immagini
      // già compresse, quindi non si paga 44 volte lo stesso lavoro
      await prepareSurface(document, pack.texture ?? 512);
      log(`   pack: ${before} -> ${tris} tris, ${autoEntries.length} modelli`);

      for (const entry of autoEntries) {
        if (only && !entry.slug.toLowerCase().includes(only[0]) && !only.some((o) => entry.slug.toLowerCase().includes(o))) {
          continue;
        }
        const copy = cloneDocument(document);
        isolate(copy, entry.nodes);
        await copy.transform(prune(), dedup());
        unifyForJoin(copy);
        // le primitive dello stesso materiale diventano una draw call sola
        try {
          await copy.transform(join({ keepNamed: false }));
        } catch {
          // attributi non compatibili: restano più parti, nessun problema
        }
        await copy.transform(prune(), dedup());
        await compressGeometry(copy);
        setProvenance(copy, { ...meta, title: entry.name });
        const bytes = await io.writeBinary(copy);
        if (!checkOnly) await writeFile(path.join(MODEL_DIR, `${entry.slug}.glb`), bytes);
        const size = (() => {
          const scene = copy.getRoot().listScenes()[0];
          return scene ? worldSize(scene) : { width: 1, height: 1, depth: 1 };
        })();
        manifest.models.push({
          slug: entry.slug,
          name: entry.name,
          role: entry.role,
          file: `models/${entry.slug}.glb`,
          // ogni file esportato contiene un solo modello: il runtime non deve
          // cercare nodi che `join` ha rinominato o fuso
          nodes: [],
          height: Number(entry.height.toFixed(2)),
          width: Number(((size.width / Math.max(size.height, 0.0001)) * entry.height).toFixed(2)),
          depth: Number(((size.depth / Math.max(size.height, 0.0001)) * entry.height).toFixed(2)),
          triangles: (() => {
            let total = 0;
            for (const mesh of copy.getRoot().listMeshes()) {
              for (const prim of mesh.listPrimitives()) {
                const indices = prim.getIndices();
                const position = prim.getAttribute('POSITION');
                if (!position) continue;
                total += Math.round((indices ? indices.getCount() : position.getCount()) / 3);
              }
            }
            return total;
          })(),
          bytes: bytes.byteLength,
          usage: definition.usage,
          normalize: 'height',
          nonCommercial: /-NC/i.test(license),
          credits: meta,
        });
        log(`   ${entry.slug} (${entry.role}): ${(bytes.byteLength / 1e3).toFixed(0)} KB`);
      }
      continue;
    }

    for (const entry of resolveDefinition(definition)) {
      if (only && !entry.slug.toLowerCase().includes(only[0]) && !only.some((o) => entry.slug.toLowerCase().includes(o))) {
        continue;
      }
      const copy = cloneDocument(document);
      if (entry.nodes) isolate(copy, entry.nodes);
      await copy.transform(prune(), dedup());
      await prepareSurface(copy, definition.pack?.texture ?? BUDGET[entry.budget ?? 'spare'].texture);
      unifyForJoin(copy);
      try {
        await copy.transform(join({ keepNamed: false }));
      } catch {
        // vedi sopra
      }
      await copy.transform(prune(), dedup());
      const budget = BUDGET[entry.budget ?? 'spare'];
      const target = entry.tris ?? budget.tris;
      const tris = await simplifyTo(copy, target);
      await compressGeometry(copy);
      setProvenance(copy, { ...meta, title: entry.name });
      const bytes = await io.writeBinary(copy);
      if (!checkOnly) await writeFile(path.join(MODEL_DIR, `${entry.slug}.glb`), bytes);
      const scene = copy.getRoot().listScenes()[0];
      const size = scene ? worldSize(scene) : { width: 1, height: 1, depth: 1 };
      const slug = entry.slug;
      const finalSize = normalizedSize(size, entry);
      manifest.models.push({
        slug,
        name: entry.name,
        role: entry.role,
        file: `models/${slug}.glb`,
        nodes: [],
        height: Number(finalSize.height.toFixed(2)),
        width: Number(finalSize.width.toFixed(2)),
        depth: Number(finalSize.depth.toFixed(2)),
        normalize: finalSize.normalize,
        ...(finalSize.scaleTo ? { scaleTo: Number(finalSize.scaleTo.toFixed(2)) } : {}),
        ...(entry.hero ? { hero: true } : {}),
        triangles: tris,
        bytes: bytes.byteLength,
        usage: definition.usage,
        nonCommercial: Boolean(entry.nonCommercial || /-NC/i.test(license)),
        credits: meta,
      });
      log(`   ${slug} (${entry.role}): ${tris} tris, ${(bytes.byteLength / 1e6).toFixed(2)} MB`);
    }
  }

  if (checkOnly) {
    log('\n--check: nessun file scritto');
    return;
  }

  if (merge && priorModels.length) {
    const fresh = new Set(manifest.models.map((model) => model.slug));
    manifest.models = [
      ...priorModels.filter((model) => !fresh.has(model.slug)),
      ...manifest.models,
    ];
  }
  manifest.models.sort((a, b) => a.slug.localeCompare(b.slug));
  const total = manifest.models.reduce((sum, m) => sum + m.bytes, 0);
  manifest.bytes = total;
  await writeFile(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);

  // attribuzione generata dai metadati dentro i GLB (più affidabili della lista
  // testuale, che in due punti non coincide con l'autore reale)
  const lines = [
    '# World kit — crediti e licenze',
    '',
    'Modelli 3D della vegetazione, degli edifici e dell\u2019arredo di campagna.',
    'I GLB **sono versionati** in `public/worldkit/models/` (a differenza del city kit e',
    'delle auto): ogni clone e ogni build di produzione li contiene già. Sono',
    'ottimizzati dallo script `scripts/import-world-glb.mjs` (geometria semplificata,',
    'texture ridotte, meshopt) a partire dagli originali forniti dal proprietario.',
    '',
    'Tutti i modelli sono di terzi e richiedono attribuzione. Le licenze **CC BY** e',
    '**CC BY-SA** permettono la ridistribuzione con crediti; **CC BY-NC** consente',
    'solo uso non commerciale. I file con licenza *Sketchfab Standard* non sono',
    'ridistribuibili e non sono inclusi nel repository.',
    '',
    '| Modello | Autore | Fonte | Licenza |',
    '| --- | --- | --- | --- |',
  ];
  // I crediti si leggono dal manifest finale, non dalla mappa dei file letti:
  // con `--merge` la mappa contiene anche le voci di riserve poi rimosse, che
  // resterebbero per sempre in ATTRIBUTION.md.
  const creditByTitle = new Map();
  for (const model of manifest.models) {
    const credit = model.credits;
    const key = `${credit.title}|${credit.author}|${credit.license}|${credit.source}`;
    if (!creditByTitle.has(key)) creditByTitle.set(key, credit);
  }
  for (const meta of [...creditByTitle.values()].sort((a, b) => a.title.localeCompare(b.title))) {
    const source = meta.source ? `[Sketchfab](${meta.source})` : '—';
    lines.push(`| ${meta.title} | ${meta.author} | ${source} | ${meta.license} |`);
  }
  if (skipped.length) {
    lines.push('', '## Esclusi dal repository', '');
    lines.push('Questi modelli erano nello zip ma la loro licenza non permette di ridistribuire il file:', '');
    for (const item of skipped) lines.push(`- **${item.title}** — ${item.license}`);
  }
  lines.push(
    '',
    '## Come si rigenerano',
    '',
    'Estrai lo zip in `incoming-glb/` (cartella ignorata da git) e lancia:',
    '',
    '```bash',
    'npm run worldkit',
    '```',
    '',
    'Lo script riscrive i GLB e questo file dai metadati `asset.extras` di ogni modello.',
    '',
  );
  await writeFile(ATTRIBUTION, lines.join('\n'));

  log(`\nFatto: ${manifest.models.length} modelli, ${(total / 1e6).toFixed(1)} MB in public/worldkit/`);
  if (skipped.length) log(`Esclusi per licenza: ${skipped.map((s) => s.title).join(', ')}`);
}

if (checkOnly) {
  // in verifica si controlla il manifest già scritto, non si riscrive nulla
  const existing = JSON.parse(await readFile(MANIFEST, 'utf8'));
  const missing = [];
  for (const model of existing.models) {
    const file = path.join(OUT_DIR, model.file);
    try {
      await stat(file);
    } catch {
      missing.push(model.file);
    }
  }
  if (missing.length) {
    console.error(`Mancano ${missing.length} file: ${missing.join(', ')}`);
    process.exitCode = 1;
  } else {
    console.log(`Manifest ok: ${existing.models.length} modelli, ${(existing.bytes / 1e6).toFixed(1)} MB`);
  }
} else {
  try {
    await main();
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
}

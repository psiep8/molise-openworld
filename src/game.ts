import * as THREE from 'three';
import { FAR_TOWNS, GAME, HOME, START, VIEW_RADIUS, VILLAGES, latLonToWorld, worldToLatLon } from './config';
import { clamp, distance2, pointInPolygon, smoothstep, type Pt } from './geo/geo';
import { loadCanopy, type CanopyField } from './geo/canopy';
import { loadHeightfield, type Heightfield } from './geo/elevation';
import { OPEN_WORLD_DATA_PROVIDER, tileKey, WorldTileManager } from './geo/world-tiles';
import { WorldGround } from './geo/ground';
import {
  BuildingIndex,
  loadOsm,
  markTownSidewalks,
  prepareRoadElevations,
  RoadIndex,
  widenUnmappedRuralRoads,
  type OsmData,
} from './geo/osm';
import { ObstacleIndex } from './geo/obstacles';
import { OPEN_WORLD_IMAGERY, ImageryStreamer } from './world/imagery';
import { Terrain, setCloudShadow } from './world/terrain';
import { Landcover, monthForGameDay } from './world/landcover';
import { FarTerrain } from './world/far-terrain';
import { buildBuildings, setWindowGlow } from './world/buildings';
import { buildChurch } from './world/church';
import { buildDryStoneWalls } from './world/dry-stone';
import { buildFieldBoundaries, loadParcels, type Parcels } from './world/field-boundaries';
import { buildPowerLines } from './world/power-lines';
import { buildGuardrails } from './world/guardrails';
import { buildRoads, buildWater, extendBoundaryRoads, roadPolyline } from './world/roads';
import {
  StreetLights,
  buildRoadDrainage,
  buildSigns,
  buildStreetNames,
  buildStreetProps,
} from './world/street-furniture';
import { buildChurchPiazza } from './world/piazza';
import type { PavedArea } from './world/paved';
import { ScatterVegetation } from './world/scatter';
import { buildCityProps } from './world/city-props';
import { buildFarmsteads } from './world/farmsteads';
import { loadCityKit, type CityKit } from './world/citykit';
import { CarLibrary } from './world/car-library';
import { DEFAULT_LIGHTING, DEFAULT_SKY, DEFAULT_SUN, createSky, type SkyRig } from './world/sky';
import { CloudLayer } from './world/clouds';
import { Precipitation } from './world/precipitation';
import { GroundMist } from './world/mist';
import { GrassField } from './world/grass';
import {
  RealWeather,
  defaultWeather,
  isFogCode,
  sunPosition,
  weatherLabel,
  type SunPosition,
  type WeatherSnapshot,
} from './world/weather';
import {
  WEATHER_PRESETS,
  dayOfYear,
  isWeatherPreset,
  sunAtLocalTime,
  type WeatherPreset,
} from './environment/sun-clock';
import {
  PAINT_CHOICES,
  VEHICLES,
  allVehicles,
  clearImportedVehicles,
  getVehicle,
  importedCount,
  loadPaintFor,
  loadVehicleId,
  registerVehicle,
  savePaintFor,
  saveVehicleId,
  vehicleLabel,
} from './sim/vehicle-catalog';
import {
  MAX_IMPORTED_CARS,
  buildGarageScene,
  clearGarageRecords,
  loadGarageCars,
  readCarFile,
  readGarageRecord,
  saveGarageRecord,
  type GarageRecord,
  type LoadedCar,
} from './garage';
import { Player, type MoveInput } from './entities/player';
import { loadHumanAssets, type HumanAssets } from './entities/human-model';
import { Pedestrians } from './world/pedestrians';
import {
  BUILD_LABEL,
  HAIR_COLORS,
  HAIR_LABEL,
  HEIGHT_MAX,
  HEIGHT_MIN,
  OUTFITS,
  OUTFIT_STYLES,
  SEX_LABEL,
  SKINS,
  TONE_LABEL,
  appearanceSummary,
  outfitLabel,
  sanitizeAppearance,
  saveAppearance,
  type Appearance,
} from './entities/appearance';
import { findNearestProperty, loadProperty, saveProperty, type Property } from './world/property';
import { Vehicle } from './entities/vehicle';
import { Hud, type Mode } from './ui/hud';
import {
  createInitialWallet,
  deposit as depositCash,
  formatEuro,
  purchase as buyItem,
  withdraw as withdrawCash,
  type MoneyMethod,
  type Wallet,
} from './sim/economy';
import {
  VENUES,
  findNearestVenue,
  venueStatusLabel,
  type Venue,
  type VenueMenuItem,
} from './sim/venue-catalog';
import {
  advanceNeeds,
  applyNeedEffect,
  createInitialNeeds,
  needsWarning,
  sleepNeeds,
  type Needs,
} from './sim/needs';
import { advanceClock, formatGameClock, loadLifeSave, saveLifeSave, type LifeSave } from './sim/save';
import { MapRenderer } from './ui/minimap';
import type { CarInput } from './sim/car';
import { autopilotInput, followTarget } from './sim/autopilot';
import { buildRoadGraph, planRoute, type RoadGraph, type RouteResult } from './sim/routing';
import { PostPipeline } from './gfx/post';
import { loadPaintSaturation, setPaintSaturation } from './gfx/car-paint';
import { updateWind } from './gfx/wind';
import {
  QUALITY_PRESETS,
  isQualityLevel,
  loadQuality,
  nextQuality,
  readGpuProfile,
  saveQuality,
  type QualityLevel,
  type QualityPreset,
} from './gfx/quality';
import { GameAudio, engineVoice } from './audio/audio';

interface RoadPose {
  x: number;
  z: number;
  yaw: number;
  distance: number;
}

export interface Diagnostics {
  ready: boolean;
  running: boolean;
  mode: Mode;
  chunks: number;
  textured: number;
  detailed: number;
  fps: number;
  x: number;
  z: number;
  speed: number;
  keys: string[];
  tileErrors: number;
  quality: QualityLevel;
  renderScale: number;
  /** stringa della GPU letta dal driver: dice che preset aspettarsi */
  gpu: string;
  /** draw call e triangoli dell'ultimo frame (costo reale, non stimato) */
  drawCalls: number;
  triangles: number;
  /** gradini di degradazione automatica già applicati (0 = nessuno) */
  degraded: number;
  /** copertura del suolo: modalità effettiva, chunk locali pronti e in attesa */
  landcover: {
    mode: 'full' | 'base' | 'off';
    ready: boolean;
    local: number;
    pending: number;
    radius: number;
    month: number;
    chunks: number;
  } | null;
  route: { distance: number; label: string } | null;
  wallet: { cash: number; account: number; total: number; transactions: number };
  needs: { hunger: number; energy: number; fun: number };
  clock: { day: number; minutes: number; label: string };
  venue: string | null;
  /** asset del city kit caricati e arredo piazzato (null se il kit manca) */
  kit: {
    assets: number;
    trees: number;
    cars: number;
    hedges: number;
    bushes: number;
    reeds: number;
    rocks: number;
    wrecks: number;
    piazzas: number;
  } | null;
  errorCount: number;
  weather: {
    enabled: boolean;
    loading: boolean;
    code: number | null;
    cloudCover: number | null;
    error: string | null;
  } | null;
  errors: string[];
}

const nextFrame = (): Promise<void> => new Promise((r) => requestAnimationFrame(() => r()));

/** Velocità media per stimare i tempi in auto: ~40 km/h sulle strade dei paesi. */
const ROUTE_DRIVE_SPEED = 11.1;
/** Esposizione diurna: tarata sui materiali chiari del paese (intonaco, coppi, asfalto). */
const EXPOSURE_DAY = 0.62;

/**
 * Pose fisse del banco prova (`?bench=1`).
 *
 * Servono a confrontare prima/dopo ogni fase del piano realismo con la stessa
 * inquadratura, la stessa ora (16:00) e lo stesso meteo (sereno). Le coordinate
 * sono state scelte dai dati OSM/DEM reali:
 * - `road`: Strada Statale 157 della Valle del Biferno, tratto di campagna a
 *   ~1 km da Palata, con pendenza laterale di ~2,5 m su 20 m (camera inseguitrice);
 * - `hilltop`: crinale aperto a est di Palata, ~1550 m dal centro, 536 m slm;
 * - `piazza`: Piazza del Popolo a Palata, 20 m dal punto di partenza.
 */
export interface BenchView {
  id: 'road' | 'hilltop' | 'piazza';
  label: string;
  mode: Mode;
  x: number;
  z: number;
  yaw: number;
  pitch?: number;
}

export const BENCH_VIEWS: readonly BenchView[] = [
  {
    id: 'road',
    label: 'Strada di campagna · 80 km/h · camera inseguitrice',
    mode: 'drive',
    x: -63.2606,
    z: -2647.6485,
    yaw: 0.2444709,
  },
  {
    id: 'hilltop',
    label: 'Crinale aperto a est di Palata · a piedi · 360°',
    mode: 'walk',
    x: 2377.4,
    z: -1842.8,
    yaw: 1.29,
    pitch: -0.03,
  },
  {
    id: 'piazza',
    label: 'Piazza del Popolo, Palata · a piedi',
    mode: 'walk',
    x: 865.8,
    z: -2298.2,
    yaw: -2.26,
    pitch: 0,
  },
];

export interface BenchResult {
  view: BenchView['id'];
  label: string;
  mode: Mode;
  quality: QualityLevel;
  gpu: string;
  seconds: number;
  frames: number;
  fpsAvg: number;
  fpsMin: number;
  fpsP5: number;
  drawCallsAvg: number;
  drawCallsMax: number;
  trianglesAvg: number;
  trianglesMax: number;
  textures: number;
  textureMB: number;
  renderScale: number;
  pixelRatio: number;
  bufferWidth: number;
  bufferHeight: number;
  chunks: number;
  textured: number;
  detailed: number;
  degraded: number;
  x: number;
  z: number;
  yaw: number;
}

export class Game {
  private readonly canvas: HTMLCanvasElement;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly stereoCamera: THREE.PerspectiveCamera;
  private readonly timer = new THREE.Timer();
  private readonly hud = new Hud();
  private readonly player = new Player();
  private readonly car = new Vehicle();
  private readonly audio = new GameAudio();
  private readonly realWeather = new RealWeather();
  private stereo = false;

  private heights!: Heightfield;
  /** unica verità sulla quota calpestabile (DEM + strada + ponte) */
  private ground!: WorldGround;
  private canopy: CanopyField | null = null;
  /** confini di campo dal landcover (null se parcels.json manca) */
  private parcels: Parcels | null = null;
  private osm!: OsmData;
  private roadIndex!: RoadIndex;
  private buildingIndex!: BuildingIndex;
  /** pali, cartelli e tronchi: cilindri solidi per auto, pedoni e giocatore */
  private obstacles = new ObstacleIndex();
  /** guardrail correnti; si ricostruiscono se cambia il preset */
  private guardrailsGroup: THREE.Group | null = null;
  private terrain!: Terrain;
  private worldTileManager: WorldTileManager | null = null;
  private lastWorldTileX = Number.NaN;
  private lastWorldTileZ = Number.NaN;
  private landcover: Landcover | null = null;
  private sky!: SkyRig;
  private map!: MapRenderer;
  /**
   * Destinazioni fuori dal mondo giocabile (Termoli, Larino, Campobasso…):
   * non hanno geometria, ma la minimappa le indica con direzione e chilometri.
   */
  private readonly mapTargets = FAR_TOWNS.map((t) => {
    const w = latLonToWorld(t.lat, t.lon);
    return { name: t.name, x: w.x, z: w.z };
  });
  /** fattore di zoom manuale della minimappa (rotella del mouse) */
  private mapZoom = 1;
  private minimapLabel = '';
  private roadGraph?: RoadGraph;
  private route: RouteResult | null = null;
  private routeDestination: Pt | null = null;
  private routeLabel = '';
  private routeBeacon?: THREE.Group;
  private lastRouteOrigin: Pt | null = null;
  private lastRouteTime = 0;
  private garage: Property | null = loadProperty();
  private humanAssets: HumanAssets | null = null;
  private pedestrians: Pedestrians | null = null;

  // --- modalità vita: denaro solo virtuale, bisogni, orologio --------------
  private wallet: Wallet = createInitialWallet();
  private needs: Needs = createInitialNeeds();
  private gameDay = 1;
  private gameMinutes = 8 * 60;
  /** Minuti di gioco per secondo reale (0,5 = un'ora ogni due minuti). */
  private readonly gameMinutesPerSecond = 0.5;
  private saveClock = 0;
  private lifeSave: LifeSave | null = null;
  private walletVisible = false;
  private venueOpen: Venue | null = null;
  private pendingItem: VenueMenuItem | null = null;
  private venuePanelVisible = false;

  private mode: Mode = 'walk';
  /** Ultimo input di guida: lo usano fisica, audio e HUD nello stesso frame. */
  private driveInput: CarInput | null = null;
  private loaded = false;
  private running = false;
  private keys = new Set<string>();
  private pointerLocked = false;
  private thirdPerson = false;
  private camYawOffset = 0;
  private camPitch = 0;
  private camDistance = 8.8;
  /** 0 inseguitrice · 1 alta da cartolina · 2 cofano */
  private driveCam = 0;
  /** Autopilota di strada (tasto O): l'auto segue la carreggiata da sola. */
  private autopilot = false;
  private bobPhase = 0;
  private idleAngle = 2.2;
  private lastHud = 0;
  private lastTick = 0;
  private fps = 60;
  private fpsFrames = 0;
  private fpsElapsed = 0;
  private tileErrors = 0;
  private qualityLevel: QualityLevel = 'high';
  private quality: QualityPreset = QUALITY_PRESETS.high;
  /** stringa della GPU, solo per la diagnostica */
  private gpuName = '';
  // --- banco prova (`?bench=1`): pose fisse e misurazioni riproducibili ----
  private bench = false;
  /** sonda A/B del banco: forza `landcover` senza cambiare preset */
  private lcOverride: 'off' | 'base' | 'full' | null = null;
  private benchViewIndex = -1;
  private benchStats: BenchResult | null = null;
  private benchCollect: {
    startAt: number;
    endAt: number;
    frames: number[];
    calls: number[];
    tris: number[];
  } | null = null;
  private post?: PostPipeline;
  private renderScale = 1;
  private lastQualityCheck = 0;
  /**
   * Degradazione automatica per i PC che non reggono nemmeno il preset scelto.
   *
   * Il resolution scaling da solo non basta: su una iGPU vecchia scendere a
   * 0,6× non salva un frame che paga 14.000 alberi in ombra. Qui, dopo qualche
   * secondo sotto i 26 fps con la scala già al minimo, si spengono gli effetti
   * uno alla volta (ombre → erba → meteo → dettaglio satellite). È `sticky`:
   * non torna indietro da sola, per non far ballare la grafica fra due stati.
   */
  private degradeStep = 0;
  private slowChecks = 0;
  /** moltiplicatore dell'erba: la degradazione lo porta a 0 senza ricostruire il mondo */
  private grassScale = 1;
  /** raggio di streaming corrente: parte dal preset e scende se serve */
  private viewRadius = VIEW_RADIUS;
  /** montagne lontane oltre il DEM (null finché il mondo non è caricato) */
  private farTerrain: FarTerrain | null = null;
  private weatherFxOn = true;
  private clouds!: CloudLayer;
  private precipitation!: Precipitation;
  private mist!: GroundMist;
  private grass?: GrassField;
  private streetLights?: StreetLights;
  private kit: CityKit | null = null;
  /** Auto di serie su GLB (`public/cars/`). */
  private carLibrary: CarLibrary | null = null;
  /** Manifest delle auto GLB: va atteso prima di chiedere un modello. */
  private carManifest: Promise<number> | null = null;
  /** Auto importate: id dello spec -> scena già normalizzata. */
  private readonly customCars = new Map<string, THREE.Object3D>();
  /** Gruppo degli alberi/cespugli: si ricostruisce quando cambia il preset. */
  private vegetation: ScatterVegetation | null = null;
  private vegetationGeneration = 0;
  private cityProps: {
    trees: number;
    cars: number;
    hedges: number;
    bushes: number;
    reeds: number;
    rocks: number;
    wrecks: number;
    houses: number;
    sheds: number;
    countryTrees: number;
  } = {
    trees: 0,
    cars: 0,
    hedges: 0,
    bushes: 0,
    reeds: 0,
    rocks: 0,
    wrecks: 0,
    houses: 0,
    sheds: 0,
    countryTrees: 0,
  };
  /** Sagrati lastricati: erba e alberi devono starne fuori. */
  private readonly pavedAreas: PavedArea[] = [];
  private nightFactor = 0;
  private lastEnvironment: THREE.Texture | null = null;
  private roadsGroup?: THREE.Group;
  private lastWetness = -1;
  private roadWetness = 0;
  private snowPack = 0;
  private surfaceGripScale = 1;
  private wheelSprayIntensity = 0;
  private realWeatherEnabled = false;
  private settingsVisible = false;
  private manualTime = false;
  private manualHour = 15;
  private manualWeather: WeatherPreset = 'auto';
  private readonly fogColor = new THREE.Color();
  private readonly tintA = new THREE.Color();
  private readonly tintB = new THREE.Color();
  private readonly sunTint = new THREE.Color();
  readonly errors: string[] = [];

  private readonly tmp1 = new THREE.Vector3();
  private readonly tmp2 = new THREE.Vector3();
  private readonly tmp3 = new THREE.Vector3();

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    // Il preset va scelto **prima** del renderer: l'MSAA si fissa alla
    // creazione del contesto WebGL e non si può più cambiare. Su `minimal`
    // costa memoria e banda per niente, quindi si crea senza antialias.
    const gpu = readGpuProfile();
    this.gpuName = gpu.renderer ?? '';
    this.qualityLevel = loadQuality(gpu);
    this.quality = QUALITY_PRESETS[this.qualityLevel];
    // `?bench=1` è il banco prova riproducibile: niente input, niente
    // degradazione adattiva, pose fisse. Non cambia il rendering.
    const params = new URLSearchParams(window.location.search);
    this.bench = params.get('bench') === '1';
    // Sonda A/B del solo banco prova (`?bench=1&lc=off|base|full`): permette di
    // misurare lo stesso build con e senza copertura del suolo, senza toccare i
    // preset veri. Fuori dal banco non ha effetto.
    const lc = params.get('lc');
    if (this.bench && (lc === 'off' || lc === 'base' || lc === 'full')) this.lcOverride = lc;
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: this.quality.antialias,
      powerPreference: 'high-performance',
    });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    // 0,72: con l'esposizione precedente (0,88) le facciate chiare e l'asfalto
    // finivano a ridosso del bianco e la scena sembrava lavata.
    this.renderer.toneMappingExposure = EXPOSURE_DAY;
    this.renderer.shadowMap.enabled = this.quality.shadows;
    // PCF: da three r186 `PCFSoftShadowMap` non esiste più e viene sostituito
    // in automatico; lo impostiamo direttamente per non lasciare un warning a
    // ogni avvio. I bordi restano morbidi grazie alla mappa grande dell'ultra.
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    // i contatori di `renderer.info` vengono azzerati a mano a ogni frame: con
    // il post-processing il reset automatico lasciava solo la passata finale
    // (1 draw call, 1 triangolo) e la diagnostica non diceva niente
    this.renderer.info.autoReset = false;

    this.camera = new THREE.PerspectiveCamera(68, window.innerWidth / window.innerHeight, 0.1, 12000);
    this.camera.rotation.order = 'YXZ';
    this.camera.position.set(START.x, 400, START.z);

    // Stereo camera for VR/dual-rendering
    this.stereoCamera = new THREE.PerspectiveCamera(68, window.innerWidth / window.innerHeight, 0.1, 12000);
    this.stereoCamera.rotation.order = 'YXZ';
    this.stereoCamera.position.set(START.x, 400, START.z);

    // giornata serena di partenza: la stessa foschia del meteo reale, così
    // l'orizzonte con le montagne lontane si vede fin dal primo frame
    this.scene.fog = new THREE.FogExp2(0xb9cbd8, 0.008);
    this.scene.background = new THREE.Color(0xb9cbd8);

    this.scene.add(this.player.avatar);
    this.scene.add(this.car.group);
    this.player.avatar.visible = false;

    this.realWeather.onChange = () => this.updateWeatherStatus();

    // il composer si crea **solo** se il preset lo usa: sui PC deboli i suoi
    // render target costano VRAM e banda anche quando restano spenti
    if (this.quality.post || this.quality.postAA) this.post = this.makePost();
    this.applyQuality(this.qualityLevel, false);

    // Ripristina la modalità vita (denaro virtuale, bisogni, orologio).
    const save = loadLifeSave();
    if (save) {
      this.lifeSave = save;
      this.wallet = save.wallet;
      this.needs = save.needs;
      this.gameDay = save.day;
      this.gameMinutes = save.minutes;
    }
    this.hud.setBalance(this.wallet);
    this.hud.setNeeds(this.needs);
    this.hud.setClock(this.gameDay, this.gameMinutes);
    this.hud.setNeedsWarning(needsWarning(this.needs));

    this.bindUi();
    this.bindInput();
    window.addEventListener('resize', this.onResize);

    window.addEventListener('error', (e) => this.errors.push(String(e.message)));
    window.addEventListener('unhandledrejection', (e) => this.errors.push(String(e.reason)));

    requestAnimationFrame(this.frame);
  }

  async init(): Promise<void> {
    try {
      const base = `${import.meta.env.BASE_URL}geo/`;
      this.hud.setLoading(0.03, 'Leggo la mappa del Molise…');
      // il kit si carica in parallelo alla mappa: se i file mancano (licenza non
      // scaricata, macchina nuova) il gioco parte lo stesso con le mesh procedurali.
      // Su `minimal` non si scarica affatto: i GLB del kit pesano decine di MB
      // per volta e il pavimento in asfalto procedurale basta su un PC da 15 fps.
      const kitPromise = this.quality.kit
        ? loadCityKit(
            `${import.meta.env.BASE_URL}citykit/`,
            `${import.meta.env.BASE_URL}draco/`,
            this.renderer.capabilities.getMaxAnisotropy(),
          ).catch((error) => {
            console.warn('city kit non caricato', error);
            return null;
          })
        : Promise.resolve(null);

      // auto di serie: il manifest è piccolo e si legge subito; i GLB veri si
      // scaricano solo quando si sceglie quella macchina (fino a 40 MB l'uno)
      const carLibrary = new CarLibrary(
        `${import.meta.env.BASE_URL}cars/`,
        `${import.meta.env.BASE_URL}draco/`,
        this.renderer.capabilities.getMaxAnisotropy(),
      );
      this.carLibrary = carLibrary;
      this.car.setCarLibrary(carLibrary);
      this.carManifest = carLibrary.loadManifest();
      void this.carManifest.then((count) => {
        if (count === 0) console.info('nessuna auto GLB in public/cars: restano le sagome procedurali');
      });

      const [heights, osm, kit, parcels, canopy] = await Promise.all([
        loadHeightfield(base),
        loadOsm(base),
        kitPromise,
        loadParcels(base),
        loadCanopy(base),
      ]);
      this.heights = heights;
      this.osm = osm;
      this.parcels = parcels;
      this.kit = kit;
      this.canopy = canopy;
      this.car.setKit(kit);
      this.hud.setLoading(0.32, 'Apro il garage delle auto importate…');
      await nextFrame();
      await this.loadCustomCars();
      this.hud.setLoading(0.34, 'Disegno strade, torrenti e paesi…');
      await nextFrame();

      this.buildingIndex = new BuildingIndex(osm.buildings);
      extendBoundaryRoads(osm, heights);
      // prima di costruire l'indice stradale: decide dove esistono davvero
      // marciapiedi, e la fisica deve leggere la stessa verità della grafica
      markTownSidewalks(osm.roads, this.buildingIndex);
      widenUnmappedRuralRoads(osm.roads);
      // ponti e gallerie prima dell'indice: grafica e fisica devono leggere
      // la stessa quota, altrimenti l'auto passa sotto il ponte che si vede
      prepareRoadElevations(osm.roads, heights);
      this.roadIndex = new RoadIndex(osm.roads, heights, roadPolyline);
      this.ground = new WorldGround(heights, this.roadIndex);
      this.roadGraph = buildRoadGraph(osm.roads);
      this.ensureHome();
      this.populateVehicles();
      const streets = buildRoads(osm, heights, this.renderer, this.roadIndex, this.buildingIndex, this.kit);
      this.roadsGroup = streets.group;
      this.scene.add(this.roadsGroup);
      // il pool di luci puntiformi costa un ciclo di illuminazione per fragment:
      // due lampioni accesi bastano a leggere la notte, sette no su una iGPU
      this.streetLights = new StreetLights(
        streets.lamps,
        heights,
        this.renderer,
        this.quality.pointLights,
      );
      this.scene.add(this.streetLights.group);
      // ogni lampione è un palo vero: si registra come ostacolo cilindrico
      for (const lamp of streets.lamps) this.obstacles.add(lamp.x, lamp.z, 0.16);
      this.scene.add(buildWater(osm, heights, this.renderer));

      this.scene.add(buildSigns(osm, heights, this.buildingIndex, this.renderer, this.kit, this.obstacles));
      this.scene.add(buildStreetNames(osm, heights, this.buildingIndex, this.obstacles));
      this.scene.add(buildStreetProps(osm, heights, this.buildingIndex, this.renderer, this.kit, this.qualityLevel));
      // chiusini e caditoie: due InstancedMesh da ~600.000 triangoli in mappa,
      // invisibili da lontano e ininfluenti sulla guida. Sui preset leggeri non si
      // costruiscono affatto.
      if (this.quality.drainage) this.scene.add(buildRoadDrainage(osm, heights));
      this.rebuildGuardrails();
      // la chiesa cerca un posto libero attorno al centro del paese; l'impronta
      // entra nell'indice prima di alberi, cespugli ed erba, così nessuno ci
      // cresce dentro (e il giocatore non la attraversa)
      const church = buildChurch(START, heights, this.roadIndex, this.buildingIndex, this.renderer);
      if (church) {
        this.scene.add(church.group);
        // il sagrato si costruisce prima di registrare l'impronta della chiesa:
        // così il controllo «non sopra un edificio» non trova la chiesa stessa
        if (this.kit) {
          const piazza = buildChurchPiazza(church, heights, this.roadIndex, this.buildingIndex, this.kit);
          if (piazza) {
            this.scene.add(piazza.group);
            this.pavedAreas.push(piazza.area);
          }
        }
        this.buildingIndex.add(church.footprint);
      }
      // casali di campagna: prima di vegetazione ed erba, così le impronte
      // entrano nell'indice e nessuno ci costruisce sopra
      let farmsteadStats = { houses: 0, sheds: 0, countryTrees: 0 };
      if (this.kit) {
        const farm = buildFarmsteads(
          osm,
          heights,
          this.roadIndex,
          this.buildingIndex,
          this.kit,
          this.qualityLevel,
        );
        this.scene.add(farm.group);
        farmsteadStats = { houses: farm.houses, sheds: farm.sheds, countryTrees: farm.trees };
      }
      this.scene.add(buildDryStoneWalls(osm, heights, this.roadIndex, this.buildingIndex, this.renderer));
      // confini di campo: muretti su bosco/prato, recinzioni su vigne e aie,
      // fossi sui corsi d'acqua minori — la geometria che il DEM non ha
      this.scene.add(
        buildFieldBoundaries(osm, heights, this.roadIndex, this.buildingIndex, this.renderer, this.parcels),
      );
      this.scene.add(buildPowerLines(osm, heights, this.roadIndex, this.buildingIndex));

      this.hud.setLoading(0.5, 'Costruisco le case…');
      await nextFrame();
      this.scene.add(
        buildBuildings(osm, heights, this.renderer, { detail: this.quality.buildingDetail }).group,
      );

      this.hud.setLoading(0.64, 'Pianto alberi e uliveti…');
      await nextFrame();
      this.vegetation = new ScatterVegetation(this.renderer, {
        osm,
        heights,
        roads: this.roadIndex,
        buildings: this.buildingIndex,
        paved: this.pavedAreas,
        trees: this.quality.trees,
        shrubs: this.quality.shrubs,
        shadows: this.quality.level === 'high' || this.quality.level === 'ultra',
        canopy: this.canopy,
        obstacles: this.obstacles,
      });
      this.scene.add(this.vegetation.group);
      // alberi di strada e auto in sosta del kit: solo dentro il paese e con un
      // tetto di istanze deciso dal preset (sono modelli fotorealistici, pesanti)
      if (this.kit) {
        const city = buildCityProps(osm, heights, this.roadIndex, this.buildingIndex, this.kit, this.qualityLevel);
        this.scene.add(city.group);
        this.cityProps = {
          trees: city.trees,
          cars: city.cars,
          hedges: city.hedges,
          bushes: city.bushes,
          reeds: city.reeds,
          rocks: city.rocks,
          wrecks: city.wrecks,
          ...farmsteadStats,
        };
      }
      this.grass = new GrassField(this.pavedAreas);
      this.scene.add(this.grass.group);

      const initial = getVehicle(loadVehicleId());
      const initialCustom = this.customCars.get(initial.id) ?? null;
      if (!initialCustom && initial.model && this.carLibrary) {
        this.hud.setLoading(0.695, `Preparo ${initial.name}…`);
        await nextFrame();
        // senza il manifest l'auto non è ancora in libreria e resterebbe la
        // sagoma di ripiego: il fetch locale è veloce ma non è gratis
        if (this.carManifest) await this.carManifest;
        await this.carLibrary.get(initial.model);
      }
      this.car.setSpec(initial, initialCustom);
      this.hud.setVehicleName(this.car.spec.name);
      this.hud.setVehicleSpec(vehicleLabel(this.car.spec));
      this.buildPaintSwatches();
      this.syncSettingsControls();

      this.hud.setLoading(0.7, 'Faccio scendere la gente in piazza…');
      await nextFrame();
      await this.loadCharacters();

      this.hud.setLoading(0.72, 'Alzo il cielo…');
      await nextFrame();
      this.sky = createSky(this.scene);
      this.clouds = new CloudLayer();
      this.scene.add(this.clouds.mesh);
      this.precipitation = new Precipitation();
      this.precipitation.group.visible = this.weatherFxOn;
      // gli schizzi devono cadere sulla superficie vera: la quota include già
      // asfalto, marciapiede e ponte, quindi non serve più indovinare +25 cm
      this.precipitation.setGroundSampler((x, z) => this.ground.heightAt(x, z) + 0.055);
      this.scene.add(this.precipitation.group);
      this.mist = new GroundMist();
      this.mist.group.visible = this.weatherFxOn;
      this.mist.setGroundSampler((x, z) => this.ground.heightAt(x, z));
      this.scene.add(this.mist.group);
      this.routeBeacon = this.createRouteBeacon();
      this.scene.add(this.routeBeacon);

      const imagery = new ImageryStreamer(OPEN_WORLD_IMAGERY, this.renderer.capabilities.getMaxAnisotropy(), () => {
        this.tileErrors++;
      });
      // il tetto di zoom va passato **qui**: `applyQuality` gira nel costruttore,
      // prima che il terreno esista, e senza questo argomento ogni preset
      // scaricava comunque tile z18 (era il vero costo nascosto dei preset bassi)
      this.hud.setLoading(0.74, 'Leggo la copertura del suolo…');
      this.landcover = new Landcover(
        this.renderer.capabilities.getMaxAnisotropy(),
        this.quality.landcover,
        this.quality.landcoverRadius,
      );
      // senza i file la promessa si risolve lo stesso e resta il vecchio shader
      await this.landcover.load();
      this.landcover.setSeason(monthForGameDay(this.gameDay));
      this.terrain = new Terrain(
        heights,
        imagery,
        this.renderer,
        this.quality.maxSatelliteZoom,
        this.landcover,
        osm.roads.filter((road) => road.tunnel && !road.bridge),
      );
      this.scene.add(this.terrain.group);
      const worldDataProvider = OPEN_WORLD_DATA_PROVIDER;
      if (worldDataProvider) {
        this.worldTileManager = new WorldTileManager(worldDataProvider, undefined, {
          onLoad: (tile) => {
            if (tile.elevation) {
              this.heights.setStreamedTile(tileKey(tile.tile), tile.elevation);
              this.terrain.refreshElevation();
            }
            const attribution = document.getElementById('attribution');
            if (attribution && !attribution.textContent?.includes(worldDataProvider.attribution)) {
              attribution.textContent += ` · ${worldDataProvider.attribution}`;
            }
          },
          onUnload: (tile) => {
            if (this.heights.removeStreamedTile(tileKey(tile))) this.terrain.refreshElevation();
          },
          onError: (tile, error) => {
            this.tileErrors++;
            console.error(`Errore caricamento tile geografica ${tileKey(tile)}:`, error);
          },
        });
      }
      // cintura di montagne oltre il DEM: una mesh, una draw call, nessuna texture
      this.farTerrain = new FarTerrain(heights);
      this.scene.add(this.farTerrain.group);

      this.spawnAtStart();
      this.hud.setLoading(0.78, 'Carico il terreno intorno a Palata…');
      await this.terrain.preload(
        this.player.position.x,
        this.player.position.z,
        Math.min(1600, this.viewRadius),
      );

      this.map = new MapRenderer(osm);
      const imageryAttribution =
        OPEN_WORLD_IMAGERY.id === 'local-open-imagery'
          ? OPEN_WORLD_IMAGERY.attribution
          : `Sentinel-2 cloudless © EOX IT Services GmbH (CC BY 4.0) · ${OPEN_WORLD_IMAGERY.attribution}`;
      const attribution = document.getElementById('attribution');
      if (attribution) {
        attribution.textContent = `© OpenStreetMap contributors · Immagini: ${imageryAttribution}`;
      }
      const startAttribution = document.getElementById('imagery-attribution');
      if (startAttribution) {
        startAttribution.textContent = `Immagini satellite: ${imageryAttribution}`;
      }
      // su `minimal` il radar parte vettoriale: niente tile satellitari da
      // scaricare e decodificare su una macchina che sta già a 20 fps
      if (this.quality.level === 'minimal') this.map.radar = false;
      this.map.onUpdate = () => {
        if (this.running && this.hud.mapVisible) this.drawBigMap();
      };

      const realWeather = this.readRealWeatherPref();
      this.hud.setRealWeather(realWeather);
      this.updateWeatherStatus();
      if (realWeather) this.setRealWeather(true, false);

      this.hud.setLoading(0.97, 'Quasi pronto…');
      await nextFrame();
      this.hud.hideLoading();
      this.loaded = true;

      // Banco prova: stessa ora, stesso meteo, niente HUD e niente input.
      // Il rendering è identico a una partita normale.
      if (this.bench) {
        this.setManualTime(true);
        this.setManualWeather('clear');
        this.setManualHour(16);
        this.hud.hideStart();
        this.hud.hideLoading();
        document.getElementById('hud')?.classList.add('hidden');
        document.getElementById('attribution')?.classList.add('hidden');
        this.running = true;
        void this.benchView(0);
        return;
      }

      const params = new URLSearchParams(window.location.search);
      const autostart = params.get('autostart');
      if (autostart === 'walk' || autostart === 'drive') {
        this.start(autostart);
      }
      if (params.get('imagery') === 'debug') this.startImageryDebug();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.errors.push(message);
      this.hud.showFatal(`Impossibile caricare il mondo.\n\n${message}\n\nSe mancano i file geo: esegui "npm run geo".`);
    }
  }

  /**
   * Carica i corpi umani e i pedoni. Se i modelli mancano o sono corrotti il
   * gioco resta giocabile con il rig procedurale: il Molise non si ferma.
   */
  private async loadCharacters(): Promise<void> {
    try {
      const base = `${import.meta.env.BASE_URL}models/`;
      this.humanAssets = await loadHumanAssets(base);
      this.player.useHumanModel(this.humanAssets);
      this.car.setRider(this.humanAssets, this.player.appearance);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.errors.push(`personaggi: ${message}`);
      console.warn('personaggi non caricati', err);
    }
  }

  private spawnPedestrians(): void {
    if (!this.humanAssets) return;
    const count = this.quality.pedestrians;
    if (count <= 0) return;
    this.pedestrians = new Pedestrians(
      this.humanAssets,
      this.osm,
      this.ground,
      this.player.position,
      count,
    );
    this.scene.add(this.pedestrians.group);
  }

  // -------------------------------------------------------------------------
  // setup
  // -------------------------------------------------------------------------
  private spawnAtStart(): void {
    const saved = this.lifeSave?.position;
    if (saved) {
      const safe = this.buildingIndex.resolveCircle(saved.x, saved.z, 0.6);
      this.player.spawn(safe.x, safe.z, 0, this.ground);
    } else {
      const pose = this.findRoadPose(START.x, START.z, 0.6) ?? {
        x: START.x,
        z: START.z,
        yaw: 0,
        distance: 0,
      };
      this.player.spawn(pose.x, pose.z, pose.yaw, this.ground);
    }
    this.player.avatar.visible = false;

    const pose = { x: this.player.position.x, z: this.player.position.z, yaw: this.player.yaw, distance: 0 };
    const aheadX = pose.x - Math.sin(pose.yaw) * 13;
    const aheadZ = pose.z - Math.cos(pose.yaw) * 13;
    // l'auto non deve nascere dentro un muro: cerca un punto libero nei paraggi
    const carPose = this.findRoadPose(aheadX, aheadZ, 1.7) ?? this.findRoadPose(aheadX, aheadZ, 0.9) ?? pose;
    this.car.reset(carPose.x, carPose.z, carPose.yaw, this.ground);

    this.terrain.update(this.player.position.x, this.player.position.z, this.viewRadius, true);
    this.spawnPedestrians();
    this.snapWalkCamera();
  }

  /** Casa iniziale unica: la prima casa del centro di Palata, se non è già scelta. */
  private ensureHome(): void {
    if (this.garage) return;
    for (const range of [40, 90, 160, 260]) {
      const property = findNearestProperty(this.buildingIndex, START.x, START.z, range);
      if (property) {
        this.garage = property;
        saveProperty(property);
        this.syncGarage();
        return;
      }
    }
  }

  /** Riempie la select del veicolo con il catalogo e le auto importate. */
  private populateVehicles(): void {
    this.fillSelect(
      'vehicle-select',
      allVehicles().map((v) => [v.id, v.id.startsWith('custom-') ? `★ ${v.name}` : v.name] as const),
    );
    const select = document.getElementById('vehicle-select') as HTMLSelectElement | null;
    if (select) select.value = this.car.spec.id;
    this.updateGarageCopy();
  }

  private updateGarageCopy(): void {
    const copy = document.getElementById('vehicle-count-copy');
    if (copy) {
      const imported = importedCount();
      copy.textContent =
        `${VEHICLES.length} modelli di serie${imported ? ` + ${imported} importate` : ''}: ` +
        'ingombri e parametri di guida propri. Le auto importate usano i materiali del GLB e non si tinteggiano.';
    }
    const status = document.getElementById('car-import-status');
    if (status) {
      const imported = importedCount();
      status.textContent =
        imported === 0
          ? 'Nessuna auto importata: scegli un GLB qui o trascinalo sulla finestra.'
          : `${imported} auto nel garage del browser (max ${MAX_IMPORTED_CARS}).`;
    }
    // ruotare il muso ha senso solo per le auto importate
    const flip = document.getElementById('btn-car-flip') as HTMLButtonElement | null;
    if (flip) flip.hidden = !this.car.spec.id.startsWith('custom-');
  }

  /** Legge dal browser le auto importate e le registra nel catalogo. */
  private async loadCustomCars(): Promise<void> {
    let cars: LoadedCar[] = [];
    try {
      cars = await loadGarageCars();
    } catch (error) {
      console.warn('garage: auto importate non disponibili', error);
      return;
    }
    for (const car of cars) {
      registerVehicle(car.record.spec);
      this.customCars.set(car.record.id, car.scene);
    }
  }

  /** Importa uno o più GLB (file picker o drag & drop) e li rende guidabili. */
  private async importCars(files: File[]): Promise<void> {
    const models = files.filter((file) => /\.glb$/i.test(file.name));
    if (models.length === 0) {
      this.hud.toast('Serve un file .glb esportato da Smooth Voxels', 3000);
      return;
    }
    if (importedCount() >= MAX_IMPORTED_CARS) {
      this.hud.toast(`Garage pieno: massimo ${MAX_IMPORTED_CARS} auto importate`, 3200);
      return;
    }

    let last: string | null = null;
    let failed = 0;
    for (const file of models) {
      if (importedCount() >= MAX_IMPORTED_CARS) break;
      try {
        const car = await readCarFile(file);
        registerVehicle(car.record.spec);
        this.customCars.set(car.record.id, car.scene);
        const saved = await saveGarageRecord(car.record);
        if (!saved) this.hud.toast('Auto caricata, ma il browser non ha permesso di salvarla', 3600);
        last = car.record.spec.id;
      } catch (error) {
        console.warn(`garage: ${file.name} non importata`, error);
        failed++;
      }
    }

    this.populateVehicles();
    if (last) this.selectVehicle(last);
    if (last) this.hud.toast(`Auto importata: ${this.car.spec.name}`, 3000);
    if (failed) this.hud.toast(`${failed} file non leggibili: esporta in GLB`, 3600);
  }

  /**
   * Ruota di 180° l'auto importata corrente: serve quando il GLB è stato
   * esportato con il muso dal lato sbagliato. La scelta resta nella scheda
   * del browser, quindi vale anche al riavvio.
   */
  private async flipImportedCar(): Promise<void> {
    const id = this.car.spec.id;
    const record = await readGarageRecord(id);
    if (!record) {
      this.hud.toast('Auto non trovata nel browser: importala di nuovo', 3200);
      return;
    }
    const next: GarageRecord = { ...record, flip: !record.flip };
    await saveGarageRecord(next);
    try {
      const scene = await buildGarageScene(next);
      this.customCars.set(id, scene);
      this.car.setSpec(next.spec, null);
      this.car.setSpec(next.spec, scene);
      this.hud.toast(next.flip ? `Muso ruotato: ${next.name} guarda avanti` : `Muso ripristinato: ${next.name}`, 3200);
    } catch (error) {
      console.warn('garage: muso non ruotabile', error);
      this.hud.toast('Non riesco a rileggere il modello', 3200);
    }
  }

  /** Svuota il garage del browser (i file su disco non si toccano). */
  private async clearImportedCars(): Promise<void> {
    const total = importedCount();
    if (total === 0) {
      this.hud.toast('Nessuna auto importata da eliminare', 2400);
      return;
    }
    if (!window.confirm(`Eliminare le ${total} auto importate dal browser?`)) return;
    await clearGarageRecords();
    clearImportedVehicles();
    this.customCars.clear();
    this.populateVehicles();
    this.selectVehicle(VEHICLES[0].id);
    this.hud.toast('Garage importato svuotato', 2400);
  }

  /** Cerca il punto più vicino su una strada asfaltata, con l'orientamento della carreggiata. */
  private findRoadPose(x: number, z: number, clearance = 0): RoadPose | null {
    let best: RoadPose | null = null;
    for (const road of this.osm.roads) {
      if (!road.paved) continue;
      for (let i = 0; i < road.points.length; i++) {
        const p = road.points[i];
        const d = distance2(x, z, p.x, p.z);
        if (best && d >= best.distance) continue;
        if (clearance > 0 && this.buildingIndex.resolveCircle(p.x, p.z, clearance).hit) continue;
        const next = road.points[Math.min(i + 1, road.points.length - 1)];
        const prev = road.points[Math.max(i - 1, 0)];
        const dx = next.x - prev.x;
        const dz = next.z - prev.z;
        const yaw = Math.atan2(-dx, -dz);
        best = { x: p.x, z: p.z, yaw, distance: d };
      }
    }
    return best;
  }

  /** Colonna luminosa sulla destinazione dell'itinerario. */
  private createRouteBeacon(): THREE.Group {
    const group = new THREE.Group();
    group.name = 'route-beacon';
    group.visible = false;
    const beam = new THREE.Mesh(
      new THREE.CylinderGeometry(2.6, 4.6, 90, 18, 1, true),
      new THREE.MeshBasicMaterial({
        color: 0x4ad7ff,
        transparent: true,
        opacity: 0.15,
        depthWrite: false,
        side: THREE.DoubleSide,
        fog: false,
      }),
    );
    beam.position.y = 45;
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(5.2, 6.6, 36),
      new THREE.MeshBasicMaterial({ color: 0x4ad7ff, transparent: true, opacity: 0.6, depthWrite: false }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.4;
    group.add(beam, ring);
    return group;
  }

  private bindUi(): void {
    document.getElementById('btn-walk')?.addEventListener('click', () => this.start('walk'));
    document.getElementById('btn-drive')?.addEventListener('click', () => this.start('drive'));
    document.getElementById('btn-settings')?.addEventListener('click', () => this.showSettings(!this.settingsVisible));
    document.getElementById('btn-settings-close')?.addEventListener('click', () => this.showSettings(false));
    document.getElementById('btn-weather-refresh')?.addEventListener('click', () => this.refreshWeather());
    const weatherToggle = document.getElementById('toggle-real-weather') as HTMLInputElement | null;
    weatherToggle?.addEventListener('change', () => this.setRealWeather(weatherToggle.checked));

    const timeToggle = document.getElementById('toggle-manual-time') as HTMLInputElement | null;
    timeToggle?.addEventListener('change', () => this.setManualTime(timeToggle.checked));
    const timeSlider = document.getElementById('time-slider') as HTMLInputElement | null;
    timeSlider?.addEventListener('input', () => this.setManualHour(Number(timeSlider.value)));
    const weatherSelect = document.getElementById('weather-select') as HTMLSelectElement | null;
    weatherSelect?.addEventListener('change', () => {
      if (isWeatherPreset(weatherSelect.value)) this.setManualWeather(weatherSelect.value);
    });
    const vehicleSelect = document.getElementById('vehicle-select') as HTMLSelectElement | null;
    vehicleSelect?.addEventListener('change', () => this.selectVehicle(vehicleSelect.value));
    const qualitySelect = document.getElementById('quality-select') as HTMLSelectElement | null;
    qualitySelect?.addEventListener('change', () => {
      if (isQualityLevel(qualitySelect.value)) this.applyQuality(qualitySelect.value);
    });
    // saturazione della vernice: vale per la carrozzeria di ogni auto, anche GLB
    const paintSat = document.getElementById('paint-sat') as HTMLInputElement | null;
    paintSat?.addEventListener('input', () => {
      const value = setPaintSaturation(Number(paintSat.value) / 100);
      const label = document.getElementById('paint-sat-value');
      if (label) label.textContent = `${Math.round(value * 100)}%`;
    });

    const carImport = document.getElementById('car-import') as HTMLInputElement | null;
    carImport?.addEventListener('change', () => {
      const files = Array.from(carImport.files ?? []);
      carImport.value = '';
      void this.importCars(files);
    });
    document.getElementById('btn-car-clear')?.addEventListener('click', () => void this.clearImportedCars());
    document.getElementById('btn-car-flip')?.addEventListener('click', () => void this.flipImportedCar());
    // trascinare un GLB sulla finestra lo importa anche senza aprire il menu
    window.addEventListener('dragover', (event) => {
      const transfer = event.dataTransfer;
      if (!transfer || !Array.from(transfer.types).includes('Files')) return;
      event.preventDefault();
      transfer.dropEffect = 'copy';
    });
    window.addEventListener('drop', (event) => {
      const files = Array.from(event.dataTransfer?.files ?? []);
      if (!files.some((file) => /\.glb$/i.test(file.name))) return;
      event.preventDefault();
      void this.importCars(files);
    });

    this.setupAppearanceUi();
    this.buildPaintSwatches();

    document.getElementById('btn-garage-set')?.addEventListener('click', () => this.setGarageFromHere());
    document.getElementById('btn-garage-go')?.addEventListener('click', () => this.goToGarage());
    document.getElementById('btn-garage-clear')?.addEventListener('click', () => this.clearGarage());

    document.getElementById('btn-wallet')?.addEventListener('click', () => this.showWallet(!this.walletVisible));
    document.getElementById('balance-panel')?.addEventListener('click', () => this.showWallet(!this.walletVisible));
    document.getElementById('btn-wallet-close')?.addEventListener('click', () => this.showWallet(false));
    document.getElementById('btn-save-now')?.addEventListener('click', () => {
      this.saveGame();
      this.hud.toast('Partita salvata', 2200);
    });
    document.getElementById('btn-reset-game')?.addEventListener('click', () => this.resetGame());
    document.getElementById('btn-venue-close')?.addEventListener('click', () => this.closeVenue());
    document.getElementById('venue-panel')?.addEventListener('click', (e) => {
      if (e.target === e.currentTarget) this.closeVenue();
    });

    document.getElementById('bigmap')?.addEventListener('click', (e) => this.pickDestination(e));
    this.syncSettingsControls();
  }

  /** Select e slider del personaggio, popolati dalle costanti di `appearance`. */
  private setupAppearanceUi(): void {
    this.fillSelect('sex-select', Object.entries(SEX_LABEL));
    this.fillSelect('build-select', Object.entries(BUILD_LABEL));
    this.fillSelect('skin-select', SKINS.map((s) => [String(s.color), s.label] as const));
    this.fillSelect('hair-style-select', Object.entries(HAIR_LABEL));
    this.fillSelect('hair-color-select', HAIR_COLORS.map((c) => [String(c.color), c.label] as const));
    this.fillSelect('outfit-select', OUTFIT_STYLES.map((style) => [style, OUTFITS[style].label] as const));
    this.fillSelect('outfit-tone-select', Object.entries(TONE_LABEL));

    const select = (id: string, apply: (value: string) => void): void => {
      const element = document.getElementById(id) as HTMLSelectElement | null;
      element?.addEventListener('change', () => apply(element.value));
    };

    select('sex-select', (value) => this.updateAppearance({ sex: value as Appearance['sex'] }));
    select('build-select', (value) => this.updateAppearance({ build: value as Appearance['build'] }));
    select('skin-select', (value) => this.updateAppearance({ skin: Number(value) }));
    select('hair-style-select', (value) => this.updateAppearance({ hairStyle: value as Appearance['hairStyle'] }));
    select('hair-color-select', (value) => this.updateAppearance({ hairColor: Number(value) }));
    select('beard-select', (value) => this.updateAppearance({ beard: value === 'yes' }));
    select('outfit-select', (value) => this.updateAppearance({ outfit: value as Appearance['outfit'] }));
    select('outfit-tone-select', (value) => this.updateAppearance({ tone: value as Appearance['tone'] }));

    const height = document.getElementById('height-slider') as HTMLInputElement | null;
    const heightValue = document.getElementById('height-value');
    const showHeight = (value: number): void => {
      if (heightValue) heightValue.textContent = `${value.toFixed(2).replace('.', ',')} m`;
    };
    height?.addEventListener('input', () => showHeight(Number(height.value)));
    height?.addEventListener('change', () => this.updateAppearance({ height: Number(height.value) }));
  }

  private fillSelect(id: string, entries: readonly (readonly [string, string])[]): void {
    const element = document.getElementById(id) as HTMLSelectElement | null;
    if (!element) return;
    element.textContent = '';
    for (const [value, label] of entries) {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = label;
      element.append(option);
    }
  }

  private updateAppearance(patch: Partial<Appearance>): void {
    const next = sanitizeAppearance({ ...this.player.appearance, ...patch });
    this.player.applyAppearance(next);
    this.car.setRider(this.humanAssets, next);
    saveAppearance(next);
    this.syncSettingsControls();
  }

  private buildPaintSwatches(): void {
    const host = document.getElementById('paint-swatches');
    if (!host) return;
    host.textContent = '';
    if (!this.car.paintable) {
      const note = document.createElement('small');
      note.className = 'settings-hint';
      note.textContent =
        'Questo modello non dichiara una carrozzeria dipinta: la tinta resterebbe su vetri e gomme, quindi si lascia com\'è.';
      host.append(note);
      return;
    }
    // se la tinta di fabbrica non è in palette, la si aggiunge come "Di fabbrica"
    const factory = this.car.spec.paint;
    const choices = PAINT_CHOICES.some((p) => p.color === factory)
      ? PAINT_CHOICES
      : [{ label: 'Di fabbrica', color: factory }, ...PAINT_CHOICES];
    for (const choice of choices) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'swatch';
      button.dataset.color = String(choice.color);
      button.title = choice.label;
      button.setAttribute('aria-label', `Colore ${choice.label}`);
      button.style.background = `#${choice.color.toString(16).padStart(6, '0')}`;
      button.addEventListener('click', () => this.setPaint(choice.color));
      host.append(button);
    }
    this.syncPaintSwatches();
  }

  private syncPaintSwatches(): void {
    const host = document.getElementById('paint-swatches');
    if (!host) return;
    const current = loadPaintFor(this.car.spec.id, this.car.spec.paint);
    for (const node of Array.from(host.children)) {
      const button = node as HTMLButtonElement;
      button.classList.toggle('active', Number(button.dataset.color) === current);
    }
  }

  private setPaint(color: number): void {
    if (!this.car.paintable) {
      this.hud.toast('Questo modello ha la vernice nell\'atlante: si può desaturare dalle impostazioni', 3000);
      return;
    }
    this.car.setPaint(color);
    savePaintFor(this.car.spec.id, color);
    this.syncPaintSwatches();
    const label = PAINT_CHOICES.find((p) => p.color === color)?.label ?? 'personalizzato';
    this.hud.toast(`Carrozzeria: ${label}`, 1800);
  }

  /** Tinta successiva con un tasto, senza aprire il menu. */
  private cyclePaint(): void {
    const current = loadPaintFor(this.car.spec.id, this.car.spec.paint);
    const index = PAINT_CHOICES.findIndex((p) => p.color === current);
    const next = PAINT_CHOICES[(index + 1) % PAINT_CHOICES.length];
    this.setPaint(next.color);
  }

  /** Sceglie l'edificio più vicino al giocatore come casa/garage. */
  private setGarageFromHere(): void {
    if (!this.loaded) return;
    const focus = this.mode === 'walk' ? this.player.position : this.car.position;
    this.setGarageAt(focus.x, focus.z, 22, 'Avvicinati a una casa del paese per sceglierla come garage');
  }

  /** Casa/garage a partire da un punto sulla mappa (Shift+clic) o dalla posizione. */
  private setGarageAt(x: number, z: number, range = 60, emptyMessage = 'Nessuna casa vicino a quel punto'): void {
    if (!this.loaded) return;
    const property = findNearestProperty(this.buildingIndex, x, z, range);
    if (!property) {
      this.hud.toast(emptyMessage, 2800);
      return;
    }
    this.garage = property;
    saveProperty(property);
    this.syncGarage();
    this.hud.toast(`Garage: ${property.label} · segnalibro salvato`, 3200);
  }

  private clearGarage(): void {
    if (!this.garage) return;
    this.garage = null;
    saveProperty(null);
    this.syncGarage();
    this.hud.toast('Segnalibro del garage rimosso', 2200);
  }

  /** Riporta giocatore e auto alla casa scelta, con l'auto parcheggiata in strada. */
  private goToGarage(): void {
    if (!this.loaded) return;
    if (!this.garage) {
      this.hud.toast('Prima scegli una casa: avvicinati a un edificio e premi T', 2800);
      return;
    }
    const { x, z, label } = this.garage;
    const spot = this.buildingIndex.resolveCircle(x, z, 2.4);
    const pose =
      this.findRoadPose(x, z, 1.7) ?? this.findRoadPose(x, z, 1.0) ?? { x, z, yaw: 0, distance: 0 };
    this.player.spawn(spot.x, spot.z, pose.yaw, this.ground);
    this.car.reset(pose.x, pose.z, pose.yaw, this.ground);
    this.mode = 'walk';
    this.hud.setMode('walk');
    this.player.avatar.visible = this.thirdPerson;
    this.camera.fov = 68;
    this.camera.updateProjectionMatrix();
    this.snapWalkCamera();
    this.terrain.update(this.player.position.x, this.player.position.z, this.viewRadius, true);
    this.hud.toast(`Sei al garage: ${label}`, 2800);
    if (this.hud.mapVisible) this.drawBigMap();
    if (this.routeDestination) this.recomputeRoute();
  }

  private syncGarage(): void {
    this.hud.setGarageStatus(
      this.garage
        ? `${this.garage.label} · segnalibro salvato sulla mappa`
        : 'Nessuna casa scelta: avvicinati a un edificio e premi T.',
    );
    if (this.hud.mapVisible) this.drawBigMap();
  }

  private syncSettingsControls(): void {
    const timeToggle = document.getElementById('toggle-manual-time') as HTMLInputElement | null;
    if (timeToggle) timeToggle.checked = this.manualTime;
    const timeSlider = document.getElementById('time-slider') as HTMLInputElement | null;
    if (timeSlider) timeSlider.value = String(this.manualHour);
    const weatherSelect = document.getElementById('weather-select') as HTMLSelectElement | null;
    if (weatherSelect) weatherSelect.value = this.manualWeather;
    const vehicleSelect = document.getElementById('vehicle-select') as HTMLSelectElement | null;
    if (vehicleSelect) vehicleSelect.value = this.car.spec.id;
    const qualitySelect = document.getElementById('quality-select') as HTMLSelectElement | null;
    if (qualitySelect) qualitySelect.value = this.qualityLevel;
    const paintSat = document.getElementById('paint-sat') as HTMLInputElement | null;
    if (paintSat) paintSat.value = String(Math.round(loadPaintSaturation() * 100));
    const paintSatValue = document.getElementById('paint-sat-value');
    if (paintSatValue) paintSatValue.textContent = `${Math.round(loadPaintSaturation() * 100)}%`;
    const qualityCopy = document.getElementById('quality-copy');
    if (qualityCopy) {
      const auto = this.degradeStep > 0 ? ' · ridotta automaticamente per gli fps' : '';
      qualityCopy.textContent =
        `${this.quality.hint}${auto}. ${this.quality.trees.toLocaleString('it-IT')} alberi: ` +
        'cambiando densità si rigenerano subito, insieme a erba, ombre ed effetti.';
    }
    this.hud.setManualTime(this.manualTime);
    this.hud.setTimeLabel(this.manualHour);

    // personaggio
    const look = this.player.appearance;
    const setValue = (id: string, value: string): void => {
      const element = document.getElementById(id) as HTMLSelectElement | null;
      if (element && element.value !== value) element.value = value;
    };
    setValue('sex-select', look.sex);
    setValue('build-select', look.build);
    setValue('skin-select', String(look.skin));
    setValue('hair-style-select', look.hairStyle);
    setValue('hair-color-select', String(look.hairColor));
    setValue('beard-select', look.beard ? 'yes' : 'no');
    setValue('outfit-select', look.outfit);
    setValue('outfit-tone-select', look.tone);
    const beard = document.getElementById('beard-select') as HTMLSelectElement | null;
    if (beard) beard.disabled = look.sex === 'donna';
    const height = document.getElementById('height-slider') as HTMLInputElement | null;
    if (height) {
      height.min = String(HEIGHT_MIN);
      height.max = String(HEIGHT_MAX);
      height.value = String(look.height);
    }
    const heightValue = document.getElementById('height-value');
    if (heightValue) heightValue.textContent = `${look.height.toFixed(2).replace('.', ',')} m`;
    this.hud.setAppearanceSummary(
      `${appearanceSummary(look)} · ${outfitLabel(look)} — ${OUTFITS[look.outfit].hint}. In gioco premi C per vederti in terza persona.`,
    );

    this.hud.setVehicleSpec(vehicleLabel(this.car.spec));
    this.syncPaintSwatches();
    this.updateGarageCopy();
    this.hud.setGarageStatus(
      this.garage
        ? `${this.garage.label} · segnalibro salvato sulla mappa`
        : 'Nessuna casa scelta: avvicinati a un edificio e premi T.',
    );
  }

  // -------------------------------------------------------------------------
  // atmosfera manuale / veicolo
  // -------------------------------------------------------------------------
  private setManualTime(enabled: boolean): void {
    this.manualTime = enabled;
    if (enabled && this.realWeatherEnabled) this.setRealWeather(false, false);
    this.hud.setManualTime(enabled);
    this.syncSettingsControls();
    if (enabled) {
      this.hud.toast(`Ora manuale ${this.formatHour(this.manualHour)} · ${this.weatherPresetLabel()}`, 3000);
    } else {
      this.restoreDefaultAtmosphere();
      this.hud.toast('Atmosfera del gioco ripristinata', 2400);
    }
    this.updateWeatherStatus();
  }

  private setManualHour(hour: number): void {
    this.manualHour = clamp(hour, 0, 24);
    this.hud.setTimeLabel(this.manualHour);
  }

  private setManualWeather(preset: WeatherPreset): void {
    this.manualWeather = preset;
    this.hud.toast(`Meteo: ${this.weatherPresetLabel()}`, 2000);
  }

  private formatHour(hour: number): string {
    const h = Math.floor(hour) % 24;
    const m = Math.round((hour - Math.floor(hour)) * 60);
    return `${String(h).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  }

  private weatherPresetLabel(): string {
    return this.manualWeather === 'auto' ? 'come il gioco' : WEATHER_PRESETS[this.manualWeather].label;
  }

  private selectVehicle(id: string): void {
    void this.applyVehicle(id);
  }

  /**
   * Cambio veicolo. Le auto GLB possono pesare decine di MB: si scaricano solo
   * ora, con un avviso, e la selezione più recente vince se l'utente cambia
   * idea mentre il file sta arrivando.
   */
  private vehicleRequest = 0;

  private async applyVehicle(id: string): Promise<void> {
    const spec = getVehicle(id);
    if (spec.id === this.car.spec.id) return;
    const request = ++this.vehicleRequest;
    const custom = this.customCars.get(spec.id) ?? null;
    if (!custom && spec.model && this.carLibrary) {
      if (!this.carLibrary.cached(spec.model)) this.hud.toast(`Carico ${spec.name}…`, 1800);
      if (this.carManifest) await this.carManifest;
      await this.carLibrary.get(spec.model);
      if (request !== this.vehicleRequest) return;
    }
    if (spec.id === this.car.spec.id) return;
    this.car.setSpec(spec, this.customCars.get(spec.id) ?? null);
    saveVehicleId(spec.id);
    this.audio.setVoice(engineVoice(spec));
    if (this.heights) {
      const { x, z, yaw } = this.car.state;
      this.car.reset(x, z, yaw, this.ground);
    }
    this.hud.setVehicleName(spec.name);
    this.hud.setVehicleSpec(vehicleLabel(spec));
    this.buildPaintSwatches();
    this.syncSettingsControls();
    this.hud.toast(`Veicolo: ${spec.name} · ${spec.blurb}`, 2800);
  }

  private cycleVehicle(): void {
    const vehicles = allVehicles();
    const index = vehicles.findIndex((v) => v.id === this.car.spec.id);
    this.selectVehicle(vehicles[(index + 1) % vehicles.length].id);
  }

  // -------------------------------------------------------------------------
  // vita quotidiana: interazioni, attività, denaro virtuale, bisogni
  // -------------------------------------------------------------------------
  private interact(): void {
    if (!this.loaded) return;
    const x = this.player.position.x;
    const z = this.player.position.z;
    const venue = findNearestVenue(x, z, 16);
    if (venue) {
      this.openVenue(venue);
      return;
    }
    if (this.garage && Math.hypot(this.garage.x - x, this.garage.z - z) < 22) {
      this.openHomePanel();
      return;
    }
    this.hud.toast('Nessuna attività qui vicino: avvicinati a un locale o a casa', 2600);
  }

  private venuePanel(): HTMLElement | null {
    return document.getElementById('venue-panel');
  }

  private showWallet(show: boolean): void {
    if (show && !this.loaded) return;
    this.walletVisible = show;
    document.getElementById('wallet-panel')?.classList.toggle('hidden', !show);
    if (show) {
      this.keys.clear();
      if (document.pointerLockElement) document.exitPointerLock();
      this.hud.setBalance(this.wallet);
    }
  }

  private saveGame(): void {
    if (!this.loaded) return;
    const position =
      this.mode === 'walk'
        ? { x: this.player.position.x, z: this.player.position.z }
        : { x: this.car.state.x, z: this.car.state.z };
    const save: LifeSave = {
      version: 1,
      wallet: this.wallet,
      needs: this.needs,
      day: this.gameDay,
      minutes: Math.floor(this.gameMinutes),
      position,
      savedAt: Date.now(),
    };
    if (saveLifeSave(save)) this.lifeSave = save;
  }

  private resetGame(): void {
    if (!window.confirm('Nuova partita? Il salvataggio locale della modalità vita, i movimenti e l\'aspetto verranno azzerati.')) {
      return;
    }
    try {
      const store = window.localStorage;
      const keys: string[] = [];
      for (let i = 0; i < store.length; i++) {
        const key = store.key(i);
        if (key && key.startsWith('molise.')) keys.push(key);
      }
      for (const key of keys) store.removeItem(key);
    } catch {
      // localStorage può essere disabilitato
    }
    window.location.reload();
  }

  private openVenue(venue: Venue): void {
    if (!this.loaded) return;
    this.venueOpen = venue;
    this.pendingItem = null;
    this.venuePanelVisible = true;
    this.keys.clear();
    if (document.pointerLockElement) document.exitPointerLock();
    this.venuePanel()?.classList.remove('hidden');

    const title = document.getElementById('venue-title');
    if (title) title.textContent = venue.name;
    const subtitle = document.getElementById('venue-subtitle');
    if (subtitle) subtitle.textContent = `${venue.category} · ${venue.openHours}`;

    const badge = document.getElementById('venue-badge');
    if (badge) {
      badge.textContent = venueStatusLabel(venue.status);
      badge.className = `venue-badge ${venue.status}`;
    }
    const note = document.getElementById('venue-note');
    if (note) {
      note.textContent = `${venue.note} Fonte: ${venue.source}. Verificato il ${venue.dateChecked}. Prezzi e menu sono fittizi.`;
    }

    const services = document.getElementById('venue-services');
    if (services) {
      services.textContent = '';
      for (const service of venue.services) {
        const chip = document.createElement('span');
        chip.className = 'venue-service';
        chip.textContent = service;
        services.append(chip);
      }
    }

    this.renderVenueBody(venue);
    this.renderVenueBalance();
  }

  private renderVenueBody(venue: Venue): void {
    const host = document.getElementById('venue-menu');
    const confirm = document.getElementById('venue-confirm');
    confirm?.classList.add('hidden');
    if (!host) return;
    host.textContent = '';

    if (venue.interaction === 'atm') {
      this.renderAtm(host);
      return;
    }

    if (venue.menu.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'venue-note';
      empty.textContent = 'Nessun servizio acquistabile in questa attività.';
      host.append(empty);
      return;
    }

    for (const item of venue.menu) {
      const row = document.createElement('div');
      row.className = 'venue-item';
      const copy = document.createElement('div');
      copy.className = 'venue-item-copy';
      const label = document.createElement('strong');
      label.textContent = item.label;
      const desc = document.createElement('small');
      desc.textContent = item.description;
      copy.append(label, desc);

      const action = document.createElement('div');
      action.className = 'venue-item-buy';
      const price = document.createElement('span');
      price.className = 'venue-price';
      price.textContent = item.priceCents === 0 ? 'Gratis' : formatEuro(item.priceCents);
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'text-btn';
      button.textContent = item.priceCents === 0 ? 'Fai' : 'Scegli';
      button.addEventListener('click', () => this.chooseItem(item));
      action.append(price, button);
      row.append(copy, action);
      host.append(row);
    }
  }

  private renderAtm(host: HTMLElement): void {
    const info = document.createElement('p');
    info.className = 'venue-note';
    info.textContent =
      'ATM SIMULATO: i movimenti avvengono solo tra contanti virtuali e conto virtuale del gioco. Nessuna banca reale è collegata.';
    host.append(info);

    const actions = document.createElement('div');
    actions.className = 'settings-actions';
    for (const amount of [5000, 10000, 20000]) {
      const depositBtn = document.createElement('button');
      depositBtn.type = 'button';
      depositBtn.className = 'text-btn';
      depositBtn.textContent = `Versa ${formatEuro(amount)}`;
      depositBtn.addEventListener('click', () => this.atmTransfer('deposit', amount));
      const withdrawBtn = document.createElement('button');
      withdrawBtn.type = 'button';
      withdrawBtn.className = 'text-btn';
      withdrawBtn.textContent = `Preleva ${formatEuro(amount)}`;
      withdrawBtn.addEventListener('click', () => this.atmTransfer('withdraw', amount));
      actions.append(depositBtn, withdrawBtn);
    }
    host.append(actions);
  }

  private atmTransfer(kind: 'deposit' | 'withdraw', amountCents: number): void {
    const venue = this.venueOpen;
    const place = venue?.name ?? 'ATM virtuale';
    const result =
      kind === 'deposit'
        ? depositCash(this.wallet, amountCents, place, Math.floor(this.gameMinutes), this.gameDay)
        : withdrawCash(this.wallet, amountCents, place, Math.floor(this.gameMinutes), this.gameDay);

    if (!result.ok) {
      this.hud.toast(
        kind === 'deposit' ? 'Non hai abbastanza contanti virtuali' : 'Conto virtuale insufficiente',
        2600,
      );
      return;
    }
    this.wallet = result.wallet;
    this.hud.setBalance(this.wallet);
    if (venue) this.renderVenueBalance();
    this.hud.toast(
      kind === 'deposit'
        ? `Versati ${formatEuro(amountCents)} sul conto virtuale`
        : `Prelevati ${formatEuro(amountCents)} in contanti virtuali`,
      2600,
    );
    this.saveGame();
  }

  private chooseItem(item: VenueMenuItem): void {
    const venue = this.venueOpen;
    if (!venue) return;
    if (item.priceCents === 0) {
      this.applyItemEffect(venue, item);
      this.hud.toast(`${item.label}: fatto · ${item.description}`, 2600);
      this.renderVenueBody(venue);
      this.renderVenueBalance();
      return;
    }
    this.pendingItem = item;
    this.renderConfirm(item);
  }

  private renderConfirm(item: VenueMenuItem): void {
    const box = document.getElementById('venue-confirm');
    if (!box) return;
    box.textContent = '';
    box.classList.remove('hidden');

    const cashAfter = this.wallet.cash - item.priceCents;
    const accountAfter = this.wallet.account - item.priceCents;
    const text = document.createElement('div');
    text.innerHTML =
      `<strong>${item.label}</strong> · ${formatEuro(item.priceCents)}<br>` +
      `Saldo dopo l'acquisto: contanti ${cashAfter >= 0 ? formatEuro(cashAfter) : 'fondi insufficienti'} · ` +
      `conto ${accountAfter >= 0 ? formatEuro(accountAfter) : 'fondi insufficienti'}<br>` +
      `<span class="venue-virtual">Acquisto simulato: nessun ordine o pagamento reale.</span>`;

    const actions = document.createElement('div');
    actions.className = 'venue-confirm-actions';
    const cashBtn = document.createElement('button');
    cashBtn.type = 'button';
    cashBtn.className = 'text-btn';
    cashBtn.textContent = 'Conferma in contanti';
    cashBtn.disabled = cashAfter < 0;
    cashBtn.addEventListener('click', () => this.confirmPurchase('contanti'));
    const accountBtn = document.createElement('button');
    accountBtn.type = 'button';
    accountBtn.className = 'text-btn';
    accountBtn.textContent = 'Conferma col conto virtuale';
    accountBtn.disabled = accountAfter < 0;
    accountBtn.addEventListener('click', () => this.confirmPurchase('conto'));
    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'text-btn';
    cancelBtn.textContent = 'Annulla';
    cancelBtn.addEventListener('click', () => {
      this.pendingItem = null;
      box.classList.add('hidden');
    });
    actions.append(cashBtn, accountBtn, cancelBtn);
    box.append(text, actions);
  }

  private confirmPurchase(method: MoneyMethod): void {
    const venue = this.venueOpen;
    const item = this.pendingItem;
    if (!venue || !item) return;

    const result = buyItem(this.wallet, {
      amountCents: item.priceCents,
      place: venue.name,
      description: item.label,
      method,
      category: item.product,
      gameTime: Math.floor(this.gameMinutes),
      day: this.gameDay,
    });

    if (!result.ok) {
      this.hud.toast('Fondi virtuali insufficienti: scegli un altro metodo o un prodotto più economico', 3200);
      return;
    }

    this.wallet = result.wallet;
    this.applyItemEffect(venue, item);
    this.pendingItem = null;
    document.getElementById('venue-confirm')?.classList.add('hidden');
    this.renderVenueBody(venue);
    this.renderVenueBalance();
    this.hud.setBalance(this.wallet);
    this.hud.toast(`${item.label} · −${formatEuro(item.priceCents)} (${method === 'contanti' ? 'contanti virtuali' : 'conto virtuale'})`, 3000);
    this.saveGame();
  }

  private applyItemEffect(venue: Venue, item: VenueMenuItem): void {
    if (item.needs) {
      this.needs = applyNeedEffect(this.needs, item.needs);
      this.hud.setNeeds(this.needs);
      this.hud.setNeedsWarning(needsWarning(this.needs));
    }
    if (item.outfit) {
      const look = sanitizeAppearance({ ...this.player.appearance, outfit: item.outfit as Appearance['outfit'] });
      this.player.applyAppearance(look);
      this.car.setRider(this.humanAssets, look);
      saveAppearance(look);
      this.syncSettingsControls();
      this.hud.toast(`Indossi: ${OUTFITS[look.outfit].label}`, 2400);
    }
    if (venue.interaction === 'walk' || venue.interaction === 'visit') {
      // le visite hanno solo effetti sui bisogni, già applicati sopra
    }
  }

  private renderVenueBalance(): void {
    const el = document.getElementById('venue-balance');
    if (el) {
      el.textContent = `Contanti ${formatEuro(this.wallet.cash)} · Conto ${formatEuro(this.wallet.account)}`;
    }
  }

  private closeVenue(): void {
    this.venueOpen = null;
    this.pendingItem = null;
    this.venuePanelVisible = false;
    this.venuePanel()?.classList.add('hidden');
    this.keys.clear();
    this.saveGame();
  }

  private openHomePanel(): void {
    if (!this.garage) return;
    this.venueOpen = null;
    this.venuePanelVisible = true;
    this.keys.clear();
    if (document.pointerLockElement) document.exitPointerLock();
    this.venuePanel()?.classList.remove('hidden');

    const title = document.getElementById('venue-title');
    if (title) title.textContent = 'Casa';
    const subtitle = document.getElementById('venue-subtitle');
    if (subtitle) subtitle.textContent = `${this.garage.label} · una sola casa nella modalità vita`;
    const badge = document.getElementById('venue-badge');
    if (badge) {
      badge.textContent = 'Casa del giocatore';
      badge.className = 'venue-badge verified';
    }
    const note = document.getElementById('venue-note');
    if (note) note.textContent = 'La casa è un edificio di Palata scelto come base. Qui puoi dormire, salvare e cambiare outfit.';
    const services = document.getElementById('venue-services');
    if (services) {
      services.textContent = '';
      for (const label of ['riposo', 'salvataggio', 'guardaroba']) {
        const chip = document.createElement('span');
        chip.className = 'venue-service';
        chip.textContent = label;
        services.append(chip);
      }
    }

    const host = document.getElementById('venue-menu');
    if (!host) return;
    host.textContent = '';
    const actions: { label: string; hint: string; run: () => void }[] = [
      {
        label: 'Dormi fino alle 07:00',
        hint: 'Avanza il tempo al giorno successivo e recupera tutta l\'energia.',
        run: () => this.sleepAtHome(),
      },
      {
        label: 'Riposa un\'ora',
        hint: 'Recupera un po\' di energia senza cambiare giorno.',
        run: () => this.restOneHour(),
      },
      {
        label: 'Salva partita',
        hint: 'Salva denaro virtuale, bisogni, orologio e posizione.',
        run: () => {
          this.saveGame();
          this.hud.toast('Partita salvata', 2200);
        },
      },
      {
        label: 'Guardaroba',
        hint: 'Apri le impostazioni per cambiare outfit e aspetto.',
        run: () => {
          this.closeVenue();
          this.showSettings(true);
        },
      },
    ];
    for (const action of actions) {
      const row = document.createElement('div');
      row.className = 'venue-item';
      const copy = document.createElement('div');
      copy.className = 'venue-item-copy';
      const label = document.createElement('strong');
      label.textContent = action.label;
      const hint = document.createElement('small');
      hint.textContent = action.hint;
      copy.append(label, hint);
      const actionWrap = document.createElement('div');
      actionWrap.className = 'venue-item-buy';
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'text-btn';
      button.textContent = 'Fai';
      button.addEventListener('click', action.run);
      actionWrap.append(button);
      row.append(copy, actionWrap);
      host.append(row);
    }
    document.getElementById('venue-confirm')?.classList.add('hidden');
    this.renderVenueBalance();
  }

  private sleepAtHome(): void {
    const nextDay = this.gameMinutes < 7 * 60 ? this.gameDay : this.gameDay + 1;
    this.gameMinutes = 7 * 60;
    this.gameDay = nextDay;
    this.needs = sleepNeeds(this.needs);
    this.hud.setNeeds(this.needs);
    this.hud.setClock(this.gameDay, this.gameMinutes);
    this.hud.setNeedsWarning(needsWarning(this.needs));
    this.closeVenue();
    this.hud.toast(`Giorno ${this.gameDay} · 07:00 · energia recuperata`, 3200);
  }

  private restOneHour(): void {
    const clock = advanceClock(this.gameDay, Math.floor(this.gameMinutes), 60);
    this.gameDay = clock.day;
    this.gameMinutes = clock.minutes;
    this.needs = applyNeedEffect(this.needs, { energy: 12, fun: 2 });
    this.hud.setNeeds(this.needs);
    this.hud.setClock(this.gameDay, this.gameMinutes);
    this.hud.setNeedsWarning(needsWarning(this.needs));
    this.renderVenueBalance();
    this.hud.toast('Hai riposato un\'ora', 2200);
  }

  // -------------------------------------------------------------------------
  // itinerario
  // -------------------------------------------------------------------------
  private pickDestination(event: MouseEvent): void {
    if (!this.map || !this.hud.mapVisible) return;
    const world = this.map.worldFromBigMap(event.currentTarget as HTMLCanvasElement, event.clientX, event.clientY);
    if (!world) return;
    // Shift+clic sulla mappa = scegli quella casa come garage
    if (event.shiftKey) {
      this.setGarageAt(world.x, world.z);
      return;
    }
    this.setDestination(world.x, world.z);
  }

  private setDestination(x: number, z: number): void {
    if (!this.roadGraph) return;
    this.routeDestination = { x, z };
    this.routeLabel = this.labelForDestination(x, z);
    this.recomputeRoute();
    if (!this.route) {
      this.hud.toast('Nessuna strada collega questo punto: scegline un altro', 3200);
      return;
    }
    this.hud.toast(`Itinerario per ${this.routeLabel}`, 2600);
  }

  private labelForDestination(x: number, z: number): string {
    let best: { name: string; d: number } | null = null;
    for (const v of VILLAGES) {
      const w = latLonToWorld(v.lat, v.lon);
      const d = distance2(x, z, w.x, w.z);
      if (!best || d < best.d) best = { name: v.name, d };
    }
    if (best && best.d < 1200) return best.name === HOME.name ? `${HOME.name} · casa` : best.name;
    return 'Punto scelto';
  }

  private recomputeRoute(): void {
    if (!this.roadGraph || !this.routeDestination) return;
    const focus = this.mode === 'walk' ? this.player.position : this.car.position;
    this.route = planRoute(this.roadGraph, { x: focus.x, z: focus.z }, this.routeDestination);
    this.lastRouteOrigin = { x: focus.x, z: focus.z };
    this.lastRouteTime = performance.now();
    this.updateRouteHud();
    if (this.routeBeacon && this.routeDestination) {
      const { x, z } = this.routeDestination;
      this.routeBeacon.position.set(x, this.ground.heightAt(x, z), z);
      this.routeBeacon.visible = true;
    }
  }

  /** Distanza e tempi stimati, in stile navigatore. */
  private updateRouteHud(): void {
    if (!this.route) {
      this.hud.setRoute(null);
      return;
    }
    const meters = this.route.distance;
    const distance = meters >= 950 ? `${(meters / 1000).toFixed(1).replace('.', ',')} km` : `${Math.round(meters / 10) * 10} m`;
    const walk = Math.max(1, Math.round(meters / GAME.walkSpeed / 60));
    const drive = Math.max(1, Math.round(meters / ROUTE_DRIVE_SPEED / 60));
    this.hud.setRoute(`${this.routeLabel} · ${distance} · a piedi ${walk} min · in auto ${drive} min`);
  }

  private clearRoute(): void {
    if (!this.routeDestination) return;
    this.routeDestination = null;
    this.route = null;
    this.routeLabel = '';
    this.hud.setRoute(null);
    if (this.routeBeacon) this.routeBeacon.visible = false;
    this.hud.toast('Itinerario annullato', 2000);
  }

  // -------------------------------------------------------------------------
  // impostazioni / meteo reale
  // -------------------------------------------------------------------------
  private readRealWeatherPref(): boolean {
    try {
      return window.localStorage.getItem('molise.realWeather') === '1';
    } catch {
      return false;
    }
  }

  private showSettings(show: boolean): void {
    if (!this.loaded) return;
    this.settingsVisible = show;
    this.hud.showSettings(show);
    if (show) {
      this.keys.clear();
      if (document.pointerLockElement) document.exitPointerLock();
      this.syncSettingsControls();
      this.updateWeatherStatus();
    }
  }

  private setRealWeather(enabled: boolean, announce = true): void {
    this.realWeatherEnabled = enabled;
    this.hud.setRealWeather(enabled);
    try {
      window.localStorage.setItem('molise.realWeather', enabled ? '1' : '0');
    } catch {
      // localStorage può essere disabilitato
    }

    if (enabled) {
      this.manualTime = false;
      this.hud.setManualTime(false);
      const ll = worldToLatLon(this.player.position.x, this.player.position.z);
      this.realWeather.enable(ll.lat, ll.lon);
      if (announce) this.hud.toast('Meteo reale attivo · sole e condizioni aggiornati', 3200);
    } else {
      this.realWeather.disable();
      this.restoreDefaultAtmosphere();
      if (announce) this.hud.toast('Meteo reale disattivato · torna il pomeriggio del gioco');
    }
    this.updateWeatherStatus();
  }

  private refreshWeather(): void {
    if (!this.realWeatherEnabled) {
      this.setRealWeather(true);
      return;
    }
    const ll = worldToLatLon(this.player.position.x, this.player.position.z);
    this.realWeather.setLocation(ll.lat, ll.lon);
    void this.realWeather.refresh(true);
    this.updateWeatherStatus();
  }

  private updateWeatherStatus(): void {
    if (this.manualTime) {
      this.hud.setWeatherStatus(
        `Atmosfera manuale · ${this.formatHour(this.manualHour)} · ${this.weatherPresetLabel()}`,
      );
      this.hud.setWeatherBusy(false);
      return;
    }
    if (!this.realWeatherEnabled) {
      this.hud.setWeatherStatus('Meteo reale disattivato: il mondo usa il pomeriggio fisso del gioco.');
      this.hud.setWeatherBusy(false);
      return;
    }

    const w = this.realWeather.snapshot;
    let text: string;
    if (!w) {
      text = this.realWeather.loading
        ? 'Recupero il meteo reale qui…'
        : `Meteo non disponibile (${this.realWeather.error ?? 'rete assente'}). Il sole reale resta attivo.`;
    } else {
      const parts = [
        weatherLabel(w.code),
        `${Math.round(w.temperature)} °C`,
        `vento ${Math.round(w.windSpeed)} km/h`,
        `nuvole ${Math.round(w.cloudCover)}%`,
      ];
      if (w.sunrise && w.sunset) parts.push(`alba ${w.sunrise} · tramonto ${w.sunset}`);
      text = parts.join(' · ');
      if (this.realWeather.loading) text += ' · aggiornamento…';
      else if (this.realWeather.error) text += ` · offline (${this.realWeather.error}), ultimo dato`;
    }
    this.hud.setWeatherStatus(text);
    this.hud.setWeatherBusy(this.realWeather.loading);
  }

  /** Riporta cielo, luci e nebbia al pomeriggio fisso del gioco. */
  private restoreDefaultAtmosphere(): void {
    if (!this.sky) return;
    this.sky.setSun(DEFAULT_SUN.elevation, DEFAULT_SUN.theta);
    this.sky.setSkyParams(DEFAULT_SKY);
    this.sky.setLighting(DEFAULT_LIGHTING);
    this.renderer.toneMappingExposure = EXPOSURE_DAY;
    // ripristino a giornata serena: foschia lunga, come quando il meteo reale
    // è attivo e il cielo è limpido
    this.scene.fog = new THREE.FogExp2(0xb9cbd8, 0.008);
    this.scene.background = new THREE.Color(0xb9cbd8);
    this.clouds?.setVisible(false);
    this.precipitation?.clear();
    this.car.setLights(0);
    this.applyWetness(0);
  }

  /** Applica sole reale e condizioni meteo al cielo, alle luci e alle particelle. */
  private applyWeatherVisuals(dt: number, focus: THREE.Vector3): void {
    const ll = worldToLatLon(focus.x, focus.z);
    // la posizione aggiornata serve al prossimo refresh automatico
    this.realWeather.setLocation(ll.lat, ll.lon);
    const sun = sunPosition(new Date(), ll.lat, ll.lon);
    this.applyAtmosphere(sun, this.realWeather.snapshot ?? defaultWeather(), dt);
  }

  /** Atmosfera scelta a mano: ora del giorno + preset meteo. */
  private applyManualAtmosphere(dt: number, focus: THREE.Vector3): void {
    const ll = worldToLatLon(focus.x, focus.z);
    const sun = sunAtLocalTime(this.manualHour, ll.lat, ll.lon, dayOfYear(new Date()));
    this.applyAtmosphere(sun, this.manualSnapshot(), dt);
  }

  private manualSnapshot(): WeatherSnapshot {
    if (this.manualWeather === 'auto') return defaultWeather();
    const preset = WEATHER_PRESETS[this.manualWeather];
    return {
      ...defaultWeather(),
      code: preset.code,
      cloudCover: preset.cloudCover,
      precipitation: preset.precipitation,
      snowfall: preset.snowfall,
      windSpeed: preset.windSpeed,
      temperature: preset.temperature,
    };
  }

  /** Strada bagnata: le superfici diventano più lisce e più scure. */
  private applyWetness(wet: number): void {
    const target = clamp(wet, 0, 1);
    if (Math.abs(target - this.lastWetness) < 0.02) return;
    this.lastWetness = target;
    this.roadsGroup?.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (!mesh.isMesh) return;
      const material = mesh.material as THREE.MeshStandardMaterial | THREE.MeshStandardMaterial[];
      if (Array.isArray(material)) return;
      // la tinta base dell'asfalto non va persa: la si conserva al primo passaggio
      const store = material.userData as { baseColor?: THREE.Color; roadWet?: { value: number } };
      if (store.roadWet) {
        // l'asfalto si scurisce e si lucida da solo, dentro lo shader di usura
        store.roadWet.value = target;
        return;
      }
      store.baseColor ??= material.color.clone();
      material.roughness = THREE.MathUtils.lerp(0.92, 0.34, target);
      material.color.copy(store.baseColor).multiplyScalar(1 - 0.35 * target);
      material.needsUpdate = true;
    });
  }

  /** Cielo, luci, nebbia e particelle a partire da sole e condizioni. */
  private applyAtmosphere(sun: SunPosition, w: WeatherSnapshot, dt: number): void {
    const day = smoothstep(-6, 8, sun.elevation);
    const cloud = clamp(w.cloudCover / 100, 0, 1);
    const foggy = isFogCode(w.code);
    const wet = w.precipitation > 0.02 || w.snowfall > 0.02;
    const snowing = wet && w.temperature <= 1.5;
    const snow = snowing ? clamp(0.3 + w.snowfall * 0.5, 0.3, 1) : 0;
    const rain = wet && !snowing ? clamp(0.2 + w.precipitation * 0.35, 0.2, 1) : 0;
    const cover = Math.max(cloud, wet ? 0.55 : 0);
    const horizon = 1 - smoothstep(2, 22, sun.elevation);

    this.sky.setSun(sun.elevation, 180 - sun.azimuth);
    this.sky.setSkyParams({
      // cielo più saturo e meno lattiginoso: turbolenza bassa con l'aria serena,
      // rayleigh più alto per il blu, mie solo quanto basta all'alone del sole
      turbidity: 1.4 + cloud * 9 + (rain + snow) * 5,
      rayleigh: Math.max(0.7, 2.0 - cloud * 0.7 + horizon * 1.0),
      mieCoefficient: 0.0015 + cloud * 0.012 + (rain + snow) * 0.008,
      mieDirectionalG: 0.82,
    });

    this.sunTint.setHex(0xfff2db).lerp(this.tintA.setHex(0xffa968), horizon * 0.85);
    this.sunTint.lerp(this.tintB.setHex(0xcdd8e2), cloud * 0.7);
    const sunIntensity =
      Math.max(0, Math.sin(THREE.MathUtils.degToRad(Math.max(0, sun.elevation)))) *
      1.4 *
      (1 - 0.7 * cloud) *
      (1 - 0.55 * (rain + snow));

    this.sky.setLighting({
      sunColor: this.sunTint.getHex(),
      sunIntensity,
      hemiSky: day < 0.2 ? 0x2c4266 : 0xbcd2e4,
      hemiGround: day < 0.2 ? 0x1a2430 : 0x6b6350,
      // Di notte il mondo non deve sparire: un filo di luce ambientale e la
      // luna alta tengono leggibili strada, cordoli e incroci anche senza
      // fari. Prima hemi 0,08 + ambient 0,035 facevano una notte da grotta.
      hemiIntensity: 0.25 + 0.6 * day + 0.15 * cloud,
      ambientIntensity: 0.085 + 0.045 * day + 0.03 * cloud,
      moonIntensity: sun.elevation < 0 ? 1.15 : 0,
    });

    // Giornata serena: foschia più lontana e meno densa, altrimenti le colline
    // a 1–2 km si sciolgono nel bianco. Con pioggia/neve/nebbia restano i valori
    // corti di prima.
    const fogDensity = foggy ? 0.008 : snow > 0 ? 0.003 : rain > 0 ? 0.0017 : 0.00024 + cloud * 0.00018;

    this.fogColor.setHex(0x16222e).lerp(this.tintA.setHex(0xb9cbd8), day);
    this.fogColor.lerp(this.tintB.setHex(0xe6bd92), horizon * day * 0.35);
    this.fogColor.lerp(this.tintA.setHex(0x9aa7ae), cloud * 0.35 * day);
    if (foggy) this.fogColor.lerp(this.tintA.setHex(0xb9c2c6), 0.5 * day);

    if (this.scene.fog instanceof THREE.FogExp2) {
      this.scene.fog.color.copy(this.fogColor);
      this.scene.fog.density = day < 0.5 ? fogDensity * 1.3 : fogDensity;
    }
    this.scene.background = this.fogColor;
    // Di notte si alza leggermente l'esposizione invece di abbassarla: i fari
    // illuminano la strada ma il resto dell'inquadratura deve restare leggibile.
    this.renderer.toneMappingExposure = EXPOSURE_DAY - (1 - day) * 0.02 - cloud * 0.02;

    const windRad = THREE.MathUtils.degToRad(w.windDirection);
    const windX = -Math.sin(windRad) * w.windSpeed * 0.08;
    const windZ = -Math.cos(windRad) * w.windSpeed * 0.08;
    // con `weather: 'off'` (minimal) nuvole, pioggia, neve e foschia non
    // esistono: si risparmiano tre draw call trasparenti e i loro aggiornamenti
    if (this.weatherFxOn) {
      this.clouds.update(dt, this.camera, { coverage: cover, windX, windZ, sunElevation: sun.elevation });
      this.precipitation.update(dt, this.camera, { rain, snow, windX, windZ });
      // banchi di foschia bassa: soprattutto all'alba/tramonto e con la nebbia.
      // La neve secca l'aria, quindi li riduce.
      const horizonMist = 1 - smoothstep(6, 26, Math.abs(sun.elevation));
      const mistAmount = clamp(horizonMist * 0.72 + rain * 0.16 + (foggy ? 0.62 : 0) - snow * 0.25, 0, 1);
      this.mist.setColor(this.fogColor);
      this.mist.update(dt, this.camera, mistAmount, windX, windZ);
    }
    // ombre delle nuvole sul suolo: solo con cielo coperto e di giorno
    setCloudShadow(cloud * day, dt, windX, windZ);
    // finestre accese: si accendono al tramonto, si spengono all'alba
    setWindowGlow(1 - day);
    // stelle e luna
    this.sky.setNightSky(1 - day);

    // fari accesi quando il sole è basso, strada bagnata con pioggia o neve
    const night = 1 - smoothstep(-3, 10, sun.elevation);
    this.nightFactor = night;
    this.car.setLights(night);
    const targetWetness = rain > 0 ? clamp(0.3 + w.precipitation / 24, 0.3, 0.85) : 0;
    const wetRate = targetWetness > this.roadWetness ? 0.28 : 0.0018;
    this.roadWetness += (targetWetness - this.roadWetness) * (1 - Math.exp(-wetRate * dt));
    const targetSnow = snowing ? clamp(0.28 + w.snowfall * 0.22, 0.35, 0.9) : 0;
    const snowRate = targetSnow > this.snowPack ? 0.08 : w.temperature > 1 ? 0.003 : 0.0004;
    this.snowPack += (targetSnow - this.snowPack) * (1 - Math.exp(-snowRate * dt));
    const wetGrip = 1 - this.roadWetness * 0.42;
    const snowGrip = 1 - this.snowPack * 0.78;
    const blackIce = w.temperature < 0 && this.roadWetness > 0.28 ? 0.72 : 1;
    this.surfaceGripScale = clamp(wetGrip * snowGrip * blackIce, 0.16, 1);
    this.wheelSprayIntensity = rain;
    this.applyWetness(Math.max(this.roadWetness, this.snowPack * 0.5));
  }

  // -------------------------------------------------------------------------
  // grafica / preset
  // -------------------------------------------------------------------------
  private basePixelRatio(): number {
    const dpr = Math.min(window.devicePixelRatio || 1, this.quality.pixelRatio);
    // Su un 4K con DPR 2 si disegnerebbero 33 milioni di pixel: nessuna GPU
    // da browser lo tiene a 60 fps e la scala adattiva lo abbasserebbe dopo
    // due secondi (sfocando). Meglio partire sotto il tetto, con l'AA pieno.
    const maxPixels = 12_000_000;
    const pixels = window.innerWidth * window.innerHeight * dpr * dpr;
    return pixels > maxPixels ? dpr * Math.sqrt(maxPixels / pixels) : dpr;
  }

  /** Applica il preset e il resolution scaling adattivo. */
  private applyRenderScale(): void {
    const floor = this.quality.renderScaleFloor;
    const ratio = Math.max(floor, this.basePixelRatio() * this.renderScale);
    this.renderer.setPixelRatio(ratio);
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.post?.setPixelRatio(ratio);
    this.post?.setSize(window.innerWidth, window.innerHeight);
    // se la scala scende, la nitidezza sale: così il dettaglio perso con i
    // pixel non diventa anche morbidezza
    const softness = Math.max(0, 1 - this.renderScale);
    this.post?.setSharpen(this.quality.sharpen * (1 + softness * 1.5));
  }

  /**
   * Costruisce un nuovo gruppo di vegetazione col preset corrente. Gli alberi
   * non sono più "al prossimo avvio": il gruppo vecchio resta in scena finché
   * il nuovo non è pronto, poi si scambia in un colpo solo (niente buchi) e si
   * libera la memoria del precedente.
   */
  private rebuildGuardrails(): void {
    if (!this.osm || !this.ground || !this.heights) return;
    this.obstacles.removeTag('guardrail');
    if (this.guardrailsGroup) {
      this.scene.remove(this.guardrailsGroup);
      this.guardrailsGroup.traverse((obj) => {
        const mesh = obj as THREE.Mesh;
        mesh.geometry?.dispose();
        const material = mesh.material;
        if (Array.isArray(material)) material.forEach((m) => m.dispose());
        else material?.dispose();
      });
      this.guardrailsGroup = null;
    }
    if (!this.quality.guardrails) return;
    // Le campate sono lunghe al massimo 24 m: la rete a valle delle strade di
    // collina ne chiede circa 3.500, e il tetto taglia tratti interi (mai mezza
    // barriera). Restano due draw call in ogni caso (pali e nastro, istanziati).
    const guardrails = buildGuardrails(this.osm, this.heights, this.ground, {
      maxSpans: this.quality.level === 'medium' ? 4200 : 7000,
      obstacles: this.obstacles,
    });
    this.guardrailsGroup = guardrails.group;
    this.scene.add(guardrails.group);
  }

  private rebuildVegetation(): void {
    if (!this.vegetation || !this.heights || !this.osm) return;
    const generation = ++this.vegetationGeneration;
    const trees = this.quality.trees;
    const shrubs = this.quality.shrubs;
    const shadows = this.quality.level === 'high' || this.quality.level === 'ultra';
    this.hud.toast('Rigenero alberi e cespugli…', 1800);
    window.setTimeout(() => {
      if (generation !== this.vegetationGeneration || !this.heights || !this.osm) return;
      const vegetation = new ScatterVegetation(this.renderer, {
        osm: this.osm,
        heights: this.heights,
        roads: this.roadIndex,
        buildings: this.buildingIndex,
        paved: this.pavedAreas,
        trees,
        shrubs,
        shadows,
        canopy: this.canopy,
        obstacles: this.obstacles,
      });
      if (generation !== this.vegetationGeneration) {
        vegetation.dispose();
        return;
      }
      if (this.vegetation) {
        this.scene.remove(this.vegetation.group);
        this.vegetation.dispose();
      }
      this.vegetation = vegetation;
      this.scene.add(vegetation.group);
      const focus = this.mode === 'walk' ? this.player.position : this.car.position;
      vegetation.update(focus.x, focus.z);
    }, 60);
  }

  private applyQuality(level: QualityLevel, announce = true): void {
    const previous = this.quality;
    this.qualityLevel = level;
    this.quality = QUALITY_PRESETS[level];
    if (this.bench && this.lcOverride) {
      this.quality = {
        ...this.quality,
        landcover: this.lcOverride,
        landcoverRadius: this.lcOverride === 'full' ? this.quality.landcoverRadius : 0,
      };
    }
    saveQuality(level);
    this.renderScale = 1;
    // cambiare preset a mano azzera la degradazione automatica: l'utente ha
    // appena scelto, non deve combattere con le scelte fatte prima
    this.degradeStep = 0;
    this.slowChecks = 0;
    this.grassScale = 1;
    this.viewRadius = this.quality.viewRadius;
    this.weatherFxOn = this.quality.weather !== 'off';
    this.setShadows(this.quality.shadows);
    this.applyRenderScale();
    this.sky?.setShadowMapSize(this.quality.shadowMapSize);
    this.terrain?.setMaxZoom(this.quality.maxSatelliteZoom);
    this.terrain?.setLandcoverPreset(this.quality.landcover, this.quality.landcoverRadius);
    if (this.quality.post || this.quality.postAA) {
      // l'SSAO è un pass in più: se il preset lo chiede e la pipeline creata
      // prima non ce l'ha (si è passati da `media` a `alta` in gioco), va
      // ricostruita — aggiungere un pass a un composer già avviato costa
      // quanto rifarlo, e i render target vanno liberati comunque
      if (this.quality.post && this.quality.ssao && this.post && !this.post.hasSSAO) {
        this.post.dispose();
        this.post = undefined;
      }
      const post = this.ensurePost();
      post.setEnabled(!this.stereo);
      post.setBloom(this.quality.post ? this.quality.bloom : 0);
      post.setSSAO(this.quality.post && this.quality.ssao && !this.stereo);
      post.setSharpen(this.quality.sharpen);
    } else {
      this.post?.setEnabled(false);
      this.post?.setSSAO(false);
    }
    if (this.precipitation) this.precipitation.group.visible = this.weatherFxOn;
    if (this.mist) this.mist.group.visible = this.weatherFxOn;
    if (this.grass) this.grass.group.visible = this.quality.grassDensity * this.grassScale > 0.01;
    if (this.terrain) {
      const focus = this.mode === 'walk' ? this.player.position : this.car.state;
      this.terrain.update(focus.x, focus.z, this.viewRadius, true);
    }
    if (announce) {
      const aa = this.quality.msaaSamples > 0 ? ` · MSAA ${this.quality.msaaSamples}x + SMAA` : '';
      const fx = `${aa}${this.quality.post ? ` · bloom${this.quality.ssao ? ' + SSAO' : ''}` : ''}`;
      // alberi e cespugli si ricostruiscono davvero a runtime: niente più
      // "al prossimo avvio"
      this.hud.toast(
        `Grafica: ${this.quality.label}${fx} · satellite z${this.quality.maxSatelliteZoom}`,
        3600,
      );
      if (previous.trees !== this.quality.trees || previous.shrubs !== this.quality.shrubs) {
        this.rebuildVegetation();
      }
    }
    if (previous.guardrails !== this.quality.guardrails) {
      this.rebuildGuardrails();
    }
  }

  /**
   * Costruisce la pipeline con i parametri del preset corrente. MSAA e
   * nitidezza si possono cambiare a runtime (sono proprietà dei render target
   * e di un uniform), quindi la stessa istanza serve tutti i preset.
   */
  private makePost(): PostPipeline {
    const post = new PostPipeline(this.renderer, this.scene, this.camera, this.quality.bloom, {
      samples: this.quality.msaaSamples,
      sharpen: this.quality.sharpen,
      ssao: this.quality.ssao,
    });
    post.setPixelRatio(Math.max(this.quality.renderScaleFloor, this.basePixelRatio() * this.renderScale));
    post.setSize(window.innerWidth, window.innerHeight);
    return post;
  }

  /** Crea la pipeline di post-processing alla prima richiesta. */
  private ensurePost(): PostPipeline {
    if (!this.post) this.post = this.makePost();
    return this.post;
  }

  /**
   * Accende o spegne le ombre a runtime. `shadowMap.enabled` da solo non basta:
   * three ricompila i materiali solo se glielo si chiede, altrimenti la scena
   * resta illuminata come se le ombre ci fossero (o peggio, nera).
   */
  private setShadows(enabled: boolean): void {
    if (this.renderer.shadowMap.enabled === enabled) {
      this.sky?.setShadows(enabled);
      return;
    }
    this.renderer.shadowMap.enabled = enabled;
    this.renderer.shadowMap.needsUpdate = true;
    this.sky?.setShadows(enabled);
    this.scene.traverse((object) => {
      const material = (object as THREE.Mesh).material;
      const list = Array.isArray(material) ? material : material ? [material] : [];
      for (const m of list) m.needsUpdate = true;
    });
  }

  private bindInput(): void {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
    document.addEventListener('mousemove', this.onMouseMove);
    document.addEventListener('pointerlockchange', () => {
      this.pointerLocked = document.pointerLockElement === this.canvas;
    });
    this.canvas.addEventListener('click', () => {
      this.audio.start();
      if (this.running && !this.pointerLocked) this.requestPointerLock();
    });
    this.canvas.addEventListener(
      'wheel',
      (e) => {
        if (this.mode !== 'drive') return;
        this.camDistance = clamp(this.camDistance + e.deltaY * 0.01, 5, 18);
      },
      { passive: true },
    );
    // rotella sopra la minimappa: stringe o allarga la scala senza toccare
    // la camera. È l'unico modo per guardare vicino e lontano con lo stesso
    // strumento, e resta dove lo lasci.
    const wrap = document.getElementById('minimap-wrap');
    wrap?.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        this.mapZoom = clamp(this.mapZoom * (1 + e.deltaY * 0.0012), 0.45, 2.4);
      },
      { passive: false },
    );
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    if (this.venuePanelVisible) {
      if (!e.repeat && (e.code === 'Escape' || e.code === 'KeyE')) {
        e.preventDefault();
        this.closeVenue();
      }
      return;
    }
    if (this.walletVisible) {
      if (!e.repeat && (e.code === 'Escape' || e.code === 'KeyI')) {
        e.preventDefault();
        this.showWallet(false);
      }
      return;
    }
    if (this.settingsVisible) {
      if (!e.repeat && (e.code === 'KeyP' || e.code === 'Escape')) {
        e.preventDefault();
        this.showSettings(false);
      }
      return;
    }

    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) {
      if (this.running) e.preventDefault();
    }
    this.keys.add(e.code);
    if (e.repeat || !this.running) return;

    switch (e.code) {
      case 'KeyE':
        // in auto E non ha un'attività da aprire: fa scorrere il giorno, come
        // il ciclo giorno/notte di Slow Roads. A piedi resta "interagisci".
        if (this.mode === 'walk') {
          this.interact();
        } else {
          if (!this.manualTime) this.setManualTime(true);
          this.setManualHour((this.manualHour + 2) % 24);
          this.hud.toast(`Ora ${this.formatHour(this.manualHour)}`, 1600);
        }
        break;
      case 'KeyQ': {
        const order: WeatherPreset[] = ['auto', 'clear', 'cloudy', 'rain', 'fog', 'snow'];
        const next = order[(order.indexOf(this.manualWeather) + 1) % order.length] ?? 'auto';
        // il meteo manuale si vede subito solo con l'atmosfera manuale attiva:
        // accenderla evita il tasto che sembra non fare nulla sotto il sole
        if (!this.manualTime) this.setManualTime(true);
        this.setManualWeather(next);
        break;
      }
      case 'KeyI':
        this.showWallet(!this.walletVisible);
        break;
      case 'KeyF':
        if (this.mode === 'walk') this.enterCar();
        else this.exitCar();
        break;
      case 'KeyC':
        if (this.mode === 'walk') {
          this.thirdPerson = !this.thirdPerson;
          this.player.avatar.visible = this.thirdPerson;
          this.snapWalkCamera();
          this.hud.toast(this.thirdPerson ? 'Visuale in terza persona' : 'Visuale in prima persona');
        } else {
          this.driveCam = (this.driveCam + 1) % 3;
          this.snapDriveCamera();
          this.hud.toast(
            this.driveCam === 0
              ? 'Visuale inseguitrice'
              : this.driveCam === 1
                ? 'Visuale alta'
                : 'Visuale dal cofano',
          );
        }
        break;
      case 'Comma':
      case 'Period':
        if (this.mode !== 'drive') break;
        this.car.setIndicator(e.code === 'Comma' ? 'left' : 'right');
        this.hud.toast(
          this.car.indicators === 'off' ? 'Frecce spente' : `Freccia ${e.code === 'Comma' ? 'sinistra' : 'destra'}`,
          1600,
        );
        break;
      case 'KeyJ':
        this.hud.toast(
          this.car.toggleHeadlights() ? 'Fari accesi anche di giorno' : 'Fari in automatico (notte)',
          2200,
        );
        break;
      case 'KeyO':
        if (this.mode !== 'drive') {
          this.hud.toast("L'autopilota si accende solo alla guida", 2200);
          break;
        }
        this.autopilot = !this.autopilot;
        this.hud.toast(
          this.autopilot
            ? 'Autopilota attivo: segue la strada · O per riprendere il volante'
            : 'Autopilota disattivato',
          3200,
        );
        break;
      case 'KeyM':
        this.toggleMap();
        break;
      case 'KeyV':
        if (!this.map) break;
        this.map.radar = !this.map.radar;
        this.hud.toast(this.map.radar ? 'Radar: satellite reale' : 'Radar: mappa vettoriale');
        break;
      case 'KeyG':
        this.applyQuality(nextQuality(this.qualityLevel));
        break;
      case 'KeyY':
        this.stereo = !this.stereo;
        this.post?.setEnabled(this.stereo ? false : this.quality.post);
        this.hud.toast(this.stereo ? 'Stereo affiancato attivo (Y per uscire)' : 'Stereo disattivato');
        break;
      case 'KeyB':
        this.cycleVehicle();
        break;
      case 'KeyN': {
        const muted = this.audio.toggleMute();
        this.hud.toast(muted ? 'Audio disattivato' : 'Audio attivo');
        break;
      }
      case 'KeyP':
        this.showSettings(true);
        break;
      case 'KeyX':
        this.clearRoute();
        break;
      case 'KeyH':
        this.hud.toggleHelp();
        break;
      case 'KeyR':
        this.respawnOnRoad();
        break;
      case 'KeyT':
        this.setGarageFromHere();
        break;
      case 'KeyL':
        this.goToGarage();
        break;
      case 'KeyK':
        this.cyclePaint();
        break;
      case 'Escape':
        if (this.hud.mapVisible) {
          this.hud.showMap(false);
          break;
        }
        this.hud.toast('Mouse libero — clicca sul mondo per continuare');
        break;
      default:
        break;
    }
  };

  private onMouseMove = (e: MouseEvent): void => {
    if (!this.pointerLocked) return;
    if (this.mode === 'walk') {
      this.player.yaw -= e.movementX * 0.0022;
      this.player.pitch = clamp(this.player.pitch - e.movementY * 0.0022, -1.35, 1.35);
    } else {
      this.camYawOffset = clamp(this.camYawOffset - e.movementX * 0.0035, -2.4, 2.4);
      this.camPitch = clamp(this.camPitch - e.movementY * 0.004, -0.9, 1.4);
    }
  };

  private onResize = (): void => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.post?.setPixelRatio(Math.max(this.quality.renderScaleFloor, this.basePixelRatio() * this.renderScale));
    this.post?.setSize(w, h);
  };

  private requestPointerLock(): void {
    try {
      const result = this.canvas.requestPointerLock() as unknown as Promise<void> | undefined;
      if (result && typeof result.catch === 'function') {
        result.catch(() => this.hud.toast('Mouse non bloccato: puoi comunque usare la tastiera'));
      }
    } catch {
      this.hud.toast('Mouse non bloccato: puoi comunque usare la tastiera');
    }
  }

  // -------------------------------------------------------------------------
  // stato di gioco
  // -------------------------------------------------------------------------
  /** Diagnostica satellite: con ?imagery=debug mostra nel titolo quanti chunk hanno texture e quanti sono a z17+. */
  private startImageryDebug(): void {
    window.setInterval(() => {
      const t = this.terrain;
      if (!t) return;
      document.title = `Molise · chunk ${t.loadedChunks} · texture ${t.texturedChunks} · z17+ ${t.detailedChunks}`;
    }, 1000);
  }

  start(mode: Mode): void {
    if (this.running) return;
    if (!this.loaded) {
      this.hud.toast('Sto ancora caricando il territorio…');
      return;
    }
    this.mode = mode;
    this.audio.start();
    this.audio.setVoice(engineVoice(this.car.spec));
    this.hud.hideStart();
    this.hud.showHud();
    this.hud.setMode(mode);
    this.running = true;

    if (mode === 'drive') {
      this.player.avatar.visible = false;
      this.camera.fov = 62;
      this.camera.updateProjectionMatrix();
      this.camYawOffset = 0;
      this.camPitch = 0;
      this.snapDriveCamera();
      this.hud.toast(
        'W accelera · S frena/retro · A/D sterza · Shift spinta · C visuale · O autopilota · F scendi',
        6200,
      );
    } else {
      this.player.avatar.visible = this.thirdPerson;
      this.camera.fov = 68;
      this.camera.updateProjectionMatrix();
      this.snapWalkCamera();
      this.hud.toast('WASD muoviti · Shift corri · F entra in auto · C cambia visuale · M mappa', 5200);
    }

    this.timer.update();
    this.requestPointerLock();
  }

  private enterCar(): void {
    if (this.mode !== 'walk') return;
    const d = distance2(this.player.position.x, this.player.position.z, this.car.state.x, this.car.state.z);
    if (d > GAME.interactionRange) {
      this.hud.toast("Avvicinati all'auto per guidarla");
      return;
    }
    this.mode = 'drive';
    this.car.state.speed = 0;
    this.car.state.steer = 0;
    this.player.avatar.visible = false;
    this.camYawOffset = 0;
    this.camPitch = 0;
    this.camera.fov = 62;
    this.camera.updateProjectionMatrix();
    this.snapDriveCamera();
    this.hud.setMode('drive');
    if (this.routeDestination) this.recomputeRoute();
  }

  private exitCar(): void {
    if (this.mode !== 'drive') return;
    this.mode = 'walk';
    const rx = Math.cos(this.car.state.yaw);
    const rz = -Math.sin(this.car.state.yaw);
    let x = this.car.state.x + rx * 2.2;
    let z = this.car.state.z + rz * 2.2;
    const fixed = this.buildingIndex.resolveCircle(x, z, 0.5);
    x = fixed.x;
    z = fixed.z;
    this.player.spawn(x, z, this.car.state.yaw, this.ground);
    this.player.avatar.visible = this.thirdPerson;
    this.camera.fov = 68;
    this.camera.updateProjectionMatrix();
    this.snapWalkCamera();
    this.hud.setMode('walk');
    if (this.routeDestination) this.recomputeRoute();
  }

  private respawnOnRoad(): void {
    const focus = this.mode === 'walk' ? this.player.position : this.car.position;
    const pose = this.findRoadPose(focus.x, focus.z);
    if (!pose) return;
    if (this.mode === 'walk') {
      this.player.spawn(pose.x, pose.z, pose.yaw, this.ground);
      this.snapWalkCamera();
    } else {
      this.car.reset(pose.x, pose.z, pose.yaw, this.ground);
      this.snapDriveCamera();
    }
    this.hud.toast('Riportato in strada');
    if (this.routeDestination) this.recomputeRoute();
  }

  private toggleMap(): void {
    if (!this.map) return;
    const show = !this.hud.mapVisible;
    this.hud.showMap(show);
    if (show) this.drawBigMap();
  }

  // -------------------------------------------------------------------------
  // loop
  // -------------------------------------------------------------------------
  private frame = (): void => {
    requestAnimationFrame(this.frame);
    this.renderer.info.reset();
    // il tempo reale misura gli fps, quello limitato serve alla simulazione:
    // sotto i 20 fps il passo di fisica non deve superare i 50 ms (tunneling).
    // Se il clamp a 0,5 s finisse anche negli fps, ogni frame più lento di
    // mezzo secondo verrebbe dichiarato "2 fps" e la degradazione automatica
    // non saprebbe mai di essere su una macchina da 0,1 fps.
    this.timer.update();
    const realDt = this.timer.getDelta();
    const rawDt = Math.min(0.5, realDt);
    const dt = Math.min(0.05, rawDt);
    // se la scheda è stata in background per minuti, il primo frame non deve
    // contare come "0,1 fps" e far scattare una degradazione per niente
    const perfDt = Math.min(2, realDt);

    this.fpsFrames++;
    this.fpsElapsed += perfDt;
    if (this.fpsElapsed >= 0.5) {
      this.fps = this.fpsFrames / this.fpsElapsed;
      this.fpsFrames = 0;
      // si controlla ogni ~2 s: abbastanza spesso per reagire, abbastanza
      // raro per non ballare fra due livelli in una singola raffica
      this.lastQualityCheck += this.fpsElapsed;
      this.fpsElapsed = 0;
      if (this.lastQualityCheck >= 2 && this.running) {
        this.lastQualityCheck = 0;
        // nel banco prova la qualità deve restare quella scelta: niente
        // degradazione adattiva che falserebbe il confronto prima/dopo
        if (!this.bench) this.tunePerformance();
      }
    }

    if (this.running && this.loaded) {
      if (this.bench) this.benchTick(dt);
      else this.update(dt);
    } else this.idle(dt);

    if (this.sky) {
      this.sky.dome.position.copy(this.camera.position);
      this.sky.updateEnvironment(this.renderer, this.scene);
      // la stessa cubemap serve alla vernice: il clearcoat ha bisogno di un
      // riflesso ampio per non sembrare plastica
      if (this.scene.environment !== this.lastEnvironment) {
        this.lastEnvironment = this.scene.environment;
        this.car.setEnvironment(this.scene.environment);
      }
    }
    if (this.stereo) this.renderStereo();
    else if (this.post) this.post.render(dt);
    else this.renderer.render(this.scene, this.camera);
    this.publishDiagnostics();
    if (this.benchCollect) this.collectBenchFrame(perfDt);
  };

  /**
   * Adatta il costo del frame agli fps misurati.
   *
   * Prima si abbassa la risoluzione (pixel più grandi, nessun cambio di scena);
   * quando anche il minimo del preset non basta, si spengono gli effetti in
   * ordine di costo percepito: ombre, erba, meteo, dettaglio satellite, raggio
   * del terreno. Così anche una macchina da 20 fps arriva a 30 senza toccare
   * il tasto `G`. La scala torna su quando c'è margine, la degradazione no:
   * evita che la grafica oscilli fra due livelli.
   */
  private tunePerformance(): void {
    const floor = this.quality.renderScaleFloor;
    // La risoluzione è l'ultima risorsa: abbassarla è il modo più rapido per
    // riempire lo schermo di scalini. Prima si tolgono ombre ed erba (che non
    // toccano la nitidezza), poi si scende di pixel: sotto i 30 fps si prova
    // subito un gradino di qualità, e la risoluzione cala solo se non basta.
    if (this.fps < 30 && this.degradeStep < 2) {
      this.slowChecks++;
      if (this.slowChecks >= 2) {
        this.slowChecks = 0;
        this.degrade();
      }
      return;
    }
    if (this.fps < 32 && this.renderScale > floor + 0.001) {
      this.renderScale = Math.max(floor, this.renderScale - 0.15);
      this.applyRenderScale();
      this.slowChecks = 0;
      return;
    }
    if (this.fps < 26 && this.renderScale <= floor + 0.001) {
      this.slowChecks++;
      if (this.slowChecks >= 3) {
        this.slowChecks = 0;
        this.degrade();
      }
      return;
    }
    this.slowChecks = Math.max(0, this.slowChecks - 1);
    if (this.fps > 56 && this.renderScale < 1) {
      this.renderScale = Math.min(1, this.renderScale + 0.1);
      this.applyRenderScale();
    }
  }

  /** Un gradino di degradazione: si chiama solo quando gli fps restano bassi. */
  private degrade(): void {
    if (this.degradeStep >= 5) return;
    this.degradeStep++;
    switch (this.degradeStep) {
      case 1:
        this.setShadows(false);
        this.hud.toast('Prestazioni: ombre disattivate per tenere il gioco fluido', 3600);
        break;
      case 2:
        this.grassScale = 0;
        if (this.grass) this.grass.group.visible = false;
        break;
      case 3:
        this.weatherFxOn = false;
        this.precipitation?.clear();
        if (this.precipitation) this.precipitation.group.visible = false;
        if (this.mist) this.mist.group.visible = false;
        this.clouds?.setVisible(false);
        this.terrain?.setMaxZoom(15);
        break;
      case 4:
        this.viewRadius = Math.min(this.viewRadius, 1600);
        if (this.terrain) {
          const focus = this.mode === 'walk' ? this.player.position : this.car.state;
          this.terrain.update(focus.x, focus.z, this.viewRadius, true);
        }
        break;
      default: {
        // ultimo gradino: sotto 0,5× non ha senso, si toglie il resto del
        // dettaglio (kit già assente su minimal, qui vale per i preset alti
        // scelti a mano su una macchina che non li regge)
        this.quality = { ...this.quality, renderScaleFloor: 0.5 };
        this.renderScale = 0.5;
        this.applyRenderScale();
        this.viewRadius = Math.min(this.viewRadius, 1200);
        if (this.terrain) {
          const focus = this.mode === 'walk' ? this.player.position : this.car.state;
          this.terrain.update(focus.x, focus.z, this.viewRadius, true);
        }
        break;
      }
    }
  }

  /**
   * Stereo affiancato (side-by-side): due viewport, due camere separate da
   * ~6,5 cm. Serve per visori e per guardare la scena in 3D incrociando gli occhi.
   * Il post-processing è disattivato in questa modalità per non raddoppiare i pass.
   */
  private renderStereo(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const eye = 0.0325;
    const dir = this.tmp1;
    const right = this.tmp2;
    this.camera.getWorldDirection(dir);
    right.crossVectors(dir, this.camera.up).normalize();

    const renderer = this.renderer;
    renderer.setScissorTest(true);
    for (let i = 0; i < 2; i++) {
      const cam = this.stereoCamera;
      cam.copy(this.camera);
      cam.aspect = w / 2 / h;
      cam.updateProjectionMatrix();
      cam.position.copy(this.camera.position).addScaledVector(right, i === 0 ? -eye : eye);
      const x = Math.round((i * w) / 2);
      const width = Math.round(w / 2);
      renderer.setViewport(x, 0, width, h);
      renderer.setScissor(x, 0, width, h);
      renderer.render(this.scene, cam);
    }
    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, w, h);
  }

  // -------------------------------------------------------------------------
  // banco prova riproducibile (`?bench=1`)
  // -------------------------------------------------------------------------

  /** Camera e mondo restano fermi: si aggiorna solo ciò che serve al rendering. */
  private benchTick(dt: number): void {
    const view = BENCH_VIEWS[this.benchViewIndex];
    if (!view) return;
    const focus = this.tmp1.set(view.x, this.ground.heightAt(view.x, view.z), view.z);
    this.terrain.update(view.x, view.z, this.viewRadius);
    this.terrain.tick();
    this.farTerrain?.setInnerRadius(this.viewRadius * 0.7);
    this.farTerrain?.update(view.x, view.z);
    updateWind(dt);
    this.grass?.update(
      view.x,
      view.z,
      this.heights,
      this.roadIndex,
      this.buildingIndex,
      this.quality.grassDensity * this.grassScale,
      this.osm.areas,
    );
    this.applyManualAtmosphere(dt, focus);
    this.updateSky(focus);
    this.streetLights?.update(this.camera.position, this.nightFactor);
  }

  /**
   * Porta il gioco su una delle tre pose fisse. È `async` perché attende il
   * preload dei chunk di terreno attorno alla posa: senza questo la prima
   * misura pagherebbe lo streaming e non sarebbe confrontabile.
   */
  async benchView(index: number): Promise<{ index: number; id: BenchView['id']; label: string } | null> {
    const view = BENCH_VIEWS[index];
    if (!this.loaded || !this.heights || !view) return null;
    this.benchViewIndex = index;
    this.benchStats = null;
    this.benchCollect = null;
    this.mode = view.mode;
    this.running = true;
    this.grassScale = 1;
    this.hud.setMode(view.mode);

    if (view.mode === 'drive') {
      this.car.reset(view.x, view.z, view.yaw, this.ground);
      // 80 km/h: la posa è ferma per riproducibilità, ma velocità e camera
      // sono quelle della vista in movimento richiesta dal brief.
      this.car.state.speed = 80 / 3.6;
      this.camDistance = 8.8;
      this.camYawOffset = 0;
      this.camPitch = 0;
      this.camera.fov = 62;
      this.camera.updateProjectionMatrix();
      this.snapDriveCamera();
    } else {
      this.player.spawn(view.x, view.z, view.yaw, this.ground);
      this.player.pitch = view.pitch ?? 0;
      this.player.avatar.visible = false;
      this.camera.fov = 68;
      this.camera.updateProjectionMatrix();
      this.snapWalkCamera();
    }

    await this.terrain.preload(view.x, view.z, Math.min(1600, this.viewRadius));
    this.applyManualAtmosphere(0, this.tmp1.set(view.x, this.ground.heightAt(view.x, view.z), view.z));
    this.updateSky(this.tmp1);
    return { index, id: view.id, label: view.label };
  }

  /**
   * Avvia la misura. I primi 1,2 s sono di assestamento (shader, tile, ombre);
   * poi si campionano gli fps e i contatori di `renderer.info`.
   */
  benchStart(seconds = 8): boolean {
    if (this.benchViewIndex < 0) return false;
    const now = performance.now();
    this.benchStats = null;
    this.benchCollect = {
      startAt: now + 1200,
      endAt: now + 1200 + Math.max(1, seconds) * 1000,
      frames: [],
      calls: [],
      tris: [],
    };
    return true;
  }

  benchResult(): BenchResult | null {
    return this.benchStats;
  }

  benchInfo(): {
    ready: boolean;
    view: BenchView | null;
    gpu: string;
    quality: QualityLevel;
    renderScale: number;
  } {
    return {
      ready: this.loaded,
      view: BENCH_VIEWS[this.benchViewIndex] ?? null,
      gpu: this.gpuName,
      quality: this.qualityLevel,
      renderScale: this.renderScale,
    };
  }

  private collectBenchFrame(perfDt: number): void {
    const c = this.benchCollect;
    if (!c) return;
    const now = performance.now();
    if (now < c.startAt) return;
    if (perfDt > 0.0001) c.frames.push(1 / perfDt);
    c.calls.push(this.renderer.info.render.calls);
    c.tris.push(this.renderer.info.render.triangles);
    if (now >= c.endAt) this.finishBench();
  }

  private finishBench(): void {
    const c = this.benchCollect;
    const view = BENCH_VIEWS[this.benchViewIndex];
    if (!c || !view) return;
    this.benchCollect = null;

    const sumTime = c.frames.reduce((s, fps) => s + 1 / fps, 0);
    // minimi su finestre da 1 s: il minimo di un singolo frame è dominato da
    // uno stutter di streaming e non dice niente sulla fluidità percepita
    const buckets: number[] = [];
    let bucketTime = 0;
    let bucketFrames = 0;
    for (const fps of c.frames) {
      bucketTime += 1 / fps;
      bucketFrames++;
      if (bucketTime >= 1) {
        buckets.push(bucketFrames / bucketTime);
        bucketTime = 0;
        bucketFrames = 0;
      }
    }
    if (bucketFrames > 0 && bucketTime > 0) buckets.push(bucketFrames / bucketTime);
    buckets.sort((a, b) => a - b);
    const calls = c.calls.length ? c.calls : [0];
    const tris = c.tris.length ? c.tris : [0];
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());

    this.benchStats = {
      view: view.id,
      label: view.label,
      mode: view.mode,
      quality: this.qualityLevel,
      gpu: this.gpuName,
      seconds: sumTime,
      frames: c.frames.length,
      fpsAvg: sumTime > 0 ? c.frames.length / sumTime : 0,
      fpsMin: buckets[0] ?? 0,
      fpsP5: buckets[Math.max(0, Math.floor(buckets.length * 0.05) - 1)] ?? 0,
      drawCallsAvg: calls.reduce((s, v) => s + v, 0) / calls.length,
      drawCallsMax: Math.max(...calls),
      trianglesAvg: tris.reduce((s, v) => s + v, 0) / tris.length,
      trianglesMax: Math.max(...tris),
      textures: this.renderer.info.memory.textures,
      textureMB: this.estimateTextureMB(),
      renderScale: this.renderScale,
      pixelRatio: this.renderer.getPixelRatio(),
      bufferWidth: size.x,
      bufferHeight: size.y,
      chunks: this.terrain?.loadedChunks ?? 0,
      textured: this.terrain?.texturedChunks ?? 0,
      detailed: this.terrain?.detailedChunks ?? 0,
      degraded: this.degradeStep,
      x: view.x,
      z: view.z,
      yaw: view.yaw,
    };
  }

  /**
   * Stima della memoria texture della scena (solo immagini, non render target):
   * `renderer.info.memory` conta le texture ma non dice quanti byte occupano.
   */
  private estimateTextureMB(): number {
    const seen = new Set<THREE.Texture>();
    let bytes = 0;
    const add = (t: THREE.Texture | null | undefined): void => {
      if (!t || seen.has(t)) return;
      seen.add(t);
      const image = t.image as { width?: number; height?: number } | undefined;
      const w = image?.width ?? 0;
      const h = image?.height ?? 0;
      if (w <= 0 || h <= 0) return;
      bytes += w * h * 4 * (t.generateMipmaps ? 4 / 3 : 1);
    };

    this.scene.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (!mesh.isMesh) return;
      const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const raw of list) {
        const m = raw as THREE.MeshStandardMaterial;
        add(m.map);
        add(m.normalMap);
        add(m.roughnessMap);
        add(m.metalnessMap);
        add(m.emissiveMap);
        add(m.aoMap);
        add(m.alphaMap);
        add(m.bumpMap);
        add(m.envMap);
      }
    });
    add(this.scene.environment);
    // le texture della copertura del suolo sono uniform dello shader, non
    // proprietà di un materiale: senza questo la stima le perderebbe
    for (const texture of this.landcover?.textures() ?? []) add(texture);
    return bytes / (1024 * 1024);
  }

  private idle(dt: number): void {
    if (!this.ground) return;
    this.idleAngle += dt * 0.035;
    const radius = 1150;
    const x = START.x + Math.cos(this.idleAngle) * radius;
    const z = START.z + Math.sin(this.idleAngle) * radius;
    const y = this.ground.heightAt(x, z) + 210;
    this.camera.position.set(x, y, z);
    this.camera.lookAt(START.x, this.ground.heightAt(START.x, START.z) + 30, START.z);
    this.updateSky(this.tmp1.set(START.x, 0, START.z));
  }

  private update(dt: number): void {
    this.realWeather.update();
    const move = this.readMoveInput();

    // Orologio e bisogni: si fermano quando un pannello è aperto.
    const paused = this.venuePanelVisible || this.walletVisible || this.settingsVisible;
    const gameDelta = paused ? 0 : dt * this.gameMinutesPerSecond;
    if (gameDelta > 0) {
      this.gameMinutes += gameDelta;
      if (this.gameMinutes >= 1440) {
        this.gameMinutes -= 1440;
        this.gameDay++;
        this.terrain?.setSeason(monthForGameDay(this.gameDay));
      }
      this.needs = advanceNeeds(this.needs, gameDelta);
    }
    this.saveClock += dt;
    if (this.saveClock >= 30) {
      this.saveClock = 0;
      this.saveGame();
    }

    this.car.setRiderVisible(this.mode === 'drive');
    if (this.mode === 'walk') {
      const onRoad = this.ground.sampleAt(this.player.position.x, this.player.position.z).onRoad;
      const vegetationFactor = onRoad
        ? 1
        : this.vegetation?.movementFactorAt(this.player.position.x, this.player.position.z) ?? 0.9;
      this.player.update(dt, move, this.ground, this.buildingIndex, this.obstacles, vegetationFactor);
      this.updateWalkCamera(dt);
    } else {
      // lo stesso input serve alla fisica e al suono: così il motore risponde
      // al gas vero, non solo ai giri
      this.driveInput = this.autopilot ? this.autoDriveInput() : this.readCarInput(move);
      this.car.update(
        dt,
        this.driveInput,
        this.ground,
        this.buildingIndex,
        this.obstacles,
        this.surfaceGripScale,
        this.wheelSprayIntensity,
      );
      this.updateDriveCamera(dt);
    }

    const focus = this.mode === 'walk' ? this.player.position : this.car.position;
    if (
      this.worldTileManager &&
      (Number.isNaN(this.lastWorldTileX) ||
        Math.hypot(focus.x - this.lastWorldTileX, focus.z - this.lastWorldTileZ) >= 600)
    ) {
      const location = worldToLatLon(focus.x, focus.z);
      this.worldTileManager.update(location.lat, location.lon, 1700, 14);
      this.lastWorldTileX = focus.x;
      this.lastWorldTileZ = focus.z;
    }
    this.pedestrians?.update(dt, focus);
    this.terrain.update(focus.x, focus.z, this.viewRadius);
    this.vegetation?.update(focus.x, focus.z);
    this.terrain.tick();
    // l'anello lontano parte appena fuori dai chunk caricati
    this.farTerrain?.setInnerRadius(this.viewRadius * 0.7);
    this.farTerrain?.update(focus.x, focus.z);
    updateWind(dt);
    this.grass?.update(
      focus.x,
      focus.z,
      this.heights,
      this.roadIndex,
      this.buildingIndex,
      this.quality.grassDensity * this.grassScale,
      this.osm.areas,
    );
    if (this.manualTime) this.applyManualAtmosphere(dt, focus);
    else if (this.realWeatherEnabled) this.applyWeatherVisuals(dt, focus);
    this.updateSky(focus);
    this.streetLights?.update(this.camera.position, this.nightFactor);

    const moveSpeed =
      this.mode === 'drive' ? this.car.state.speed : Math.hypot(this.player.velocity.x, this.player.velocity.z);
    this.audio.update(dt, {
      mode: this.mode,
      speed: moveSpeed,
      moving: Math.abs(moveSpeed) > 0.35,
      grounded: this.mode === 'walk' ? this.player.grounded : true,
      rpm: this.mode === 'drive' ? this.car.rpm : undefined,
      throttle: this.mode === 'drive' ? this.driveInput?.throttle : undefined,
      gear: this.mode === 'drive' ? this.car.state.gear : undefined,
      shiftTimer: this.mode === 'drive' ? this.car.state.shiftTimer : undefined,
      braking: this.mode === 'drive' ? this.driveInput?.brake : undefined,
      onRoad:
        this.mode === 'drive'
          ? this.roadIndex.isOnRoad(this.car.state.x, this.car.state.z, 0.4)
          : undefined,
    });

    const now = performance.now();
    if (now - this.lastTick > 110) {
      this.lastTick = now;
      this.updateHud(focus.x, focus.z);
    }
    if (now - this.lastHud > 100 && this.map) {
      this.lastHud = now;
      const yaw = this.mode === 'walk' ? this.player.yaw : this.car.state.yaw;
      const speed = this.mode === 'walk' ? Math.hypot(this.player.velocity.x, this.player.velocity.z) : this.car.state.speed;
      this.map.drawMinimap(
        document.getElementById('minimap') as HTMLCanvasElement,
        { x: focus.x, z: focus.z, yaw },
        this.mode === 'walk' ? { x: this.car.state.x, z: this.car.state.z } : undefined,
        this.route?.points,
        this.garage,
        VENUES,
        {
          mode: this.mode === 'walk' ? 'walk' : 'drive',
          speed,
          zoomFactor: this.mapZoom,
          targets: this.mapTargets,
        },
      );
      const place = this.map.placeAt(focus.x, focus.z);
      const label =
        place.name === 'Campagna'
          ? 'Campagna'
          : `${place.name} · ${place.distance < 950 ? `${Math.round(place.distance)} m` : `${(place.distance / 1000).toFixed(1)} km`}`;
      if (label !== this.minimapLabel) {
        this.minimapLabel = label;
        const el = document.getElementById('minimap-label');
        if (el) el.textContent = label;
      }
      if (this.hud.mapVisible) this.drawBigMap();
    }

    // se ci si allontana dalla partenza, l'itinerario si ricalcola
    if (this.routeDestination && this.lastRouteOrigin) {
      const moved = distance2(focus.x, focus.z, this.lastRouteOrigin.x, this.lastRouteOrigin.z);
      if (moved > 60 && now - this.lastRouteTime > 2500) this.recomputeRoute();
    }
  }

  private updateSky(focus: THREE.Vector3): void {
    if (!this.sky) return;
    this.sky.update(this.tmp2.set(focus.x, Math.max(0, focus.y), focus.z));
  }

  private readMoveInput(): MoveInput {
    const fwd = (this.key('KeyW') || this.key('ArrowUp') ? 1 : 0) - (this.key('KeyS') || this.key('ArrowDown') ? 1 : 0);
    const strafe = (this.key('KeyD') || this.key('ArrowRight') ? 1 : 0) - (this.key('KeyA') || this.key('ArrowLeft') ? 1 : 0);
    return {
      forward: fwd,
      strafe,
      sprint: this.key('ShiftLeft') || this.key('ShiftRight'),
      jump: this.key('Space'),
    };
  }

  private readCarInput(move: MoveInput): CarInput {
    return {
      throttle: move.forward > 0 ? 1 : 0,
      brake: move.forward < 0 ? 1 : 0,
      steer: -move.strafe,
      handbrake: move.jump,
      boost: move.sprint,
    };
  }

  /**
   * Comandi dell'autopilota: insegue un punto sulla centerline 12 m avanti
   * (più lontano man mano che si va veloce) e tiene una crociera da turismo.
   * Il freno a mano o l'assenza di strada nelle vicinanze lo spengono: meglio
   * ridare il volante che trascinare l'auto fuori carreggiata.
   */
  private autoDriveInput(): CarInput {
    const car = this.car.state;
    if (this.key('Space')) {
      this.autopilot = false;
      this.hud.toast('Autopilota disattivato', 1800);
      return this.readCarInput(this.readMoveInput());
    }
    const segment = this.roadIndex.nearestSegment(car.x, car.z, 26);
    if (!segment) {
      this.autopilot = false;
      this.hud.toast('Autopilota: strada non trovata, riprendi il volante', 3000);
      return { throttle: 0, brake: 0.5, steer: 0, handbrake: false };
    }
    const lookahead = 12 + Math.abs(car.speed) * 0.55;
    const target = followTarget(segment, car.x, car.z, car.yaw, lookahead);
    // secondo punto più lontano: serve ad alzare il piede PRIMA della curva
    const far = followTarget(segment, car.x, car.z, car.yaw, lookahead + 16);
    // strade larghe = provinciali: si può andare più sciolti
    let cruise = segment.w * 2 >= 5.8 ? 18 : 13.5;
    // incrocio davanti (un'ALTRA strada entro 14 m): si arriva cauti, senza
    // fermarsi — l'autopilota non conosce il traffico ma sa che lì si guarda
    const ax = car.x - Math.sin(car.yaw) * 14;
    const az = car.z - Math.cos(car.yaw) * 14;
    if (this.roadIndex.isOnRoad(ax, az, 2.2, segment.road)) cruise *= 0.6;
    return autopilotInput(car, { x: target.x, z: target.z, cruise }, far);
  }

  private key(code: string): boolean {
    return this.keys.has(code);
  }

  private updateWalkCamera(dt: number): void {
    const speed = Math.hypot(this.player.velocity.x, this.player.velocity.z);
    this.bobPhase += speed * dt * 2.6;
    const bob = this.player.grounded ? Math.sin(this.bobPhase) * 0.038 * Math.min(1, speed / 5) : 0;

    if (!this.thirdPerson) {
      const eye = this.player.eyePosition(this.tmp1);
      eye.y += bob;
      this.camera.position.copy(eye);
      this.camera.rotation.set(this.player.pitch, this.player.yaw, 0);
      return;
    }

    const dir = this.player.forward(this.tmp1);
    const target = this.tmp2.set(this.player.position.x, this.player.position.y + 1.45, this.player.position.z);
    const desired = this.tmp3.copy(target).addScaledVector(dir, -4.4);
    desired.y = Math.max(desired.y, this.ground.heightAt(desired.x, desired.z) + 0.75);
    this.constrainCameraToBuildings(target, desired);
    this.camera.position.lerp(desired, 1 - Math.exp(-14 * dt));
    this.constrainCameraToBuildings(target, this.camera.position);
    this.camera.lookAt(target);
  }

  private updateDriveCamera(dt: number): void {
    this.placeDriveCamera(dt, false);
  }

  /**
   * Tre visuali di guida, come in Slow Roads: inseguitrice, alta da cartolina e
   * dal cofano. La posizione si calcola in un punto solo, così il cambio con C
   * non fa saltare l'inquadratura (`snap = true` la piazza subito).
   */
  private placeDriveCamera(dt: number, snap: boolean): void {
    const car = this.car.state;
    const fx = -Math.sin(car.yaw);
    const fz = -Math.cos(car.yaw);
    const blend = snap ? 1 : 1 - Math.exp(-7.5 * dt);

    if (this.driveCam === 2) {
      // cofano: bassa, davanti al parabrezza, sguardo lungo la strada
      const desired = this.tmp1.set(
        car.x + fx * 0.85,
        this.car.position.y + this.car.spec.height * 0.72,
        car.z + fz * 0.85,
      );
      if (snap) this.camera.position.copy(desired);
      else this.camera.position.lerp(desired, 1 - Math.exp(-18 * dt));
      this.camera.lookAt(
        this.tmp2.set(car.x + fx * 28, this.car.position.y + 1.05 + this.camPitch * 6, car.z + fz * 28),
      );
      return;
    }

    // FOV che si apre con la velocità: è la sensazione di corsa che in Slow
    // Roads dà il paesaggio che scorre, senza aggiungere motion blur
    const fov = 62 + Math.min(1, Math.abs(car.speed) / 30) * 7 + (this.driveCam === 1 ? 2 : 0);
    if (Math.abs(this.camera.fov - fov) > 0.05) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }

    const high = this.driveCam === 1;
    const yaw = car.yaw + this.camYawOffset;
    const dist = this.camDistance * (high ? 1.75 : 1);
    const desired = this.tmp1.set(
      car.x + Math.sin(yaw) * dist,
      this.car.position.y + (high ? 5.8 : 2.9) + this.camPitch * (high ? 5 : 3.4),
      car.z + Math.cos(yaw) * dist,
    );
    desired.y = Math.max(desired.y, this.ground.heightAt(desired.x, desired.z) + 1.1);
    const ahead = high ? 6 : 3.2;
    const target = this.tmp2.set(
      car.x + fx * ahead,
      this.car.position.y + 1.2,
      car.z + fz * ahead,
    );
    this.constrainCameraToBuildings(target, desired);
    if (snap) this.camera.position.copy(desired);
    else this.camera.position.lerp(desired, blend);
    this.constrainCameraToBuildings(target, this.camera.position);

    this.camera.lookAt(target);
  }

  private constrainCameraToBuildings(target: THREE.Vector3, position: THREE.Vector3): void {
    const dx = position.x - target.x;
    const dy = position.y - target.y;
    const dz = position.z - target.z;
    const distance = Math.hypot(dx, dy, dz);
    if (distance < 1) return;
    const samples = Math.ceil(distance / 0.75);

    for (let i = 1; i <= samples; i++) {
      const t = i / samples;
      const x = target.x + dx * t;
      const y = target.y + dy * t;
      const z = target.z + dz * t;
      for (const building of this.buildingIndex.near(x, z)) {
        if (
          x < building.bounds.minX ||
          x > building.bounds.maxX ||
          z < building.bounds.minZ ||
          z > building.bounds.maxZ ||
          !pointInPolygon(x, z, building.points)
        ) continue;
        const roof = this.ground.heightAt(x, z) + building.height;
        if (y >= roof) continue;
        const safeT = Math.max(0, t - 0.9 / distance);
        position.set(target.x + dx * safeT, target.y + dy * safeT, target.z + dz * safeT);
        return;
      }
    }
  }

  private snapWalkCamera(): void {
    if (!this.thirdPerson) {
      const eye = this.player.eyePosition(this.tmp1);
      this.camera.position.copy(eye);
      this.camera.rotation.set(this.player.pitch, this.player.yaw, 0);
      return;
    }
    const dir = this.player.forward(this.tmp1);
    const target = this.tmp2.set(this.player.position.x, this.player.position.y + 1.45, this.player.position.z);
    const desired = this.tmp3.copy(target).addScaledVector(dir, -4.4);
    desired.y = Math.max(desired.y, this.ground.heightAt(desired.x, desired.z) + 0.75);
    this.constrainCameraToBuildings(target, desired);
    this.camera.position.copy(desired);
    this.constrainCameraToBuildings(target, this.camera.position);
    this.camera.lookAt(target);
  }

  private snapDriveCamera(): void {
    this.placeDriveCamera(0, true);
  }

  private updateHud(x: number, z: number): void {
    const ll = worldToLatLon(x, z);
    const elev = this.ground.heightAt(x, z);
    this.hud.setPosition(ll.lat, ll.lon, elev, this.fps);
    this.hud.setMode(this.mode);
    this.hud.setSpeed(this.mode === 'drive' ? this.car.kmh : 0);
    this.hud.setGear(this.car.gear, this.car.rpm);
    this.hud.setNeeds(this.needs);
    this.hud.setClock(
      this.gameDay,
      this.gameMinutes,
      this.manualTime ? this.manualHour : undefined,
    );
    this.hud.setNeedsWarning(needsWarning(this.needs));

    let nearest: { name: string; d: number } | null = null;
    for (const v of VILLAGES) {
      const w = latLonToWorld(v.lat, v.lon);
      const d = distance2(x, z, w.x, w.z);
      if (!nearest || d < nearest.d) nearest = { name: v.name, d };
    }
    this.hud.setLocation(
      nearest && nearest.d < 6000 ? (nearest.name === HOME.name ? `${HOME.name} · casa` : nearest.name) : 'Campagna molisana',
    );

    if (this.mode === 'walk') {
      const d = distance2(x, z, this.car.state.x, this.car.state.z);
      const venue = findNearestVenue(x, z, 16);
      const atGarage = this.garage !== null && distance2(x, z, this.garage.x, this.garage.z) < 22;
      if (venue) {
        this.hud.setObjective(`Premi <kbd>E</kbd> per entrare a <strong>${venue.name}</strong>`);
      } else if (atGarage) {
        this.hud.setObjective('Casa · <kbd>E</kbd> dormi o salva · <kbd>T</kbd> cambia casa');
      } else if (d <= GAME.interactionRange) {
        this.hud.setObjective('Premi <kbd>F</kbd> per guidare');
      } else {
        this.hud.setObjective(null);
      }
    } else {
      const nearVenue = findNearestVenue(x, z, 18);
      const hint = nearVenue ? ` · ${nearVenue.name}: scendi con <kbd>F</kbd>` : '';
      this.hud.setObjective(`Premi <kbd>F</kbd> per scendere · <kbd>R</kbd> per tornare in strada${hint}`);
    }
  }

  private drawBigMap(): void {
    if (!this.map) return;
    const canvas = document.getElementById('bigmap') as HTMLCanvasElement | null;
    if (!canvas) return;
    const focus = this.mode === 'walk' ? this.player.position : this.car.position;
    const yaw = this.mode === 'walk' ? this.player.yaw : this.car.state.yaw;
    this.map.drawBigMap(
      canvas,
      { x: focus.x, z: focus.z, yaw },
      this.mode === 'walk' ? { x: this.car.state.x, z: this.car.state.z } : undefined,
      this.route?.points,
      this.garage,
      VENUES,
    );
  }

  private publishDiagnostics(): void {
    const focus = this.mode === 'walk' ? this.player.position : this.car.position;
    const w = window as unknown as { __molise?: Diagnostics };
    w.__molise = {
      ready: this.loaded,
      running: this.running,
      mode: this.mode,
      chunks: this.terrain?.loadedChunks ?? 0,
      textured: this.terrain?.texturedChunks ?? 0,
      detailed: this.terrain?.detailedChunks ?? 0,
      fps: this.fps,
      x: focus.x,
      z: focus.z,
      speed: this.car.state.speed,
      keys: [...this.keys],
      tileErrors: this.tileErrors,
      quality: this.qualityLevel,
      renderScale: this.renderScale,
      gpu: this.gpuName,
      drawCalls: this.renderer.info.render.calls,
      triangles: this.renderer.info.render.triangles,
      degraded: this.degradeStep,
      landcover: this.terrain?.landcoverStats ?? this.landcover?.stats() ?? null,
      route: this.route ? { distance: Math.round(this.route.distance), label: this.routeLabel } : null,
      wallet: {
        cash: this.wallet.cash,
        account: this.wallet.account,
        total: this.wallet.cash + this.wallet.account,
        transactions: this.wallet.transactions.length,
      },
      needs: { hunger: Math.round(this.needs.hunger), energy: Math.round(this.needs.energy), fun: Math.round(this.needs.fun) },
      clock: { day: this.gameDay, minutes: Math.floor(this.gameMinutes), label: formatGameClock(this.gameMinutes) },
      venue: this.venueOpen?.name ?? null,
      kit: this.kit
        ? { assets: this.kit.count, ...this.cityProps, piazzas: this.pavedAreas.length }
        : null,
      errorCount: this.errors.length,
      weather: this.realWeatherEnabled
        ? {
            enabled: true,
            loading: this.realWeather.loading,
            code: this.realWeather.snapshot?.code ?? null,
            cloudCover: this.realWeather.snapshot?.cloudCover ?? null,
            error: this.realWeather.error,
          }
        : null,
      errors: this.errors,
    };
  }
}

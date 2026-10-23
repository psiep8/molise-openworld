import * as THREE from 'three';
import { GAME, HOME, START, VIEW_RADIUS, VILLAGES, WORLD, latLonToWorld, worldToLatLon } from './config';
import { clamp, distance2, smoothstep, type Pt } from './geo/geo';
import { loadHeightfield, type Heightfield } from './geo/elevation';
import { BuildingIndex, loadOsm, RoadIndex, type OsmData } from './geo/osm';
import { ESRI_WORLD_IMAGERY, ImageryStreamer } from './world/imagery';
import { Terrain, setCloudShadow } from './world/terrain';
import { buildBuildings, setWindowGlow } from './world/buildings';
import { buildChurch } from './world/church';
import { buildDryStoneWalls } from './world/dry-stone';
import { buildPowerLines } from './world/power-lines';
import { buildRoads, buildWater } from './world/roads';
import { StreetLights, buildRoadDrainage, buildSigns, buildStreetProps } from './world/street-furniture';
import { buildVegetation } from './world/vegetation';
import { buildCityProps } from './world/city-props';
import { loadCityKit, type CityKit } from './world/citykit';
import { DEFAULT_LIGHTING, DEFAULT_SKY, DEFAULT_SUN, createSky, type SkyRig } from './world/sky';
import { CloudLayer } from './world/clouds';
import { Precipitation } from './world/precipitation';
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
  getVehicle,
  loadPaintFor,
  loadVehicleId,
  savePaintFor,
  saveVehicleId,
  vehicleLabel,
} from './sim/vehicle-catalog';
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
import { buildRoadGraph, planRoute, type RoadGraph, type RouteResult } from './sim/routing';
import { PostPipeline } from './gfx/post';
import { updateWind } from './gfx/wind';
import {
  QUALITY_PRESETS,
  loadQuality,
  nextQuality,
  saveQuality,
  type QualityLevel,
  type QualityPreset,
} from './gfx/quality';
import { GameAudio } from './audio/audio';

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
  route: { distance: number; label: string } | null;
  wallet: { cash: number; account: number; total: number; transactions: number };
  needs: { hunger: number; energy: number; fun: number };
  clock: { day: number; minutes: number; label: string };
  venue: string | null;
  /** asset del city kit caricati e arredo piazzato (null se il kit manca) */
  kit: { assets: number; trees: number; cars: number } | null;
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
const EXPOSURE_DAY = 0.72;

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
  private osm!: OsmData;
  private roadIndex!: RoadIndex;
  private buildingIndex!: BuildingIndex;
  private terrain!: Terrain;
  private sky!: SkyRig;
  private map!: MapRenderer;
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
  private loaded = false;
  private running = false;
  private keys = new Set<string>();
  private pointerLocked = false;
  private thirdPerson = false;
  private camYawOffset = 0;
  private camPitch = 0;
  private camDistance = 8.8;
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
  private post?: PostPipeline;
  private renderScale = 1;
  private lastQualityCheck = 0;
  private clouds!: CloudLayer;
  private precipitation!: Precipitation;
  private grass?: GrassField;
  private streetLights?: StreetLights;
  private kit: CityKit | null = null;
  private cityProps: {
    trees: number;
    cars: number;
    hedges: number;
    bushes: number;
    reeds: number;
    rocks: number;
    wrecks: number;
  } = { trees: 0, cars: 0, hedges: 0, bushes: 0, reeds: 0, rocks: 0, wrecks: 0 };
  private nightFactor = 0;
  private roadsGroup?: THREE.Group;
  private lastWetness = -1;
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
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    // 0,72: con l'esposizione precedente (0,88) le facciate chiare e l'asfalto
    // finivano a ridosso del bianco e la scena sembrava lavata.
    this.renderer.toneMappingExposure = EXPOSURE_DAY;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;

    this.camera = new THREE.PerspectiveCamera(68, window.innerWidth / window.innerHeight, 0.1, 12000);
    this.camera.rotation.order = 'YXZ';
    this.camera.position.set(START.x, 400, START.z);

    // Stereo camera for VR/dual-rendering
    this.stereoCamera = new THREE.PerspectiveCamera(68, window.innerWidth / window.innerHeight, 0.1, 12000);
    this.stereoCamera.rotation.order = 'YXZ';
    this.stereoCamera.position.set(START.x, 400, START.z);

    this.scene.fog = new THREE.Fog(0xccd8dd, 1100, 4200);
    this.scene.background = new THREE.Color(0xccd8dd);

    this.scene.add(this.player.avatar);
    this.scene.add(this.car.group);
    this.player.avatar.visible = false;

    this.realWeather.onChange = () => this.updateWeatherStatus();

    this.qualityLevel = loadQuality();
    this.quality = QUALITY_PRESETS[this.qualityLevel];
    this.post = new PostPipeline(this.renderer, this.scene, this.camera, this.quality.bloom);
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
      // scaricata, macchina nuova) il gioco parte lo stesso con le mesh procedurali
      const kitPromise = loadCityKit(
        `${import.meta.env.BASE_URL}citykit/`,
        `${import.meta.env.BASE_URL}draco/`,
        this.renderer.capabilities.getMaxAnisotropy(),
      ).catch((error) => {
        console.warn('city kit non caricato', error);
        return null;
      });
      const [heights, osm, kit] = await Promise.all([loadHeightfield(base), loadOsm(base), kitPromise]);
      this.heights = heights;
      this.osm = osm;
      this.kit = kit;
      this.hud.setLoading(0.32, 'Disegno strade, torrenti e paesi…');
      await nextFrame();

      this.roadIndex = new RoadIndex(osm.roads);
      this.buildingIndex = new BuildingIndex(osm.buildings);
      this.roadGraph = buildRoadGraph(osm.roads);
      this.ensureHome();
      this.populateVehicles();
      const streets = buildRoads(osm, heights, this.renderer, this.roadIndex, this.buildingIndex, this.kit);
      this.roadsGroup = streets.group;
      this.scene.add(this.roadsGroup);
      this.streetLights = new StreetLights(streets.lamps, heights, this.renderer);
      this.scene.add(this.streetLights.group);
      this.scene.add(buildWater(osm, heights, this.renderer));

      this.scene.add(buildSigns(osm, heights, this.buildingIndex, this.renderer));
      this.scene.add(buildStreetProps(osm, heights, this.buildingIndex, this.renderer, this.kit, this.qualityLevel));
      this.scene.add(buildRoadDrainage(osm, heights));
      // la chiesa cerca un posto libero attorno al centro del paese; l'impronta
      // entra nell'indice prima di alberi, cespugli ed erba, così nessuno ci
      // cresce dentro (e il giocatore non la attraversa)
      const church = buildChurch(START, heights, this.roadIndex, this.buildingIndex, this.renderer);
      if (church) {
        this.scene.add(church.group);
        this.buildingIndex.add(church.footprint);
      }
      this.scene.add(buildDryStoneWalls(osm, heights, this.roadIndex, this.buildingIndex, this.renderer));
      this.scene.add(buildPowerLines(osm, heights, this.roadIndex, this.buildingIndex));

      this.hud.setLoading(0.5, 'Costruisco le case…');
      await nextFrame();
      this.scene.add(buildBuildings(osm, heights, this.renderer).group);

      this.hud.setLoading(0.64, 'Pianto alberi e uliveti…');
      await nextFrame();
      this.scene.add(buildVegetation(osm, heights, this.roadIndex, this.buildingIndex, this.renderer).group);
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
        };
      }
      this.grass = new GrassField();
      this.scene.add(this.grass.group);

      this.car.setSpec(getVehicle(loadVehicleId()));
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
      this.scene.add(this.precipitation.group);
      this.routeBeacon = this.createRouteBeacon();
      this.scene.add(this.routeBeacon);

      const imagery = new ImageryStreamer(ESRI_WORLD_IMAGERY, this.renderer.capabilities.getMaxAnisotropy(), () => {
        this.tileErrors++;
      });
      this.terrain = new Terrain(heights, imagery, this.renderer);
      this.scene.add(this.terrain.group);

      this.spawnAtStart();
      this.hud.setLoading(0.78, 'Carico il terreno intorno a Palata…');
      await this.terrain.preload(this.player.position.x, this.player.position.z, 1600);

      this.map = new MapRenderer(osm);
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
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.errors.push(`personaggi: ${message}`);
      console.warn('personaggi non caricati', err);
    }
  }

  private spawnPedestrians(): void {
    if (!this.humanAssets) return;
    const count = this.qualityLevel === 'low' ? 6 : this.qualityLevel === 'medium' ? 10 : 18;
    this.pedestrians = new Pedestrians(
      this.humanAssets,
      this.osm,
      this.heights,
      this.roadIndex,
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
      this.player.spawn(safe.x, safe.z, 0, this.heights);
    } else {
      const pose = this.findRoadPose(START.x, START.z, 0.6) ?? {
        x: START.x,
        z: START.z,
        yaw: 0,
        distance: 0,
      };
      this.player.spawn(pose.x, pose.z, pose.yaw, this.heights);
    }
    this.player.avatar.visible = false;

    const pose = { x: this.player.position.x, z: this.player.position.z, yaw: this.player.yaw, distance: 0 };
    const aheadX = pose.x - Math.sin(pose.yaw) * 13;
    const aheadZ = pose.z - Math.cos(pose.yaw) * 13;
    // l'auto non deve nascere dentro un muro: cerca un punto libero nei paraggi
    const carPose = this.findRoadPose(aheadX, aheadZ, 1.7) ?? this.findRoadPose(aheadX, aheadZ, 0.9) ?? pose;
    this.car.reset(carPose.x, carPose.z, carPose.yaw, this.heights);

    this.terrain.update(this.player.position.x, this.player.position.z, VIEW_RADIUS, true);
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

  /** Riempie la select del veicolo con tutto il catalogo (preesistenti + nuovi). */
  private populateVehicles(): void {
    this.fillSelect(
      'vehicle-select',
      VEHICLES.map((v) => [v.id, v.name] as const),
    );
    const select = document.getElementById('vehicle-select') as HTMLSelectElement | null;
    if (select) select.value = this.car.spec.id;
    const copy = document.getElementById('vehicle-count-copy');
    if (copy) {
      copy.textContent = `${VEHICLES.length} modelli disponibili: quelli già presenti nel progetto e i 13 richiesti. Ognuno ha ingombri e parametri di guida propri.`;
    }
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
    saveAppearance(next);
    this.syncSettingsControls();
  }

  private buildPaintSwatches(): void {
    const host = document.getElementById('paint-swatches');
    if (!host) return;
    host.textContent = '';
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
    this.player.spawn(spot.x, spot.z, pose.yaw, this.heights);
    this.car.reset(pose.x, pose.z, pose.yaw, this.heights);
    this.mode = 'walk';
    this.hud.setMode('walk');
    this.player.avatar.visible = this.thirdPerson;
    this.camera.fov = 68;
    this.camera.updateProjectionMatrix();
    this.snapWalkCamera();
    this.terrain.update(this.player.position.x, this.player.position.z, VIEW_RADIUS, true);
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
    const spec = getVehicle(id);
    if (spec.id === this.car.spec.id) return;
    this.car.setSpec(spec);
    saveVehicleId(spec.id);
    if (this.heights) {
      const { x, z, yaw } = this.car.state;
      this.car.reset(x, z, yaw, this.heights);
    }
    this.hud.setVehicleName(spec.name);
    this.hud.setVehicleSpec(vehicleLabel(spec));
    this.buildPaintSwatches();
    this.syncSettingsControls();
    this.hud.toast(`Veicolo: ${spec.name} · ${spec.blurb}`, 2800);
  }

  private cycleVehicle(): void {
    const index = VEHICLES.findIndex((v) => v.id === this.car.spec.id);
    this.selectVehicle(VEHICLES[(index + 1) % VEHICLES.length].id);
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
      this.routeBeacon.position.set(x, this.heights.heightAt(x, z), z);
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
    this.scene.fog = new THREE.Fog(0xccd8dd, 1100, 4200);
    this.scene.background = new THREE.Color(0xccd8dd);
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
      turbidity: 2 + cloud * 9 + (rain + snow) * 5,
      rayleigh: Math.max(0.6, 1.6 - cloud * 0.6 + horizon * 1.1),
      mieCoefficient: 0.003 + cloud * 0.015 + (rain + snow) * 0.008,
      mieDirectionalG: 0.82,
    });

    this.sunTint.setHex(0xfff2db).lerp(this.tintA.setHex(0xffa968), horizon * 0.85);
    this.sunTint.lerp(this.tintB.setHex(0xcdd8e2), cloud * 0.7);
    const sunIntensity =
      Math.max(0, Math.sin(THREE.MathUtils.degToRad(Math.max(0, sun.elevation)))) *
      3.0 *
      (1 - 0.7 * cloud) *
      (1 - 0.55 * (rain + snow));

    this.sky.setLighting({
      sunColor: this.sunTint.getHex(),
      sunIntensity,
      hemiSky: day < 0.2 ? 0x263a58 : cloud > 0.5 ? 0xb2bcc4 : 0xa8c8ee,
      hemiGround: day < 0.2 ? 0x0d1218 : 0x63583f,
      hemiIntensity: 0.1 + 0.3 * day + 0.1 * cloud,
      ambientIntensity: 0.04 + 0.1 * day + 0.04 * cloud,
      moonIntensity: sun.elevation < 0 ? 0.4 : 0,
    });

    let fogNear = 1000 + (1 - cloud) * 500;
    let fogFar = 3000 + (1 - cloud) * 1600;
    if (foggy) {
      fogNear = 18;
      fogFar = 480;
    } else if (snow > 0) {
      fogNear = 120;
      fogFar = 1200;
    } else if (rain > 0) {
      fogNear = 260;
      fogFar = 2000;
    }
    if (day < 0.5) {
      fogNear *= 0.7;
      fogFar *= 0.7;
    }

    this.fogColor.setHex(0x0a131e).lerp(this.tintA.setHex(0xc9d6dd), day);
    this.fogColor.lerp(this.tintB.setHex(0xe6bd92), horizon * day * 0.35);
    this.fogColor.lerp(this.tintA.setHex(0x9aa7ae), cloud * 0.35 * day);
    if (foggy) this.fogColor.lerp(this.tintA.setHex(0xb9c2c6), 0.5 * day);

    if (this.scene.fog instanceof THREE.Fog) {
      this.scene.fog.color.copy(this.fogColor);
      this.scene.fog.near = fogNear;
      this.scene.fog.far = fogFar;
    }
    this.scene.background = this.fogColor;
    this.renderer.toneMappingExposure = EXPOSURE_DAY - (1 - day) * 0.1 + cloud * 0.02;

    const windRad = THREE.MathUtils.degToRad(w.windDirection);
    const windX = -Math.sin(windRad) * w.windSpeed * 0.08;
    const windZ = -Math.cos(windRad) * w.windSpeed * 0.08;
    this.clouds.update(dt, this.camera, { coverage: cover, windX, windZ, sunElevation: sun.elevation });
    // ombre delle nuvole sul suolo: solo con cielo coperto e di giorno
    setCloudShadow(cloud * day, dt, windX, windZ);
    // finestre accese: si accendono al tramonto, si spengono all'alba
    setWindowGlow(1 - day);
    // stelle e luna
    this.sky.setNightSky(1 - day);
    this.precipitation.update(dt, this.camera, { rain, snow, windX, windZ });

    // fari accesi quando il sole è basso, strada bagnata con pioggia o neve
    const night = 1 - smoothstep(-3, 10, sun.elevation);
    this.nightFactor = night;
    this.car.setLights(night);
    this.applyWetness(Math.max(rain, snow * 0.5));
  }

  // -------------------------------------------------------------------------
  // grafica / preset
  // -------------------------------------------------------------------------
  private basePixelRatio(): number {
    return Math.min(window.devicePixelRatio || 1, this.quality.pixelRatio);
  }

  /** Applica il preset e il resolution scaling adattivo. */
  private applyRenderScale(): void {
    const ratio = Math.max(0.6, this.basePixelRatio() * this.renderScale);
    this.renderer.setPixelRatio(ratio);
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.post?.setPixelRatio(ratio);
    this.post?.setSize(window.innerWidth, window.innerHeight);
  }

  private applyQuality(level: QualityLevel, announce = true): void {
    this.qualityLevel = level;
    this.quality = QUALITY_PRESETS[level];
    saveQuality(level);
    this.renderScale = 1;
    this.renderer.shadowMap.enabled = true;
    this.applyRenderScale();
    this.sky?.setShadowMapSize(this.quality.shadowMapSize);
    this.terrain?.setMaxZoom(this.quality.maxSatelliteZoom);
    this.post?.setEnabled(this.quality.post && !this.stereo);
    this.post?.setBloom(this.quality.bloom);
    this.post?.setSSAO(this.quality.ssao && !this.stereo);
    if (announce) {
      const fx = this.quality.post ? ` · bloom${this.quality.ssao ? ' + SSAO' : ''}` : '';
      this.hud.toast(`Grafica: ${this.quality.label}${fx} · satellite z${this.quality.maxSatelliteZoom}`, 3200);
    }
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
        if (this.mode === 'walk') this.interact();
        else this.hud.toast('Scendi dall\'auto per entrare nell\'attività', 2400);
        break;
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
        }
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
    this.post?.setPixelRatio(Math.max(0.6, this.basePixelRatio() * this.renderScale));
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
      this.hud.toast('W accelera · S frena/retro · A/D sterza · Spazio freno a mano · F scendi', 5200);
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
    this.player.spawn(x, z, this.car.state.yaw, this.heights);
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
      this.player.spawn(pose.x, pose.z, pose.yaw, this.heights);
      this.snapWalkCamera();
    } else {
      this.car.reset(pose.x, pose.z, pose.yaw, this.heights);
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
    // il tempo reale serve a misurare gli fps, quello limitato alla simulazione:
    // sotto i 20 fps il passo di fisica non deve superare i 50 ms (tunneling)
    this.timer.update();
    const rawDt = Math.min(0.5, this.timer.getDelta());
    const dt = Math.min(0.05, rawDt);

    this.fpsFrames++;
    this.fpsElapsed += rawDt;
    if (this.fpsElapsed >= 0.5) {
      this.fps = this.fpsFrames / this.fpsElapsed;
      this.fpsFrames = 0;
      this.fpsElapsed = 0;
      // resolution scaling adattivo: tiene il frame rate sopra i ~35 fps
      this.lastQualityCheck += 0.5;
      if (this.lastQualityCheck >= 2 && this.running) {
        this.lastQualityCheck = 0;
        if (this.fps < 34 && this.renderScale > 0.65) {
          this.renderScale = Math.max(0.65, this.renderScale - 0.15);
          this.applyRenderScale();
        } else if (this.fps > 56 && this.renderScale < 1) {
          this.renderScale = Math.min(1, this.renderScale + 0.1);
          this.applyRenderScale();
        }
      }
    }

    if (this.running && this.loaded) this.update(dt);
    else this.idle(dt);

    if (this.sky) {
      this.sky.dome.position.copy(this.camera.position);
      this.sky.updateEnvironment(this.renderer, this.scene);
    }
    if (this.stereo) this.renderStereo();
    else if (this.post) this.post.render(dt);
    else this.renderer.render(this.scene, this.camera);
    this.publishDiagnostics();
  };

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

  private idle(dt: number): void {
    if (!this.heights) return;
    this.idleAngle += dt * 0.035;
    const radius = 1150;
    const x = START.x + Math.cos(this.idleAngle) * radius;
    const z = START.z + Math.sin(this.idleAngle) * radius;
    const y = this.heights.heightAt(x, z) + 210;
    this.camera.position.set(x, y, z);
    this.camera.lookAt(START.x, this.heights.heightAt(START.x, START.z) + 30, START.z);
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
      }
      this.needs = advanceNeeds(this.needs, gameDelta);
    }
    this.saveClock += dt;
    if (this.saveClock >= 30) {
      this.saveClock = 0;
      this.saveGame();
    }

    if (this.mode === 'walk') {
      this.player.update(dt, move, this.heights, this.buildingIndex, this.roadIndex);
      this.player.position.x = clamp(this.player.position.x, -WORLD.halfWidth + 25, WORLD.halfWidth - 25);
      this.player.position.z = clamp(this.player.position.z, -WORLD.halfHeight + 25, WORLD.halfHeight - 25);
      this.updateWalkCamera(dt);
    } else {
      this.car.update(dt, this.readCarInput(move), this.heights, this.roadIndex, this.buildingIndex);
      this.updateDriveCamera(dt);
    }

    const focus = this.mode === 'walk' ? this.player.position : this.car.position;
    this.pedestrians?.update(dt, focus);
    this.terrain.update(focus.x, focus.z, VIEW_RADIUS);
    this.terrain.tick();
    updateWind(dt);
    this.grass?.update(focus.x, focus.z, this.heights, this.roadIndex, this.buildingIndex, this.quality.grassDensity);
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
    });

    const now = performance.now();
    if (now - this.lastTick > 110) {
      this.lastTick = now;
      this.updateHud(focus.x, focus.z);
    }
    if (now - this.lastHud > 100 && this.map) {
      this.lastHud = now;
      const yaw = this.mode === 'walk' ? this.player.yaw : this.car.state.yaw;
      this.map.drawMinimap(
        document.getElementById('minimap') as HTMLCanvasElement,
        { x: focus.x, z: focus.z, yaw },
        this.mode === 'walk' ? { x: this.car.state.x, z: this.car.state.z } : undefined,
        this.route?.points,
        this.garage,
        VENUES,
      );
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
    };
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
    desired.y = Math.max(desired.y, this.heights.heightAt(desired.x, desired.z) + 0.75);
    this.camera.position.lerp(desired, 1 - Math.exp(-14 * dt));
    this.camera.lookAt(target);
  }

  private updateDriveCamera(dt: number): void {
    const car = this.car.state;
    const yaw = car.yaw + this.camYawOffset;
    const desired = this.tmp1.set(
      car.x + Math.sin(yaw) * this.camDistance,
      this.car.position.y + 2.9 + this.camPitch * 3.4,
      car.z + Math.cos(yaw) * this.camDistance,
    );
    desired.y = Math.max(desired.y, this.heights.heightAt(desired.x, desired.z) + 1.1);
    this.camera.position.lerp(desired, 1 - Math.exp(-7.5 * dt));

    const fx = -Math.sin(car.yaw);
    const fz = -Math.cos(car.yaw);
    const target = this.tmp2.set(car.x + fx * 3.2, this.car.position.y + 1.2, car.z + fz * 3.2);
    this.camera.lookAt(target);
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
    desired.y = Math.max(desired.y, this.heights.heightAt(desired.x, desired.z) + 0.75);
    this.camera.position.copy(desired);
    this.camera.lookAt(target);
  }

  private snapDriveCamera(): void {
    const car = this.car.state;
    this.camera.position.set(
      car.x + Math.sin(car.yaw) * this.camDistance,
      this.car.position.y + 3,
      car.z + Math.cos(car.yaw) * this.camDistance,
    );
    this.camera.lookAt(car.x, this.car.position.y + 1.2, car.z);
  }

  private updateHud(x: number, z: number): void {
    const ll = worldToLatLon(x, z);
    const elev = this.heights.heightAt(x, z);
    this.hud.setPosition(ll.lat, ll.lon, elev, this.fps);
    this.hud.setMode(this.mode);
    this.hud.setSpeed(this.mode === 'drive' ? this.car.kmh : 0);
    this.hud.setGear(this.car.gear, this.car.rpm);
    this.hud.setNeeds(this.needs);
    this.hud.setClock(this.gameDay, this.gameMinutes);
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
      kit: this.kit ? { assets: this.kit.count, ...this.cityProps } : null,
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

import * as THREE from 'three';
import { GAME, HOME, START, VIEW_RADIUS, VILLAGES, WORLD, latLonToWorld, worldToLatLon } from './config';
import { clamp, distance2, smoothstep } from './geo/geo';
import { loadHeightfield, type Heightfield } from './geo/elevation';
import { BuildingIndex, loadOsm, RoadIndex, type OsmData } from './geo/osm';
import { ESRI_WORLD_IMAGERY, ImageryStreamer } from './world/imagery';
import { Terrain } from './world/terrain';
import { buildBuildings } from './world/buildings';
import { buildRoads, buildWater } from './world/roads';
import { buildVegetation } from './world/vegetation';
import { DEFAULT_LIGHTING, DEFAULT_SKY, DEFAULT_SUN, createSky, type SkyRig } from './world/sky';
import { CloudLayer } from './world/clouds';
import { Precipitation } from './world/precipitation';
import { RealWeather, defaultWeather, isFogCode, sunPosition, weatherLabel } from './world/weather';
import { Player, type MoveInput } from './entities/player';
import { Vehicle } from './entities/vehicle';
import { Hud, type Mode } from './ui/hud';
import { MapRenderer } from './ui/minimap';
import type { CarInput } from './sim/car';
import { PostPipeline } from './gfx/post';
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

export class Game {
  private readonly canvas: HTMLCanvasElement;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly clock = new THREE.Clock();
  private readonly hud = new Hud();
  private readonly player = new Player();
  private readonly car = new Vehicle();
  private readonly audio = new GameAudio();
  private readonly realWeather = new RealWeather();

  private heights!: Heightfield;
  private osm!: OsmData;
  private roadIndex!: RoadIndex;
  private buildingIndex!: BuildingIndex;
  private terrain!: Terrain;
  private sky!: SkyRig;
  private map!: MapRenderer;

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
  private realWeatherEnabled = false;
  private settingsVisible = false;
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
    this.renderer.toneMappingExposure = 0.92;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.camera = new THREE.PerspectiveCamera(68, window.innerWidth / window.innerHeight, 0.1, 12000);
    this.camera.rotation.order = 'YXZ';
    this.camera.position.set(START.x, 400, START.z);

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
      const [heights, osm] = await Promise.all([loadHeightfield(base), loadOsm(base)]);
      this.heights = heights;
      this.osm = osm;
      this.hud.setLoading(0.32, 'Disegno strade, torrenti e paesi…');
      await nextFrame();

      this.roadIndex = new RoadIndex(osm.roads);
      this.buildingIndex = new BuildingIndex(osm.buildings);
      this.scene.add(buildRoads(osm, heights));
      this.scene.add(buildWater(osm, heights));

      this.hud.setLoading(0.5, 'Costruisco le case…');
      await nextFrame();
      this.scene.add(buildBuildings(osm, heights).group);

      this.hud.setLoading(0.64, 'Pianto alberi e uliveti…');
      await nextFrame();
      this.scene.add(buildVegetation(osm, heights, this.roadIndex, this.buildingIndex).group);

      this.hud.setLoading(0.72, 'Alzo il cielo…');
      await nextFrame();
      this.sky = createSky(this.scene);
      this.clouds = new CloudLayer();
      this.scene.add(this.clouds.mesh);
      this.precipitation = new Precipitation();
      this.scene.add(this.precipitation.group);

      const imagery = new ImageryStreamer(ESRI_WORLD_IMAGERY, this.renderer.capabilities.getMaxAnisotropy(), () => {
        this.tileErrors++;
      });
      this.terrain = new Terrain(heights, imagery);
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

      const autostart = new URLSearchParams(window.location.search).get('autostart');
      if (autostart === 'walk' || autostart === 'drive') {
        this.start(autostart);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.errors.push(message);
      this.hud.showFatal(`Impossibile caricare il mondo.\n\n${message}\n\nSe mancano i file geo: esegui "npm run geo".`);
    }
  }

  // -------------------------------------------------------------------------
  // setup
  // -------------------------------------------------------------------------
  private spawnAtStart(): void {
    const pose = this.findRoadPose(START.x, START.z, 0.6) ?? {
      x: START.x,
      z: START.z,
      yaw: 0,
      distance: 0,
    };
    this.player.spawn(pose.x, pose.z, pose.yaw, this.heights);
    this.player.avatar.visible = false;

    const aheadX = pose.x - Math.sin(pose.yaw) * 13;
    const aheadZ = pose.z - Math.cos(pose.yaw) * 13;
    // l'auto non deve nascere dentro un muro: cerca un punto libero nei paraggi
    const carPose = this.findRoadPose(aheadX, aheadZ, 1.7) ?? this.findRoadPose(aheadX, aheadZ, 0.9) ?? pose;
    this.car.reset(carPose.x, carPose.z, carPose.yaw, this.heights);

    this.terrain.update(this.player.position.x, this.player.position.z, VIEW_RADIUS, true);
    this.snapWalkCamera();
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

  private bindUi(): void {
    document.getElementById('btn-walk')?.addEventListener('click', () => this.start('walk'));
    document.getElementById('btn-drive')?.addEventListener('click', () => this.start('drive'));
    document.getElementById('btn-settings')?.addEventListener('click', () => this.showSettings(!this.settingsVisible));
    document.getElementById('btn-settings-close')?.addEventListener('click', () => this.showSettings(false));
    document.getElementById('btn-weather-refresh')?.addEventListener('click', () => this.refreshWeather());
    const weatherToggle = document.getElementById('toggle-real-weather') as HTMLInputElement | null;
    weatherToggle?.addEventListener('change', () => this.setRealWeather(weatherToggle.checked));
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
    if (!this.realWeatherEnabled) {
      this.hud.setWeatherStatus('Meteo reale disattivato: il mondo usa il pomeriggio fisso del gioco.');
      this.hud.setWeatherBusy(false);
      return;
    }

    const w = this.realWeather.snapshot;
    let text: string;
    if (!w) {
      text = this.realWeather.loading
        ? 'Recupero il meteo reale di Palata…'
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
    this.renderer.toneMappingExposure = 0.92;
    this.scene.fog = new THREE.Fog(0xccd8dd, 1100, 4200);
    this.scene.background = new THREE.Color(0xccd8dd);
    this.clouds?.setVisible(false);
    this.precipitation?.clear();
  }

  /** Applica sole reale e condizioni meteo al cielo, alle luci e alle particelle. */
  private applyWeatherVisuals(dt: number, focus: THREE.Vector3): void {
    const ll = worldToLatLon(focus.x, focus.z);
    // la posizione aggiornata serve al prossimo refresh automatico
    this.realWeather.setLocation(ll.lat, ll.lon);
    const sun = sunPosition(new Date(), ll.lat, ll.lon);
    const w = this.realWeather.snapshot ?? defaultWeather();
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
      3.4 *
      (1 - 0.7 * cloud) *
      (1 - 0.55 * (rain + snow));

    this.sky.setLighting({
      sunColor: this.sunTint.getHex(),
      sunIntensity,
      hemiSky: day < 0.2 ? 0x263a58 : cloud > 0.5 ? 0xb2bcc4 : 0xa8c8ee,
      hemiGround: day < 0.2 ? 0x0d1218 : 0x63583f,
      hemiIntensity: 0.2 + 0.55 * day + 0.2 * cloud,
      ambientIntensity: 0.08 + 0.14 * day + 0.06 * cloud,
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
    this.renderer.toneMappingExposure = 0.92 - (1 - day) * 0.12 + cloud * 0.02;

    const windRad = THREE.MathUtils.degToRad(w.windDirection);
    const windX = -Math.sin(windRad) * w.windSpeed * 0.08;
    const windZ = -Math.cos(windRad) * w.windSpeed * 0.08;
    this.clouds.update(dt, this.camera, { coverage: cover, windX, windZ, sunElevation: sun.elevation });
    this.precipitation.update(dt, this.camera, { rain, snow, windX, windZ });
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
    this.post?.setEnabled(this.quality.post);
    this.post?.setBloom(this.quality.bloom);
    if (announce) {
      const fx = this.quality.post ? ' · bloom' : '';
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
      case 'KeyN': {
        const muted = this.audio.toggleMute();
        this.hud.toast(muted ? 'Audio disattivato' : 'Audio attivo');
        break;
      }
      case 'KeyP':
        this.showSettings(true);
        break;
      case 'KeyH':
        this.hud.toggleHelp();
        break;
      case 'KeyR':
        this.respawnOnRoad();
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

    this.clock.getDelta();
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
    const dt = Math.min(0.05, this.clock.getDelta());

    this.fpsFrames++;
    this.fpsElapsed += dt;
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

    if (this.sky) this.sky.dome.position.copy(this.camera.position);
    if (this.post) this.post.render(dt);
    else this.renderer.render(this.scene, this.camera);
    this.publishDiagnostics();
  };

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

    if (this.mode === 'walk') {
      this.player.update(dt, move, this.heights, this.buildingIndex);
      this.player.position.x = clamp(this.player.position.x, -WORLD.halfWidth + 25, WORLD.halfWidth - 25);
      this.player.position.z = clamp(this.player.position.z, -WORLD.halfHeight + 25, WORLD.halfHeight - 25);
      this.updateWalkCamera(dt);
    } else {
      this.car.update(dt, this.readCarInput(move), this.heights, this.roadIndex, this.buildingIndex);
      this.updateDriveCamera(dt);
    }

    const focus = this.mode === 'walk' ? this.player.position : this.car.position;
    this.terrain.update(focus.x, focus.z, VIEW_RADIUS);
    this.terrain.tick();
    if (this.realWeatherEnabled) this.applyWeatherVisuals(dt, focus);
    this.updateSky(focus);

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
    }      if (now - this.lastHud > 100 && this.map) {
        this.lastHud = now;
        const yaw = this.mode === 'walk' ? this.player.yaw : this.car.state.yaw;
        this.map.drawMinimap(
          document.getElementById('minimap') as HTMLCanvasElement,
          { x: focus.x, z: focus.z, yaw },
          this.mode === 'walk' ? { x: this.car.state.x, z: this.car.state.z } : undefined,
        );
        if (this.hud.mapVisible) this.drawBigMap();
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
      this.hud.setObjective(d <= GAME.interactionRange ? 'Premi <kbd>F</kbd> per guidare' : null);
    } else {
      this.hud.setObjective('Premi <kbd>F</kbd> per scendere · <kbd>R</kbd> per tornare in strada');
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

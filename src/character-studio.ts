import './character-studio.css';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { parse, type PosecodeIR } from 'posecode-parser';
import { buildTimeline, createViewer, type Viewer } from 'posecode-render';

/**
 * Laboratorio del personaggio.
 *
 * Due stanze nello stesso studio:
 *  - "Movimento" fa recitare i movimenti Posecode sui corpi RPM con scheletro
 *    Mixamo (gli unici animabili: le sculture fornite non hanno skin);
 *  - "Sculture" mostra i GLB dell'utente come pezzi da museo, con la stessa
 *    normalizzazione (Box3 + fitHeight) per non dipendere dalle unità originali.
 *
 * Le due viste hanno renderer separati: quella statica viene creata solo alla
 * prima apertura della scheda, così la pagina non paga due contesti WebGL se
 * l'utente guarda solo i movimenti.
 */

const BASE = document.baseURI;
const assetUrl = (path: string): string => new URL(path, BASE).href;

function byId<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`#${id} non trovato in characters.html`);
  return element as T;
}

function formatSeconds(value: number): string {
  return `${value.toFixed(1).replace('.', ',')} s`;
}

function formatNumber(value: number): string {
  return value.toFixed(2).replace('.', ',');
}

// ---------------------------------------------------------------- movimenti

const SOURCES = import.meta.glob('./posecode/movements/*.posecode', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

interface Movement {
  slug: string;
  ir: PosecodeIR;
  title: string;
  group: string;
  hint: string;
  duration: number;
}

/** Ordine di lettura: prima come si sta fermi, poi come ci si muove. */
const MOVEMENT_ORDER = [
  'idle-breathe',
  'look-around',
  'wave',
  'walk',
  'run',
  'stretch',
  'squat',
  'pick-up',
] as const;

const MOVEMENT_META: Record<string, { group: string; hint: string }> = {
  'idle-breathe': { group: 'Postura', hint: 'respiro' },
  'look-around': { group: 'Postura', hint: 'sguardo' },
  wave: { group: 'Gesti', hint: 'saluto' },
  walk: { group: 'Deambulazione', hint: 'passo' },
  run: { group: 'Deambulazione', hint: 'corsa' },
  stretch: { group: 'Quotidiano', hint: 'allungo' },
  squat: { group: 'Quotidiano', hint: 'forza' },
  'pick-up': { group: 'Quotidiano', hint: 'raccolta' },
};

function buildMovements(): Movement[] {
  const entries: Movement[] = [];
  for (const [path, source] of Object.entries(SOURCES)) {
    const slug = path.split('/').pop()?.replace('.posecode', '') ?? path;
    const { ir, errors } = parse(source);
    if (!ir || errors.length > 0) {
      console.warn(`movimento ignorato: ${slug}`, errors);
      continue;
    }
    const meta = MOVEMENT_META[slug] ?? { group: 'Altro', hint: '' };
    entries.push({
      slug,
      ir,
      title: ir.name,
      group: meta.group,
      hint: meta.hint,
      // La timeline include già l'eventuale segmento di chiusura: è la stessa
      // durata che mostra la barra di avanzamento del viewer.
      duration: buildTimeline(ir).duration,
    });
  }
  const rank = (slug: string): number => {
    const index = MOVEMENT_ORDER.indexOf(slug as (typeof MOVEMENT_ORDER)[number]);
    return index < 0 ? MOVEMENT_ORDER.length : index;
  };
  return entries.sort((a, b) => rank(a.slug) - rank(b.slug));
}

const movements = buildMovements();

// ------------------------------------------------------------- vista animata

type Sex = 'donna' | 'uomo';
type TabName = 'motion' | 'sculpt';

/** Testo del velo di caricamento per ciascuna scheda; cambia scheda, cambia testo. */
const tabLoading: Record<TabName, string | null> = {
  motion: 'Carico il corpo…',
  sculpt: null,
};
let activeTab: TabName = 'motion';

const BODY_URLS: Record<Sex, string> = {
  donna: assetUrl('models/donna.glb'),
  uomo: assetUrl('models/uomo.glb'),
};

const animHost = byId<HTMLDivElement>('anim-host');
const phaseBadge = byId<HTMLDivElement>('phase-badge');
const phaseName = byId<HTMLElement>('phase-name');
const phaseCue = byId<HTMLElement>('phase-cue');
const playButton = byId<HTMLButtonElement>('play-btn');
const scrub = byId<HTMLInputElement>('scrub');
const timeNow = byId<HTMLElement>('time-now');
const timeTotal = byId<HTMLElement>('time-total');
const speedInput = byId<HTMLInputElement>('speed');
const speedOutput = byId<HTMLOutputElement>('speed-out');
const motionStatus = byId<HTMLParagraphElement>('motion-status');
const moveList = byId<HTMLDivElement>('move-list');
const sexSwitch = byId<HTMLDivElement>('sex-switch');

let viewer: Viewer | null = null;
let sex: Sex = 'donna';
let current: Movement | null = null;
let speed = 1;
let scrubbing = false;
let characterWatch = 0;
let lastPhase: { name: string; cue: string } | null = null;

function setMotionStatus(message: string, error = false): void {
  motionStatus.textContent = message;
  motionStatus.classList.toggle('error', error);
}

/** Aggiorna il velo solo se la scheda è quella visibile. */
function setTabLoading(tab: TabName, text: string | null): void {
  tabLoading[tab] = text;
  if (activeTab === tab) setLoading(text);
}

/**
 * Il renderer non espone un evento "personaggio pronto": la comparsa del corpo
 * skinnato è l'unico segnale pubblico. Lo si osserva finché arriva; dopo dodici
 * secondi si toglie comunque il velo e si mostra la figura procedurale, così un
 * GLB mancante non lascia la pagina in caricamento per sempre.
 */
function watchCharacter(target: Viewer): void {
  const token = ++characterWatch;
  const started = performance.now();
  const check = (): void => {
    if (token !== characterWatch || target !== viewer) return;
    if (target.characterActive) {
      setTabLoading('motion', null);
      setMotionStatus(
        current
          ? `Corpo pronto · ${current.title} · ${formatSeconds(current.duration)}`
          : `Corpo ${sex === 'donna' ? 'femminile' : 'maschile'} pronto.`,
      );
      return;
    }
    if (performance.now() - started > 12_000) {
      setTabLoading('motion', null);
      setMotionStatus('Corpo non disponibile: mostro la figura procedurale.', true);
      return;
    }
    requestAnimationFrame(check);
  };
  requestAnimationFrame(check);
}

function updateTransport(time: number, duration: number): void {
  const safeDuration = Math.max(duration, 0.001);
  if (!scrubbing) scrub.value = String(Math.min(time, safeDuration));
  scrub.max = String(safeDuration);
  timeNow.textContent = formatSeconds(Math.min(time, safeDuration));
  timeTotal.textContent = formatSeconds(safeDuration);
}

function syncPlayButton(): void {
  const playing = viewer?.playing ?? false;
  playButton.textContent = playing ? '❚❚' : '▶';
  playButton.setAttribute('aria-label', playing ? 'Metti in pausa' : 'Riproduci');
}

function loadMovement(movement: Movement, autoplay = true): void {
  current = movement;
  for (const button of moveList.querySelectorAll<HTMLButtonElement>('.move')) {
    button.classList.toggle('active', button.dataset.slug === movement.slug);
  }
  phaseBadge.classList.remove('visible');
  if (!viewer) return;
  viewer.load(movement.ir);
  viewer.setLoop(true);
  viewer.setSpeed(speed);
  updateTransport(0, viewer.duration || movement.duration);
  if (autoplay) viewer.play();
  syncPlayButton();
  setMotionStatus(`${movement.title} · ${formatSeconds(movement.duration)} · ${movement.ir.phases.length} fasi`);
}

function mountViewer(): void {
  characterWatch++;
  viewer?.dispose();
  animHost.replaceChildren();

  const canvas = document.createElement('canvas');
  canvas.setAttribute('aria-label', `Corpo ${sex === 'donna' ? 'femminile' : 'maschile'} animato`);
  animHost.append(canvas);

  const next = createViewer(canvas, {
    characterUrl: BODY_URLS[sex],
    autoRotate: false,
    floorGuide: false,
    showProceduralWhileLoading: false,
  });
  viewer = next;

  next.onPhase((info) => {
    if (info.phaseIndex < 0) {
      phaseBadge.classList.remove('visible');
      return;
    }
    lastPhase = { name: info.phaseName, cue: info.cue ?? '' };
    phaseName.textContent = info.phaseName;
    phaseCue.textContent = info.cue ?? '';
    phaseCue.hidden = !info.cue;
    phaseBadge.classList.toggle('visible', activeTab === 'motion');
  });
  next.onTick((time, duration) => updateTransport(time, duration));
  next.setLoop(true);
  next.setSpeed(speed);
  next.onLoop(() => phaseBadge.classList.remove('visible'));

  if (current) {
    next.load(current.ir);
    updateTransport(0, next.duration || current.duration);
  }
  next.play();
  syncPlayButton();
  setTabLoading('motion', `Carico il corpo ${sex === 'donna' ? 'femminile' : 'maschile'}…`);
  watchCharacter(next);
}

function buildMoveList(): void {
  let group = '';
  for (const movement of movements) {
    if (movement.group !== group) {
      group = movement.group;
      const heading = document.createElement('div');
      heading.className = 'move-group';
      heading.textContent = group;
      moveList.append(heading);
    }
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'move';
    button.dataset.slug = movement.slug;
    const label = document.createElement('span');
    label.textContent = movement.title;
    const meta = document.createElement('small');
    meta.textContent = movement.hint
      ? `${movement.hint} · ${formatSeconds(movement.duration)}`
      : formatSeconds(movement.duration);
    button.append(label, meta);
    button.addEventListener('click', () => loadMovement(movement));
    moveList.append(button);
  }
}

function selectSex(nextSex: Sex): void {
  if (nextSex === sex) return;
  sex = nextSex;
  for (const button of sexSwitch.querySelectorAll<HTMLButtonElement>('button')) {
    button.classList.toggle('active', button.dataset.sex === sex);
  }
  mountViewer();
}

function wireMotionPanel(): void {
  sexSwitch.addEventListener('click', (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-sex]');
    const value = button?.dataset.sex;
    if (value === 'donna' || value === 'uomo') selectSex(value);
  });

  playButton.addEventListener('click', () => {
    viewer?.toggle();
    syncPlayButton();
  });

  scrub.addEventListener('pointerdown', () => {
    scrubbing = true;
  });
  const endScrub = (): void => {
    scrubbing = false;
  };
  scrub.addEventListener('pointerup', endScrub);
  scrub.addEventListener('pointercancel', endScrub);
  scrub.addEventListener('input', () => {
    const time = Number(scrub.value);
    viewer?.seek(time);
    timeNow.textContent = formatSeconds(time);
  });

  speedInput.addEventListener('input', () => {
    speed = Number(speedInput.value);
    speedOutput.textContent = `${formatNumber(speed)}×`;
    viewer?.setSpeed(speed);
  });
  speedOutput.textContent = `${formatNumber(speed)}×`;

  // Spazio = play/pausa, come nei player video (solo quando il focus non è su
  // un controllo che usa già lo spazio).
  window.addEventListener('keydown', (event) => {
    if (event.code !== 'Space') return;
    if (activeTab !== 'motion') return;
    const tag = (event.target as HTMLElement | null)?.tagName;
    if (tag === 'INPUT' || tag === 'BUTTON' || tag === 'SELECT' || tag === 'TEXTAREA') return;
    event.preventDefault();
    viewer?.toggle();
    syncPlayButton();
  });
}

// -------------------------------------------------------------- vista statica

interface CharacterModel {
  slug: string;
  file: string;
  title: string;
  author: string;
  source: string;
  license: string;
  kind: string;
  sex?: string;
  fitHeight: number;
  ground: boolean;
  bytes: number;
  available: boolean;
  usage: string;
}

interface CharacterManifest {
  version: number;
  note: string;
  models: CharacterModel[];
}

const KIND_LABEL: Record<string, string> = {
  body: 'Corpi',
  'body-pair': 'Corpi',
  head: 'Teste',
  hair: 'Capelli',
};

const CLAY: Record<string, number> = {
  body: 0xb99b7f,
  'body-pair': 0xb99b7f,
  head: 0xb29478,
  hair: 0x93765a,
};

/**
 * Palco delle sculture.
 *
 * Ogni modello viene centrato e scalato sull'altezza dichiarata nel manifest.
 * La camera si allontana quanto basta a inquadrare il bounding sphere, quindi
 * un corpo alto 1,8 m e una testa alta 26 cm occupano lo stesso spazio visivo
 * senza riscalare i file originali.
 */
class SculptureStage {
  private readonly host: HTMLDivElement;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(34, 1, 0.02, 60);
  private readonly controls: OrbitControls;
  private readonly loader = new GLTFLoader();
  private readonly clay = new Map<string, THREE.MeshStandardMaterial>();
  private readonly pedestal: THREE.Mesh;
  private readonly stand: THREE.Mesh;
  private readonly ground: THREE.Mesh;
  private readonly observer: ResizeObserver;
  private model: THREE.Object3D | null = null;
  private token = 0;
  private frame = 0;

  constructor(host: HTMLDivElement) {
    this.host = host;

    const canvas = document.createElement('canvas');
    canvas.setAttribute('aria-label', 'Scultura selezionata, ruotabile con il mouse');
    host.append(canvas);

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.92;

    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();

    const hemi = new THREE.HemisphereLight(0xe6eefc, 0x2a2119, 0.4);
    this.scene.add(hemi);

    const key = new THREE.DirectionalLight(0xfff1dd, 1.4);
    key.position.set(2.4, 3.8, 2.6);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.camera.near = 0.5;
    key.shadow.camera.far = 12;
    key.shadow.camera.left = -2.2;
    key.shadow.camera.right = 2.2;
    key.shadow.camera.top = 2.6;
    key.shadow.camera.bottom = -1.2;
    key.shadow.bias = -0.0008;
    this.scene.add(key);

    const rim = new THREE.DirectionalLight(0x9fc6ff, 0.45);
    rim.position.set(-2.8, 2.2, -2.4);
    this.scene.add(rim);

    const groundGeometry = new THREE.PlaneGeometry(40, 40);
    this.ground = new THREE.Mesh(
      groundGeometry,
      new THREE.MeshStandardMaterial({
        color: 0x0c1115,
        roughness: 0.95,
        metalness: 0,
        envMapIntensity: 0.15,
      }),
    );
    this.ground.rotation.x = -Math.PI / 2;
    this.ground.position.y = -0.002;
    this.ground.receiveShadow = true;
    this.scene.add(this.ground);

    const stone = new THREE.MeshStandardMaterial({
      color: 0x3a3630,
      roughness: 0.86,
      metalness: 0.06,
    });
    this.pedestal = new THREE.Mesh(new THREE.CylinderGeometry(1, 1.04, 0.055, 64), stone);
    this.pedestal.position.y = 0.0275;
    this.pedestal.receiveShadow = true;
    this.pedestal.castShadow = true;
    this.scene.add(this.pedestal);

    this.stand = new THREE.Mesh(
      new THREE.CylinderGeometry(0.011, 0.013, 1, 20),
      new THREE.MeshStandardMaterial({ color: 0x2f2b26, roughness: 0.5, metalness: 0.55 }),
    );
    this.stand.visible = false;
    this.stand.castShadow = true;
    this.scene.add(this.stand);

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.075;
    this.controls.enablePan = false;
    this.controls.autoRotate = true;
    this.controls.autoRotateSpeed = 0.55;
    this.controls.minPolarAngle = 0.25;
    this.controls.maxPolarAngle = Math.PI * 0.62;
    this.controls.target.set(0, 0.9, 0);
    // Se l'utente prende il controllo, smette il giro automatico: è fastidioso
    // trascinare un modello che continua a ruotare da solo.
    this.controls.addEventListener('start', () => {
      this.controls.autoRotate = false;
    });

    this.camera.position.set(1.6, 1.5, 2.6);
    this.camera.lookAt(0, 0.9, 0);

    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(host);
    this.resize();

    const loop = (): void => {
      this.frame = requestAnimationFrame(loop);
      if (this.host.hidden) return;
      this.controls.update();
      this.renderer.render(this.scene, this.camera);
    };
    this.frame = requestAnimationFrame(loop);
  }

  private resize(): void {
    const width = this.host.clientWidth;
    const height = this.host.clientHeight;
    if (width < 2 || height < 2) return;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  private material(kind: string): THREE.MeshStandardMaterial {
    const cached = this.clay.get(kind);
    if (cached) return cached;
    const material = new THREE.MeshStandardMaterial({
      color: CLAY[kind] ?? 0xb99b7f,
      roughness: 0.72,
      metalness: 0.02,
      envMapIntensity: 0.45,
    });
    this.clay.set(kind, material);
    return material;
  }

  private clearModel(): void {
    if (!this.model) return;
    this.scene.remove(this.model);
    this.model.traverse((object) => {
      if (object instanceof THREE.Mesh) object.geometry.dispose();
    });
    this.model = null;
  }

  load(
    model: CharacterModel,
    onProgress: (fraction: number | null) => void,
    onReady: () => void,
    onError: (message: string) => void,
  ): void {
    const token = ++this.token;
    this.clearModel();
    this.pedestal.scale.setScalar(0.001);
    this.stand.visible = false;
    onProgress(null);
    this.loader.load(
      assetUrl(`characters/${model.file}`),
      (gltf) => {
        if (token !== this.token) return;
        try {
          this.place(gltf.scene, model);
          onReady();
        } catch (error) {
          onError(error instanceof Error ? error.message : String(error));
        }
      },
      (event) => {
        if (token !== this.token) return;
        onProgress(event.total > 0 ? event.loaded / event.total : null);
      },
      (error) => {
        if (token !== this.token) return;
        const message = error instanceof Error ? error.message : String(error);
        onError(message);
      },
    );
  }

  private place(root: THREE.Object3D, model: CharacterModel): void {
    // Il materiale originale (spesso con texture 4K) non serve: la scultura è
    // un calco in argilla. Si libera subito per non tenere in VRAM decine di MB
    // di texture mentre si sfoglia il catalogo.
    const replaced = new Set<THREE.Material>();
    root.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of materials) replaced.add(material);
      object.material = this.material(model.kind);
      object.castShadow = true;
      object.receiveShadow = true;
    });
    for (const material of replaced) {
      for (const value of Object.values(material)) {
        if (value instanceof THREE.Texture) value.dispose();
      }
      material.dispose();
    }

    const box = new THREE.Box3().setFromObject(root);
    const size = box.getSize(new THREE.Vector3());
    const scale = model.fitHeight / Math.max(size.y, 1e-6);
    root.scale.setScalar(scale);
    root.updateMatrixWorld(true);

    box.setFromObject(root);
    const center = box.getCenter(new THREE.Vector3());
    const baseY = model.ground ? 0.075 : 1.0;
    root.position.set(-center.x, baseY - box.min.y, -center.z);
    root.updateMatrixWorld(true);

    box.setFromObject(root);
    const placedCenter = box.getCenter(new THREE.Vector3());
    const placedSize = box.getSize(new THREE.Vector3());
    const radius = Math.max(placedSize.length() / 2, 0.12);

    this.scene.add(root);
    this.model = root;

    const pedestalRadius = Math.max(0.34, Math.min(0.92, placedSize.x * 0.36, placedSize.z * 0.5 + 0.12));
    this.pedestal.scale.set(pedestalRadius, 1, pedestalRadius);

    if (!model.ground) {
      const rodHeight = Math.max(baseY - 0.055, 0.02);
      this.stand.visible = true;
      this.stand.scale.set(1, rodHeight, 1);
      this.stand.position.y = 0.055 + rodHeight / 2;
    } else {
      this.stand.visible = false;
    }

    const focusY = model.ground ? placedCenter.y : baseY + placedSize.y * 0.5;
    this.controls.target.set(0, focusY, 0);
    this.controls.minDistance = radius * 1.15;
    this.controls.maxDistance = radius * 7;
    this.controls.autoRotate = true;

    const distance = radius / Math.sin((this.camera.fov * Math.PI) / 360) * 1.18;
    const direction = new THREE.Vector3(0.52, 0.26, 0.81).normalize();
    this.camera.position.copy(direction.multiplyScalar(distance)).add(new THREE.Vector3(0, focusY, 0));
    this.camera.near = Math.max(0.01, radius / 60);
    this.camera.far = radius * 30 + 20;
    this.camera.updateProjectionMatrix();
    this.controls.update();
  }

  dispose(): void {
    cancelAnimationFrame(this.frame);
    this.observer.disconnect();
    this.clearModel();
    this.controls.dispose();
    this.renderer.dispose();
    for (const material of this.clay.values()) material.dispose();
  }
}

const staticHost = byId<HTMLDivElement>('static-host');
const assetList = byId<HTMLDivElement>('asset-list');
const assetMeta = byId<HTMLDivElement>('asset-meta');
const sculptStatus = byId<HTMLParagraphElement>('sculpt-status');

let stage: SculptureStage | null = null;
let manifest: CharacterManifest | null = null;
let selected: CharacterModel | null = null;

function setSculptStatus(message: string, error = false): void {
  sculptStatus.textContent = message;
  sculptStatus.classList.toggle('error', error);
}

function fileSize(bytes: number): string {
  if (!bytes) return 'dimensione sconosciuta';
  if (bytes > 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} kB`;
}

function showMeta(model: CharacterModel): void {
  assetMeta.replaceChildren();

  const title = document.createElement('b');
  title.textContent = model.title;
  assetMeta.append(title);

  const line = document.createElement('div');
  line.textContent = `${model.author} · ${model.license} · ${fileSize(model.bytes)}`;
  assetMeta.append(line);

  const scale = document.createElement('div');
  scale.textContent = `Scala di presentazione: ${formatNumber(model.fitHeight)} m di altezza.`;
  assetMeta.append(scale);

  const usage = document.createElement('div');
  usage.textContent = model.usage;
  assetMeta.append(usage);

  const link = document.createElement('a');
  link.href = model.source;
  link.target = '_blank';
  link.rel = 'noreferrer';
  link.textContent = 'Apri la fonte su Sketchfab';
  assetMeta.append(link);
}

function selectModel(model: CharacterModel): void {
  selected = model;
  for (const button of assetList.querySelectorAll<HTMLButtonElement>('.asset')) {
    button.classList.toggle('active', button.dataset.slug === model.slug);
  }
  showMeta(model);
  setSculptStatus(`Carico ${model.title}…`);
  setTabLoading('sculpt', `Carico ${model.title}…`);

  if (!stage) stage = new SculptureStage(staticHost);
  stage.load(
    model,
    (fraction) => {
      if (fraction === null) {
        setTabLoading('sculpt', `Apro ${model.title}…`);
      } else {
        const percent = Math.min(100, Math.round(fraction * 100));
        setTabLoading('sculpt', `Carico ${model.title}… ${percent}%`);
      }
    },
    () => {
      setTabLoading('sculpt', null);
      setSculptStatus(`${model.title} pronto. Trascina per ruotare, rotella per avvicinare.`);
    },
    (message) => {
      setTabLoading('sculpt', null);
      setSculptStatus(`Impossibile aprire ${model.file}: ${message}`, true);
    },
  );
}

async function initSculptures(): Promise<void> {
  if (manifest) return;
  setSculptStatus('Leggo il catalogo…');
  try {
    const response = await fetch(assetUrl('characters/manifest.json'));
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    manifest = (await response.json()) as CharacterManifest;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setSculptStatus(`Catalogo non disponibile: ${message}`, true);
    setTabLoading('sculpt', null);
    return;
  }

  let kind = '';
  for (const model of manifest.models) {
    if (!model.available) continue;
    const group = KIND_LABEL[model.kind] ?? 'Altri';
    if (group !== kind) {
      kind = group;
      const heading = document.createElement('div');
      heading.className = 'move-group';
      heading.textContent = group;
      assetList.append(heading);
    }
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'asset';
    button.dataset.slug = model.slug;
    const title = document.createElement('b');
    title.textContent = model.title;
    const meta = document.createElement('small');
    meta.textContent = `${model.author} · ${fileSize(model.bytes)}`;
    button.append(title, meta);
    button.addEventListener('click', () => selectModel(model));
    assetList.append(button);
  }

  const first = manifest.models.find((model) => model.available) ?? null;
  if (first) selectModel(first);
  else {
    setSculptStatus('Nessun GLB in public/characters/: esegui `node scripts/import-characters.mjs`.', true);
    setTabLoading('sculpt', null);
  }
}

// ------------------------------------------------------------------ schede

const tabMotion = byId<HTMLButtonElement>('tab-motion');
const tabSculpt = byId<HTMLButtonElement>('tab-sculpt');
const panelMotion = byId<HTMLDivElement>('panel-motion');
const panelSculpt = byId<HTMLDivElement>('panel-sculpt');
const stageTitle = byId<HTMLElement>('stage-title');
const stageLede = byId<HTMLElement>('stage-lede');
const credits = byId<HTMLDivElement>('credits');
const loading = byId<HTMLDivElement>('stage-loading');
const loadingText = byId<HTMLElement>('loading-text');

let loadingTimer: number | undefined;

function setLoading(text: string | null): void {
  if (loadingTimer !== undefined) {
    clearTimeout(loadingTimer);
    loadingTimer = undefined;
  }
  if (text === null) {
    loading.classList.add('done');
    loadingTimer = window.setTimeout(() => {
      loading.hidden = true;
    }, 240);
    return;
  }
  loading.hidden = false;
  loading.classList.remove('done');
  loadingText.textContent = text;
}

interface TabCopy {
  title: string;
  lede: string;
  credits: string;
}

const TAB_COPY: Record<'motion' | 'sculpt', TabCopy> = {
  motion: {
    title: 'Movimento umano',
    lede:
      'Otto movimenti scritti in Posecode e recitati da corpi con scheletro Mixamo: ' +
      'respiro, sguardo, saluto, passo, corsa e gesti quotidiani.',
    credits:
      'Corpi: Ready Player Me · Movimento: <a href="https://www.posecode.org/">Posecode</a> · ' +
      '<a href="ATTRIBUTION.md">Attribuzioni</a>',
  },
  sculpt: {
    title: 'Sculture',
    lede:
      'I modelli forniti dall\'utente, normalizzati e presentati come calchi in argilla: ' +
      'corpi, teste e capelli. Sono statici perché i file non hanno scheletro.',
    credits:
      'Modelli: Sketchfab, CC BY 4.0 · Autori e fonti nella scheda a destra · ' +
      '<a href="ATTRIBUTION.md">Attribuzioni</a>',
  },
};

function showTab(tab: TabName): void {
  const motion = tab === 'motion';
  activeTab = tab;
  tabMotion.setAttribute('aria-selected', String(motion));
  tabSculpt.setAttribute('aria-selected', String(!motion));
  panelMotion.hidden = !motion;
  panelSculpt.hidden = motion;
  animHost.hidden = !motion;
  staticHost.hidden = motion;
  const copy = TAB_COPY[tab];
  stageTitle.textContent = copy.title;
  stageLede.textContent = copy.lede;
  credits.innerHTML = copy.credits;

  if (motion) {
    if (lastPhase && (viewer?.playing ?? false)) phaseBadge.classList.add('visible');
  } else {
    phaseBadge.classList.remove('visible');
    if (!selected && tabLoading.sculpt === null) tabLoading.sculpt = 'Carico il catalogo…';
    void initSculptures();
  }
  setLoading(tabLoading[tab]);
}

function wireTabs(): void {
  tabMotion.addEventListener('click', () => showTab('motion'));
  tabSculpt.addEventListener('click', () => showTab('sculpt'));
}

// -------------------------------------------------------------------- avvio

buildMoveList();
wireMotionPanel();
wireTabs();

if (movements.length === 0) {
  setMotionStatus('Nessun movimento in src/posecode/movements/.', true);
  setTabLoading('motion', null);
} else {
  current = movements[0] ?? null;
  mountViewer();
  if (current) loadMovement(current);
}

window.addEventListener('beforeunload', () => {
  viewer?.dispose();
  stage?.dispose();
});

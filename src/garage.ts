/**
 * Garage delle auto personalizzate.
 *
 * I modelli si fanno in Smooth Voxels (<https://www.smoothdev.nl/smoothvoxels/>)
 * e si esportano in GLB. Qui si legge il file, si ricava una scheda tecnica
 * plausibile dagli ingombri e si salva tutto in IndexedDB: l'auto resta nel
 * browser anche dopo un ricaricamento, senza finire nel repository.
 *
 * Regole di modellazione (le stesse del city kit):
 * - 1 unità = 1 metro, ruote appoggiate a y = 0;
 * - muso verso +Z; il gioco ruota la carrozzeria di 180° perché guida a -Z;
 * - le ruote separate si chiamano `wheel-fl`, `wheel-fr`, `wheel-rl`, `wheel-rr`
 *   e hanno l'origine al centro del mozzo: così sterzano e girano davvero.
 *
 * I materiali dei GLB sono quelli dell'utente: non vengono toccati né tinteggiati.
 */

import * as THREE from 'three';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clamp } from './geo/geo';
import { PAINT_CHOICES, type VehicleSpec } from './sim/vehicle-catalog';

export const MAX_IMPORTED_CARS = 12;
const DB_NAME = 'molise-garage';
const DB_VERSION = 1;
const STORE = 'cars';

export interface GarageRecord {
  id: string;
  name: string;
  spec: VehicleSpec;
  /** GLB originale: si rilegge a ogni avvio, così il file resta la fonte */
  bytes: ArrayBuffer;
  created: number;
  /** true = il modello va girato di 180° (muso sbagliato nel GLB) */
  flip?: boolean;
}

export interface LoadedCar {
  record: GarageRecord;
  /** scena normalizzata: base a 0, centro su x/z, lunghezza = spec.length */
  scene: THREE.Object3D;
}

let loader: GLTFLoader | null = null;

function gltfLoader(): GLTFLoader {
  if (!loader) {
    const draco = new DRACOLoader().setDecoderPath(`${import.meta.env.BASE_URL}draco/`);
    loader = new GLTFLoader().setDRACOLoader(draco);
  }
  return loader;
}

/** Nome leggibile dal file: `my_car.glb` -> `my car`. */
export function carNameFromFile(fileName: string): string {
  const base = fileName
    .replace(/\.(glb|gltf)$/i, '')
    .replace(/[_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return (base || 'Auto importata').slice(0, 40);
}

function slugFor(name: string): string {
  const slug = name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 28);
  return slug || 'auto';
}

function uniqueId(name: string): string {
  return `custom-${slugFor(name)}-${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;
}

function hashText(text: string): number {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/**
 * Scheda tecnica per un GLB importato.
 *
 * Gli ingombri vengono dal bounding box del modello; se il file non è in metri
 * (voxel, centimetri, unità arbitrarie) si assume una lunghezza da berlina. Le
 * prestazioni sono un riferimento da segmento C: non c'è una scheda tecnica
 * vera dietro a un modello inventato, e il menu lo dice.
 */
export function specForImportedCar(name: string, size: THREE.Vector3, id = uniqueId(name)): VehicleSpec {
  const long = Math.max(size.x, size.z, 0.001);
  const widthRatio = Math.min(size.x, size.z, long) / long;
  const heightRatio = Math.max(size.y, 0.001) / long;

  // 2,8–6,2 m: il file è plausibilmente in metri. Fuori da lì si sceglie una
  // misura sensata invece di fidarsi di un numero che non significa nulla.
  const length = long >= 2.8 && long <= 6.2 ? clamp(long, 3.2, 5.2) : 4.2;
  const width = clamp(widthRatio * length, 1.45, 2.2);
  const height = clamp(heightRatio * length, 1.1, 2.1);
  const mass = Math.round(clamp(620 + length * width * height * 78, 820, 1900));
  const paint = PAINT_CHOICES[hashText(name) % PAINT_CHOICES.length].color;

  return {
    id,
    name,
    blurb: 'Carrozzeria importata da Smooth Voxels',
    style: 'hatch',
    roof: 'sloped',
    wheelLayout: 'four',
    length,
    width,
    height,
    wheelbase: length * 0.6,
    track: width * 0.82,
    wheelRadius: clamp(height * 0.18, 0.25, 0.4),
    paint,
    accent: 0x1b1d1f,
    engine: 'GLB personalizzato',
    displacementCc: 0,
    powerCv: 110,
    torqueNm: 180,
    rpmTorque: 4000,
    rpmPower: 6000,
    redlineRpm: 6500,
    idleRpm: 900,
    gears: 5,
    driven: 'fwd',
    mass,
    topSpeedKmh: 185,
    zeroTo100S: 10.2,
    reverseKmh: 30,
    grip: 0.9,
    rollResistance: 0.014,
    brakeDecel: 9.2,
    maxSteer: 0.55,
    offroadFactor: 0.63,
  };
}

/** Legge un GLB e restituisce scena e ingombri grezzi (unità del file). */
export async function parseCarBuffer(bytes: ArrayBuffer): Promise<{ scene: THREE.Object3D; size: THREE.Vector3 }> {
  const gltf = await gltfLoader().parseAsync(bytes, '');
  const scene = gltf.scene;
  scene.updateMatrixWorld(true);
  const size = new THREE.Box3().setFromObject(scene).getSize(new THREE.Vector3());
  return { scene, size };
}

/**
 * Porta il GLB in convenzione di gioco: asse lungo su Z, base a y = 0, centro
 * su x/z e lunghezza scalata su `targetLength`. La rotazione di 180° per il
 * muso a -Z la applica il veicolo, così la stessa scena resta riusabile.
 */
export function normalizeImportedCar(
  scene: THREE.Object3D,
  size: THREE.Vector3,
  targetLength: number,
  flip = false,
): THREE.Object3D {
  const oriented = new THREE.Group();
  oriented.name = 'imported-car-oriented';
  oriented.add(scene);
  // asse lungo su X: lo si porta su Z. Il verso del muso non è deducibile: la
  // convenzione resta "muso a +Z", quindi si assume che su X il muso sia a +X.
  if (size.x > size.z) scene.rotation.y -= Math.PI / 2;
  // "gira il muso": se il GLB è stato esportato al contrario, 180° e il
  // gioco lo guida dritto (salvato nella scheda, non nel file)
  if (flip) oriented.rotation.y += Math.PI;
  oriented.updateMatrixWorld(true);

  const box = new THREE.Box3().setFromObject(oriented);
  const length = Math.max(0.001, box.max.z - box.min.z);

  const normalized = new THREE.Group();
  normalized.name = 'imported-car';
  normalized.add(oriented);
  normalized.scale.setScalar(targetLength / length);
  normalized.updateMatrixWorld(true);

  const scaled = new THREE.Box3().setFromObject(normalized);
  const scaledCenter = scaled.getCenter(new THREE.Vector3());
  normalized.position.set(-scaledCenter.x, -scaled.min.y, -scaledCenter.z);
  return normalized;
}

/** File dell'utente -> record pronto per il salvataggio. */
export async function readCarFile(file: File, flip = false): Promise<LoadedCar> {
  const bytes = await file.arrayBuffer();
  const parsed = await parseCarBuffer(bytes);
  const spec = specForImportedCar(carNameFromFile(file.name), parsed.size);
  const scene = normalizeImportedCar(parsed.scene, parsed.size, spec.length, flip);
  return {
    record: { id: spec.id, name: spec.name, spec, bytes, created: Date.now(), flip: flip || undefined },
    scene,
  };
}

// ---------------------------------------------------------------------------
// persistenza (IndexedDB)
// ---------------------------------------------------------------------------

function openDatabase(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') {
      resolve(null);
      return;
    }
    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(DB_NAME, DB_VERSION);
    } catch {
      resolve(null);
      return;
    }
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
  });
}

export async function loadGarageRecords(): Promise<GarageRecord[]> {
  const db = await openDatabase();
  if (!db) return [];
  return new Promise((resolve) => {
    try {
      const request = db.transaction(STORE, 'readonly').objectStore(STORE).getAll();
      request.onsuccess = () => {
        const rows = (request.result ?? []) as GarageRecord[];
        resolve(rows.sort((a, b) => a.created - b.created));
      };
      request.onerror = () => resolve([]);
    } catch {
      resolve([]);
    } finally {
      db.close();
    }
  });
}

export async function saveGarageRecord(record: GarageRecord): Promise<boolean> {
  const db = await openDatabase();
  if (!db) return false;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(record);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
      tx.onabort = () => resolve(false);
    } catch {
      resolve(false);
    } finally {
      db.close();
    }
  });
}

export async function deleteGarageRecord(id: string): Promise<void> {
  const db = await openDatabase();
  if (!db) return;
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    } catch {
      resolve();
    } finally {
      db.close();
    }
  });
}

export async function clearGarageRecords(): Promise<void> {
  const db = await openDatabase();
  if (!db) return;
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    } catch {
      resolve();
    } finally {
      db.close();
    }
  });
}

/** Tutte le auto salvate, già parsate e normalizzate. */
export async function loadGarageCars(): Promise<LoadedCar[]> {
  const records = await loadGarageRecords();
  const cars: LoadedCar[] = [];
  for (const record of records.slice(0, MAX_IMPORTED_CARS)) {
    try {
      const parsed = await parseCarBuffer(record.bytes);
      cars.push({
        record,
        scene: normalizeImportedCar(parsed.scene, parsed.size, record.spec.length, record.flip === true),
      });
    } catch (error) {
      console.warn(`garage: ${record.name} non caricata`, error);
    }
  }
  return cars;
}

/** Singola auto dal browser (per ruotare il muso o cancellarla). */
export async function readGarageRecord(id: string): Promise<GarageRecord | null> {
  const records = await loadGarageRecords();
  return records.find((record) => record.id === id) ?? null;
}

/** Ricostruisce la scena normalizzata di un record già salvato. */
export async function buildGarageScene(record: GarageRecord): Promise<THREE.Object3D> {
  const parsed = await parseCarBuffer(record.bytes);
  return normalizeImportedCar(parsed.scene, parsed.size, record.spec.length, record.flip === true);
}

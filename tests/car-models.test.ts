import fs from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { describe, expect, it } from 'vitest';
import { CarLibrary } from '../src/world/car-library';

/**
 * Controllo delle auto di serie (`public/cars/`).
 *
 * I `.glb` non stanno nel repository (sono pesanti e la licenza è del
 * proprietario), quindi il test **si salta** quando la cartella è vuota e gira
 * sulla macchina che li ha. Fa passare ogni modello nella pipeline vera
 * (`CarLibrary`) e verifica le due cose che si rompevano più spesso:
 *
 * - l'auto esce **lunga sull'asse Z** (muso a +Z): uno `yaw` sbagliato nel
 *   manifest la faceva guidare «ruotata di 90 gradi»;
 * - le ruote riconosciute stanno **dentro la carrozzeria**: una separazione
 *   falsa creava perni al centro della macchina e le ruote giravano fuori.
 */
const CARS_DIR = path.join(process.cwd(), 'public', 'cars');
const manifestPath = path.join(CARS_DIR, 'manifest.json');
const assetsPresent = fs.existsSync(manifestPath) && fs.readdirSync(CARS_DIR).some((name) => name.endsWith('.glb'));

interface Manifest {
  cars: { slug: string; file: string; yaw?: number }[];
}

async function loadLibrary(): Promise<{ library: CarLibrary; manifest: Manifest }> {
  (globalThis as unknown as { self: unknown }).self = globalThis;
  (globalThis as unknown as { window: unknown }).window = globalThis;
  (globalThis as unknown as { document: unknown }).document = {
    createElement: () => ({ setAttribute: () => {}, getContext: () => null }),
  };
  (THREE.ImageLoader.prototype as unknown as { load: unknown }).load = function (
    _url: string,
    onLoad: (image: { width: number; height: number }) => void,
  ) {
    const dummy = { width: 1, height: 1 };
    if (onLoad) setTimeout(() => onLoad(dummy), 0);
    return dummy;
  };
  if (typeof (globalThis as { createImageBitmap?: unknown }).createImageBitmap === 'undefined') {
    (globalThis as unknown as { createImageBitmap: () => Promise<unknown> }).createImageBitmap = async () => ({
      width: 1,
      height: 1,
      close: () => {},
    });
  }

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as Manifest;
  globalThis.fetch = (async () => ({ ok: true, json: async () => manifest })) as unknown as typeof fetch;

  const library = new CarLibrary('cars/', 'draco/');
  // stesso caricatore della libreria (quindi con i plugin attivi): si sostituisce
  // solo la lettura da URL con i byte su disco
  const loader = (library as unknown as { loader: GLTFLoader }).loader;
  loader.loadAsync = async (url: string) => {
    const buffer = fs.readFileSync(path.join(CARS_DIR, url.replace(/^cars\//, '')));
    const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
    return await new Promise((resolve, reject) => loader.parse(arrayBuffer, '', resolve, reject));
  };
  await library.loadManifest();
  return { library, manifest };
}

describe.skipIf(!assetsPresent)('auto di serie', () => {
  it(
    'ogni modello guarda a +Z e tiene le ruote dentro la carrozzeria',
    async () => {
      const { library, manifest } = await loadLibrary();
      const failures: string[] = [];

      for (const car of manifest.cars) {
        const asset = await library.get(car.slug);
        if (!asset) {
          failures.push(`${car.slug}: non caricata`);
          continue;
        }
        const size = asset.size;
        // lunghezza sull'asse Z: con lo yaw giusto l'auto è più lunga che larga
        if (size.z <= size.x) {
          failures.push(`${car.slug}: ruotata (larghezza ${size.x.toFixed(2)} >= lunghezza ${size.z.toFixed(2)})`);
        }

        const hubs: { name: string; x: number; z: number; radius: number }[] = [];
        asset.template.traverse((object) => {
          if (!object.name.endsWith('-hub')) return;
          hubs.push({
            name: object.name,
            x: object.position.x,
            z: object.position.z,
            radius: Number(object.userData.wheelRadius ?? 0),
          });
        });
        for (const hub of hubs) {
          if (Math.abs(hub.x) > size.x * 0.55 || Math.abs(hub.z) > size.z * 0.5) {
            failures.push(`${car.slug}: ${hub.name} fuori dalla carrozzeria (x ${hub.x.toFixed(2)}, z ${hub.z.toFixed(2)})`);
          }
          if (!(hub.radius > 0)) failures.push(`${car.slug}: ${hub.name} raggio nullo`);
        }
      }

      expect(failures).toEqual([]);
    },
    900_000,
  );
});

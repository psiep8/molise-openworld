import * as THREE from 'three';
import type { Heightfield } from '../geo/elevation';
import { boundsOf, type Pt } from '../geo/geo';
import type { Building, BuildingIndex, RoadIndex } from '../geo/osm';
import { pbr } from '../gfx/textures';

export interface Church {
  group: THREE.Group;
  /** Impronta da registrare in `BuildingIndex`, così alberi e giocatore la evitano. */
  footprint: Building;
}

/** Misure in metri, ricavate da una chiesa di paese molisana. */
const NAVE_W = 10;
const NAVE_D = 16;
const WALL_H = 7.6;
const RIDGE = 2.6;
const TOWER_W = 4.6;
const TOWER_H = 17.5;
const BELL_H = 3.4;
const CAP_H = 3.0;

function scaleUv(geometry: THREE.BufferGeometry, su: number, sv: number): THREE.BufferGeometry {
  const uv = geometry.attributes.uv as THREE.BufferAttribute | undefined;
  if (uv) {
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv);
    uv.needsUpdate = true;
  }
  return geometry;
}

/** Scatola con le UV riscalate sulle misure vere (1 unità UV = 2 m, come le case). */
function box(w: number, h: number, d: number): THREE.BufferGeometry {
  return scaleUv(new THREE.BoxGeometry(w, h, d), Math.max(w, d) * 0.5, h * 0.5);
}

/** Ingombro della chiesa in pianta (mezzo lato), campanile e gradini compresi. */
const FOOT_HW = 7.4;
const FOOT_HD = 10.4;

/**
 * Controlla che tutto l'ingombro (non solo il centro) sia libero. Cinque punti
 * per lato bastano a non far entrare una casa dentro la navata.
 */
function isClear(
  x: number,
  z: number,
  yaw: number,
  roads: RoadIndex,
  buildings: BuildingIndex,
): boolean {
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);
  for (let ix = 0; ix < 5; ix++) {
    for (let iz = 0; iz < 5; iz++) {
      const lx = (ix / 4 - 0.5) * 2 * FOOT_HW;
      const lz = (iz / 4 - 0.5) * 2 * FOOT_HD;
      const wx = x + lx * cos + lz * sin;
      const wz = z - lx * sin + lz * cos;
      if (roads.isOnRoad(wx, wz, 1.6)) return false;
      if (buildings.resolveCircle(wx, wz, 1.6).hit) return false;
    }
  }
  return true;
}

/**
 * Cerca un posto libero attorno a un punto: anelli da 30 a 110 m, sedici angoli
 * per anello. Scarta le posizioni troppo vicine a strade e case, e i pendii.
 */
export function findChurchSpot(
  origin: Pt,
  roads: RoadIndex,
  buildings: BuildingIndex,
  heights: Heightfield,
): { x: number; z: number; yaw: number } | null {
  for (const radius of [34, 42, 52, 64, 78, 92, 108, 128, 150, 175, 205, 240]) {
    for (let i = 0; i < 32; i++) {
      const angle = (i / 32) * Math.PI * 2 + radius * 0.17;
      const x = origin.x + Math.cos(angle) * radius;
      const z = origin.z + Math.sin(angle) * radius;
      if (heights.slopeAt(x, z) > 14) continue;
      const yaw = Math.atan2(origin.x - x, origin.z - z);
      if (!isClear(x, z, yaw, roads, buildings)) continue;
      return { x, z, yaw };
    }
  }
  return null;
}

/**
 * Chiesa di paese con campanile: navata, tetto a due falde, facciata con
 * rosone e portale, cella campanaria, cuspide e croce.
 *
 * Un paese molisano senza campanile non è un paese: è una fila di case. La
 * chiesa si cerca da sola un posto libero attorno al centro abitato (mai sopra
 * una strada o un'altra casa), e la sua impronta entra in `BuildingIndex` prima
 * che si piantino alberi e cespugli.
 */
export function buildChurch(
  origin: Pt,
  heights: Heightfield,
  roads: RoadIndex,
  buildings: BuildingIndex,
  renderer: THREE.WebGLRenderer,
): Church | null {
  const spot = findChurchSpot(origin, roads, buildings, heights);
  if (!spot) return null;
  const { x, z, yaw } = spot;

  const group = new THREE.Group();
  group.name = 'church';

  // terreno: si appoggia alla quota più alta dell'impronta, con uno zoccolo che
  // scende sotto terra dal lato in discesa (niente chiesa sospesa sul pendio)
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);
  let top = -Infinity;
  for (const [lx, lz] of [
    [0, 0],
    [-9, -8],
    [9, -8],
    [-9, 8],
    [9, 8],
  ]) {
    const wx = x + lx * cos + lz * sin;
    const wz = z - lx * sin + lz * cos;
    top = Math.max(top, heights.heightAt(wx, wz));
  }
  const floor = top + 0.12;

  const wallSet = pbr(renderer, 'plaster', { repeat: 0.5 });
  const wallMat = new THREE.MeshStandardMaterial({
    ...wallSet,
    color: 0xe9e0cd,
    roughness: 0.94,
    metalness: 0,
    envMapIntensity: 0.3,
  });

  // tetto: tegole condivise con le case (UV in unità di 2,7 m come le falde OSM)
  const tiles = pbr(renderer, 'rooftiles', { repeat: 2, normal: true, rough: true });
  const roofMat = new THREE.MeshStandardMaterial({
    map: tiles.map ?? null,
    normalMap: tiles.normalMap ?? null,
    roughnessMap: tiles.roughnessMap ?? null,
    color: 0xb06a4a,
    roughness: 0.88,
    metalness: 0,
    envMapIntensity: 0.25,
  });
  const stoneMat = new THREE.MeshStandardMaterial({
    color: 0xd8d0bd,
    roughness: 0.9,
    metalness: 0,
    envMapIntensity: 0.3,
  });
  const darkMat = new THREE.MeshStandardMaterial({
    color: 0x2a231c,
    roughness: 0.8,
    metalness: 0.05,
  });
  const glassMat = new THREE.MeshStandardMaterial({
    color: 0x1d2a36,
    roughness: 0.22,
    metalness: 0.2,
    envMapIntensity: 0.9,
  });

  const add = (
    geometry: THREE.BufferGeometry,
    material: THREE.Material,
    px: number,
    py: number,
    pz: number,
    rx = 0,
    ry = 0,
    rz = 0,
  ): THREE.Mesh => {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(px, py, pz);
    mesh.rotation.set(rx, ry, rz);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    return mesh;
  };

  // zoccolo e navata
  add(box(NAVE_W + 0.9, 1.9, NAVE_D + 0.9), stoneMat, 0, -0.85, 0);
  add(box(NAVE_W, WALL_H, NAVE_D), wallMat, 0, WALL_H / 2, 0);

  // facciata (un filo più alta e sporgente) e timpano triangolare
  add(box(NAVE_W + 0.7, WALL_H + 0.7, 0.75), wallMat, 0, (WALL_H + 0.7) / 2, NAVE_D / 2 - 0.1);
  const pediment = new THREE.Shape();
  pediment.moveTo(-(NAVE_W + 0.35) / 2, 0);
  pediment.lineTo((NAVE_W + 0.35) / 2, 0);
  pediment.lineTo(0, RIDGE + 0.35);
  pediment.closePath();
  const pedimentGeo = new THREE.ExtrudeGeometry(pediment, { depth: 0.75, bevelEnabled: false });
  scaleUv(pedimentGeo, 0.5, 0.5);
  add(pedimentGeo, wallMat, 0, WALL_H + 0.7, NAVE_D / 2 - 0.47);

  // falde del tetto: due lastre inclinate che si incontrano sul colmo
  const slope = Math.atan2(RIDGE, NAVE_W / 2 + 0.4);
  const slopeLen = Math.hypot(NAVE_W / 2 + 0.9, RIDGE);
  const roofGeo = scaleUv(new THREE.BoxGeometry(slopeLen, 0.22, NAVE_D + 1.2), slopeLen / 2.7, (NAVE_D + 1.2) / 2.7);
  add(roofGeo, roofMat, (NAVE_W / 2 + 0.25) / 2, WALL_H + RIDGE / 2, 0, 0, 0, -slope);
  add(roofGeo.clone(), roofMat, -(NAVE_W / 2 + 0.25) / 2, WALL_H + RIDGE / 2, 0, 0, 0, slope);
  add(new THREE.BoxGeometry(0.55, 0.3, NAVE_D + 1.3), roofMat, 0, WALL_H + RIDGE + 0.03, 0, 0, 0, Math.PI / 4);

  // portale con cornice in pietra
  add(new THREE.BoxGeometry(2.0, 3.7, 0.24), darkMat, 0, 1.85, NAVE_D / 2 + 0.34);
  add(new THREE.BoxGeometry(0.24, 3.9, 0.34), stoneMat, -1.12, 1.95, NAVE_D / 2 + 0.33);
  add(new THREE.BoxGeometry(0.24, 3.9, 0.34), stoneMat, 1.12, 1.95, NAVE_D / 2 + 0.33);
  add(new THREE.BoxGeometry(2.5, 0.26, 0.34), stoneMat, 0, 3.92, NAVE_D / 2 + 0.33);

  // rosone: vetro scuro, ghiera di pietra, raggi in ferro
  const rose = new THREE.CylinderGeometry(0.92, 0.92, 0.16, 20);
  rose.rotateX(Math.PI / 2);
  add(rose, glassMat, 0, 6.1, NAVE_D / 2 + 0.42);
  add(new THREE.TorusGeometry(0.96, 0.1, 8, 24), stoneMat, 0, 6.1, NAVE_D / 2 + 0.44);
  for (let i = 0; i < 4; i++) {
    add(new THREE.BoxGeometry(1.7, 0.055, 0.06), darkMat, 0, 6.1, NAVE_D / 2 + 0.5, 0, 0, (i * Math.PI) / 4);
  }

  // finestre laterali con davanzale (quella sinistra più avanti è dentro il
  // campanile, quindi lì non si mette)
  for (const side of [-1, 1]) {
    for (const wz of [-5.4, -1.8, 1.8, 5.4]) {
      if (side === -1 && wz > 3) continue;
      add(new THREE.BoxGeometry(0.16, 2.1, 1.0), glassMat, side * (NAVE_W / 2 + 0.02), 4.5, wz);
      add(new THREE.BoxGeometry(0.4, 0.16, 1.35), stoneMat, side * (NAVE_W / 2 + 0.08), 3.38, wz);
    }
  }

  // gradini davanti
  add(box(12.4, 0.18, 0.6), stoneMat, 0, -0.02, NAVE_D / 2 + 1.0);
  add(box(13.4, 0.18, 0.6), stoneMat, 0, -0.2, NAVE_D / 2 + 1.6);

  // campanile addossato alla facciata, incastrato nel fianco sinistro della
  // navata: sporge solo di due metri e non allarga l'ingombro
  const tx = -(NAVE_W / 2 - 0.2);
  const tz = NAVE_D / 2 - TOWER_W / 2 + 0.45;
  add(box(TOWER_W + 0.7, 2.2, TOWER_W + 0.7), stoneMat, tx, -0.7, tz);
  add(box(TOWER_W, TOWER_H, TOWER_W), wallMat, tx, TOWER_H / 2, tz);
  // marcapiano e cella campanaria aperta sui quattro lati
  add(new THREE.BoxGeometry(TOWER_W + 0.5, 0.32, TOWER_W + 0.5), stoneMat, tx, TOWER_H + 0.1, tz);
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      add(
        new THREE.BoxGeometry(0.95, BELL_H, 0.95),
        wallMat,
        tx + sx * (TOWER_W / 2 - 0.475),
        TOWER_H + BELL_H / 2,
        tz + sz * (TOWER_W / 2 - 0.475),
      );
    }
  }
  // campana
  add(new THREE.CylinderGeometry(0.34, 0.52, 0.8, 12), darkMat, tx, TOWER_H + 1.3, tz);
  // solaio di copertura della cella e cuspide a piramide
  add(new THREE.BoxGeometry(TOWER_W + 0.7, 0.4, TOWER_W + 0.7), stoneMat, tx, TOWER_H + BELL_H + 0.2, tz);
  const cap = new THREE.ConeGeometry(TOWER_W * 0.78, CAP_H, 4);
  cap.rotateY(Math.PI / 4);
  add(cap, roofMat, tx, TOWER_H + BELL_H + 0.4 + CAP_H / 2, tz);
  // croce in ferro battuto
  add(new THREE.BoxGeometry(0.09, 1.25, 0.09), darkMat, tx, TOWER_H + BELL_H + 0.4 + CAP_H + 0.62, tz);
  add(new THREE.BoxGeometry(0.68, 0.09, 0.09), darkMat, tx, TOWER_H + BELL_H + 0.4 + CAP_H + 0.78, tz);
  // orologio sulla facciata del campanile
  const clock = new THREE.CylinderGeometry(0.55, 0.55, 0.12, 20);
  clock.rotateX(Math.PI / 2);
  add(clock, glassMat, tx, TOWER_H - 2.1, tz + TOWER_W / 2 + 0.03);
  add(new THREE.TorusGeometry(0.58, 0.07, 6, 20), stoneMat, tx, TOWER_H - 2.1, tz + TOWER_W / 2 + 0.05);

  group.position.set(x, floor, z);
  group.rotation.y = yaw;

  // impronta orientata: comprende navata, campanile e gradini
  const halfW = FOOT_HW;
  const halfD = FOOT_HD;
  const points: Pt[] = [
    [-halfW, -halfD],
    [halfW, -halfD],
    [halfW, halfD],
    [-halfW, halfD],
  ].map(([lx, lz]) => ({
    x: x + lx! * cos + lz! * sin,
    z: z - lx! * sin + lz! * cos,
  }));

  return {
    group,
    footprint: {
      height: TOWER_H + BELL_H + CAP_H,
      points,
      bounds: boundsOf(points),
      area: halfW * halfD * 4,
    },
  };
}

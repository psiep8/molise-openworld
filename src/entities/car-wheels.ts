import * as THREE from 'three';

/**
 * Ruote separate da un GLB.
 *
 * Le carrozzerie del kit (e molte auto importate da Smooth Voxels) escono
 * dall'editor come **un solo oggetto**: carrozzeria e ruote sono la stessa
 * mesh, quindi non si può far girare nulla. Qui le ruote vengono trovate per
 * analisi geometrica: si collegano i triangoli che condividono lo stesso
 * vertice, si raggruppano le componenti isolate che hanno forma di ruota (due
 * assi larghi e uno strettissimo, nella parte bassa del veicolo) e le quattro
 * più vicine agli angoli diventano quattro ruote con un perno al centro del
 * mozzo.
 *
 * Regole di conservazione:
 * - la geometria originale non viene toccata: i template del kit sono
 *   condivisi tra le auto parcheggiate e il veicolo. Si creano geometrie nuove
 *   con gli stessi vertici, normali e UV, quindi la texture resta allineata.
 * - se l'analisi non trova quattro ruote plausibili non si tocca niente e il
 *   modello resta com'era (comportamento precedente: carrozzeria unica).
 * - le ruote già separate (`wheel-fl`… con origine al mozzo) o già divise in
 *   un passaggio precedente vengono semplicemente rileggute.
 */

export interface SplitWheelsResult {
  /** quattro ruote rilevate o riutilizzate */
  wheels: number;
  /** raggio medio in metri: fa girare le ruote alla velocità del terreno */
  radius: number;
}

const HUB_PATTERN = /wheel[-_ ]?(fl|fr|rl|rr)-hub$/i;
const WHEEL_PATTERN = /(?:^|[-_ ])wheel[-_ ]?(fl|fr|rl|rr)$/i;
const CORNER_NAMES = ['wheel-fl', 'wheel-fr', 'wheel-rl', 'wheel-rr'] as const;
const MIN_TRIANGLES = 8;
/** distanza massima tra una ruota e l'angolo a cui viene assegnata */
const CORNER_TOLERANCE = 0.34;

const boxVertex = new THREE.Vector3();

/**
 * Bounding box **vera** di un oggetto, calcolata sui vertici trasformati.
 *
 * `THREE.Box3.setFromObject` trasforma gli 8 angoli del box locale: se una mesh
 * ha una rotazione non banale (o un nodo padre ruotato) il risultato è molto
 * più grande del modello. Succede con i GLB di auto, dove la scocca è ruotata
 * di 30–40° dentro il nodo: la larghezza dichiarata raddoppia e la
 * normalizzazione scala l'auto a metà. Qui si trasformano i vertici uno per
 * uno, con il supporto per le mesh skin-nate.
 */
export function preciseBox(object: THREE.Object3D): THREE.Box3 {
  const box = new THREE.Box3();
  object.updateWorldMatrix(true, true);
  object.traverse((child) => {
    const mesh = child as THREE.Mesh & {
      isMesh?: boolean;
      isSkinnedMesh?: boolean;
      isInstancedMesh?: boolean;
      applyBoneTransform?: (index: number, target: THREE.Vector3) => THREE.Vector3;
      skeleton?: THREE.Skeleton;
    };
    if (!mesh.isMesh || !mesh.visible || mesh.isInstancedMesh) return;
    const position = mesh.geometry?.getAttribute('position');
    if (!position) return;
    const skinned = mesh.isSkinnedMesh && mesh.applyBoneTransform ? mesh : null;
    if (skinned) mesh.skeleton?.update();
    for (let i = 0; i < position.count; i++) {
      boxVertex.fromBufferAttribute(position, i);
      if (skinned) skinned.applyBoneTransform!(i, boxVertex);
      boxVertex.applyMatrix4(mesh.matrixWorld);
      box.expandByPoint(boxVertex);
    }
  });
  return box;
}

/** Scala media di una matrice: serve a riportare il raggio della ruota nello spazio del modello. */
function scaleOf(matrix: THREE.Matrix4): number {
  const sx = new THREE.Vector3().setFromMatrixColumn(matrix, 0).length();
  const sy = new THREE.Vector3().setFromMatrixColumn(matrix, 1).length();
  const sz = new THREE.Vector3().setFromMatrixColumn(matrix, 2).length();
  return (sx + sy + sz) / 3;
}

/** Ruote già presenti nel modello (ricostruzione successiva o split già fatto). */
export function existingWheelHubs(source: THREE.Object3D): SplitWheelsResult | null {
  let wheels = 0;
  let radius = 0;
  let front = false;
  let rear = false;
  source.traverse((object) => {
    if (!HUB_PATTERN.test(object.name)) return;
    wheels++;
    radius += Number(object.userData.wheelRadius ?? 0);
    if (/f[lr]-hub$/i.test(object.name)) front = true;
    if (/r[lr]-hub$/i.test(object.name)) rear = true;
  });
  // Due ruote bastano per una moto, ma devono essere una davanti e una
  // dietro: così uno split rimasto a metà (solo l'avantreno) non viene
  // scambiato per un modello già pronto.
  if (wheels < 2 || !front || !rear) return null;
  return { wheels, radius: radius / wheels };
}

/**
 * I quattro perni sono disposti come le ruote di un veicolo?
 *
 * L'analisi geometrica può trovare «quattro cerchi» che non sono le ruote
 * (fari, specchietti, un dettaglio ripetuto): in quel caso creare i perni
 * peggiora il modello, perché finiscono al centro della macchina o tutti dallo
 * stesso lato e la carrozzeria ruota attorno al punto sbagliato (era il difetto
 * di Punto, Novulari, BMW anni '30, Abarth, Punto GT, Revuelto e Cyberster).
 * Prima di toccare la geometria si controlla che i perni stiano ai quattro
 * angoli, con raggi confrontabili e dentro gli ingombri.
 *
 * `hubs` e `box` devono essere nello stesso spazio.
 */
export function wheelHubsPlausible(
  hubs: readonly { x: number; z: number; radius: number }[],
  box: THREE.Box3,
): boolean {
  if (hubs.length !== 4 || box.isEmpty()) return false;
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  // il modello può essere lungo su X (prima dello yaw) o su Z (dopo): si
  // guarda quale delle due è l'asse lungo, non si assume Z
  const alongX = size.x >= size.z;
  const length = Math.max(alongX ? size.x : size.z, 0.01);
  const width = Math.max(alongX ? size.z : size.x, 0.01);
  const radii = hubs.map((hub) => hub.radius);
  const maxRadius = Math.max(...radii);
  const minRadius = Math.min(...radii);
  // pneumatici di misure molto diverse non sono le quattro ruote dello stesso
  // veicolo (l'Audi R8 2010 aveva l'anteriore al doppio del posteriore)
  if (!(minRadius > 0) || maxRadius / minRadius > 1.75) return false;
  // un «cerchio» grande quanto mezza carrozzeria è un passaruota, non una ruota
  if (maxRadius < length * 0.025 || maxRadius > width * 0.9) return false;
  const quadrants = new Set<string>();
  for (const hub of hubs) {
    const along = (alongX ? hub.x - center.x : hub.z - center.z);
    const across = (alongX ? hub.z - center.z : hub.x - center.x);
    // sull'asse longitudinale o laterale: non è una ruota
    if (Math.abs(across) < width * 0.15 || Math.abs(across) > width * 0.75) return false;
    // il perno deve stare dentro gli ingombri, davanti o dietro il centro
    if (Math.abs(along) < length * 0.16 || Math.abs(along) > length * 0.42) return false;
    quadrants.add(`${along > 0 ? 'f' : 'b'}${across > 0 ? 'r' : 'l'}`);
  }
  // una ruota per angolo: niente perni sovrapposti dallo stesso lato
  return quadrants.size === 4;
}

/**
 * Separa le ruote dalla carrozzeria, modificando il modello: i nuovi perni si
 * chiamano `wheel-fl-hub`… così `Vehicle` li raccoglie con la stessa logica
 * delle ruote dichiarate a mano nell'editor.
 *
 * `disposeOriginal` va a `true` solo quando la geometria analizzata è di
 * proprietà esclusiva del modello (un GLB appena importato): i template del kit
 * sono condivisi con le auto parcheggiate e non vanno toccati.
 *
 * Restituisce `null` se il modello non ha ruote separabili (e non modifica
 * niente in quel caso).
 */
export function splitCarWheels(source: THREE.Object3D, disposeOriginal = false): SplitWheelsResult | null {
  const existing = existingWheelHubs(source);
  if (existing) return existing;

  // ruote già separate dall'editor (nomi `wheel-fl`…): le gestisce Vehicle,
  // qui si evita di raddoppiarle. Anche una moto ha due ruote (una davanti e
  // una dietro) e non va spezzata di nuovo.
  let declared = 0;
  let declaredFront = false;
  let declaredRear = false;
  source.traverse((object) => {
    if (HUB_PATTERN.test(object.name)) return;
    if (!WHEEL_PATTERN.test(object.name)) return;
    declared++;
    if (/f[lr]$/i.test(object.name)) declaredFront = true;
    if (/r[lr]$/i.test(object.name)) declaredRear = true;
  });
  if (declared >= 4 || (declared >= 2 && declaredFront && declaredRear)) return null;

  source.updateMatrixWorld(true);
  const carBox = preciseBox(source);
  if (carBox.isEmpty()) return null;
  const carSize = carBox.getSize(new THREE.Vector3());

  const meshes: THREE.Mesh[] = [];
  const usage = new Map<THREE.BufferGeometry, number>();
  source.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!(mesh as unknown as { isMesh?: boolean }).isMesh) return;
    if (mesh === source || !mesh.parent) return;
    if (
      (mesh as unknown as { isSkinnedMesh?: boolean }).isSkinnedMesh ||
      (mesh as unknown as { isInstancedMesh?: boolean }).isInstancedMesh
    ) {
      return;
    }
    const geometry = mesh.geometry as THREE.BufferGeometry | undefined;
    if (!geometry || !geometry.getAttribute('position')) return;
    if (Object.keys(geometry.morphAttributes ?? {}).length > 0) return;
    if (geometry.groups.length > 1) return;
    if (Array.isArray(mesh.material)) return;
    meshes.push(mesh);
    usage.set(geometry, (usage.get(geometry) ?? 0) + 1);
  });
  if (meshes.length === 0) return null;

  const car = carBox.getCenter(new THREE.Vector3());
  const cornerSign: Array<[number, number]> = [
    [-1, 1],
    [1, 1],
    [-1, -1],
    [1, -1],
  ];
  const cornerTarget = cornerSign.map(
    ([x, z]) => new THREE.Vector3(car.x + x * carSize.x * 0.33, car.y, car.z + z * carSize.z * 0.34),
  );

  const sourceInverse = new THREE.Matrix4().copy(source.matrixWorld).invert();
  // scala del modello rispetto al veicolo: il raggio della ruota deve uscire in
  // metri di gioco, non nelle unità grezze del file
  const sourceScale = scaleOf(source.matrixWorld);

  // Analisi **prima** di toccare la geometria: se non si trovano abbastanza
  // ruote il modello resta esattamente com'era. Prima lo split veniva fatto e
  // solo alla fine si scopriva che mancavano due ruote, lasciando macchine a
  // metà (carrozzeria rifatta, ruote rimaste fuse o ferme).
  const plan: {
    mesh: THREE.Mesh;
    parent: THREE.Object3D;
    analysis: NonNullable<ReturnType<typeof analyseMesh>>;
  }[] = [];
  const cornersFound = new Set<number>();
  for (const mesh of meshes) {
    const analysis = analyseMesh(mesh, carBox, carSize, cornerTarget);
    if (!analysis || analysis.corners.length === 0) continue;
    for (const corner of analysis.corners) cornersFound.add(corner.index);
    plan.push({ mesh, parent: mesh.parent as THREE.Object3D, analysis });
  }
  // Servono le quattro ruote. Le moto e i tricicli che arrivano fin qui con le
  // ruote fuse restano interi (ruote ferme) invece di rischiare una carrozzeria
  // tagliata a metà: la separazione a due ruote resta possibile solo per i
  // modelli che le dichiarano per nome, e quelli escono prima da qui.
  // (Il vecchio criterio «carSize.x < 1,3 -> due ruote» scattava sempre: sul
  // template normalizzato la larghezza è 0,45 per costruzione, quindi ogni auto
  // passava di qui con la soglia delle due ruote.)
  if (cornersFound.size < 4) return null;

  // Controllo prima di modificare: quattro cerchi trovati al centro della
  // carrozzeria sono un falso positivo e vanno lasciati dov'erano.
  // I perni vivono nello spazio del modello, quindi il confronto si fa con la
  // stessa conversione usata per crearli.
  const localBox = new THREE.Box3();
  const reference = new THREE.Vector3();
  for (let i = 0; i < 8; i++) {
    reference
      .set(
        i & 1 ? carBox.max.x : carBox.min.x,
        i & 2 ? carBox.max.y : carBox.min.y,
        i & 4 ? carBox.max.z : carBox.min.z,
      )
      .applyMatrix4(sourceInverse);
    localBox.expandByPoint(reference);
  }
  const hubs = new Map<number, { x: number; z: number; radius: number }>();
  for (const { analysis } of plan) {
    for (const corner of analysis.corners) {
      const center = corner.center.clone().applyMatrix4(sourceInverse);
      const radius = corner.radius / Math.max(1e-6, sourceScale);
      const existing = hubs.get(corner.index);
      if (existing) existing.radius = Math.max(existing.radius, radius);
      else hubs.set(corner.index, { x: center.x, z: center.z, radius });
    }
  }
  if (!wheelHubsPlausible([...hubs.values()], localBox)) return null;

  let created = 0;
  let radiusSum = 0;

  for (const { mesh, parent, analysis } of plan) {
    const toSource = new THREE.Matrix4().multiplyMatrices(sourceInverse, mesh.matrixWorld);
    const normalMatrix = new THREE.Matrix3().getNormalMatrix(toSource);
    const material = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as THREE.Material;

    // corpo: la stessa mesh con una geometria nuova senza le ruote
    if (analysis.body.length > 0) {
      const rebuilt = new THREE.Mesh(
        extract(mesh.geometry as THREE.BufferGeometry, analysis.body, toSource, normalMatrix),
        material,
      );
      rebuilt.name = mesh.name || 'body';
      rebuilt.castShadow = mesh.castShadow;
      rebuilt.receiveShadow = mesh.receiveShadow;
      // `extract` ha già portato i vertici nello spazio del template: va
      // agganciato alla radice, non al vecchio padre (che applicherebbe di
      // nuovo scala e rotazione del GLB). Era il motivo per cui, dopo lo split,
      // la carrozzeria dell'Audi Novulari spariva o restava rimpicciolita.
      source.add(rebuilt);
    }

    for (const corner of analysis.corners) {
      const hubName = `${CORNER_NAMES[corner.index]}-hub`;
      const radius = corner.radius / Math.max(1e-6, sourceScale);
      let hub = (source.getObjectByName(hubName) as THREE.Group | undefined) ?? null;
      // `corner.center` è in coordinate mondo: per portarlo nello spazio del
      // modello serve `sourceInverse`. Prima si applicava `toSource`, che è la
      // trasformazione *della mesh*: il centro veniva moltiplicato per la scala
      // del GLB e i quattro perni finivano ammassati al centro della macchina
      // (era la causa delle «ruote che girano fuori dalla carrozzeria»).
      const center = corner.center.clone().applyMatrix4(sourceInverse);
      if (!hub) {
        hub = new THREE.Group();
        hub.name = hubName;
        hub.position.copy(center);
        hub.rotation.order = 'YXZ';
        hub.userData.wheelRadius = radius;
        source.add(hub);
        created++;
        radiusSum += radius;
      } else {
        // stesso angolo su un'altra mesh (pneumatico + cerchio): stesso perno
        hub.userData.wheelRadius = Math.max(Number(hub.userData.wheelRadius ?? 0), radius);
      }

      const local = new THREE.Matrix4().makeTranslation(-hub.position.x, -hub.position.y, -hub.position.z).multiply(toSource);
      const wheel = new THREE.Mesh(
        extract(mesh.geometry as THREE.BufferGeometry, corner.triangles, local, normalMatrix),
        material,
      );
      wheel.name = CORNER_NAMES[corner.index];
      wheel.castShadow = mesh.castShadow;
      wheel.receiveShadow = true;
      hub.add(wheel);
    }

    parent.remove(mesh);
    // l'originale è stato rimpiazzato da corpo + ruote: se era solo di questo
    // modello si libera la memoria video, altrimenti resta (kit condiviso)
    const geometry = mesh.geometry as THREE.BufferGeometry;
    if (disposeOriginal && (usage.get(geometry) ?? 0) <= 1) geometry.dispose();
  }

  if (created < 4) return { wheels: created, radius: created > 0 ? radiusSum / created : 0 };
  return { wheels: created, radius: radiusSum / created };
}

// ---------------------------------------------------------------------------
// analisi
// ---------------------------------------------------------------------------

interface Corner {
  index: number;
  center: THREE.Vector3;
  radius: number;
  triangles: number[];
}

/** Triangoli di un mesh, divisi tra corpo e quattro angoli. */
function analyseMesh(
  mesh: THREE.Mesh,
  carBox: THREE.Box3,
  carSize: THREE.Vector3,
  cornerTarget: THREE.Vector3[],
): { corners: Corner[]; body: number[] } | null {
  const geometry = mesh.geometry as THREE.BufferGeometry;
  const position = geometry.getAttribute('position');
  if (!position) return null;
  const index = geometry.index ? Array.from(geometry.index.array as ArrayLike<number>) : null;
  const triangles = index ? index.length / 3 : position.count / 3;
  if (triangles < MIN_TRIANGLES) return null;

  const at = (t: number, k: number): number => (index ? index[t * 3 + k] : t * 3 + k);

  // I vertici del GLB sono nello spazio locale della mesh, mentre `carBox` e
  // gli angoli di riferimento sono nello spazio del template (dopo yaw, scala
  // e centratura). Senza questa trasformazione un'auto esportata con l'asse
  // Z-up veniva analizzata coricata: le ruote finivano tutte oltre la metà
  // "altezza" e nessuna veniva riconosciuta. Era il motivo per cui Novulari,
  // Punto e altri modelli restavano con le ruote ferme.
  const world = new Float32Array(position.count * 3);
  const point = new THREE.Vector3();
  for (let i = 0; i < position.count; i++) {
    point.fromBufferAttribute(position, i).applyMatrix4(mesh.matrixWorld);
    world[i * 3] = point.x;
    world[i * 3 + 1] = point.y;
    world[i * 3 + 2] = point.z;
  }
  const wx = (i: number): number => world[i * 3];
  const wy = (i: number): number => world[i * 3 + 1];
  const wz = (i: number): number => world[i * 3 + 2];

  // weld: triangoli che condividono lo stesso vertice (entro 1 mm) sono
  // collegati, così le ruote isolate vengono fuori come componenti a parte
  const ids = new Int32Array(position.count);
  const weld = new Map<number, number>();
  for (let i = 0; i < position.count; i++) {
    const key =
      (Math.round(wx(i) * 1000) + 8192) * 67108864 +
      (Math.round(wy(i) * 1000) + 8192) * 8192 +
      (Math.round(wz(i) * 1000) + 8192);
    let id = weld.get(key);
    if (id === undefined) {
      id = weld.size;
      weld.set(key, id);
    }
    ids[i] = id;
  }

  const parent = new Int32Array(weld.size);
  for (let i = 0; i < parent.length; i++) parent[i] = i;
  const find = (x: number): number => {
    let root = x;
    while (parent[root] !== root) {
      parent[root] = parent[parent[root]];
      root = parent[root];
    }
    return root;
  };
  const union = (a: number, b: number): void => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[rb] = ra;
  };
  for (let t = 0; t < triangles; t++) {
    union(ids[at(t, 0)], ids[at(t, 1)]);
    union(ids[at(t, 0)], ids[at(t, 2)]);
  }

  const groups = new Map<number, number[]>();
  for (let t = 0; t < triangles; t++) {
    const root = find(ids[at(t, 0)]);
    const list = groups.get(root);
    if (list) list.push(t);
    else groups.set(root, [t]);
  }

  // una ruota può uscire dalla mesh come pneumatico + cerchio: componenti con
  // lo stesso centro vengono unite
  const clusters: { center: THREE.Vector3; radius: number; components: number[][] }[] = [];
  for (const components of groups.values()) {
    if (components.length < MIN_TRIANGLES) continue;
    const box = new THREE.Box3();
    for (const t of components) {
      for (let k = 0; k < 3; k++) {
        const i = at(t, k);
        box.expandByPoint(new THREE.Vector3(wx(i), wy(i), wz(i)));
      }
    }
    const size = box.getSize(new THREE.Vector3());
    const sorted = [size.x, size.y, size.z].sort((a, b) => a - b);
    if (sorted[1] < 1e-6) continue;
    // ruota: due assi larghi (diametro) e uno stretto (larghezza del pneumatico)
    if (sorted[0] / sorted[1] > 0.92) continue;
    if (sorted[2] / sorted[1] > 3.4) continue;
    const center = box.getCenter(new THREE.Vector3());
    if (center.y > carBox.min.y + carSize.y * 0.5) continue;
    if (sorted[2] > carSize.x * 0.6 || sorted[2] < carSize.y * 0.1) continue;
    const radius = (sorted[1] + sorted[2]) / 4;
    const merged = clusters.find((c) => c.center.distanceTo(center) < radius * 1.3);
    if (merged) {
      merged.radius = Math.max(merged.radius, radius);
      merged.components.push(components);
    } else {
      clusters.push({ center, radius, components: [components] });
    }
  }
  if (clusters.length < 4) return null;

  // le quattro ruote più vicine ai quattro angoli: le altre componenti che
  // assomigliano a una ruota (specchietti, paraurti) restano nel corpo
  const used = new Set<number>();
  const corners: Corner[] = [];
  for (let c = 0; c < cornerTarget.length; c++) {
    let best = -1;
    let bestDistance = Infinity;
    for (let i = 0; i < clusters.length; i++) {
      if (used.has(i)) continue;
      const distance = clusters[i].center.distanceTo(cornerTarget[c]);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = i;
      }
    }
    if (best < 0 || bestDistance > Math.max(carSize.x, carSize.z) * CORNER_TOLERANCE) break;
    used.add(best);
    const triangles: number[] = [];
    for (const component of clusters[best].components) triangles.push(...component);
    corners.push({ index: c, center: clusters[best].center, radius: clusters[best].radius, triangles });
  }
  if (corners.length < 4) return null;

  const assigned = new Set<number>();
  for (const corner of corners) for (const t of corner.triangles) assigned.add(t);
  const body: number[] = [];
  for (let t = 0; t < triangles; t++) if (!assigned.has(t)) body.push(t);

  return { corners, body };
}

/**
 * Geometria nuova con solo i triangoli scelti, portata nello spazio voluto.
 * Posizioni, normali e UV restano quelle originali: la texture continua a
 * cadere al posto giusto e la shading non cambia.
 */
function extract(
  geometry: THREE.BufferGeometry,
  triangles: number[],
  matrix: THREE.Matrix4,
  normalMatrix: THREE.Matrix3,
): THREE.BufferGeometry {
  const at = (t: number, k: number): number => (geometry.index ? geometry.index.getX(t * 3 + k) : t * 3 + k);

  const map = new Map<number, number>();
  for (const t of triangles) {
    for (let k = 0; k < 3; k++) if (!map.has(at(t, k))) map.set(at(t, k), map.size);
  }

  const out = new THREE.BufferGeometry();
  const count = map.size;
  const scratch = new THREE.Vector3();

  for (const name of Object.keys(geometry.attributes)) {
    const attribute = geometry.getAttribute(name) as THREE.BufferAttribute | THREE.InterleavedBufferAttribute;
    const itemSize = attribute.itemSize;
    const array = new Float32Array(count * itemSize);
    map.forEach((to, from) => {
      if (name === 'position') {
        scratch.set(attribute.getX(from), attribute.getY(from), attribute.getZ(from)).applyMatrix4(matrix);
        array[to * itemSize] = scratch.x;
        array[to * itemSize + 1] = scratch.y;
        array[to * itemSize + 2] = scratch.z;
      } else if (name === 'normal') {
        scratch.set(attribute.getX(from), attribute.getY(from), attribute.getZ(from)).applyMatrix3(normalMatrix).normalize();
        array[to * itemSize] = scratch.x;
        array[to * itemSize + 1] = scratch.y;
        array[to * itemSize + 2] = scratch.z;
      } else {
        for (let c = 0; c < itemSize; c++) {
          array[to * itemSize + c] =
            c === 0 ? attribute.getX(from) : c === 1 ? attribute.getY(from) : c === 2 ? attribute.getZ(from) : attribute.getW(from);
        }
      }
    });
    // i valori sono già normalizzati da getX/getY/…: l'attributo diventa float pieno
    out.setAttribute(name, new THREE.BufferAttribute(array, itemSize, false));
  }

  const index: number[] = [];
  for (const t of triangles) index.push(map.get(at(t, 0))!, map.get(at(t, 1))!, map.get(at(t, 2))!);
  out.setIndex(index);
  // senza normali copiate serve ricalcolarle; altrimenti si tiene la shading
  // originale (su mesh flat-shaded una media la rovinerebbe)
  if (!out.getAttribute('normal')) out.computeVertexNormals();
  out.computeBoundingBox();
  out.computeBoundingSphere();
  return out;
}

/** Quante ruote ha già il modello (per la diagnostica). */
export function countWheelHubs(source: THREE.Object3D): number {
  let count = 0;
  source.traverse((object) => {
    if (HUB_PATTERN.test(object.name) || WHEEL_PATTERN.test(object.name)) count++;
  });
  return count;
}

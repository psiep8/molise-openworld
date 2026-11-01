/**
 * Braccio a molla della telecamera.
 *
 * La terza persona non può stare a distanza fissa dal pivot: contro un muro
 * il braccio deve accorciarsi, altrimenti la camera entra nella casa e si
 * vedono gli interni. Il modo sbagliato è accorciare **dopo** aver interpolato
 * la posizione: si scopre il muro solo a fine frame e la camera salta al punto
 * libero, che è il "colpo" che si sente sbattendo contro una facciata.
 *
 * Qui il braccio è uno stato: ogni frame si misura lo spazio libero lungo la
 * direzione pivot → posizione ideale (`sweepArm`) e la lunghezza si muove con
 * due costanti di tempo diverse:
 *
 *  - **accorciamento veloce** (un muro addosso non perdona, e accorciare non
 *    mostra nulla di nuovo: il muro è davanti);
 *  - **allungamento lento** (uscendo dall'angolo la camera non deve "sparare"
 *    indietro, che era l'altro salto visibile).
 *
 * Le funzioni sono pure: si testano con una funzione `blocked` finta, senza
 * scena, senza renderer e senza three.
 */

export interface CameraPoint {
  x: number;
  y: number;
  z: number;
}

export interface SweepOptions {
  /** passo del campionamento, metri */
  step?: number;
  /** margine tenuto prima dell'ostacolo, metri */
  clearance?: number;
  /** lunghezza minima: la camera non entra mai nel pivot */
  min?: number;
}

export interface SpringOptions {
  /** velocità di accorciamento, 1/s */
  shorten?: number;
  /** velocità di allungamento, 1/s */
  lengthen?: number;
  /** lunghezza minima, metri */
  min?: number;
}

const DEFAULT_MIN = 0.55;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Lunghezza libera lungo il raggio, dall'origine verso `direction`.
 *
 * Campiona a passi regolari (default 40 cm) invece di fare un raycast contro
 * la scena: le case sono poligoni già indicizzati (`BuildingIndex`) e un test
 * punto-dentro-poligono costa meno di un intersect con tutte le mesh. Al primo
 * campione bloccato restituisce la distanza meno il margine, mai meno di
 * `min`: una camera che si incastra nel muro è peggio di una troppo vicina.
 */
export function sweepArm(
  origin: CameraPoint,
  direction: CameraPoint,
  ideal: number,
  blocked: (x: number, y: number, z: number) => boolean,
  options: SweepOptions = {},
): number {
  const distance = Number.isFinite(ideal) ? Math.max(0, ideal) : 0;
  if (distance <= 0) return 0;
  const length = Math.hypot(direction.x, direction.y, direction.z);
  if (!(length > 1e-6)) return distance;
  const step = Math.max(0.1, options.step ?? 0.4);
  const clearance = Math.max(0, options.clearance ?? 0.35);
  const min = Math.max(0, options.min ?? DEFAULT_MIN);
  const samples = Math.max(1, Math.ceil(distance / step));
  for (let i = 1; i <= samples; i++) {
    const d = (distance * i) / samples;
    const x = origin.x + (direction.x / length) * d;
    const y = origin.y + (direction.y / length) * d;
    const z = origin.z + (direction.z / length) * d;
    if (blocked(x, y, z)) return Math.max(min, d - clearance);
  }
  return distance;
}

/**
 * Come `sweepArm`, ma controlla anche due raggi inclinati di `spread` radianti.
 *
 * Serve in curva: girando attorno a un angolo il muro entra nella linea di
 * vista di lato, non al centro. Se si aspetta che sia esattamente sul raggio,
 * il braccio ha già perso il tempo utile e per qualche frame la camera è
 * dentro la facciata. Controllando anche ±spread il ritiro comincia prima che
 * il muro occluda davvero, quindi lo smorzamento resta morbido.
 */
export function sweepArmCone(
  origin: CameraPoint,
  direction: CameraPoint,
  ideal: number,
  blocked: (x: number, y: number, z: number) => boolean,
  spread = 0.1,
  options: SweepOptions = {},
): number {
  const center = sweepArm(origin, direction, ideal, blocked, options);
  if (!(spread > 0)) return center;
  const cos = Math.cos(spread);
  const sin = Math.sin(spread);
  const left = {
    x: direction.x * cos + direction.z * sin,
    y: direction.y,
    z: -direction.x * sin + direction.z * cos,
  };
  const right = {
    x: direction.x * cos - direction.z * sin,
    y: direction.y,
    z: direction.x * sin + direction.z * cos,
  };
  return Math.min(
    center,
    sweepArm(origin, left, ideal, blocked, options),
    sweepArm(origin, right, ideal, blocked, options),
  );
}

/**
 * Avanza la lunghezza del braccio verso lo spazio libero.

 * `allowed` è il massimo misurato dal `sweepArm` per questo frame, `ideal` la
 * distanza che la visuale vorrebbe. Il risultato non supera mai `allowed`
 * (niente pareti attraversate) e si muove in modo continuo: nessun frame
 * "teletrasporta" la camera, nemmeno quando il muro compare all'improvviso.
 */
export function springArmLength(
  current: number,
  allowed: number,
  ideal: number,
  dt: number,
  options: SpringOptions = {},
): number {
  const targetIdeal = Number.isFinite(ideal) ? Math.max(0, ideal) : 0;
  const min = Math.max(0, options.min ?? DEFAULT_MIN);
  const limit = Math.min(targetIdeal, Math.max(min, Number.isFinite(allowed) ? allowed : targetIdeal));
  const boom = clamp(Number.isFinite(current) ? current : targetIdeal, 0, targetIdeal);
  if (!(dt > 0) || !(targetIdeal > 0)) return boom;
  const shorten = Math.max(0.01, options.shorten ?? 10);
  const lengthen = Math.max(0.01, options.lengthen ?? 2.2);
  if (boom > limit) {
    const next = limit + (boom - limit) * Math.exp(-shorten * dt);
    return clamp(next, limit, targetIdeal);
  }
  const next = limit - (limit - boom) * Math.exp(-lengthen * dt);
  return clamp(next, 0, limit);
}

/**
 * Direzione normalizzata pivot → posizione ideale e lunghezza del braccio.
 * Se i due punti coincidono restituisce una direzione nulla e lunghezza 0:
 * chi chiama tiene la posizione precedente invece di produrre NaN.
 */
export function armAxis(
  target: CameraPoint,
  desired: CameraPoint,
): { direction: CameraPoint; length: number } {
  const dx = desired.x - target.x;
  const dy = desired.y - target.y;
  const dz = desired.z - target.z;
  const length = Math.hypot(dx, dy, dz);
  if (!(length > 1e-6)) return { direction: { x: 0, y: 0, z: 0 }, length: 0 };
  return { direction: { x: dx / length, y: dy / length, z: dz / length }, length };
}

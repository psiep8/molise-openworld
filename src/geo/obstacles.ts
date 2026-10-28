/**
 * Ostacoli cilindrici del mondo: pali della luce, cartelli, tronchi dei filari.
 *
 * Le case hanno già il loro indice (`BuildingIndex`, impronte poligonali), ma
 * un palo zincato da 10 cm non è un edificio: senza un indice a parte l'auto e
 * il giocatore lo attraversavano come se non esistesse. Qui basta un cerchio per
 * ostacolo, una griglia spaziale e una risoluzione che spinge fuori chi lo tocca.
 */

export interface Obstacle {
  x: number;
  z: number;
  /** raggio del fusto, in metri */
  radius: number;
  /** sorgente opzionale, per poter rimuovere un gruppo (es. guardrail) */
  tag?: string;
}

export class ObstacleIndex {
  private readonly cell = 24;
  private readonly grid = new Map<number, Obstacle[]>();
  readonly all: Obstacle[] = [];

  private key(cx: number, cz: number): number {
    return (cx + 4096) * 8192 + (cz + 4096);
  }

  add(x: number, z: number, radius: number, tag?: string): void {
    if (!Number.isFinite(x) || !Number.isFinite(z)) return;
    const obstacle: Obstacle = { x, z, radius: Math.max(0.02, radius), tag };
    this.all.push(obstacle);
    const key = this.key(Math.floor(x / this.cell), Math.floor(z / this.cell));
    const list = this.grid.get(key);
    if (list) list.push(obstacle);
    else this.grid.set(key, [obstacle]);
  }

  /** Rimuove tutti gli ostacoli di una sorgente (es. guardrail spento). */
  removeTag(tag: string): void {
    this.replaceTag(tag, []);
  }

  /** Sostituisce un insieme dinamico di ostacoli mantenendo gli altri intatti. */
  replaceTag(tag: string, replacements: readonly Omit<Obstacle, 'tag'>[]): void {
    const kept = this.all.filter((o) => o.tag !== tag);
    this.all.length = 0;
    this.grid.clear();
    for (const o of kept) this.add(o.x, o.z, o.radius, o.tag);
    for (const obstacle of replacements) this.add(obstacle.x, obstacle.z, obstacle.radius, tag);
  }

  get count(): number {
    return this.all.length;
  }

  /**
   * Ostacolo più vicino a un punto, entro `reach` metri dal suo bordo.
   *
   * Serve a capire **cosa** ha preso l'auto dopo una collisione: `resolveCircle`
   * spinge fuori ma non dice contro cosa, e senza saperlo un albero non può
   * scuotersi e un cartello non può oscillare.
   */
  nearest(x: number, z: number, reach: number): Obstacle | null {
    const cx = Math.floor(x / this.cell);
    const cz = Math.floor(z / this.cell);
    let best: Obstacle | null = null;
    let bestGap = reach;
    for (let ix = cx - 1; ix <= cx + 1; ix++) {
      for (let iz = cz - 1; iz <= cz + 1; iz++) {
        const list = this.grid.get(this.key(ix, iz));
        if (!list) continue;
        for (const o of list) {
          const gap = Math.hypot(x - o.x, z - o.z) - o.radius;
          if (gap < bestGap) {
            bestGap = gap;
            best = o;
          }
        }
      }
    }
    return best;
  }

  /** true se un cerchio di quel raggio tocca un ostacolo. */
  hitsCircle(x: number, z: number, radius: number): boolean {
    const cx = Math.floor(x / this.cell);
    const cz = Math.floor(z / this.cell);
    for (let ix = cx - 1; ix <= cx + 1; ix++) {
      for (let iz = cz - 1; iz <= cz + 1; iz++) {
        const list = this.grid.get(this.key(ix, iz));
        if (!list) continue;
        for (const o of list) {
          const reach = radius + o.radius;
          const dx = x - o.x;
          const dz = z - o.z;
          if (dx * dx + dz * dz < reach * reach) return true;
        }
      }
    }
    return false;
  }

  /**
   * Spinge un cerchio fuori dagli ostacoli che tocca.
   * Restituisce la posizione corretta e se c'è stato un urto: chi chiama decide
   * quanto perdere di velocità (l'auto si ferma in parte, il pedone no).
   */
  resolveCircle(x: number, z: number, radius: number): { x: number; z: number; hit: boolean } {
    let px = x;
    let pz = z;
    let hit = false;
    const cx = Math.floor(x / this.cell);
    const cz = Math.floor(z / this.cell);
    for (let ix = cx - 1; ix <= cx + 1; ix++) {
      for (let iz = cz - 1; iz <= cz + 1; iz++) {
        const list = this.grid.get(this.key(ix, iz));
        if (!list) continue;
        for (const o of list) {
          const minDist = radius + o.radius;
          let dx = px - o.x;
          let dz = pz - o.z;
          let d = Math.hypot(dx, dz);
          if (d >= minDist) continue;
          // centro esatto sull'ostacolo: si esce lungo una direzione stabile
          if (d < 1e-4) {
            dx = 1;
            dz = 0;
            d = 1;
            px += minDist;
          } else {
            const push = minDist - d;
            px += (dx / d) * push;
            pz += (dz / d) * push;
          }
          hit = true;
        }
      }
    }
    return { x: px, z: pz, hit };
  }
}

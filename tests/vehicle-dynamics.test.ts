import { describe, expect, it } from 'vitest';
import { blinkOn, bodyLean, createCarState, curbImpact, stepCar, type CarEnv, type CarInput, type CarState } from '../src/sim/car';
import { VEHICLES, tuningFor, vehicleLabel, type VehicleSpec } from '../src/sim/vehicle-catalog';

const road: CarEnv = { onRoad: true, groundHeight: () => 100 };
const grass: CarEnv = { onRoad: false, groundHeight: () => 100 };
const gas: CarInput = { throttle: 1, brake: 0, steer: 0, handbrake: false };
const coast: CarInput = { throttle: 0, brake: 0, steer: 0, handbrake: false };
const brake: CarInput = { throttle: 0, brake: 1, steer: 0, handbrake: false };

const dt = 1 / 60;

function drive(spec: VehicleSpec, input: CarInput, seconds: number, env = road, start?: CarState): CarState {
  const tuning = tuningFor(spec);
  let state = start ?? createCarState(0, 0, 0);
  for (let i = 0; i < Math.round(seconds / dt); i++) state = stepCar(state, input, env, dt, tuning);
  return state;
}

describe('scalino del cordolo', () => {
  it('salire sul marciapiede costa velocità e dà un colpo', () => {
    const impact = curbImpact(0, 0.18);
    expect(impact.speedFactor).toBeLessThan(1);
    expect(impact.bump).toBeGreaterThan(0.02);
  });

  it('scendere è più dolce del salire', () => {
    const up = curbImpact(0, 0.18);
    const down = curbImpact(0.18, 0);
    expect(down.bump).toBeLessThan(up.bump);
    expect(down.speedFactor).toBeGreaterThan(up.speedFactor);
  });

  it('l’asfalto non dà colpi, nemmeno sulle giunzioni', () => {
    expect(curbImpact(0.012, 0.02).bump).toBe(0);
    expect(curbImpact(0.02, 0.02)).toEqual({ speedFactor: 1, bump: 0 });
  });
});



describe('lampeggio delle frecce', () => {
  it('si accende e si spegne a 1,4 Hz', () => {
    // periodo ~0,714 s: acceso per il primo 55%, spento per il resto
    expect(blinkOn(0)).toBe(true);
    expect(blinkOn(0.3)).toBe(true);
    expect(blinkOn(0.6)).toBe(false);
    // 0,75 s = 1,05 periodi: di nuovo nella fase accesa
    expect(blinkOn(0.75)).toBe(true);
  });

  it('regge tempi negativi senza invertire il ritmo', () => {
    expect(blinkOn(-0.1)).toBe(false);
    expect(blinkOn(-0.6)).toBe(true);
  });
});

describe('inclinazione della carrozzeria', () => {
  it('si corica verso l’esterno in curva', () => {
    // curva a sinistra (imbardata positiva) a 14 m/s: il corpo va a destra
    const left = bodyLean(14, 0.25, 0);
    expect(left.roll).toBeLessThan(0);
    const right = bodyLean(14, -0.25, 0);
    expect(right.roll).toBeGreaterThan(0);
  });

  it('resta piatta da ferma e non supera i 6°', () => {
    expect(bodyLean(0, 1.2, 0).roll).toBeCloseTo(0, 9);
    expect(Math.abs(bodyLean(30, 1.2, 0).roll)).toBeLessThanOrEqual(0.1);
  });

  it('affonda il muso in frenata e lo alza in accelerazione', () => {
    expect(bodyLean(20, 0, -8).pitch).toBeLessThan(0);
    expect(bodyLean(10, 0, 3).pitch).toBeGreaterThan(0);
    expect(Math.abs(bodyLean(10, 0, 40).pitch)).toBeLessThanOrEqual(0.035);
  });
});

describe('prestazioni reali dei veicoli', () => {
  for (const spec of VEHICLES) {
    it(`${spec.name}: tocca la velocità massima dichiarata (${spec.topSpeedKmh} km/h) e non la supera`, () => {
      // 300 s: le auto lente e le elettriche con finale lungo raggiungono la
      // punta solo dopo una salita asintotica, non in 150 s.
      const kmh = drive(spec, gas, 300).speed * 3.6;
      expect(kmh).toBeLessThanOrEqual(spec.topSpeedKmh + 0.5);
      expect(kmh).toBeGreaterThan(spec.topSpeedKmh * 0.97);
    });

    it(`${spec.name}: lo 0-100 resta nella forchetta reale (${spec.zeroTo100S} s dichiarati)`, () => {
      // Fiat 500 del 1970 e Vespa dichiarano 95 km/h: non possono toccare i
      // 100. Si verifica che arrivino alla loro punta, non un traguardo
      // impossibile.
      if (spec.topSpeedKmh < 100) {
        expect(drive(spec, gas, 120).speed * 3.6).toBeGreaterThan(spec.topSpeedKmh * 0.9);
        return;
      }
      const tuning = tuningFor(spec);
      let state = createCarState(0, 0, 0);
      let t = 0;
      while (t < 90 && state.speed * 3.6 < 100) {
        state = stepCar(state, gas, road, dt, tuning);
        t += dt;
      }
      expect(state.speed * 3.6).toBeGreaterThanOrEqual(100);
      // il modello non riproduce ogni perdita reale (frizione, gestione motore,
      // asfalto): ±35% sul dato di fabbrica è il compromesso dichiarato.
      expect(t).toBeGreaterThan(spec.zeroTo100S * 0.65);
      expect(t).toBeLessThan(spec.zeroTo100S * 1.35);
    });
  }

  it('nessun veicolo va oltre i 360 km/h', () => {
    for (const spec of VEHICLES) {
      expect(drive(spec, gas, 300).speed * 3.6).toBeLessThanOrEqual(360);
    }
  });

  it('l’etichetta del menu riporta motore, potenza e velocità reale', () => {
    const punto = VEHICLES.find((v) => v.id === 'fiat-punto-2011');
    expect(punto).toBeDefined();
    const label = vehicleLabel(punto!);
    expect(label).toContain('1.2 8V');
    expect(label).toContain('65 CV');
    expect(label).toContain('155 km/h');
  });

  it('il catalogo di serie contiene solo modelli con un GLB', () => {
    for (const spec of VEHICLES) expect(spec.model).toBeTruthy();
  });
});

describe('cambio, partenza e frenata', () => {
  it('parte in prima e sale di marcia fino all’ultima', () => {
    const spec = VEHICLES.find((v) => v.id === 'ferrari-laferrari')!; // 7 marce
    const tuning = tuningFor(spec);
    let state = createCarState(0, 0, 0);
    const seen: number[] = [];
    for (let i = 0; i < 60 * 90; i++) {
      const gear = state.gear;
      state = stepCar(state, gas, road, dt, tuning);
      if (state.gear !== gear) seen.push(state.gear);
      expect(state.rpm).toBeLessThanOrEqual(spec.redlineRpm + 1);
      expect(state.rpm).toBeGreaterThanOrEqual(spec.idleRpm - 1);
    }
    expect(seen[0]).toBe(2);
    expect(seen).toEqual([2, 3, 4, 5, 6, 7]);
    expect(state.gear).toBe(spec.gears);
  });

  it('scala marcia quando si rallenta senza frenare', () => {
    const spec = VEHICLES.find((v) => v.id === 'fiat-punto-2011')!; // 5 marce
    const tuning = tuningFor(spec);
    let state = drive(spec, gas, 40);
    expect(state.gear).toBe(5);
    // a 100 km/h in quinta, lasciando il gas, il cambio deve scalare
    state = { ...state, speed: 100 / 3.6 };
    for (let i = 0; i < 60 * 20; i++) state = stepCar(state, coast, road, dt, tuning);
    expect(state.gear).toBeLessThan(5);
  });

  it('in prima una trazione posteriore potente pattina ma non si scompone', () => {
    const spec = VEHICLES.find((v) => v.id === 'ferrari-laferrari')!;
    const tuning = tuningFor(spec);
    let state = createCarState(0, 0, 0);
    let spun = false;
    for (let i = 0; i < 60 * 2; i++) {
      state = stepCar(state, gas, road, dt, tuning);
      spun ||= state.wheelspin;
      expect(state.speed).toBeLessThan(spec.topSpeedKmh / 3.6);
    }
    expect(spun).toBe(true);
  });

  it('frena da 100 km/h in una distanza da auto vera', () => {
    for (const spec of VEHICLES) {
      const tuning = tuningFor(spec);
      let state: CarState = { ...createCarState(0, 0, 0), speed: 100 / 3.6, gear: 5 };
      const z0 = state.z;
      let t = 0;
      while (t < 20 && state.speed > 0.01) {
        state = stepCar(state, brake, road, dt, tuning);
        t += dt;
      }
      const distance = Math.abs(state.z - z0);
      expect(state.speed).toBe(0);
      // 100 km/h → 0: fra 30 e 55 m su asfalto asciutto
      // le sportive stanno sotto i 30 m, le auto normali sui 40 m; una F1
      // scende sotto i 22 m, quindi il limite resta basso ma non nullo
      expect(distance).toBeGreaterThan(18);
      expect(distance).toBeLessThan(55);
    }
  });

  it('da fermo il freno inserisce la retromarcia e la limita', () => {
    for (const spec of VEHICLES) {
      const tuning = tuningFor(spec);
      let state = createCarState(0, 0, 0);
      for (let i = 0; i < 60 * 8; i++) state = stepCar(state, brake, road, dt, tuning);
      expect(state.gear).toBe(-1);
      expect(state.speed).toBeLessThan(0);
      expect(Math.abs(state.speed) * 3.6).toBeLessThanOrEqual(spec.reverseKmh + 0.2);
    }
  });

  it('dalla retromarcia si rimette la prima con il gas, senza fermarsi', () => {
    for (const spec of VEHICLES) {
      const tuning = tuningFor(spec);
      // si arriva in retromarcia lanciata...
      let state = createCarState(0, 0, 0);
      for (let i = 0; i < 60 * 5; i++) state = stepCar(state, brake, road, dt, tuning);
      expect(state.gear).toBe(-1);
      const reverseSpeed = Math.abs(state.speed);
      expect(reverseSpeed).toBeGreaterThan(0.5);
      // ...e si preme il gas: la prima entra subito, non a 0 km/h
      state = stepCar(state, gas, road, dt, tuning);
      expect(state.gear).toBe(1);
      for (let i = 0; i < 60 * 6; i++) state = stepCar(state, gas, road, dt, tuning);
      expect(state.speed).toBeGreaterThan(0);
    }
  });

  it('lo sterzo chiude le curve di un’auto vera, non di un tram', () => {
    const spec = VEHICLES.find((v) => v.id === 'fiat-punto-2011')!;
    const tuning = tuningFor(spec);
    // 30 km/h, volante a fondo corsa: raggio d'azione sotto i 12 m
    let state: CarState = { ...createCarState(0, 0, 0), speed: 30 / 3.6, gear: 2 };
    let travelled = 0;
    for (let i = 0; i < 60 * 3; i++) {
      state = stepCar(state, { throttle: 0.4, brake: 0, steer: 1, handbrake: false }, road, dt, tuning);
      // velocità tenuta a 30 km/h: si misura il raggio di sterzata, non
      // l'effetto dell'accelerazione sul raggio
      state = { ...state, speed: 30 / 3.6 };
      travelled += Math.abs(state.speed) * dt;
    }
    const turned = Math.abs(state.yaw);
    expect(turned).toBeGreaterThan(1.2);
    // raggio ≈ spazio percorso / angolo (in radianti)
    const radius = travelled / Math.max(0.001, turned);
    expect(radius).toBeLessThan(11.5);
    expect(radius).toBeGreaterThan(4);
  });

  it('fuori strada va più piano che sull’asfalto', () => {
    const spec = VEHICLES.find((v) => v.id === 'fiat-punto-2011')!;
    const tuning = tuningFor(spec);
    let onRoad = createCarState(0, 0, 0);
    let offRoad = createCarState(0, 0, 0);
    for (let i = 0; i < 60 * 90; i++) {
      onRoad = stepCar(onRoad, gas, road, dt, tuning);
      offRoad = stepCar(offRoad, gas, grass, dt, tuning);
    }
    expect(offRoad.speed).toBeLessThan(onRoad.speed * 0.9);
  });

  it('è deterministica a parità di input', () => {
    const spec = VEHICLES.find((v) => v.id === 'fiat-punto-2011')!;
    const a = drive(spec, gas, 40);
    const b = drive(spec, gas, 40);
    expect(a).toEqual(b);
  });
});

/**
 * Audio procedurale: niente file, solo WebAudio.
 * Vento, passo, motore e uccelli sono sintetizzati e seguono lo stato di gioco.
 * Il contesto audio parte solo dopo un gesto dell'utente (click su "Esplora").
 */

export interface AudioState {
  mode: 'walk' | 'drive';
  /** m/s, con segno */
  speed: number;
  moving: boolean;
  grounded: boolean;
  /** giri motore reali, per il suono del veicolo in uso */
  rpm?: number;
  /** 0..1: quanto è premuto l'acceleratore (carico reale del motore) */
  throttle?: number;
  /** marcia inserita: -1 retromarcia, 0 folle */
  gear?: number;
  /** secondi residui di cambio marcia */
  shiftTimer?: number;
  /** true se le ruote sono sull'asfalto (cambia il rumore di rotolamento) */
  onRoad?: boolean;
  /** 0..1: freno premuto */
  braking?: number;
}

/**
 * Carico del motore 0..1: non è il numero di giri, è quanto gas c'è.
 * Al minimo è 0, a tavoletta sale coi giri; in rilascio resta un filo di
 * "overrun" (il motore trascinato continua a pompare).
 */
export function engineLoad(
  throttle: number,
  rpm: number,
  idleRpm: number,
  redlineRpm: number,
): number {
  const t = Math.max(0, Math.min(1, throttle));
  const norm = Math.max(0, Math.min(1, (rpm - idleRpm) / Math.max(1, redlineRpm - idleRpm)));
  const pull = t * (0.38 + 0.62 * norm);
  const overrun = (1 - t) * norm * 0.16;
  return Math.max(0, Math.min(1, pull + overrun));
}

/** Frequenza di accensione (Hz): un V12 "batte" sei volte per giro. */
export function firingHz(rpm: number, cylinders: number): number {
  return Math.max(18, (rpm / 60) * (Math.max(1, cylinders) / 2));
}

/**
 * Carattere del motore ricavato dalla scheda tecnica. Il suono non usa file:
 * la frequenza di accensione è quella vera (giri/60 × cilindri/2), quindi un
 * V12 al minimo ronfa a ~85 Hz e un 1.2 a quattro cilindri a ~27 Hz.
 */
export interface EngineVoice {
  cylinders: number;
  idleRpm: number;
  redlineRpm: number;
  /** 0..1, motori grandi e pieni suonano più gravi e corposi */
  weight: number;
}

/** Ricava cilindri e carattere dal testo della scheda (V12, I6, V-twin, …). */
export function engineVoice(spec: {
  engine: string;
  idleRpm: number;
  redlineRpm: number;
  displacementCc: number;
}): EngineVoice {
  const text = spec.engine;
  const v = /(?:^|[\s(])V\s*-?\s*(\d+)/i.exec(text);
  const inline = /(?:^|[\s(])I\s*(\d+)/i.exec(text);
  const w = /(?:^|[\s(])W\s*(\d+)/i.exec(text);
  const twin = /twin/i.test(text);
  let cylinders = 4;
  if (v) cylinders = Number(v[1]);
  else if (w) cylinders = Number(w[1]);
  else if (inline) cylinders = Number(inline[1]);
  else if (twin) cylinders = 2;
  cylinders = Math.max(1, Math.min(16, cylinders));
  return {
    cylinders,
    idleRpm: Math.max(500, spec.idleRpm),
    redlineRpm: Math.max(spec.idleRpm + 500, spec.redlineRpm),
    weight: Math.max(0.2, Math.min(1, spec.displacementCc / 6500)),
  };
}

export class GameAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private engine:
    | {
        osc1: OscillatorNode;
        osc2: OscillatorNode;
        osc3: OscillatorNode;
        gain: GainNode;
        filter: BiquadFilterNode;
        resonance: BiquadFilterNode;
        resonance2: BiquadFilterNode;
        intakeFilter: BiquadFilterNode;
        intakeGain: GainNode;
        lope: OscillatorNode;
        lopeGain: GainNode;
      }
    | null = null;
  private roadGain: GainNode | null = null;
  private roadFilter: BiquadFilterNode | null = null;
  private roadLowGain: GainNode | null = null;
  private windGain: GainNode | null = null;
  private windFilter: BiquadFilterNode | null = null;
  private stepAccum = 0;
  private birdTimer = 9;
  private crackleTimer = 0;
  private lastGear = 0;
  private muted = false;
  private failed = false;
  private voice: EngineVoice = { cylinders: 4, idleRpm: 800, redlineRpm: 6000, weight: 0.3 };

  /** Cambia il carattere del motore quando si passa a un altro veicolo. */
  setVoice(voice: EngineVoice): void {
    this.voice = voice;
  }

  get isMuted(): boolean {
    return this.muted;
  }

  get available(): boolean {
    return this.ctx !== null && !this.failed;
  }

  /** Da chiamare su un gesto utente (click sul pulsante di avvio). */
  start(): void {
    if (this.failed) return;
    try {
      if (!this.ctx) this.build();
      void this.ctx?.resume();
    } catch {
      this.failed = true;
    }
  }

  toggleMute(): boolean {
    this.muted = !this.muted;
    if (this.ctx && this.master) {
      this.master.gain.setTargetAtTime(this.muted ? 0 : 0.55, this.ctx.currentTime, 0.06);
    }
    return this.muted;
  }

  private build(): void {
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) {
      this.failed = true;
      return;
    }
    const ctx = new Ctor();
    this.ctx = ctx;

    const master = ctx.createGain();
    master.gain.value = this.muted ? 0 : 0.55;
    // compressore di master: tiene insieme scoppi, vento e strada senza
    // clipping e dà quel "punch" che a orecchio distingue un motore registrato
    // da un ronzio di sintesi
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.knee.value = 18;
    comp.ratio.value = 3.5;
    comp.attack.value = 0.006;
    comp.release.value = 0.24;
    master.connect(comp).connect(ctx.destination);
    this.master = master;

    // rumore rosa-ish riusato da vento, strada e passi
    const seconds = 2;
    const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let last = 0;
    for (let i = 0; i < data.length; i++) {
      const white = Math.random() * 2 - 1;
      last = last * 0.92 + white * 0.08;
      data[i] = last * 3.2;
    }
    this.noise = buffer;

    // vento di fondo
    const wind = this.loopNoise();
    const windFilter = ctx.createBiquadFilter();
    windFilter.type = 'lowpass';
    windFilter.frequency.value = 520;
    windFilter.Q.value = 0.4;
    const windGain = ctx.createGain();
    windGain.gain.value = 0.035;
    wind.connect(windFilter).connect(windGain).connect(master);
    wind.start();
    this.windGain = windGain;
    this.windFilter = windFilter;

    // rotolamento / asfalto: banda alta per il "fruscio" delle gomme e coda
    // bassa per il rombo del corpo vettura
    const road = this.loopNoise();
    const roadFilter = ctx.createBiquadFilter();
    roadFilter.type = 'bandpass';
    roadFilter.frequency.value = 850;
    roadFilter.Q.value = 0.7;
    const roadGain = ctx.createGain();
    roadGain.gain.value = 0;
    const roadLow = ctx.createBiquadFilter();
    roadLow.type = 'lowpass';
    roadLow.frequency.value = 180;
    const roadLowGain = ctx.createGain();
    roadLowGain.gain.value = 0;
    road.connect(roadFilter).connect(roadGain).connect(master);
    road.connect(roadLow).connect(roadLowGain).connect(master);
    road.start();
    this.roadGain = roadGain;
    this.roadFilter = roadFilter;
    this.roadLowGain = roadLowGain;

    // ---- motore -------------------------------------------------------
    // Non due denti di sega scordati: uno scoppio è un impulso, quindi si
    // costruisce un'onda periodica con tutte le armoniche in fase (somma di
    // coseni 1/n^0,62) e la si fa suonare alla frequenza di accensione vera.
    // Il mezzo ordine sotto dà il borbottio dei V8, il quarto il corpo grave;
    // un waveshaper satura il segnale come il collettore di scarico, e un
    // rumore filtrato in banda aggiunge l'aspirazione che cresce col carico.
    const harmonics = 28;
    const real = new Float32Array(harmonics + 1);
    for (let n = 1; n <= harmonics; n++) {
      real[n] = Math.cos(n * 0.23) / Math.pow(n, 0.62);
    }
    const wave = ctx.createPeriodicWave(real, new Float32Array(harmonics + 1), {
      disableNormalization: false,
    });

    const osc1 = ctx.createOscillator();
    osc1.setPeriodicWave(wave);
    osc1.frequency.value = 30;
    const osc2 = ctx.createOscillator();
    osc2.setPeriodicWave(wave);
    osc2.frequency.value = 15;
    osc2.detune.value = 7;
    const osc3 = ctx.createOscillator();
    osc3.type = 'sine';
    osc3.frequency.value = 7.5;

    const preGain = ctx.createGain();
    preGain.gain.value = 0.55;
    const subGain = ctx.createGain();
    subGain.gain.value = 0.42;
    const sub2Gain = ctx.createGain();
    sub2Gain.gain.value = 0.22;

    // saturazione morbida: dà la ruvidità dello scarico, non un fuzz
    const shaper = ctx.createWaveShaper();
    const curve = new Float32Array(2048);
    for (let i = 0; i < curve.length; i++) {
      const x = (i / (curve.length - 1)) * 2 - 1;
      curve[i] = Math.tanh(x * 2.4) / Math.tanh(2.4);
    }
    shaper.curve = curve;
    shaper.oversample = '2x';

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 360;
    filter.Q.value = 0.9;
    // cassa di risonanza dello scarico: un picco basso che rende il motore
    // "corposo" invece che sottile
    const resonance = ctx.createBiquadFilter();
    resonance.type = 'peaking';
    resonance.frequency.value = 140;
    resonance.Q.value = 1.4;
    resonance.gain.value = 7;
    // seconda formante: il "naso" metallico dello scarico, quello che si sente
    // quando il motore sale di giri
    const resonance2 = ctx.createBiquadFilter();
    resonance2.type = 'peaking';
    resonance2.frequency.value = 520;
    resonance2.Q.value = 1.1;
    resonance2.gain.value = 3.2;

    const gain = ctx.createGain();
    gain.gain.value = 0;

    osc1.connect(preGain);
    osc2.connect(subGain).connect(preGain);
    osc3.connect(sub2Gain).connect(preGain);
    preGain.connect(shaper).connect(resonance).connect(resonance2).connect(filter).connect(gain).connect(master);

    // aspirazione / ventola: rumore in banda centrato sugli armonici alti
    const intake = this.loopNoise();
    const intakeFilter = ctx.createBiquadFilter();
    intakeFilter.type = 'bandpass';
    intakeFilter.frequency.value = 900;
    intakeFilter.Q.value = 0.8;
    const intakeGain = ctx.createGain();
    intakeGain.gain.value = 0;
    intake.connect(intakeFilter).connect(intakeGain).connect(gain);
    intake.start();

    // minimo irregolare: un'oscillazione lenta sul volume, è quello che
    // distingue un motore al minimo da un ronzio elettronico. L'ampiezza è
    // piccola: sul gain del motore un ±0,14 lo faceva "pompare" come un sub.
    const lope = ctx.createOscillator();
    lope.type = 'sine';
    lope.frequency.value = 0.55;
    const lopeGain = ctx.createGain();
    lopeGain.gain.value = 0.008;
    lope.connect(lopeGain).connect(gain.gain);
    lope.start();

    osc1.start();
    osc2.start();
    osc3.start();
    this.engine = { osc1, osc2, osc3, gain, filter, resonance, resonance2, intakeFilter, intakeGain, lope, lopeGain };
  }

  private loopNoise(): AudioBufferSourceNode {
    const ctx = this.ctx as AudioContext;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    return src;
  }

  private step(): void {
    const ctx = this.ctx;
    const master = this.master;
    if (!ctx || !master || !this.noise) return;
    const now = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = 0.75 + Math.random() * 0.4;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 700 + Math.random() * 500;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.08, now + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.13);
    src.connect(filter).connect(gain).connect(master);
    src.start(now);
    src.stop(now + 0.16);
  }

  /**
   * Urto contro un ostacolo: corpo sordo di massa più schegge di rumore.
   *
   * `strength` (0…1) arriva dalla velocità d'impatto; `metal` distingue il palo
   * zincato di un cartello dal tronco o dal muro di un casale.
   */
  impact(strength: number, metal = false): void {
    const ctx = this.ctx;
    const master = this.master;
    if (!ctx || !master) return;
    const amount = Math.max(0, Math.min(1, strength));
    if (amount <= 0.01) return;
    const now = ctx.currentTime;

    // corpo: una sinusoide che scende di tono, come la lamiera che assorbe
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(metal ? 190 : 96, now);
    osc.frequency.exponentialRampToValueAtTime(metal ? 88 : 44, now + 0.22);
    const body = ctx.createGain();
    body.gain.setValueAtTime(0.0001, now);
    body.gain.exponentialRampToValueAtTime(0.05 + amount * 0.14, now + 0.008);
    body.gain.exponentialRampToValueAtTime(0.0001, now + 0.28);
    osc.connect(body).connect(master);
    osc.start(now);
    osc.stop(now + 0.3);

    // schegge: rumore filtrato, brillante sul metallo, cupo su legno e pietra
    if (this.noise) {
      const src = ctx.createBufferSource();
      src.buffer = this.noise;
      src.playbackRate.value = metal ? 1.6 : 0.85;
      const filter = ctx.createBiquadFilter();
      filter.type = metal ? 'bandpass' : 'lowpass';
      filter.frequency.value = metal ? 2600 : 900;
      filter.Q.value = metal ? 1.6 : 0.7;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.04 + amount * 0.16, now + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.12 + amount * 0.16);
      src.connect(filter).connect(gain).connect(master);
      src.start(now);
      src.stop(now + 0.4);
    }
  }

  /** Scoppio di scarico: burst di rumore filtrato, breve e irregolare. */
  private crackle(intensity: number): void {
    const ctx = this.ctx;
    const master = this.master;
    if (!ctx || !master || !this.noise) return;
    const now = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = 1.5 + Math.random() * 1.4;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 1400 + Math.random() * 1900;
    filter.Q.value = 1.1;
    const gain = ctx.createGain();
    const peak = 0.01 + intensity * 0.022;
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(peak, now + 0.006);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.035 + Math.random() * 0.035);
    src.connect(filter).connect(gain).connect(master);
    src.start(now);
    src.stop(now + 0.09);
  }

  /** Colpo sordo del cambio: massa e trasmissione, non un effetto digitale. */
  private thump(amount: number): void {
    const ctx = this.ctx;
    const master = this.master;
    if (!ctx || !master) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(72, now);
    osc.frequency.exponentialRampToValueAtTime(38, now + 0.11);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.012 + amount * 0.02, now + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.14);
    osc.connect(gain).connect(master);
    osc.start(now);
    osc.stop(now + 0.16);
  }

  private chirp(): void {
    const ctx = this.ctx;
    const master = this.master;
    if (!ctx || !master) return;
    const now = ctx.currentTime;
    const notes = 2 + Math.floor(Math.random() * 2);
    for (let i = 0; i < notes; i++) {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      const start = now + i * 0.11;
      osc.frequency.setValueAtTime(2200 + Math.random() * 900, start);
      osc.frequency.exponentialRampToValueAtTime(1500 + Math.random() * 600, start + 0.07);
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.02, start + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.085);
      osc.connect(gain).connect(master);
      osc.start(start);
      osc.stop(start + 0.1);
    }
  }

  update(dt: number, state: AudioState): void {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;

    const t = ctx.currentTime;
    const speed = Math.abs(state.speed);
    const driving = state.mode === 'drive';
    const onRoad = state.onRoad ?? true;
    const brake = Math.max(0, Math.min(1, state.braking ?? 0));

    if (this.engine) {
      const {
        osc1,
        osc2,
        osc3,
        gain,
        filter,
        resonance,
        resonance2,
        intakeFilter,
        intakeGain,
        lope,
        lopeGain,
      } = this.engine;
      const voice = this.voice;
      const rpm = driving
        ? Math.max(voice.idleRpm, Math.min(voice.redlineRpm * 1.02, state.rpm ?? voice.idleRpm))
        : voice.idleRpm;
      const rpmNorm = Math.max(
        0,
        Math.min(1, (rpm - voice.idleRpm) / Math.max(1, voice.redlineRpm - voice.idleRpm)),
      );
      const throttle = Math.max(
        0,
        Math.min(1, state.throttle ?? (driving ? 0.15 + 0.85 * rpmNorm : 0)),
      );
      const load = driving ? engineLoad(throttle, rpm, voice.idleRpm, voice.redlineRpm) : 0;
      // frequenza di accensione reale: un V12 "batte" sei volte per giro
      const firing = firingHz(rpm, voice.cylinders);
      osc1.frequency.setTargetAtTime(firing, t, 0.055);
      osc2.frequency.setTargetAtTime(firing * 0.5, t, 0.075);
      osc3.frequency.setTargetAtTime(firing * 0.25, t, 0.09);
      // imperfezione ciclo-per-ciclo: al minimo il motore "trema", in pieno
      // carico la combustione è più regolare. Senza, il suono è un organo.
      osc2.detune.setTargetAtTime((Math.random() - 0.5) * 9 * (1 - load), t, 0.09);
      osc3.detune.setTargetAtTime((Math.random() - 0.5) * 5 * (1 - load), t, 0.12);
      // il filtro si apre col carico e con i giri: al minimo è cupo, in
      // accelerazione diventa tagliente
      filter.frequency.setTargetAtTime(
        250 + firing * 4.2 + voice.weight * 250 + load * 850 + throttle * 380,
        t,
        0.1,
      );
      resonance.frequency.setTargetAtTime(70 + firing * 1.6, t, 0.2);
      resonance.gain.setTargetAtTime(4.5 + load * 4.5, t, 0.2);
      resonance2.frequency.setTargetAtTime(300 + firing * 2.4, t, 0.2);
      resonance2.gain.setTargetAtTime(1.8 + load * 4, t, 0.2);
      intakeFilter.frequency.setTargetAtTime(420 + firing * 2.8 + throttle * 900, t, 0.12);
      intakeGain.gain.setTargetAtTime(driving ? 0.0015 + load * 0.018 + throttle * 0.004 : 0, t, 0.14);
      const engineGain = driving
        ? 0.014 +
          voice.weight * 0.021 +
          Math.min(0.012, speed * 0.0007) +
          load * 0.028 +
          throttle * 0.006
        : 0;
      gain.gain.setTargetAtTime(engineGain, t, 0.1);
      // il minimo borbotta: la periodicità irregolare dipende dal carico
      lope.frequency.setTargetAtTime(
        0.38 + (1 - load) * 0.9 + Math.random() * 0.18,
        t,
        1.4,
      );
      lopeGain.gain.setTargetAtTime(0.004 + (1 - load) * 0.007, t, 0.4);
    }

    if (this.roadGain && this.roadFilter) {
      const rolling = driving ? Math.min(1, speed / 42) : 0;
      // asfalto: fruscio alto e regolare. Sterrato/erba: banda più bassa,
      // più larga e più forte, con il "graniglia" che si sente sotto.
      this.roadFilter.frequency.setTargetAtTime(
        onRoad ? 780 + speed * 7 : 320 + speed * 2.4,
        t,
        0.2,
      );
      this.roadFilter.Q.setTargetAtTime(onRoad ? 0.85 : 0.5, t, 0.2);
      this.roadGain.gain.setTargetAtTime(
        driving
          ? onRoad
            ? Math.min(0.06, rolling * 0.065)
            : Math.min(0.1, 0.012 + rolling * 0.1)
          : 0,
        t,
        0.2,
      );
      this.roadLowGain?.gain.setTargetAtTime(
        driving ? Math.min(0.07, rolling * (onRoad ? 0.04 : 0.075)) : 0,
        t,
        0.25,
      );
    }
    this.windGain?.gain.setTargetAtTime(0.022 + Math.min(0.08, speed * 0.0024), t, 0.3);
    this.windFilter?.frequency.setTargetAtTime(380 + Math.min(1500, speed * 30), t, 0.35);

    // scarico in rilascio: scoppiettio irregolare quando si toglie il gas a
    // giri alti (è il rumore che rende "vera" un'auto sportiva)
    if (driving && (state.throttle ?? 0) < 0.08 && speed > 3) {
      const rpmNorm = Math.max(
        0,
        Math.min(1, ((state.rpm ?? this.voice.idleRpm) - this.voice.idleRpm) /
          Math.max(1, this.voice.redlineRpm - this.voice.idleRpm)),
      );
      if (rpmNorm > 0.28) {
        this.crackleTimer -= dt;
        if (this.crackleTimer <= 0) {
          this.crackleTimer = 0.07 + Math.random() * 0.22;
          this.crackle(rpmNorm);
        }
      }
    } else {
      this.crackleTimer = 0.3 + Math.random() * 0.4;
    }

    // cambio marcia: un "clunk" sordo, non un bip
    const gear = state.gear ?? 0;
    if (driving && this.lastGear !== 0 && gear !== this.lastGear && (state.shiftTimer ?? 0) > 0) {
      this.thump(Math.min(1, speed / 18));
    }
    this.lastGear = driving ? gear : 0;

    // frenata: le gomme "cantano" appena, senza diventare un fischio da film
    if (this.roadGain && driving && brake > 0.5 && speed > 6 && onRoad) {
      this.roadGain.gain.setTargetAtTime(
        Math.min(0.075, 0.03 + brake * 0.03 + speed * 0.0005),
        t,
        0.15,
      );
    }

    if (!driving && state.moving && state.grounded) {
      this.stepAccum += speed * dt;
      if (this.stepAccum > 2.05) {
        this.stepAccum = 0;
        this.step();
      }
    } else {
      this.stepAccum = 0;
    }

    this.birdTimer -= dt;
    if (this.birdTimer <= 0) {
      this.birdTimer = 9 + Math.random() * 16;
      if (!this.muted) this.chirp();
    }
  }

  dispose(): void {
    try {
      void this.ctx?.close();
    } catch {
      // già chiuso
    }
    this.ctx = null;
  }
}

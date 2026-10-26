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
        intakeFilter: BiquadFilterNode;
        intakeGain: GainNode;
      }
    | null = null;
  private roadGain: GainNode | null = null;
  private windGain: GainNode | null = null;
  private stepAccum = 0;
  private birdTimer = 9;
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
    master.connect(ctx.destination);
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
    windFilter.frequency.value = 480;
    const windGain = ctx.createGain();
    windGain.gain.value = 0.035;
    wind.connect(windFilter).connect(windGain).connect(master);
    wind.start();
    this.windGain = windGain;

    // rotolamento / asfalto
    const road = this.loopNoise();
    const roadFilter = ctx.createBiquadFilter();
    roadFilter.type = 'bandpass';
    roadFilter.frequency.value = 850;
    roadFilter.Q.value = 0.7;
    const roadGain = ctx.createGain();
    roadGain.gain.value = 0;
    road.connect(roadFilter).connect(roadGain).connect(master);
    road.start();
    this.roadGain = roadGain;

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

    const gain = ctx.createGain();
    gain.gain.value = 0;

    osc1.connect(preGain);
    osc2.connect(subGain).connect(preGain);
    osc3.connect(sub2Gain).connect(preGain);
    preGain.connect(shaper).connect(resonance).connect(filter).connect(gain).connect(master);

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
    // distingue un motore al minimo da un ronzio elettronico
    const lope = ctx.createOscillator();
    lope.type = 'sine';
    lope.frequency.value = 0.55;
    const lopeGain = ctx.createGain();
    lopeGain.gain.value = 0.14;
    lope.connect(lopeGain).connect(gain.gain);
    lope.start();

    osc1.start();
    osc2.start();
    osc3.start();
    this.engine = { osc1, osc2, osc3, gain, filter, intakeFilter, intakeGain };
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

    if (this.engine) {
      const { osc1, osc2, osc3, gain, filter, intakeFilter, intakeGain } = this.engine;
      const voice = this.voice;
      const rpm = driving
        ? Math.max(voice.idleRpm, Math.min(voice.redlineRpm * 1.02, state.rpm ?? voice.idleRpm))
        : voice.idleRpm;
      // frequenza di accensione reale: un V12 "batte" sei volte per giro
      const firing = Math.max(20, (rpm / 60) * (voice.cylinders / 2));
      const load = driving ? Math.min(1, (rpm - voice.idleRpm) / Math.max(1, voice.redlineRpm - voice.idleRpm)) : 0;
      // gli scoppi sono alla frequenza di accensione, il mezzo ordine sotto
      // dà la periodicità del ciclo a quattro tempi
      osc1.frequency.setTargetAtTime(firing, t, 0.06);
      osc2.frequency.setTargetAtTime(firing * 0.5, t, 0.08);
      osc3.frequency.setTargetAtTime(firing * 0.25, t, 0.1);
      // il filtro si apre col carico e con i giri: al minimo è cupo, in
      // accelerazione diventa tagliente
      filter.frequency.setTargetAtTime(
        240 + firing * 3.6 + voice.weight * 210 + load * 420 + speed * 1.6,
        t,
        0.1,
      );
      intakeFilter.frequency.setTargetAtTime(420 + firing * 2.4, t, 0.12);
      intakeGain.gain.setTargetAtTime(driving ? 0.004 + load * 0.016 : 0, t, 0.15);
      const engineGain = driving
        ? 0.024 + voice.weight * 0.026 + Math.min(0.016, speed * 0.0009) + load * 0.02
        : 0;
      gain.gain.setTargetAtTime(engineGain, t, 0.12);
    }

    this.roadGain?.gain.setTargetAtTime(driving ? Math.min(0.07, speed * 0.006) : 0, t, 0.2);
    this.windGain?.gain.setTargetAtTime(0.028 + Math.min(0.05, speed * 0.0018), t, 0.3);

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

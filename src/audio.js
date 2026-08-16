// audio.js — procedural synth engine. No samples, no files: every sound in the
// game is generated from oscillators and noise at runtime.
//
// Architecture: a lookahead scheduler (setInterval polls, schedules notes ~120ms
// ahead on the WebAudio clock) drives a 16th-note step sequencer at 126 BPM.
// What actually plays depends on `level` (0-3, raised by tuning resonators) and
// `state` ('explore' → 'breakdown' → 'drop').

const BPM = 126;
const SIXTEENTH = 60 / BPM / 4;
const BAR = SIXTEENTH * 16;

// A-minor progression: Am — F — C/G — G. One chord per bar.
const CHORDS = [
  [220.0, 261.63, 329.63], // Am
  [174.61, 220.0, 261.63], // F
  [196.0, 261.63, 329.63], // C/G
  [196.0, 246.94, 293.66], // G
];
const BASS_ROOTS = [55.0, 43.65, 65.41, 49.0]; // A1 F1 C2 G1

// The three resonators are tuned to the notes of the home chord.
export const RESONATOR_FREQS = [220.0, 261.63, 329.63];

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.level = 0;
    this.state = 'explore'; // explore | breakdown | drop
    this.breakdownTime = null;
    this.dropTime = null;
    this._pendingBreakdown = false;
    this._dropStep = -1;
    this._tuners = [null, null, null];
    this._bands = { bass: 0, mid: 0, high: 0 };
  }

  get started() { return this.ctx !== null; }
  now() { return this.ctx ? this.ctx.currentTime : 0; }

  start() {
    if (this.ctx) return;
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.ctx = ctx;
    ctx.resume();

    // master -> compressor -> analyser -> speakers
    this.master = ctx.createGain();
    this.master.gain.value = 0.85;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -12;
    comp.knee.value = 18;
    comp.ratio.value = 6;
    comp.attack.value = 0.003;
    comp.release.value = 0.16;
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 1024;
    this.analyser.smoothingTimeConstant = 0.78;
    this._fft = new Uint8Array(this.analyser.frequencyBinCount);
    this.master.connect(comp);
    comp.connect(this.analyser);
    this.analyser.connect(ctx.destination);

    // buses
    this.drumBus = ctx.createGain();
    this.drumBus.connect(this.master);
    this.duck = ctx.createGain(); // sidechain pump for everything melodic
    this.duck.connect(this.master);
    this.musicBus = ctx.createGain();
    this.musicBus.connect(this.duck);
    this.ambBus = ctx.createGain();
    this.ambBus.connect(this.master);

    // cheap synthetic reverb: convolver fed a generated decaying-noise impulse
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this._makeImpulse(2.4, 2.2);
    const wet = ctx.createGain();
    wet.gain.value = 0.5;
    this.reverb.connect(wet);
    wet.connect(this.master);

    this._noise = this._makeNoise(2);
    this._startHum();
    this._startScheduler();
  }

  // ---------- utility buffers ----------

  _makeNoise(seconds) {
    const len = Math.floor(this.ctx.sampleRate * seconds);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  _makeImpulse(seconds, decay) {
    const len = Math.floor(this.ctx.sampleRate * seconds);
    const buf = this.ctx.createBuffer(2, len, this.ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) {
        d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
      }
    }
    return buf;
  }

  _noiseSource() {
    const src = this.ctx.createBufferSource();
    src.buffer = this._noise;
    src.loop = true;
    return src;
  }

  // ---------- ambience ----------

  _startHum() {
    const ctx = this.ctx;
    // fluorescent ballast: 100Hz + 120Hz sines plus dark filtered noise
    this.humGain = ctx.createGain();
    this.humGain.gain.value = 1.0;
    this.humGain.connect(this.ambBus);
    for (const [freq, g] of [[100, 0.016], [120, 0.011], [60, 0.008]]) {
      const o = ctx.createOscillator();
      o.frequency.value = freq;
      const og = ctx.createGain();
      og.gain.value = g;
      o.connect(og);
      og.connect(this.humGain);
      o.start();
    }
    const n = this._noiseSource();
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 320;
    const ng = ctx.createGain();
    ng.gain.value = 0.03;
    n.connect(lp); lp.connect(ng); ng.connect(this.humGain);
    n.start();

    // sub drone, faded in once the first resonator locks
    this.droneGain = ctx.createGain();
    this.droneGain.gain.value = 0;
    const drone = ctx.createOscillator();
    drone.frequency.value = 55; // A1
    drone.connect(this.droneGain);
    this.droneGain.connect(this.ambBus);
    drone.start();
  }

  // short electrical crackle, used when a light fixture flickers nearby
  crackle(volume = 0.05) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const src = this._noiseSource();
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 2600 + Math.random() * 2000;
    bp.Q.value = 1.2;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(volume, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.08 + Math.random() * 0.1);
    src.connect(bp); bp.connect(g); g.connect(this.ambBus);
    src.start(t);
    src.stop(t + 0.25);
  }

  // ---------- tuning puzzle ----------
  // Two sine waves per resonator: the target tone and the player's detuned
  // tone. Mixing them produces real acoustic beating — the "wobble" the player
  // eliminates by tuning. No fakery.

  engageTuner(i, targetFreq, playerFreq) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    if (!this._tuners[i]) {
      const mk = (freq) => {
        const o = this.ctx.createOscillator();
        o.frequency.value = freq;
        const g = this.ctx.createGain();
        g.gain.value = 0;
        o.connect(g);
        g.connect(this.musicBus);
        g.connect(this.reverb);
        o.start();
        return { o, g };
      };
      this._tuners[i] = { target: mk(targetFreq), player: mk(playerFreq) };
    }
    const tu = this._tuners[i];
    tu.target.g.gain.setTargetAtTime(0.075, t, 0.15);
    tu.player.g.gain.setTargetAtTime(0.075, t, 0.15);
  }

  setTunerFreq(i, freq) {
    const tu = this._tuners[i];
    if (!tu) return;
    tu.player.o.frequency.setTargetAtTime(freq, this.ctx.currentTime, 0.02);
  }

  disengageTuner(i) {
    const tu = this._tuners[i];
    if (!tu) return;
    const t = this.ctx.currentTime;
    tu.target.g.gain.setTargetAtTime(0, t, 0.12);
    tu.player.g.gain.setTargetAtTime(0, t, 0.12);
  }

  lockResonator(i, targetFreq) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const tu = this._tuners[i];
    if (tu) {
      tu.target.g.gain.setTargetAtTime(0, t, 0.3);
      tu.player.g.gain.setTargetAtTime(0, t, 0.3);
    }
    this._chime(targetFreq * 2, t);
    this.level = Math.min(3, this.level + 1);
    if (this.level === 1) this.droneGain.gain.setTargetAtTime(0.05, t, 2.0);
    if (this.level === 3) this._pendingBreakdown = true;
  }

  // FM bell — the reward sound for locking a resonator
  _chime(freq, t) {
    const ctx = this.ctx;
    const car = ctx.createOscillator();
    car.frequency.value = freq;
    const mod = ctx.createOscillator();
    mod.frequency.value = freq * 3.51; // inharmonic, bell-like
    const modGain = ctx.createGain();
    modGain.gain.setValueAtTime(freq * 2.2, t);
    modGain.gain.exponentialRampToValueAtTime(1, t + 1.6);
    mod.connect(modGain);
    modGain.connect(car.frequency);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.28, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 2.8);
    car.connect(g);
    g.connect(this.master);
    g.connect(this.reverb);
    mod.start(t); car.start(t);
    mod.stop(t + 3); car.stop(t + 3);
  }

  // ---------- sequencer ----------

  _startScheduler() {
    this._step = 0;
    this._nextTime = this.ctx.currentTime + 0.2;
    this._timer = setInterval(() => {
      while (this._nextTime < this.ctx.currentTime + 0.14) {
        this._scheduleStep(this._step, this._nextTime);
        this._nextTime += SIXTEENTH;
        this._step++;
      }
    }, 25);
  }

  _scheduleStep(step, t) {
    const inBar = step % 16;
    const bar = Math.floor(step / 16);
    const chord = CHORDS[bar % 4];
    const root = BASS_ROOTS[bar % 4];

    // the moment of transformation: breakdown starts on the next bar line
    if (this._pendingBreakdown && inBar === 0) {
      this._pendingBreakdown = false;
      this.state = 'breakdown';
      this.breakdownTime = t;
      this.dropTime = t + 2 * BAR;
      this._dropStep = step + 32;
      this._riser(t, 2 * BAR);
      // the hum swells in the dark
      this.humGain.gain.setTargetAtTime(2.6, t, 1.2);
    }
    if (this.state === 'breakdown') {
      if (step >= this._dropStep) {
        this.state = 'drop';
        this._impact(t);
        this.humGain.gain.setTargetAtTime(0.5, t, 0.5);
      } else {
        return; // silence except the riser — let the darkness breathe
      }
    }

    const drop = this.state === 'drop';
    const level = drop ? 3 : this.level;
    if (level < 1) return;

    // KICK — four on the floor (muffled behind the walls at level 1)
    if (inBar % 4 === 0) {
      this._kick(t, level === 1);
      // sidechain pump
      this.duck.gain.setValueAtTime(drop ? 0.22 : 0.45, t);
      this.duck.gain.linearRampToValueAtTime(1.0, t + 0.34);
    }

    if (level >= 2) {
      // closed hats on the offbeats, ghost 16ths in the drop
      if (inBar % 4 === 2) this._hat(t, 0.09, false);
      else if (drop && inBar % 2 === 1) this._hat(t, 0.035, false);
      // rolling bass, leaving room for the kick
      if (inBar % 4 !== 0) {
        const octaveUp = (inBar % 8 === 6 || inBar % 16 === 15);
        this._bass(t, root * (octaveUp ? 2 : 1), drop ? 1.0 : 0.7);
      }
    }

    if (drop) {
      if (inBar % 8 === 4) this._clap(t);            // 2 and 4
      if (inBar % 4 === 2) this._hat(t, 0.16, true); // open hats breathe
      if (inBar === 0) this._pad(t, chord, BAR * 1.05);
      this._arp(t, chord, step);
    }
  }

  // ---------- instruments ----------

  _kick(t, muffled) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(155, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.1);
    const g = ctx.createGain();
    g.gain.setValueAtTime(muffled ? 0.5 : 1.0, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
    o.connect(g);
    if (muffled) {
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 220;
      g.connect(lp);
      lp.connect(this.drumBus);
    } else {
      g.connect(this.drumBus);
    }
    o.start(t); o.stop(t + 0.35);
  }

  _hat(t, decay, open) {
    const ctx = this.ctx;
    const src = this._noiseSource();
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = open ? 6800 : 7800;
    const g = ctx.createGain();
    g.gain.setValueAtTime(open ? 0.14 : 0.11, t);
    g.gain.exponentialRampToValueAtTime(0.0005, t + decay);
    src.connect(hp); hp.connect(g); g.connect(this.drumBus);
    if (open) g.connect(this.reverb);
    src.start(t); src.stop(t + decay + 0.05);
  }

  _clap(t) {
    const ctx = this.ctx;
    const src = this._noiseSource();
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1500;
    bp.Q.value = 0.9;
    const g = ctx.createGain();
    // three micro-bursts then a tail = a clap
    g.gain.setValueAtTime(0.001, t);
    for (let i = 0; i < 3; i++) {
      g.gain.setValueAtTime(0.28, t + i * 0.011);
      g.gain.exponentialRampToValueAtTime(0.05, t + i * 0.011 + 0.009);
    }
    g.gain.setValueAtTime(0.25, t + 0.033);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
    src.connect(bp); bp.connect(g); g.connect(this.drumBus); g.connect(this.reverb);
    src.start(t); src.stop(t + 0.3);
  }

  _bass(t, freq, vel) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = freq;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.Q.value = 6;
    lp.frequency.setValueAtTime(200 + 700 * vel, t);
    lp.frequency.exponentialRampToValueAtTime(180, t + SIXTEENTH * 0.9);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.3 * vel, t);
    g.gain.setTargetAtTime(0.0001, t + SIXTEENTH * 0.55, 0.02);
    o.connect(lp); lp.connect(g); g.connect(this.musicBus);
    o.start(t); o.stop(t + SIXTEENTH + 0.1);
  }

  _pad(t, chord, dur) {
    const ctx = this.ctx;
    for (const freq of chord) {
      for (const det of [-9, 0, 9]) { // supersaw spread
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = freq;
        o.detune.value = det;
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.setValueAtTime(900, t);
        lp.frequency.linearRampToValueAtTime(2600, t + dur * 0.5);
        lp.frequency.linearRampToValueAtTime(1000, t + dur);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.linearRampToValueAtTime(0.045, t + 0.25);
        g.gain.setValueAtTime(0.045, t + dur - 0.3);
        g.gain.linearRampToValueAtTime(0.0001, t + dur);
        o.connect(lp); lp.connect(g); g.connect(this.musicBus); g.connect(this.reverb);
        o.start(t); o.stop(t + dur + 0.1);
      }
    }
  }

  _arp(t, chord, step) {
    const ctx = this.ctx;
    // deterministic pseudo-random walk over chord tones, one octave up
    const tone = chord[(step * 5 + ((step >> 2) * 3)) % chord.length] * 2;
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.value = tone;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.11, t);
    g.gain.exponentialRampToValueAtTime(0.0005, t + 0.16);
    o.connect(g); g.connect(this.musicBus); g.connect(this.reverb);
    o.start(t); o.stop(t + 0.25);
  }

  _riser(t, dur) {
    const ctx = this.ctx;
    const src = this._noiseSource();
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 1.6;
    bp.frequency.setValueAtTime(350, t);
    bp.frequency.exponentialRampToValueAtTime(7500, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.5, t + dur);
    g.gain.setValueAtTime(0.5, t + dur);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.12);
    src.connect(bp); bp.connect(g); g.connect(this.master); g.connect(this.reverb);
    src.start(t); src.stop(t + dur + 0.2);

    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(110, t);
    o.frequency.exponentialRampToValueAtTime(880, t + dur);
    const og = ctx.createGain();
    og.gain.setValueAtTime(0.0001, t);
    og.gain.exponentialRampToValueAtTime(0.07, t + dur);
    og.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.1);
    o.connect(og); og.connect(this.reverb); og.connect(this.master);
    o.start(t); o.stop(t + dur + 0.2);
  }

  _impact(t) {
    const ctx = this.ctx;
    // sub boom
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(90, t);
    o.frequency.exponentialRampToValueAtTime(28, t + 1.2);
    const g = ctx.createGain();
    g.gain.setValueAtTime(1.0, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 1.5);
    o.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + 1.6);
    // crash wash
    const src = this._noiseSource();
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 3200;
    const cg = ctx.createGain();
    cg.gain.setValueAtTime(0.3, t);
    cg.gain.exponentialRampToValueAtTime(0.001, t + 1.8);
    src.connect(hp); hp.connect(cg); cg.connect(this.master); cg.connect(this.reverb);
    src.start(t); src.stop(t + 2);
  }

  // ---------- analysis for visuals ----------

  getBands() {
    if (!this.ctx) return this._bands;
    this.analyser.getByteFrequencyData(this._fft);
    const hz = this.ctx.sampleRate / this.analyser.fftSize;
    const avg = (lo, hi) => {
      const a = Math.max(1, Math.floor(lo / hz));
      const b = Math.min(this._fft.length - 1, Math.ceil(hi / hz));
      let s = 0;
      for (let i = a; i <= b; i++) s += this._fft[i];
      return s / ((b - a + 1) * 255);
    };
    this._bands.bass = avg(35, 140);
    this._bands.mid = avg(220, 2200);
    this._bands.high = avg(4000, 12000);
    return this._bands;
  }
}

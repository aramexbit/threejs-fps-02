// audio.js — all sound is synthesised with WebAudio; the game ships no audio files.
// Every effect is a short envelope over an oscillator or a filtered noise burst.
export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.enabled = true;
    this._noiseBuf = null;
  }

  // Called from the first user gesture (pointer lock click). Safe to call repeatedly.
  unlock() {
    try {
      if (!this.ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        this.ctx = new AC();
        this.master = this.ctx.createGain();
        this.master.gain.value = 0.32;
        this.master.connect(this.ctx.destination);
        const len = this.ctx.sampleRate;
        this._noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
        const d = this._noiseBuf.getChannelData(0);
        for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      }
      if (this.ctx.state === 'suspended') void this.ctx.resume();
    } catch (e) { /* headless / no audio device: stay silent */ }
  }

  _tone(freq, dur, type, vol, slideTo) {
    if (!this.ctx || !this.enabled) return;
    try {
      const t = this.ctx.currentTime;
      const o = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      o.type = type;
      o.frequency.setValueAtTime(freq, t);
      if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t + dur);
      g.gain.setValueAtTime(vol, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g); g.connect(this.master);
      o.start(t); o.stop(t + dur + 0.02);
    } catch (e) { /* ignore */ }
  }

  _noise(dur, vol, filterFreq, type) {
    if (!this.ctx || !this.enabled) return;
    try {
      const t = this.ctx.currentTime;
      const src = this.ctx.createBufferSource();
      src.buffer = this._noiseBuf;
      src.loop = true;
      const f = this.ctx.createBiquadFilter();
      f.type = type || 'lowpass';
      f.frequency.value = filterFreq;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(vol, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      src.connect(f); f.connect(g); g.connect(this.master);
      src.start(t); src.stop(t + dur + 0.02);
    } catch (e) { /* ignore */ }
  }

  // kind: 'pistol' | 'smg' | 'rifle' | 'sniper' | 'distant'
  shot(kind) {
    if (kind === 'sniper') { this._noise(0.22, 0.9, 900); this._tone(140, 0.18, 'sawtooth', 0.35, 45); }
    else if (kind === 'rifle') { this._noise(0.11, 0.7, 1400); this._tone(190, 0.09, 'square', 0.22, 70); }
    else if (kind === 'smg') { this._noise(0.08, 0.55, 1800); this._tone(230, 0.06, 'square', 0.18, 90); }
    else if (kind === 'distant') { this._noise(0.16, 0.22, 500); }
    else { this._noise(0.1, 0.65, 1200); this._tone(160, 0.08, 'square', 0.25, 60); }
  }

  dryFire() { this._tone(1200, 0.03, 'square', 0.12); }
  reload() { this._tone(500, 0.05, 'square', 0.15); setTimeout(() => this._tone(700, 0.05, 'square', 0.15), 120); }
  hitmarker() { this._tone(2400, 0.05, 'sine', 0.25); }
  hurt() { this._tone(110, 0.18, 'sawtooth', 0.3, 60); }
  step() { this._noise(0.06, 0.10, 420); }
  plantBeep(final) { this._tone(final ? 1560 : 980, final ? 0.3 : 0.09, 'sine', 0.3); }
  defuseBeep() { this._tone(1240, 0.08, 'sine', 0.25); }
  explosion() {
    this._noise(0.9, 1.0, 320);
    this._tone(70, 0.8, 'sine', 0.7, 28);
    this._noise(0.4, 0.6, 2400, 'highpass');
  }
  roundStart() { this._tone(660, 0.12, 'sine', 0.25); setTimeout(() => this._tone(880, 0.18, 'sine', 0.25), 140); }
  roundEnd(win) {
    this._tone(win ? 523 : 392, 0.16, 'sine', 0.3);
    setTimeout(() => this._tone(win ? 784 : 311, 0.28, 'sine', 0.3), 170);
  }
  buy() { this._tone(880, 0.07, 'sine', 0.22); setTimeout(() => this._tone(1174, 0.1, 'sine', 0.22), 80); }
  denied() { this._tone(220, 0.14, 'square', 0.2, 160); }
  grenadePin() { this._tone(1500, 0.04, 'square', 0.15); }
}

// Tiny WebAudio synth for feedback blips.  No assets needed.

export class Sfx {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.master = null;
  }
  ensure() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.35;
    this.master.connect(this.ctx.destination);
  }
  toggleMute() {
    this.muted = !this.muted;
    if (this.master) this.master.gain.value = this.muted ? 0 : 0.35;
    return this.muted;
  }
  _tone({ f0, f1 = f0, type = 'sine', dur = 0.15, gain = 0.5, delay = 0, attack = 0.005 }) {
    if (!this.ctx || this.muted) return;
    const t0 = this.ctx.currentTime + delay;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t0);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(this.master);
    o.start(t0); o.stop(t0 + dur + 0.02);
  }
  gem(n = 0) {
    const base = 880 * Math.pow(2, (n % 6) / 12);
    this._tone({ f0: base, f1: base * 1.5, type: 'triangle', dur: 0.12, gain: 0.35 });
  }
  boost() {
    this._tone({ f0: 200, f1: 1400, type: 'sawtooth', dur: 0.35, gain: 0.25 });
    this._tone({ f0: 100, f1: 700, type: 'square', dur: 0.3, gain: 0.12 });
  }
  goal() {
    [523, 659, 784, 1047].forEach((f, i) => this._tone({ f0: f, type: 'square', dur: 0.18, gain: 0.25, delay: i * 0.09 }));
    this._tone({ f0: 1047, f1: 1047, type: 'triangle', dur: 0.5, gain: 0.3, delay: 0.36 });
  }
  fall() {
    this._tone({ f0: 500, f1: 60, type: 'sawtooth', dur: 0.7, gain: 0.3 });
  }
  go() {
    this._tone({ f0: 660, type: 'square', dur: 0.1, gain: 0.25 });
    this._tone({ f0: 990, type: 'square', dur: 0.25, gain: 0.25, delay: 0.12 });
  }
  ready() {
    this._tone({ f0: 440, type: 'square', dur: 0.12, gain: 0.2 });
  }
  bump(strength) {
    this._tone({ f0: 160, f1: 80, type: 'triangle', dur: 0.1, gain: Math.min(0.5, 0.1 + strength * 0.05) });
  }
  land() {
    this._tone({ f0: 120, f1: 70, type: 'sine', dur: 0.12, gain: 0.35 });
  }
  gameover() {
    [392, 349, 311, 262].forEach((f, i) => this._tone({ f0: f, type: 'square', dur: 0.3, gain: 0.25, delay: i * 0.22 }));
  }
}

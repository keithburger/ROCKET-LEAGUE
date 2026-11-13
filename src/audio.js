// audio.js — fully synthesised WebAudio sound (no external assets). The AudioContext is created
// lazily on the first user gesture to respect browser autoplay rules.
import { CFG, toUU } from './config.js';
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

export class AudioSys {
  constructor(bus) {
    this.ctx = null; this.muted = CFG.audio.mute; this.volume = CFG.audio.master;
    this.engines = new Map(); this.bus = bus; this.ready = false;
    const unlock = () => { this.init(); };
    for (const ev of ['pointerdown', 'keydown', 'touchstart']) window.addEventListener(ev, unlock, { once: false, passive: true });
    this.subscribe();
  }

  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {}); return; }
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
    try { this.ctx = new AC(); } catch (e) { return; }
    const c = this.ctx;
    this.master = c.createGain(); this.master.gain.value = this.muted ? 0 : this.volume;
    const comp = c.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 4;
    this.master.connect(comp); comp.connect(c.destination);
    // shared noise buffer
    const len = c.sampleRate * 2, buf = c.createBuffer(1, len, c.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.noiseBuf = buf;
    // looped noise sources: boost, tyres, crowd
    const loop = (filterType, freq, q) => {
      const s = c.createBufferSource(); s.buffer = buf; s.loop = true; s.playbackRate.value = 0.7 + Math.random() * 0.6;
      const f = c.createBiquadFilter(); f.type = filterType; f.frequency.value = freq; f.Q.value = q;
      const g = c.createGain(); g.gain.value = 0; s.connect(f); f.connect(g); g.connect(this.master); s.start(); return { s, f, g };
    };
    this.boostSnd = loop('bandpass', 700, 0.7);
    this.tireSnd = loop('bandpass', 1500, 2.5);
    this.windSnd = loop('highpass', 2200, 0.5);
    this.crowd = loop('lowpass', 650, 0.4); this.crowd.g.gain.value = 0.05;
    this.crowd2 = loop('bandpass', 1100, 0.6); this.crowd2.g.gain.value = 0.03;
    this.ready = true;
    if (c.state === 'suspended') c.resume().catch(() => {});
  }

  setMute(m) { this.muted = m; if (this.master) this.master.gain.setTargetAtTime(m ? 0 : this.volume, this.ctx.currentTime, 0.02); }
  setVolume(v) { this.volume = v; if (this.master && !this.muted) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.02); }

  // ---------------------------------------------------------------- one shots
  env(g, t, a, peak, d) { g.gain.cancelScheduledValues(t); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + a + d); }
  tone(freq, dur, gain = 0.2, type = 'sine', slideTo = null, delay = 0) {
    if (!this.ready) return; const c = this.ctx, t = c.currentTime + delay;
    const o = c.createOscillator(), g = c.createGain(); o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    this.env(g, t, 0.005, gain, dur); o.connect(g); g.connect(this.master); o.start(t); o.stop(t + dur + 0.05);
  }
  noise(dur, freq, gain = 0.2, type = 'lowpass', q = 0.7, delay = 0, slideTo = null) {
    if (!this.ready) return; const c = this.ctx, t = c.currentTime + delay;
    const s = c.createBufferSource(); s.buffer = this.noiseBuf; s.playbackRate.value = 0.6 + Math.random() * 0.8;
    const f = c.createBiquadFilter(); f.type = type; f.frequency.setValueAtTime(freq, t); f.Q.value = q; if (slideTo) f.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    const g = c.createGain(); this.env(g, t, 0.004, gain, dur); s.connect(f); f.connect(g); g.connect(this.master); s.start(t, Math.random()); s.stop(t + dur + 0.05);
  }

  subscribe() {
    const b = this.bus;
    b.on('ballHit', (e) => { const p = clamp(toUU(e.power) / 2300, 0.05, 1.5); this.tone(130 + 60 * (1 - p), 0.22, 0.28 + p * 0.3, 'sine', 55); this.noise(0.12, 2500, 0.15 + p * 0.3, 'bandpass', 1.2); if (p > 0.6) this.tone(900, 0.08, 0.1, 'square', 300); });
    b.on('ballImpact', (e) => { const p = clamp(e.power / 20, 0.05, 1); this.tone(100 + 40 * (1 - p), 0.18, 0.08 + p * 0.25, 'sine', 50); this.noise(0.08, 1800, 0.05 + p * 0.15, 'bandpass', 1.5); });
    b.on('jump', () => { this.noise(0.12, 600, 0.12, 'lowpass', 0.8, 0, 200); this.tone(180, 0.1, 0.1, 'triangle', 120); });
    b.on('dodge', () => { this.noise(0.28, 1200, 0.2, 'bandpass', 1, 0, 3500); });
    b.on('land', (e) => { const p = clamp(e.power, 0.1, 1); this.tone(90, 0.16, 0.2 * p + 0.05, 'sine', 45); this.noise(0.1, 700, 0.1 * p, 'lowpass'); });
    b.on('carBump', (e) => { this.noise(0.15, 900, clamp(e.power / 30, 0.05, 0.4), 'bandpass', 0.8); this.tone(70, 0.18, 0.2, 'sine', 40); });
    b.on('demolish', () => { this.noise(0.9, 1800, 0.6, 'lowpass', 0.6, 0, 120); this.tone(80, 0.7, 0.5, 'sawtooth', 25); this.tone(300, 0.2, 0.2, 'square', 60); });
    b.on('padPickup', (e) => { if (e.car && !e.car.isHuman) return; this.tone(e.pad.large ? 520 : 760, 0.14, 0.14, 'sine', e.pad.large ? 980 : 1100); this.tone(e.pad.large ? 780 : 1140, 0.18, 0.08, 'triangle', null, 0.04); });
    b.on('count', () => this.tone(520, 0.2, 0.25, 'square'));
    b.on('go', () => { this.tone(1040, 0.5, 0.28, 'square'); this.tone(1560, 0.5, 0.12, 'sine'); });
    b.on('goal', (e) => {
      for (const [f, d] of [[262, 0], [330, 0.02], [392, 0.04], [523, 0.06]]) this.tone(f, 1.8, 0.14, 'sawtooth', f * 0.99, d);
      this.noise(1.6, 900, 0.4, 'bandpass', 0.5, 0.0, 300); this.tone(60, 1.2, 0.5, 'sine', 30);
      this.crowdBoost = 3.5;
    });
    b.on('overtime', () => { this.tone(220, 1, 0.2, 'sawtooth', 440); });
    b.on('ended', () => { this.tone(392, 0.4, 0.2, 'triangle'); this.tone(523, 0.6, 0.2, 'triangle', null, 0.25); this.tone(659, 0.9, 0.2, 'triangle', null, 0.5); });
    b.on('ui', () => this.tone(660, 0.06, 0.1, 'square'));
  }

  uiClick() { this.tone(700, 0.05, 0.08, 'square'); }

  // ---------------------------------------------------------------- continuous
  engine(car) {
    let e = this.engines.get(car);
    if (!e) {
      const c = this.ctx;
      const o1 = c.createOscillator(), o2 = c.createOscillator(), o3 = c.createOscillator(), f = c.createBiquadFilter(), g = c.createGain(), p = c.createStereoPanner();
      o1.type = 'sawtooth'; o2.type = 'square'; o3.type = 'sine'; f.type = 'lowpass'; f.frequency.value = 600; f.Q.value = 3; g.gain.value = 0;
      const g2 = c.createGain(), g3 = c.createGain(); g2.gain.value = 0.4; g3.gain.value = 0.6;
      o1.connect(f); o2.connect(g2); g2.connect(f); o3.connect(g3); g3.connect(f); f.connect(g); g.connect(p); p.connect(this.master);
      o1.start(); o2.start(); o3.start(); e = { o1, o2, o3, f, g, p }; this.engines.set(car, e);
    }
    return e;
  }

  // listener: {pos, right}
  update(match, dt, listenerPos, listenerRight, playing) {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    // drop engines for removed cars
    for (const [car, e] of this.engines) if (!match.cars.includes(car)) { e.g.gain.setTargetAtTime(0, t, 0.05); setTimeout(() => { try { e.o1.stop(); e.o2.stop(); e.o3.stop(); } catch (x) { /* */ } }, 300); this.engines.delete(car); }
    let tire = 0, boost = 0, wind = 0;
    for (const car of match.cars) {
      const e = this.engine(car);
      if (!playing || car.demolished) { e.g.gain.setTargetAtTime(0, t, 0.05); continue; }
      const sr = clamp(car.speed / CFG.car.maxSpeed, 0, 1.1), th = Math.abs(car.ctrl.throttle) + (car.boosting ? 0.6 : 0);
      const freq = 48 + sr * 150 + th * 22 + (car.contacts === 0 ? 20 : 0);
      e.o1.frequency.setTargetAtTime(freq, t, 0.04); e.o2.frequency.setTargetAtTime(freq * 0.5, t, 0.04); e.o3.frequency.setTargetAtTime(freq * 0.25, t, 0.04);
      e.f.frequency.setTargetAtTime(350 + sr * 900 + th * 500, t, 0.05);
      _d.copy(car.currT).sub(listenerPos); const dist = _d.length();
      const att = car.isHuman ? 1 : 1 / (1 + dist * 0.07);
      e.g.gain.setTargetAtTime((0.05 + th * 0.035 + sr * 0.03) * att, t, 0.05);
      e.p.pan.setTargetAtTime(car.isHuman ? 0 : clamp(_d.normalize().dot(listenerRight), -1, 1), t, 0.05);
      const near = att;
      if (car.boosting) boost = Math.max(boost, near);
      tire = Math.max(tire, clamp(car.slipAmount / 10, 0, 1) * near * (car.contacts ? 1 : 0));
      wind = Math.max(wind, clamp(sr - 0.55, 0, 0.5) * 2 * (car.isHuman ? 1 : 0.4));
    }
    this.boostSnd.g.gain.setTargetAtTime(boost * 0.16, t, 0.04); this.boostSnd.f.frequency.setTargetAtTime(600 + boost * 500, t, 0.1);
    this.tireSnd.g.gain.setTargetAtTime(tire * 0.12, t, 0.05);
    this.windSnd.g.gain.setTargetAtTime(wind * 0.06, t, 0.1);
    this.crowdBoost = Math.max(0, (this.crowdBoost || 0) - dt);
    const cb = clamp(this.crowdBoost, 0, 1) + (match.mode === 'versus' ? 0.08 : 0.0);
    this.crowd.g.gain.setTargetAtTime(0.03 + cb * 0.18 + 0.02 * Math.sin(performance.now() / 1500), t, 0.2);
    this.crowd2.g.gain.setTargetAtTime(0.015 + cb * 0.1, t, 0.2);
  }

  silenceAll() { if (!this.ready) return; const t = this.ctx.currentTime; for (const e of this.engines.values()) e.g.gain.setTargetAtTime(0, t, 0.05); this.boostSnd.g.gain.setTargetAtTime(0, t, 0.05); this.tireSnd.g.gain.setTargetAtTime(0, t, 0.05); this.windSnd.g.gain.setTargetAtTime(0, t, 0.05); }
}
import * as THREE from '../vendor/three.module.js';
const _d = new THREE.Vector3();

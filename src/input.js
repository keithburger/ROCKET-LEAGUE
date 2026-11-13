// input.js — keyboard, mouse (free-look) and gamepad handling with customisable bindings.
import { CFG } from './config.js';
import { emptyControls } from './vehicle.js';

const STORE = 'rl3d.settings.v1';
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

export class Input {
  constructor(target) {
    this.keys = new Set();
    this.bindings = JSON.parse(JSON.stringify(CFG.input.bindings));
    this.settings = {
      stickDeadzone: CFG.input.stickDeadzone, triggerDeadzone: CFG.input.triggerDeadzone,
      steerSensitivity: CFG.input.steerSensitivity, dodgeDeadzone: CFG.input.dodgeDeadzone,
      mouseSensitivity: CFG.input.mouseSensitivity, ballCamDefault: true,
    };
    this.ballCam = true;
    this.look = { x: 0, y: 0 };        // free-look request in [-1, 1]
    this.mouseLook = { x: 0, y: 0 };
    this.pointerLocked = false;
    this.edges = { ballCam: false, pause: false, reset: false, any: false };
    this.prevEdge = { ballCam: false, pause: false, reset: false, padPause: false, padBall: false };
    this.capturing = null;
    this.enabled = true;
    this.pad = null; this.padActive = false;
    this.target = target;
    this.load();
    this.bind();
  }

  load() {
    try {
      const s = JSON.parse(localStorage.getItem(STORE) || 'null');
      if (s) {
        if (s.bindings) for (const k of Object.keys(this.bindings)) if (Array.isArray(s.bindings[k])) this.bindings[k] = s.bindings[k];
        if (s.input) Object.assign(this.settings, s.input);
      }
    } catch (e) { /* storage unavailable */ }
    this.ballCam = this.settings.ballCamDefault !== false;
  }

  bind() {
    const isField = (e) => e.target && /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName);
    window.addEventListener('keydown', (e) => {
      if (this.capturing) {
        e.preventDefault();
        if (e.code !== 'Escape') { const cb = this.capturing; this.capturing = null; cb(e.code); } else { const cb = this.capturing; this.capturing = null; cb(null); }
        return;
      }
      if (isField(e)) return;
      if (this.isBound(e.code)) e.preventDefault();
      if (e.repeat) return;
      this.keys.add(e.code);
      this.edges.any = true;
      if (this.bindings.jump.includes(e.code)) this.jumpLatch = true;
    });
    window.addEventListener('keyup', (e) => { this.keys.delete(e.code); });
    window.addEventListener('blur', () => { this.keys.clear(); this.mouseLook.x = this.mouseLook.y = 0; });
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.keys.clear(); });
    window.addEventListener('contextmenu', (e) => { if (this.enabled) e.preventDefault(); });
    document.addEventListener('pointerlockchange', () => { this.pointerLocked = document.pointerLockElement === this.target; });
    window.addEventListener('mousemove', (e) => {
      if (!this.pointerLocked) return;
      const s = this.settings.mouseSensitivity;
      this.mouseLook.x = clamp(this.mouseLook.x + e.movementX * s, -1.2, 1.2);
      this.mouseLook.y = clamp(this.mouseLook.y + e.movementY * s, -1.2, 1.2);
    });
  }

  isBound(code) { return Object.values(this.bindings).some((a) => a.includes(code)); }
  down(action) { return this.bindings[action].some((c) => this.keys.has(c)); }

  save() {
    try { localStorage.setItem(STORE, JSON.stringify({ bindings: this.bindings, input: this.settings, ui: this.uiSettings || {} })); } catch (e) { /* ignore */ }
  }
  loadUi() { try { return (JSON.parse(localStorage.getItem(STORE) || 'null') || {}).ui || {}; } catch (e) { return {}; } }

  rebind(action, code) { this.bindings[action] = [code]; this.save(); }
  resetBindings() { this.bindings = JSON.parse(JSON.stringify(CFG.input.bindings)); this.save(); }
  captureNext(cb) { this.capturing = cb; this.keys.clear(); }

  requestPointerLock() { if (this.enabled && this.target.requestPointerLock && !this.pointerLocked) { try { const p = this.target.requestPointerLock(); if (p && p.catch) p.catch(() => {}); } catch (e) { /* ignore */ } } }
  releasePointerLock() { if (document.pointerLockElement) document.exitPointerLock(); }

  radial(x, y, dz) {
    const m = Math.hypot(x, y);
    if (m < dz) return [0, 0];
    const k = (m - dz) / (1 - dz) / m;
    return [clamp(x * k, -1, 1), clamp(y * k, -1, 1)];
  }

  pollPad() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    this.pad = null;
    for (const p of pads) if (p && p.connected) { this.pad = p; break; }
  }

  // Returns controls for the human car; also updates edge-triggered actions.
  get(dt) {
    const c = emptyControls();
    const S = this.settings;
    this.pollPad();
    // keyboard
    const kThrottle = (this.down('throttle') ? 1 : 0) - (this.down('brake') ? 1 : 0);
    const kSteer = (this.down('right') ? 1 : 0) - (this.down('left') ? 1 : 0);
    c.throttle = kThrottle; c.pitch = kThrottle; c.steer = kSteer;
    c.roll = (this.down('rollRight') ? 1 : 0) - (this.down('rollLeft') ? 1 : 0);
    c.jump = this.down('jump') || this.jumpLatch; this.jumpLatch = false; c.boost = this.down('boost');
    const ctrlHeld = this.down('powerslide');
    c.handbrake = ctrlHeld; c.airRoll = ctrlHeld;
    let lx = (this.down('lookRight') ? 1 : 0) - (this.down('lookLeft') ? 1 : 0);
    let ly = (this.down('lookDown') ? 1 : 0) - (this.down('lookUp') ? 1 : 0);
    // gamepad
    let padBall = false, padPause = false;
    if (this.pad) {
      const p = this.pad, b = (i) => (p.buttons[i] ? p.buttons[i].value : 0), pr = (i) => !!(p.buttons[i] && p.buttons[i].pressed);
      const [sx, sy] = this.radial(p.axes[0] || 0, p.axes[1] || 0, S.stickDeadzone);
      const [rx, ry] = this.radial(p.axes[2] || 0, p.axes[3] || 0, S.stickDeadzone);
      const tz = S.triggerDeadzone;
      const rt = b(7) > tz ? b(7) : 0, lt = b(6) > tz ? b(6) : 0;
      const anyPad = Math.abs(sx) + Math.abs(sy) + rt + lt + Math.abs(rx) + Math.abs(ry) > 0 || pr(0) || pr(1) || pr(2) || pr(4) || pr(5);
      if (anyPad) {
        this.padActive = true;
        if (rt || lt) c.throttle = rt - lt;
        if (sy !== 0 || kThrottle === 0) c.pitch = kThrottle !== 0 ? c.pitch : -sy;
        if (sx !== 0) c.steer = clamp(sx * S.steerSensitivity, -1, 1);
        if (pr(0)) c.jump = true;
        if (pr(1)) c.boost = true;
        if (pr(2)) { c.handbrake = true; c.airRoll = true; }
        if (pr(4)) c.roll -= 1; if (pr(5)) c.roll += 1;
        if (Math.abs(rx) > 0) lx = rx; if (Math.abs(ry) > 0) ly = ry;
      }
      padBall = pr(3); padPause = pr(9);
      // right-stick click or Y toggles ball cam (edge)
    }
    c.steer = clamp(c.steer * (c.steer === kSteer && kSteer !== 0 ? 1 : 1), -1, 1);
    c.roll = clamp(c.roll, -1, 1);
    // free look
    this.mouseLook.x *= Math.exp(-dt * 3.2); this.mouseLook.y *= Math.exp(-dt * 3.2);
    this.look.x = clamp(lx + this.mouseLook.x, -1, 1); this.look.y = clamp(ly + this.mouseLook.y, -1, 1);
    // edges
    const bc = this.down('ballCam') || padBall, pa = this.down('pause') || padPause, rs = this.down('reset');
    this.edges.ballCam = bc && !this.prevEdge.ballCam; this.edges.pause = pa && !this.prevEdge.pause; this.edges.reset = rs && !this.prevEdge.reset;
    this.prevEdge.ballCam = bc; this.prevEdge.pause = pa; this.prevEdge.reset = rs;
    if (this.edges.ballCam) this.ballCam = !this.ballCam;
    return c;
  }

  neutral() { return emptyControls(); }
}

export function keyLabel(code) {
  if (!code) return '—';
  return code.replace(/^Key/, '').replace(/^Digit/, '').replace('Arrow', '↑↓←→'.length ? '' : '').replace('Left', code.startsWith('Arrow') ? '←' : ' L').replace('Right', code.startsWith('Arrow') ? '→' : ' R').replace('Up', '↑').replace('Down', '↓').replace('Control', 'Ctrl').replace('Space', 'Space');
}

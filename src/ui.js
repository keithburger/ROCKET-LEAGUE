// ui.js — DOM menus, HUD, settings and key-binding editor.
import { CFG, toUU } from './config.js';
import { keyLabel } from './input.js';

const $ = (id) => document.getElementById(id);
const KEY = 'rl3d.ui.v2';
const ACTIONS = [
  ['throttle', 'Throttle / Pitch down'], ['brake', 'Brake / Reverse / Pitch up'], ['left', 'Steer left / Yaw'], ['right', 'Steer right / Yaw'],
  ['jump', 'Jump / Dodge'], ['boost', 'Boost'], ['powerslide', 'Powerslide / Air roll'], ['rollLeft', 'Air roll left'], ['rollRight', 'Air roll right'],
  ['ballCam', 'Toggle ball cam'], ['reset', 'Reset (Free Play)'], ['pause', 'Pause'], ['lookLeft', 'Look left'], ['lookRight', 'Look right'], ['lookUp', 'Look up'], ['lookDown', 'Look down'],
];

export class UI {
  constructor(app) {
    this.app = app;
    this.settings = { volume: CFG.audio.master, mute: false, showFps: false, fov: CFG.camera.hFov, dist: CFG.camera.distance, height: CFG.camera.height, angle: CFG.camera.angle, stiff: CFG.camera.stiffness, swivel: CFG.camera.swivelSpeed };
    this.load();
    this.current = null; this.msgTimer = 0; this.subTimer = 0; this.prevScreen = null;
    this.wire();
    this.applySettings();
  }

  load() { try { Object.assign(this.settings, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch (e) { /* storage unavailable */ } }
  save() { try { localStorage.setItem(KEY, JSON.stringify(this.settings)); } catch (e) { /* ignore */ } }

  applySettings() {
    const s = this.settings, a = this.app;
    Object.assign(a.cam.settings, { hFov: s.fov, distance: s.dist, height: s.height, angle: s.angle, stiffness: s.stiff, swivelSpeed: s.swivel });
    a.cam.applyFov(0);
    a.audio.setVolume(s.volume); a.audio.setMute(s.mute);
    $('fps').classList.toggle('hidden', !s.showFps);
  }

  wire() {
    const a = this.app;
    // menu buttons
    document.querySelectorAll('[data-start]').forEach((b) => b.addEventListener('click', () => { a.audio.init(); a.bus.emit('ui'); a.startGame(b.dataset.start, $('difficulty').value); }));
    $('btn-settings').addEventListener('click', () => this.openSettings('menu'));
    $('btn-pause-settings').addEventListener('click', () => this.openSettings('pause'));
    $('btn-resume').addEventListener('click', () => a.setPaused(false));
    $('btn-restart').addEventListener('click', () => { a.match.restart(); a.setPaused(false); });
    $('btn-quit').addEventListener('click', () => a.quitToMenu());
    $('btn-rematch').addEventListener('click', () => { a.match.restart(); this.showScreen(null); this.showHud(true); });
    $('btn-res-menu').addEventListener('click', () => a.quitToMenu());
    $('btn-settings-close').addEventListener('click', () => this.closeSettings());
    // practice panel
    document.querySelectorAll('#practice [data-preset]').forEach((b) => b.addEventListener('click', () => a.match.setPreset(b.dataset.preset)));
    document.querySelectorAll('#practice [data-act]').forEach((b) => b.addEventListener('click', () => a.practiceAction(b.dataset.act)));
    // tabs
    document.querySelectorAll('.tabs button').forEach((b) => b.addEventListener('click', () => {
      document.querySelectorAll('.tabs button').forEach((x) => x.classList.toggle('on', x === b));
      document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('on', t.id === b.dataset.tab));
    }));
    // sliders
    const bindRange = (id, get, set, fmt = (v) => v) => {
      const el = $(id), out = el.parentElement.querySelector('output');
      el.value = get(); out.textContent = fmt(+el.value);
      el.addEventListener('input', () => { set(+el.value); out.textContent = fmt(+el.value); this.save(); a.input.save(); this.applySettings(); });
    };
    const s = this.settings, inp = a.input.settings;
    bindRange('s-volume', () => s.volume, (v) => (s.volume = v), (v) => Math.round(v * 100) + '%');
    bindRange('s-fov', () => s.fov, (v) => (s.fov = v), (v) => v + '°');
    bindRange('s-dist', () => s.dist, (v) => (s.dist = v));
    bindRange('s-height', () => s.height, (v) => (s.height = v));
    bindRange('s-angle', () => s.angle, (v) => (s.angle = v), (v) => v.toFixed(1));
    bindRange('s-stiff', () => s.stiff, (v) => (s.stiff = v), (v) => v.toFixed(2));
    bindRange('s-swivel', () => s.swivel, (v) => (s.swivel = v), (v) => v.toFixed(1));
    bindRange('s-steer', () => inp.steerSensitivity, (v) => (inp.steerSensitivity = v), (v) => v.toFixed(2));
    bindRange('s-dz', () => inp.stickDeadzone, (v) => (inp.stickDeadzone = v), (v) => v.toFixed(2));
    bindRange('s-dodge', () => inp.dodgeDeadzone, (v) => (inp.dodgeDeadzone = v), (v) => v.toFixed(2));
    bindRange('s-mouse', () => inp.mouseSensitivity, (v) => (inp.mouseSensitivity = v), (v) => v.toFixed(4));
    const chk = (id, get, set) => { const el = $(id); el.checked = get(); el.addEventListener('change', () => { set(el.checked); this.save(); a.input.save(); this.applySettings(); }); };
    chk('s-mute', () => s.mute, (v) => (s.mute = v));
    chk('s-fps', () => s.showFps, (v) => (s.showFps = v));
    chk('s-ballcam', () => inp.ballCamDefault !== false, (v) => (inp.ballCamDefault = v));
    $('btn-keys-reset').addEventListener('click', () => { a.input.resetBindings(); this.buildKeys(); });
    this.buildKeys();
  }

  buildKeys() {
    const list = $('keylist'); list.innerHTML = '';
    for (const [act, label] of ACTIONS) {
      const row = document.createElement('div'); row.className = 'k';
      const sp = document.createElement('span'); sp.textContent = label;
      const btn = document.createElement('button'); btn.textContent = this.app.input.bindings[act].map(keyLabel).join(' / ');
      btn.addEventListener('click', () => {
        btn.textContent = 'press a key…'; btn.classList.add('wait');
        this.app.input.captureNext((code) => { btn.classList.remove('wait'); if (code) this.app.input.rebind(act, code); this.buildKeys(); });
      });
      row.append(sp, btn); list.append(row);
    }
  }

  // ----------------------------------------------------------------- screens
  showScreen(name) {
    for (const id of ['menu', 'pause', 'results', 'settings']) $(id).classList.toggle('hidden', id !== name);
    this.current = name;
  }
  showHud(on) { $('hud').classList.toggle('hidden', !on); }
  openSettings(from) { this.prevScreen = from; this.buildKeys(); this.showScreen('settings'); }
  closeSettings() { this.showScreen(this.prevScreen === 'pause' ? 'pause' : 'menu'); this.save(); this.app.input.save(); }

  showResults(r) {
    const you = 0, win = r.winner;
    $('res-title').textContent = win === -1 ? 'DRAW' : (win === you ? 'VICTORY' : 'DEFEAT');
    $('res-score').innerHTML = `<span class="blue">${r.scores[0]}</span> – <span class="orange">${r.scores[1]}</span>`;
    const st = r.stats; const row = (n, a, b) => `<tr><td>${n}</td><td>${a}</td><td>${b}</td></tr>`;
    $('res-stats').innerHTML = row('', 'You', 'Bot') + row('Goals', r.scores[0], r.scores[1]) + row('Ball touches', st.touches[0], st.touches[1]) + row('Demolitions', st.demos[0], st.demos[1]);
    this.showScreen('results');
  }

  // ----------------------------------------------------------------- messages
  say(text, color, sub, dur = 1.4, pop = true) {
    const el = $('center-msg'); el.textContent = text; el.style.color = color || '#fff'; el.style.opacity = 1;
    el.classList.remove('pop'); if (pop) { void el.offsetWidth; el.classList.add('pop'); }
    this.msgTimer = dur;
    if (sub !== undefined) { $('sub-msg').textContent = sub; this.subTimer = dur; }
  }
  sub(text, dur = 2) { $('sub-msg').textContent = text; this.subTimer = dur; }

  // ----------------------------------------------------------------- per-frame HUD
  update(dt, st) {
    if (this.msgTimer > 0) { this.msgTimer -= dt; if (this.msgTimer <= 0) $('center-msg').textContent = ''; }
    if (this.subTimer > 0) { this.subTimer -= dt; if (this.subTimer <= 0) $('sub-msg').textContent = ''; }
    const m = st.match;
    $('score-blue').textContent = m.scores[0]; $('score-orange').textContent = m.scores[1];
    const clock = $('clock');
    if (m.mode === 'freeplay') { clock.textContent = '∞'; $('clock-sub').textContent = 'Free play'; clock.classList.remove('low'); }
    else if (m.overtime) { const t = m.overtimeTime; clock.textContent = '+' + Math.floor(t / 60) + ':' + String(Math.floor(t % 60)).padStart(2, '0'); $('clock-sub').textContent = 'Overtime'; clock.classList.add('low'); }
    else { const t = Math.max(0, Math.ceil(m.timeLeft)); clock.textContent = Math.floor(t / 60) + ':' + String(t % 60).padStart(2, '0'); $('clock-sub').textContent = ''; clock.classList.toggle('low', t <= 30); }
    const car = m.human;
    if (car) {
      const b = Math.round(car.boost), ring = $('boost-ring');
      $('boost-num').textContent = car.unlimitedBoost ? '∞' : b;
      ring.style.strokeDashoffset = String(326.7 * (1 - (car.unlimitedBoost ? 1 : car.boost / 100)));
      $('boost').classList.toggle('boosting', car.boosting);
      const kmh = Math.round(toUU(car.speed) * 0.036); $('speed-num').textContent = kmh;
      const sr = Math.max(0, Math.min(1, (toUU(car.speed) - 1500) / 800)); $('speedfx').style.opacity = String(sr * 0.9);
    }
    const cs = $('camstatus'); cs.textContent = st.ballCam ? 'BALL CAM' : 'CAR CAM'; cs.classList.toggle('on', st.ballCam);
    $('practice').classList.toggle('hidden', m.mode !== 'freeplay' || !st.practiceVisible);
    $('ub-state').textContent = m.unlimitedBoost ? 'on' : 'off';
    $('replay-tag').classList.toggle('hidden', m.state !== 'replay');
    // ball indicator
    const ind = $('ball-ind');
    if (st.ballScreen && st.ballScreen.off && m.state !== 'replay') {
      ind.style.display = 'block'; ind.style.left = st.ballScreen.x + 'px'; ind.style.top = st.ballScreen.y + 'px'; ind.style.transform = `rotate(${st.ballScreen.angle}rad)`;
    } else ind.style.display = 'none';
    const f = $('flashfx'); f.style.opacity = String(st.flash || 0);
    if (st.fps !== undefined && this.settings.showFps) $('fps').textContent = st.fps.toFixed(0) + ' fps';
  }
}

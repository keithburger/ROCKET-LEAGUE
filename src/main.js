// main.js — bootstrap, render loop and glue between the modules.
import * as THREE from '../vendor/three.module.min.js';
import { CFG } from './config.js';
import { buildArenaGeometry } from './arena.js';
import { Physics } from './physics.js';
import { Input } from './input.js';
import { Match, Bus } from './match.js';
import { Renderer } from './renderer.js';
import { GameCamera } from './camera.js';
import { AudioSys } from './audio.js';
import { UI } from './ui.js';

const loadingEl = document.getElementById('loading'), loadingText = document.getElementById('loading-text');
function fail(err) {
  console.error(err);
  loadingEl.classList.add('err'); loadingEl.classList.remove('hidden');
  loadingText.innerHTML = 'Failed to start the game.<br><small>' + String(err && err.message || err).replace(/</g, '&lt;') + '</small><br><small>Serve this folder over HTTP (e.g. <code>python3 -m http.server 8000</code>) and use a WebGL2-capable browser.</small>';
}
window.addEventListener('error', (e) => { if (loadingEl && !loadingEl.classList.contains('hidden')) fail(e.error || e.message); });

async function boot() {
  const canvas = document.getElementById('game');
  const geo = buildArenaGeometry();
  loadingText.textContent = 'Starting physics engine (WebAssembly)…';
  const physics = await Physics.create(geo);
  loadingText.textContent = 'Building arena…';
  const bus = new Bus();
  const input = new Input(canvas);
  const match = new Match(physics, geo, input, bus);
  const renderer = new Renderer(canvas, geo, bus);
  const cam = new GameCamera(renderer.camera, physics);
  const audio = new AudioSys(bus);
  const app = { match, input, renderer, cam, audio, bus, physics, ui: null, practiceVisible: true };

  app.setPaused = (p) => {
    if (match.mode === 'menu' || match.state === 'ended') return;
    match.paused = p; app._pauseT = performance.now();
    app.ui.showScreen(p ? 'pause' : null); app.ui.showHud(true);
    if (p) { input.releasePointerLock(); audio.silenceAll(); } else input.requestPointerLock();
  };
  app.startGame = (mode, difficulty) => {
    input.ballCam = input.settings.ballCamDefault !== false;
    if (mode === 'freeplay') match.startFreePlay(); else match.startVersus(difficulty);
    renderer.markN = 0; cam.initialized = false;
    app.ui.showScreen(null); app.ui.showHud(true); input.requestPointerLock();
  };
  app.quitToMenu = () => { match.quitToMenu(); app.ui.showScreen('menu'); app.ui.showHud(false); input.releasePointerLock(); audio.silenceAll(); document.getElementById('speedfx').style.opacity = 0; };
  app.practiceAction = (a) => {
    if (match.mode !== 'freeplay') return;
    if (a === 'resetAll') match.resetAll(); else if (a === 'resetBall') match.resetBall(); else if (a === 'launch') match.launchBall(); else if (a === 'boost') match.toggleUnlimitedBoost();
  };
  const ui = app.ui = new UI(app);

  // ---------------------------------------------------------------- bus -> UI
  const hexc = ['#3b9bff', '#ff8a2b'];
  bus.on('count', (e) => ui.say(String(e.n), '#fff', undefined, 0.95));
  bus.on('go', () => ui.say('GO!', '#7dffa0', '', 0.8));
  bus.on('kickoff', () => { cam.initialized = false; });
  bus.on('goal', (e) => {
    const name = e.by ? (e.by.isHuman ? 'You' : 'Bot') : '';
    ui.say(e.freeplay ? 'GOAL!' : 'GOAL!', hexc[e.team], name ? `${name} scored · ${Math.round(e.speed || 0)} uu/s` : '', 2.2);
  });
  bus.on('overtime', () => ui.say('OVERTIME', '#ffd36b', 'Next goal wins', 2.5));
  bus.on('demolish', (e) => { if (e.victim.isHuman) ui.say('DEMOLISHED', '#ff6a6a', 'Respawning…', 2.6, false); else if (e.attacker.isHuman) ui.sub('DEMOLITION', 1.5); });
  bus.on('replayStart', () => { cam.initialized = false; });
  bus.on('ended', (r) => { setTimeout(() => { if (match.state === 'ended' && match.mode === 'versus') { ui.showResults(r); input.releasePointerLock(); } }, CFG.match.resultsDelay * 1000); ui.say('FULL TIME', '#fff', '', 1.6); });
  bus.on('matchStart', () => { document.getElementById('boost').classList.toggle('orange', false); });

  // ---------------------------------------------------------------- keyboard shortcuts
  window.addEventListener('keydown', (e) => {
    if (e.target && /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)) return;
    if (input.capturing) return;
    if (match.state === 'replay' && (e.code === 'Space' || e.code === 'Enter')) { match.skipReplay(); return; }
    if (match.mode === 'freeplay' && !match.paused && ui.current === null) {
      const k = e.code;
      if (k === 'KeyT') match.resetBall(); else if (k === 'KeyG') match.launchBall(); else if (k === 'KeyB') match.toggleUnlimitedBoost();
      else if (k === 'Tab') { e.preventDefault(); app.practiceVisible = !app.practiceVisible; }
      else if (/^Digit[1-6]$/.test(k)) match.setPreset(['kickoff', 'shot', 'dribble', 'aerial', 'wall', 'defend'][+k.slice(5) - 1]);
    }
  });
  canvas.addEventListener('click', () => { audio.init(); if (match.mode !== 'menu' && !match.paused && ui.current === null) input.requestPointerLock(); });
  document.addEventListener('pointerlockchange', () => {
    // Esc while locked exits the lock without a keydown for us: treat it as a pause request
    if (!document.pointerLockElement && match.mode !== 'menu' && !match.paused && match.state !== 'ended' && ui.current === null && app._lockWanted && performance.now() - (app._pauseT || 0) > 400) app.setPaused(true);
  });
  setInterval(() => { app._lockWanted = input.pointerLocked; }, 100);
  window.addEventListener('resize', () => cam.setAspect(renderer.resize()));
  window.addEventListener('blur', () => { if (match.mode !== 'menu' && !match.paused && match.state !== 'ended' && ui.current === null) app.setPaused(true); });
  cam.setAspect(renderer.resize());

  // ---------------------------------------------------------------- main loop
  const _p = new THREE.Vector3(), _f = new THREE.Vector3(), _bp = new THREE.Vector3(), _r = new THREE.Vector3();
  let last = performance.now(), fpsAcc = 0, fpsN = 0, fps = 60;
  app.practiceVisible = true;
  function frame(now) {
    requestAnimationFrame(frame);
    let dt = (now - last) / 1000; last = now; dt = Math.min(Math.max(dt, 0.0001), 0.1);
    fpsAcc += dt; fpsN++; if (fpsAcc > 0.5) { fps = fpsN / fpsAcc; fpsAcc = 0; fpsN = 0; }
    const inMatch = match.mode !== 'menu';
    const active = inMatch && !match.paused && ui.current === null;
    // input & pause handling
    const ctrl = input.get(dt);
    if (inMatch) {
      if (input.edges.pause && match.state !== 'ended' && performance.now() - (app._pauseT || 0) > 400) { app.setPaused(!match.paused && ui.current === null); }
      if (input.edges.reset && match.mode === 'freeplay' && active) match.resetAll();
    }
    if (match.human) match.human.dodgeDeadzone = input.settings.dodgeDeadzone;
    match.humanCtrl = (active) ? ctrl : input.neutral();
    if (match.human && input.settings.steerSensitivity !== 1) match.humanCtrl.steer = Math.max(-1, Math.min(1, match.humanCtrl.steer * input.settings.steerSensitivity));
    match.frame(active || (inMatch && ui.current === 'results') ? dt : (inMatch ? 0 : dt));
    // camera
    const h = match.human;
    if (!inMatch || !h) cam.orbit(renderer.time + 6);
    else if (match.state === 'replay' || match.state === 'goal') {
      const goalZ = match.lastScorer === 0 ? CFG.arena.halfLength : -CFG.arena.halfLength;
      cam.updateReplay(dt, match.rBall.pos, _p.set(0, 0, goalZ));
    } else if (match.state === 'ended') cam.orbit(renderer.time);
    else {
      _f.set(0, 0, -1).applyQuaternion(h.rQuat);
      cam.update({ dt, carPos: h.rPos, carFwd: _f, carVel: h.vel, onGround: h.contacts >= 3, speed: h.speed, boosting: h.boosting,
        ballPos: match.rBall.pos, ballCam: input.ballCam, look: input.look, hasCar: true });
    }
    if (renderer.camShake) { cam.shake = Math.max(cam.shake, renderer.camShake); renderer.camShake = 0; }
    renderer.render(match, dt);
    if (inMatch && !match.paused) renderer.adaptQuality(fps, dt);
    // audio
    const playing = inMatch && !match.paused && (match.state === 'playing' || match.state === 'goal' || match.state === 'countdown');
    _r.set(1, 0, 0).applyQuaternion(renderer.camera.quaternion);
    audio.update(match, dt, renderer.camera.position, _r, playing);
    // ball indicator (screen-space)
    let ballScreen = null;
    if (inMatch && h) {
      _bp.copy(match.rBall.pos).project(renderer.camera);
      const behind = _bp.z > 1; let nx = _bp.x, ny = _bp.y;
      if (behind) { nx = -nx; ny = -ny; }
      const off = behind || Math.abs(nx) > 0.94 || Math.abs(ny) > 0.9;
      if (off) {
        const k = Math.max(Math.abs(nx) / 0.9, Math.abs(ny) / 0.84, 1e-3); nx /= k; ny /= k;
        if (behind && Math.abs(nx) < 0.05 && Math.abs(ny) < 0.05) ny = -0.84;
      }
      const w = renderer.width, hh = renderer.height;
      ballScreen = { off, x: (nx * 0.5 + 0.5) * w, y: (-ny * 0.5 + 0.5) * hh, angle: Math.atan2(nx, ny) * 1 + 0 };
      ballScreen.angle = Math.atan2(-(-ny), nx) + Math.PI / 2; // arrow points outward from the screen centre
      ballScreen.angle = Math.atan2(nx, ny);
    }
    ui.update(dt, { match, ballCam: input.ballCam, ballScreen, fps, flash: 0, practiceVisible: app.practiceVisible });
  }
  loadingEl.classList.add('hidden');
  ui.showScreen('menu');
  requestAnimationFrame(frame);
  window.__game = app; // debugging / automated tests
}

boot().catch(fail);

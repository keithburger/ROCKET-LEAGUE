// match.js — game flow: fixed-step simulation loop, kickoff, scoring, overtime, replay, free-play tools.
import * as THREE from '../vendor/three.module.js';
import { CFG, toUU } from './config.js';
import { Car, emptyControls } from './vehicle.js';
import { Ball } from './ball.js';
import { BoostPads } from './boost.js';
import { BotDriver } from './ai.js';

const A = CFG.arena, M = CFG.match, BR = CFG.ball.radius;
const DT = 1 / CFG.sim.hz;
const _v = new THREE.Vector3(), _w = new THREE.Vector3();

export class Bus {
  constructor() { this.h = {}; }
  on(e, f) { (this.h[e] ||= []).push(f); }
  emit(e, d) { const l = this.h[e]; if (l) for (const f of l) f(d); }
}

export class Match {
  constructor(physics, arenaGeo, input, bus) {
    this.P = physics; this.geo = arenaGeo; this.input = input; this.bus = bus;
    this.ball = new Ball(physics);
    this.pads = new BoostPads(arenaGeo.boostPads);
    this.cars = []; this.bots = [];
    this.mode = 'menu';          // 'menu' | 'freeplay' | 'versus'
    this.state = 'idle';         // idle | countdown | playing | goal | replay | ended
    this.paused = false;
    this.scores = [0, 0]; this.timeLeft = M.duration; this.overtime = false; this.overtimeTime = 0;
    this.countdown = 0; this.stateTime = 0; this.simTime = 0; this.acc = 0;
    this.lastScorer = -1; this.lastGoalInfo = null;
    this.humanCtrl = emptyControls();
    this.unlimitedBoost = false; this.preset = 'kickoff';
    this.record = []; this.maxRecord = Math.ceil(CFG.sim.hz * (M.replayDuration + 3));
    this.replay = null;
    this.difficulty = 'pro';
    this.stats = { shots: [0, 0], saves: [0, 0], demos: [0, 0], touches: [0, 0] };
    this.human = null;
    this.fps = 60;
    this.ballPrevVel = new THREE.Vector3();
    this.rBall = { pos: new THREE.Vector3(), quat: new THREE.Quaternion() };
  }

  // ------------------------------------------------------------------ setup
  clearCars() {
    for (const c of this.cars) { this.P.world.removeRigidBody(c.body); }
    this.cars = []; this.bots = []; this.human = null;
  }

  startFreePlay() {
    this.clearCars();
    this.mode = 'freeplay';
    const car = new Car(this.P, { team: 0, isHuman: true, name: 'You' });
    this.cars.push(car); this.human = car;
    this.scores = [0, 0]; this.timeLeft = M.duration; this.overtime = false;
    this.pads.reset(); this.setPreset('kickoff');
    this.state = 'playing'; this.stateTime = 0; this.paused = false; this.replay = null; this.record.length = 0;
    this.bus.emit('matchStart', { mode: 'freeplay' });
  }

  startVersus(difficulty = 'pro') {
    this.clearCars();
    this.mode = 'versus'; this.difficulty = difficulty;
    const me = new Car(this.P, { team: 0, isHuman: true, name: 'You', index: 0 });
    const bot = new Car(this.P, { team: 1, isHuman: false, name: 'Bot', index: 1 });
    this.cars.push(me, bot); this.human = me;
    this.bots = [new BotDriver(bot, difficulty)];
    this.scores = [0, 0]; this.timeLeft = M.duration; this.overtime = false; this.overtimeTime = 0;
    this.stats = { shots: [0, 0], saves: [0, 0], demos: [0, 0], touches: [0, 0] };
    this.pads.reset(); this.replay = null; this.record.length = 0; this.paused = false;
    this.kickoff();
    this.bus.emit('matchStart', { mode: 'versus' });
  }

  spawnFor(team, slot = 0) {
    const kp = this.geo.kickoff[slot % this.geo.kickoff.length];
    const s = team === 0 ? 1 : -1;
    // blue spawns at -z facing +z (yaw PI); orange mirrored (x and z flipped, yaw 0)
    return { x: kp.x * s, y: CFG.car.restHeight, z: kp.z * s, yaw: team === 0 ? Math.PI : 0 };
  }

  kickoff() {
    this.cars.forEach((c, i) => { c.place(this.spawnFor(c.team, 0)); c.boost = CFG.car.boostStart; c.setControls(emptyControls()); });
    this.ball.reset(0, BR + 0.02, 0);
    this.state = 'countdown'; this.countdown = M.countdown; this.stateTime = 0; this.lastGoalInfo = null;
    this.pads.reset();
    this.bus.emit('kickoff', {});
    this.lastCountInt = Math.ceil(this.countdown);
    this.bus.emit('count', { n: this.lastCountInt });
  }

  // ------------------------------------------------------------------ free play tools
  setPreset(name) {
    this.preset = name;
    const car = this.human, ball = this.ball, R = BR;
    const place = (x, z, yaw, boost = 100) => { car.place({ x, y: CFG.car.restHeight, z, yaw }); car.boost = boost; };
    switch (name) {
      case 'shot': place(-12, -30, Math.PI); ball.reset(6, R + 0.02, -8); break;
      case 'dribble': place(0, -38, Math.PI, 60); ball.reset(0, CFG.car.restHeight + CFG.car.halfHeight + R + 0.06, -38); break;
      case 'aerial': place(0, -30, Math.PI); ball.reset(2, 11, 6, 0, 8, 6); break;
      case 'wall': place(-8, -10, -Math.PI / 2 * 0 + Math.PI / 2 * 0 - Math.PI / 2); ball.reset(30, 5, -6, 4, 9, 10); break;
      case 'defend': place(0, -44, Math.PI, 100); ball.reset(-6, 6, 18, 2, 4, -34); break;
      case 'kickoff': default: place(0, -46.08, Math.PI, CFG.car.boostStart); ball.reset(0, R + 0.02, 0); break;
    }
    car.unlimitedBoost = this.unlimitedBoost;
    this.pads.reset();
    this.bus.emit('reset', { preset: name });
  }
  resetAll() { this.setPreset(this.preset); }
  resetBall() { this.ball.reset(0, BR + 0.02, 0); this.bus.emit('reset', {}); }
  launchBall() {
    const car = this.human; if (!car) return;
    // launch from mid-field toward the player's half, slightly randomised
    const z = this.human.currT.z < 0 ? -1 : 1;
    this.ball.reset((Math.random() - 0.5) * 20, 6 + Math.random() * 4, -z * 10, (Math.random() - 0.5) * 16, 6 + Math.random() * 6, z * (20 + Math.random() * 25));
  }
  toggleUnlimitedBoost() { this.unlimitedBoost = !this.unlimitedBoost; if (this.human) { this.human.unlimitedBoost = this.unlimitedBoost; this.human.boost = 100; } return this.unlimitedBoost; }

  // ------------------------------------------------------------------ frame loop
  // Called every rendered frame with real dt (seconds). Returns the interpolation alpha.
  frame(dtReal) {
    dtReal = Math.min(dtReal, 0.25);
    if (this.mode === 'menu' || this.paused) { this.acc = 0; return this.updateRender(1); }
    if (this.state === 'replay') { this.stepReplay(dtReal); return 1; }
    this.acc += dtReal;
    let steps = 0;
    while (this.acc >= DT && steps < CFG.sim.maxCatchupSteps) { this.step(DT); this.acc -= DT; steps++; }
    if (steps === CFG.sim.maxCatchupSteps) this.acc = 0; // drop the backlog instead of spiralling
    return this.updateRender(this.acc / DT);
  }

  updateRender(alpha) {
    for (const c of this.cars) {
      c.rPos ||= new THREE.Vector3(); c.rQuat ||= new THREE.Quaternion();
      c.rPos.copy(c.prevT).lerp(c.currT, alpha); c.rQuat.copy(c.prevQ).slerp(c.currQ, alpha);
    }
    this.rBall.pos.copy(this.ball.prevPos).lerp(this.ball.pos, alpha);
    this.rBall.quat.copy(this.ball.prevQuat).slerp(this.ball.quat, alpha);
    return alpha;
  }

  step(dt) {
    const cars = this.cars, ball = this.ball;
    // snapshots for interpolation
    for (const c of cars) c.snapshot(); ball.snapshot();
    this.ballPrevVel.copy(ball.vel);
    const live = this.state === 'playing' || this.mode === 'freeplay';
    // controls
    for (const c of cars) {
      if (c.isHuman) c.setControls(live ? this.humanCtrl : emptyControls());
    }
    for (const b of this.bots) {
      const ctl = b.update(dt, { ball, cars, pads: this.pads, active: this.state === 'playing', kickoff: this.stateTime < 4 && this.lastTouchless() });
      b.car.setControls(this.state === 'playing' ? ctl : emptyControls());
    }
    // respawn demolished cars
    for (const c of cars) if (c.demolished) { c.respawnTimer -= dt; if (c.respawnTimer <= 0) { c.place(this.spawnFor(c.team, 0)); c.boost = CFG.car.boostStart; this.bus.emit('respawn', { car: c }); } }
    // physics
    for (const c of cars) c.preStep(dt);
    for (const c of cars) {
      if (c.lastJumpEvent) this.bus.emit('jump', { car: c });
      if (c.dodgeEvent) this.bus.emit('dodge', { car: c });
    }
    ball.beginStep(cars, dt);
    this.P.step();
    this.simTime += dt;
    for (const c of cars) c.postStep();
    ball.endStep(cars, dt, this.simTime);
    for (const c of cars) if (c.landedEvent > 0.05) this.bus.emit('land', { car: c, power: c.landedEvent });
    // events
    for (const h of ball.hitEvents) { this.stats.touches[h.car.team]++; this.bus.emit('ballHit', h); }
    if (!ball.hitEvents.length) {
      const dv = _v.copy(ball.vel).sub(this.ballPrevVel).length();
      if (dv > 3.5) this.bus.emit('ballImpact', { power: dv, pos: ball.pos });
    }
    this.P.events.drainCollisionEvents((h1, h2, started) => { if (started) this.carCollision(h1, h2); });
    this.pads.update(dt, cars, this.simTime);
    for (const e of this.pads.events) this.bus.emit(e.respawned ? 'padRespawn' : 'padPickup', e);
    // state machine
    this.stateTime += dt;
    switch (this.state) {
      case 'countdown': {
        this.countdown -= dt;
        const n = Math.ceil(this.countdown);
        if (n !== this.lastCountInt && n > 0) { this.lastCountInt = n; this.bus.emit('count', { n }); }
        if (this.countdown <= 0) { this.state = 'playing'; this.stateTime = 0; this.bus.emit('go', {}); }
        break;
      }
      case 'playing': this.playing(dt); break;
      case 'goal':
        if (this.stateTime >= M.goalCelebration) this.beginReplay();
        break;
      default: break;
    }
    if (this.mode === 'freeplay') this.freeplayGoalCheck();
    this.recordFrame();
  }

  lastTouchless() { return this.ball.lastHitCar === null; }

  playing(dt) {
    if (this.mode !== 'versus') return;
    {
      if (!this.overtime) {
        this.timeLeft -= dt;
        if (this.timeLeft <= 0) {
          this.timeLeft = 0;
          if (this.scores[0] !== this.scores[1]) return this.finish();
          this.overtime = true; this.overtimeTime = 0; this.bus.emit('overtime', {});
        }
      } else this.overtimeTime += dt;
    }
    const g = this.goalCheck();
    if (g >= 0) this.scoreGoal(g);
  }

  // returns scoring team (0 = blue scored in orange goal at +z), or -1
  goalCheck() {
    const p = this.ball.pos;
    if (Math.abs(p.z) > A.halfLength + BR && Math.abs(p.x) < A.goalHalfWidth && p.y < A.goalHeight + BR) return p.z > 0 ? 0 : 1;
    return -1;
  }

  freeplayGoalCheck() {
    if (this.state !== 'playing') return;
    const g = this.goalCheck();
    if (g >= 0) { this.scores[g]++; this.lastScorer = g; this.state = 'goal'; this.stateTime = 0; this.bus.emit('goal', { team: g, freeplay: true, ball: this.ball.pos.clone(), by: this.ball.lastHitCar }); }
  }

  scoreGoal(team) {
    this.scores[team]++; this.lastScorer = team;
    const by = this.ball.lastHitCar;
    this.lastGoalInfo = { team, by, speed: toUU(this.ball.vel.length()), overtime: this.overtime };
    this.stats.shots[team]++;
    this.state = 'goal'; this.stateTime = 0; this.goalFrame = this.record.length;
    this.bus.emit('goal', { team, ball: this.ball.pos.clone(), by, speed: this.lastGoalInfo.speed });
  }

  finish() {
    this.state = 'ended'; this.stateTime = 0;
    const w = this.scores[0] === this.scores[1] ? -1 : (this.scores[0] > this.scores[1] ? 0 : 1);
    this.bus.emit('ended', { scores: this.scores.slice(), winner: w, stats: this.stats });
  }

  carCollision(h1, h2) {
    const a = this.cars.find((c) => c.collider.handle === h1), b = this.cars.find((c) => c.collider.handle === h2);
    if (!a || !b || a === b || a.demolished || b.demolished || a.team === b.team) return;
    const ss = CFG.car.supersonic;
    const attacks = (x, y) => {
      if (x.prevSpeed < ss) return false;
      _w.copy(y.currT).sub(x.currT).normalize();
      return x.prevVel.dot(_w) > 0.4 * x.prevSpeed;
    };
    const aa = attacks(a, b), bb = attacks(b, a);
    let atk = null, vic = null;
    if (aa && (!bb || a.prevSpeed >= b.prevSpeed)) { atk = a; vic = b; } else if (bb) { atk = b; vic = a; }
    if (!atk) { this.bus.emit('carBump', { a, b, power: _v.copy(a.vel).sub(b.vel).length() }); return; }
    this.stats.demos[atk.team]++;
    this.bus.emit('demolish', { victim: vic, attacker: atk, pos: vic.currT.clone() });
    vic.demolish();
  }

  // ------------------------------------------------------------------ replay
  recordFrame() {
    const f = { b: [this.ball.pos.x, this.ball.pos.y, this.ball.pos.z, this.ball.quat.x, this.ball.quat.y, this.ball.quat.z, this.ball.quat.w], c: [] };
    for (const c of this.cars) f.c.push([c.currT.x, c.currT.y, c.currT.z, c.currQ.x, c.currQ.y, c.currQ.z, c.currQ.w, c.boosting ? 1 : 0, c.demolished ? 1 : 0]);
    this.record.push(f);
    if (this.record.length > this.maxRecord) this.record.shift();
  }

  beginReplay() {
    const n = Math.min(this.record.length, Math.ceil((M.replayDuration - 0.5) * CFG.sim.hz));
    const end = this.record.length - Math.ceil((M.goalCelebration - 0.8) * CFG.sim.hz);
    const start = Math.max(0, end - n);
    this.replay = { frames: this.record.slice(start, Math.max(start + 2, end)), t: 0 };
    this.state = 'replay'; this.stateTime = 0;
    this.bus.emit('replayStart', {});
  }

  stepReplay(dt) {
    const r = this.replay; if (!r) return this.endReplay();
    r.t += dt * M.replaySpeed * CFG.sim.hz;
    this.stateTime += dt;
    const i = Math.floor(r.t), fr = r.t - i;
    if (i >= r.frames.length - 1) return this.endReplay();
    const a = r.frames[i], b = r.frames[i + 1];
    this.rBall.pos.set(a.b[0], a.b[1], a.b[2]).lerp(_v.set(b.b[0], b.b[1], b.b[2]), fr);
    this.rBall.quat.set(a.b[3], a.b[4], a.b[5], a.b[6]).slerp(new THREE.Quaternion(b.b[3], b.b[4], b.b[5], b.b[6]), fr);
    this.cars.forEach((c, k) => {
      const ca = a.c[k], cb = b.c[k]; if (!ca || !cb) return;
      c.rPos ||= new THREE.Vector3(); c.rQuat ||= new THREE.Quaternion();
      c.rPos.set(ca[0], ca[1], ca[2]).lerp(_v.set(cb[0], cb[1], cb[2]), fr);
      c.rQuat.set(ca[3], ca[4], ca[5], ca[6]).slerp(new THREE.Quaternion(cb[3], cb[4], cb[5], cb[6]), fr);
      c.replayBoost = !!ca[7]; c.replayHidden = !!ca[8];
    });
  }

  skipReplay() { if (this.state === 'replay') this.endReplay(); }

  endReplay() {
    this.replay = null;
    for (const c of this.cars) { c.replayBoost = false; c.replayHidden = false; }
    this.bus.emit('replayEnd', {});
    if (this.mode === 'freeplay') { this.state = 'playing'; this.setPreset(this.preset); return; }
    if (this.overtime) return this.finish();
    this.kickoff();
  }

  dispose() { this.clearCars(); this.P.world.removeRigidBody(this.ball.body); }

  restart() { if (this.mode === 'freeplay') this.startFreePlay(); else if (this.mode === 'versus') this.startVersus(this.difficulty); }
  quitToMenu() { this.mode = 'menu'; this.state = 'idle'; this.paused = false; this.clearCars(); this.replay = null; this.ball.reset(0, BR + 0.02, 0); }
}

// ai.js — bot driver. It only ever writes a normal controls object (throttle, steer, pitch, roll,
// jump, boost, handbrake) that goes through exactly the same Car physics as the human.
import * as THREE from '../vendor/three.module.min.js';
import { CFG, toUU } from './config.js';
import { emptyControls } from './vehicle.js';

const C = CFG.car, A = CFG.arena, BR = CFG.ball.radius;
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const wrapPi = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
const _q = new THREE.Quaternion(), _qi = new THREE.Quaternion(), _v = new THREE.Vector3(), _w = new THREE.Vector3();

// Simplified ball trajectory prediction (gravity, floor/wall/ceiling bounces, goal pockets).
export function predictBall(ball, T, dt = 1 / 30) {
  const out = [];
  let px = ball.pos.x, py = ball.pos.y, pz = ball.pos.z, vx = ball.vel.x, vy = ball.vel.y, vz = ball.vel.z;
  const g = CFG.sim.gravity, e = 0.6, W = A.halfWidth - BR, L = A.halfLength - BR, H = A.height - BR;
  for (let t = 0; t < T; t += dt) {
    vy -= g * dt; px += vx * dt; py += vy * dt; pz += vz * dt;
    if (py < BR) { py = BR; if (vy < 0) { vy = -vy * e; if (Math.abs(vy) < 1.5) vy = 0; } vx *= 0.995; vz *= 0.995; }
    if (py > H) { py = H; if (vy > 0) vy = -vy * e; }
    if (px > W) { px = W; if (vx > 0) vx = -vx * e; } else if (px < -W) { px = -W; if (vx < 0) vx = -vx * e; }
    const inMouth = Math.abs(px) < A.goalHalfWidth - BR * 0.3 && py < A.goalHeight - BR * 0.5;
    const zl = inMouth ? L + A.goalDepth : L;
    if (pz > zl) { pz = zl; if (vz > 0) vz = -vz * e; } else if (pz < -zl) { pz = -zl; if (vz < 0) vz = -vz * e; }
    out.push({ t: t + dt, x: px, y: py, z: pz, vx, vy, vz });
  }
  return out;
}

export class BotDriver {
  constructor(car, difficulty = 'pro') {
    this.car = car;
    this.setDifficulty(difficulty);
    this.ctrl = emptyControls();
    this.timer = 0; this.plan = null; this.pred = []; this.predTimer = 0;
    this.seq = null;            // scripted input sequence (jump / dodge)
    this.noise = 0; this.noiseT = 0;
    this.mode = 'kickoff';
    this.target = new THREE.Vector3();
    this.wantBoost = false; this.stuckT = 0; this.reactT = 0;
    this.padTarget = null;
  }
  setDifficulty(name) { this.diff = CFG.ai.difficulties[name] || CFG.ai.difficulties.pro; this.diffName = name; }

  // world: {ball, cars, pads, matchState}
  update(dt, world) {
    const car = this.car, ball = world.ball, c = this.ctrl;
    c.throttle = 0; c.steer = 0; c.pitch = 0; c.roll = 0; c.boost = false; c.handbrake = false; c.airRoll = false;
    const jumpPrev = c.jump; c.jump = false;
    if (car.demolished || !world.active) { this.seq = null; return c; }
    this.timer += dt; this.predTimer -= dt; this.noiseT -= dt;
    if (this.noiseT <= 0) { this.noise = (Math.random() * 2 - 1) * this.diff.steerNoise; this.noiseT = 0.3 + Math.random() * 0.5; }
    if (this.predTimer <= 0) { this.pred = predictBall(ball, this.diff.predictTime); this.predTimer = this.diff.reaction * 0.7 + 0.05; }

    const sign = car.team === 0 ? -1 : 1;              // own goal z sign
    const ownGoalZ = sign * A.halfLength, enemyGoalZ = -ownGoalZ;
    const carPos = car.currT, ballPos = ball.pos;
    const grounded = car.contacts >= 2;
    const dBall = _v.copy(ballPos).sub(carPos).length();

    // ---- scripted sequences (jump, dodge, aerial)
    if (this.seq) { this.runSeq(dt, c); if (this.seq) return c; }

    if (!grounded && car.contacts === 0) { this.airLogic(dt, c, world, ownGoalZ, enemyGoalZ); return c; }

    // ---- ground logic: pick a mode
    const kickoff = world.kickoff && Math.hypot(ball.vel.x, ball.vel.z) < 0.3 && Math.abs(ballPos.x) < 0.5 && Math.abs(ballPos.z) < 0.5;
    const opp = world.cars.find((o) => o.team !== car.team && !o.demolished);
    const dOpp = opp ? _v.copy(ballPos).sub(opp.currT).length() : 99;
    const ballInOwnHalf = ballPos.z * sign > 0;
    // time to intercept search
    let best = null;
    const speedEst = this.diff.speedLimit * (car.boost > 10 ? 18 : 14);
    for (const p of this.pred) {
      if (p.y > 4.5) continue;
      const d = Math.hypot(p.x - carPos.x, p.z - carPos.z);
      if (d / speedEst < p.t + 0.1) { best = p; break; }
    }
    const threatened = this.pred.some((p) => Math.abs(p.z) > A.halfLength - 0.5 && Math.sign(p.z) === sign && Math.abs(p.x) < A.goalHalfWidth);

    let target = this.target, throttleCap = 1, useBoost = false, allowFlip = false;
    if (kickoff) {
      this.mode = 'kickoff'; target.set(ballPos.x, 0, ballPos.z); useBoost = this.diff.boostUse > 0.3; allowFlip = true;
    } else if (threatened || (ballInOwnHalf && dOpp < dBall * 0.8 && best)) {
      this.mode = 'save';
      const p = best || this.pred.find((q) => q.y < 5) || { x: ballPos.x, z: ballPos.z, y: 1 };
      // hit the ball away from our goal: approach from the goal side
      const away = _w.set(p.x, 0, p.z - enemyGoalZ).normalize();
      target.set(p.x + (ownGoalZ - p.z) * 0.0, 0, p.z).addScaledVector(_w.set(0, 0, sign * 1.0), 0.2);
      useBoost = true; allowFlip = true;
    } else if (best && (!ballInOwnHalf || dBall < dOpp)) {
      this.mode = 'attack';
      const p = best;
      // approach point behind the ball relative to the enemy goal
      const toGoal = _w.set(0 - p.x, 0, enemyGoalZ - p.z).normalize();
      const behind = 2.1;
      const approach = new THREE.Vector3(p.x - toGoal.x * behind, 0, p.z - toGoal.z * behind);
      // are we already behind the ball (aligned with the shot line)?
      const toBall = _v.set(p.x - carPos.x, 0, p.z - carPos.z);
      const aligned = toBall.lengthSq() > 1e-4 ? toBall.normalize().dot(toGoal) > 0.55 : true;
      const farFromBall = Math.hypot(p.x - carPos.x, p.z - carPos.z);
      if (aligned || farFromBall < 5) target.set(p.x, 0, p.z); else target.copy(approach);
      // keep the target inside the arena
      target.x = clamp(target.x, -A.halfWidth + 1.5, A.halfWidth - 1.5); target.z = clamp(target.z, -A.halfLength + 1.5, A.halfLength - 1.5);
      useBoost = true; allowFlip = true;
    } else {
      // defend / collect boost
      const needBoost = car.boost < 60;
      const pad = needBoost ? this.nearestPad(world, carPos) : null;
      if (pad && (!ballInOwnHalf || car.boost < 25)) { this.mode = 'boost'; target.set(pad.x, 0, pad.z); useBoost = false; }
      else {
        this.mode = 'defend';
        const gz = ownGoalZ * 0.62 + ballPos.z * 0.38;
        target.set(clamp(ballPos.x * 0.5, -6, 6), 0, gz); throttleCap = 0.9;
      }
    }

    this.drive(dt, c, target, throttleCap, useBoost, allowFlip, world);
    // jump / dodge on contact approach
    this.tryTouch(dt, c, world, allowFlip);
    // unstick: if wedged against geometry, back out for a moment
    if (Math.abs(car.forwardSpeed) < 1.0 && c.throttle > 0.5 && car.contacts > 0) this.stuckT += dt; else if (Math.abs(car.forwardSpeed) > 3) this.stuckT = 0;
    if (this.stuckT > 1.0) { this.stuckT = 0; this.seq = { type: 'reverse', t: 0, s: Math.random() < 0.5 ? -1 : 1 }; }
    // overturned on the ground
    if (car.up.y < -0.4 && car.contacts === 0 && !car.hasDodged) this.startDodge(0.0, 1.0, false, true);
    return c;
  }

  nearestPad(world, p) {
    let best = null, bd = 1e9;
    const sign = this.car.team === 0 ? -1 : 1;
    for (const pad of world.pads.pads) {
      if (!pad.active) continue;
      const d = Math.hypot(pad.x - p.x, pad.z - p.z) - (pad.large ? 14 : 0) + (pad.z * sign < 0 ? 12 : 0);
      if (d < bd) { bd = d; best = pad; }
    }
    return best;
  }

  drive(dt, c, target, throttleCap, useBoost, allowFlip, world) {
    const car = this.car;
    // local frame
    _qi.copy(car.currQ).invert();
    _v.set(target.x - car.currT.x, target.y - car.currT.y, target.z - car.currT.z).applyQuaternion(_qi);
    const dist = Math.hypot(_v.x, _v.z);
    // angle: positive when target is to the right
    const ang = Math.atan2(_v.x, -_v.z);
    const speed = car.forwardSpeed;
    const behind = Math.abs(ang) > 2.2 && dist < 14 && speed < 7;
    if (behind) { // reverse toward a target that is behind us
      c.throttle = -1; c.steer = clamp(-wrapPi(ang - Math.PI * Math.sign(ang)) * 2 + this.noise, -1, 1) * -1;
      return;
    }
    c.steer = clamp(ang * 2.4 + this.noise, -1, 1);
    c.throttle = throttleCap * (dist < 2.2 && Math.abs(speed) > 12 ? 0.3 : 1);
    if (Math.abs(ang) > 1.3 && speed > 14 && dist > 4) c.throttle = 0.2;
    if (this.diff.powerslide && Math.abs(ang) > 0.9 && speed > 9 && dist > 6) c.handbrake = true;
    const wantBoost = useBoost && car.boost > 3 && Math.abs(ang) < 0.18 && dist > 14 && toUU(speed) < 2150 && Math.random() < this.diff.boostUse + 0.1;
    c.boost = wantBoost;
    // half-flip style speed flips when far and straight
    if (allowFlip && this.diff.dodge && car.onGround && Math.abs(ang) < 0.12 && dist > 26 && toUU(speed) > 1000 && toUU(speed) < 2000 && car.boost > 5 && Math.random() < 0.01) this.startDodge(1, 0, true);
  }

  tryTouch(dt, c, world, allowFlip) {
    const car = this.car, ball = world.ball;
    if (!car.onGround) return;
    _v.copy(ball.pos).sub(car.currT);
    const d = _v.length();
    _qi.copy(car.currQ).invert();
    _w.copy(_v).applyQuaternion(_qi); // local
    const speed = Math.abs(car.forwardSpeed);
    if (!this.diff.dodge) { if (d < 3.4 && ball.pos.y > 1.6 && ball.pos.y < 3.3 && _w.z < 0) this.startJump(); return; }
    // dodge into the ball when it is close in front and low
    if (d < 4.2 && d > 1.8 && _w.z < -1.0 && Math.abs(_w.x) < 1.2 && ball.pos.y < 2.6 && speed > 6 && allowFlip) {
      this.startDodge(1, clamp(_w.x * 0.2, -0.4, 0.4), false);
    } else if (this.diff.aerial && ball.pos.y > 3.2 && ball.pos.y < 12 && d < 24 && car.boost > 25 && _w.z < -2) {
      this.seq = { type: 'aerial', t: 0, target: ball.pos.clone() };
    } else if (d < 3.6 && ball.pos.y > 1.9 && ball.pos.y < 4.5 && _w.z < 0) this.startJump();
  }

  startJump() { if (!this.seq) this.seq = { type: 'jump', t: 0 }; }
  startDodge(f, s, speedflip, righting) { if (!this.seq) this.seq = { type: 'dodge', t: 0, f, s, speedflip: !!speedflip, righting: !!righting }; }

  runSeq(dt, c) {
    const s = this.seq, car = this.car; s.t += dt;
    if (s.type === 'reverse') { c.throttle = -1; c.steer = s.s; if (s.t > 1.1) this.seq = null; return; }
    if (s.type === 'jump') { c.jump = s.t < 0.18; c.throttle = 1; if (s.t > 0.4) this.seq = null; return; }
    if (s.type === 'dodge') {
      c.throttle = 1;
      if (s.righting) { c.jump = s.t > 0.05 && s.t < 0.2; c.pitch = 0; c.steer = s.s || 1; if (s.t > 0.7) this.seq = null; return; }
      if (s.t < 0.06) c.jump = true;                    // first jump
      else if (s.t < 0.12) c.jump = false;
      else if (s.t < 0.2) { c.jump = true; c.pitch = s.f; c.steer = s.s; }  // directional second jump => dodge
      else {
        c.pitch = s.speedflip ? -1 * 0 : 0;
        if (s.speedflip && s.t < 0.55) { c.pitch = -1; c.boost = true; } // cancel the flip so the car lands flat
        if (s.t > 0.2 && s.t < 0.5) { c.boost = c.boost || s.speedflip; }
        if (s.t > 0.9) this.seq = null;
      }
      if (s.speedflip && s.t < 0.2) c.boost = true;
      return;
    }
    if (s.type === 'aerial') {
      const tgt = s.target;
      if (s.t < 0.15) { c.jump = true; return; }
      if (s.t < 0.22) { c.jump = false; return; }
      if (s.t < 0.3) { c.jump = true; c.pitch = 0; return; } // second jump (no direction): lift
      this.aim(c, _v.copy(tgt).sub(car.currT).normalize(), null);
      const toT = _v.copy(tgt).sub(car.currT);
      c.boost = _qi.copy(car.currQ) && car.fwd.dot(toT.clone().normalize()) > 0.9 && car.boost > 1;
      if (s.t > 2.4 || car.contacts > 0 && s.t > 0.5) this.seq = null;
      return;
    }
  }

  // Orient the car so its nose points along `dir` (roof toward `upHint` or away from gravity).
  aim(c, dir, upHint) {
    const car = this.car;
    _qi.copy(car.currQ).invert();
    const dl = _v.copy(dir).applyQuaternion(_qi);                    // desired nose direction in local space
    const wl = _w.copy(car.body.angvel()).applyQuaternion(_qi);       // local angular velocity
    // angle error about the local axes (small-angle): nose is local -Z
    const pitchErr = Math.atan2(dl.y, -dl.z);     // + => need nose up (rotation about +X)
    const yawErr = Math.atan2(-dl.x, -dl.z);      // + => need nose left (rotation about +Y)
    let rollErr = 0;
    const upL = (upHint ? _v.copy(upHint) : _v.set(0, 1, 0)).applyQuaternion(_qi);
    rollErr = Math.atan2(-upL.x, upL.y);          // + => roll right? rotation about +Z
    // desired local angular accel: PD
    const ax = 9 * pitchErr - 3.2 * wl.x, ay = 9 * yawErr - 3.2 * wl.y, az = 9 * rollErr - 3.2 * wl.z;
    c.pitch = clamp(-ax / C.airPitchAccel, -1, 1);
    c.steer = clamp(-ay / C.airYawAccel, -1, 1);
    c.roll = clamp(-az / C.airRollAccel, -1, 1);
    c.airRoll = false;
  }

  airLogic(dt, c, world, ownGoalZ, enemyGoalZ) {
    const car = this.car, ball = world.ball;
    if (car.bodyTouch && car.up.y < 0.5 && car.speed < 12) { this.startDodge(0, Math.random() < 0.5 ? 1 : -1, false, true); return; }
    // double jump for an extra touch if the ball is above and close (allstar only)
    // otherwise recover: face the direction of travel and land on the wheels
    const vel = _v.copy(car.vel);
    const nose = _w.set(vel.x, Math.max(vel.y * 0.2, -3), vel.z);
    if (nose.lengthSq() < 1) nose.copy(car.fwd).setY(0);
    nose.normalize();
    const ballD = ball.pos.distanceTo(car.currT);
    if (this.diff.aerial && ballD < 8 && ball.pos.y > 2.5) { nose.copy(ball.pos).sub(car.currT).normalize(); }
    this.aim(c, nose.clone(), null);
    c.throttle = 0;
    if (nose.dot(car.fwd) > 0.92 && ballD < 14 && car.boost > 5 && this.diff.aerial && ball.pos.y > 3) c.boost = true;
    // flip toward the ball in the air when it is close and still available
    if (this.diff.dodge && !car.hasDodged && ballD < 4.2 && ball.pos.y > 2.0 && car.airTime < 1.1 && car.airTime > 0.2) {
      const loc = _v.copy(ball.pos).sub(car.currT).applyQuaternion(_qi.copy(car.currQ).invert());
      if (loc.z < -0.5) { this.seq = { type: 'dodge', t: 0.1, f: 1, s: clamp(loc.x * 0.3, -0.6, 0.6), speedflip: false }; }
    }
  }
}

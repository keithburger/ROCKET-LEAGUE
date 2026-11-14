// vehicle.js — Rocket-League-style car: raycast-wheel chassis on a Rapier dynamic body.
// All drive / steering / jump / dodge / air-control logic produces *forces and torques*
// (impulses) on the rigid body; nothing teleports or sets orientation directly.
import * as THREE from '../vendor/three.module.min.js';
import { CFG, lerpTable, toUU } from './config.js';

const C = CFG.car;
const G = CFG.sim.gravity;
const WORLD_UP = new THREE.Vector3(0, 1, 0);
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const sgn = (x) => (x > 0 ? 1 : x < 0 ? -1 : 0);

// scratch objects (avoid per-step allocations)
const _q = new THREE.Quaternion(), _qi = new THREE.Quaternion();
const _v = new THREE.Vector3(), _w = new THREE.Vector3();
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3();

export function emptyControls() {
  return { throttle: 0, steer: 0, pitch: 0, roll: 0, jump: false, boost: false, handbrake: false, airRoll: false };
}

export class Car {
  constructor(physics, opts) {
    this.P = physics;
    this.team = opts.team;           // 0 blue, 1 orange
    this.index = opts.index || 0;
    this.isHuman = !!opts.isHuman;
    this.name = opts.name || (this.isHuman ? 'You' : 'Bot');
    const ch = physics.createChassis(0, 5, 0, 0);
    this.body = ch.body; this.collider = ch.collider;
    this.inertia = physics.carInertia();
    // suspension spring constants from the desired equilibrium
    const loadAcc = G + C.stickyAccel;
    this.spring = (C.mass * loadAcc / 4) / C.springEquilibrium;
    this.damper = 2 * C.springDampingRatio * Math.sqrt(this.spring * C.mass / 4);
    this.restLen = C.restHeight + C.wheelAttachY + C.springEquilibrium;
    this.rayLen = this.restLen + C.suspensionDroop;
    this.wheels = [
      { x: -C.wheelX, z: C.wheelZFront, front: true }, { x: C.wheelX, z: C.wheelZFront, front: true },
      { x: -C.wheelX, z: C.wheelZRear, front: false }, { x: C.wheelX, z: C.wheelZRear, front: false },
    ].map((w) => ({ ...w, contact: false, compression: 0, spin: 0, slip: 0, steer: 0, px: 0, py: 0, pz: 0, nx: 0, ny: 1, nz: 0, load: 0 }));
    this.ctrl = emptyControls();
    this.prevJump = false;
    this.boost = C.boostStart;
    this.unlimitedBoost = false;
    this.demolished = false; this.respawnTimer = 0;
    this.spawn = { x: 0, y: C.restHeight, z: 0, yaw: 0 };
    this.resetState();
    // interpolation snapshots
    this.prevT = new THREE.Vector3(); this.currT = new THREE.Vector3();
    this.prevQ = new THREE.Quaternion(); this.currQ = new THREE.Quaternion();
    this.vel = new THREE.Vector3(); this.angVel = new THREE.Vector3(); this.prevVel = new THREE.Vector3();
    this.speed = 0; this.prevSpeed = 0; this.forwardSpeed = 0;
    this.up = new THREE.Vector3(0, 1, 0); this.fwd = new THREE.Vector3(0, 0, -1); this.right = new THREE.Vector3(1, 0, 0);
    this.surfaceNormal = new THREE.Vector3(0, 1, 0);
    this.readState();
    this.prevT.copy(this.currT); this.prevQ.copy(this.currQ);
  }

  resetState() {
    this.contacts = 0; this.onGround = false; this.bodyTouch = false;
    this.airTime = 0; this.hasJumped = false; this.jumpTime = 99; this.jumpHolding = false; this.holdTime = 0;
    this.hasDodged = false; this.dodgeTime = 99; this.flipActive = false; this.dodgeAxis = new THREE.Vector3(); this.flipAngle = 0; this.flipTarget = 0; this.flipTotal = Math.PI * 2;
    this.dodgeF = 0; this.dodgeS = 0;
    this.grip = 1; this.boosting = false; this.supersonic = false;
    this.slipAmount = 0; this.landedEvent = 0; this.lastJumpEvent = 0; this.dodgeEvent = 0;
    this.boostSpent = 0;
    this.prevJump = false;
    this.handbrakeAmount = 0;
  }

  // Place the car at a spawn pose (used for kickoffs/resets/respawns — the only teleport).
  place(spawn) {
    this.spawn = spawn;
    const b = this.body;
    b.setEnabled(true);
    b.setTranslation({ x: spawn.x, y: spawn.y ?? C.restHeight, z: spawn.z }, true);
    b.setRotation({ x: 0, y: Math.sin(spawn.yaw / 2), z: 0, w: Math.cos(spawn.yaw / 2) }, true);
    b.setLinvel({ x: 0, y: 0, z: 0 }, true); b.setAngvel({ x: 0, y: 0, z: 0 }, true);
    b.resetForces(true); b.resetTorques(true);
    this.resetState();
    this.demolished = false;
    this.readState();
    this.prevT.copy(this.currT); this.prevQ.copy(this.currQ);
  }

  setControls(c) { this.ctrl = c; }

  readState() {
    const b = this.body;
    const t = b.translation(), r = b.rotation(), v = b.linvel(), w = b.angvel();
    this.currT.set(t.x, t.y, t.z); this.currQ.set(r.x, r.y, r.z, r.w);
    this.vel.set(v.x, v.y, v.z); this.angVel.set(w.x, w.y, w.z);
    this.up.set(0, 1, 0).applyQuaternion(this.currQ);
    this.fwd.set(0, 0, -1).applyQuaternion(this.currQ);
    this.right.set(1, 0, 0).applyQuaternion(this.currQ);
    this.speed = this.vel.length();
    this.forwardSpeed = this.vel.dot(this.fwd);
    this.supersonic = toUU(this.speed) >= toUU(C.supersonic);
  }

  snapshot() { this.prevT.copy(this.currT); this.prevQ.copy(this.currQ); }

  addBoost(a) { this.boost = Math.min(C.boostMax, this.boost + a); }

  // ------------------------------------------------------------------ step
  preStep(dt) {
    if (this.demolished) return;
    this.readState();
    const body = this.body, m = C.mass, ctrl = this.ctrl;
    this.prevSpeed = this.speed; this.prevVel.copy(this.vel);
    const q = this.currQ; _qi.copy(q).invert();
    const com = body.worldCom();
    const comX = com.x, comY = com.y, comZ = com.z;

    // -------- wheel rays
    const up = this.up, fwd = this.fwd;
    let contacts = 0;
    this.surfaceNormal.set(0, 0, 0);
    for (const w of this.wheels) {
      _a.set(w.x, C.wheelAttachY, w.z).applyQuaternion(q);
      const ax = this.currT.x + _a.x, ay = this.currT.y + _a.y, az = this.currT.z + _a.z;
      w.ax = ax; w.ay = ay; w.az = az;
      const hit = this.P.rayArenaCast(ax, ay, az, -up.x, -up.y, -up.z, this.rayLen);
      if (hit) {
        w.contact = true; w.dist = hit.toi;
        w.px = ax - up.x * hit.toi; w.py = ay - up.y * hit.toi; w.pz = az - up.z * hit.toi;
        let nx = hit.nx, ny = hit.ny, nz = hit.nz;
        if (nx * up.x + ny * up.y + nz * up.z < 0) { nx = -nx; ny = -ny; nz = -nz; }
        w.nx = nx; w.ny = ny; w.nz = nz;
        this.surfaceNormal.x += nx; this.surfaceNormal.y += ny; this.surfaceNormal.z += nz;
        contacts++;
      } else { w.contact = false; w.dist = this.rayLen; }
      w.compression = clamp(1 - (w.dist - 0.0) / this.rayLen, 0, 1);
    }
    this.contacts = contacts;
    const jumpedRecently = this.jumpTime < 0.12;
    if (contacts > 0) this.surfaceNormal.normalize(); else this.surfaceNormal.copy(up);
    const n = this.surfaceNormal;

    // body (roof/side) touching the arena counts as a landing for flip recovery
    this.bodyTouch = contacts === 0 && this.P.touchesArena(this.collider);

    // -------- ground/air bookkeeping
    this.landedEvent = 0;
    if ((contacts > 0 || this.bodyTouch) && !jumpedRecently && !(this.hasDodged && this.dodgeTime < 0.25)) {
      if (this.airTime > 0.15 || this.hasJumped || this.hasDodged) this.landedEvent = Math.min(1, this.airTime / 0.6);
      this.airTime = 0; this.hasJumped = false; this.hasDodged = false; if (contacts > 0) this.flipActive = false;
    } else if (contacts === 0 && !this.bodyTouch) this.airTime += dt;
    this.onGround = contacts > 0;
    this.jumpTime += dt;
    if (this.hasDodged) this.dodgeTime += dt;

    // -------- jump / dodge state machine (rising edge)
    const jumpPressed = ctrl.jump && !this.prevJump;
    this.prevJump = ctrl.jump;
    this.lastJumpEvent = 0; this.dodgeEvent = 0;
    const pitchIn = clamp(ctrl.pitch, -1, 1), steerIn = clamp(ctrl.steer, -1, 1);
    if (jumpPressed) {
      if (contacts > 0 && !this.hasJumped && !this.demolished) {
        // first jump — impulse along the roof normal
        const dir = up;
        this.applyLinear(dir.x * C.jumpImpulse, dir.y * C.jumpImpulse, dir.z * C.jumpImpulse);
        this.hasJumped = true; this.jumpTime = 0; this.jumpHolding = true; this.holdTime = 0; this.lastJumpEvent = 1;
        this.airTime = 0;
      } else if (!this.hasDodged && contacts === 0 &&
        ((this.hasJumped && this.jumpTime <= C.dodgeWindow) || (!this.hasJumped && this.airTime <= C.fallOffJumpWindow) || (this.bodyTouch && !this.hasJumped))) {
        this.doDodge(pitchIn, steerIn);
      }
    }
    // jump hold (variable jump height)
    if (this.jumpHolding) {
      this.holdTime += dt;
      if (!ctrl.jump || this.holdTime > C.jumpHoldTime || this.hasDodged) this.jumpHolding = false;
      else this.applyLinear(up.x * C.jumpHoldAccel * dt, up.y * C.jumpHoldAccel * dt, up.z * C.jumpHoldAccel * dt);
    }

    // -------- suspension & sticky force
    const springK = this.spring, damp = this.damper;
    const suspensionActive = !jumpedRecently || this.jumpTime > 0.04;
    for (const w of this.wheels) {
      w.load = 0;
      if (!w.contact || !suspensionActive) continue;
      const x = this.restLen - w.dist; // compression
      if (x <= 0) continue;
      _a.set(w.ax - comX, w.ay - comY, w.az - comZ);
      // velocity of attach point along normal
      _b.copy(this.angVel).cross(_a).add(this.vel);
      const vn = _b.x * w.nx + _b.y * w.ny + _b.z * w.nz;
      let f = springK * x - damp * vn;
      if (x > C.bumpStopStart) f += springK * C.bumpStopStiffness * (x - C.bumpStopStart);
      if (f < 0) f = 0;
      w.load = f;
      body.applyImpulseAtPoint({ x: w.nx * f * dt, y: w.ny * f * dt, z: w.nz * f * dt }, { x: w.ax, y: w.ay, z: w.az }, true);
    }
    const sticky = (contacts > 0 && this.jumpTime > 0.2) ? C.stickyAccel * m * (contacts / 4) * dt : 0;
    if (sticky) this.applyLinear(-n.x * sticky / m, -n.y * sticky / m, -n.z * sticky / m);

    // -------- drive model (only with wheel contact)
    const fwdT = _c.copy(fwd).addScaledVector(n, -fwd.dot(n));
    if (fwdT.lengthSq() < 1e-6) fwdT.copy(fwd); else fwdT.normalize();
    const vF = this.vel.dot(fwdT);
    const vFuu = toUU(Math.abs(vF));
    const tractionFactor = contacts >= 3 ? 1 : contacts / 3;
    const throttle = clamp(ctrl.throttle, -1, 1);
    if (contacts > 0 && !jumpedRecently) {
      let acc = 0;
      if (Math.abs(throttle) < 0.02) {
        if (Math.abs(vF) > 0.001) acc = -sgn(vF) * Math.min(C.coastAccel, Math.abs(vF) / dt);
      } else if (sgn(throttle) === sgn(vF) || Math.abs(vF) < 0.05) {
        const room = Math.max(0, 1 - vFuu / toUU(C.maxDriveSpeed));
        acc = throttle * C.throttleAccel0 * room;
      } else {
        acc = throttle * Math.min(C.brakeAccel, Math.abs(vF) / dt / Math.max(Math.abs(throttle), 0.01) * 1.0);
        // braking: opposite sign to velocity, never overshoots zero in one step
        acc = sgn(throttle) * Math.min(C.brakeAccel * Math.abs(throttle), Math.abs(vF) / dt + C.throttleAccel0 * 0.0);
      }
      acc *= tractionFactor;
      if (acc !== 0) this.applyLinear(fwdT.x * acc * dt, fwdT.y * acc * dt, fwdT.z * acc * dt);
    }

    // -------- tyres: lateral grip with friction circle, steering via front wheels
    const hb = ctrl.handbrake && contacts > 0;
    const gripTarget = hb ? C.powerslideGrip : 1;
    const gripRate = hb ? 1 / 0.04 : 1 / C.gripRecoveryTime;
    this.grip += clamp(gripTarget - this.grip, -gripRate * dt, gripRate * dt);
    const steerDeg = lerpTable(C.steerAngles, vFuu);
    const steerAngle = (steerDeg * Math.PI / 180) * clamp(ctrl.steer, -1, 1);
    let slipSum = 0, slipN = 0;
    if (contacts > 0 && !jumpedRecently) {
      for (const w of this.wheels) {
        if (!w.contact) continue;
        const nrm = _a.set(w.nx, w.ny, w.nz);
        const wf = _b.copy(fwd).addScaledVector(nrm, -fwd.dot(nrm));
        if (wf.lengthSq() < 1e-6) continue; wf.normalize();
        if (w.front) { _q.setFromAxisAngle(nrm, -steerAngle); wf.applyQuaternion(_q); }
        w.steer = w.front ? steerAngle : 0;
        const lat = _w.copy(wf).cross(nrm).normalize(); // right-hand: forward x normal = right
        // contact velocity
        const rx = w.px - comX, ry = w.py - comY, rz = w.pz - comZ;
        _v.copy(this.angVel).cross(_c.set(rx, ry, rz)).add(this.vel);
        const slip = _v.dot(lat);
        const rolling = _v.dot(wf);
        w.spin += (rolling / C.wheelRadius) * dt;
        w.slip = slip; slipSum += Math.abs(slip); slipN++;
        // application point lifted toward the COM height to limit body roll (rollInfluence)
        const hCom = (comX - w.px) * w.nx + (comY - w.py) * w.ny + (comZ - w.pz) * w.nz;
        const lift = hCom * (1 - C.rollInfluence);
        const ppx = w.px + w.nx * lift, ppy = w.py + w.ny * lift, ppz = w.pz + w.nz * lift;
        // effective mass along lat at that point
        _c.set(ppx - comX, ppy - comY, ppz - comZ).cross(lat).applyQuaternion(_qi);
        const term = _c.x * _c.x / this.inertia.x + _c.y * _c.y / this.inertia.y + _c.z * _c.z / this.inertia.z;
        const meff = 1 / (1 / m + term);
        let J = -slip * meff * C.lateralGrip * 0.32 * this.grip;
        const load = (w.load + sticky / dt / 4) || m * G / 4;
        const jMax = C.frictionCoeff * load * dt * Math.max(this.grip, 0.02);
        J = clamp(J, -jMax, jMax);
        body.applyImpulseAtPoint({ x: lat.x * J, y: lat.y * J, z: lat.z * J }, { x: ppx, y: ppy, z: ppz }, true);
      }
    } else { for (const w of this.wheels) { w.spin += (this.forwardSpeed / C.wheelRadius) * dt * 0.98; w.steer = 0; w.slip = 0; } }
    this.slipAmount = slipN ? slipSum / slipN : 0;
    // powerslide yaw assist (tighter rotation while sliding)
    if (hb && Math.abs(ctrl.steer) > 0.05 && !jumpedRecently) {
      const spdF = clamp(Math.abs(vF) / 4, 0, 1);
      const target = -clamp(ctrl.steer, -1, 1) * C.powerslideYawRate * spdF * (vF >= 0 ? 1 : -1);
      const cur = this.angVel.dot(n);
      const d = clamp(target - cur, -C.powerslideYawAccel * dt, C.powerslideYawAccel * dt);
      const Iy = this.inertia.y;
      body.applyTorqueImpulse({ x: n.x * Iy * d, y: n.y * Iy * d, z: n.z * Iy * d }, true);
    }

    // -------- boost
    this.boosting = false;
    if (ctrl.boost && (this.boost > 0 || this.unlimitedBoost) && !this.demolished) {
      this.boosting = true;
      const a = contacts > 0 ? C.boostAccelGround : C.boostAccelAir;
      _v.copy(this.vel).addScaledVector(fwd, a * dt);
      const cap = C.maxSpeed, s1 = _v.length();
      if (s1 > cap && s1 > this.speed) _v.multiplyScalar(Math.max(cap, this.speed) / s1);
      this.applyLinear(_v.x - this.vel.x, _v.y - this.vel.y, _v.z - this.vel.z);
      if (!this.unlimitedBoost) { this.boost = Math.max(0, this.boost - C.boostPerSecond * dt); this.boostSpent += C.boostPerSecond * dt; }
    }

    // -------- air control & flip torque
    const airMode = contacts <= 2 && !(contacts > 0 && !this.hasJumped && contacts >= 2 && false);
    if (airMode) {
      if (Math.abs(throttle) > 0.02 && contacts === 0) { const a = C.airThrottleAccel * throttle * dt; this.applyLinear(fwd.x * a, fwd.y * a, fwd.z * a); }
      this.airControl(dt, pitchIn, steerIn);
    } else {
      this.clampAngular(dt);
    }

    // -------- absolute speed cap
    this.vel.copy(body.linvel());
    const sp = this.vel.length();
    if (sp > C.maxSpeed) { const k = C.maxSpeed / sp - 1; this.applyLinear(this.vel.x * k, this.vel.y * k, this.vel.z * k); }
  }

  applyLinear(dvx, dvy, dvz) {
    const m = C.mass;
    this.body.applyImpulse({ x: dvx * m, y: dvy * m, z: dvz * m }, true);
  }

  // dv in local->world already; `wl` local angular velocity delta (rad/s)
  applyAngularDeltaLocal(dx, dy, dz) {
    _a.set(this.inertia.x * dx, this.inertia.y * dy, this.inertia.z * dz).applyQuaternion(this.currQ);
    this.body.applyTorqueImpulse({ x: _a.x, y: _a.y, z: _a.z }, true);
  }

  clampAngular(dt) {
    _qi.copy(this.currQ).invert();
    const w = _w.copy(this.body.angvel()).applyQuaternion(_qi);
    const s = w.length();
    if (s > C.maxAngularSpeed) { const k = C.maxAngularSpeed / s - 1; this.applyAngularDeltaLocal(w.x * k, w.y * k, w.z * k); }
  }

  airControl(dt, pitchIn, steerIn) {
    const ctrl = this.ctrl;
    _qi.copy(this.currQ).invert();
    const w = _w.copy(this.body.angvel()).applyQuaternion(_qi); // local angular velocity
    let pIn = pitchIn, yIn = steerIn, rIn = clamp(ctrl.roll, -1, 1);
    if (ctrl.airRoll) { rIn = clamp(rIn + steerIn, -1, 1); yIn = 0; }
    let dwx = 0, dwy = 0, dwz = 0, cap = C.maxAngularSpeed;
    // ---- dodge rotation: a closed-loop, single, clean revolution about the dodge axis
    if (this.flipActive && this.dodgeF !== 0 && pitchIn * this.dodgeF < -C.flipCancelThreshold && this.dodgeTime > 0.05) {
      // flip cancel: stop the rotation on the flip axis, hand control back to the player
      const ax = this.dodgeAxis, wa = w.x * ax.x + w.z * ax.z;
      dwx -= ax.x * wa * 0.85; dwz -= ax.z * wa * 0.85;
      this.flipActive = false;
    }
    if (this.flipActive) {
      const T = C.flipTime, ax = this.dodgeAxis;
      const u = this.dodgeTime / T;
      const wa = w.x * ax.x + w.z * ax.z;               // measured spin about the flip axis
      this.flipAngle += wa * dt;
      if (u >= 1 || this.flipAngle >= this.flipTotal - 0.02) {
        // finished: remove the remaining spin so the car comes out level and lands cleanly
        dwx -= ax.x * wa; dwz -= ax.z * wa;
        const ox = w.x - ax.x * wa, oz = w.z - ax.z * wa;
        dwx -= ox * 0.6; dwz -= oz * 0.6;
        this.flipActive = false;
      } else {
        // trapezoid speed profile whose integral over T equals the flip angle
        const peak = this.flipTotal / (T * (1 - C.flipRampIn / 2 - C.flipRampOut / 2));
        const shape = Math.min(1, u / C.flipRampIn) * Math.min(1, (1 - u) / C.flipRampOut);
        this.flipTarget += peak * shape * dt;
        const wCmd = Math.max(0, peak * shape + C.flipAngleGain * (this.flipTarget - this.flipAngle));
        dwx += ax.x * (wCmd - wa); dwz += ax.z * (wCmd - wa);
        // kill stray pitch/roll spin that is not on the flip axis
        const ox = w.x - ax.x * wa, oz = w.z - ax.z * wa, kd = 1 - Math.exp(-C.flipOffAxisDamp * dt);
        dwx -= ox * kd; dwz -= oz * kd;
        // vertical stall right after the dodge
        if (this.dodgeTime < C.flipVerticalDampTime) {
          const vy = this.body.linvel().y;
          this.applyLinear(0, -vy * C.flipVerticalDamp * (dt / C.flipVerticalDampTime), 0);
        }
        pIn = 0; rIn = 0;                              // pitch/roll are owned by the flip; yaw stays live
        cap = C.flipMaxAngularSpeed;
        dwy += (-yIn * C.airYawAccel - C.airYawDamp * w.y * (1 - Math.abs(yIn))) * dt;
        const nx = w.x + dwx, ny = w.y + dwy, nz = w.z + dwz, sp = Math.hypot(nx, ny, nz);
        if (sp > cap) { const k = cap / sp; dwx = nx * k - w.x; dwy = ny * k - w.y; dwz = nz * k - w.z; }
        this.applyAngularDeltaLocal(dwx, dwy, dwz);
        return;
      }
    }
    dwx += (-pIn * C.airPitchAccel - C.airPitchDamp * w.x * (1 - Math.abs(pIn))) * dt;
    dwy += (-yIn * C.airYawAccel - C.airYawDamp * w.y * (1 - Math.abs(yIn))) * dt;
    dwz += (-rIn * C.airRollAccel - C.airRollDamp * w.z * (1 - Math.abs(rIn))) * dt;
    // angular speed cap
    const nx = w.x + dwx, ny = w.y + dwy, nz = w.z + dwz;
    const s = Math.hypot(nx, ny, nz);
    if (s > cap) { const k = cap / s; dwx = nx * k - w.x; dwy = ny * k - w.y; dwz = nz * k - w.z; }
    this.applyAngularDeltaLocal(dwx, dwy, dwz);
  }

  doDodge(pitchIn, steerIn) {
    const mag = Math.hypot(pitchIn, steerIn);
    this.hasDodged = true; this.dodgeTime = 0; this.jumpHolding = false; this.dodgeEvent = 1;
    const up = this.up;
    if (mag < (this.dodgeDeadzone ?? C.dodgeDeadzone)) {
      // second jump without direction: another vertical impulse
      if (up.y < -0.2 && this.bodyTouch) { // overturned on the ground: righting jump along world-up
        this.applyLinear(0, C.jumpImpulse, 0);
        this.startFlip(0, 0, -1, Math.PI); this.dodgeF = 0; this.dodgeS = 1;
      } else this.applyLinear(up.x * C.jumpImpulse, up.y * C.jumpImpulse, up.z * C.jumpImpulse);
      return;
    }
    const f = pitchIn / mag, s = steerIn / mag; // diagonal normalisation
    if (up.y < -0.2 && this.bodyTouch) this.applyLinear(0, C.jumpImpulse, 0); // push off the roof so the car can rotate
    this.dodgeF = f; this.dodgeS = s;
    const flatF = _a.copy(this.fwd).setY(0);
    if (flatF.lengthSq() < 0.04) flatF.copy(this.up).multiplyScalar(-1).setY(0); // near-vertical: use roof direction
    if (flatF.lengthSq() < 1e-6) flatF.set(0, 0, -1);
    flatF.normalize();
    const flatR = _b.copy(flatF).cross(WORLD_UP).normalize();
    const vF = this.vel.dot(this.fwd);
    const vr = clamp(this.speed / C.maxSpeed, 0, 1);
    const bonus = (f !== 0 && sgn(f) === sgn(vF) && Math.abs(vF) > 1) ? 1 + C.dodgeSpeedBonus * vr : 1;
    const dvF = f * C.dodgeImpulse * bonus, dvS = s * C.dodgeImpulse;
    this.applyLinear(flatF.x * dvF + flatR.x * dvS, flatF.y * dvF + flatR.y * dvS, flatF.z * dvF + flatR.z * dvS);
    // flip axis in the car's local frame: nose-down = -X rotation, roll-right = -Z rotation
    const overturned = up.y < -0.2 && this.bodyTouch;
    this.startFlip(-f, 0, -s, overturned ? Math.PI : Math.PI * 2);
  }

  startFlip(x, y, z, total) {
    this.dodgeAxis.set(x, y, z).normalize();
    this.flipActive = true; this.flipAngle = 0; this.flipTarget = 0; this.flipTotal = total;
  }

  // Demolition
  demolish() {
    this.demolished = true; this.respawnTimer = C.demoRespawn;
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true); this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.body.setEnabled(false);
  }

  postStep() { this.readState(); }
}

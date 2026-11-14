// ball.js — dynamic sphere + Rocket-League-style car/ball impact model.
// Rapier resolves the base contact (restitution/friction/penetration). On top of that, a dedicated
// velocity-dependent impulse is added to the ball (applied once per contact, after the solver):
//   dv = n * |v_rel| * f(|v_rel|)      with n built from the hit point in the car's frame,
//   whose vertical component is scaled by 0.35 (hood/roof hits pop less than nose hits).
import * as THREE from '../vendor/three.module.min.js';
import { CFG, lerpTable, toUU } from './config.js';

const B = CFG.ball, C = CFG.car;
const _q = new THREE.Quaternion(), _qi = new THREE.Quaternion();
const _bp = new THREE.Vector3(), _local = new THREE.Vector3(), _cp = new THREE.Vector3(), _d = new THREE.Vector3();
const _vr = new THREE.Vector3(), _vc = new THREE.Vector3(), _n = new THREE.Vector3(), _tmp = new THREE.Vector3();
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

export class Ball {
  constructor(physics) {
    this.P = physics;
    const b = physics.createBall(0, B.radius + 0.01, 0);
    this.body = b.body; this.collider = b.collider;
    this.radius = B.radius;
    this.pos = new THREE.Vector3(); this.vel = new THREE.Vector3(); this.angVel = new THREE.Vector3();
    this.quat = new THREE.Quaternion();
    this.prevPos = new THREE.Vector3(); this.prevQuat = new THREE.Quaternion();
    this.pending = [];           // pre-step predicted contacts
    this.hitEvents = [];         // {car, power, point} produced this step (audio / vfx)
    this.lastHitCar = null;
    this.lastTouchTeam = -1;
    this.cool = new Map();
    this.readState(); this.prevPos.copy(this.pos); this.prevQuat.copy(this.quat);
  }

  reset(x, y, z, vx = 0, vy = 0, vz = 0) {
    const b = this.body;
    b.setTranslation({ x, y, z }, true); b.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
    b.setLinvel({ x: vx, y: vy, z: vz }, true); b.setAngvel({ x: 0, y: 0, z: 0 }, true);
    b.resetForces(true); b.resetTorques(true);
    this.lastHitCar = null; this.lastTouchTeam = -1; this.pending.length = 0; this.cool.clear();
    this.readState(); this.prevPos.copy(this.pos); this.prevQuat.copy(this.quat);
  }

  readState() {
    const t = this.body.translation(), r = this.body.rotation(), v = this.body.linvel(), w = this.body.angvel();
    this.pos.set(t.x, t.y, t.z); this.quat.set(r.x, r.y, r.z, r.w);
    this.vel.set(v.x, v.y, v.z); this.angVel.set(w.x, w.y, w.z);
  }

  snapshot() { this.prevPos.copy(this.pos); this.prevQuat.copy(this.quat); }

  // closest point on the car's hitbox (world space) to the ball centre; returns distance
  static closest(car, ballPos, outCp, outLocal) {
    _qi.copy(car.currQ).invert();
    outLocal.copy(ballPos).sub(car.currT).applyQuaternion(_qi);
    outCp.set(clamp(outLocal.x, -C.halfWidth, C.halfWidth), clamp(outLocal.y, -C.halfHeight, C.halfHeight), clamp(outLocal.z, -C.halfLength, C.halfLength));
    const inside = Math.abs(outLocal.x) < C.halfWidth && Math.abs(outLocal.y) < C.halfHeight && Math.abs(outLocal.z) < C.halfLength;
    _d.copy(outLocal).sub(outCp);
    let dist = _d.length();
    if (inside) dist = 0;
    outCp.applyQuaternion(car.currQ).add(car.currT); // to world
    return dist;
  }

  // ---- before the physics step: find contacts that are about to happen
  beginStep(cars, dt) {
    this.readState();
    for (const car of cars) {
      if (car.demolished) continue;
      const dist = Ball.closest(car, this.pos, _cp, _local);
      _tmp.copy(_cp).sub(car.currT);
      _vc.copy(car.angVel).cross(_tmp).add(car.vel);
      _vr.copy(this.vel).sub(_vc);
      _n.copy(this.pos).sub(_cp);
      const l = _n.length();
      if (l < 1e-6) continue;
      _n.multiplyScalar(1 / l);
      const closing = -_vr.dot(_n);
      const gap = dist - this.radius;
      if (closing > 0.3 && gap < closing * dt * 2.5 + 0.03) {
        const e = this.pending.find((p) => p.car === car);
        if (e) { if (closing > e.closing) { e.closing = closing; e.relSpeed = _vr.length(); } }
        else this.pending.push({ car, relSpeed: _vr.length(), closing, age: 0 });
      }
    }
  }

  // ---- after the physics step: once the solver has resolved the contact, add the extra impulse
  endStep(cars, dt, time) {
    this.readState();
    this.hitEvents.length = 0;
    for (let i = this.pending.length - 1; i >= 0; i--) {
      const pd = this.pending[i], car = pd.car;
      pd.age++;
      if (car.demolished || pd.age > 4) { this.pending.splice(i, 1); continue; }
      car.readState();
      const dist = Ball.closest(car, this.pos, _cp, _local);
      _tmp.copy(_cp).sub(car.currT);
      _vc.copy(car.angVel).cross(_tmp).add(car.vel);
      _vr.copy(this.vel).sub(_vc);
      _n.copy(this.pos).sub(_cp); const l = _n.length(); if (l < 1e-6) continue; _n.multiplyScalar(1 / l);
      const closingNow = -_vr.dot(_n);
      const touching = dist - this.radius < 0.08;
      if (!(touching && closingNow < Math.max(0.35 * pd.closing, 0.5))) continue; // solver has not resolved it yet
      this.pending.splice(i, 1);
      const last = this.cool.get(car) ?? -1;
      if (time - last < B.hitCooldown) continue;
      // hit direction in the car frame, vertical component squashed
      _local.copy(this.pos).sub(car.currT);
      _qi.copy(car.currQ).invert();
      _local.applyQuaternion(_qi);
      _local.y *= B.hitVerticalScale;
      if (_local.lengthSq() < 1e-8) continue;
      _local.normalize().applyQuaternion(car.currQ);
      const rel = pd.relSpeed;
      const extra = rel * lerpTable(B.hitCurve, toUU(rel));
      this.body.applyImpulse({ x: _local.x * extra * B.mass, y: _local.y * extra * B.mass, z: _local.z * extra * B.mass }, true);
      this.cool.set(car, time);
      this.lastHitCar = car; this.lastTouchTeam = car.team;
      this.hitEvents.push({ car, power: rel, point: _cp.clone(), normal: _local.clone() });
    }
    // caps (speed 6000 uu/s, angular 6 rad/s)
    const v = this.body.linvel(); const sp = Math.hypot(v.x, v.y, v.z);
    if (sp > B.maxSpeed) { const k = B.maxSpeed / sp; this.body.setLinvel({ x: v.x * k, y: v.y * k, z: v.z * k }, true); }
    const w = this.body.angvel(); const ws = Math.hypot(w.x, w.y, w.z);
    if (ws > B.maxAngularSpeed) { const k = B.maxAngularSpeed / ws; this.body.setAngvel({ x: w.x * k, y: w.y * k, z: w.z * k }, true); }
    this.readState();
  }
}

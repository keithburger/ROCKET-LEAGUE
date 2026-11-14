// camera.js — chase camera. Always world-up (never rolls), spring-smoothed yaw/pitch/distance,
// ball cam keeps the ball in frame (it has priority over the car), car cam follows the car's
// heading on the ground and its travel direction in the air (so flips don't whip the view).
import * as THREE from '../vendor/three.module.min.js';
import { CFG } from './config.js';

const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const wrap = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
const DEG = Math.PI / 180;
const A = CFG.arena;
const _a = new THREE.Vector3(), _b = new THREE.Vector3();

// Critically damped spring on a scalar (frame-rate independent, no overshoot).
function spring(state, target, omega, dt, maxVel = Infinity, angular = false) {
  const change = angular ? wrap(state.x - target) : state.x - target;   // SmoothDamp formulation
  const ex = Math.exp(-omega * dt);
  const temp = (state.v + omega * change) * dt;
  let v = (state.v - omega * temp) * ex;
  let step = -change + (change + temp) * ex;                             // movement this frame
  const lim = maxVel * dt;
  if (Math.abs(step) > lim) { step = Math.sign(step) * lim; v = clamp(v, -maxVel, maxVel); }
  state.x = angular ? wrap(state.x + step) : state.x + step; state.v = v;
}

export class GameCamera {
  constructor(camera, physics) {
    this.cam = camera; this.P = physics;
    this.settings = { ...CFG.camera };
    this.yaw = { x: 0, v: 0 }; this.pitch = { x: -0.07, v: 0 }; this.dist = { x: 2.7, v: 0 }; this.lift = { x: 0, v: 0 };
    this.lookYaw = { x: 0, v: 0 }; this.lookPitch = { x: 0, v: 0 };
    this.headingYaw = 0;                 // last valid target heading
    this.aspect = 16 / 9; this.vfov = 1;
    this.initialized = false; this.shake = 0;
    this.replayPos = new THREE.Vector3();
    this.setAspect(this.aspect);
  }

  setAspect(a) { this.aspect = a; this.applyFov(0); }
  applyFov(bonusDeg) {
    const h = (this.settings.hFov + bonusDeg) * DEG;
    const v = 2 * Math.atan(Math.tan(h / 2) / this.aspect);
    this.vfov = clamp(v, 20 * DEG, 120 * DEG);
    this.cam.fov = this.vfov / DEG; this.cam.aspect = this.aspect; this.cam.updateProjectionMatrix();
  }

  // yaw angle (Three.js convention: rotation.y) that looks along horizontal vector (dx, dz)
  static yawOf(dx, dz) { return Math.atan2(-dx, -dz); }

  // ctx: {dt, carPos, carFwd, carVel, onGround, speed, boosting, ballPos, ballCam, look:{x,y}, hasCar}
  update(ctx) {
    const S = this.settings, dt = Math.min(ctx.dt, 0.05);
    const car = ctx.carPos, ball = ctx.ballPos;
    // ---- 1. target heading (horizontal only: the camera never rolls)
    let target = this.headingYaw;
    const toBall = _a.set(ball.x - car.x, 0, ball.z - car.z);
    const ballH = toBall.length();
    if (ctx.ballCam) {
      if (ballH > 1.2) target = GameCamera.yawOf(toBall.x, toBall.z);
    } else {
      const f = ctx.carFwd, fh = Math.hypot(f.x, f.z), v = ctx.carVel, vh = Math.hypot(v.x, v.z);
      if (ctx.onGround && fh > 0.35) target = GameCamera.yawOf(f.x, f.z);             // driving: car heading
      else if (vh > 4) target = GameCamera.yawOf(v.x, v.z);                          // air / steep wall: travel direction
      else if (fh > 0.35 && ctx.onGround) target = GameCamera.yawOf(f.x, f.z);
    }
    this.headingYaw = target;
    if (!this.initialized) { this.yaw.x = target; this.yaw.v = 0; }
    const yawOmega = ctx.ballCam ? 4 + S.stiffness * 8 : 3 + S.stiffness * 10;
    spring(this.yaw, target, yawOmega, dt, S.swivelSpeed * 1.4, true);

    // ---- 2. distance / height (speed framing; pull back when the ball is high and close)
    const sr = clamp(ctx.speed / CFG.car.maxSpeed, 0, 1);
    let dist = S.distance * 0.01 * (1 + 0.12 * sr);
    let height = S.height * 0.01;
    const ballAbove = ball.y - car.y;
    if (ctx.ballCam && ballAbove > 1 && ballH < 10) { const k = clamp((ballAbove - 1) / 6, 0, 1) * clamp(1 - ballH / 10, 0, 1); dist *= 1 + 0.5 * k; height *= 1 + 0.6 * k; }
    if (!this.initialized) { this.dist.x = dist; this.lift.x = height; }
    spring(this.dist, dist, 4, dt); spring(this.lift, height, 4, dt);

    // ---- 3. free look
    const lk = ctx.look || { x: 0, y: 0 };
    spring(this.lookYaw, -(lk.x || 0) * S.freeLookMax, S.swivelSpeed * 2, dt);
    spring(this.lookPitch, -(lk.y || 0) * 0.7, S.swivelSpeed * 2, dt);

    // ---- 4. position: behind the pivot along the smoothed heading, world-up height
    const yaw = this.yaw.x + this.lookYaw.x;
    const dirX = -Math.sin(yaw), dirZ = -Math.cos(yaw);       // horizontal viewing direction
    const pivot = _b.set(car.x, car.y + 0.25, car.z);
    let px = pivot.x - dirX * this.dist.x, py = pivot.y + this.lift.x, pz = pivot.z - dirZ * this.dist.x;
    // occlusion: pull in along pivot->camera if the arena is in the way
    let rx = px - pivot.x, ry = py - pivot.y, rz = pz - pivot.z; const rl = Math.hypot(rx, ry, rz);
    rx /= rl; ry /= rl; rz /= rl;
    const hit = this.P.rayArenaCast(pivot.x, pivot.y, pivot.z, rx, ry, rz, rl + 0.4);
    // walls and the upper curves are see-through: only the floor and floor ramps occlude
    if (hit && hit.ny > 0.45) { const d = Math.max(0.8, hit.toi - 0.4); if (d < rl) { px = pivot.x + rx * d; py = pivot.y + ry * d; pz = pivot.z + rz * d; } }
    // hard containment inside the arena box (and the goal pocket)
    const contain = () => {
      const m = 0.5, out = 3.5;                     // up to 3.5 m behind the glass walls
      py = clamp(py, 0.35, A.height - m);
      px = clamp(px, -A.halfWidth - out, A.halfWidth + out);
      pz = clamp(pz, -A.halfLength - A.goalDepth, A.halfLength + A.goalDepth);
    };
    contain();
    // if walls squeezed the camera onto the car (wall/ceiling driving), swing it out toward open space
    const minD = 1.9;
    let dx = px - pivot.x, dy = py - pivot.y, dz = pz - pivot.z;
    if (Math.hypot(dx, dy, dz) < minD) {
      let cx = -pivot.x, cy = 7 - pivot.y, cz = -pivot.z; const cl = Math.hypot(cx, cy, cz) || 1;
      dx += (cx / cl) * minD; dy += (cy / cl) * minD * 0.6 + 0.3; dz += (cz / cl) * minD;
      const dl = Math.hypot(dx, dy, dz) || 1;
      const tx = pivot.x + (dx / dl) * minD * 1.2, ty = pivot.y + (dy / dl) * minD * 1.2, tz = pivot.z + (dz / dl) * minD * 1.2;
      if (!this.swing) this.swing = { x: px, y: py, z: pz };
      px = tx; py = ty; pz = tz; contain();
    }
    // smooth any containment-induced jumps in position
    if (!this.smoothPos || !this.initialized) this.smoothPos = new THREE.Vector3(px, py, pz);
    const kp = 1 - Math.exp(-dt * 14);
    this.smoothPos.x += (px - this.smoothPos.x) * kp; this.smoothPos.y += (py - this.smoothPos.y) * kp; this.smoothPos.z += (pz - this.smoothPos.z) * kp;
    // the smoothing lags behind fast cars: never let it lag more than 0.6 m from the exact position
    { const ex = px - this.smoothPos.x, ey = py - this.smoothPos.y, ez = pz - this.smoothPos.z, el = Math.hypot(ex, ey, ez);
      if (el > 0.6) { const k = (el - 0.6) / el; this.smoothPos.x += ex * k; this.smoothPos.y += ey * k; this.smoothPos.z += ez * k; } }
    px = this.smoothPos.x; py = this.smoothPos.y; pz = this.smoothPos.z;

    // ---- 5. pitch: keep the ball (priority) and the car inside the vertical field of view
    const halfV = this.vfov / 2 - 6 * DEG;
    const elev = (x, y, z) => Math.atan2(y - py, Math.max(0.3, Math.hypot(x - px, z - pz)));
    const eCar = elev(car.x, car.y, car.z), eBall = elev(ball.x, ball.y, ball.z);
    const pref = S.angle * DEG;
    let pitchT;
    if (ctx.ballCam) {
      const lo = Math.max(eBall, eCar) - halfV, hi = Math.min(eBall, eCar) + halfV;
      pitchT = lo <= hi ? clamp(pref, lo, hi) : clamp(pref, eBall - halfV, eBall + halfV);
    } else pitchT = clamp(pref, eCar - halfV, eCar + halfV);
    pitchT = clamp(pitchT, -65 * DEG, 60 * DEG);
    if (!this.initialized) this.pitch.x = pitchT;
    spring(this.pitch, pitchT, 7, dt, 3);

    // ---- 6. apply (Euler YXZ with zero roll => always right side up)
    this.cam.position.set(px, py, pz);
    if (this.shake > 0) {
      this.cam.position.x += (Math.random() - 0.5) * this.shake * 0.25; this.cam.position.y += (Math.random() - 0.5) * this.shake * 0.25;
      this.shake = Math.max(0, this.shake - dt * 2.5);
    }
    this.cam.up.set(0, 1, 0);
    this.cam.rotation.set(clamp(this.pitch.x + this.lookPitch.x, -80 * DEG, 80 * DEG), yaw, 0, 'YXZ');
    this.applyFov(sr * 4 + (ctx.boosting ? 2 : 0));
    this.initialized = true;
  }

  // broadcast-style camera for goal celebrations and replays
  updateReplay(dt, focus, awayFrom) {
    const k = 1 - Math.exp(-dt * 2.5);
    _a.copy(focus).sub(awayFrom); _a.y = 0; if (_a.lengthSq() < 1e-4) _a.set(0, 0, 1); _a.normalize();
    _b.copy(focus).addScaledVector(_a, 14); _b.y = clamp(focus.y + 5.5, 2, A.height - 1);
    _b.x = clamp(_b.x, -A.halfWidth + 1, A.halfWidth - 1); _b.z = clamp(_b.z, -A.halfLength + 1, A.halfLength - 1);
    if (!this.initialized) { this.replayPos.copy(_b); this.initialized = true; }
    this.replayPos.lerp(_b, k);
    this.cam.position.copy(this.replayPos); this.cam.up.set(0, 1, 0); this.cam.lookAt(focus);
    this.applyFov(-25);
  }

  orbit(t, radius = 55, y = 22) {
    this.cam.position.set(Math.cos(t * 0.15) * radius, y, Math.sin(t * 0.15) * radius * 1.4);
    this.cam.up.set(0, 1, 0); this.cam.lookAt(0, 3, 0); this.applyFov(-40); this.initialized = false;
  }
}

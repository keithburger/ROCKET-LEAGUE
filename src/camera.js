// camera.js — car-follow and ball-tracking chase camera with spring smoothing,
// speed-dependent framing, collision avoidance and free-look.
import * as THREE from '../vendor/three.module.min.js';
import { CFG, toUU } from './config.js';

const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _d = new THREE.Vector3();
const _m = new THREE.Matrix4(), _qq = new THREE.Quaternion(), _qI = new THREE.Quaternion();

export class GameCamera {
  constructor(camera, physics) {
    this.cam = camera; this.P = physics;
    this.settings = { ...CFG.camera };
    this.up = new THREE.Vector3(0, 1, 0);
    this.heading = new THREE.Vector3(0, 0, -1);   // smoothed viewing direction (unit)
    this.carHeading = new THREE.Vector3(0, 0, -1);
    this.pos = new THREE.Vector3(0, 5, 10);
    this.ballBlend = 1; this.ballCamActive = true;
    this.lookYaw = 0; this.lookPitch = 0;
    this.distScale = 1; this.fovBonus = 0;
    this.aspect = 16 / 9;
    this.replayPos = new THREE.Vector3(); this.initialized = false;
    this.shake = 0;
    this.setAspect(this.aspect);
  }

  setAspect(a) {
    this.aspect = a;
    this.applyFov(0);
  }
  applyFov(bonusDeg) {
    const h = (this.settings.hFov + bonusDeg) * Math.PI / 180;
    const v = 2 * Math.atan(Math.tan(h / 2) / this.aspect);
    this.cam.fov = clamp(v * 180 / Math.PI, 20, 120); this.cam.aspect = this.aspect; this.cam.updateProjectionMatrix();
  }

  snap(carPos, carFwd) {
    this.heading.copy(carFwd).setY(0).normalize(); this.carHeading.copy(this.heading);
    this.initialized = false;
  }

  // ctx: {dt, carPos, carQuat, carFwd, carUp, surfaceNormal, onSurface, speed, boosting, ballPos, ballCam, look:{x,y}, hasCar}
  update(ctx) {
    const S = this.settings, dt = Math.min(ctx.dt, 0.1);
    const k = (rate) => 1 - Math.exp(-rate * dt);
    const stiff = 3 + S.stiffness * 14;      // spring follow rate
    // ---- smoothed up vector (aligns to the surface when wall driving, level in the air)
    _a.copy(ctx.onSurface ? ctx.surfaceNormal : new THREE.Vector3(0, 1, 0));
    if (ctx.onSurface && ctx.surfaceNormal.y < -0.5) _a.set(0, 1, 0); // ceiling: keep the world up for readability
    this.up.lerp(_a, k(4)).normalize();
    const up = this.up;
    // ---- car heading: forward flattened onto the surface plane
    _b.copy(ctx.carFwd).addScaledVector(up, -ctx.carFwd.dot(up));
    // when the nose points steeply up/down (flips, loops) the flattened heading is ill-defined: freeze it
    const steep = Math.abs(ctx.carFwd.dot(up));
    const w = clamp((0.8 - steep) / 0.3, 0, 1);
    if (_b.lengthSq() > 1e-4) _b.normalize(); else _b.copy(this.carHeading);
    _b.lerp(this.carHeading, 1 - w).normalize();
    // spring toward the car's heading (frame-rate independent)
    const ca = this.carHeading.angleTo(_b);
    if (ca > 1e-4) {
      const step = Math.min(ca * k(stiff), 6.5 * dt);          // spring, with a swivel-rate limit (rad/s)
      _qq.setFromUnitVectors(this.carHeading, _b);
      _qq.slerp(_qI, 1 - Math.min(1, step / ca));              // fraction of the full rotation to apply
      this.carHeading.applyQuaternion(_qq);
    }
    this.carHeading.addScaledVector(up, -this.carHeading.dot(up)).normalize();
    // ---- ball direction
    let ballDir = _d.copy(ctx.ballPos).sub(ctx.carPos);
    const ballDist = ballDir.length();
    const useBall = ctx.ballCam && ctx.hasCar && ballDist > 0.5;
    this.ballBlend += ((useBall ? 1 : 0) - this.ballBlend) * k(S.transitionSpeed);
    ballDir.multiplyScalar(1 / Math.max(ballDist, 1e-4));
    // elevation limit for ball cam
    const maxP = Math.sin(S.ballCamPitchMax * Math.PI / 180);
    if (ballDir.y > maxP) { ballDir.y = maxP; ballDir.normalize(); }
    if (ballDir.y < -0.5) { ballDir.y = -0.5; ballDir.normalize(); }
    // blend heading target
    _a.copy(this.carHeading).multiplyScalar(1 - this.ballBlend).addScaledVector(ballDir, this.ballBlend);
    if (_a.lengthSq() < 1e-4) _a.copy(this.carHeading);
    _a.normalize();
    const hRate = this.ballBlend > 0.5 ? stiff * 1.8 : stiff * 3;
    this.heading.lerp(_a, k(hRate)).normalize();
    // ---- free look offsets
    const lk = ctx.look;
    const ty = (lk.x || 0) * S.freeLookMax, tp = (lk.y || 0) * 0.8;
    const lr = (Math.abs(lk.x) + Math.abs(lk.y)) > 0.01 ? S.swivelSpeed * 2.2 : S.swivelSpeed * 1.6;
    this.lookYaw += (ty - this.lookYaw) * k(lr); this.lookPitch += (tp - this.lookPitch) * k(lr);
    const h = _c.copy(this.heading);
    _m.makeRotationAxis(up, -this.lookYaw); h.applyMatrix4(_m);
    const right = _b.copy(h).cross(up).normalize();
    _m.makeRotationAxis(right, -this.lookPitch); h.applyMatrix4(_m);
    // ---- framing (speed dependent)
    const sr = clamp(ctx.speed / CFG.car.maxSpeed, 0, 1);
    const dist = S.distance * 0.01 * (1 + 0.10 * sr + (ctx.boosting ? 0.04 : 0));
    const height = S.height * 0.01;
    _a.copy(ctx.carPos).addScaledVector(up, 0.25);   // focus a little above the hitbox centre
    const desired = _d.copy(_a).addScaledVector(h, -dist).addScaledVector(up, height);
    // ---- collision avoidance against the arena
    _b.copy(desired).sub(_a); const len = _b.length(); _b.multiplyScalar(1 / len);
    const hit = this.P.rayArenaCast(_a.x, _a.y, _a.z, _b.x, _b.y, _b.z, len + 0.4);
    let allowed = len;
    if (hit) allowed = Math.max(1.0, hit.toi - 0.35);
    this.distScale += ((allowed / len) - this.distScale) * k(allowed / len < this.distScale ? 18 : 3);
    this.distScale = Math.min(this.distScale, allowed / len);
    desired.copy(_a).addScaledVector(_b, len * this.distScale);
    if (!this.initialized) { this.pos.copy(desired); this.initialized = true; }
    this.pos.copy(desired);
    this.cam.position.copy(this.pos);
    if (this.shake > 0) { this.cam.position.x += (Math.random() - 0.5) * this.shake * 0.3; this.cam.position.y += (Math.random() - 0.5) * this.shake * 0.3; this.shake = Math.max(0, this.shake - dt * 2.5); }
    // ---- view direction: slightly pitched down by the camera angle (-4 deg); ball cam looks at the ball
    const angle = S.angle * Math.PI / 180;
    const viewDir = _b.copy(h);
    const rightV = _a.copy(h).cross(up).normalize();
    _m.makeRotationAxis(rightV, angle); viewDir.applyMatrix4(_m);
    this.cam.up.copy(up);
    _d.copy(this.cam.position).add(viewDir);
    this.cam.lookAt(_d);
    this.applyFov(sr * 4 + (ctx.boosting ? 2 : 0));
  }

  // simple broadcast-style camera for replays and menus
  updateReplay(dt, focus, awayFrom) {
    const k = 1 - Math.exp(-dt * 2.5);
    _a.copy(focus).sub(awayFrom); _a.y = 0; if (_a.lengthSq() < 1e-4) _a.set(0, 0, 1); _a.normalize();
    _b.copy(focus).addScaledVector(_a, 14).add(_c.set(0, 5.5, 0));
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

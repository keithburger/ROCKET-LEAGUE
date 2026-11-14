// Camera quality: no roll ever, ball kept in frame in ball cam, smooth motion (bounded turn per frame),
// across slaloms, powerslides, flips, aerial spins and wall driving, at 60 and 144 fps.
import * as THREE from '../vendor/three.module.min.js';
import { Physics } from '../src/physics.js';
import { buildArenaGeometry } from '../src/arena.js';
import { Match, Bus } from '../src/match.js';
import { GameCamera } from '../src/camera.js';
import { emptyControls } from '../src/vehicle.js';
const geo = buildArenaGeometry(); const P = await Physics.create(geo);
const mk = (o) => Object.assign(emptyControls(), o);
const script = (t) => {
  if (t < 3) return mk({ throttle: 1, boost: true, steer: Math.sin(t * 3) });          // slalom
  if (t < 5) return mk({ throttle: 1, boost: true, steer: 1, handbrake: t > 3.5 });    // powerslide turn
  if (t < 8) return mk({ throttle: 1, boost: true });                                 // to the wall / up it
  if (t < 8.1) return mk({ jump: true });
  if (t < 8.3) return mk({});
  if (t < 8.35) return mk({ jump: true, pitch: 1 });                                  // front flip
  if (t < 9.5) return mk({});
  if (t < 9.6) return mk({ jump: true });
  if (t < 12) return mk({ boost: true, pitch: Math.sin(t * 4), roll: Math.cos(t * 3), steer: Math.sin(t * 2) }); // aerial spins
  return mk({ throttle: 1, boost: true, steer: Math.sin(t) });
};
let fails = 0;
for (const FPS of [60, 144]) for (const ballCam of [true, false]) {
  const m = new Match(P, geo, {}, new Bus()); m.startFreePlay(); m.setPreset('aerial');
  const cam = new GameCamera(new THREE.PerspectiveCamera(70, 16 / 9, 0.1, 600), P); cam.setAspect(16 / 9);
  let prevDir = null, maxTurn = 0, maxRoll = 0, inView = 0, carView = 0, frames = 0, bad = 0;
  const dir = new THREE.Vector3(), frustum = new THREE.Frustum(), pm = new THREE.Matrix4(), sph = new THREE.Sphere();
  for (let i = 0; i < 16 * FPS; i++) {
    const t = i / FPS; m.humanCtrl = script(t); m.frame(1 / FPS);
    const h = m.human, f = new THREE.Vector3(0, 0, -1).applyQuaternion(h.rQuat);
    cam.update({ dt: 1 / FPS, carPos: h.rPos, carFwd: f, carVel: h.vel, onGround: h.contacts >= 3, speed: h.speed, boosting: h.boosting, ballPos: m.rBall.pos, ballCam, look: { x: 0, y: 0 }, hasCar: true });
    const c = cam.cam; c.updateMatrixWorld(); c.getWorldDirection(dir);
    if (![c.position.x, c.position.y, c.position.z, dir.x].every(isFinite)) bad++;
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(c.quaternion); maxRoll = Math.max(maxRoll, Math.abs(right.y));
    if (prevDir && i > FPS * 0.5) maxTurn = Math.max(maxTurn, prevDir.angleTo(dir) * 180 / Math.PI * (FPS / 60));
    pm.multiplyMatrices(c.projectionMatrix, c.matrixWorldInverse); frustum.setFromProjectionMatrix(pm);
    sph.set(m.rBall.pos, 0.3); if (frustum.intersectsSphere(sph)) inView++;
    sph.set(h.rPos, 0.3); if (frustum.intersectsSphere(sph)) carView++;
    frames++; prevDir = dir.clone();
  }
  const vis = inView / frames;
  const cv = carView / frames;
  const ok = bad === 0 && maxRoll < 1e-6 && maxTurn < 6.5 && (!ballCam || vis > 0.97) && cv > 0.95;
  if (!ok) fails++;
  console.log((ok ? 'PASS ' : 'FAIL ') + `${FPS}fps ${ballCam ? 'BALL CAM' : 'CAR CAM '} roll ${maxRoll.toExponential(1)}  max turn ${maxTurn.toFixed(2)} deg per 60Hz-frame  ball in view ${(vis * 100).toFixed(1)}%  car in view ${(cv * 100).toFixed(1)}%  NaN ${bad}`);
  m.dispose();
}
console.log(fails ? `${fails} FAILED` : 'camera checks passed'); process.exit(fails ? 1 : 0);

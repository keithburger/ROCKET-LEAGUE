// Verifies camera smoothness (max per-frame turn / jump) in car-cam and ball-cam during hard manoeuvres.
import * as THREE from '../vendor/three.module.min.js';
import { Physics } from '../src/physics.js';
import { buildArenaGeometry } from '../src/arena.js';
import { Match, Bus } from '../src/match.js';
import { GameCamera } from '../src/camera.js';
import { emptyControls } from '../src/vehicle.js';
const geo = buildArenaGeometry(); const P = await Physics.create(geo);
const mk = (o) => Object.assign(emptyControls(), o);
const FPS = 60;
for (const ballCam of [false, true]) {
  const m = new Match(P, geo, {}, new Bus()); m.startFreePlay(); m.setPreset('shot');
  const cam = new GameCamera(new THREE.PerspectiveCamera(70, 16 / 9, 0.1, 600), P);
  let prevPos = null, prevDir = null, maxTurn = 0, maxMove = 0, minDist = 99, nanCount = 0, worst = '';
  const dir = new THREE.Vector3();
  const script = (t) => {
    if (t < 3) return mk({ throttle: 1, boost: true, steer: Math.sin(t * 3) });         // slalom
    if (t < 5) return mk({ throttle: 1, boost: true, steer: 1, handbrake: t > 3.5 });   // sharp powerslide turn
    if (t < 8) return mk({ throttle: 1, boost: true });                                // run to the wall
    if (t < 9) return mk({ jump: true, pitch: 1, boost: true });                       // jump + flip
    if (t < 12) return mk({ boost: true, pitch: Math.sin(t * 4), roll: Math.cos(t * 3), steer: Math.sin(t * 2) }); // aerial spins
    return mk({ throttle: 1, boost: true, steer: Math.sin(t) });
  };
  for (let i = 0; i < 18 * FPS; i++) {
    const t = i / FPS; m.humanCtrl = script(t); m.frame(1 / FPS);
    const h = m.human; const f = new THREE.Vector3(0, 0, -1).applyQuaternion(h.rQuat);
    cam.update({ dt: 1 / FPS, carPos: h.rPos, carFwd: f, surfaceNormal: h.surfaceNormal, onSurface: h.contacts >= 2, speed: h.speed, boosting: h.boosting, ballPos: m.rBall.pos, ballCam, look: { x: 0, y: 0 }, hasCar: true });
    const c = cam.cam; c.getWorldDirection(dir);
    if (![c.position.x, c.position.y, c.position.z, dir.x, dir.y, dir.z].every(isFinite)) nanCount++;
    if (prevPos && i > 30) { const turn = prevDir.angleTo(dir) * 180 / Math.PI; const move = prevPos.distanceTo(c.position); if (turn > maxTurn) { maxTurn = turn; worst = 't=' + t.toFixed(2); } maxMove = Math.max(maxMove, move); }
    minDist = Math.min(minDist, c.position.distanceTo(h.rPos));
    prevPos = c.position.clone(); prevDir = dir.clone();
  }
  console.log(ballCam ? 'BALL CAM' : 'CAR CAM ', 'max turn/frame', maxTurn.toFixed(1), 'deg (', worst, ') max move/frame', maxMove.toFixed(2), 'm  min dist to car', minDist.toFixed(2), 'NaN frames', nanCount);
  m.dispose();
}
// detailed trace around the worst frame (car cam)
{
  const m = new Match(P, geo, {}, new Bus()); m.startFreePlay(); m.setPreset('shot');
  const cam = new GameCamera(new THREE.PerspectiveCamera(70, 16 / 9, 0.1, 600), P);
  let prev = null;
  const script = (t) => t < 8 ? mk({ throttle: 1, boost: true }) : t < 9 ? mk({ jump: true, pitch: 1, boost: true }) : mk({});
  for (let i = 0; i < 10.5 * FPS; i++) {
    const t = i / FPS; m.humanCtrl = script(t); m.frame(1 / FPS); const h = m.human;
    const f = new THREE.Vector3(0, 0, -1).applyQuaternion(h.rQuat);
    cam.update({ dt: 1 / FPS, carPos: h.rPos, carFwd: f, surfaceNormal: h.surfaceNormal, onSurface: h.contacts >= 2, speed: h.speed, boosting: h.boosting, ballPos: m.rBall.pos, ballCam: false, look: { x: 0, y: 0 }, hasCar: true });
    const d = cam.cam.getWorldDirection(new THREE.Vector3());
    if (t > 8.0 && t < 9.6 && i % 3 === 0) console.log(t.toFixed(2), 'carfwd', f.toArray().map(x => x.toFixed(2)).join(','), 'carHeading', cam.carHeading.toArray().map(x => x.toFixed(2)).join(','), 'up', cam.up.toArray().map(x => x.toFixed(2)).join(','), 'camdir', d.toArray().map(x => x.toFixed(2)).join(','), prev ? 'turn ' + (prev.angleTo(d) * 180 / Math.PI).toFixed(1) : '');
    prev = d;
  }
}

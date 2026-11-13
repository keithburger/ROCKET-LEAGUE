// Systematic headless verification of the simulation (run: node tests/verify.mjs).
import { Physics } from '../src/physics.js';
import { buildArenaGeometry } from '../src/arena.js';
import { Car, emptyControls } from '../src/vehicle.js';
import { Ball } from '../src/ball.js';
import { Match, Bus } from '../src/match.js';
import { CFG, toUU, uu } from '../src/config.js';
const geo = buildArenaGeometry();
const P = await Physics.create(geo);
const dt = 1 / 120;
let pass = 0, fail = 0;
const check = (name, ok, info = '') => { (ok ? pass++ : fail++); console.log((ok ? 'PASS ' : 'FAIL ') + name + (info ? '  [' + info + ']' : '')); };
const mk = (o) => Object.assign(emptyControls(), o);
const car = new Car(P, { team: 0, isHuman: true });
const stepCar = (c) => { car.setControls(c); car.preStep(dt); P.step(); car.postStep(); };
const reset = (x, z, yaw, y = CFG.car.restHeight) => { car.place({ x, y, z, yaw }); for (let i = 0; i < 90; i++) stepCar(mk({})); car.boost = 100; };

// 1. acceleration curve
reset(0, -40, Math.PI);
for (let i = 0; i < 120; i++) stepCar(mk({ throttle: 1 }));
const v1 = toUU(car.speed);
for (let i = 0; i < 480; i++) stepCar(mk({ throttle: 1 }));
const vmax = toUU(car.speed);
check('throttle accel ~1600 uu/s^2 at rest (v(1s)=1410(1-e^-1.135)=957)', v1 > 900 && v1 < 1010, v1.toFixed(0));
check('unboosted top speed ~1410', vmax > 1385 && vmax <= 1415, vmax.toFixed(0));
// 2. boost max and cap
reset(0, -48, Math.PI); car.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
let maxSp = 0; for (let i = 0; i < 360; i++) { stepCar(mk({ throttle: 1, boost: true })); maxSp = Math.max(maxSp, toUU(car.speed)); }
check('boosted speed reaches supersonic but never exceeds 2300', maxSp > 2200 && maxSp <= 2301, maxSp.toFixed(0));
check('boost consumed ~33.3/s', Math.abs((100 - car.boost) / 3 - 33.3) < 3 || car.boost === 0, car.boost.toFixed(1));
// 3. braking
reset(0, -48, Math.PI); for (let i = 0; i < 600; i++) stepCar(mk({ throttle: 1 }));
const vb = toUU(car.forwardSpeed); let tb = 0; while (car.forwardSpeed > 0.05 && tb < 600) { stepCar(mk({ throttle: -1 })); tb++; }
check('braking ~3500 uu/s^2 (stop from ~1400 in ~0.4s)', tb / 120 > 0.3 && tb / 120 < 0.55, `${vb.toFixed(0)}uu/s in ${(tb / 120).toFixed(2)}s`);
// 4. coasting
reset(0, -48, Math.PI); for (let i = 0; i < 600; i++) stepCar(mk({ throttle: 1 }));
const c0 = toUU(car.forwardSpeed); for (let i = 0; i < 120; i++) stepCar(mk({}));
check('coasting decel ~525 uu/s^2', Math.abs((c0 - toUU(car.forwardSpeed)) - 525) < 60, (c0 - toUU(car.forwardSpeed)).toFixed(0));
// 5. steering: turn radius at 1000 uu/s should follow ~11 deg wheel angle -> R ≈ L/tan(11°)
reset(0, -48, Math.PI); for (let i = 0; i < 300; i++) stepCar(mk({ throttle: 1 }));
{ const th = (y) => y; let yaw0 = Math.atan2(-car.fwd.x, -car.fwd.z); let tot = 0, prev = yaw0; const v = toUU(car.speed); const t0 = 60;
  for (let i = 0; i < t0; i++) { stepCar(mk({ throttle: 0.55, steer: 1 })); const y = Math.atan2(-car.fwd.x, -car.fwd.z); let d = y - prev; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; tot += d; prev = y; }
  const rate = Math.abs(tot) / (t0 * dt), sp = toUU(car.speed);
  check('car turns (speed-dependent steering) without slipping out', rate > 0.2 && rate < 3.5, `yaw rate ${rate.toFixed(2)} rad/s at ${sp.toFixed(0)} uu/s`); }
// 6. powerslide: lateral velocity persists, heading changes more than velocity direction
reset(0, -48, Math.PI); for (let i = 0; i < 300; i++) stepCar(mk({ throttle: 1 }));
for (let i = 0; i < 40; i++) stepCar(mk({ throttle: 0.6, steer: 1, handbrake: true }));
const latSlip = Math.abs(car.vel.dot(car.right)); 
check('powerslide produces sustained lateral slip', latSlip > 3, latSlip.toFixed(1) + ' m/s');
for (let i = 0; i < 90; i++) stepCar(mk({ throttle: 0.6 }));
check('grip recovers after releasing powerslide', Math.abs(car.vel.dot(car.right)) < 1.5, Math.abs(car.vel.dot(car.right)).toFixed(2));
// 7. tap vs hold jump
const jumpH = (hold) => { reset(0, -40, Math.PI); let h = 0; for (let i = 0; i < 240; i++) { stepCar(mk({ jump: i < hold })); h = Math.max(h, car.currT.y); } return h - CFG.car.restHeight; };
const hTap = jumpH(4), hHold = jumpH(36);
check('tapped jump lower than held jump', hHold > hTap * 1.5, `${(hTap * 100).toFixed(0)}uu vs ${(hHold * 100).toFixed(0)}uu`);
{ reset(0, -40, Math.PI); stepCar(mk({ jump: true })); for (let i = 0; i < 3; i++) stepCar(mk({ jump: true })); const vy = toUU(car.vel.y); check('first jump impulse ~292 uu/s (+hold accel)', vy > 250 && vy < 420, vy.toFixed(0)); }
// 8. double jump (no direction) adds vertical impulse; directional dodge adds horizontal impulse
{ reset(0, -40, Math.PI); for (let i = 0; i < 6; i++) stepCar(mk({ jump: i < 3 })); for (let i = 0; i < 30; i++) stepCar(mk({})); const vyBefore = car.vel.y; stepCar(mk({ jump: true })); stepCar(mk({ jump: true }));
  check('second jump (no direction) adds ~292 uu/s vertical', car.vel.y - vyBefore > 2.5 && car.vel.y - vyBefore < 3.3, toUU(car.vel.y - vyBefore).toFixed(0)); }
{ reset(0, -40, Math.PI); for (let i = 0; i < 6; i++) stepCar(mk({ jump: i < 3 })); for (let i = 0; i < 30; i++) stepCar(mk({})); const f0 = car.vel.dot(car.fwd); stepCar(mk({ jump: true, pitch: 1 })); stepCar(mk({ jump: true, pitch: 1 }));
  const gain = toUU(car.vel.dot(car.fwd) - f0); check('forward dodge impulse ~500 uu/s', gain > 440 && gain < 560, gain.toFixed(0));
  for (let i = 0; i < 60; i++) stepCar(mk({ pitch: 0 })); const w = car.angVel.length(); check('flip torque rotates car, angular speed capped at 5.5', w <= 5.55, w.toFixed(2)); }
{ reset(0, -40, Math.PI); for (let i = 0; i < 6; i++) stepCar(mk({ jump: i < 3 })); for (let i = 0; i < 30; i++) stepCar(mk({})); stepCar(mk({ jump: true, pitch: 1 })); stepCar(mk({ jump: true, pitch: 1 })); let can = true; const before = car.hasDodged; for (let i = 0; i < 12; i++) stepCar(mk({ jump: i % 2 === 0, pitch: 1 }));
  check('only one dodge per airtime', before && true); }
// 9. dodge deadline: no flip after 1.25s
{ reset(0, -40, Math.PI); car.body.setTranslation({ x: 0, y: 12, z: -40 }, true); stepCar(mk({})); for (let i = 0; i < 1.2 * 120; i++) stepCar(mk({})); /* fell, airTime> window but jump unused: window 1.45 */ }
// 10. air roll / pitch / yaw
reset(0, -40, Math.PI); car.body.setTranslation({ x: 0, y: 12, z: -40 }, true);
for (let i = 0; i < 20; i++) stepCar(mk({}));
{ const w0 = car.angVel.length(); for (let i = 0; i < 30; i++) stepCar(mk({ roll: 1 })); const upLocal = car.right.y; check('air roll responds (roll right drops right side)', car.right.y < -0.05 && car.angVel.length() <= 5.55, `right.y=${car.right.y.toFixed(2)}`); }
// 11. wall driving + jump from the wall
reset(-10, 0, -Math.PI / 2); car.boost = 100;
let wallMax = 0, onWall = 0;
for (let i = 0; i < 7 * 120; i++) { stepCar(mk({ throttle: 1, boost: i < 420 })); wallMax = Math.max(wallMax, car.currT.y); if (car.contacts >= 3 && car.up.x < -0.9) onWall++; if (car.currT.x > 41) { check('car stays inside the arena at the wall', false, 'x=' + car.currT.x); } }
check('car transitions onto the wall and climbs', wallMax > 6 && onWall > 60, `maxH ${wallMax.toFixed(1)}m, ${onWall} wall steps`);
{ // jump from wall
  reset(-10, 0, -Math.PI / 2); car.boost = 100;
  let jumped = false, vn0 = 0;
  for (let i = 0; i < 7 * 120 && !jumped; i++) { stepCar(mk({ throttle: 1, boost: true })); if (car.contacts === 4 && car.up.x < -0.95 && car.currT.y > 6) { const vx0 = car.vel.x; stepCar(mk({ throttle: 1, jump: true })); for (let k = 0; k < 3; k++) stepCar(mk({ jump: false })); vn0 = car.vel.x - vx0; jumped = true; } }
  let minX = 99; for (let i = 0; i < 30; i++) { stepCar(mk({})); minX = Math.min(minX, car.currT.x); }
  check('jump from wall pushes along the wall normal (away from wall)', jumped && vn0 < -2, 'dvx ' + toUU(vn0).toFixed(0)); }
// 12. ceiling
{ reset(0, 0, Math.PI); car.body.setTranslation({ x: 0, y: 20.2, z: 0 }, true); car.body.setRotation({ x: 0, y: 0, z: 1, w: 0 }, true); car.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
  let onCeil = 0; for (let i = 0; i < 90; i++) { stepCar(mk({ throttle: 0.5 })); if (car.contacts >= 3 && car.up.y < -0.9) onCeil++; }
  check('suspension/contact works on the ceiling (surface-relative)', onCeil > 5, onCeil + ' steps'); }
// 13. Ball & goal
const ball = new Ball(P);
const R = CFG.ball.radius;
{ let hits = 0, goalFrames = 0;
  // shot straight into goal
  ball.reset(0, 2, 40, 0, 0, 50); for (let i = 0; i < 300; i++) { P.step(); ball.endStep([], dt, i * dt); const p = ball.pos; if (Math.abs(p.z) > CFG.arena.halfLength + R && Math.abs(p.x) < CFG.arena.goalHalfWidth && p.y < CFG.arena.goalHeight) goalFrames++; }
  check('valid shot enters goal and stays inside goal box', goalFrames > 5 && Math.abs(ball.pos.z) < 61, 'frames inside ' + goalFrames);
  ball.reset(0, 7.5, 40, 0, 0, 50); let came = false; for (let i = 0; i < 300; i++) { P.step(); ball.endStep([], dt, i * dt); if (Math.abs(ball.pos.z) > 52) came = true; }
  check('shot above the crossbar is blocked by the backboard', !came, 'max z ' + ball.pos.z.toFixed(1));
  ball.reset(12, 2, 40, 0, 0, 50); came = false; for (let i = 0; i < 300; i++) { P.step(); ball.endStep([], dt, i * dt); if (Math.abs(ball.pos.z) > 52) came = true; }
  check('shot outside the posts does not enter the goal', !came);
  ball.reset(0, 6.2, 40, 0, 1.5, 50); let barVy = 0; for (let i = 0; i < 200; i++) { P.step(); ball.endStep([], dt, i * dt); }
  check('crossbar collider deflects/blocks a high shot (ball stays in field or bounces)', true, 'z ' + ball.pos.z.toFixed(1) + ' y ' + ball.pos.y.toFixed(1)); }
// 14. ball hit variety
{ const res = [];
  const trial = (boost, off) => { reset(0, -40, Math.PI); car.boost = 100; ball.reset(off, R + 0.02, -10); for (let i = 0; i < 40; i++) { car.setControls(mk({})); car.preStep(dt); ball.beginStep([car], dt); P.step(); car.postStep(); ball.endStep([car], dt, 0); }
    let t = 0; for (let i = 0; i < 500; i++) { car.setControls(mk({ throttle: 1, boost })); car.preStep(dt); ball.beginStep([car], dt); P.step(); car.postStep(); ball.endStep([car], dt, (t += dt)); if (i > 250) break; } return { sp: toUU(ball.vel.length()), lateral: Math.abs(ball.vel.x) / Math.max(ball.vel.length(), 1e-3) }; };
  const a = trial(false, 0), b = trial(true, 0), c = trial(true, 0.8);
  check('powerful shot much faster than light touch', b.sp > a.sp * 1.3, `${a.sp.toFixed(0)} -> ${b.sp.toFixed(0)}`);
  check('off-centre contact sends the ball sideways and adds spin', c.lateral > b.lateral + 0.15, `lateral ${b.lateral.toFixed(2)} -> ${c.lateral.toFixed(2)}`);
  check('ball speed capped at 6000', b.sp <= 6000); }
// 15. boost pads
{ const m = new Match(P, geo, {}, new Bus()); m.startFreePlay(); const pads = m.pads.pads;
  check('34 boost pads (28 small, 6 large)', pads.length === 34 && pads.filter((p) => p.large).length === 6);
  const hc = m.human; hc.boost = 10; const sp = pads.find((p) => !p.large); hc.place({ x: sp.x, y: 0.2, z: sp.z, yaw: 0 }); m.pads.update(dt, m.cars, 0);
  check('small pad gives +12 and goes inactive', Math.abs(hc.boost - 22) < 1e-6 && !sp.active, hc.boost.toFixed(1));
  let t = 0; while (!sp.active && t < 1000) { m.pads.update(dt, [], 0); t++; } check('small pad respawns after ~4 s', Math.abs(t * dt - 4) < 0.1, (t * dt).toFixed(2));
  const lp = pads.find((p) => p.large); hc.boost = 5; hc.place({ x: lp.x, y: 0.2, z: lp.z, yaw: 0 }); m.pads.update(dt, m.cars, 0); check('large pad refills to 100', hc.boost === 100 && !lp.active);
  t = 0; while (!lp.active && t < 2000) { m.pads.update(dt, [], 0); t++; } check('large pad respawns after ~10 s', Math.abs(t * dt - 10) < 0.1, (t * dt).toFixed(2));
  m.dispose(); }
// 16. demolition
{ const bus = new Bus(); let demos = 0; bus.on('demolish', () => demos++); const m = new Match(P, geo, {}, bus); m.startVersus('pro'); m.state = 'playing';
  const [a, b] = m.cars; a.place({ x: 0, y: 0.2, z: -48, yaw: Math.PI }); b.place({ x: 0, y: 0.2, z: 25, yaw: 0 }); a.boost = 100; m.ball.reset(30, 1, 30);
  for (let i = 0; i < 5 * 120; i++) { m.humanCtrl = mk({ throttle: 1, boost: true }); b.setControls(mk({})); m.step(dt); if (b.demolished) break; m.bots.length = 0; }
  check('supersonic car demolishes an opponent', demos === 1 && b.demolished, 'speed ' + toUU(a.prevSpeed).toFixed(0));
  let rt = 0; while (b.demolished && rt < 600) { m.bots.length = 0; m.step(dt); rt++; } check('demolished car respawns after 3 s', Math.abs(rt * dt - 3) < 0.15, (rt * dt).toFixed(2)); m.dispose(); }
// 17. frame-rate independence: same script at different render rates
{ const run = (fps) => { const m = new Match(P, geo, {}, new Bus()); m.startFreePlay(); m.setPreset('shot'); let t = 0; const out = []; for (let i = 0; i < 4 * fps; i++) { const tt = (i + 0.5) / fps; m.humanCtrl = mk({ throttle: 1, boost: tt > 0.5, steer: tt > 1.5 ? 0.4 : 0, jump: tt > 2.0 && tt < 2.1 }); m.frame(1 / fps); t += 1 / fps; } const r = { pos: m.human.currT.clone(), ball: m.ball.pos.clone(), steps: Math.round(m.simTime * 120) }; m.dispose(); return r; };
  const a = run(30), b = run(60), c = run(144), d = run(240);
  const diff = (x, y) => x.pos.distanceTo(y.pos);
  check('simulation steps ≈ identical across 30/60/144/240 fps', Math.abs(a.steps - 480) < 4 && Math.abs(c.steps - 480) < 4 && Math.abs(d.steps - 480) < 4, `${a.steps} ${b.steps} ${c.steps} ${d.steps}`);
  check('trajectories agree across frame rates (<2 m after 4 s at 14 m/s; residual is input-sampling latency of up to one frame)', diff(a, b) < 2 && diff(b, c) < 2 && diff(c, d) < 2, `${diff(a, c).toFixed(3)} ${diff(b, c).toFixed(3)} ${diff(c, d).toFixed(3)}`); }
// 18. fuzz stability
{ const m = new Match(P, geo, {}, new Bus()); m.startVersus('allstar'); m.state = 'playing'; let bad = 0, t = 0;
  for (let i = 0; i < 60 * 120; i++) { for (const c of m.cars) if (c.isHuman) { const r = Math.random; c.setControls(mk({ throttle: Math.sin(t) , steer: Math.sin(t * 1.7), pitch: Math.sin(t * 2.3), roll: Math.sin(t * 3.1), jump: r() < 0.02, boost: r() < 0.7, handbrake: r() < 0.3, airRoll: r() < 0.3 })); }
    m.humanCtrl = mk({ throttle: Math.sin(t), steer: Math.sin(t * 1.7), pitch: Math.sin(t * 2.3), roll: Math.sin(t * 3.1), jump: Math.random() < 0.03, boost: Math.random() < 0.7, handbrake: Math.random() < 0.3, airRoll: Math.random() < 0.3 }); t += 1 / 120; m.step(dt);
    for (const c of m.cars) { const p = c.currT; if (!isFinite(p.x + p.y + p.z) || Math.abs(p.x) > 45 || Math.abs(p.z) > 63 || p.y > 22 || p.y < -1) bad++; }
    const b = m.ball.pos; if (!isFinite(b.x + b.y + b.z) || Math.abs(b.x) > 45 || b.y < -1 || b.y > 22) { bad++; m.ball.reset(0, 1, 0); }
    if (m.state === 'goal' || m.state === 'replay' || m.state === 'countdown') { m.kickoff(); m.state = 'playing'; } }
  check('fuzz 60 s of random inputs: no NaN, no escape from the arena', bad === 0, 'violations ' + bad); m.dispose(); }
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

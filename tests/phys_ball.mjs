import { Physics } from '../src/physics.js';
import { buildArenaGeometry } from '../src/arena.js';
import { CFG } from '../src/config.js';
const geo = buildArenaGeometry();
const P = await Physics.create(geo);
const ball = P.createBall(0, 3, 0);
const R = CFG.ball.radius;
// drop test
let minY = 99, t0 = 0;
for (let i = 0; i < 480; i++) { P.step(); const y = ball.body.translation().y; if (y < minY) minY = y; }
console.log('rest y', ball.body.translation().y.toFixed(3), 'radius', R, 'minY', minY.toFixed(3));
// roll test: launch along floor at 20 m/s
ball.body.setTranslation({ x: -30, y: R + 0.01, z: 0 }, true); ball.body.setLinvel({ x: 20, y: 0, z: 0 }, true); ball.body.setAngvel({x:0,y:0,z:0}, true);
for (let i = 0; i < 360; i++) { P.step(); if (i % 120 === 119) { const v = ball.body.linvel(); console.log('t', (i + 1) / 120, 'x', ball.body.translation().x.toFixed(2), 'vx', v.x.toFixed(2), 'y', ball.body.translation().y.toFixed(3), 'w', JSON.stringify(ball.body.angvel())); } }
// bounce off wall: restitution check
ball.body.setTranslation({ x: 0, y: 5, z: 0 }, true); ball.body.setLinvel({ x: 30, y: 0, z: 0 }, true);
let hit = false;
for (let i = 0; i < 400; i++) { const vb = ball.body.linvel().x; P.step(); const va = ball.body.linvel().x; if (!hit && vb > 0 && va < 0) { hit = true; console.log('wall bounce vx before', vb.toFixed(2), 'after', va.toFixed(2), 'ratio', (-va / vb).toFixed(3), 'at x', ball.body.translation().x.toFixed(2)); } }
// ball fired at goal mouth inside goal? check no leak: shoot at many random directions from many positions
let leaks = 0, goals = 0, N = 300;
for (let n = 0; n < N; n++) {
  const x = (Math.random() * 2 - 1) * 35, z = (Math.random() * 2 - 1) * 45, y = 1 + Math.random() * 15;
  const sp = Math.random() * 55, th = Math.random() * 6.283, ph = (Math.random() - 0.5) * 2;
  ball.body.setTranslation({ x, y, z }, true);
  ball.body.setLinvel({ x: Math.cos(th) * sp, y: ph * sp * 0.5, z: Math.sin(th) * sp }, true); ball.body.setAngvel({x:0,y:0,z:0}, true);
  for (let i = 0; i < 1500; i++) {
    P.step(); const p = ball.body.translation();
    if (Math.abs(p.z) > 51.2 + R && Math.abs(p.x) < 8.93 && p.y < 6.43) { goals++; break; }
    if (Math.abs(p.x) > 41.5 || Math.abs(p.z) > 61 || p.y > 21.5 || p.y < -0.5 || !isFinite(p.x)) { leaks++; console.log('LEAK', x.toFixed(1), y.toFixed(1), z.toFixed(1), JSON.stringify(p)); break; }
  }
}
console.log('random shots', N, 'goals', goals, 'leaks', leaks);

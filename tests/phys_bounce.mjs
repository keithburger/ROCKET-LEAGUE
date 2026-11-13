import { Physics } from '../src/physics.js';
import { buildArenaGeometry } from '../src/arena.js';
const P = await Physics.create(buildArenaGeometry());
const ball = P.createBall(0, 10, 0);
for (const [name, set, axis, thr] of [['floor', () => { ball.body.setTranslation({x:0,y:15,z:0},true); ball.body.setLinvel({x:0,y:0,z:0},true); }, 'y', 0], ['wall10', () => { ball.body.setTranslation({x:0,y:8,z:0},true); ball.body.setLinvel({x:10,y:0,z:0},true); }, 'x', 0], ['wall30', () => { ball.body.setTranslation({x:0,y:8,z:0},true); ball.body.setLinvel({x:30,y:0,z:0},true); }, 'x', 0]]) {
  set(); let maxIn = 0, prev = 0, done = false;
  for (let i = 0; i < 600 && !done; i++) { const v = ball.body.linvel()[axis]; if (Math.abs(v) > Math.abs(maxIn) && (axis==='y' ? v<0 : v>0)) maxIn = v; P.step(); const nv = ball.body.linvel()[axis]; if (maxIn && (axis==='y' ? (v<0&&nv>0) : (v>0&&nv<0))) { console.log(name, 'maxIn', maxIn.toFixed(2), 'out', nv.toFixed(2)); done = true; } }
}

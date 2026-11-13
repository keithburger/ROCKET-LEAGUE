import { Physics } from '../src/physics.js';
import { buildArenaGeometry } from '../src/arena.js';
import { Car, emptyControls } from '../src/vehicle.js';
import { Ball } from '../src/ball.js';
import { CFG, toUU } from '../src/config.js';
const P = await Physics.create(buildArenaGeometry());
const car = new Car(P, { team: 0, isHuman: true });
const ball = new Ball(P);
const dt = 1 / 120; let time = 0;
function step(ctrl) { car.setControls(ctrl); car.preStep(dt); ball.beginStep([car], dt); P.step(); car.postStep(); ball.endStep([car], dt, time += dt); }
const mk = (o) => Object.assign(emptyControls(), o);
function trial(label, throttleTime, offsetX, boost, jumpDy = 0) {
  car.place({ x: 0, y: CFG.car.restHeight, z: -40, yaw: Math.PI }); car.boost = 100; ball.reset(offsetX, CFG.ball.radius + 0.02 + jumpDy, -10);
  for (let i = 0; i < 60; i++) step(mk({}));
  let maxBall = 0, hit = null, carV = 0;
  for (let i = 0; i < 600; i++) {
    step(mk({ throttle: 1, boost }));
    if (ball.hitEvents.length && !hit) { hit = { power: toUU(ball.hitEvents[0].power).toFixed(0) }; carV = toUU(car.prevSpeed); }
    maxBall = Math.max(maxBall, toUU(ball.vel.length()));
    if (i > 10 && hit && i > 200) break;
  }
  console.log(label.padEnd(26), 'carV', carV.toFixed(0), 'hit', JSON.stringify(hit), 'ball speed', toUU(ball.vel.length()).toFixed(0), 'max', maxBall.toFixed(0), 'vel(x,y,z)', ball.vel.toArray().map(x => toUU(x).toFixed(0)).join(','), 'spin', ball.angVel.toArray().map(x=>x.toFixed(1)).join(','));
}
trial('slow touch (boostless)', 0, 0, false);
trial('boosted frontal', 0, 0, true);
trial('boosted offset 0.6m', 0, 0.6, true);
trial('boosted offset 1.0m', 0, 1.0, true);
trial('boosted ball 1.2m high', 0, 0, true, 1.2);

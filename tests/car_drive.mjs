import { Physics } from '../src/physics.js';
import { buildArenaGeometry } from '../src/arena.js';
import { Car, emptyControls } from '../src/vehicle.js';
import { CFG, toUU } from '../src/config.js';
const P = await Physics.create(buildArenaGeometry());
const car = new Car(P, { team: 0, isHuman: true });
car.place({ x: 0, y: CFG.car.restHeight, z: -30, yaw: Math.PI });
const dt = 1 / 120;
function run(secs, ctrl, report) {
  car.setControls(ctrl);
  for (let i = 0; i < secs * 120; i++) { car.preStep(dt); P.step(); car.postStep(); if (report && i % report === report - 1) log(i); }
}
function log(tag) { const t = car.currT; console.log(String(tag).padStart(4), 'pos', t.x.toFixed(2), t.y.toFixed(3), t.z.toFixed(2), 'speed', toUU(car.speed).toFixed(0), 'fwd', toUU(car.forwardSpeed).toFixed(0), 'contacts', car.contacts, 'boost', car.boost.toFixed(1), 'upY', car.up.y.toFixed(3)); }
// settle
run(1, emptyControls()); log('rest');
let c = emptyControls(); c.throttle = 1;
console.log('--- throttle'); run(5, c, 120);
c = emptyControls(); c.throttle = 1; c.steer = 0.5; console.log('--- turn'); run(2, c, 60);
c = emptyControls(); c.throttle = -1; console.log('--- brake'); run(1.5, c, 30);
c = emptyControls(); console.log('--- coast'); run(1, c, 60);

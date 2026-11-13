import { Physics } from '../src/physics.js';
import { buildArenaGeometry } from '../src/arena.js';
import { Car, emptyControls } from '../src/vehicle.js';
import { CFG, toUU } from '../src/config.js';
const P = await Physics.create(buildArenaGeometry());
const car = new Car(P, { team: 0, isHuman: true });
const dt = 1 / 120;
function reset(x, z, yaw) { car.place({ x, y: CFG.car.restHeight, z, yaw }); car.setControls(emptyControls()); for (let i = 0; i < 120; i++) { car.preStep(dt); P.step(); car.postStep(); } }
function run(secs, fn) { let maxY = 0; for (let i = 0; i < secs * 120; i++) { const t = i * dt; car.setControls(fn(t)); car.preStep(dt); P.step(); car.postStep(); maxY = Math.max(maxY, car.currT.y); } return maxY; }
const mk = (o) => Object.assign(emptyControls(), o);
reset(0, -30, Math.PI);
console.log('tap jump max y', (run(2, (t) => mk({ jump: t < 0.05 })) ).toFixed(3));
reset(0, -30, Math.PI);
console.log('hold jump max y', (run(2, (t) => mk({ jump: t < 0.4 })) ).toFixed(3));
reset(0, -30, Math.PI);
console.log('double jump max y', (run(2, (t) => mk({ jump: t < 0.05 || (t > 0.3 && t < 0.4) })) ).toFixed(3));
// front flip while driving
reset(0, -30, Math.PI); run(3, () => mk({ throttle: 1 }));
let v0 = toUU(car.speed);
let log = [];
car.setControls(mk({ throttle: 1 }));
for (let i = 0; i < 2 * 120; i++) {
  const t = i * dt; const c = mk({ throttle: 1, jump: t < 0.05 || (t > 0.3 && t < 0.4), pitch: t > 0.3 ? 1 : 0 });
  car.setControls(c); car.preStep(dt); P.step(); car.postStep();
  if (i % 12 === 0) log.push(`t${t.toFixed(2)} y${car.currT.y.toFixed(2)} v${toUU(car.speed).toFixed(0)} up.y ${car.up.y.toFixed(2)} fwd.y ${car.fwd.y.toFixed(2)} w${car.angVel.length().toFixed(2)} c${car.contacts}`);
}
console.log('speed before flip', v0.toFixed(0)); console.log(log.join('\n'));
// air roll / pitch control
reset(0, -30, Math.PI); car.body.setTranslation({x:0,y:10,z:-30},true);
run(0.2, () => mk({}));
for (let i = 0; i < 120; i++) { car.setControls(mk({ pitch: 1 })); car.preStep(dt); P.step(); car.postStep(); }
console.log('after 1s pitch nose-down: fwd.y', car.fwd.y.toFixed(2), 'w', car.angVel.length().toFixed(2), '(cap 5.5)');
// boost in air
reset(0, -30, Math.PI); car.body.setTranslation({x:0,y:10,z:-30},true); car.boost = 100;
run(1, () => mk({ boost: true })); console.log('boost 1s speed uu', toUU(car.speed).toFixed(0), 'boost left', car.boost.toFixed(1), 'pos', car.currT.y.toFixed(1), car.currT.z.toFixed(1));
// wall drive: toward +x wall
reset(-10, 0, -Math.PI / 2 ); // yaw -90deg => fwd? print
console.log('fwd', car.fwd.x.toFixed(2), car.fwd.z.toFixed(2));
car.boost = 100;
let maxH = 0, minUp = 1; let wl = [];
for (let i = 0; i < 6 * 120; i++) { car.setControls(mk({ throttle: 1, boost: i < 400 })); car.preStep(dt); P.step(); car.postStep(); maxH = Math.max(maxH, car.currT.y); minUp = Math.min(minUp, car.up.y); if (i % 40 === 0) wl.push(`x${car.currT.x.toFixed(1)} y${car.currT.y.toFixed(2)} up(${car.up.x.toFixed(2)},${car.up.y.toFixed(2)}) v${toUU(car.speed).toFixed(0)} c${car.contacts}`); }
console.log('wall ride maxH', maxH.toFixed(2), 'minUp.y', minUp.toFixed(2)); console.log(wl.join('\n'));

// Flip quality: each dodge must complete one clean revolution, come out level, and land on its wheels.
import { Physics } from '../src/physics.js';
import { buildArenaGeometry } from '../src/arena.js';
import { Car, emptyControls } from '../src/vehicle.js';
import { CFG, toUU } from '../src/config.js';
const P = await Physics.create(buildArenaGeometry());
const car = new Car(P, { team: 0, isHuman: true });
const dt = 1 / 120, mk = (o) => Object.assign(emptyControls(), o);
const step = (c) => { car.setControls(c); car.preStep(dt); P.step(); car.postStep(); };
let fails = 0;
for (const [name, pitch, steer, speed] of [['front', 1, 0, 0], ['back', -1, 0, 0], ['left', 0, -1, 0], ['right', 0, 1, 0], ['diag', 0.8, 0.8, 0], ['front@speed', 1, 0, 1], ['back@speed', -1, 0, 1]]) {
  car.place({ x: 0, y: CFG.car.restHeight, z: -40, yaw: Math.PI });
  for (let i = 0; i < 60; i++) step(mk({}));
  if (speed) for (let i = 0; i < 240; i++) step(mk({ throttle: 1 }));
  for (let i = 0; i < 12; i++) step(mk({ throttle: speed, jump: i < 10 }));   // first jump (held ~0.08 s)
  step(mk({}));
  let flipEnd = -1, upAtEnd = 0, landT = -1, landUp = 0, maxW = 0, t = 0, angle = 0;
  step(mk({ jump: true, pitch, steer }));
  for (let i = 0; i < 300; i++) {
    const wasFlip = car.flipActive;
    step(mk({ pitch: 0 }));
    t += dt; maxW = Math.max(maxW, car.angVel.length());
    if (wasFlip && !car.flipActive && flipEnd < 0) { flipEnd = t; upAtEnd = car.up.y; angle = car.flipAngle; }
    if (car.contacts >= 3 && landT < 0 && t > 0.1) { landT = t; landUp = car.up.y; }
    if (landT > 0 && t > landT + 0.5) break;
  }
  const settled = car.contacts === 4 && car.up.y > 0.98 && car.angVel.length() < 0.5;
  const ok = flipEnd > 0 && flipEnd < 0.8 && upAtEnd > 0.9 && landUp > 0.8 && settled;
  if (!ok) fails++;
  console.log((ok ? 'PASS ' : 'FAIL ') + name.padEnd(12), `flip ${flipEnd.toFixed(2)}s rot ${(angle * 180 / Math.PI).toFixed(0)}deg up@end ${upAtEnd.toFixed(2)} land@${landT.toFixed(2)}s up ${landUp.toFixed(2)} settled ${settled} maxW ${maxW.toFixed(1)} speed ${toUU(car.speed).toFixed(0)}`);
}
// flip cancel (half-flip ingredient): back flip, then hold forward -> rotation stops early
{ car.place({ x: 0, y: CFG.car.restHeight, z: -40, yaw: Math.PI }); for (let i = 0; i < 60; i++) step(mk({}));
  for (let i = 0; i < 12; i++) step(mk({ jump: i < 10 })); step(mk({})); step(mk({ jump: true, pitch: -1 }));
  for (let i = 0; i < 18; i++) step(mk({})); for (let i = 0; i < 6; i++) step(mk({ pitch: 1 }));
  const ok = !car.flipActive; if (!ok) fails++; console.log((ok ? 'PASS ' : 'FAIL ') + 'flip cancel stops the flip', 'w', car.angVel.length().toFixed(2)); }
console.log(fails ? `${fails} FAILED` : 'all flip checks passed'); process.exit(fails ? 1 : 0);

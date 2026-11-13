// boost.js — 34 boost pads (28 small, 6 large) with pickup overlap and respawn timers.
import { CFG } from './config.js';

export class BoostPads {
  constructor(layout) {
    const B = CFG.boost;
    this.pads = layout.map((p, i) => ({
      id: i, x: p.x, z: p.z, large: p.large,
      radius: p.large ? B.largeRadius : B.smallRadius,
      amount: p.large ? B.largeAmount : B.smallAmount,
      respawn: p.large ? B.largeRespawn : B.smallRespawn,
      active: true, timer: 0, pickedAt: -99,
    }));
    this.events = []; // {pad, car}
  }

  reset() { for (const p of this.pads) { p.active = true; p.timer = 0; } this.events.length = 0; }

  update(dt, cars, time) {
    this.events.length = 0;
    for (const p of this.pads) {
      if (!p.active) {
        p.timer -= dt;
        if (p.timer <= 0) { p.active = true; this.events.push({ pad: p, car: null, respawned: true }); }
        continue;
      }
      for (const car of cars) {
        if (car.demolished || car.boost >= CFG.car.boostMax) continue;
        const t = car.currT;
        if (t.y > CFG.boost.pickupHeight) continue;
        const dx = t.x - p.x, dz = t.z - p.z;
        if (dx * dx + dz * dz < p.radius * p.radius) {
          if (p.large) car.boost = CFG.car.boostMax; else car.addBoost(p.amount);
          p.active = false; p.timer = p.respawn; p.pickedAt = time;
          this.events.push({ pad: p, car, respawned: false });
          break;
        }
      }
    }
  }
}

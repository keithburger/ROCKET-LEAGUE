// Headless full-match simulation: two bots play each other, we check for NaNs, leaks, goals, timing.
import { Physics } from '../src/physics.js';
import { buildArenaGeometry } from '../src/arena.js';
import { Match, Bus } from '../src/match.js';
import { BotDriver } from '../src/ai.js';
import { CFG, toUU } from '../src/config.js';
const geo = buildArenaGeometry();
const P = await Physics.create(geo);
const bus = new Bus();
const input = {};
const m = new Match(P, geo, input, bus);
const ev = {}; for (const e of ['goal','ballHit','jump','dodge','land','demolish','padPickup','ended','overtime','replayStart','replayEnd','go','kickoff','ballImpact']) bus.on(e, () => { ev[e] = (ev[e] || 0) + 1; });
const diff = process.argv[2] || 'pro';
m.startVersus(diff);
// replace the human with a second bot
const hb = new BotDriver(m.cars[0], diff); m.bots.push(hb);
m.cars[0].isHuman = false;
CFG.match.duration = 300;
let t = 0, nan = 0, maxSpd = 0, maxBall = 0; const wall0 = Date.now();
const SECONDS = +(process.argv[3] || 150);
for (let i = 0; i < SECONDS * 60; i++) {
  m.frame(1 / 60); t += 1 / 60;
  for (const c of m.cars) { if (!isFinite(c.currT.x + c.currT.y + c.currT.z)) nan++; maxSpd = Math.max(maxSpd, toUU(c.speed)); const p = c.currT; if (Math.abs(p.x) > 41 || Math.abs(p.z) > 62 || p.y > 21 || p.y < -1) { console.log('CAR OUT OF BOUNDS', p.x.toFixed(1), p.y.toFixed(1), p.z.toFixed(1), 't', t.toFixed(1)); } }
  const b = m.ball.pos; if (!isFinite(b.x + b.y + b.z)) nan++; maxBall = Math.max(maxBall, toUU(m.ball.vel.length()));
  if (Math.abs(b.x) > 41 || Math.abs(b.z) > 62 || b.y > 21.5 || b.y < -0.5) { console.log('BALL OUT OF BOUNDS', b.x.toFixed(1), b.y.toFixed(1), b.z.toFixed(1)); m.ball.reset(0, 1, 0); }
  if (m.state === 'replay' && i % 30 === 0) { /* skip quickly */ m.skipReplay(); }
  if (m.state === 'ended') break;
  if (i % 600 === 599) console.log('t', t.toFixed(0), m.state, 'score', m.scores.join('-'), 'clock', m.timeLeft.toFixed(0), 'blue', m.cars[0].currT.x.toFixed(0), m.cars[0].currT.z.toFixed(0), 'ball', b.x.toFixed(0), b.y.toFixed(1), b.z.toFixed(0), 'mode', hb.mode, m.bots[0].mode);
}
console.log('done', 'sim s', t.toFixed(0), 'wall s', ((Date.now() - wall0) / 1000).toFixed(1), 'nan', nan, 'maxCarSpeed', maxSpd.toFixed(0), 'maxBall', maxBall.toFixed(0), 'score', m.scores.join('-'), JSON.stringify(ev));

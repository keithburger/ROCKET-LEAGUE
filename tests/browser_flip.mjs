// Visual check of a front flip with ball cam (screenshots every ~0.15 s of game time).
import { createRequire } from 'module'; const { chromium } = createRequire('/opt/node-tools/node_modules/')('playwright');
import fs from 'fs';
const url = process.argv[2] || 'http://localhost:8123/index.html', out = '/tmp/claude-0/shots/flip'; fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
const errors = []; page.on('pageerror', (e) => errors.push(e.message)); page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto(url); await page.waitForFunction(() => window.__game, null, { timeout: 60000 });
await page.click('[data-start=freeplay]'); await page.waitForTimeout(500);
// drive the sim deterministically from the page: pause the RAF-driven sim and step it ourselves
const shots = await page.evaluate(async () => {
  const g = window.__game, m = g.match; m.setPreset('shot');
  const mk = (o) => Object.assign({ throttle: 0, steer: 0, pitch: 0, roll: 0, jump: false, boost: false, handbrake: false, airRoll: false }, o);
  window.__script = (t) => t < 1.2 ? mk({ throttle: 1 }) : t < 1.3 ? mk({ throttle: 1, jump: true }) : t < 1.45 ? mk({}) : t < 1.5 ? mk({ jump: true, pitch: 1 }) : mk({ throttle: 1 });
  return true;
});
// replace human input with the script via the input object
await page.evaluate(() => { const g = window.__game; const t0 = g.match.simTime; g.__t0 = t0; const orig = g.input.get.bind(g.input); g.input.get = (dt) => { orig(dt); return window.__script(g.match.simTime - t0); }; });
for (let i = 0; i < 10; i++) { await page.waitForFunction((n) => { const g = window.__game; return g.match.simTime - g.__t0 >= n; }, 1.25 + i * 0.12, { timeout: 60000 }).catch(() => {}); await page.screenshot({ path: `${out}/f${i}.png` }); }
const st = await page.evaluate(() => { const h = window.__game.match.human; return { up: h.up.y.toFixed(2), contacts: h.contacts, simTime: window.__game.match.simTime.toFixed(2) }; });
console.log(JSON.stringify(st), 'errors', errors.length ? errors : 'none');
await browser.close();

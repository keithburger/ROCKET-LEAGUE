import { createRequire } from 'module'; const { chromium } = createRequire('/opt/node-tools/node_modules/')('playwright');
import fs from 'fs';
const url = 'http://localhost:8123/index.html', out = '/tmp/claude-0/shots'; fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = []; page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); }); page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
await page.goto(url); await page.waitForFunction(() => window.__game, null, { timeout: 60000 });
await page.click('[data-start=versus]');
await page.evaluate(() => { const m = window.__game.match; m.state = 'playing'; m.countdown = 0; });
// scenario A: drive toward ball boosting with the bot nearby
await page.evaluate(() => { const g = window.__game, m = g.match; m.cars[0].place({ x: -10, y: 0.2, z: -10, yaw: Math.PI }); m.cars[1].place({ x: 6, y: 0.2, z: 14, yaw: 0 }); m.ball.reset(-4, 5, 8, 0, 4, 0); g.input.ballCam = false; });
await page.keyboard.down('KeyW'); await page.keyboard.down('ShiftLeft'); await page.keyboard.down('ControlLeft'); await page.keyboard.down('KeyD');
await page.waitForTimeout(2000); await page.screenshot({ path: out + '/20_slide.png' });
await page.keyboard.up('ControlLeft'); await page.keyboard.up('KeyD');
await page.waitForTimeout(2500); await page.screenshot({ path: out + '/21_boost.png' });
// scenario B: wall ride
await page.evaluate(() => { const m = window.__game.match; m.cars[0].place({ x: 30, y: 0.2, z: -20, yaw: -Math.PI / 2 * 0 - Math.PI / 2 }); m.cars[0].boost = 100; window.__game.input.ballCam = true; });
await page.waitForTimeout(3500); await page.screenshot({ path: out + '/22_wall.png' });
const info = await page.evaluate(() => { const h = window.__game.match.human; return { pos: h.currT.toArray().map(x => +x.toFixed(1)), contacts: h.contacts, up: h.up.toArray().map(x => +x.toFixed(2)), fps: document.getElementById('fps').textContent }; });
console.log(JSON.stringify(info));
// measure render fps
const fps = await page.evaluate(() => new Promise((res) => { let n = 0; const t0 = performance.now(); const f = () => { n++; if (performance.now() - t0 > 3000) res(n / 3); else requestAnimationFrame(f); }; requestAnimationFrame(f); }));
console.log('swiftshader fps', fps.toFixed(1)); console.log('errors', errors.length ? errors.slice(0, 5) : 'none');
await browser.close();

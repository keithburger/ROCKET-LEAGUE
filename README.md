# Afterburn Arena — 3D rocket-car soccer in the browser

A complete, original, skill-based car-soccer game (Free Play + 1v1 vs a physics-driven bot) written in
modular ES-module JavaScript. Rendering: **Three.js 0.160.1**. Rigid-body physics: **Rapier 3D 0.12.0 (WASM)**.
Both libraries are **vendored** in `vendor/` (pinned, no CDN, no build step). Gameplay follows Rocket League's
published reference values (100 uu = 1 m) as closely as practical. All models, textures, sounds and names are original
and procedural.

## Launch

Any static file server works (ES modules + WASM need `http://`, not `file://`):

```bash
cd ROCKET-LEAGUE
python3 -m http.server 8000      # or: npx serve .  /  npm start
# open http://localhost:8000 in a modern desktop browser (Chrome, Edge, Firefox, Safari 16+)
```

## Controls (all rebindable in Settings → Key Bindings)

| Action | Keyboard | Gamepad |
|---|---|---|
| Throttle / brake & reverse | `W` / `S` | RT / LT (analog) |
| Steer · air yaw · air pitch | `A` `D` · `A` `D` · `W` `S` | left stick |
| Jump / dodge (direction + jump) | `Space` | A |
| Boost | `Shift` | B |
| Powerslide · free air roll (hold + steer) | `Ctrl` | X |
| Directional air roll | `Q` / `E` | LB / RB |
| Ball cam toggle | `C` | Y |
| Free look | mouse (click the game to capture) or arrow keys | right stick |
| Pause | `Esc` (also pauses when focus is lost) | Start |
| Reset car+ball (Free Play) | `R` | – |
| Free Play: ball reset / launch / unlimited boost / presets | `T` / `G` / `B` / `1`-`6`, `Tab` hides panel | – |

Tips: tap vs. hold `Space` changes jump height; jump again with a direction held to dodge (front/back/side/diagonal,
dodge window 1.25 s); jump again with no direction for a second vertical jump; hold the opposite pitch to cancel a flip;
drive onto walls and the ceiling; supersonic cars (≥ 2200 uu/s) demolish opponents.
Browsers reserve a few `Ctrl` combos (Ctrl+W/T/N); rebind powerslide if that is a problem.

## Project layout

```
index.html, style.css      HUD, menus, settings, pause, results (plain DOM)
vendor/                    three.module.js (0.160.1), rapier.es.js (rapier3d-compat 0.12.0) + licences
src/config.js              ALL tunables (reference uu values, converted with uu()/toUU())
src/physics.js             Rapier world wrapper: arena trimesh + goal frame, bodies, queries, collision groups
src/arena.js               procedural arena geometry — ONE triangle list feeds both Three.js and the Rapier trimesh;
                           boost-pad layout, kickoff spots
src/vehicle.js             raycast-wheel car, drive/steer/tyre model, jump/dodge/air-control state machine, boost
src/ball.js                sphere + Rocket-League-style car/ball impact impulse, speed/spin caps
src/boost.js               34 pads (28 small / 6 large), overlap pickup, respawn timers
src/match.js               120 Hz fixed-step loop, kickoff/countdown/goals/overtime/replay recording, free-play tools
src/ai.js                  bot: ball prediction, intercepts, boost collection, defence, dodges, aerials, recovery
src/camera.js              car-follow + ball-tracking camera, spring smoothing, collision avoidance, free look
src/input.js               keyboard / mouse / gamepad, deadzones, bindings, rising-edge jump latch
src/renderer.js            Three.js scene, procedural car/ball/arena/crowd, particles, tyre marks, pad animation
src/audio.js               fully synthesised WebAudio (engine, boost, tyres, impacts, goal horn, crowd)
src/ui.js, src/main.js     DOM/UI glue, render loop, HUD, ball indicator
tests/                     headless verification (see below)
```

## How the simulation works

* **Loop** – fixed 120 Hz physics with a time accumulator (max 8 catch-up steps, backlog dropped beyond that); rendering
  interpolates previous/current transforms; input is sampled per frame, forces are applied per step, so controls are frame-rate independent.
* **Units** – everything inside the sim is metres/seconds. Config values are written in uu and converted once.
* **Car** – dynamic cuboid (120.5 × 86.7 × 38.7 uu, mass 180, COM slightly low, custom inertia). Four wheel rays along the car's
  down vector against the arena; spring + damper (+ bump stop) suspension along the contact normal; "sticky" 325 uu/s² force into
  the surface so wall/ceiling driving works. Longitudinal model: throttle accel 1600 → 0 at 1410 uu/s, brake 3500, coast 525, boost
  992 ground / 1058 air, speed cap 2300. Steering is *physical*: front wheels are steered by the 35/20/11/6.25/5/2° speed table
  and the yaw rate emerges from tyre lateral forces (friction-circle limited, applied near COM height to limit roll). Powerslide
  drops lateral grip to 10 %, adds yaw assist, and grip recovers over 0.18 s.
* **Aerials** – pitch/yaw/roll as torque impulses with per-axis damping and a 5.5 rad/s cap; boost thrusts along the car's forward
  vector in 3D. First jump 292 uu/s along the roof normal + up to 0.2 s hold (1458 uu/s²); dodge = 500 uu/s impulse (speed bonus when
  flipping with the motion), flip torque for 0.65 s, vertical stall, flip cancel, landing restores jump/flip. Wavedashes, half-flips,
  speed-flips and flip resets are *not scripted*; they arise from these rules. Overturned car: roof contact re-enables the flip.
* **Ball** – radius 91.25 uu, mass 30, gravity 650, CCD, restitution 0.6 / friction 0.35 vs the arena (product of per-collider
  coefficients), 6000 uu/s and 6 rad/s caps. Rapier resolves the contact; a dedicated impulse `Δv = n·|v_rel|·f(|v_rel|)` is then
  added once per contact (n from the hit point in the car frame with the vertical component scaled 0.35, f = 0.65→0.30 curve),
  so nose/hood/roof/corner hits behave differently and powerful shots get extra power.
* **Arena** – 8192 × 10240 × 2044 uu, rounded plan-view corners, 260 uu floor/ceiling curves, goals 1785.5 × 642.8 uu with
  880 uu deep enclosed interiors, cylindrical posts/crossbar colliders, 34 boost pads. Goals count when the ball is fully across the line, once.
* **Match** – 3 s countdown, 5:00 clock, goal celebration → slow-motion (0.5×) replay (skippable) → kickoff, sudden-death overtime on a tie,
  pause/resume/restart/results. Free Play has resets, ball launch, unlimited-boost toggle and six practice presets.
* **AI** – outputs the same `controls` object as the keyboard (throttle, steer, pitch, roll, jump, boost, handbrake); it predicts
  the ball path, picks intercepts, aligns shots, collects boost, defends, dodges/aerials (All-Star), recovers in the air and
  rights itself. It cannot teleport or touch the ball.

## Verification

```bash
node tests/verify.mjs        # 36 checks: accel/brake/coast/steering/powerslide, tap vs hold jump, dodge, 5.5 rad/s cap,
                             #   wall climb + wall jump, ceiling driving, goal geometry/crossbar/backboard, ball hit variety,
                             #   boost pads, demolition + 3 s respawn, frame-rate independence (30–240 fps), 60 s fuzz test
node tests/camera_check.mjs  # camera smoothness during slaloms, powerslides, flips, aerial spins, wall driving
node tests/match_sim.mjs pro 150   # bot-vs-bot match, NaN / out-of-bounds / goal / replay checks
python3 -m http.server 8123 &  node tests/browser_smoke.mjs   # needs Playwright: loads page, plays Free Play, screenshots
```

## Honest limitations / approximations

* Rocket League uses Bullet with proprietary tuning; this is a **faithful re-implementation of the published reference values on Rapier**,
  not a bit-exact clone. Things approximated: wheel/tyre model (impulse-based friction circle instead of Bullet's raycast vehicle),
  flip torque constants (angular acceleration 55 rad/s² against the 5.5 rad/s cap), air-control constants, ball–car restitution/impulse
  curve, ball rolling resistance (Rapier has none; ball drag 0.03 + sliding friction), camera spring (own spring, not RL's).
* Arena: dimensions follow the standard field, but corner/ramp tessellation and radii are my own approximation (no RL mesh). Posts/crossbar
  are 30 uu-radius cylinders tangent to the goal opening. Rapier 0.12 has no `FIX_INTERNAL_EDGES` flag, so tiny ghost bumps on triangle seams are possible.
* 1v1 + Free Play only (no 2v2/3v3, no online). No boost-meter consumption cooldown subtleties, no kickoff-diagonal positions in 1v1.
* Verified in headless Chromium with software WebGL and in Node; I could not test on a physical GPU, real gamepad, or audibly
  (audio is synthesised and exercised for runtime errors only). A resolution-scaling governor lowers render resolution if FPS drops under 45.
* Demolition needs the attacker ≥ 2200 uu/s heading at the victim; bump impulses between cars come from Rapier's contact solver only.

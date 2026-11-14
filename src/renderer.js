// renderer.js — Three.js scene: arena visuals (built from the shared arena geometry), cars, ball,
// boost pads, particles, tire marks, crowd and lighting. Purely visual: never touches physics.
import * as THREE from '../vendor/three.module.min.js';
import { CFG, toUU } from './config.js';

const A = CFG.arena, CC = CFG.car;
const TEAM = [
  { body: 0x1f7cff, accent: 0x7fd0ff, glow: new THREE.Color(0.25, 0.65, 1.0), css: '#3b9bff' },
  { body: 0xff7a1a, accent: 0xffd08a, glow: new THREE.Color(1.0, 0.5, 0.12), css: '#ff8a2b' },
];
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _q = new THREE.Quaternion();
const Y_AXIS = new THREE.Vector3(0, 1, 0), SHADOW_TILT = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);

function canvasTex(w, h, draw, opts = {}) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  if (opts.repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; }
  if (opts.noFlip) t.flipY = false;
  return t;
}

// ---------------------------------------------------------------- particle system
class Particles {
  constructor(max, additive, scene) {
    this.max = max; this.n = 0; this.cursor = 0;
    this.pos = new Float32Array(max * 3); this.col = new Float32Array(max * 4); this.size = new Float32Array(max);
    this.vel = new Float32Array(max * 3); this.life = new Float32Array(max); this.maxLife = new Float32Array(max);
    this.s0 = new Float32Array(max); this.s1 = new Float32Array(max); this.a0 = new Float32Array(max);
    this.drag = new Float32Array(max); this.grav = new Float32Array(max); this.base = new Float32Array(max * 3);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 4));
    g.setAttribute('size', new THREE.BufferAttribute(this.size, 1));
    this.uniforms = { uScale: { value: 600 } };
    this.mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms, transparent: true, depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      vertexShader: 'attribute float size; attribute vec4 color; varying vec4 vC; uniform float uScale; void main(){ vC=color; vec4 mv=modelViewMatrix*vec4(position,1.0); gl_PointSize=max(size*uScale/-mv.z,0.0); gl_Position=projectionMatrix*mv; }',
      fragmentShader: 'varying vec4 vC; void main(){ float d=length(gl_PointCoord-0.5); float a=smoothstep(0.5,0.05,d); gl_FragColor=vec4(vC.rgb,vC.a*a); }',
    });
    this.points = new THREE.Points(g, this.mat); this.points.frustumCulled = false; scene.add(this.points);
    for (let i = 0; i < max; i++) { this.life[i] = 0; this.size[i] = 0; this.pos[i * 3 + 1] = -999; }
  }
  emit(x, y, z, vx, vy, vz, r, g, b, a, s0, s1, life, drag = 0, grav = 0) {
    const i = this.cursor; this.cursor = (this.cursor + 1) % this.max;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
    this.col[i * 4] = r; this.col[i * 4 + 1] = g; this.col[i * 4 + 2] = b; this.col[i * 4 + 3] = a;
    this.a0[i] = a; this.s0[i] = s0; this.s1[i] = s1; this.life[i] = life; this.maxLife[i] = life; this.drag[i] = drag; this.grav[i] = grav; this.size[i] = s0;
  }
  update(dt) {
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) { if (this.size[i] !== 0) { this.size[i] = 0; } continue; }
      this.life[i] -= dt;
      if (this.life[i] <= 0) { this.size[i] = 0; this.pos[i * 3 + 1] = -999; continue; }
      const t = 1 - this.life[i] / this.maxLife[i];
      const k = Math.exp(-this.drag[i] * dt);
      this.vel[i * 3] *= k; this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * k - this.grav[i] * dt; this.vel[i * 3 + 2] *= k;
      this.pos[i * 3] += this.vel[i * 3] * dt; this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt; this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      if (this.pos[i * 3 + 1] < 0.02 && this.grav[i] > 0) { this.pos[i * 3 + 1] = 0.02; this.vel[i * 3 + 1] *= -0.4; }
      this.size[i] = this.s0[i] + (this.s1[i] - this.s0[i]) * t;
      this.col[i * 4 + 3] = this.a0[i] * (1 - t) * (1 - t * 0.3);
    }
    const g = this.points.geometry;
    g.attributes.position.needsUpdate = true; g.attributes.color.needsUpdate = true; g.attributes.size.needsUpdate = true;
  }
}

// ---------------------------------------------------------------- car model
function buildCarModel(team) {
  const T = TEAM[team];
  const g = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({ color: T.body, metalness: 0.35, roughness: 0.38, envMapIntensity: 0.7 });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x15181f, metalness: 0.5, roughness: 0.45 });
  const glassMat = new THREE.MeshStandardMaterial({ color: 0x0a0f1c, metalness: 0.95, roughness: 0.06 });
  const accentMat = new THREE.MeshStandardMaterial({ color: T.accent, metalness: 0.3, roughness: 0.4, emissive: T.accent, emissiveIntensity: 0.35 });
  const profile = (pts, depth, mat, bevel) => {
    const s = new THREE.Shape(); s.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length; i++) s.lineTo(pts[i][0], pts[i][1]);
    const geo = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: !!bevel, bevelSize: bevel || 0, bevelThickness: bevel || 0, bevelSegments: 2, steps: 1 });
    geo.translate(0, 0, -depth / 2); geo.rotateY(Math.PI / 2);
    const m = new THREE.Mesh(geo, mat); return m;
  };
  g.add(profile([[-0.60, -0.12], [-0.62, -0.02], [-0.58, 0.05], [-0.30, 0.07], [-0.14, 0.185], [0.10, 0.19], [0.30, 0.06], [0.50, 0.03], [0.62, -0.02], [0.63, -0.10], [0.50, -0.14], [-0.50, -0.14]], 0.74, bodyMat, 0.03));
  g.add(profile([[-0.20, 0.07], [-0.11, 0.165], [0.09, 0.17], [0.25, 0.065]], 0.80, glassMat, 0.005));
  // racing stripe
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.012, 0.9), accentMat); stripe.position.set(0, 0.075, 0.32); g.add(stripe);
  // spoiler
  const wing = new THREE.Mesh(new THREE.BoxGeometry(0.78, 0.025, 0.2), bodyMat); wing.position.set(0, 0.2, 0.55); g.add(wing);
  for (const sx of [-1, 1]) { const st = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.12, 0.07), darkMat); st.position.set(sx * 0.2, 0.14, 0.55); g.add(st);
    const ep = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.07, 0.22), accentMat); ep.position.set(sx * 0.39, 0.2, 0.55); g.add(ep); }
  // lights
  const lightMat = new THREE.MeshBasicMaterial({ color: 0xfff6d8 });
  const tailMat = new THREE.MeshBasicMaterial({ color: 0xff2a2a });
  for (const sx of [-1, 1]) {
    const hl = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.04, 0.02), lightMat); hl.position.set(sx * 0.24, -0.015, -0.628); g.add(hl);
    const tl = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.035, 0.02), tailMat); tl.position.set(sx * 0.25, 0.0, 0.62); g.add(tl);
  }
  // front splitter + side skirts + underbody
  const split = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.02, 0.1), darkMat); split.position.set(0, -0.145, -0.6); g.add(split);
  const under = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.03, 1.2), darkMat); under.position.set(0, -0.145, 0); g.add(under);
  // exhausts + boost flames
  const flames = [];
  const flameMat = new THREE.MeshBasicMaterial({ color: T.glow, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false });
  const coreMat = new THREE.MeshBasicMaterial({ color: 0xcfe8ff, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false });
  for (const sx of [-1, 1]) {
    const ex = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.06, 0.1, 12), darkMat); ex.rotation.x = Math.PI / 2; ex.position.set(sx * 0.17, -0.07, 0.64); g.add(ex);
    const fg = new THREE.ConeGeometry(0.06, 0.6, 12, 1, true); fg.translate(0, 0.3, 0); fg.rotateX(Math.PI / 2);
    const f = new THREE.Mesh(fg, flameMat); f.position.set(sx * 0.17, -0.07, 0.69); f.visible = false; g.add(f);
    const cg = new THREE.ConeGeometry(0.03, 0.3, 10, 1, true); cg.translate(0, 0.15, 0); cg.rotateX(Math.PI / 2);
    const c = new THREE.Mesh(cg, coreMat); c.position.copy(f.position); c.visible = false; g.add(c);
    flames.push(f, c);
  }
  // wheels
  const wheels = [];
  const tireMat = new THREE.MeshStandardMaterial({ color: 0x0d0d10, roughness: 0.85, metalness: 0.05 });
  const rimMat = new THREE.MeshStandardMaterial({ color: 0xd8dde8, metalness: 0.9, roughness: 0.25 });
  const defs = [[-CC.wheelX, CC.wheelZFront, true], [CC.wheelX, CC.wheelZFront, true], [-CC.wheelX, CC.wheelZRear, false], [CC.wheelX, CC.wheelZRear, false]];
  for (const [x, z, front] of defs) {
    const pivot = new THREE.Group(); pivot.position.set(x, -0.065, z);
    const spin = new THREE.Group(); pivot.add(spin);
    const r = front ? CC.wheelRadius * 0.95 : CC.wheelRadius * 1.05;
    const tire = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 0.17, 24), tireMat); tire.rotation.z = Math.PI / 2; spin.add(tire);
    const rim = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.66, r * 0.66, 0.178, 18), rimMat); rim.rotation.z = Math.PI / 2; spin.add(rim);
    for (let i = 0; i < 5; i++) {
      const sp = new THREE.Mesh(new THREE.BoxGeometry(0.182, r * 0.12, r * 1.2), darkMat); sp.rotation.x = (i / 5) * Math.PI; spin.add(sp);
    }
    g.add(pivot); wheels.push({ pivot, spin, front, baseY: -0.065, radius: r, x, z });
  }
  g.traverse((o) => { if (o.isMesh) { o.frustumCulled = true; } });
  return { group: g, wheels, flames, bodyMat };
}

// ---------------------------------------------------------------- renderer
export class Renderer {
  constructor(canvas, geo, bus) {
    this.canvas = canvas; this.geo = geo; this.bus = bus;
    this.gl = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.gl.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
    this.gl.outputColorSpace = THREE.SRGBColorSpace;
    this.gl.toneMapping = THREE.ACESFilmicToneMapping; this.gl.toneMappingExposure = 0.95;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(70, 16 / 9, 0.1, 600);
    this.time = 0; this.carViews = new Map(); this.padViews = []; this.flash = 0; this.rings = [];
    this.buildEnvironmentMap(); this.buildLights(); this.buildArena(); this.buildStands(); this.buildSky(); this.buildPads();
    this.buildBall(); this.buildEffects(); this.buildShowcase();
    this.resize();
    this.subscribe();
  }

  // adaptive resolution: keep the frame rate near 60 on slower GPUs
  adaptQuality(fps, dt) {
    this._q = this._q || { scale: Math.min(window.devicePixelRatio || 1, 1.75), max: Math.min(window.devicePixelRatio || 1, 1.75), low: 0, high: 0 };
    const q = this._q;
    if (fps < 45) { q.low += dt; q.high = 0; } else if (fps > 57) { q.high += dt; q.low = 0; } else { q.low = q.high = 0; }
    let changed = false;
    if (q.low > 1.5 && q.scale > 0.6) { q.scale = Math.max(0.6, q.scale - 0.15); q.low = 0; changed = true; }
    if (q.high > 6 && q.scale < q.max) { q.scale = Math.min(q.max, q.scale + 0.1); q.high = 0; changed = true; }
    if (changed) { this.gl.setPixelRatio(q.scale); this.resize(); }
  }

  resize() {
    const w = this.canvas.clientWidth || window.innerWidth, h = this.canvas.clientHeight || window.innerHeight;
    this.gl.setSize(w, h, false); this.width = w; this.height = h;
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    return w / h;
  }

  // ------------------------------------------------------------ environment
  buildEnvironmentMap() {
    const env = new THREE.Scene();
    const sky = new THREE.Mesh(new THREE.SphereGeometry(50, 24, 12), new THREE.MeshBasicMaterial({
      side: THREE.BackSide, vertexColors: true }));
    const pos = sky.geometry.attributes.position, cols = [];
    for (let i = 0; i < pos.count; i++) { const t = (pos.getY(i) / 50 + 1) / 2; cols.push(0.06 + t * 0.25, 0.08 + t * 0.3, 0.16 + t * 0.55); }
    sky.geometry.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3)); env.add(sky);
    for (let i = 0; i < 6; i++) { const p = new THREE.Mesh(new THREE.BoxGeometry(18, 0.5, 6), new THREE.MeshBasicMaterial({ color: new THREE.Color(6, 6, 6.5) })); p.position.set((i - 2.5) * 14, 40, (i % 2) * 18 - 9); env.add(p); }
    const pm = new THREE.PMREMGenerator(this.gl);
    this.scene.environment = pm.fromScene(env, 0.03).texture; this.scene.environmentIntensity = 0.45;
    pm.dispose();
  }

  buildLights() {
    this.scene.add(new THREE.HemisphereLight(0x9bb4ff, 0x30283a, 0.55));
    const sun = new THREE.DirectionalLight(0xffffff, 0.85); sun.position.set(18, 60, 10); this.scene.add(sun);
    this.blueLight = new THREE.PointLight(0x3a8cff, 260, 70, 1.6); this.blueLight.position.set(0, 18, -28); this.scene.add(this.blueLight);
    this.orangeLight = new THREE.PointLight(0xff8a2a, 260, 70, 1.6); this.orangeLight.position.set(0, 18, 28); this.scene.add(this.orangeLight);
    this.flashLight = new THREE.PointLight(0xffffff, 0, 120, 1.2); this.flashLight.position.set(0, 14, 0); this.scene.add(this.flashLight);
  }

  buildSky() {
    const sky = new THREE.Mesh(new THREE.SphereGeometry(300, 24, 12), new THREE.MeshBasicMaterial({ side: THREE.BackSide, vertexColors: true, fog: false }));
    const pos = sky.geometry.attributes.position, cols = [];
    for (let i = 0; i < pos.count; i++) { const t = clamp(pos.getY(i) / 300, -0.3, 1); cols.push(0.02 + t * 0.05, 0.03 + t * 0.06, 0.07 + t * 0.14); }
    sky.geometry.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3)); this.scene.add(sky);
    this.scene.fog = new THREE.FogExp2(0x070a16, 0.0035);
  }

  // ------------------------------------------------------------ arena
  buildArena() {
    const { floor, shell, goalBlue, goalOrange } = this.geo.groups;
    const W = A.halfWidth, L = A.halfLength;
    const mk = (g) => {
      const bg = new THREE.BufferGeometry();
      bg.setAttribute('position', new THREE.BufferAttribute(g.positions, 3));
      bg.setAttribute('normal', new THREE.BufferAttribute(g.normals, 3));
      bg.setAttribute('uv', new THREE.BufferAttribute(g.uvs, 2));
      bg.setIndex(new THREE.BufferAttribute(g.indices, 1));
      return bg;
    };
    // floor texture with field markings
    const floorTex = canvasTex(1024, 1280, (c, w, h) => {
      const gr = c.createLinearGradient(0, 0, 0, h);
      gr.addColorStop(0, '#102a52'); gr.addColorStop(0.47, '#17345f'); gr.addColorStop(0.5, '#1a2a44'); gr.addColorStop(0.53, '#4a2f2c'); gr.addColorStop(1, '#5a2e1a');
      c.fillStyle = gr; c.fillRect(0, 0, w, h);
      c.strokeStyle = 'rgba(255,255,255,0.05)'; c.lineWidth = 1;
      for (let x = 0; x <= w; x += w / 16) { c.beginPath(); c.moveTo(x, 0); c.lineTo(x, h); c.stroke(); }
      for (let y = 0; y <= h; y += h / 20) { c.beginPath(); c.moveTo(0, y); c.lineTo(w, y); c.stroke(); }
      c.strokeStyle = 'rgba(255,255,255,0.75)'; c.lineWidth = 5;
      const sx = w / (2 * W), sz = h / (2 * L);
      const P = (x, z) => [(x + W) * sx, (z + L) * sz];
      c.beginPath(); c.moveTo(...P(-W, 0)); c.lineTo(...P(W, 0)); c.stroke();
      c.beginPath(); c.ellipse(...P(0, 0), 9.2 * sx, 9.2 * sz, 0, 0, Math.PI * 2); c.stroke();
      c.beginPath(); c.arc(...P(0, 0), 0.5 * sx, 0, Math.PI * 2); c.fillStyle = '#fff'; c.fill();
      // goal boxes
      c.lineWidth = 4;
      for (const s of [-1, 1]) {
        const col = s < 0 ? 'rgba(90,170,255,0.9)' : 'rgba(255,150,70,0.9)'; c.strokeStyle = col;
        c.strokeRect(...P(-18, s < 0 ? -L : L - 12.5), 36 * sx, 12.5 * sz);
        c.beginPath(); c.ellipse(...P(0, s * (L - 12.5)), 12 * sx, 5 * sz, 0, s < 0 ? 0 : Math.PI, s < 0 ? Math.PI : Math.PI * 2); c.stroke();
      }
      c.strokeStyle = 'rgba(255,255,255,0.6)'; c.lineWidth = 6; c.strokeRect(2, 2, w - 4, h - 4);
    }, { noFlip: true });
    const floorMat = new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.55, metalness: 0.12, envMapIntensity: 0.6 });
    this.floorMesh = new THREE.Mesh(mk(floor), floorMat); this.scene.add(this.floorMesh);

    // wall / ramp / ceiling shell (vertex colour + alpha tint by team side and height)
    const sg = mk(shell); const sp = shell.positions, colors = new Float32Array((sp.length / 3) * 4);
    for (let i = 0; i < sp.length / 3; i++) {
      const y = sp[i * 3 + 1], z = sp[i * 3 + 2];
      const t = clamp(z / L, -1, 1); const side = Math.abs(t) > 0.15 ? Math.min(1, (Math.abs(t) - 0.15) / 0.6) : 0;
      const r = 0.35 + (t > 0 ? side * 0.65 : -side * 0.15), gg = 0.45 + (t > 0 ? side * 0.1 : side * 0.1), b = 0.8 + (t < 0 ? side * 0.2 : -side * 0.5);
      let a;
      if (y > A.height - A.ceilingRampRadius * 0.5) a = 0.92; else if (y < A.floorRampRadius + 0.01) a = 0.8; else a = 0.3 + 0.35 * Math.pow(Math.min(1, Math.abs(y - A.height / 2) / (A.height / 2)), 2);
      colors[i * 4] = r; colors[i * 4 + 1] = gg; colors[i * 4 + 2] = b; colors[i * 4 + 3] = a;
    }
    sg.setAttribute('color', new THREE.BufferAttribute(colors, 4));
    const panel = canvasTex(256, 256, (c, w, h) => {
      c.fillStyle = '#28365a'; c.fillRect(0, 0, w, h);
      c.strokeStyle = 'rgba(150,190,255,0.55)'; c.lineWidth = 3;
      const s = 64; for (let y = 0; y <= h; y += s) for (let x = 0; x <= w; x += s) { c.strokeRect(x + 3, y + 3, s - 6, s - 6); }
      c.fillStyle = 'rgba(255,255,255,0.05)'; for (let i = 0; i < 40; i++) c.fillRect(Math.random() * w, Math.random() * h, 3, 3);
    }, { repeat: true });
    const shellMat = new THREE.MeshStandardMaterial({ map: panel, vertexColors: true, transparent: true, side: THREE.DoubleSide, roughness: 0.75, metalness: 0.2, emissive: 0x16224a, emissiveIntensity: 0.9, depthWrite: false });
    this.shellMesh = new THREE.Mesh(sg, shellMat); this.shellMesh.renderOrder = 2; this.scene.add(this.shellMesh);

    // goals: net texture + team glow
    const net = (color) => canvasTex(256, 256, (c, w, h) => {
      c.fillStyle = 'rgba(8,12,24,0.0)'; c.clearRect(0, 0, w, h);
      c.strokeStyle = color; c.lineWidth = 2; c.globalAlpha = 0.85;
      for (let i = 0; i <= 8; i++) { c.beginPath(); c.moveTo((i * w) / 8, 0); c.lineTo((i * w) / 8, h); c.stroke(); c.beginPath(); c.moveTo(0, (i * h) / 8); c.lineTo(w, (i * h) / 8); c.stroke(); }
    }, { repeat: true });
    const goalMesh = (g, team) => {
      const m = new THREE.Mesh(mk(g), new THREE.MeshStandardMaterial({ map: net(team ? '#ffb070' : '#7cc4ff'), transparent: true, opacity: 0.8, side: THREE.DoubleSide, emissive: team ? 0x7a3510 : 0x103a7a, emissiveIntensity: 0.9, roughness: 0.6, depthWrite: false }));
      m.geometry.attributes.uv.array.forEach((v, i, a) => { a[i] = v * 6; });
      this.scene.add(m); return m;
    };
    goalMesh(goalBlue, 0); goalMesh(goalOrange, 1);
    // goal frame meshes (same cylinders as the colliders)
    for (const f of this.geo.frame) {
      const team = f.z < 0 ? 0 : 1;
      const mat = new THREE.MeshStandardMaterial({ color: TEAM[team].body, emissive: TEAM[team].body, emissiveIntensity: 0.6, metalness: 0.5, roughness: 0.3 });
      let m;
      if (f.kind === 'post') { m = new THREE.Mesh(new THREE.CylinderGeometry(f.radius, f.radius, f.halfHeight * 2, 14), mat); m.position.set(f.x, f.y, f.z); }
      else { m = new THREE.Mesh(new THREE.CylinderGeometry(f.radius, f.radius, f.halfLength * 2, 14), mat); m.rotation.z = Math.PI / 2; m.position.set(f.x, f.y, f.z); }
      this.scene.add(m);
    }
    // goal-mouth glow slabs (visual team zone)
    for (const s of [-1, 1]) {
      const p = new THREE.Mesh(new THREE.PlaneGeometry(A.goalHalfWidth * 2, A.goalHeight), new THREE.MeshBasicMaterial({ color: TEAM[s < 0 ? 0 : 1].body, transparent: true, opacity: 0.06, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }));
      p.position.set(0, A.goalHeight / 2, s * (A.halfLength + A.goalDepth * 0.5)); this.scene.add(p);
    }
    // ceiling light bars
    const barMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 2.2, 2.4) });
    for (let i = -4; i <= 4; i++) { const bar = new THREE.Mesh(new THREE.BoxGeometry(A.halfWidth * 1.4, 0.12, 0.5), barMat); bar.position.set(0, A.height - 0.08, i * 10); this.scene.add(bar); }
  }

  buildStands() {
    const n = 2600, m = new THREE.InstancedMesh(new THREE.BoxGeometry(0.7, 1.1, 0.7), new THREE.MeshStandardMaterial({ roughness: 0.9 }), n);
    const d = new THREE.Object3D(), col = new THREE.Color(); let k = 0;
    const W = A.halfWidth, L = A.halfLength;
    const palette = [0x2b3a6b, 0x6b2b2b, 0x2b6b4a, 0x5b4a2b, 0x40406b, 0x8a8a9a, 0x1e2a44, 0x7a3b66];
    const place = (x, y, z) => { if (k >= n) return; d.position.set(x, y, z); d.scale.setScalar(0.85 + Math.random() * 0.3); d.updateMatrix(); m.setMatrixAt(k, d.matrix);
      col.setHex(palette[(Math.random() * palette.length) | 0]).multiplyScalar(0.7 + Math.random() * 0.6); m.setColorAt(k, col); k++; };
    for (let row = 0; row < 9; row++) {
      const off = 4.5 + row * 1.5, y = 1 + row * 1.25;
      for (let z = -L + 14; z <= L - 14; z += 1.5) { place(-W - off, y, z + (Math.random() - 0.5) * 0.3); place(W + off, y, z + (Math.random() - 0.5) * 0.3); }
      for (let x = -W + 14; x <= W - 14; x += 1.5) { if (row > 1) { place(x, y, -L - off - A.goalDepth * 0.6); place(x, y, L + off + A.goalDepth * 0.6); } }
    }
    m.count = k; m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; this.scene.add(m);
    // stand terraces
    const terr = new THREE.MeshStandardMaterial({ color: 0x0d1220, roughness: 1 });
    for (const s of [-1, 1]) {
      const t = new THREE.Mesh(new THREE.BoxGeometry(30, 1, L * 2 + 40), terr); t.position.set(s * (W + 20), -0.6, 0); this.scene.add(t);
      const t2 = new THREE.Mesh(new THREE.BoxGeometry(W * 2 + 60, 1, 40), terr); t2.position.set(0, -0.6, s * (L + 28)); this.scene.add(t2);
    }
    // camera flash twinkles
    const N = 220, pos = new Float32Array(N * 3), seed = new Float32Array(N);
    for (let i = 0; i < N; i++) { const side = Math.random() < 0.5 ? -1 : 1; pos[i * 3] = side * (W + 6 + Math.random() * 14); pos[i * 3 + 1] = 3 + Math.random() * 11; pos[i * 3 + 2] = (Math.random() * 2 - 1) * (L - 5); seed[i] = Math.random() * 100; }
    const fg = new THREE.BufferGeometry(); fg.setAttribute('position', new THREE.BufferAttribute(pos, 3)); fg.setAttribute('seed', new THREE.BufferAttribute(seed, 1));
    this.twinkle = { value: 0 };
    const fm = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, uniforms: { uT: this.twinkle, uScale: { value: 600 } },
      vertexShader: 'attribute float seed; uniform float uT; uniform float uScale; varying float vA; void main(){ float ph=fract(uT*0.35+seed*0.137); vA=smoothstep(0.0,0.04,ph)*smoothstep(0.12,0.04,ph); vec4 mv=modelViewMatrix*vec4(position,1.0); gl_PointSize=vA*1.6*uScale/-mv.z; gl_Position=projectionMatrix*mv; }',
      fragmentShader: 'varying float vA; void main(){ float d=length(gl_PointCoord-0.5); gl_FragColor=vec4(vec3(1.0),vA*smoothstep(0.5,0.0,d)); }' });
    this.twinkleUniforms = fm.uniforms; const fp = new THREE.Points(fg, fm); fp.frustumCulled = false; this.scene.add(fp);
  }

  // ------------------------------------------------------------ boost pads
  buildPads() {
    const baseGeo = new THREE.CylinderGeometry(0.95, 1.05, 0.06, 6), bigBase = new THREE.CylinderGeometry(1.45, 1.55, 0.08, 8);
    const orbGeo = new THREE.IcosahedronGeometry(0.62, 1);
    const beamGeo = new THREE.CylinderGeometry(0.9, 1.2, 7, 16, 1, true); beamGeo.translate(0, 3.5, 0);
    for (const p of this.geo.boostPads) {
      const grp = new THREE.Group(); grp.position.set(p.x, 0.04, p.z);
      const mat = new THREE.MeshStandardMaterial({ color: 0xffb02e, emissive: 0xff8a00, emissiveIntensity: 0.9, metalness: 0.3, roughness: 0.4 });
      const base = new THREE.Mesh(p.large ? bigBase : baseGeo, mat); grp.add(base);
      const arrow = new THREE.Mesh(new THREE.ConeGeometry(0.4, 0.8, 3), new THREE.MeshBasicMaterial({ color: 0xfff0b0 })); arrow.rotation.x = -Math.PI / 2; arrow.position.y = 0.06; arrow.scale.set(1, 1, 0.2); grp.add(arrow);
      let orb = null, beam = null;
      if (p.large) {
        orb = new THREE.Mesh(orbGeo, new THREE.MeshBasicMaterial({ color: 0xffd06a, transparent: true, opacity: 0.95 })); orb.position.y = 1.4; grp.add(orb);
        beam = new THREE.Mesh(beamGeo, new THREE.MeshBasicMaterial({ color: 0xffa020, transparent: true, opacity: 0.16, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide })); grp.add(beam);
      }
      this.scene.add(grp); this.padViews.push({ grp, mat, orb, beam, base, arrow, pad: p, glow: 1, spawnAnim: 1 });
    }
  }

  // ------------------------------------------------------------ ball
  buildBall() {
    const R = CFG.ball.radius;
    const tex = canvasTex(512, 256, (c, w, h) => {
      c.fillStyle = '#e8edf8'; c.fillRect(0, 0, w, h);
      c.strokeStyle = '#263055'; c.lineWidth = 4;
      for (let y = 0; y < h; y += 64) for (let x = 0; x < w; x += 64) {
        const ox = (y / 64) % 2 ? 32 : 0; c.beginPath();
        for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; const px = x + ox + 32 + Math.cos(a) * 30, py = y + 32 + Math.sin(a) * 30; i ? c.lineTo(px, py) : c.moveTo(px, py); }
        c.closePath(); c.stroke(); if (((x / 64) + (y / 64)) % 3 === 0) { c.fillStyle = '#34406e'; c.fill(); }
      }
    });
    this.ballMat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.28, metalness: 0.25, emissive: 0x223355, emissiveIntensity: 0.35 });
    this.ballMesh = new THREE.Mesh(new THREE.SphereGeometry(R, 40, 28), this.ballMat); this.scene.add(this.ballMesh);
    this.ballGlow = new THREE.Mesh(new THREE.SphereGeometry(R * 1.12, 24, 16), new THREE.MeshBasicMaterial({ color: 0x66aaff, transparent: true, opacity: 0.0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.BackSide }));
    this.scene.add(this.ballGlow);
    this.ballShadow = this.makeShadow(R * 1.3); this.ballTrail = 0;
  }

  makeShadow(r) {
    const tex = canvasTex(64, 64, (c, w, h) => { const g = c.createRadialGradient(32, 32, 2, 32, 32, 32); g.addColorStop(0, 'rgba(0,0,0,0.85)'); g.addColorStop(1, 'rgba(0,0,0,0)'); c.fillStyle = g; c.fillRect(0, 0, w, h); });
    const m = new THREE.Mesh(new THREE.PlaneGeometry(r * 2, r * 2), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }));
    m.rotation.x = -Math.PI / 2; m.renderOrder = 1; this.scene.add(m); m.userData.r = r; return m;
  }

  // ------------------------------------------------------------ effects
  buildEffects() {
    this.addP = new Particles(2600, true, this.scene);       // additive: flames, sparks, explosions
    this.smokeP = new Particles(1400, false, this.scene);    // normal: dust, smoke
    // tire marks
    this.markMax = 1800; this.markN = 0; this.markPtr = 0;
    const mg = new THREE.BufferGeometry();
    this.markPos = new Float32Array(this.markMax * 4 * 3); this.markCol = new Float32Array(this.markMax * 4 * 4);
    const idx = new Uint32Array(this.markMax * 6);
    for (let i = 0; i < this.markMax; i++) { const b = i * 4; idx.set([b, b + 1, b + 2, b + 2, b + 1, b + 3], i * 6); }
    mg.setAttribute('position', new THREE.BufferAttribute(this.markPos, 3)); mg.setAttribute('color', new THREE.BufferAttribute(this.markCol, 4)); mg.setIndex(new THREE.BufferAttribute(idx, 1));
    this.markMesh = new THREE.Mesh(mg, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3 }));
    this.markMesh.frustumCulled = false; this.markMesh.renderOrder = 1; this.scene.add(this.markMesh);
    // expanding shock rings
    this.ringGeo = new THREE.RingGeometry(0.85, 1.0, 48);
  }

  addRing(pos, color, maxR, life, vertical = false) {
    const m = new THREE.Mesh(this.ringGeo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    m.position.copy(pos); if (!vertical) m.rotation.x = -Math.PI / 2; this.scene.add(m);
    this.rings.push({ m, t: 0, life, maxR });
  }

  burst(pos, n, speed, color, size = 0.3, life = 0.8, additive = true, grav = 6) {
    const P = additive ? this.addP : this.smokeP;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, e = Math.acos(2 * Math.random() - 1), s = speed * (0.3 + Math.random() * 0.7);
      P.emit(pos.x, pos.y, pos.z, Math.sin(e) * Math.cos(a) * s, Math.cos(e) * s, Math.sin(e) * Math.sin(a) * s, color.r, color.g, color.b, 1, size, size * 0.3, life * (0.5 + Math.random() * 0.8), 1.2, grav);
    }
  }

  subscribe() {
    const b = this.bus;
    b.on('ballHit', (e) => {
      const p = clamp(toUU(e.power) / 2300, 0.1, 1.6);
      const t = TEAM[e.car.team].glow; this.burst(e.point, Math.round(10 + p * 26), 6 + p * 12, new THREE.Color(1, 0.9, 0.6).lerp(t, 0.4), 0.16, 0.5);
      if (p > 0.45) this.addRing(e.point, TEAM[e.car.team].body, 1.2 + p * 2, 0.35, true);
      this.ballGlowT = 1; this.glowTeam = e.car.team; this.camShake = Math.max(this.camShake || 0, p * 0.5);
    });
    b.on('ballImpact', (e) => { if (e.power > 5) this.burst(e.pos, 8, 5, new THREE.Color(0.8, 0.9, 1), 0.14, 0.4); });
    b.on('land', (e) => { const c = e.car; if (e.power > 0.2) for (const w of c.wheels) if (w.contact) this.dust(_v.set(w.px, 0.05, w.pz), 2, 3 * e.power); });
    b.on('padPickup', (e) => { const v = this.padViews[e.pad.id]; if (v) { v.spawnAnim = 0; } const pp = _v.set(e.pad.x, 0.2, e.pad.z); this.burst(pp, e.pad.large ? 36 : 12, e.pad.large ? 9 : 5, new THREE.Color(1, 0.75, 0.2), 0.2, 0.7); if (e.pad.large) this.addRing(pp, 0xffc040, 4, 0.5); });
    b.on('goal', (e) => {
      const col = TEAM[e.team].glow, pos = e.ball.clone(); pos.y = Math.max(pos.y, 1.5);
      this.burst(pos, 320, 26, col, 0.55, 1.8, true, 4); this.burst(pos, 160, 38, new THREE.Color(1, 1, 1), 0.3, 1.4, true, 3);
      this.addRing(pos, TEAM[e.team].body, 16, 1.0, true); this.addRing(new THREE.Vector3(pos.x, 0.1, pos.z), TEAM[e.team].body, 22, 1.2);
      this.flash = 1; this.flashColor = TEAM[e.team].body; this.camShake = 1.2;
    });
    b.on('demolish', (e) => { const p = e.pos; this.burst(p, 140, 18, new THREE.Color(1, 0.55, 0.2), 0.45, 1.1); this.burst(p, 80, 12, new THREE.Color(0.4, 0.45, 0.5), 0.6, 1.4, false, 2); this.addRing(p, 0xff8030, 6, 0.6); this.camShake = 0.8; });
    b.on('carBump', (e) => { if (e.power > 4) { _v.copy(e.a.currT).add(e.b.currT).multiplyScalar(0.5); this.burst(_v, 14, 6, new THREE.Color(1, 0.9, 0.6), 0.14, 0.4); } });
    b.on('jump', (e) => { for (const w of e.car.wheels) this.dust(_v.set(w.px, 0.05, w.pz), 1, 2); });
    b.on('dodge', (e) => { _v.copy(e.car.currT); this.burst(_v, 12, 4, TEAM[e.car.team].glow, 0.12, 0.4, true, 0); });
  }

  dust(p, n, s) { for (let i = 0; i < n; i++) this.smokeP.emit(p.x + (Math.random() - 0.5) * 0.3, p.y, p.z + (Math.random() - 0.5) * 0.3, (Math.random() - 0.5) * s, Math.random() * s * 0.6, (Math.random() - 0.5) * s, 0.7, 0.74, 0.82, 0.16, 0.2, 0.9, 0.8, 1.8, -0.3); }

  // ------------------------------------------------------------ car views
  getCarView(car) {
    let v = this.carViews.get(car);
    if (!v) {
      const model = buildCarModel(car.team); this.scene.add(model.group);
      const shadow = this.makeShadow(1.0); shadow.scale.set(1.15, 1, 1.8);
      v = { car, model, shadow, wheelY: [0, 0, 0, 0], lastMark: [null, null, null, null], flame: 0 }; this.carViews.set(car, v);
    }
    return v;
  }
  dropCars(cars) {
    for (const [c, v] of this.carViews) if (!cars.includes(c)) { this.scene.remove(v.model.group); this.scene.remove(v.shadow); this.carViews.delete(c); }
  }

  buildShowcase() {
    this.showcase = new THREE.Group();
    const a = buildCarModel(0), b = buildCarModel(1);
    a.group.position.set(-3, 0.205, -42); a.group.rotation.y = Math.PI * 0.85; b.group.position.set(3, 0.205, 42); b.group.rotation.y = -Math.PI * 0.15;
    this.showcase.add(a.group, b.group); this.showcase.visible = false; this.scene.add(this.showcase);
  }

  // ------------------------------------------------------------ per-frame update
  updateCar(v, dt, replay) {
    const car = v.car, g = v.model.group;
    const hidden = car.demolished || car.replayHidden;
    g.visible = !hidden; v.shadow.visible = !hidden;
    if (hidden) return;
    g.position.copy(car.rPos); g.quaternion.copy(car.rQuat);
    const boosting = replay ? car.replayBoost : car.boosting;
    // wheels from suspension state
    v.model.wheels.forEach((w, i) => {
      const cw = car.wheels[i];
      const ty = replay ? w.baseY : (-CC.wheelAttachY * 0 + CC.wheelAttachY - Math.min(cw.dist ?? car.rayLen, car.rayLen) + w.radius);
      v.wheelY[i] += (ty - v.wheelY[i]) * (1 - Math.exp(-dt * 30)); if (!isFinite(v.wheelY[i])) v.wheelY[i] = w.baseY;
      w.pivot.position.y = v.wheelY[i];
      w.pivot.rotation.y = w.front ? -(cw.steer || 0) : 0;
      w.spin.rotation.x = -(cw.spin || 0);
    });
    // boost flames
    v.flame += ((boosting ? 1 : 0) - v.flame) * (1 - Math.exp(-dt * (boosting ? 30 : 12)));
    const fl = v.flame, fk = 0.75 + Math.random() * 0.5;
    v.model.flames.forEach((m, i) => { m.visible = fl > 0.05; m.scale.set(1, 1, fl * fk * (i % 2 ? 0.6 : 1)); });
    // shadow
    const y = car.rPos.y, up = _w.set(0, 1, 0).applyQuaternion(car.rQuat);
    v.shadow.visible = up.y > 0.3 || y < 3;
    v.shadow.position.set(car.rPos.x, 0.025, car.rPos.z); v.shadow.material.opacity = clamp(0.8 - y / 7, 0, 0.8);
    _v.set(0, 0, -1).applyQuaternion(car.rQuat);
    v.shadow.quaternion.setFromAxisAngle(Y_AXIS, Math.atan2(-_v.x, -_v.z)).multiply(SHADOW_TILT);
    if (replay) return;
    // particle emitters
    const sp = car.speed;
    if (boosting) {
      const col = TEAM[car.team].glow;
      for (const sx of [-1, 1]) {
        _v.set(sx * 0.17, -0.07, 0.7).applyQuaternion(car.rQuat).add(car.rPos);
        _w.copy(car.fwd).multiplyScalar(-9).addScaledVector(car.vel, 0.45);
        for (let k = 0; k < 2; k++) this.addP.emit(_v.x, _v.y, _v.z, _w.x + (Math.random() - 0.5) * 2, _w.y + (Math.random() - 0.5) * 2, _w.z + (Math.random() - 0.5) * 2, col.r * 1.2, col.g * 1.1, col.b * 1.1 + 0.2, 0.9, 0.34, 0.06, 0.35, 2.5, 0);
        this.addP.emit(_v.x, _v.y, _v.z, _w.x * 0.5, _w.y * 0.5, _w.z * 0.5, 1, 0.95, 0.85, 1, 0.22, 0.04, 0.22, 3, 0);
      }
    }
    if (car.supersonic) {
      _v.set(0, 0, 0.5).applyQuaternion(car.rQuat).add(car.rPos);
      const col = TEAM[car.team].glow;
      this.addP.emit(_v.x, _v.y, _v.z, 0, 0, 0, col.r * 0.6 + 0.4, col.g * 0.6 + 0.4, col.b * 0.6 + 0.4, 0.55, 0.28, 0.02, 0.5, 0, 0);
      for (const sx of [-1, 1]) { _v.set(sx * 0.42, 0, 0.3).applyQuaternion(car.rQuat).add(car.rPos); this.addP.emit(_v.x, _v.y, _v.z, 0, 0, 0, 0.7, 0.85, 1, 0.5, 0.12, 0.01, 0.4, 0, 0); }
    }
    // tire marks & dust
    car.wheels.forEach((w, i) => {
      const slipping = w.contact && Math.abs(w.slip) > 3.2 && w.ny > 0.9;
      if (slipping) {
        const x = w.px, z = w.pz, last = v.lastMark[i];
        if (last && (last.x - x) ** 2 + (last.z - z) ** 2 > 0.04 && (last.x - x) ** 2 + (last.z - z) ** 2 < 25) this.addMark(last, { x, z }, clamp(Math.abs(w.slip) / 12, 0.2, 0.7));
        if (!last || (last.x - x) ** 2 + (last.z - z) ** 2 > 0.04) v.lastMark[i] = { x, z };
        if (Math.random() < 0.5) this.dust(_v.set(x, 0.05, z), 1, 2.2);
      } else v.lastMark[i] = null;
      if (w.contact && sp > 18 && Math.random() < 0.12 && w.ny > 0.9) this.dust(_v.set(w.px, 0.05, w.pz), 1, 1.2);
    });
  }

  addMark(a, b, alpha) {
    const dx = b.x - a.x, dz = b.z - a.z, l = Math.hypot(dx, dz) || 1, nx = -dz / l * 0.07, nz = dx / l * 0.07;
    const i = this.markPtr, o = i * 12, c = i * 16, y = 0.012;
    const P = this.markPos; P[o] = a.x + nx; P[o + 1] = y; P[o + 2] = a.z + nz; P[o + 3] = a.x - nx; P[o + 4] = y; P[o + 5] = a.z - nz;
    P[o + 6] = b.x + nx; P[o + 7] = y; P[o + 8] = b.z + nz; P[o + 9] = b.x - nx; P[o + 10] = y; P[o + 11] = b.z - nz;
    for (let k = 0; k < 4; k++) { this.markCol[c + k * 4] = 0.02; this.markCol[c + k * 4 + 1] = 0.02; this.markCol[c + k * 4 + 2] = 0.03; this.markCol[c + k * 4 + 3] = alpha; }
    this.markPtr = (this.markPtr + 1) % this.markMax; this.markN = Math.min(this.markMax, this.markN + 1); this.markDirty = true;
  }

  // match: Match instance, camera: GameCamera (for aspect/fov uniforms)
  render(match, dt, mode) {
    this.time += dt;
    const replay = match.state === 'replay';
    const inMatch = match.mode !== 'menu';
    this.showcase.visible = !inMatch;
    this.dropCars(match.cars);
    // ball
    const bq = match.rBall.quat, bp = match.rBall.pos;
    this.ballMesh.position.copy(bp); this.ballMesh.quaternion.copy(bq); this.ballGlow.position.copy(bp);
    this.ballGlowT = Math.max(0, (this.ballGlowT || 0) - dt * 1.6);
    const gm = this.ballGlow.material; gm.opacity = this.ballGlowT * 0.55; if (this.glowTeam !== undefined) gm.color.copy(TEAM[this.glowTeam].glow);
    this.ballMat.emissiveIntensity = 0.35 + this.ballGlowT * 0.8;
    if (this.glowTeam !== undefined) this.ballMat.emissive.copy(TEAM[this.glowTeam].glow).multiplyScalar(0.25 + 0.0);
    this.ballShadow.position.set(bp.x, 0.026, bp.z); this.ballShadow.material.opacity = clamp(0.85 - bp.y / 14, 0, 0.85);
    const sc = 1 + bp.y * 0.02; this.ballShadow.scale.set(sc, sc, sc);
    // ball speed trail
    if (inMatch && !replay) { const bs = toUU(match.ball.vel.length()); if (bs > 2500 && Math.random() < 0.8) { const gcol = this.glowTeam !== undefined ? TEAM[this.glowTeam].glow : new THREE.Color(0.6, 0.8, 1); this.addP.emit(bp.x, bp.y, bp.z, 0, 0, 0, gcol.r, gcol.g, gcol.b, 0.7, 0.9, 0.1, 0.45, 0, 0); } }
    // cars
    for (const car of match.cars) if (car.rPos) this.updateCar(this.getCarView(car), dt, replay);
    // pads
    this.padViews.forEach((v, i) => {
      const p = v.pad, act = match.pads.pads[i].active;
      v.spawnAnim = Math.min(1, v.spawnAnim + dt * 2.2);
      const target = act ? 1 : 0.0; v.glow += (target - v.glow) * (1 - Math.exp(-dt * 10));
      v.mat.emissiveIntensity = 0.05 + v.glow * 0.8; v.mat.color.setRGB(0.25 + v.glow * 0.75, 0.18 + v.glow * 0.42, 0.05 + v.glow * 0.03);
      v.arrow.visible = act; v.arrow.rotation.z = 0;
      if (v.orb) { v.orb.visible = act; v.orb.position.y = 1.4 + Math.sin(this.time * 2.2 + i) * 0.18; v.orb.rotation.y = this.time * 1.5; v.orb.rotation.x = this.time * 0.9; v.orb.scale.setScalar(0.2 + 0.8 * v.spawnAnim); v.beam.visible = act; v.beam.material.opacity = 0.1 + 0.07 * Math.sin(this.time * 3 + i); }
      else v.base.scale.setScalar(act ? 0.85 + 0.15 * v.spawnAnim : 0.8);
    });
    // effects
    this.addP.update(dt); this.smokeP.update(dt);
    const fov = this.camera.fov * Math.PI / 180, us = this.height * 0.5 / Math.tan(fov / 2);
    this.addP.uniforms.uScale.value = us; this.smokeP.uniforms.uScale.value = us; this.twinkleUniforms.uScale.value = us; this.twinkle.value = this.time;
    if (this.markDirty) { const g = this.markMesh.geometry; g.attributes.position.needsUpdate = true; g.attributes.color.needsUpdate = true; g.setDrawRange(0, this.markMax * 6); this.markDirty = false; }
    for (let i = this.rings.length - 1; i >= 0; i--) { const r = this.rings[i]; r.t += dt; const k = r.t / r.life; if (k >= 1) { this.scene.remove(r.m); r.m.material.dispose(); this.rings.splice(i, 1); continue; } r.m.scale.setScalar(0.3 + r.maxR * Math.sqrt(k)); r.m.material.opacity = 0.9 * (1 - k); if (r.m.rotation.x === 0) r.m.lookAt(this.camera.position); }
    this.flash = Math.max(0, this.flash - dt * 1.4); this.flashLight.intensity = this.flash * 2500; if (this.flashColor !== undefined) this.flashLight.color.setHex(this.flashColor);
    this.gl.toneMappingExposure = 0.95 + this.flash * 0.5;
    this.gl.render(this.scene, this.camera);
  }
}

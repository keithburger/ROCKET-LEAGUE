// arena.js — procedural arena geometry shared by the renderer and the physics collider.
// The render meshes and the Rapier trimesh are produced from the SAME triangle list.
// Axes: +Y up, long axis Z (blue goal at -Z, orange goal at +Z), width X.
import { CFG, uu } from './config.js';

class GeoBuilder {
  constructor() { this.pos = []; this.nor = []; this.uv = []; this.idx = []; }
  vert(p, n, uv) {
    this.pos.push(p[0], p[1], p[2]); this.nor.push(n[0], n[1], n[2]); this.uv.push(uv[0], uv[1]);
    return this.pos.length / 3 - 1;
  }
  // Triangle wound so that its geometric normal agrees with the vertex normals.
  tri(a, b, c) {
    const P = this.pos, N = this.nor;
    const ax = P[a * 3], ay = P[a * 3 + 1], az = P[a * 3 + 2];
    const e1 = [P[b * 3] - ax, P[b * 3 + 1] - ay, P[b * 3 + 2] - az];
    const e2 = [P[c * 3] - ax, P[c * 3 + 1] - ay, P[c * 3 + 2] - az];
    const nx = e1[1] * e2[2] - e1[2] * e2[1], ny = e1[2] * e2[0] - e1[0] * e2[2], nz = e1[0] * e2[1] - e1[1] * e2[0];
    if (nx * nx + ny * ny + nz * nz < 1e-14) return; // degenerate
    const d = nx * (N[a * 3] + N[b * 3] + N[c * 3]) + ny * (N[a * 3 + 1] + N[b * 3 + 1] + N[c * 3 + 1]) + nz * (N[a * 3 + 2] + N[b * 3 + 2] + N[c * 3 + 2]);
    if (d >= 0) this.idx.push(a, b, c); else this.idx.push(a, c, b);
  }
  quad(a, b, c, d) { this.tri(a, b, c); this.tri(a, c, d); }
  finish() {
    return { positions: new Float32Array(this.pos), normals: new Float32Array(this.nor), uvs: new Float32Array(this.uv), indices: new Uint32Array(this.idx) };
  }
}

// Boost pad layout (reference RL coordinates: x, y(=our z), large?)
const SMALL = [[0, -4240], [-1792, -4184], [1792, -4184], [-940, -3308], [940, -3308], [0, -2816], [-3584, -2484], [3584, -2484],
  [-1788, -2300], [1788, -2300], [-2048, -1036], [0, -1024], [2048, -1036], [-1024, 0], [1024, 0], [-2048, 1036], [0, 1024],
  [2048, 1036], [-1788, 2300], [1788, 2300], [-3584, 2484], [3584, 2484], [0, 2816], [-940, 3308], [940, 3308], [-1792, 4184],
  [1792, 4184], [0, 4240]];
const LARGE = [[-3584, 0], [3584, 0], [-3072, 4096], [3072, 4096], [-3072, -4096], [3072, -4096]];

export function boostPadLayout() {
  const pads = [];
  for (const [x, z] of SMALL) pads.push({ x: uu(x), z: uu(z), large: false });
  for (const [x, z] of LARGE) pads.push({ x: uu(x), z: uu(z), large: true });
  return pads; // 28 + 6 = 34
}

export function kickoffPositions() {
  // RL kickoff spots (x, z) for the five standard positions, blue side (negative z); orange mirrored.
  return [
    { x: 0, z: -4608, yaw: 0 },
    { x: -2048, z: -2560, yaw: 0 }, { x: 2048, z: -2560, yaw: 0 },
    { x: -256, z: -3840, yaw: 0 }, { x: 256, z: -3840, yaw: 0 },
  ].map((p) => ({ x: uu(p.x), z: uu(p.z), yaw: p.yaw }));
}

export function buildArenaGeometry(cfg = CFG.arena) {
  const W = cfg.halfWidth, L = cfg.halfLength, H = cfg.height;
  const Rf = cfg.floorRampRadius, Rc = cfg.ceilingRampRadius, Rk = cfg.cornerRadius;
  const GW = cfg.goalHalfWidth, Hg = cfg.goalHeight, Dg = cfg.goalDepth;
  const EPS = 1e-4;
  const seg = cfg.arcSegments;

  // ---------- plan-view outline (rounded rectangle) with inward normals
  const out = [];
  const addPt = (x, z, nx, nz, end) => out.push({ x, z, nx, nz, end });
  const straight = (x0, z0, x1, z1, nx, nz, end, extra = []) => {
    const len = Math.hypot(x1 - x0, z1 - z0);
    const ts = new Set([0]);
    const n = Math.max(1, Math.ceil(len / 10));
    for (let i = 1; i < n; i++) ts.add(i / n);
    for (const e of extra) ts.add(e);
    [...ts].sort((a, b) => a - b).forEach((t) => addPt(x0 + (x1 - x0) * t, z0 + (z1 - z0) * t, nx, nz, end));
  };
  const arc = (cx, cz, a0, a1) => {
    for (let i = 0; i <= seg; i++) {
      const a = a0 + ((a1 - a0) * i) / seg;
      const ox = Math.cos(a), oz = Math.sin(a);
      addPt(cx + ox * Rk, cz + oz * Rk, -ox, -oz, 0);
    }
  };
  const sx = W - Rk, sz = L - Rk;
  const tg = (GW - -sx) / (2 * sx); // t of x=-GW along an end wall that runs from +sx to -sx : handled below
  void tg;
  // end wall z=+L: runs x:+sx -> -sx ; goal edges at x=+GW and x=-GW
  const tEdge = (x) => (sx - x) / (2 * sx);
  straight(sx, L, -sx, L, 0, -1, +1, [tEdge(GW), tEdge(-GW)]);
  arc(-sx, sz, Math.PI / 2, Math.PI);
  straight(-W, sz, -W, -sz, 1, 0, 0);
  arc(-sx, -sz, Math.PI, Math.PI * 1.5);
  straight(-sx, -L, sx, -L, 0, 1, -1, [tEdge(-GW), tEdge(GW)].map((t) => 1 - t));
  arc(sx, -sz, Math.PI * 1.5, Math.PI * 2);
  straight(W, -sz, W, sz, -1, 0, 0);
  arc(sx, sz, 0, Math.PI / 2);
  // remove duplicated consecutive points (straight starts coincide with previous arc ends)
  const pts = [];
  for (const p of out) {
    const q = pts[pts.length - 1];
    if (q && Math.abs(q.x - p.x) < EPS && Math.abs(q.z - p.z) < EPS) {
      // keep the straight's tag/normal for end-wall points
      if (p.end) { q.end = p.end; q.nx = p.nx; q.nz = p.nz; }
      continue;
    }
    pts.push(p);
  }
  const first = pts[0], last = pts[pts.length - 1];
  if (Math.abs(first.x - last.x) < EPS && Math.abs(first.z - last.z) < EPS) pts.pop();
  let acc = 0;
  pts.forEach((p, i) => { if (i > 0) acc += Math.hypot(p.x - pts[i - 1].x, p.z - pts[i - 1].z); p.s = acc; });
  const perimeter = acc + Math.hypot(pts[0].x - pts[pts.length - 1].x, pts[0].z - pts[pts.length - 1].z);

  // ---------- vertical profile (d = inward offset from wall plane, y)
  const prof = [];
  const addProf = (d, y, nd, ny) => prof.push({ d, y, nd, ny });
  for (let i = 0; i <= seg; i++) { // floor curve: theta 0..90
    const t = (Math.PI / 2) * (i / seg);
    addProf(Rf * (1 - Math.sin(t)), Rf * (1 - Math.cos(t)), Math.sin(t), Math.cos(t));
  }
  addProf(0, Hg, 1, 0); // breakpoint at the goal height
  addProf(0, H - Rc, 1, 0);
  for (let i = 1; i <= seg; i++) { // ceiling curve
    const t = (Math.PI / 2) * (i / seg);
    addProf(Rc * (1 - Math.cos(t)), H - Rc + Rc * Math.sin(t), Math.cos(t), -Math.sin(t));
  }
  let pv = 0;
  prof.forEach((p, i) => { if (i > 0) pv += Math.hypot(p.d - prof[i - 1].d, p.y - prof[i - 1].y); p.v = pv; });

  const shell = new GeoBuilder();
  const floor = new GeoBuilder();
  const goals = [new GeoBuilder(), new GeoBuilder()]; // [-z goal (blue), +z goal (orange)]

  // ---------- wall sweep
  const grid = pts.map((p) => prof.map((q) => shell.vert(
    [p.x + p.nx * q.d, q.y, p.z + p.nz * q.d],
    [p.nx * q.nd, q.ny, p.nz * q.nd],
    [p.s / 8, q.v / 8])));
  const N = pts.length;
  for (let i = 0; i < N; i++) {
    const i2 = (i + 1) % N;
    const a = pts[i], b = pts[i2];
    const onEnd = a.end !== 0 && a.end === b.end && Math.abs(a.x) <= GW + EPS && Math.abs(b.x) <= GW + EPS;
    const wrap = i2 === 0;
    for (let j = 0; j < prof.length - 1; j++) {
      if (onEnd && Math.max(prof[j].y, prof[j + 1].y) <= Hg + EPS) continue; // goal mouth
      let a0 = grid[i][j], a1 = grid[i][j + 1], b0 = grid[i2][j], b1 = grid[i2][j + 1];
      if (wrap) { // wrap-around UVs: duplicate verts with continuous u
        const mk = (pt, q, u) => shell.vert([pt.x + pt.nx * q.d, q.y, pt.z + pt.nz * q.d], [pt.nx * q.nd, q.ny, pt.nz * q.nd], [u, q.v / 8]);
        b0 = mk(b, prof[j], perimeter / 8); b1 = mk(b, prof[j + 1], perimeter / 8);
      }
      shell.quad(a0, b0, b1, a1);
    }
  }

  // ---------- floor & ceiling fans
  const fan = (builder, y, ny, off, uvf) => {
    const c = builder.vert([0, y, 0], [0, ny, 0], uvf(0, 0));
    const ring = pts.map((p) => {
      const x = p.x + p.nx * off, z = p.z + p.nz * off;
      return builder.vert([x, y, z], [0, ny, 0], uvf(x, z));
    });
    for (let i = 0; i < ring.length; i++) builder.tri(c, ring[i], ring[(i + 1) % ring.length]);
  };
  fan(floor, 0, 1, Rf, (x, z) => [(x + W) / (2 * W), (z + L) / (2 * L)]);
  fan(shell, H, -1, Rc, (x, z) => [x / 8 + 40, z / 8 + 40]);

  // ---------- goals
  const flat = (b, p, n, uv) => b.vert(p, n, uv);
  const xs = [...new Set(pts.filter((p) => p.end !== 0 && Math.abs(p.x) <= GW + EPS).map((p) => +p.x.toFixed(4)))].sort((a, b) => a - b);
  for (let gi = 0; gi < 2; gi++) {
    const sg = gi === 0 ? -1 : 1, b = goals[gi];
    const z0 = sg * L, z1 = sg * (L + Dg), zr = sg * (L - Rf);
    // floor and roof, split at the outline vertices so edges stay watertight with the arena shell
    for (let k = 0; k < xs.length - 1; k++) {
      const xa = xs[k], xb = xs[k + 1];
      let q = [flat(b, [xa, 0, zr], [0, 1, 0], [0, 0]), flat(b, [xb, 0, zr], [0, 1, 0], [1, 0]), flat(b, [xb, 0, z1], [0, 1, 0], [1, 1]), flat(b, [xa, 0, z1], [0, 1, 0], [0, 1])];
      b.quad(q[0], q[1], q[2], q[3]);
      q = [flat(b, [xa, Hg, z0], [0, -1, 0], [0, 0]), flat(b, [xb, Hg, z0], [0, -1, 0], [1, 0]), flat(b, [xb, Hg, z1], [0, -1, 0], [1, 1]), flat(b, [xa, Hg, z1], [0, -1, 0], [0, 1])];
      b.quad(q[0], q[1], q[2], q[3]);
    }
    let q;
    // back wall
    q = [flat(b, [-GW, 0, z1], [0, 0, -sg], [0, 0]), flat(b, [GW, 0, z1], [0, 0, -sg], [1, 0]), flat(b, [GW, Hg, z1], [0, 0, -sg], [1, 1]), flat(b, [-GW, Hg, z1], [0, 0, -sg], [0, 1])];
    b.quad(q[0], q[1], q[2], q[3]);
    for (const sx2 of [-1, 1]) { // side walls inside goal
      const x = sx2 * GW;
      q = [flat(b, [x, 0, z0], [-sx2, 0, 0], [0, 0]), flat(b, [x, 0, z1], [-sx2, 0, 0], [1, 0]), flat(b, [x, Hg, z1], [-sx2, 0, 0], [1, 1]), flat(b, [x, Hg, z0], [-sx2, 0, 0], [0, 1])];
      b.quad(q[0], q[1], q[2], q[3]);
      // strip under the end-wall ramp, beside the mouth
      for (let j = 0; j < seg; j++) {
        const p0 = prof[j], p1 = prof[j + 1];
        const za = sg * (L - p0.d), zb = sg * (L - p1.d);
        const v = [flat(b, [x, 0, za], [-sx2, 0, 0], [0, 0]), flat(b, [x, p0.y, za], [-sx2, 0, 0], [0, 1]), flat(b, [x, p1.y, zb], [-sx2, 0, 0], [1, 1]), flat(b, [x, 0, zb], [-sx2, 0, 0], [1, 0])];
        b.quad(v[0], v[1], v[2], v[3]);
      }
    }
  }

  const groups = { floor: floor.finish(), shell: shell.finish(), goalBlue: goals[0].finish(), goalOrange: goals[1].finish() };

  // ---------- collider mesh: merge all groups, weld coincident vertices
  const key = (x, y, z) => `${Math.round(x * 1e4)},${Math.round(y * 1e4)},${Math.round(z * 1e4)}`;
  const map = new Map(); const wp = []; const wi = [];
  for (const g of Object.values(groups)) {
    const remap = new Uint32Array(g.positions.length / 3);
    for (let i = 0; i < remap.length; i++) {
      const x = g.positions[i * 3], y = g.positions[i * 3 + 1], z = g.positions[i * 3 + 2];
      const k = key(x, y, z);
      let id = map.get(k);
      if (id === undefined) { id = wp.length / 3; wp.push(x, y, z); map.set(k, id); }
      remap[i] = id;
    }
    for (let i = 0; i < g.indices.length; i += 3) {
      const a = remap[g.indices[i]], b = remap[g.indices[i + 1]], c = remap[g.indices[i + 2]];
      if (a !== b && b !== c && a !== c) wi.push(a, b, c);
    }
  }
  const collider = { positions: new Float32Array(wp), indices: new Uint32Array(wi) };

  // goal frame (posts + crossbar) — cylinders tangent to the opening edges
  const pr = cfg.postRadius;
  const frame = [];
  for (const sg of [-1, 1]) {
    for (const sx2 of [-1, 1]) frame.push({ kind: 'post', x: sx2 * (GW + pr), y: Hg / 2, z: sg * L, halfHeight: Hg / 2 + pr, radius: pr });
    frame.push({ kind: 'bar', x: 0, y: Hg + pr, z: sg * L, halfLength: GW + 2 * pr, radius: pr });
  }

  return { groups, collider, frame, dims: { W, L, H, GW, Hg, Dg, Rf, Rc, Rk }, boostPads: boostPadLayout(), kickoff: kickoffPositions() };
}

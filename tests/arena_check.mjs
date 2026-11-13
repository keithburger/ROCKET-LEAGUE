import { buildArenaGeometry } from '../src/arena.js';
const a = buildArenaGeometry();
for (const [k, g] of Object.entries(a.groups)) console.log(k, g.positions.length / 3, 'verts', g.indices.length / 3, 'tris');
console.log('collider', a.collider.positions.length / 3, a.collider.indices.length / 3, 'pads', a.boostPads.length, a.boostPads.filter(p => p.large).length);
// edge manifold check: count boundary edges
const e = new Map();
const I = a.collider.indices;
for (let i = 0; i < I.length; i += 3) for (let k = 0; k < 3; k++) { const u = I[i + k], v = I[i + (k + 1) % 3]; const key = u < v ? u + '_' + v : v + '_' + u; e.set(key, (e.get(key) || 0) + 1); }
let open = 0, nm = 0; const P = a.collider.positions; const ex = [];
for (const [k, c] of e) { if (c === 1) { open++; if (ex.length < 6) { const [u, v] = k.split('_').map(Number); ex.push([[P[u*3],P[u*3+1],P[u*3+2]].map(x=>+x.toFixed(2)),[P[v*3],P[v*3+1],P[v*3+2]].map(x=>+x.toFixed(2))]); } } else if (c > 2) nm++; }
console.log('open edges', open, 'nonmanifold', nm); console.log(JSON.stringify(ex));

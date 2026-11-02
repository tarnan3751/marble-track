// Builds the visual geometry and the physics trimesh for a chunk of frames.
//
// Visual mesh: non-indexed, flat vertex colours, analytic normals from the
// frame basis (so curved sections shade smoothly).
// Collider: indexed "tube" rings so Rapier can detect internal edges and keep
// the ball from catching on triangle seams.

import * as THREE from 'three';
import { CFG } from './config.js';
import { ZONE } from './track.js';

const C = (hex) => new THREE.Color(hex);
const PALETTE = {
  base: C('#2fc0a0'),
  goal: C('#ffcc4d'),
  startA: C('#f4f4f4'), startB: C('#2b2b2b'),
  boost: C('#3d8bff'),
  edge: C('#f7f9f4'), edgeGap: C('#ff4d4d'),
  side: C('#164a40'), bottom: C('#0e332c'),
  wall: C('#ff7b2e'), wallTop: C('#ffd166'), wallOut: C('#c45a1a'),
};

const _n = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();

class VisualBuilder {
  constructor() { this.pos = []; this.nor = []; this.col = []; this.uv = []; }
  _push(p, n, color, u, v) {
    this.pos.push(p.x, p.y, p.z);
    this.nor.push(n.x, n.y, n.z);
    this.col.push(color.r, color.g, color.b);
    this.uv.push(u, v);
  }
  // Each vertex: [point, normal, u, v].  Winding is fixed against `hint`.
  tri(a, b, c, hint, color) {
    _a.subVectors(b[0], a[0]); _b.subVectors(c[0], a[0]); _n.crossVectors(_a, _b);
    if (_n.dot(hint) < 0) { const t = b; b = c; c = t; }
    for (const q of [a, b, c]) this._push(q[0], q[1], color, q[2], q[3]);
  }
  // a0,b0 are the near edge (normal n0), a1,b1 the far edge (normal n1).
  // uv = [u0, v0, u1, v1] maps a->u0, b->u1, near->v0, far->v1; null uses a
  // constant "light" texel so the quad is unstriped.
  quad(a0, b0, a1, b1, n0, n1, color, uv = null) {
    const [u0, v0, u1, v1] = uv || [0.5, 0.25, 0.5, 0.25];
    this.tri([a0, n0, u0, v0], [b0, n0, u1, v0], [a1, n1, u0, v1], n0, color);
    this.tri([b0, n0, u1, v0], [b1, n1, u1, v1], [a1, n1, u0, v1], n0, color);
  }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.computeBoundingSphere();
    return g;
  }
}

class ColliderBuilder {
  constructor() { this.verts = []; this.idx = []; this.count = 0; }
  _tri(ia, ib, ic, hint) {
    const v = this.verts;
    _a.set(v[ib * 3] - v[ia * 3], v[ib * 3 + 1] - v[ia * 3 + 1], v[ib * 3 + 2] - v[ia * 3 + 2]);
    _b.set(v[ic * 3] - v[ia * 3], v[ic * 3 + 1] - v[ia * 3 + 1], v[ic * 3 + 2] - v[ia * 3 + 2]);
    _n.crossVectors(_a, _b);
    if (_n.lengthSq() < 1e-10) return;
    if (_n.dot(hint) < 0) this.idx.push(ia, ic, ib); else this.idx.push(ia, ib, ic);
  }
  // rings: array of rings, each ring an array of k Vector3 (closed polygon,
  // outward-facing).  Consecutive rings are stitched into a tube; open ends
  // are capped.
  tube(rings, startT, endT, capStart = true, capEnd = true) {
    if (rings.length < 2) return;
    const k = rings[0].length;
    const base = this.count;
    for (const ring of rings) for (const p of ring) { this.verts.push(p.x, p.y, p.z); this.count++; }
    const centre = new THREE.Vector3();
    const hint = new THREE.Vector3();
    for (let j = 0; j < rings.length - 1; j++) {
      centre.set(0, 0, 0);
      for (const p of rings[j]) centre.add(p);
      for (const p of rings[j + 1]) centre.add(p);
      centre.multiplyScalar(1 / (2 * k));
      for (let e = 0; e < k; e++) {
        const e1 = (e + 1) % k;
        const a = base + j * k + e, b = base + j * k + e1, c = base + (j + 1) * k + e, d = base + (j + 1) * k + e1;
        hint.copy(rings[j][e]).add(rings[j][e1]).multiplyScalar(0.5).sub(centre);
        this._tri(a, b, c, hint);
        this._tri(b, d, c, hint);
      }
    }
    // caps
    const first = base, last = base + (rings.length - 1) * k;
    if (capStart) {
      hint.copy(startT).negate();
      for (let e = 1; e < k - 1; e++) this._tri(first, first + e, first + e + 1, hint);
    }
    if (capEnd) {
      hint.copy(endT);
      for (let e = 1; e < k - 1; e++) this._tri(last, last + e, last + e + 1, hint);
    }
  }
  result() {
    return { vertices: new Float32Array(this.verts), indices: new Uint32Array(this.idx) };
  }
}


function topColor(f, stripe) {
  switch (f.zone) {
    case ZONE.GOAL: return PALETTE.goal;
    case ZONE.START: return stripe ? PALETTE.startA : PALETTE.startB;
    case ZONE.BOOST: return PALETTE.boost;
    default: return PALETTE.base;
  }
}

// Key points of a frame's cross-section.  Walls lean inward so a ball pressed
// against them on a banked turn is pushed back onto the track, and their
// height is scaled per frame so wall runs taper in and out.
const WALL_LEAN = 0.45;
function section(f, hL, hR) {
  const hw = f.w / 2;
  const eL = f.p.clone().addScaledVector(f.B, -hw);
  const eR = f.p.clone().addScaledVector(f.B, hw);
  const iL = eL.clone().addScaledVector(f.B, CFG.edgeWidth);
  const iR = eR.clone().addScaledVector(f.B, -CFG.edgeWidth);
  const bL = eL.clone().addScaledVector(f.N, -CFG.thickness);
  const bR = eR.clone().addScaledVector(f.N, -CFG.thickness);
  const wt = CFG.wallThickness;
  // bank: tan of the lateral tilt, positive when the right edge is raised.
  // The surface normal already leans towards the lowered edge, so the raised
  // wall needs less extra lean and the lowered wall needs more; the result is
  // a wall that leans slightly inward in world space on any bank.
  const bank = f.B.y / Math.max(0.2, Math.hypot(f.B.x, f.B.z));
  const wall = (edge, inward, h) => {
    const lean = Math.max(0.1, Math.min(1.2, WALL_LEAN + inward * bank));
    const up = f.N.clone().addScaledVector(f.B, inward * lean).normalize();
    return {
      in0: edge.clone().addScaledVector(f.B, inward * wt),
      in1: edge.clone().addScaledVector(f.B, inward * wt).addScaledVector(up, h),
      out1: edge.clone().addScaledVector(up, h),
      out0: edge.clone(),
    };
  };
  return { eL, eR, iL, iR, bL, bR, wL: wall(eL, 1, hL), wR: wall(eR, -1, hR) };
}

const TAPER = 2.0; // metres over which a wall rises to full height
function wallHeights(frames, key, prev, next) {
  const h = new Float32Array(frames.length);
  let i = 0;
  while (i < frames.length) {
    if (!frames[i][key] || frames[i].gap) { i++; continue; }
    let j = i;
    while (j + 1 < frames.length && frames[j + 1][key] && !frames[j + 1].gap) j++;
    const startsHere = !(i === 0 && prev && prev[key] && !prev.gap);
    const endsHere = !(j === frames.length - 1 && next && next[key] && !next.gap);
    for (let k = i; k <= j; k++) {
      let f = 1;
      if (startsHere) f = Math.min(f, (frames[k].s - frames[i].s) / TAPER);
      if (endsHere) f = Math.min(f, (frames[j].s - frames[k].s) / TAPER);
      h[k] = CFG.wallHeight * (frames[k].tall ? 1.7 : 1) * Math.max(0.09, Math.min(1, f));
    }
    i = j + 1;
  }
  return h;
}

export function buildChunk(frames, prev = null, next = null) {
  const vis = new VisualBuilder();
  const col = new ColliderBuilder();
  const hL = wallHeights(frames, 'wallL', prev, next);
  const hR = wallHeights(frames, 'wallR', prev, next);
  const secs = frames.map((f, i) => section(f, hL[i], hR[i]));

  // ---- visual -------------------------------------------------------------
  const _nb0 = new THREE.Vector3(), _nb1 = new THREE.Vector3(), _nn0 = new THREE.Vector3(), _nn1 = new THREE.Vector3();
  for (let i = 0; i < frames.length - 1; i++) {
    const f0 = frames[i], f1 = frames[i + 1];
    if (f0.gap || f1.gap) continue;
    const s0 = secs[i], s1 = secs[i + 1];
    const stripe = Math.floor(f1.s / 2) % 2 === 0;
    const n0 = f0.N, n1 = f1.N, b0 = f0.B, b1 = f1.B;
    _nb0.copy(b0).negate(); _nb1.copy(b1).negate();
    _nn0.copy(n0).negate(); _nn1.copy(n1).negate();
    const edgeC = (i + 1 < frames.length - 1 && frames[i + 2].gap) ? PALETTE.edgeGap : PALETTE.edge;
    const striped = f1.zone !== ZONE.START;
    const hw0 = f0.w / 2 - CFG.edgeWidth, hw1 = f1.w / 2 - CFG.edgeWidth;
    // u = lateral metres, v = arc-length metres: a 1 m grid in the texture
    const uv = striped ? [-hw0, f0.s, hw1, f1.s] : null;

    vis.quad(s0.eL, s0.iL, s1.eL, s1.iL, n0, n1, edgeC);
    vis.quad(s0.iL, s0.iR, s1.iL, s1.iR, n0, n1, topColor(f1, stripe), uv);
    vis.quad(s0.iR, s0.eR, s1.iR, s1.eR, n0, n1, edgeC);
    vis.quad(s0.eL, s0.bL, s1.eL, s1.bL, _nb0, _nb1, PALETTE.side);
    vis.quad(s0.eR, s0.bR, s1.eR, s1.bR, b0, b1, PALETTE.side);
    vis.quad(s0.bL, s0.bR, s1.bL, s1.bR, _nn0, _nn1, PALETTE.bottom);

    if (f0.wallL && f1.wallL) {
      vis.quad(s0.wL.in0, s0.wL.in1, s1.wL.in0, s1.wL.in1, b0, b1, PALETTE.wall);
      vis.quad(s0.wL.in1, s0.wL.out1, s1.wL.in1, s1.wL.out1, n0, n1, PALETTE.wallTop);
      vis.quad(s0.wL.out1, s0.wL.out0, s1.wL.out1, s1.wL.out0, _nb0, _nb1, PALETTE.wallOut);
    }
    if (f0.wallR && f1.wallR) {
      vis.quad(s0.wR.in0, s0.wR.in1, s1.wR.in0, s1.wR.in1, _nb0, _nb1, PALETTE.wall);
      vis.quad(s0.wR.in1, s0.wR.out1, s1.wR.in1, s1.wR.out1, n0, n1, PALETTE.wallTop);
      vis.quad(s0.wR.out1, s0.wR.out0, s1.wR.out1, s1.wR.out0, b0, b1, PALETTE.wallOut);
    }
  }
  // wall end caps and slab end caps
  for (let i = 0; i < frames.length; i++) {
    const f = frames[i], s = secs[i];
    const pf = i > 0 ? frames[i - 1] : prev, nf = i < frames.length - 1 ? frames[i + 1] : next;
    for (const side of ['L', 'R']) {
      const key = side === 'L' ? 'wallL' : 'wallR';
      const w = side === 'L' ? s.wL : s.wR;
      const starts = f[key] && (!pf || !pf[key] || pf.gap);
      const ends = f[key] && (!nf || !nf[key] || nf.gap);
      if (starts && !f.gap) { const nT = f.T.clone().negate(); vis.quad(w.in0, w.in1, w.out0, w.out1, nT, nT, PALETTE.wallOut); }
      if (ends && !f.gap) vis.quad(w.in0, w.in1, w.out0, w.out1, f.T, f.T, PALETTE.wallOut);
    }
    const slabStart = !f.gap && (!pf || pf.gap);
    const slabEnd = !f.gap && (!nf || nf.gap);
    if (slabStart) { const nT = f.T.clone().negate(); vis.quad(s.eL, s.eR, s.bL, s.bR, nT, nT, PALETTE.side); }
    if (slabEnd) vis.quad(s.eL, s.eR, s.bL, s.bR, f.T, f.T, PALETTE.side);
  }

  // ---- collider -----------------------------------------------------------
  // Track slab: runs of consecutive non-gap frames.
  let run = [];
  const flushSlab = () => {
    if (run.length >= 2) {
      const a = run[0], b = run[run.length - 1];
      const rings = run.map((j) => [secs[j].eL, secs[j].eR, secs[j].bR, secs[j].bL]);
      const capStart = !(a === 0 && prev && !prev.gap);
      const capEnd = !(b === frames.length - 1 && next && !next.gap);
      col.tube(rings, frames[a].T, frames[b].T, capStart, capEnd);
    }
    run = [];
  };
  for (let i = 0; i < frames.length; i++) {
    if (frames[i].gap) flushSlab(i); else run.push(i);
  }
  flushSlab();
  // Walls: runs per side.
  for (const side of ['L', 'R']) {
    const key = side === 'L' ? 'wallL' : 'wallR';
    let wrun = [];
    const flush = () => {
      if (wrun.length >= 2) {
        const a = wrun[0], b = wrun[wrun.length - 1];
        const rings = wrun.map((j) => {
          const w = side === 'L' ? secs[j].wL : secs[j].wR;
          return [w.in0, w.in1, w.out1, w.out0];
        });
        const capStart = !(a === 0 && prev && prev[key] && !prev.gap);
        const capEnd = !(b === frames.length - 1 && next && next[key] && !next.gap);
        col.tube(rings, frames[a].T, frames[b].T, capStart, capEnd);
      }
      wrun = [];
    };
    for (let i = 0; i < frames.length; i++) {
      if (frames[i][key] && !frames[i].gap) wrun.push(i); else flush();
    }
    flush();
  }

  return { geometry: vis.geometry(), collider: col.result() };
}

// Orientation quaternion for a decoration sitting on a frame.
export function frameQuaternion(f, target = new THREE.Quaternion()) {
  const m = new THREE.Matrix4().makeBasis(f.B, f.N, f.T.clone().negate());
  return target.setFromRotationMatrix(m);
}

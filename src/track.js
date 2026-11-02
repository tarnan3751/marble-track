// Procedural track generator.
//
// The track is a chain of "frames": points along the centreline, each with an
// orientation (tangent T, normal N, right vector B), a width and feature flags.
// Frames are produced by a 3D turtle that walks forward DS units per step while
// its yaw/pitch/roll are driven by piece-specific profiles.  Pieces (straights,
// turns, hills, jumps, loops, ...) are built on a cloned turtle state so they
// can be rejected if they would cross existing track.

import * as THREE from 'three';
import { Rng } from './rng.js';
import { CFG, padSpeed, maxSpeed, expectedSpeed } from './config.js';

const DS = CFG.ds;
const W0 = CFG.trackWidth;

// Track width eases from 6 m for beginners down to the base width at D=1.
export function baseWidth(D) {
  return W0 + 2 * (1 - Math.min(D, 1));
}
const DEG = Math.PI / 180;

const FWD = new THREE.Vector3(0, 0, -1);
const UP = new THREE.Vector3(0, 1, 0);
const RIGHT = new THREE.Vector3(1, 0, 0);
const _e = new THREE.Euler();
const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();

const CELL = 4;
const COLLIDE_XZ = 7.5;
const COLLIDE_Y = 5.5;
const COLLIDE_MIN_S = 25;

export const ZONE = { NORMAL: 0, GOAL: 1, START: 2, BOOST: 3 };

function smoothstep(t) {
  t = Math.max(0, Math.min(1, t));
  return t * t * (3 - 2 * t);
}

// 0 -> 1 -> 0 plateau with eased ends of fraction `e`.
function plateau(t, e) {
  if (t < e) return smoothstep(t / e);
  if (t > 1 - e) return smoothstep((1 - t) / e);
  return 1;
}

// Minimum launch speed to clear a gap of `gap` metres, landing `drop` metres
// lower, when launched at `angle` radians above horizontal.
export function requiredJumpSpeed(gap, drop, angle) {
  const g = CFG.gravity;
  for (let v = 4; v < 80; v += 0.25) {
    const vy = v * Math.sin(angle);
    const vx = v * Math.cos(angle);
    const t = (vy + Math.sqrt(vy * vy + 2 * g * drop)) / g;
    if (vx * t >= gap) return v;
  }
  return 80;
}

// Horizontal distance flown when launched at `v` and `angle`, landing `drop` lower.
export function jumpRange(v, drop, angle) {
  const g = CFG.gravity;
  const vy = v * Math.sin(angle), vx = v * Math.cos(angle);
  const t = (vy + Math.sqrt(vy * vy + 2 * g * drop)) / g;
  return vx * t;
}

// Minimum entry speed for a rolling ball to make it round a vertical loop.
export function requiredLoopSpeed(radius) {
  // v_top^2 >= g R ; rolling KE (7/10 m v^2) ; climb 2R.
  return Math.sqrt(CFG.gravity * radius * (1 + 20 / 7)) * 1.25;
}

export class TrackGenerator {
  constructor(seed = Date.now() % 2147483647) {
    this.rng = new Rng(seed);
    this.seed = seed;
    this.frames = [];
    this.pieces = [];
    this.W = baseWidth(0);
    this.state = { pos: new THREE.Vector3(0, 0, 0), yaw: 0, pitch: 0, roll: 0, width: this.W, s: 0 };
    this.grid = new Map();
    this.gridCount = 0;
    this.sinceGate = 0;
    this.lastKinds = [];
    this.frames.push(this._frame(this.state, {}));
    this._gridAdd(this.frames[0]);
  }

  get lastFrame() { return this.frames[this.frames.length - 1]; }

  // ---- turtle -------------------------------------------------------------

  _frame(st, flags) {
    _e.set(st.pitch, st.yaw, st.roll, 'YXZ');
    _q.setFromEuler(_e);
    return {
      p: st.pos.clone(),
      T: FWD.clone().applyQuaternion(_q),
      N: UP.clone().applyQuaternion(_q),
      B: RIGHT.clone().applyQuaternion(_q),
      yaw: st.yaw,
      pitch: st.pitch,
      w: st.width,
      s: st.s,
      gap: !!flags.gap,
      wallL: !!flags.wallL,
      wallR: !!flags.wallR,
      boost: !!flags.boost,
      zone: flags.zone || 0,
      tall: !!flags.tall,
    };
  }

  _step(st, out, o) {
    st.yaw += o.dyaw || 0;
    st.pitch = o.pitch || 0;
    st.roll = o.roll || 0;
    st.width = o.width || this.W;
    _e.set(st.pitch, st.yaw, st.roll, 'YXZ');
    _q.setFromEuler(_e);
    _v.copy(FWD).applyQuaternion(_q);
    st.pos.addScaledVector(_v, DS);
    if (o.lateral) st.pos.add(_v.set(Math.cos(st.yaw), 0, -Math.sin(st.yaw)).multiplyScalar(o.lateral));
    if (o.dy) st.pos.y += o.dy;
    st.s += DS;
    out.push(this._frame(st, o));
  }

  _cloneState() {
    const s = this.state;
    return { pos: s.pos.clone(), yaw: s.yaw, pitch: s.pitch, roll: s.roll, width: s.width, s: s.s };
  }

  // ---- spatial hash for self-intersection avoidance -----------------------

  _key(x, z) { return `${Math.floor(x / CELL)},${Math.floor(z / CELL)}`; }

  _gridAdd(f) {
    const k = this._key(f.p.x, f.p.z);
    let list = this.grid.get(k);
    if (!list) { list = []; this.grid.set(k, list); }
    list.push({ x: f.p.x, y: f.p.y, z: f.p.z, s: f.s });
    this.gridCount++;
  }

  _gridPrune(minS) {
    const g = new Map();
    this.gridCount = 0;
    for (const f of this.frames) {
      if (f.s < minS) continue;
      const k = this._key(f.p.x, f.p.z);
      let list = g.get(k);
      if (!list) { list = []; g.set(k, list); }
      list.push({ x: f.p.x, y: f.p.y, z: f.p.z, s: f.s });
      this.gridCount++;
    }
    this.grid = g;
  }

  _collides(newFrames) {
    for (const f of newFrames) {
      const cx = Math.floor(f.p.x / CELL), cz = Math.floor(f.p.z / CELL);
      for (let dx = -1; dx <= 1; dx++) {
        for (let dz = -1; dz <= 1; dz++) {
          const list = this.grid.get(`${cx + dx},${cz + dz}`);
          if (!list) continue;
          for (const o of list) {
            if (f.s - o.s < COLLIDE_MIN_S) continue;
            const ex = f.p.x - o.x, ez = f.p.z - o.z;
            if (ex * ex + ez * ez < COLLIDE_XZ * COLLIDE_XZ && Math.abs(f.p.y - o.y) < COLLIDE_Y) return true;
          }
        }
      }
    }
    return false;
  }

  // ---- piece primitives ---------------------------------------------------

  _straight(st, fr, L, o = {}) {
    const n = Math.max(1, Math.round(L / DS));
    for (let i = 0; i < n; i++) {
      this._step(st, fr, { width: o.width || this.W, wallL: !!o.walls, wallR: !!o.walls, zone: o.zone || 0, pitch: o.pitch || 0, tall: !!o.tall });
    }
  }

  // Ease the width from the current width to `target` over L metres.
  _widthRamp(st, fr, L, target, o = {}) {
    const from = st.width;
    const n = Math.max(1, Math.round(L / DS));
    for (let i = 0; i < n; i++) {
      const w = from + (target - from) * smoothstep((i + 1) / n);
      this._step(st, fr, { width: w, wallL: !!o.walls, wallR: !!o.walls, tall: !!o.tall });
    }
  }

  _turn(st, fr, angle, radius, bank, o = {}) {
    const L = Math.abs(angle) * radius;
    const n = Math.max(2, Math.round(L / DS));
    const dyaw = angle / n;
    const sgn = Math.sign(angle);
    // Bank eases in over an absolute distance: a fast ball on a twisting
    // surface gets launched, so the twist must be gentle at speed.
    const e = Math.min(0.45, (o.ease || 4) / L);
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n;
      const roll = sgn * bank * plateau(t, e);
      this._step(st, fr, {
        dyaw, roll, pitch: o.pitch || 0,
        width: o.width || this.W,
        wallL: !!o.walls && (sgn < 0 || !!o.bothWalls), wallR: !!o.walls && (sgn > 0 || !!o.bothWalls),
        tall: !!o.tall,
      });
    }
  }

  _pitched(st, fr, L, pitchFn, o = {}) {
    const n = Math.max(2, Math.round(L / DS));
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n;
      this._step(st, fr, { pitch: pitchFn(t), width: o.width || this.W, wallL: !!o.walls, wallR: !!o.walls, tall: !!o.tall });
    }
  }

  // Boost pad: `len` metres of boost-flagged track.  The trigger span can be
  // extended afterwards (see loops) by flagging more frames and widening `to`.
  _pad(st, fr, dc, speed, len = 3, o = {}) {
    const n = Math.round(len / DS);
    const from = fr.length;
    const centre = fr.length + Math.floor(n / 2);
    for (let i = 0; i < n; i++) this._step(st, fr, { boost: true, zone: ZONE.BOOST, wallL: !!o.walls, wallR: !!o.walls });
    const pad = { type: 'pad', index: centre, speed, from, to: fr.length - 1 };
    dc.push(pad);
    return pad;
  }

  // A true vertical helix of radius R that shifts `drift` metres sideways
  // over one full turn.  Frames are built directly so the tangent follows the
  // actual path (no sideways scrubbing against the walls).
  _helix(st, fr, R, drift, boostLead = 0) {
    const circ = 2 * Math.PI * R;
    const L = Math.sqrt(circ * circ + drift * drift);
    // The helix tangent is yawed by theta towards the drift side; rotate the
    // loop plane the other way so the entry tangent equals our heading.
    const theta = Math.atan2(drift, circ);
    _e.set(0, st.yaw + theta, 0, 'YXZ');
    _q.setFromEuler(_e);
    const T0 = FWD.clone().applyQuaternion(_q);
    const N0 = UP.clone();
    const B0 = RIGHT.clone().applyQuaternion(_q);
    const centre = st.pos.clone().addScaledVector(N0, R);
    const n = Math.round(L / DS);
    const dsReal = L / n;
    for (let i = 1; i <= n; i++) {
      const a = (2 * Math.PI * i) / n;
      const p = centre.clone().addScaledVector(T0, R * Math.sin(a)).addScaledVector(N0, -R * Math.cos(a)).addScaledVector(B0, (drift * i) / n);
      const T = T0.clone().multiplyScalar(circ * Math.cos(a)).addScaledVector(N0, circ * Math.sin(a)).addScaledVector(B0, drift).normalize();
      const toCentre = T0.clone().multiplyScalar(-Math.sin(a)).addScaledVector(N0, Math.cos(a));
      // surface normal points at the helix axis, orthogonalised against T
      const N = toCentre.addScaledVector(T, -toCentre.dot(T)).normalize();
      const B = new THREE.Vector3().crossVectors(T, N).normalize();
      st.pos.copy(p);
      st.s += dsReal;
      st.pitch = a;
      const boost = i <= boostLead;
      fr.push({ p: p.clone(), T, N, B, yaw: st.yaw, pitch: a, w: this.W, s: st.s, gap: false, wallL: true, wallR: true, boost, zone: boost ? ZONE.BOOST : 0, tall: true });
    }
    st.pitch = 0;
    st.roll = 0;
  }

  _gems(fr, dc, count, spacing = 2, lateral = 0, startBack = null) {
    // Place `count` gems ending at the current frame, spaced `spacing` metres.
    const end = startBack == null ? fr.length - 1 : startBack;
    const step = Math.max(1, Math.round(spacing / DS));
    for (let i = 0; i < count; i++) {
      const idx = end - i * step;
      if (idx >= 0) dc.push({ type: 'gem', index: idx, lateral });
    }
  }

  // ---- pieces -------------------------------------------------------------

  _buildPiece(kind, D, st, fr, dc) {
    const r = this.rng;
    const v = expectedSpeed(D);
    const g = CFG.gravity;
    switch (kind) {
      case 'start': {
        this._straight(st, fr, 18, { width: this.W + 1, walls: true, zone: ZONE.START });
        this._widthRamp(st, fr, 4, this.W, { walls: true });
        break;
      }
      case 'straight': {
        const L = r.range(14, 26);
        this._straight(st, fr, L);
        if (r.chance(0.7)) this._gems(fr, dc, r.int(3, 5), 4, r.chance(0.5) ? 0 : r.range(-1, 1));
        break;
      }
      case 'turn': {
        const dir = this._turnDir();
        const angle = dir * r.range(30, 70) * DEG;
        // Radius grows with difficulty; the bank is most of the neutral
        // angle for the expected speed, so a ball at that speed needs only a
        // little inward steering and a slower ball drifts gently inward.
        const radius = (16 + 10 * Math.min(D, 1.6)) * r.range(0.9, 1.25);
        const bank = Math.min(45 * DEG, 0.75 * Math.atan((v * v) / (g * radius)) * r.range(0.9, 1.1));
        this._turn(st, fr, angle, radius, bank, { walls: r.chance(0.45 + 0.4 * D), ease: 4 + 7 * Math.min(D, 1.6) });
        if (r.chance(0.5)) this._gems(fr, dc, 4, 4, 0);
        break;
      }
      case 'sharp': {
        const dir = this._turnDir();
        const angle = dir * r.range(70, 110) * DEG;
        const radius = (7 + 5 * Math.min(D, 1.6)) * r.range(0.9, 1.15);
        const bank = Math.min(45 * DEG, 0.85 * Math.atan((v * v) / (g * radius)));
        const tall = D > 0.6;
        this._straight(st, fr, 2, { walls: true, tall });
        this._widthRamp(st, fr, 3, this.W + 1.5, { walls: true, tall });
        this._turn(st, fr, angle, radius, bank, { walls: true, width: this.W + 1.5, tall, bothWalls: true, ease: 5 + 6 * Math.min(D, 1.6) });
        this._widthRamp(st, fr, 3, this.W, { walls: true, tall });
        this._straight(st, fr, 2, { walls: true, tall });
        break;
      }
      case 'chicane': {
        const dir = this._turnDir();
        const angle = (28 + 25 * Math.min(D, 1)) * DEG * r.range(0.85, 1.15);
        const radius = (14 + 8 * Math.min(D, 1.6)) * r.range(0.9, 1.2);
        const bank = Math.min(45 * DEG, 0.7 * Math.atan((v * v) / (g * radius)) * r.range(0.9, 1.1));
        const walls = D > 0.15;
        const tall = D > 0.8;
        const ease = 4 + 7 * Math.min(D, 1.6);
        this._turn(st, fr, dir * angle, radius, bank, { walls, tall, ease });
        this._straight(st, fr, 3 + 5 * Math.min(D, 1.6), { walls, tall });
        this._turn(st, fr, -dir * angle, radius, bank, { walls, tall, ease });
        this._gems(fr, dc, 3, 3, 0);
        break;
      }
      case 'hill': {
        // Crest height is a fraction of the energy the ball has at the
        // expected speed (rolling: v^2 = 2 g h * 7/5).
        const L = r.range(18, 28) + 14 * Math.min(D, 1.6);
        const h = ((v * v) / (2 * g * 1.4)) * r.range(0.35, 0.55);
        const A = Math.min(22 * DEG, Math.max(4 * DEG, (h * Math.PI) / L));
        this._pitched(st, fr, L, (t) => A * Math.sin(2 * Math.PI * t));
        this._gems(fr, dc, 3, 4, 0, Math.floor(fr.length * 0.5));
        break;
      }
      case 'wave': {
        const k = r.int(2, 4);
        const L = k * (r.range(9, 12) + 6 * Math.min(D, 1.6));
        const hw = ((v * v) / (2 * g * 1.4)) * r.range(0.15, 0.28);
        const A = Math.min(16 * DEG, Math.max(4 * DEG, (hw * Math.PI * k) / L));
        this._pitched(st, fr, L, (t) => A * Math.sin(2 * Math.PI * k * t), { walls: r.chance(0.4) });
        break;
      }
      case 'drop': {
        const L = r.range(20, 30) + 14 * Math.min(D, 1.6);
        const A = r.range(14, 22) * DEG;
        this._pitched(st, fr, L, (t) => -A * plateau(t, 0.3), { walls: D > 0.8 });
        this._gems(fr, dc, 4, 4, 0);
        break;
      }
      case 'spiral': {
        const dir = this._turnDir(true);
        const angle = dir * r.range(150, 200) * DEG;
        const radius = (10 + 5 * Math.min(D, 1.6)) * r.range(0.9, 1.2);
        const bank = r.range(25, 38) * DEG;
        const pitch = -r.range(9, 14) * DEG;
        const ease = 8 + 6 * Math.min(D, 1.6);
        const tall = D > 0.6;
        this._straight(st, fr, 3, { walls: true, tall });
        this._pitched(st, fr, ease, (t) => pitch * smoothstep(t), { walls: true, tall });
        // a straight run at the descent angle so a ball that lofts off the
        // crest lands before the turn begins
        this._straight(st, fr, 6 + 10 * Math.min(D, 1.6), { walls: true, pitch, tall });
        this._turn(st, fr, angle, radius, bank, { walls: true, pitch, tall, bothWalls: true, ease: 4 + 6 * Math.min(D, 1.6) });
        this._pitched(st, fr, ease, (t) => pitch * (1 - smoothstep(t)), { walls: true, tall });
        this._straight(st, fr, 4, { walls: true, tall });
        break;
      }
      case 'boost': {
        this._straight(st, fr, 5);
        this._pad(st, fr, dc, padSpeed(D));
        this._straight(st, fr, 10);
        this._gems(fr, dc, 3, 3, 0);
        break;
      }
      case 'jump': {
        const gap = 4 + 7 * Math.min(D, 1.2) * r.range(0.6, 1);
        const drop = 3 + 1.5 * Math.min(D, 1);
        const ramp = 14 * DEG;
        const need = requiredJumpSpeed(gap + 1.5, drop, ramp);
        if (need > 9 + 6 * D) {
          this._straight(st, fr, 3, { walls: true });
          this._pad(st, fr, dc, Math.max(padSpeed(D), need * 1.15), 3, { walls: true });
          this._straight(st, fr, 5, { walls: true });
        } else {
          this._straight(st, fr, 6, { walls: true });
        }
        // ramp up to a lip
        const n = Math.round(4 / DS);
        for (let i = 0; i < n; i++) this._step(st, fr, { pitch: ramp * smoothstep((i + 1) / n), wallL: true, wallR: true });
        // the gap: horizontal frames with no surface, landing is `drop` lower
        const ng = Math.max(1, Math.round(gap / DS));
        for (let i = 0; i < ng; i++) this._step(st, fr, { pitch: 0, gap: true, dy: i === 0 ? -drop : 0 });
        // gem arc over the gap is a nice carrot
        const gstep = Math.max(1, Math.round(1.5 / DS));
        for (let i = gstep; i < ng - 1; i += gstep) dc.push({ type: 'gem', index: fr.length - ng + i, lateral: 0, lift: drop * 0.5 + 1.2 });
        // landing: wider, walled, long enough for the fastest plausible flight
        const vFast = maxSpeed(D) + 10;
        const range = jumpRange(vFast, drop, ramp) * 1.3;
        const landing = Math.max(10, range - gap + 6);
        this._straight(st, fr, landing, { walls: true, width: this.W + 1.5 });
        this._widthRamp(st, fr, 4, this.W, { walls: false });
        break;
      }
      case 'loop': {
        const R = r.range(5.5, 7);
        const need = requiredLoopSpeed(R);
        this._straight(st, fr, 8, { walls: true });
        // The boost zone runs right into the loop mouth so a ball that stalls
        // and rolls back gets re-launched.
        const pad = this._pad(st, fr, dc, Math.max(padSpeed(D), need), 4, { walls: true });
        const lead = Math.round(4.5 / DS); // deep enough to re-launch a ball that stalls on the climb
        this._helix(st, fr, R, this.W + 4.5, lead);
        pad.to = pad.to + lead;
        this._straight(st, fr, 6, { walls: true });
        break;
      }
      case 'narrow': {
        const L = r.range(10, 18) + 6 * Math.min(D, 1.6);
        const wn = r.range(2.0, 2.6);
        this._widthRamp(st, fr, 3, wn);
        this._straight(st, fr, L, { width: wn });
        this._gems(fr, dc, 4, 3, 0);
        this._widthRamp(st, fr, 3, this.W);
        break;
      }
      case 'gate': {
        this._straight(st, fr, 5, { walls: true, zone: ZONE.GOAL });
        dc.push({ type: 'gate', index: fr.length - 1 });
        this._straight(st, fr, 7, { walls: true, zone: ZONE.GOAL });
        break;
      }
      default:
        this._straight(st, fr, 12);
    }
  }

  _turnDir(strong = false) {
    // Bias turns back towards the global forward (-Z, yaw 0) so the track
    // keeps making progress instead of circling.
    const yaw = this.state.yaw;
    const limit = strong ? 0.4 : 0.9;
    if (Math.abs(yaw) > limit && this.rng.chance(strong ? 0.95 : 0.8)) return yaw > 0 ? -1 : 1;
    return this.rng.sign();
  }

  _chooseKind(D) {
    if (this.sinceGate >= 5) return 'gate';
    const last = this.lastKinds[this.lastKinds.length - 1];
    const big = last === 'loop' || last === 'jump' || last === 'spiral';
    const items = [];
    const add = (k, w) => { if (w > 0) items.push({ k, w }); };
    add('straight', 2.5);
    add('turn', 3);
    add('boost', 1.2);
    add('drop', 1.2);
    add('hill', 1 + D);
    add('chicane', 0.8 + 0.6 * D);
    if (!big) {
      add('sharp', D > 0.15 ? 0.5 + 2 * D : 0);
      add('wave', D > 0.2 ? 0.5 + D : 0);
      add('jump', D > 0.1 ? 0.6 + 2 * D : 0);
      add('loop', D > 0.3 ? 0.5 + 1.6 * D : 0);
      add('narrow', D > 0.35 ? 0.4 + 1.5 * D : 0);
      add('spiral', D > 0.25 ? 0.5 + D : 0);
    }
    return this.rng.weighted(items);
  }

  _try(kind, D, force = false) {
    const st = this._cloneState();
    const fr = [];
    const dc = [];
    this.W = kind === 'start' ? baseWidth(0) : baseWidth(D);
    if (kind !== 'start' && Math.abs(st.width - this.W) > 0.05) this._widthRamp(st, fr, 5, this.W);
    this._buildPiece(kind, D, st, fr, dc);
    if (!force && this._collides(fr)) return null;
    return { kind, frames: fr, decor: dc, stateAfter: st };
  }

  // Generate and commit the next piece.  Returns the piece descriptor with
  // global frame indices [start, end] (start is shared with the previous piece).
  next(D) {
    const kind = this.pieces.length === 0 ? 'start' : this._chooseKind(D);
    let piece = this._try(kind, D, kind === 'start');
    let attempts = 0;
    while (!piece && attempts < 6) {
      piece = this._try(attempts < 3 ? this._chooseKind(D) : 'straight', D, false);
      attempts++;
    }
    if (!piece) piece = this._try('straight', D, true);

    const start = this.frames.length - 1;
    for (const f of piece.frames) { this.frames.push(f); this._gridAdd(f); }
    const end = this.frames.length - 1;
    this.state = piece.stateAfter;
    for (const d of piece.decor) {
      d.index = start + 1 + d.index;
      if (d.from != null) { d.from += start + 1; d.to += start + 1; }
    }

    piece.start = start;
    piece.end = end;
    delete piece.frames;
    delete piece.stateAfter;
    this.pieces.push(piece);
    this.lastKinds.push(piece.kind);
    if (this.lastKinds.length > 4) this.lastKinds.shift();
    this.sinceGate = piece.kind === 'gate' ? 0 : this.sinceGate + 1;

    if (this.gridCount > 12000) this._gridPrune(this.state.s - 900);
    return piece;
  }
}

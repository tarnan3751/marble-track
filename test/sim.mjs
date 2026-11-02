// Headless validation: generates a track, builds chunks and rolls a scripted
// ball down it with the same gravity-tilt logic the game uses.
import * as THREE from 'three';
import { CFG, difficultyAt, autoTilt, maxSpeed, capDrag } from '../src/config.js';
import { applyControl } from '../src/control.js';
import { TrackGenerator, requiredLoopSpeed } from '../src/track.js';
import { buildChunk } from '../src/trackMesh.js';
import { loadRapier, Physics } from '../src/physics.js';

const seed = Number(process.argv[2] || 12345);
const maxSeconds = Number(process.argv[3] || 240);
const forwardInput = Number(process.argv[4] || 1.0);

const gen = new TrackGenerator(seed);
const R = await loadRapier();
const phys = new Physics(R);
const frames = gen.frames;

const chunks = [];
let dist = 0;
let pending = null;
function build(piece) {
    const fr = frames.slice(piece.start, piece.end + 1);
    const prev = piece.start > 0 ? frames[piece.start - 1] : null;
    const next = piece.end + 1 < frames.length ? frames[piece.end + 1] : null;
    for (const f of fr) {
      for (const v of [f.p, f.T, f.N, f.B]) if (!Number.isFinite(v.x + v.y + v.z)) throw new Error(`NaN frame in ${piece.kind}`);
    }
    const { geometry, collider } = buildChunk(fr, prev, next);
    if (collider.indices.length === 0) throw new Error(`empty collider ${piece.kind}`);
    for (let i = 0; i < collider.vertices.length; i++) if (!Number.isFinite(collider.vertices[i])) throw new Error('NaN collider');
    const col = phys.addTrimesh(collider.vertices, collider.indices);
    chunks.push({ piece, col, endS: fr[fr.length - 1].s, tris: collider.indices.length / 3, vtris: geometry.getAttribute('position').count / 3 });
}
function stream(ballS) {
  while (gen.lastFrame.s - ballS < CFG.aheadDistance) {
    const piece = gen.next(difficultyAt(dist));
    if (pending) build(pending);
    pending = piece;
  }
  while (chunks.length && chunks[0].endS < ballS - CFG.behindDistance) phys.removeCollider(chunks.shift().col);
}

stream(0);
const start = frames[6];
phys.createBall(start.p.x, start.p.y + CFG.ballRadius + 0.05, start.p.z);
const body = phys.ball;

let progress = 6, heading = start.yaw, speed = 0;
const ballPos = new THREE.Vector3();
const H = CFG.physicsDt;
let t = 0, maxSpeedSeen = 0, falls = 0, airMax = 0, air = 0;
const kindsSeen = new Map();
let lastPieceIdx = -1;
const trace = [];
const anomalies = [];
let stuckIdx = 0, stuckTime = 0;
let lastGround = null;
let boostTimer = 0, boostCap = 0;
const ring = [];
const log = [];

function pieceAt(idx) { return chunks.find((c) => idx >= c.piece.start && idx <= c.piece.end); }

while (t < maxSeconds) {
  const tr = body.translation();
  ballPos.set(tr.x, tr.y, tr.z);
  // nearest frame
  let best = progress, bd = Infinity;
  for (let i = Math.max(0, progress - Math.round(15 / CFG.ds)); i <= Math.min(frames.length - 1, progress + Math.round(45 / CFG.ds)); i++) {
    const d = frames[i].p.distanceToSquared(ballPos);
    if (d < bd) { bd = d; best = i; }
  }
  progress = best;
  const f = frames[progress];
  dist = Math.max(dist, f.s);
  const D = difficultyAt(dist);
  stream(f.s);

  const pc = pieceAt(progress);
  if (pc && pc.piece !== lastPieceIdx) {
    lastPieceIdx = pc.piece;
    kindsSeen.set(pc.piece.kind, (kindsSeen.get(pc.piece.kind) || 0) + 1);
    log.push(`${t.toFixed(1).padStart(6)}s  s=${f.s.toFixed(0).padStart(5)}  D=${D.toFixed(2)}  v=${speed.toFixed(1).padStart(5)}  ${pc.piece.kind}`);
  }

  // scripted control: forward + steer towards the centre line with lookahead
  heading += (f.yaw - heading) * (1 - Math.exp(-H * 4.5));
  const rel = ballPos.clone().sub(f.p);
  const lateral = rel.dot(f.B);
  const v = body.linvel();
  const latVel = v.x * f.B.x + v.y * f.B.y + v.z * f.B.z;
  const look = Math.min(frames.length - 1, progress + Math.round(Math.min(9, Math.max(4, speed * 0.6)) / CFG.ds));
  const fa = frames[look];
  const latAhead = ballPos.clone().sub(fa.p).dot(fa.B) + latVel * 0.3;
  let ix = THREE.MathUtils.clamp(-lateral * 0.35 - latAhead * 0.45 - latVel * 0.12, -1, 1);
  if (Math.abs(f.pitch) > 0.4) ix *= 0.25; // don't fight the loop
  let iy = forwardInput;
  const bias = autoTilt(D);
  boostTimer = Math.max(0, boostTimer - H);
  const vmax = boostTimer > 0 ? Math.max(maxSpeed(D), boostCap) : maxSpeed(D);
  const groundedNow = phys.rayFromBall(tr.x, tr.y, tr.z, -f.N.x, -f.N.y, -f.N.z, CFG.ballRadius + 0.25) >= 0;
  applyControl(phys, f, ix, iy, bias, heading, vmax, groundedNow, H, [0, 0, 0]);
  speed = Math.hypot(v.x, v.y, v.z);
  maxSpeedSeen = Math.max(maxSpeedSeen, speed);
  if (speed > vmax) { const k = Math.min(0.5, (capDrag(speed - vmax) * H) / speed); body.setLinvel({ x: v.x * (1 - k), y: v.y * (1 - k), z: v.z * (1 - k) }, true); }
  // periodic trace + stuck detection
  if (Math.floor(t / 2) !== Math.floor((t - H) / 2)) {
    trace.push(`${t.toFixed(0).padStart(4)}s idx=${progress} s=${f.s.toFixed(0)} v=${speed.toFixed(1)} lat=${lateral.toFixed(2)} dy=${(ballPos.y - f.p.y).toFixed(2)} pitch=${(f.pitch * 180 / Math.PI).toFixed(0)} kind=${pc ? pc.piece.kind : '?'}`);
    if (progress <= stuckIdx + 4) { stuckTime += 2; if (stuckTime >= 20) { log.push(`${t.toFixed(1)}s  *** STUCK at idx ${progress} (${pc ? pc.piece.kind : '?'}) — last trace:\n` + trace.slice(-12).join('\n')); break; } } else { stuckTime = 0; stuckIdx = progress; }
  }

  // boost pads
  if (pc) {
    for (const d of pc.piece.decor) {
      if (d.type !== 'pad') continue;
      if (progress >= d.from && progress <= d.to && Math.abs(lateral) < f.w / 2 && (d.lastUsed === undefined || t - d.lastUsed > 1) && phys.rayFromBall(tr.x, tr.y, tr.z, -f.N.x, -f.N.y, -f.N.z, CFG.ballRadius + 0.25) >= 0) {
        d.lastUsed = t;
        const along = v.x * f.T.x + v.y * f.T.y + v.z * f.T.z;
        const target = Math.max(along, d.speed);
        const nv = new THREE.Vector3(f.T.x * target + (v.x - f.T.x * along) * 0.5, f.T.y * target + (v.y - f.T.y * along) * 0.5, f.T.z * target + (v.z - f.T.z * along) * 0.5);
        body.setLinvel({ x: nv.x, y: nv.y, z: nv.z }, true);
        const w = new THREE.Vector3().crossVectors(f.N, nv).divideScalar(CFG.ballRadius);
        body.setAngvel({ x: w.x, y: w.y, z: w.z }, true);
        boostTimer = CFG.boostGrace; boostCap = target;
        log.push(`${t.toFixed(1).padStart(6)}s  BOOST -> ${target.toFixed(1)} (pad ${d.speed.toFixed(1)})`);
      }
    }
  }

  if (pc && (pc.piece.kind === 'straight' || pc.piece.kind === 'gate') && Math.abs(f.pitch) < 1e-3 && Math.abs(lateral) < f.w / 2 - 0.6) {
    const h = rel.dot(f.N);
    if (h < 0.42 || h > 0.75) anomalies.push(`${t.toFixed(2)}s h=${h.toFixed(3)} v=${speed.toFixed(1)} idx=${progress} ${pc.piece.kind}`);
  }
  const hit = phys.rayFromBall(tr.x, tr.y, tr.z, -f.N.x, -f.N.y, -f.N.z, CFG.ballRadius + 0.25);
  if (Math.round(t * 20) !== Math.round((t - H) * 20)) {
    const hh = rel.dot(f.N);
    const av = body.angvel(); const wr = Math.hypot(av.x, av.y, av.z) * CFG.ballRadius;
    const gr = phys.rayFromBall(tr.x, tr.y, tr.z, -f.N.x, -f.N.y, -f.N.z, CFG.ballRadius + 0.08) >= 0 ? 'G' : '-';
    ring.push(`${t.toFixed(2)}s s=${f.s.toFixed(1)} v=${speed.toFixed(1)} wr=${wr.toFixed(1)} ${gr} h=${hh.toFixed(2)} lat=${lateral.toFixed(2)} ix=${ix.toFixed(2)} pitch=${(f.pitch * 180 / Math.PI).toFixed(0)} boost=${f.boost ? 1 : 0} ${pc ? pc.piece.kind : '?'}`);
    if (ring.length > 70) ring.shift();
  }
  if (hit >= 0) {
    airMax = Math.max(airMax, air); air = 0;
    lastGround = { t, hs: Math.hypot(v.x, v.z), lateral, ix, s: f.s, kind: pc ? pc.piece.kind : '?', pitch: f.pitch, w: f.w };
  } else air += H;

  phys.step();
  t += H;

  const dy = ballPos.y - f.p.y, dh = Math.hypot(ballPos.x - f.p.x, ballPos.z - f.p.z);
  if (dy < -9 || dh > 14) {
    falls++;
    const lg = lastGround;
    if (process.env.DUMP && lg && new RegExp(process.env.DUMP).test(lg.kind)) {
      log.push('   ring:\n   ' + ring.join('\n   '));
      if (process.env.FRAMES) {
        const [a, b] = process.env.FRAMES.split(',').map(Number);
        const lines = [];
        for (const fr of frames) {
          if (fr.s < a || fr.s > b) continue;
          const pk = chunks.find((c) => frames.indexOf(fr) >= c.piece.start && frames.indexOf(fr) <= c.piece.end);
          lines.push(`s=${fr.s.toFixed(1)} y=${fr.p.y.toFixed(3)} x=${fr.p.x.toFixed(2)} z=${fr.p.z.toFixed(2)} By=${fr.B.y.toFixed(3)} Ny=${fr.N.y.toFixed(3)} pitch=${(fr.pitch * 180 / Math.PI).toFixed(1)} w=${fr.w.toFixed(2)} wL=${fr.wallL ? 1 : 0} wR=${fr.wallR ? 1 : 0} tall=${fr.tall ? 1 : 0} gap=${fr.gap ? 1 : 0} ${pk ? pk.piece.kind : '?'}`);
        }
        log.push('   frames:\n   ' + lines.join('\n   '));
      }
    }
    log.push(`${t.toFixed(1).padStart(6)}s  *** FALL OUT — left track in ${lg ? lg.kind : '?'} at s=${lg ? lg.s.toFixed(0) : '?'} hs=${lg ? lg.hs.toFixed(1) : '?'} lateral=${lg ? lg.lateral.toFixed(2) : '?'} (w=${lg ? lg.w.toFixed(1) : '?'}) ix=${lg ? lg.ix.toFixed(2) : '?'} pitch=${lg ? (lg.pitch * 180 / Math.PI).toFixed(0) : '?'}`);
    // respawn at piece start
    const rs = frames[Math.max(0, (pc ? pc.piece.start : progress) + Math.round(1 / CFG.ds))];
    phys.teleportBall(rs.p.x + rs.N.x * 0.6, rs.p.y + rs.N.y * 0.6, rs.p.z + rs.N.z * 0.6);
    progress = Math.max(0, (pc ? pc.piece.start : progress) + Math.round(1 / CFG.ds));
    heading = rs.yaw;
    if (falls > 40) break;
  }
}

console.log(log.join('\n'));
console.log('---');
console.log(`seed ${seed}: ran ${t.toFixed(0)}s, distance ${dist.toFixed(0)} m, D=${difficultyAt(dist).toFixed(2)}, falls ${falls}, max speed ${maxSpeedSeen.toFixed(1)}, longest air ${airMax.toFixed(2)}s`);
console.log(`height anomalies on flat track: ${anomalies.length}`); if (anomalies.length) console.log(anomalies.slice(0, 10).join('\n'));
console.log('pieces:', [...kindsSeen.entries()].map(([k, n]) => `${k}:${n}`).join(' '));
const tri = chunks.reduce((a, c) => a + c.tris, 0), vt = chunks.reduce((a, c) => a + c.vtris, 0);
console.log(`live chunks ${chunks.length}, collider tris ${tri}, visual tris ${vt}, frames ${frames.length}, loop need(6)=${requiredLoopSpeed(6).toFixed(1)}`);

// Isolated loop test: straight -> helix -> straight, launch the ball at a given
// speed and see whether it clears the loop.
import * as THREE from 'three';
import { CFG } from '../src/config.js';
import { TrackGenerator, requiredLoopSpeed } from '../src/track.js';
import { buildChunk } from '../src/trackMesh.js';
import { loadRapier, Physics } from '../src/physics.js';

const R = Number(process.argv[2] || 6.5);
const v0 = Number(process.argv[3] || requiredLoopSpeed(R));
const spin = process.argv[4] !== 'nospin';
const tiltForward = Number(process.argv[5] || 0); // 0..1 forward tilt fraction

const gen = new TrackGenerator(1);
const st = gen._cloneState();
const fr = [];
gen._straight(st, fr, 12, { walls: true });
const helixStart = fr.length;
gen._helix(st, fr, R, CFG.trackWidth + 3.5);
const helixEnd = fr.length;
gen._straight(st, fr, 14, { walls: true });
const frames = [gen.frames[0], ...fr];
const { collider } = buildChunk(frames);

const RAP = await loadRapier();
const phys = new Physics(RAP);
phys.addTrimesh(collider.vertices, collider.indices);
const start = frames[4];
phys.createBall(start.p.x, start.p.y + CFG.ballRadius + 0.02, start.p.z);
const body = phys.ball;
body.setLinvel({ x: start.T.x * v0, y: start.T.y * v0, z: start.T.z * v0 }, true);
if (spin) {
  const w = new THREE.Vector3().crossVectors(start.N, start.T.clone().multiplyScalar(v0)).divideScalar(CFG.ballRadius);
  body.setAngvel({ x: w.x, y: w.y, z: w.z }, true);
}
const tilt = CFG.maxTilt * tiltForward;
phys.setGravity(start.T.x * CFG.gravity * Math.sin(tilt), -CFG.gravity * Math.cos(tilt), start.T.z * CFG.gravity * Math.sin(tilt));

const H = CFG.physicsDt;
let progress = 4, maxIdx = 4, t = 0, out = [];
const bp = new THREE.Vector3();
for (let step = 0; step < 120 * 8; step++) {
  const tr = body.translation(); bp.set(tr.x, tr.y, tr.z);
  let best = progress, bd = Infinity;
  for (let i = Math.max(0, progress - 60); i <= Math.min(frames.length - 1, progress + 120); i++) {
    const d = frames[i].p.distanceToSquared(bp); if (d < bd) { bd = d; best = i; }
  }
  progress = best; maxIdx = Math.max(maxIdx, progress);
  const v = body.linvel(); const sp = Math.hypot(v.x, v.y, v.z);
  const f = frames[progress];
  const h = bp.clone().sub(f.p).dot(f.N);
  const lat = bp.clone().sub(f.p).dot(f.B);
  if (step % 12 === 0) out.push(`${t.toFixed(2)}s idx=${progress} pitch=${(f.pitch * 180 / Math.PI).toFixed(0).padStart(4)} v=${sp.toFixed(1).padStart(5)} h=${h.toFixed(2)} lat=${lat.toFixed(2)}`);
  if (progress >= helixEnd + 10) { out.push(`CLEARED loop at t=${t.toFixed(2)} v=${sp.toFixed(1)}`); break; }
  if (bp.y < -5) { out.push(`FELL at t=${t.toFixed(2)} (max pitch reached ${(frames[maxIdx].pitch * 180 / Math.PI).toFixed(0)})`); break; }
  phys.step(); t += H;
}
console.log(`R=${R} v0=${v0.toFixed(1)} spin=${spin} tilt=${tiltForward} need=${requiredLoopSpeed(R).toFixed(1)}`);
console.log(out.join('\n'));

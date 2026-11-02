// Steering authority: full lateral input on a wide flat slab at several speeds.
// Reports the steady turn radius and how far the ball moves sideways in 1 s.
import * as THREE from 'three';
import { CFG, maxSpeed } from '../src/config.js';
import { TrackGenerator } from '../src/track.js';
import { buildChunk } from '../src/trackMesh.js';
import { loadRapier, Physics } from '../src/physics.js';
import { applyControl } from '../src/control.js';

const gen = new TrackGenerator(1);
const st = gen._cloneState();
const fr = [];
gen._straight(st, fr, 120, { width: 80 });
const frames = [gen.frames[0], ...fr];
const { collider } = buildChunk(frames);
const R = await loadRapier();

for (const v0 of [10, 20, 30]) {
  const phys = new Physics(R);
  phys.addTrimesh(collider.vertices, collider.indices);
  const f = frames[8];
  phys.createBall(f.p.x, f.p.y + CFG.ballRadius + 0.02, f.p.z);
  const body = phys.ball;
  body.setLinvel({ x: f.T.x * v0, y: f.T.y * v0, z: f.T.z * v0 }, true);
  const w = new THREE.Vector3().crossVectors(f.N, f.T.clone().multiplyScalar(v0)).divideScalar(CFG.ballRadius);
  body.setAngvel({ x: w.x, y: w.y, z: w.z }, true);
  const H = CFG.physicsDt;
  let t = 0, lastDir = null, yawRateSum = 0, n = 0, lat1s = null;
  const start = body.translation();
  while (t < 1.5) {
    // heading follows the ball's own direction (as the camera does in a bend)
    // and the cap sits at the launch speed so the tilt cannot add speed.
    const vv = body.linvel();
    const heading = Math.atan2(-vv.x, -vv.z);
    applyControl(phys, f, 1, 0, 0, heading, v0, true, H, [0, 0, 0]);
    phys.step(); t += H;
    const v = body.linvel();
    const dir = Math.atan2(v.x, -v.z);
    if (lastDir != null && t > 0.3) { yawRateSum += (dir - lastDir) / H; n++; }
    lastDir = dir;
    if (lat1s == null && t >= 1) { const p = body.translation(); lat1s = (p.x - start.x) * f.B.x + (p.z - start.z) * f.B.z; }
  }
  const v = body.linvel(); const sp = Math.hypot(v.x, v.z);
  const yawRate = yawRateSum / n;
  console.log(`v0=${v0}: speed now ${sp.toFixed(1)} m/s, yaw rate ${(yawRate * 180 / Math.PI).toFixed(0)} deg/s, turn radius ${(sp / Math.abs(yawRate)).toFixed(1)} m, sideways after 1 s ${lat1s.toFixed(1)} m`);
}

// Player control -> physics.  Shared by the game and the headless sim so the
// two never drift apart.

import { CFG, tiltedGravity } from './config.js';

const clamp1 = (x) => Math.max(-1, Math.min(1, x));

// Circular stick gate that prefers lateral authority: when the input exceeds
// the unit circle the forward component gives way, not the sideways one.
export function clampStick(ix, iy) {
  ix = clamp1(ix);
  if (ix * ix + iy * iy > 1) iy = Math.sign(iy) * Math.sqrt(Math.max(0, 1 - ix * ix));
  return [ix, clamp1(iy)];
}

// Extra sideways acceleration (m/s^2) at full lateral input, perpendicular to
// the velocity in the surface plane.  Grows with speed so a full-stick turn
// keeps a usable radius as the game speeds up.
export function gripAccel(speed) {
  return 5 + 0.4 * speed;
}

// Apply one physics step's worth of control.  `frame` is the nearest track
// frame, `bias` the automatic forward tilt, `grounded` whether the ball is on
// the surface.  Sets world gravity and applies the grip impulse.  Returns the
// clamped [ix, iy] that was used.
export function applyControl(physics, frame, ix, iy, bias, heading, vmax, grounded, h, out) {
  const body = physics.ball;
  const v = body.linvel();
  [ix, iy] = clampStick(ix, iy);
  const iyTotal = clamp1(iy + bias);
  tiltedGravity(ix, iyTotal, heading, v.x, v.z, vmax, out);
  physics.setGravity(out[0], out[1], out[2]);

  if (grounded && Math.abs(ix) > 0.01) {
    const sp = Math.hypot(v.x, v.y, v.z);
    if (sp > 2) {
      // right-of-velocity within the surface: v x N
      const N = frame.N;
      const dx = v.y * N.z - v.z * N.y;
      const dy = v.z * N.x - v.x * N.z;
      const dz = v.x * N.y - v.y * N.x;
      const dl = Math.hypot(dx, dy, dz);
      if (dl > 1e-4) {
        const k = (body.mass() * gripAccel(sp) * ix * h) / dl;
        body.applyImpulse({ x: dx * k, y: dy * k, z: dz * k }, true);
      }
    }
  }
  return [ix, iy];
}

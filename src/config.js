// Shared tuning constants. Everything that both the generator and the
// simulation need to agree on lives here.
export const CFG = {
  ds: 0.25,             // arc-length spacing between track frames
  trackWidth: 4,
  ballRadius: 0.5,
  gravity: 30,          // world gravity magnitude (arcade-high, like Monkey Ball)
  maxTilt: (34 * Math.PI) / 180,
  ballInertiaScale: 0.5, // fraction of a solid sphere's rotational inertia
  wallHeight: 0.9,
  wallThickness: 0.3,
  thickness: 0.5,       // visual/physical slab thickness
  edgeWidth: 0.3,       // light-coloured edge stripe on the top surface
  physicsDt: 1 / 120,
  aheadDistance: 240,   // metres of track kept generated ahead of the ball
  behindDistance: 260,  // metres of track kept behind before culling
  startTime: 60,
  goalTimeBonus: 20,
  lives: 3,
  boostGrace: 2.5,      // seconds after a pad during which the speed cap is lifted
};

// Difficulty 0..1.6 as a function of distance travelled (metres).
export function difficultyAt(dist) {
  return Math.max(0, Math.min(1.6, (dist - 80) / 1400));
}

// Fraction of max tilt applied automatically in the forward direction.
export function autoTilt(D) {
  return 0.25 + 0.45 * Math.min(D, 1.4);
}

// Typical cruising speed at a given difficulty: the generator sizes turns,
// banks and hills from this so the track never asks for speed you can't have.
export function expectedSpeed(D) {
  return maxSpeed(D) + 2;
}

// Soft speed cap for the ball at a given difficulty.
export function maxSpeed(D) {
  return 11 + 14 * Math.min(D, 1.6);
}

// Mild deceleration (m/s^2) applied above the cap so a boost pad still
// carries you a few seconds past it.
export function capDrag(excess) {
  return 1 + 0.25 * excess;
}

// How much of the forward tilt push survives at a given speed over the cap:
// 1 below the cap, fading to 0 a few m/s above it.
export function tiltPushFactor(speed, vmax) {
  return Math.max(0, Math.min(1, (vmax + 4 - speed) / 4));
}

// Speed a boost pad sets at a given difficulty.
export function padSpeed(D) {
  return 17 + 11 * Math.min(D, 1.6);
}

// Compute the tilted gravity vector.  ix is the lateral tilt input and iy the
// forward tilt input (each -1..1, already clamped), `heading` the camera yaw,
// (vx, vz) the ball's horizontal velocity and vmax the current soft cap.
// The two tilts compose as a roll about the forward axis followed by a pitch
// about the right axis, so full sideways input always gives the full lateral
// tilt regardless of the forward tilt.  Writes [gx, gy, gz].
export function tiltedGravity(ix, iy, heading, vx, vz, vmax, out) {
  const g = CFG.gravity;
  const fx = -Math.sin(heading), fz = -Math.cos(heading);
  const rx = Math.cos(heading), rz = -Math.sin(heading);
  const a = CFG.maxTilt * Math.max(-1, Math.min(1, ix));
  const b = CFG.maxTilt * Math.max(-1, Math.min(1, iy));
  const sa = Math.sin(a), ca = Math.cos(a), sb = Math.sin(b);
  // horizontal part of the unit gravity direction
  let hx = rx * sa + fx * ca * sb;
  let hz = rz * sa + fz * ca * sb;
  // cut the forward push once we're over the cap, keep braking and steering
  const hs = Math.hypot(vx, vz);
  if (hs > vmax && hs > 0.5) {
    const ux = vx / hs, uz = vz / hs;
    const along = hx * ux + hz * uz;
    if (along > 0) {
      const keep = tiltPushFactor(hs, vmax);
      hx -= ux * along * (1 - keep);
      hz -= uz * along * (1 - keep);
    }
  }
  const vy = -Math.sqrt(Math.max(0, 1 - hx * hx - hz * hz));
  out[0] = hx * g; out[1] = vy * g; out[2] = hz * g;
  return out;
}

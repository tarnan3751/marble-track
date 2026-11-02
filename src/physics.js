import RAPIER from '@dimforge/rapier3d-compat';
import { CFG } from './config.js';

export async function loadRapier() {
  await RAPIER.init();
  return RAPIER;
}

export class Physics {
  constructor(R) {
    this.R = R;
    this.world = new R.World({ x: 0, y: -CFG.gravity, z: 0 });
    this.world.timestep = CFG.physicsDt;
    this.ball = null;
    this.ballCollider = null;
  }

  createBall(x, y, z) {
    const R = this.R;
    const desc = R.RigidBodyDesc.dynamic()
      .setTranslation(x, y, z)
      .setCcdEnabled(true)
      .setCanSleep(false)
      .setLinearDamping(0.02)
      .setAngularDamping(0.04);
    this.ball = this.world.createRigidBody(desc);
    const r = CFG.ballRadius;
    const mass = (4 / 3) * Math.PI * r * r * r; // density 1
    const inertia = 0.4 * mass * r * r * CFG.ballInertiaScale;
    const cd = R.ColliderDesc.ball(r)
      .setFriction(0.9)
      .setRestitution(0.3)
      .setMassProperties(mass, { x: 0, y: 0, z: 0 }, { x: inertia, y: inertia, z: inertia }, { x: 0, y: 0, z: 0, w: 1 });
    this.ballCollider = this.world.createCollider(cd, this.ball);
    return this.ball;
  }

  addTrimesh(vertices, indices) {
    const R = this.R;
    const desc = R.ColliderDesc.trimesh(vertices, indices, R.TriMeshFlags.FIX_INTERNAL_EDGES)
      .setFriction(0.9)
      .setRestitution(0.2);
    return this.world.createCollider(desc);
  }

  removeCollider(c) {
    this.world.removeCollider(c, false);
  }

  setGravity(x, y, z) {
    this.world.gravity.x = x;
    this.world.gravity.y = y;
    this.world.gravity.z = z;
  }

  step() {
    this.world.step();
  }

  // Cast a ray from the ball, excluding the ball itself.  Returns distance or -1.
  rayFromBall(ox, oy, oz, dx, dy, dz, maxToi) {
    const ray = new this.R.Ray({ x: ox, y: oy, z: oz }, { x: dx, y: dy, z: dz });
    const hit = this.world.castRay(ray, maxToi, true, undefined, undefined, this.ballCollider, this.ball);
    return hit ? hit.timeOfImpact : -1;
  }

  teleportBall(x, y, z) {
    this.ball.setTranslation({ x, y, z }, true);
    this.ball.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.ball.setAngvel({ x: 0, y: 0, z: 0 }, true);
  }
}

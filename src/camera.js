// Chase camera.  On ordinary track it behaves like Monkey Ball: level, behind
// the ball along the track heading, with the whole view rotated about the ball
// by the stage tilt.  When the surface tips past ~50 degrees (loops) it blends
// into the track's own frame so it follows the ball around the loop instead of
// watching it come back overhead.

import * as THREE from 'three';

const _pos = new THREE.Vector3();
const _look = new THREE.Vector3();
const _rel = new THREE.Vector3();
const _up = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _qLevel = new THREE.Quaternion();
const _qFrame = new THREE.Quaternion();
const _qTilt = new THREE.Quaternion();
const _e = new THREE.Euler();
const UP = new THREE.Vector3(0, 1, 0);
const IDENTITY = new THREE.Quaternion();

function smoothstep(t) { t = Math.max(0, Math.min(1, t)); return t * t * (3 - 2 * t); }

export class CameraRig {
  constructor(camera) {
    this.camera = camera;
    this.heading = 0;
    this.basis = new THREE.Quaternion();
    this.smoothPos = new THREE.Vector3();
    this.distance = 6.8;
    this.height = 4.2;
    this.minAbove = 1.3; // metres the camera must stay above the track surface
    this.baseFov = 62;
    this.initialised = false;
    this.orbit = 0;
    this.follow = 0; // 0 = level camera, 1 = fully in the track frame
  }

  reset(frame, ballPos) {
    this.heading = frame.yaw;
    _e.set(0, frame.yaw, 0, 'YXZ');
    this.basis.setFromEuler(_e);
    this.smoothPos.copy(ballPos);
    this.follow = 0;
    this.initialised = false;
  }

  // ballPos: Vector3, frame: nearest track frame, tiltQuat: stage tilt
  // rotation, speed: scalar, mode: 'play' | 'orbit'
  update(dt, ballPos, frame, tiltQuat, speed, mode) {
    const cam = this.camera;
    if (!this.initialised) { this.reset(frame, ballPos); this.initialised = true; }

    const k = 1 - Math.exp(-dt * 14);
    this.smoothPos.lerp(ballPos, k);

    // how far the surface has tipped away from level
    const tip = Math.acos(Math.max(-1, Math.min(1, frame.N.y)));
    const followTarget = smoothstep((tip - 50 * Math.PI / 180) / (25 * Math.PI / 180));
    this.follow += (followTarget - this.follow) * (1 - Math.exp(-dt * 6));

    let yaw = frame.yaw;
    if (mode === 'orbit') { this.orbit += dt * 0.35; yaw += Math.sin(this.orbit) * 0.9; }
    _e.set(0, yaw, 0, 'YXZ');
    _qLevel.setFromEuler(_e);
    _m.makeBasis(frame.B, frame.N, _fwd.copy(frame.T).negate());
    _qFrame.setFromRotationMatrix(_m);
    _q.copy(_qLevel).slerp(_qFrame, this.follow);

    const rate = mode === 'orbit' ? 20 : 5;
    this.basis.slerp(_q, 1 - Math.exp(-dt * rate));

    _fwd.set(0, 0, -1).applyQuaternion(this.basis);
    if (_fwd.x * _fwd.x + _fwd.z * _fwd.z > 1e-4) this.heading = Math.atan2(-_fwd.x, -_fwd.z);

    const dist = this.distance + Math.min(speed, 40) * 0.05;
    _pos.set(0, this.height, dist).applyQuaternion(this.basis).add(this.smoothPos);
    _look.set(0, 0.5, -4).applyQuaternion(this.basis).add(this.smoothPos);
    _up.copy(UP).applyQuaternion(this.basis);

    _m.lookAt(_pos, _look, _up);
    _q.setFromRotationMatrix(_m);

    // stage tilt about the ball, fading out inside loops
    _qTilt.copy(IDENTITY).slerp(tiltQuat, 1 - this.follow);
    _rel.subVectors(_pos, ballPos).applyQuaternion(_qTilt);
    const above = _rel.dot(frame.N);
    if (above < this.minAbove) _rel.addScaledVector(frame.N, this.minAbove - above);
    cam.position.copy(_rel).add(ballPos);
    cam.quaternion.copy(_qTilt).multiply(_q);

    const fov = this.baseFov + Math.min(speed, 45) * 0.35;
    if (Math.abs(cam.fov - fov) > 0.05) { cam.fov += (fov - cam.fov) * Math.min(1, dt * 6); cam.updateProjectionMatrix(); }
  }
}

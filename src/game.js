import * as THREE from 'three';
import { CFG, difficultyAt, autoTilt, maxSpeed, capDrag, tiltedGravity } from './config.js';
import { applyControl } from './control.js';
import { TrackGenerator } from './track.js';
import { buildChunk, frameQuaternion } from './trackMesh.js';
import { loadRapier, Physics } from './physics.js';
import { CameraRig } from './camera.js';
import { Input } from './input.js';
import { Hud } from './hud.js';
import { Sfx } from './audio.js';
import { makeSky, makeGround, makeBall, makeGem, makePad, makeGate, Particles, padMaterial, makeTrackMaterial } from './decor.js';

const STATE = { TITLE: 'title', READY: 'ready', PLAY: 'play', FALLOUT: 'fallout', OVER: 'over' };
const DOWN = new THREE.Vector3(0, -1, 0);
const BEST_KEY = 'marble-rush-best';

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();

export class Game {
  constructor(container) {
    this.container = container;
    this.state = STATE.TITLE;
    this.chunks = [];
    this.now = 0;
    this.acc = 0;
    this.paused = false;
    this.ballPos = new THREE.Vector3();
    this.tiltQuat = new THREE.Quaternion();
    this.speed = 0;
    this.D = 0;
    this.grounded = false;
    this.airTime = 0;
    this.dustAcc = 0;
    this.boostGlow = 0;
    this.boostTimer = 0;
    this.boostCap = 0;
    this.visTilt = { x: 0, y: 0, vx: 0, vy: 0 };
    this.debug = { seed: 0, piece: '' };
    this._g = [0, 0, 0];
    this._gv = [0, 0, 0];
  }

  async init() {
    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    this.container.appendChild(renderer.domElement);
    this.renderer = renderer;

    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog('#c6ecff', 70, 300);
    this.scene = scene;

    this.camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.1, 1500);
    this.cameraRig = new CameraRig(this.camera);

    scene.add(new THREE.HemisphereLight('#dff3ff', '#2f7a63', 1.0));
    const sun = new THREE.DirectionalLight('#fff6e6', 2.4);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.near = 1; sun.shadow.camera.far = 140;
    sun.shadow.camera.left = -30; sun.shadow.camera.right = 30; sun.shadow.camera.top = 30; sun.shadow.camera.bottom = -30;
    sun.shadow.bias = -0.0006; sun.shadow.normalBias = 0.03;
    scene.add(sun); scene.add(sun.target);
    this.sun = sun;

    this.sky = makeSky(); scene.add(this.sky);
    this.ground = makeGround(); scene.add(this.ground);
    this.groundY = -70;

    this.trackMaterial = makeTrackMaterial();

    this.ballMesh = makeBall(); scene.add(this.ballMesh);
    this.particles = new Particles(900); scene.add(this.particles.points);

    const R = await loadRapier();
    this.physics = new Physics(R);
    this.physics.createBall(0, 1, 0);

    const params = new URLSearchParams(window.location.search);
    this.debug = { seed: Number(params.get('seed')) || 0, piece: params.get('piece') || '' };
    this.input = new Input(window);
    this.hud = new Hud();
    this.sfx = new Sfx();
    this.best = Number(localStorage.getItem(BEST_KEY) || 0);

    window.addEventListener('resize', () => this._resize());
    this.newRun();
    this.hud.showTitle(this.best);
  }

  _resize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  // ---- run lifecycle ------------------------------------------------------

  newRun(seed = this.debug.seed || ((Date.now() ^ (Math.random() * 1e9)) >>> 0)) {
    for (const c of this.chunks) this._disposeChunk(c);
    this.chunks = [];
    this.gen = new TrackGenerator(seed);
    this.frames = this.gen.frames;
    this.pending = null;
    this.progress = 0;
    this.checkpoint = Math.round(3 / CFG.ds);
    this.score = 0; this.gems = 0; this.goals = 0; this.dist = 0;
    this.lives = CFG.lives; this.time = CFG.startTime;
    this.D = 0; this.speed = 0;
    this.tiltQuat.identity();
    this.visTilt = { x: 0, y: 0, vx: 0, vy: 0 };
    this._streamTrack();
    // Debug: ?piece=loop jumps the start to the first piece of that kind.
    if (this.debug.piece) {
      let found = this.gen.pieces.find((p) => p.kind === this.debug.piece);
      for (let i = 0; !found && i < 400; i++) {
        this.dist = Math.max(0, this.gen.lastFrame.s - 200);
        const piece = this.gen.next(difficultyAt(this.dist));
        if (this.pending) this._addChunk(this.pending);
        this.pending = piece;
        found = this.gen.pieces.find((p) => p.kind === this.debug.piece);
      }
      if (found) {
        this.checkpoint = found.start + 2;
        this.dist = this.frames[this.checkpoint].s;
        this.D = difficultyAt(this.dist);
        this.progress = this.checkpoint;
        this._streamTrack();
      }
    }
    this._placeBallAt(this.checkpoint);
    this.cameraRig.reset(this.frames[this.checkpoint], this.ballPos);
    this.state = STATE.TITLE;
  }

  _placeBallAt(index) {
    const f = this.frames[index];
    _v.copy(f.p).addScaledVector(f.N, CFG.ballRadius + 0.05);
    this.physics.teleportBall(_v.x, _v.y, _v.z);
    this.ballPos.copy(_v);
    this.ballMesh.position.copy(_v);
    this.progress = index;
  }

  _setReady() {
    this.state = STATE.READY;
    this.readyTimer = 1.4;
    this.hud.message('READY', 1.3);
    this.sfx.ready();
  }

  _fallOut() {
    this.state = STATE.FALLOUT;
    this.fallTimer = 1.6;
    this.hud.message('FALL OUT!', 1.5);
    this.sfx.fall();
  }

  _respawn() {
    this._placeBallAt(this.checkpoint);
    this.cameraRig.reset(this.frames[this.checkpoint], this.ballPos);
    this._setReady();
  }

  _gameOver(title) {
    this.state = STATE.OVER;
    this.overTimer = 1.2;
    this.sfx.gameover();
    this.hud.message(title, 2);
    const isNew = this.score > this.best;
    if (isNew) { this.best = this.score; localStorage.setItem(BEST_KEY, String(this.best)); }
    this.hud.showGameOver(title, { score: this.score, dist: this.dist, gems: this.gems, goals: this.goals }, this.best, isNew);
  }

  // ---- track streaming ----------------------------------------------------

  _addChunk(piece) {
    const frames = this.frames.slice(piece.start, piece.end + 1);
    const prev = piece.start > 0 ? this.frames[piece.start - 1] : null;
    const next = piece.end + 1 < this.frames.length ? this.frames[piece.end + 1] : null;
    const { geometry, collider } = buildChunk(frames, prev, next);
    const mesh = new THREE.Mesh(geometry, this.trackMaterial);
    mesh.castShadow = true; mesh.receiveShadow = true;
    this.scene.add(mesh);
    const col = this.physics.addTrimesh(collider.vertices, collider.indices);
    const chunk = { piece, mesh, collider: col, gems: [], pads: [], gate: null, objects: [], startS: frames[0].s, endS: frames[frames.length - 1].s };
    for (const d of piece.decor) {
      const f = this.frames[d.index];
      if (d.type === 'gem') {
        const m = makeGem();
        m.position.copy(f.p).addScaledVector(f.N, 0.9 + (d.lift || 0)).addScaledVector(f.B, d.lateral || 0);
        m.rotation.y = Math.random() * Math.PI;
        this.scene.add(m);
        chunk.gems.push({ mesh: m, taken: false, pos: m.position.clone(), phase: Math.random() * 6 });
      } else if (d.type === 'pad') {
        const m = makePad(f.w);
        m.position.copy(f.p).addScaledVector(f.N, 0.03);
        frameQuaternion(f, m.quaternion);
        this.scene.add(m);
        chunk.objects.push(m);
        chunk.pads.push({ from: d.from, to: d.to, speed: d.speed, w: f.w, lastUsed: -10 });
      } else if (d.type === 'gate') {
        const g = makeGate(f.w);
        g.position.copy(f.p);
        frameQuaternion(f, g.quaternion);
        this.scene.add(g);
        chunk.objects.push(g);
        chunk.gate = { index: d.index, passed: false, group: g };
      }
    }
    this.chunks.push(chunk);
  }

  _disposeChunk(c) {
    this.scene.remove(c.mesh);
    c.mesh.geometry.dispose();
    this.physics.removeCollider(c.collider);
    for (const g of c.gems) this.scene.remove(g.mesh);
    for (const o of c.objects) {
      this.scene.remove(o);
      o.traverse((n) => { if (n.geometry && n.geometry !== o.geometry) n.geometry.dispose(); });
      if (o.geometry) o.geometry.dispose();
    }
  }

  _streamTrack() {
    const ballS = this.frames[this.progress].s;
    // Pieces are built one behind generation so a chunk knows the frame that
    // follows it (walls and slab must continue seamlessly across chunks).
    while (this.gen.lastFrame.s - ballS < CFG.aheadDistance) {
      const piece = this.gen.next(difficultyAt(this.dist));
      if (this.pending) this._addChunk(this.pending);
      this.pending = piece;
    }
    const keepS = Math.min(ballS, this.frames[this.checkpoint].s) - CFG.behindDistance;
    while (this.chunks.length && this.chunks[0].endS < keepS) this._disposeChunk(this.chunks.shift());
  }

  _updateProgress() {
    const lo = Math.max(0, this.progress - Math.round(15 / CFG.ds));
    const hi = Math.min(this.frames.length - 1, this.progress + Math.round(45 / CFG.ds));
    let best = this.progress, bd = Infinity;
    for (let i = lo; i <= hi; i++) {
      const d = this.frames[i].p.distanceToSquared(this.ballPos);
      if (d < bd) { bd = d; best = i; }
    }
    this.progress = best;
  }

  // ---- simulation ---------------------------------------------------------

  _fixedStep(h) {
    const body = this.physics.ball;
    const ctrl = this.state === STATE.PLAY;
    let ix = 0, iy = 0, bias = 0;
    if (ctrl) { ix = this.input.x; iy = this.input.y; bias = autoTilt(this.D); }

    const yaw = this.cameraRig.heading;
    const vmax = this.boostTimer > 0 ? Math.max(maxSpeed(this.D), this.boostCap) : maxSpeed(this.D);
    this.boostTimer = Math.max(0, this.boostTimer - h);
    const f = this.frames[this.progress];
    const [cx, cy] = applyControl(this.physics, f, ix, iy, bias, yaw, vmax, this.grounded, h, this._g);

    // The camera shows a softened, spring-smoothed copy of the tilt (and only
    // part of the automatic forward bias) so a key tap leans the view instead
    // of snapping it, and the track ahead stays readable at speed.
    const vt = this.visTilt;
    const tx = cx * 0.5, ty = cy * 0.6 + bias * 0.3;
    const w = 16; // critically damped, settles in ~0.3 s
    vt.vx += (w * w * (tx - vt.x) - 2 * w * vt.vx) * h;
    vt.vy += (w * w * (ty - vt.y) - 2 * w * vt.vy) * h;
    vt.x += vt.vx * h;
    vt.y += vt.vy * h;
    tiltedGravity(vt.x, vt.y, yaw, 0, 0, Infinity, this._gv);
    _v.set(this._gv[0], this._gv[1], this._gv[2]).normalize();
    this.tiltQuat.setFromUnitVectors(DOWN, _v);
    const vel = body.linvel();

    if (!ctrl && this.state !== STATE.FALLOUT) {
      body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    } else {
      const v = vel;
      const sp = Math.hypot(v.x, v.y, v.z);
      if (sp > vmax) {
        const k = Math.min(0.5, (capDrag(sp - vmax) * h) / sp);
        body.setLinvel({ x: v.x * (1 - k), y: v.y * (1 - k), z: v.z * (1 - k) }, true);
      }
    }
    this.physics.step();
  }

  _afterPhysics(dt) {
    const body = this.physics.ball;
    const t = body.translation();
    this.ballPos.set(t.x, t.y, t.z);
    this.ballMesh.position.copy(this.ballPos);
    const r = body.rotation();
    this.ballMesh.core.quaternion.set(r.x, r.y, r.z, r.w);
    const v = body.linvel();
    this.speed = Math.hypot(v.x, v.y, v.z);

    this._updateProgress();
    this._streamTrack();
    const f = this.frames[this.progress];

    // grounded test along the local track normal
    const hit = this.physics.rayFromBall(t.x, t.y, t.z, -f.N.x, -f.N.y, -f.N.z, CFG.ballRadius + 0.25);
    const wasGrounded = this.grounded;
    this.grounded = hit >= 0;
    if (this.grounded) {
      if (!wasGrounded && this.airTime > 0.35 && this.state === STATE.PLAY) {
        this.sfx.land();
        _v.copy(this.ballPos).addScaledVector(f.N, -CFG.ballRadius);
        this.particles.emit(_v, 14, { color: '#ffffff', speed: 3, spread: 1.5, life: 0.4, gravity: 6 });
      }
      this.airTime = 0;
    } else {
      this.airTime += dt;
    }

    if (this.state !== STATE.PLAY) return;

    this.dist = Math.max(this.dist, f.s);
    this.D = difficultyAt(this.dist);
    this.time -= dt;
    this.score = Math.floor(this.dist) + this.gems * 50 + this.goals * 500;

    // dust trail
    if (this.grounded && this.speed > 7) {
      this.dustAcc += dt * this.speed * 0.9;
      while (this.dustAcc > 1) {
        this.dustAcc -= 1;
        _v.copy(this.ballPos).addScaledVector(f.N, -CFG.ballRadius * 0.8);
        _w.set(-v.x, -v.y, -v.z).normalize();
        this.particles.emit(_v, 1, { color: '#9fd8c8', speed: 1.5, spread: 1.2, life: 0.35, gravity: 0, dir: _w, jitter: 0.15 });
      }
    }

    this._checkTriggers(f, v);

    if (this.time <= 0) { this.time = 0; this._gameOver('TIME OVER'); return; }

    // fall out: well below the track, or far off it sideways
    const dy = this.ballPos.y - f.p.y;
    const dh = Math.hypot(this.ballPos.x - f.p.x, this.ballPos.z - f.p.z);
    if (dy < -9 || dh > 14) this._fallOut();
  }

  _checkTriggers(f, v) {
    const idx = this.progress;
    _w.subVectors(this.ballPos, f.p);
    const lateral = _w.dot(f.B);
    for (const c of this.chunks) {
      if (idx < c.piece.start - 2 || idx > c.piece.end + 2) continue;
      if (c.gate && !c.gate.passed && idx >= c.gate.index) {
        c.gate.passed = true;
        c.gate.group.tape.visible = false;
        this.goals++;
        this.time += CFG.goalTimeBonus;
        this.checkpoint = Math.min(c.gate.index + Math.round(1.5 / CFG.ds), c.piece.end);
        this.hud.toast(`GOAL!  +${CFG.goalTimeBonus}s`, 1.4);
        this.sfx.goal();
        _v.copy(f.p).addScaledVector(f.N, 1.2);
        this.particles.emit(_v, 80, { color: '#ffd60a', speed: 6, spread: 2, life: 0.9, gravity: 8, jitter: 1.5 });
      }
      for (const pad of c.pads) {
        if (idx >= pad.from && idx <= pad.to && this.now - pad.lastUsed > 1.0 && Math.abs(lateral) < pad.w / 2 && this.grounded) {
          pad.lastUsed = this.now;
          this._boost(f, pad.speed, v);
        }
      }
      for (const g of c.gems) {
        if (g.taken) continue;
        if (g.pos.distanceToSquared(this.ballPos) < 1.15 * 1.15) {
          g.taken = true;
          g.mesh.visible = false;
          this.gems++;
          this.sfx.gem(this.gems);
          this.particles.emit(g.pos, 16, { color: '#ffd166', speed: 3, spread: 1.5, life: 0.5, gravity: 4 });
        }
      }
    }
  }

  _boost(f, speed, v) {
    const along = v.x * f.T.x + v.y * f.T.y + v.z * f.T.z;
    const target = Math.max(along, speed);
    const nx = f.T.x * target + (v.x - f.T.x * along) * 0.5;
    const ny = f.T.y * target + (v.y - f.T.y * along) * 0.5;
    const nz = f.T.z * target + (v.z - f.T.z * along) * 0.5;
    const body = this.physics.ball;
    body.setLinvel({ x: nx, y: ny, z: nz }, true);
    // rolling angular velocity: w = (N x v) / r
    _v.set(nx, ny, nz);
    _w.crossVectors(f.N, _v).divideScalar(CFG.ballRadius);
    body.setAngvel({ x: _w.x, y: _w.y, z: _w.z }, true);
    this.sfx.boost();
    this.boostGlow = 1;
    this.boostTimer = CFG.boostGrace;
    this.boostCap = target;
    this.hud.toast('BOOST!', 0.7);
    _w.copy(f.T).negate();
    this.particles.emit(this.ballPos, 40, { color: '#7fd3ff', speed: 8, spread: 0.6, life: 0.5, dir: _w, jitter: 0.4 });
  }

  // ---- frame update -------------------------------------------------------

  update(dt) {
    this.now += dt;
    this.input.update(dt);
    if (this.input.consumeMute()) this.hud.toast(this.sfx.toggleMute() ? 'MUTED' : 'SOUND ON', 0.8);
    if (this.input.consumePause() && (this.state === STATE.PLAY || this.state === STATE.READY)) {
      this.paused = !this.paused;
      this.hud.showPause(this.paused);
    }
    if (this.paused) { this.input.consumeStart(); return; }

    const start = this.input.consumeStart();
    if (start) this.sfx.ensure();

    switch (this.state) {
      case STATE.TITLE:
        if (start) { this.hud.hideTitle(); this.hud.showHud(); this._setReady(); }
        break;
      case STATE.OVER:
        this.overTimer -= dt;
        if (start && this.overTimer <= 0) { this.hud.hideGameOver(); this.newRun(); this.hud.showHud(); this._setReady(); }
        break;
      case STATE.READY:
        this.readyTimer -= dt;
        if (this.readyTimer <= 0) { this.state = STATE.PLAY; this.hud.message('GO!', 0.7); this.sfx.go(); }
        break;
      case STATE.FALLOUT:
        this.fallTimer -= dt;
        if (this.fallTimer <= 0) {
          this.lives--;
          if (this.lives <= 0) this._gameOver('GAME OVER'); else this._respawn();
        }
        break;
    }

    const H = CFG.physicsDt;
    this.acc += dt;
    let n = 0;
    while (this.acc >= H && n < 10) { this._fixedStep(H); this.acc -= H; n++; }
    if (n >= 10) this.acc = 0;
    this._afterPhysics(dt);

    const f = this.frames[this.progress];
    this.cameraRig.update(dt, this.ballPos, f, this.tiltQuat, this.speed, this.state === STATE.TITLE ? 'orbit' : 'play');
    this._updateVisuals(dt);

    this.hud.update(dt, { score: this.score, time: this.time, gems: this.gems, lives: this.lives, speed: this.speed, dist: this.dist });
  }

  _updateVisuals(dt) {
    padMaterial.map.offset.y += dt * 1.6;
    this.boostGlow = Math.max(0, this.boostGlow - dt * 1.5);
    this.particles.update(dt);

    for (const c of this.chunks) {
      for (const g of c.gems) {
        if (g.taken) continue;
        g.mesh.rotation.y += dt * 2.2;
        g.mesh.position.y = g.pos.y + Math.sin(this.now * 3 + g.phase) * 0.12;
      }
    }

    this.sky.position.copy(this.camera.position);
    const gy = this.ballPos.y - 70;
    this.groundY += (gy - this.groundY) * Math.min(1, dt * 0.5);
    this.ground.position.set(this.ballPos.x, this.groundY, this.ballPos.z);

    this.sun.position.set(this.ballPos.x + 18, this.ballPos.y + 36, this.ballPos.z + 12);
    this.sun.target.position.copy(this.ballPos);
    this.sun.target.updateMatrixWorld();

    this.ballMesh.visible = this.ballPos.y > this.groundY + 2;
  }

  run() {
    let last = performance.now();
    const loop = (now) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      this.update(dt);
      this.renderer.render(this.scene, this.camera);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }
}

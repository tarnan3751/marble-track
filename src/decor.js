// Visual helpers: sky dome, ground grid, the marble, gems, boost pads, goal
// gates and a small particle system.  All textures are generated on canvases
// so the game needs no asset files.

import * as THREE from 'three';
import { CFG } from './config.js';

function canvasTexture(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

export function makeSky() {
  const geo = new THREE.SphereGeometry(900, 32, 16);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      top: { value: new THREE.Color('#1b5fd8') },
      horizon: { value: new THREE.Color('#c6ecff') },
      bottom: { value: new THREE.Color('#7fb2ea') },
    },
    vertexShader: `varying vec3 vPos; void main(){ vPos = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `
      uniform vec3 top; uniform vec3 horizon; uniform vec3 bottom; varying vec3 vPos;
      void main(){
        float h = normalize(vPos).y;
        vec3 c = h > 0.0 ? mix(horizon, top, pow(h, 0.55)) : mix(horizon, bottom, pow(-h, 0.6));
        gl_FragColor = vec4(c, 1.0);
      }`,
  });
  const m = new THREE.Mesh(geo, mat);
  m.frustumCulled = false;
  m.renderOrder = -10;
  return m;
}

export function makeGround() {
  const tex = canvasTexture(256, 256, (ctx, w, h) => {
    ctx.fillStyle = '#8fc3ee'; ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(255,255,255,0.55)'; ctx.lineWidth = 4;
    ctx.strokeRect(2, 2, w - 4, h - 4);
    ctx.strokeStyle = 'rgba(255,255,255,0.18)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(w / 2, 0); ctx.lineTo(w / 2, h); ctx.moveTo(0, h / 2); ctx.lineTo(w, h / 2); ctx.stroke();
  });
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(120, 120);
  const geo = new THREE.PlaneGeometry(2400, 2400);
  const mat = new THREE.MeshBasicMaterial({ map: tex });
  const m = new THREE.Mesh(geo, mat);
  m.rotation.x = -Math.PI / 2;
  m.receiveShadow = false;
  return m;
}

export function makeBall() {
  const r = CFG.ballRadius;
  const tex = canvasTexture(512, 256, (ctx, w, h) => {
    const cols = ['#e63946', '#ffffff', '#ffb703', '#ffffff', '#1d6fd8', '#ffffff'];
    const seg = w / cols.length;
    for (let i = 0; i < cols.length; i++) { ctx.fillStyle = cols[i]; ctx.fillRect(i * seg, 0, seg + 1, h); }
    ctx.fillStyle = 'rgba(0,0,0,0.12)';
    ctx.fillRect(0, h * 0.47, w, h * 0.06);
  });
  const group = new THREE.Group();
  const core = new THREE.Mesh(
    new THREE.SphereGeometry(r * 0.94, 48, 32),
    new THREE.MeshStandardMaterial({ map: tex, roughness: 0.35, metalness: 0.05 }),
  );
  core.castShadow = true;
  const shell = new THREE.Mesh(
    new THREE.SphereGeometry(r, 48, 32),
    new THREE.MeshPhysicalMaterial({ color: 0xffffff, transparent: true, opacity: 0.25, roughness: 0.05, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.05, depthWrite: false }),
  );
  group.add(core, shell);
  group.core = core;
  return group;
}

const gemGeo = new THREE.IcosahedronGeometry(0.34, 0);
const gemMat = new THREE.MeshStandardMaterial({ color: '#ffd166', emissive: '#ff9f1c', emissiveIntensity: 0.55, roughness: 0.25, metalness: 0.3, flatShading: true });
export function makeGem() {
  const m = new THREE.Mesh(gemGeo, gemMat);
  m.castShadow = true;
  return m;
}

const padTex = canvasTexture(128, 256, (ctx, w, h) => {
  ctx.clearRect(0, 0, w, h);
  ctx.lineWidth = 18; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  for (let i = 0; i < 2; i++) {
    const y = h * (0.3 + i * 0.5);
    ctx.strokeStyle = i === 0 ? '#9ff3ff' : '#ffffff';
    ctx.beginPath(); ctx.moveTo(w * 0.15, y + 40); ctx.lineTo(w * 0.5, y - 20); ctx.lineTo(w * 0.85, y + 40); ctx.stroke();
  }
});
padTex.wrapS = padTex.wrapT = THREE.RepeatWrapping;
export const padMaterial = new THREE.MeshBasicMaterial({ map: padTex, transparent: true, depthWrite: false, toneMapped: false });
export function makePad(width) {
  const geo = new THREE.PlaneGeometry(width - 0.9, 3);
  geo.rotateX(-Math.PI / 2);
  const m = new THREE.Mesh(geo, padMaterial);
  m.renderOrder = 2;
  return m;
}

const tapeTex = canvasTexture(512, 64, (ctx, w, h) => {
  ctx.fillStyle = '#ffd60a'; ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#111';
  for (let x = -h; x < w + h; x += 48) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x + 20, 0); ctx.lineTo(x + 20 - h, h); ctx.lineTo(x - h, h); ctx.closePath(); ctx.fill(); }
  ctx.fillStyle = '#ffd60a'; ctx.fillRect(w * 0.33, 0, w * 0.34, h);
  ctx.fillStyle = '#111'; ctx.font = 'bold 44px Arial Black, Arial'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('GOAL', w / 2, h / 2 + 2);
});
const postMat = new THREE.MeshStandardMaterial({ color: '#f4f4f4', roughness: 0.4 });
const barMat = new THREE.MeshStandardMaterial({ color: '#e63946', roughness: 0.4 });
const tapeMat = new THREE.MeshBasicMaterial({ map: tapeTex, side: THREE.DoubleSide });
export function makeGate(width) {
  const g = new THREE.Group();
  const hw = width / 2 + 0.25;
  const postGeo = new THREE.CylinderGeometry(0.16, 0.16, 3.4, 12);
  for (const sx of [-1, 1]) {
    const p = new THREE.Mesh(postGeo, postMat);
    p.position.set(sx * hw, 1.7, 0);
    p.castShadow = true;
    g.add(p);
  }
  const bar = new THREE.Mesh(new THREE.BoxGeometry(hw * 2 + 0.4, 0.3, 0.3), barMat);
  bar.position.set(0, 3.45, 0);
  bar.castShadow = true;
  g.add(bar);
  const tape = new THREE.Mesh(new THREE.PlaneGeometry(hw * 2, 0.55), tapeMat);
  tape.position.set(0, 1.15, 0);
  g.add(tape);
  g.tape = tape;
  return g;
}

const softCircle = canvasTexture(64, 64, (ctx, w, h) => {
  const gr = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
  gr.addColorStop(0, 'rgba(255,255,255,1)');
  gr.addColorStop(0.4, 'rgba(255,255,255,0.6)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gr; ctx.fillRect(0, 0, w, h);
});

export class Particles {
  constructor(max = 800) {
    this.max = max;
    this.alive = 0;
    this.pos = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.base = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.grav = new Float32Array(max);
    const geo = new THREE.BufferGeometry();
    this.posAttr = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.colAttr = new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.posAttr);
    geo.setAttribute('color', this.colAttr);
    geo.setDrawRange(0, 0);
    const mat = new THREE.PointsMaterial({ size: 0.35, map: softCircle, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    this._c = new THREE.Color();
  }

  emit(p, n, { color = '#ffffff', speed = 3, spread = 1, life = 0.6, gravity = 0, dir = null, jitter = 0.1 } = {}) {
    this._c.set(color);
    for (let k = 0; k < n; k++) {
      if (this.alive >= this.max) return;
      const i = this.alive++;
      const rx = (Math.random() - 0.5) * 2, ry = (Math.random() - 0.5) * 2, rz = (Math.random() - 0.5) * 2;
      this.pos[i * 3] = p.x + rx * jitter; this.pos[i * 3 + 1] = p.y + ry * jitter; this.pos[i * 3 + 2] = p.z + rz * jitter;
      const s = speed * (0.5 + Math.random());
      this.vel[i * 3] = (dir ? dir.x : 0) * s + rx * spread * s * 0.5;
      this.vel[i * 3 + 1] = (dir ? dir.y : 0) * s + ry * spread * s * 0.5;
      this.vel[i * 3 + 2] = (dir ? dir.z : 0) * s + rz * spread * s * 0.5;
      this.base[i * 3] = this._c.r; this.base[i * 3 + 1] = this._c.g; this.base[i * 3 + 2] = this._c.b;
      this.life[i] = this.maxLife[i] = life * (0.6 + Math.random() * 0.6);
      this.grav[i] = gravity;
    }
  }

  update(dt) {
    let i = 0;
    while (i < this.alive) {
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        const j = --this.alive;
        if (i !== j) {
          for (let c = 0; c < 3; c++) {
            this.pos[i * 3 + c] = this.pos[j * 3 + c];
            this.vel[i * 3 + c] = this.vel[j * 3 + c];
            this.base[i * 3 + c] = this.base[j * 3 + c];
          }
          this.life[i] = this.life[j]; this.maxLife[i] = this.maxLife[j]; this.grav[i] = this.grav[j];
        }
        continue;
      }
      this.vel[i * 3 + 1] -= this.grav[i] * dt;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      const f = this.life[i] / this.maxLife[i];
      this.col[i * 3] = this.base[i * 3] * f; this.col[i * 3 + 1] = this.base[i * 3 + 1] * f; this.col[i * 3 + 2] = this.base[i * 3 + 2] * f;
      i++;
    }
    this.posAttr.needsUpdate = true;
    this.colAttr.needsUpdate = true;
    this.points.geometry.setDrawRange(0, this.alive);
  }
}

// Track surface: vertex colours give the base colour per zone, the texture is
// a faint 1 m grid (uv in metres) so the surface reads as one smooth sheet.
export function makeTrackMaterial() {
  const tex = canvasTexture(64, 64, (ctx, w, h) => {
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(0,0,0,0.10)';
    ctx.fillRect(0, 0, w, 3); ctx.fillRect(0, 0, 3, h);
  });
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  return new THREE.MeshStandardMaterial({ map: tex, vertexColors: true, roughness: 0.6, metalness: 0.05 });
}

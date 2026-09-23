import * as THREE from 'three';
import { createFeatherGeometry } from '../lib/models.js';

function spriteTexture(kind) {
  const s = 128;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const ctx = c.getContext('2d');
  if (kind === 'heart') {
    ctx.translate(s / 2, s / 2 + 6);
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.moveTo(0, 34);
    ctx.bezierCurveTo(-60, -6, -34, -56, 0, -24);
    ctx.bezierCurveTo(34, -56, 60, -6, 0, 34);
    ctx.fill();
  } else if (kind === 'star') {
    ctx.translate(s / 2, s / 2);
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, s / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.15, 'rgba(255,255,255,0.8)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const r = i % 2 ? 12 : 60;
      ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    ctx.fill();
  } else {
    const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.4, 'rgba(255,255,255,0.55)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

class SpriteParticles {
  constructor(capacity, kind, { additive = false } = {}) {
    this.cap = capacity;
    this.pos = new Float32Array(capacity * 3);
    this.vel = new Float32Array(capacity * 3);
    this.col = new Float32Array(capacity * 3);
    this.size = new Float32Array(capacity);
    this.alpha = new Float32Array(capacity);
    this.life = new Float32Array(capacity);
    this.maxLife = new Float32Array(capacity);
    this.grow = new Float32Array(capacity);
    this.drag = new Float32Array(capacity);
    this.grav = new Float32Array(capacity);
    this.baseAlpha = new Float32Array(capacity);
    this.head = 0;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aColor', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    this.uniforms = { uMap: { value: spriteTexture(kind) }, uScale: { value: 500 } };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: `attribute vec3 aColor; attribute float aSize; attribute float aAlpha; uniform float uScale; varying vec3 vC; varying float vA;
        void main(){ vC = aColor; vA = aAlpha; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_PointSize = aSize * uScale / max(-mv.z, 0.1); gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `uniform sampler2D uMap; varying vec3 vC; varying float vA;
        void main(){ vec4 t = texture2D(uMap, gl_PointCoord); float a = t.a * vA; if (a < 0.003) discard; gl_FragColor = vec4(vC * t.rgb, a); }`,
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(g, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
  }

  emit(p, v, { color = [1, 1, 1], size = 0.2, life = 1, grow = 0, drag = 1, gravity = 0, alpha = 1 } = {}) {
    const i = this.head;
    this.head = (this.head + 1) % this.cap;
    this.pos.set([p.x, p.y, p.z], i * 3);
    this.vel.set([v.x, v.y, v.z], i * 3);
    this.col.set(color, i * 3);
    this.size[i] = size;
    this.alpha[i] = alpha;
    this.life[i] = life;
    this.maxLife[i] = life;
    this.grow[i] = grow;
    this.drag[i] = drag;
    this.grav[i] = gravity;
    this.baseAlpha[i] = alpha;
  }

  update(dt) {
    for (let i = 0; i < this.cap; i++) {
      if (this.life[i] <= 0) {
        this.alpha[i] = 0;
        continue;
      }
      this.life[i] -= dt;
      const k = this.life[i] / this.maxLife[i];
      const d = Math.exp(-this.drag[i] * dt);
      this.vel[i * 3] *= d;
      this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * d - this.grav[i] * dt;
      this.vel[i * 3 + 2] *= d;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      this.size[i] += this.grow[i] * dt;
      this.alpha[i] = this.baseAlpha[i] * Math.min(1, k * 2.2) * Math.min(1, (1 - k) * 12 + 0.2);
    }
    const g = this.points.geometry;
    g.attributes.position.needsUpdate = true;
    g.attributes.aSize.needsUpdate = true;
    g.attributes.aAlpha.needsUpdate = true;
    g.attributes.aColor.needsUpdate = true;
  }
}

class Tumblers {
  constructor(geo, count, material) {
    this.mesh = new THREE.InstancedMesh(geo, material, count);
    this.mesh.frustumCulled = false;
    this.n = count;
    this.p = Array.from({ length: count }, () => new THREE.Vector3());
    this.v = Array.from({ length: count }, () => new THREE.Vector3());
    this.r = Array.from({ length: count }, () => new THREE.Euler());
    this.w = Array.from({ length: count }, () => new THREE.Vector3());
    this.life = new Float32Array(count);
    this.scale = new Float32Array(count);
    this.head = 0;
    this.m = new THREE.Matrix4();
    this.q = new THREE.Quaternion();
    this.s = new THREE.Vector3();
    this.hidden = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < count; i++) this.mesh.setMatrixAt(i, this.hidden);
    this.mesh.instanceMatrix.needsUpdate = true;
  }
  emit(p, v, { life = 3, scale = 0.05, color = null, spin = 8 } = {}) {
    const i = this.head;
    this.head = (this.head + 1) % this.n;
    this.p[i].copy(p);
    this.v[i].copy(v);
    this.r[i].set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
    this.w[i].set((Math.random() - 0.5) * spin, (Math.random() - 0.5) * spin, (Math.random() - 0.5) * spin);
    this.life[i] = life;
    this.scale[i] = scale;
    if (color) this.mesh.setColorAt(i, color);
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
  update(dt, { gravity = 3.2, drag = 1.6, flutter = 1.2, t = 0 }) {
    let any = false;
    for (let i = 0; i < this.n; i++) {
      if (this.life[i] <= 0) continue;
      any = true;
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        this.mesh.setMatrixAt(i, this.hidden);
        continue;
      }
      const v = this.v[i];
      const d = Math.exp(-drag * dt);
      v.x = v.x * d + Math.sin(t * 5 + i) * flutter * dt;
      v.z = v.z * d + Math.cos(t * 4 + i * 1.7) * flutter * dt;
      v.y = v.y * d - gravity * dt;
      this.p[i].addScaledVector(v, dt);
      const r = this.r[i];
      r.x += this.w[i].x * dt;
      r.y += this.w[i].y * dt;
      r.z += this.w[i].z * dt;
      this.q.setFromEuler(r);
      const sc = this.scale[i] * Math.min(1, this.life[i] * 2);
      this.s.setScalar(sc);
      this.m.compose(this.p[i], this.q, this.s);
      this.mesh.setMatrixAt(i, this.m);
    }
    if (any) this.mesh.instanceMatrix.needsUpdate = true;
  }
}

export function createParticles(scene) {
  const soft = new SpriteParticles(420, 'soft');
  const glow = new SpriteParticles(240, 'star', { additive: true });
  const hearts = new SpriteParticles(60, 'heart');
  scene.add(soft.points, glow.points, hearts.points);

  const confettiGeo = new THREE.PlaneGeometry(1, 0.6);
  const confetti = new Tumblers(confettiGeo, 260, new THREE.MeshStandardMaterial({ color: 0xffffff, side: THREE.DoubleSide, roughness: 0.6, emissive: 0x222222 }));
  confetti.mesh.setColorAt(0, new THREE.Color(1, 1, 1));
  scene.add(confetti.mesh);
  const feathers = new Tumblers(createFeatherGeometry(), 30, new THREE.MeshStandardMaterial({ color: 0xfbf8f2, side: THREE.DoubleSide, roughness: 0.8 }));
  scene.add(feathers.mesh);

  const tmpP = new THREE.Vector3();
  const tmpV = new THREE.Vector3();
  const palette = [0xff5a5f, 0xffc145, 0x3ec1d3, 0x8ac926, 0xb892ff, 0xff8fab, 0xffffff].map((h) => new THREE.Color(h));
  let time = 0;

  return {
    setViewportScale(s) {
      soft.uniforms.uScale.value = s;
      glow.uniforms.uScale.value = s;
      hearts.uniforms.uScale.value = s;
    },
    dust(pos, dir, amount = 10, strength = 1) {
      for (let i = 0; i < amount; i++) {
        tmpP.copy(pos).add(tmpV.set((Math.random() - 0.5) * 0.4, Math.random() * 0.05, (Math.random() - 0.5) * 0.4));
        tmpV.set((Math.random() - 0.5) * 1.6 * strength - dir.x * 0.8, Math.random() * 0.8 * strength, (Math.random() - 0.5) * 1.6 * strength - dir.z * 0.8);
        soft.emit(tmpP, tmpV, { color: [0.78, 0.68, 0.55], size: 0.25 + Math.random() * 0.25, life: 0.9 + Math.random() * 0.6, grow: 0.5, drag: 2.2, gravity: -0.15, alpha: 0.45 });
      }
    },
    splash(pos, big = false) {
      const n = big ? 26 : 14;
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2;
        const sp = 0.8 + Math.random() * 1.8;
        tmpV.set(Math.cos(a) * sp, 2.5 + Math.random() * (big ? 3.5 : 2.2), Math.sin(a) * sp);
        soft.emit(pos, tmpV, { color: [0.92, 0.97, 1.0], size: 0.08 + Math.random() * 0.12, life: 0.7 + Math.random() * 0.5, drag: 0.4, gravity: 9.8, alpha: 0.9 });
      }
    },
    sparkle(pos, count = 16, color = [1, 0.85, 0.4]) {
      for (let i = 0; i < count; i++) {
        tmpV.set((Math.random() - 0.5) * 2.2, Math.random() * 2 + 0.4, (Math.random() - 0.5) * 2.2);
        glow.emit(pos, tmpV, { color, size: 0.08 + Math.random() * 0.1, life: 0.6 + Math.random() * 0.7, drag: 2.5, gravity: 0.6, alpha: 1 });
      }
    },
    hearts(pos, count = 3) {
      for (let i = 0; i < count; i++) {
        tmpP.copy(pos).add(tmpV.set((Math.random() - 0.5) * 0.3, 0.05 * i, (Math.random() - 0.5) * 0.3));
        tmpV.set((Math.random() - 0.5) * 0.4, 0.7 + Math.random() * 0.5, (Math.random() - 0.5) * 0.4);
        hearts.emit(tmpP, tmpV, { color: [1, 0.33, 0.45], size: 0.14 + Math.random() * 0.08, life: 1.6, drag: 0.8, gravity: -0.1, alpha: 1 });
      }
    },
    confetti(pos, vel, count = 140) {
      for (let i = 0; i < count; i++) {
        const a = Math.random() * Math.PI * 2;
        const sp = 1 + Math.random() * 3.5;
        tmpV.set(Math.cos(a) * sp + vel.x * 0.8, 3 + Math.random() * 4, Math.sin(a) * sp + vel.z * 0.8);
        tmpP.copy(pos).add(tmpV.clone().multiplyScalar(0.05));
        confetti.emit(tmpP, tmpV, { life: 2.5 + Math.random() * 1.5, scale: 0.07 + Math.random() * 0.05, color: palette[i % palette.length], spin: 14 });
      }
    },
    feather(pos, vel) {
      tmpV.copy(vel).multiplyScalar(0.3).add(tmpP.set((Math.random() - 0.5) * 0.8, 0.8 + Math.random() * 0.6, (Math.random() - 0.5) * 0.8));
      feathers.emit(pos, tmpV, { life: 4 + Math.random() * 2, scale: 0.09 + Math.random() * 0.04, spin: 3 });
    },
    update(dt) {
      time += dt;
      soft.update(dt);
      glow.update(dt);
      hearts.update(dt);
      confetti.update(dt, { gravity: 3.4, drag: 1.4, flutter: 2.2, t: time });
      feathers.update(dt, { gravity: 0.9, drag: 2.4, flutter: 1.6, t: time });
    },
  };
}

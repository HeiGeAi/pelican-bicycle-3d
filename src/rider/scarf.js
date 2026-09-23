import * as THREE from 'three';
import { knitTexture } from '../lib/textures.js';

const STEP = 1 / 120;

class Ribbon {
  constructor(rows, seg, width, material) {
    this.rows = rows;
    this.seg = seg;
    this.width = width;
    const n = rows * 2;
    this.p = new Float32Array(n * 3);
    this.pp = new Float32Array(n * 3);
    const pos = new Float32Array(n * 3);
    const uv = new Float32Array(n * 2);
    const idx = [];
    for (let i = 0; i < rows; i++) {
      uv[i * 4] = 0;
      uv[i * 4 + 1] = i / (rows - 1);
      uv[i * 4 + 2] = 1;
      uv[i * 4 + 3] = i / (rows - 1);
      if (i < rows - 1) {
        const a = i * 2;
        idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setIndex(idx);
    this.geometry = g;
    this.mesh = new THREE.Mesh(g, material);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = true;
    this.initialized = false;
    const diag = Math.hypot(seg, width);
    this.constraints = [];
    for (let i = 0; i < rows; i++) {
      const l = i * 2;
      const r = l + 1;
      this.constraints.push([l, r, width]);
      if (i < rows - 1) {
        this.constraints.push([l, l + 2, seg], [r, r + 2, seg], [l, r + 2, diag], [r, l + 2, diag]);
      }
    }
  }

  reset(a, b) {
    const { p, pp, rows, seg } = this;
    for (let i = 0; i < rows; i++) {
      for (let k = 0; k < 2; k++) {
        const src = k === 0 ? a : b;
        const j = (i * 2 + k) * 3;
        p[j] = pp[j] = src.x;
        p[j + 1] = pp[j + 1] = src.y - i * seg;
        p[j + 2] = pp[j + 2] = src.z;
      }
    }
    this.initialized = true;
  }

  step(h, a, b, wind, gravity, spheres, time, flutter) {
    const { p, pp, rows } = this;
    const n = rows * 2;
    const h2 = h * h;
    for (let q = 2; q < n; q++) {
      const j = q * 3;
      const row = q >> 1;
      const vx = (p[j] - pp[j]) / h;
      const vy = (p[j + 1] - pp[j + 1]) / h;
      const vz = (p[j + 2] - pp[j + 2]) / h;
      const k = 2.2 + row * 0.35;
      const wob = Math.sin(time * 19 + row * 1.7 + (q & 1) * 0.9) * flutter;
      const wob2 = Math.cos(time * 13 + row * 1.1) * flutter;
      const ax = k * (wind.x - vx) + wob2 * 0.6;
      const ay = k * (wind.y - vy) - gravity + wob;
      const az = k * (wind.z - vz) + wob * 0.7;
      const nx = p[j] + (p[j] - pp[j]) * 0.985 + ax * h2;
      const ny = p[j + 1] + (p[j + 1] - pp[j + 1]) * 0.985 + ay * h2;
      const nz = p[j + 2] + (p[j + 2] - pp[j + 2]) * 0.985 + az * h2;
      pp[j] = p[j];
      pp[j + 1] = p[j + 1];
      pp[j + 2] = p[j + 2];
      p[j] = nx;
      p[j + 1] = ny;
      p[j + 2] = nz;
    }
    p[0] = pp[0] = a.x;
    p[1] = pp[1] = a.y;
    p[2] = pp[2] = a.z;
    p[3] = pp[3] = b.x;
    p[4] = pp[4] = b.y;
    p[5] = pp[5] = b.z;
    for (let it = 0; it < 4; it++) {
      for (const [i0, i1, rest] of this.constraints) {
        const j0 = i0 * 3;
        const j1 = i1 * 3;
        const dx = p[j1] - p[j0];
        const dy = p[j1 + 1] - p[j0 + 1];
        const dz = p[j1 + 2] - p[j0 + 2];
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-6;
        const diff = (d - rest) / d;
        const w0 = i0 < 2 ? 0 : 0.5;
        const w1 = i1 < 2 ? 0 : 0.5;
        const ws = w0 + w1 || 1;
        p[j0] += dx * diff * (w0 / ws);
        p[j0 + 1] += dy * diff * (w0 / ws);
        p[j0 + 2] += dz * diff * (w0 / ws);
        p[j1] -= dx * diff * (w1 / ws);
        p[j1 + 1] -= dy * diff * (w1 / ws);
        p[j1 + 2] -= dz * diff * (w1 / ws);
      }
      for (const s of spheres) {
        for (let q = 2; q < n; q++) {
          const j = q * 3;
          const dx = p[j] - s.c.x;
          const dy = p[j + 1] - s.c.y;
          const dz = p[j + 2] - s.c.z;
          const d2 = dx * dx + dy * dy + dz * dz;
          if (d2 < s.r * s.r) {
            const d = Math.sqrt(d2) || 1e-6;
            const f = s.r / d;
            p[j] = s.c.x + dx * f;
            p[j + 1] = s.c.y + dy * f;
            p[j + 2] = s.c.z + dz * f;
          }
        }
      }
    }
  }

  writeMesh() {
    const pos = this.geometry.attributes.position.array;
    pos.set(this.p);
    this.geometry.attributes.position.needsUpdate = true;
    this.geometry.computeVertexNormals();
  }
}

export function createScarf() {
  const tex = knitTexture();
  tex.repeat.set(1, 1.6);
  const material = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.92, side: THREE.DoubleSide });
  const group = new THREE.Group();
  group.name = 'scarf';
  const tails = [new Ribbon(12, 0.042, 0.075, material), new Ribbon(10, 0.042, 0.068, material)];
  for (const t of tails) group.add(t.mesh);

  const ringMat = material.clone();
  ringMat.map = tex.clone();
  ringMat.map.repeat.set(6, 0.35);
  ringMat.map.needsUpdate = true;
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.083, 0.03, 10, 28), ringMat);
  ring.castShadow = true;

  let acc = 0;
  let time = 0;
  const a1 = new THREE.Vector3();
  const b1 = new THREE.Vector3();
  const a2 = new THREE.Vector3();
  const b2 = new THREE.Vector3();
  const spheres = [
    { c: new THREE.Vector3(), r: 0.2, local: new THREE.Vector3(-0.06, 0.2, 0) },
    { c: new THREE.Vector3(), r: 0.16, local: new THREE.Vector3(0.17, 0.3, 0) },
    { c: new THREE.Vector3(), r: 0.12, local: new THREE.Vector3(-0.3, 0.2, 0) },
  ];
  const gravity = 9.81;

  return {
    group,
    ring,
    material,
    /** Attach the neck ring to the pelican body (body space). */
    attach(bodyG) {
      ring.position.set(0.33, 0.5, 0);
      ring.rotation.set(Math.PI / 2, 0, -0.35, 'ZYX');
      bodyG.add(ring);
    },
    setVisible(v) {
      group.visible = v;
      ring.visible = v;
    },
    reset() {
      for (const t of tails) t.initialized = false;
    },
    update(dt, pelican, wind, speed) {
      if (!group.visible) return;
      pelican.scarfAnchors(a1, b1);
      a2.copy(a1).addScaledVector(pelican.lateral, 0.035);
      b2.copy(b1).addScaledVector(pelican.lateral, 0.035);
      a2.y -= 0.015;
      b2.y -= 0.015;
      for (const s of spheres) s.c.copy(s.local).applyMatrix4(pelican.bodyG.matrixWorld);
      if (!tails[0].initialized) {
        tails[0].reset(a1, b1);
        tails[1].reset(a2, b2);
      }
      const flutter = Math.min(28, 2 + speed * speed * 0.55);
      acc += Math.min(dt, 0.05);
      let steps = 0;
      while (acc >= STEP && steps < 8) {
        time += STEP;
        tails[0].step(STEP, a1, b1, wind, gravity, spheres, time, flutter);
        tails[1].step(STEP, a2, b2, wind, gravity, spheres, time + 3.1, flutter);
        acc -= STEP;
        steps++;
      }
      if (steps === 8) acc = 0;
      for (const t of tails) t.writeMesh();
    },
  };
}

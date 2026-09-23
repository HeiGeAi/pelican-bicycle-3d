import * as THREE from 'three';
import { clamp } from './math.js';

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _up = new THREE.Vector3(0, 1, 0);
const _q = new THREE.Quaternion();

/**
 * A tube whose cross-sections can be re-evaluated every frame.
 * Ring vertex = center + N*cos(θ)*ry + B*sin(θ)*rx, with B = normalize(side ⟂ T), N = B × T... see frame().
 * `sample(t, out)` must fill out.center (Vector3), out.tangent (Vector3, unit),
 * out.side (Vector3 hint for the lateral axis), out.rx, out.ry and optionally out.oy (vertical offset
 * of the section centre along N) and out.color (THREE.Color).
 */
export class Loft {
  constructor(lengthSegs, radialSegs, { capStart = false, capEnd = false, colors = false } = {}) {
    this.L = lengthSegs;
    this.R = radialSegs;
    this.capStart = capStart;
    this.capEnd = capEnd;
    const rv = radialSegs + 1;
    this.rv = rv;
    const body = (lengthSegs + 1) * rv;
    this.capStartOffset = body;
    this.capEndOffset = body + (capStart ? rv + 1 : 0);
    const total = this.capEndOffset + (capEnd ? rv + 1 : 0);

    const positions = new Float32Array(total * 3);
    const uvs = new Float32Array(total * 2);
    const indices = [];
    for (let i = 0; i < lengthSegs; i++) {
      for (let j = 0; j < radialSegs; j++) {
        const a = i * rv + j;
        const b = (i + 1) * rv + j;
        const c = (i + 1) * rv + j + 1;
        const d = i * rv + j + 1;
        indices.push(a, d, b, d, c, b);
      }
    }
    for (let i = 0; i <= lengthSegs; i++) {
      for (let j = 0; j <= radialSegs; j++) {
        const k = (i * rv + j) * 2;
        uvs[k] = j / radialSegs;
        uvs[k + 1] = i / lengthSegs;
      }
    }
    if (capStart) {
      const o = this.capStartOffset;
      const center = o + rv;
      for (let j = 0; j < radialSegs; j++) indices.push(center, o + j + 1, o + j);
    }
    if (capEnd) {
      const o = this.capEndOffset;
      const center = o + rv;
      for (let j = 0; j < radialSegs; j++) indices.push(center, o + j, o + j + 1);
    }

    const g = new THREE.BufferGeometry();
    g.setIndex(indices);
    g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(total * 3), 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    if (colors) g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(total * 3), 3));
    this.geometry = g;
    this._s = { center: new THREE.Vector3(), tangent: new THREE.Vector3(), side: new THREE.Vector3(0, 0, 1), rx: 0.1, ry: 0.1, oy: 0, color: new THREE.Color(1, 1, 1) };
    this._N = new THREE.Vector3();
    this._B = new THREE.Vector3();
  }

  update(sample, { dynamic = false } = {}) {
    const { L, R, rv } = this;
    const pos = this.geometry.attributes.position.array;
    const col = this.geometry.attributes.color ? this.geometry.attributes.color.array : null;
    const s = this._s;
    const N = this._N;
    const B = this._B;
    for (let i = 0; i <= L; i++) {
      const t = i / L;
      s.oy = 0;
      sample(t, s);
      B.copy(s.side).addScaledVector(s.tangent, -s.side.dot(s.tangent));
      if (B.lengthSq() < 1e-10) B.set(0, 0, 1);
      B.normalize();
      N.crossVectors(B, s.tangent).normalize();
      for (let j = 0; j <= R; j++) {
        const th = (j / R) * Math.PI * 2;
        const cs = Math.cos(th);
        const sn = Math.sin(th);
        const k = (i * rv + j) * 3;
        pos[k] = s.center.x + N.x * (cs * s.ry + s.oy) + B.x * sn * s.rx;
        pos[k + 1] = s.center.y + N.y * (cs * s.ry + s.oy) + B.y * sn * s.rx;
        pos[k + 2] = s.center.z + N.z * (cs * s.ry + s.oy) + B.z * sn * s.rx;
        if (col) {
          col[k] = s.color.r;
          col[k + 1] = s.color.g;
          col[k + 2] = s.color.b;
        }
      }
      if ((i === 0 && this.capStart) || (i === L && this.capEnd)) {
        const o = i === 0 ? this.capStartOffset : this.capEndOffset;
        for (let j = 0; j <= R; j++) {
          const src = (i * rv + j) * 3;
          const dst = (o + j) * 3;
          pos[dst] = pos[src];
          pos[dst + 1] = pos[src + 1];
          pos[dst + 2] = pos[src + 2];
          if (col) {
            col[dst] = col[src];
            col[dst + 1] = col[src + 1];
            col[dst + 2] = col[src + 2];
          }
        }
        const c = (o + rv) * 3;
        pos[c] = s.center.x + N.x * s.oy;
        pos[c + 1] = s.center.y + N.y * s.oy;
        pos[c + 2] = s.center.z + N.z * s.oy;
        if (col) {
          col[c] = s.color.r;
          col[c + 1] = s.color.g;
          col[c + 2] = s.color.b;
        }
      }
    }
    const g = this.geometry;
    g.attributes.position.needsUpdate = true;
    if (col) g.attributes.color.needsUpdate = true;
    g.computeVertexNormals();
    this._fixSeams();
    if (dynamic) {
      g.attributes.position.setUsage(THREE.DynamicDrawUsage);
      g.attributes.normal.setUsage(THREE.DynamicDrawUsage);
    }
    g.computeBoundingSphere();
    return this;
  }

  _fixSeams() {
    const n = this.geometry.attributes.normal.array;
    const { L, R, rv } = this;
    for (let i = 0; i <= L; i++) {
      const a = i * rv * 3;
      const b = (i * rv + R) * 3;
      let x = n[a] + n[b];
      let y = n[a + 1] + n[b + 1];
      let z = n[a + 2] + n[b + 2];
      const len = Math.hypot(x, y, z) || 1;
      x /= len;
      y /= len;
      z /= len;
      n[a] = n[b] = x;
      n[a + 1] = n[b + 1] = y;
      n[a + 2] = n[b + 2] = z;
    }
    this.geometry.attributes.normal.needsUpdate = true;
  }
}

/** Build a static loft along a curve with a radius function. */
export function loftAlongCurve(curve, lengthSegs, radialSegs, radiusFn, { side = new THREE.Vector3(0, 0, 1), capStart = true, capEnd = true, colorFn = null } = {}) {
  const loft = new Loft(lengthSegs, radialSegs, { capStart, capEnd, colors: !!colorFn });
  loft.update((t, s) => {
    curve.getPointAt(t, s.center);
    curve.getTangentAt(t, s.tangent);
    s.side.copy(side);
    const r = radiusFn(t);
    s.rx = r.rx ?? r;
    s.ry = r.ry ?? r;
    s.oy = r.oy ?? 0;
    if (colorFn) colorFn(t, s.color);
  });
  return loft.geometry;
}

/**
 * Two-bone IK. Writes the middle joint into outJoint and the reachable end into outEnd.
 * poleDir is a direction hint for where the joint should bend.
 */
export function solveTwoBone(root, target, l1, l2, poleDir, outJoint, outEnd) {
  const d = _a.subVectors(target, root);
  let dist = d.length();
  if (dist < 1e-6) {
    d.set(0, -1, 0);
    dist = 1e-6;
  }
  d.divideScalar(dist);
  dist = clamp(dist, Math.abs(l1 - l2) + 1e-4, l1 + l2 - 1e-4);
  const cosA = clamp((l1 * l1 + dist * dist - l2 * l2) / (2 * l1 * dist), -1, 1);
  const sinA = Math.sqrt(1 - cosA * cosA);
  const bend = _b.copy(poleDir).addScaledVector(d, -poleDir.dot(d));
  if (bend.lengthSq() < 1e-10) bend.set(0, 1, 0).addScaledVector(d, -d.y);
  bend.normalize();
  outJoint.copy(root).addScaledVector(d, cosA * l1).addScaledVector(bend, sinA * l1);
  outEnd.copy(root).addScaledVector(d, dist);
}

/**
 * Place obj at `from` with local +Y pointing at `to` and local +X as close as possible to `hint`.
 */
export function orientSegment(obj, from, to, hint) {
  const y = _a.subVectors(to, from);
  const len = y.length();
  if (len < 1e-8) return 0;
  y.divideScalar(len);
  const x = _b.copy(hint).addScaledVector(y, -hint.dot(y));
  if (x.lengthSq() < 1e-10) x.set(1, 0, 0).addScaledVector(y, -y.x);
  x.normalize();
  const z = _c.crossVectors(x, y);
  _m.makeBasis(x, y, z);
  obj.quaternion.setFromRotationMatrix(_m);
  obj.position.copy(from);
  return len;
}

/** Cylinder mesh geometry spanning p1 → p2 (baked transform). */
export function cylinderBetween(p1, p2, r1, r2 = r1, radial = 10, open = false) {
  const len = p1.distanceTo(p2);
  const g = new THREE.CylinderGeometry(r2, r1, len, radial, 1, open);
  g.translate(0, len / 2, 0);
  _a.subVectors(p2, p1).normalize();
  _q.setFromUnitVectors(_up, _a);
  _m.makeRotationFromQuaternion(_q).setPosition(p1);
  g.applyMatrix4(_m);
  return g;
}

/** Tube along a list of points (Catmull-Rom). */
export function tubeThrough(points, radius, tubular = 32, radial = 8, closed = false, curveType = 'catmullrom', tension = 0.5) {
  const curve = new THREE.CatmullRomCurve3(points, closed, curveType, tension);
  return new THREE.TubeGeometry(curve, tubular, radius, radial, closed);
}

/** Paint a flat vertex colour onto a geometry. */
export function paint(geometry, color) {
  const c = new THREE.Color(color);
  const n = geometry.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    arr[i * 3] = c.r;
    arr[i * 3 + 1] = c.g;
    arr[i * 3 + 2] = c.b;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geometry;
}

/** Ensure a geometry is non-indexed-compatible for merging (adds uv/normal if missing). */
export function normalizeForMerge(g, { color = null } = {}) {
  let geo = g.index ? g : g;
  if (!geo.attributes.normal) geo.computeVertexNormals();
  if (!geo.attributes.uv) geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(geo.attributes.position.count * 2), 2));
  if (color !== null) paint(geo, color);
  return geo;
}

/** Deterministic hash → [0,1). */
export function hash1(n) {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453123;
  return s - Math.floor(s);
}

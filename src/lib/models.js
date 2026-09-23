import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { paint } from './geometry.js';

function prep(g, color) {
  const geo = g.index ? g.toNonIndexed() : g;
  if (!geo.attributes.uv) geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(geo.attributes.position.count * 2), 2));
  geo.computeVertexNormals();
  if (color !== undefined) paint(geo, color);
  return geo;
}

/** Fish, length ≈ 1 along +X (head at +X). Vertex coloured. */
export function createFishGeometry() {
  const body = new THREE.SphereGeometry(1, 22, 14);
  body.scale(0.5, 0.17, 0.085);
  const p = body.attributes.position;
  const colors = new Float32Array(p.count * 3);
  const back = new THREE.Color(0x24507e);
  const belly = new THREE.Color(0xe3e9ef);
  const stripe = new THREE.Color(0x6fb7d9);
  const c = new THREE.Color();
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const k = x < 0 ? 1 + x * 1.15 : 1 - x * x * 0.5;
    p.setY(i, p.getY(i) * k);
    p.setZ(i, p.getZ(i) * k);
    const y = p.getY(i) / 0.17;
    c.copy(belly).lerp(back, THREE.MathUtils.smoothstep(y, -0.15, 0.55));
    if (Math.abs(y - 0.05) < 0.08) c.lerp(stripe, 0.6);
    colors.set([c.r, c.g, c.b], i * 3);
  }
  body.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const bodyG = prep(body);
  bodyG.setAttribute('color', new THREE.BufferAttribute(new Float32Array(bodyG.attributes.position.count * 3), 3));
  {
    // re-derive colours after toNonIndexed
    const pp = bodyG.attributes.position;
    const cc = bodyG.attributes.color;
    for (let i = 0; i < pp.count; i++) {
      const y = pp.getY(i) / 0.17;
      c.copy(belly).lerp(back, THREE.MathUtils.smoothstep(y, -0.15, 0.55));
      if (Math.abs(y - 0.05) < 0.08) c.lerp(stripe, 0.6);
      cc.setXYZ(i, c.r, c.g, c.b);
    }
  }

  const tailShape = new THREE.Shape();
  tailShape.moveTo(-0.4, 0);
  tailShape.lineTo(-0.72, 0.21);
  tailShape.quadraticCurveTo(-0.62, 0, -0.72, -0.21);
  tailShape.lineTo(-0.4, 0);
  const tail = prep(new THREE.ShapeGeometry(tailShape), 0x2f6394);

  const finShape = new THREE.Shape();
  finShape.moveTo(-0.14, 0.12);
  finShape.quadraticCurveTo(0.0, 0.27, 0.12, 0.14);
  finShape.lineTo(-0.14, 0.12);
  const fin = prep(new THREE.ShapeGeometry(finShape), 0x2f6394);

  const parts = [bodyG, tail, fin];
  for (const s of [-1, 1]) {
    const eye = prep(new THREE.SphereGeometry(0.028, 10, 8), 0x0b0b10);
    eye.translate(0.33, 0.035, 0.052 * s);
    const ring = prep(new THREE.SphereGeometry(0.036, 10, 8), 0xf1f1e6);
    ring.translate(0.328, 0.035, 0.046 * s);
    const pec = new THREE.Shape();
    pec.moveTo(0, 0);
    pec.lineTo(-0.12, -0.05);
    pec.lineTo(-0.07, 0.02);
    const pecG = prep(new THREE.ShapeGeometry(pec), 0x9fc4dd);
    pecG.translate(0.18, -0.04, 0.07 * s);
    parts.push(ring, eye, pecG);
  }
  const g = mergeGeometries(parts);
  g.computeBoundingSphere();
  return g;
}

export const fishMaterial = () =>
  new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.28, metalness: 0.35, side: THREE.DoubleSide });

/** Single feather (for floating feather particles), length 1 along +Y. */
export function createFeatherGeometry() {
  const shape = new THREE.Shape();
  shape.moveTo(0, 0);
  shape.quadraticCurveTo(0.16, 0.35, 0.05, 1.0);
  shape.quadraticCurveTo(0, 1.05, -0.05, 1.0);
  shape.quadraticCurveTo(-0.14, 0.4, 0, 0);
  const g = new THREE.ShapeGeometry(shape, 6);
  g.translate(0, -0.5, 0);
  return g;
}

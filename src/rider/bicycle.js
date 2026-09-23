import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { cylinderBetween, tubeThrough } from '../lib/geometry.js';
import { decalTexture, wickerTexture } from '../lib/textures.js';
import { createFishGeometry, fishMaterial } from '../lib/models.js';

const V = (x, y, z = 0) => new THREE.Vector3(x, y, z);

/** Bike geometry in bike space: +X forward, +Y up, +Z to the rider's right, ground at y = 0. */
export const BIKE = {
  wheelR: 0.31,
  tireR: 0.021,
  rearAxle: V(-0.5, 0.31),
  frontAxle: V(0.56, 0.31),
  bb: V(-0.07, 0.265),
  crankLen: 0.15,
  seatCluster: V(-0.23, 0.76),
  headTop: V(0.36, 0.83),
  headBottom: V(0.4, 0.7),
  saddleTop: V(-0.275, 0.9),
  chainringR: 0.085,
  cogR: 0.0323,
  ratio: 42 / 16,
  pedalZ: 0.108,
  chainZ: 0.048,
  grip: V(0.2, 0.94, 0.29),
  bell: V(0.31, 0.942, -0.215),
  basket: V(0.585, 0.83, 0),
};

function gearShape(teeth, rRoot, rTip, holeR) {
  const s = new THREE.Shape();
  const step = (Math.PI * 2) / teeth;
  for (let i = 0; i < teeth; i++) {
    const a = i * step;
    const pts = [
      [a - step * 0.5, rRoot],
      [a - step * 0.22, rRoot],
      [a - step * 0.12, rTip],
      [a + step * 0.12, rTip],
      [a + step * 0.22, rRoot],
    ];
    for (let k = 0; k < pts.length; k++) {
      const [ang, r] = pts[k];
      const x = Math.cos(ang) * r;
      const y = Math.sin(ang) * r;
      if (i === 0 && k === 0) s.moveTo(x, y);
      else s.lineTo(x, y);
    }
  }
  s.closePath();
  if (holeR > 0) {
    const h = new THREE.Path();
    h.absarc(0, 0, holeR, 0, Math.PI * 2, true);
    s.holes.push(h);
  }
  return s;
}

class HelixCurve extends THREE.Curve {
  constructor(radius, height, turns) {
    super();
    this.radius = radius;
    this.height = height;
    this.turns = turns;
  }
  getPoint(t, target = new THREE.Vector3()) {
    const a = t * this.turns * Math.PI * 2;
    return target.set(Math.cos(a) * this.radius, t * this.height, Math.sin(a) * this.radius);
  }
}

function makeMaterials() {
  const wicker = wickerTexture();
  wicker.repeat.set(2, 1.4);
  return {
    frame: new THREE.MeshPhysicalMaterial({ color: 0x17a597, metalness: 0.2, roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.06 }),
    chrome: new THREE.MeshStandardMaterial({ color: 0xeef1f5, metalness: 1, roughness: 0.16 }),
    darkMetal: new THREE.MeshStandardMaterial({ color: 0x2a2c30, metalness: 0.75, roughness: 0.38 }),
    tire: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.86 }),
    cream: new THREE.MeshPhysicalMaterial({ color: 0xf3e9d3, roughness: 0.38, clearcoat: 0.7, clearcoatRoughness: 0.15, side: THREE.DoubleSide }),
    leather: new THREE.MeshStandardMaterial({ color: 0x70401f, roughness: 0.5 }),
    wicker: new THREE.MeshStandardMaterial({ map: wicker, bumpMap: wicker, bumpScale: 2.2, roughness: 0.82, side: THREE.DoubleSide }),
    wickerRim: new THREE.MeshStandardMaterial({ color: 0x9b6c38, roughness: 0.75 }),
    lens: new THREE.MeshStandardMaterial({ color: 0xfff6d8, emissive: 0xfff0c8, emissiveIntensity: 0.25, roughness: 0.2 }),
    tail: new THREE.MeshStandardMaterial({ color: 0x8a0d0d, emissive: 0xff2a1a, emissiveIntensity: 0.15, roughness: 0.3 }),
    blur: new THREE.MeshStandardMaterial({ color: 0xc8ced6, metalness: 0.6, roughness: 0.4, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }),
    decal: new THREE.MeshStandardMaterial({ map: decalTexture(), transparent: true, depthWrite: false, roughness: 0.35, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }),
  };
}

function makeWheel(mats) {
  const R = BIKE.wheelR;
  const tr = BIKE.tireR;
  const spin = new THREE.Group();

  const tireG = new THREE.TorusGeometry(R - tr, tr, 12, 80);
  const p = tireG.attributes.position;
  const col = new Float32Array(p.count * 3);
  const tread = new THREE.Color(0x1d1d1f);
  const wall = new THREE.Color(0xc4935c);
  for (let i = 0; i < p.count; i++) {
    const d = Math.hypot(p.getX(i), p.getY(i));
    const c = d > R - tr * 0.55 ? tread : wall;
    col.set([c.r, c.g, c.b], i * 3);
  }
  tireG.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const tire = new THREE.Mesh(tireG, mats.tire);
  tire.castShadow = true;
  spin.add(tire);

  const rimR = R - tr * 1.75;
  const rimParts = [];
  for (const z of [-0.009, 0.009]) {
    const t = new THREE.TorusGeometry(rimR, 0.0055, 6, 80);
    t.translate(0, 0, z);
    rimParts.push(t);
  }
  const band = new THREE.CylinderGeometry(rimR + 0.003, rimR + 0.003, 0.02, 80, 1, true);
  band.rotateX(Math.PI / 2);
  rimParts.push(band);
  const rim = new THREE.Mesh(mergeGeometries(rimParts.map((g) => (g.index ? g.toNonIndexed() : g))), mats.chrome);
  rim.castShadow = true;
  spin.add(rim);

  const spokes = [];
  for (let k = 0; k < 32; k++) {
    const side = k % 2 ? 1 : -1;
    const lead = Math.floor(k / 2) % 2 ? 1 : -1;
    const ah = (k / 32) * Math.PI * 2;
    const ar = ah + lead * 0.52;
    const h = V(Math.cos(ah) * 0.024, Math.sin(ah) * 0.024, side * 0.028);
    const r = V(Math.cos(ar) * (rimR - 0.004), Math.sin(ar) * (rimR - 0.004), side * 0.004);
    spokes.push(cylinderBetween(h, r, 0.0012, 0.0012, 3, true));
  }
  const spokeMesh = new THREE.Mesh(mergeGeometries(spokes), mats.chrome);
  spin.add(spokeMesh);

  const hub = new THREE.CylinderGeometry(0.016, 0.016, 0.075, 14);
  hub.rotateX(Math.PI / 2);
  const flangeA = new THREE.CylinderGeometry(0.027, 0.027, 0.004, 18);
  flangeA.rotateX(Math.PI / 2);
  flangeA.translate(0, 0, 0.028);
  const flangeB = flangeA.clone();
  flangeB.translate(0, 0, -0.056);
  spin.add(new THREE.Mesh(mergeGeometries([hub, flangeA, flangeB]), mats.chrome));

  const valve = new THREE.Mesh(cylinderBetween(V(0, rimR - 0.01, 0), V(0, rimR - 0.035, 0), 0.003), mats.chrome);
  spin.add(valve);

  const blurDisc = new THREE.Mesh(new THREE.CircleGeometry(rimR - 0.006, 48), mats.blur);
  blurDisc.renderOrder = 2;
  spin.add(blurDisc);

  return { spin, spokeMesh };
}

function fender(center, startDeg, lengthDeg, mats) {
  const r = BIKE.wheelR + 0.026;
  const g = new THREE.CylinderGeometry(r, r, 0.05, 36, 1, true, THREE.MathUtils.degToRad(startDeg + 90), THREE.MathUtils.degToRad(lengthDeg));
  g.rotateX(Math.PI / 2);
  g.translate(center.x, center.y, 0);
  const m = new THREE.Mesh(g, mats.cream);
  m.castShadow = true;
  return m;
}

function buildChainPath() {
  const c1 = BIKE.bb;
  const c2 = BIKE.rearAxle;
  const r1 = BIKE.chainringR;
  const r2 = BIKE.cogR;
  const d = new THREE.Vector2(c2.x - c1.x, c2.y - c1.y);
  const D = d.length();
  const e = d.clone().divideScalar(D);
  const perp = new THREE.Vector2(-e.y, e.x);
  const s = (r1 - r2) / D;
  const cc = Math.sqrt(1 - s * s);
  let nTop = e.clone().multiplyScalar(s).addScaledVector(perp, cc);
  let nBot = e.clone().multiplyScalar(s).addScaledVector(perp, -cc);
  if (nTop.y < nBot.y) [nTop, nBot] = [nBot, nTop];
  const pts = [];
  const arc = (cx, cy, r, a0, a1, n) => {
    for (let i = 0; i <= n; i++) {
      const a = a0 + (a1 - a0) * (i / n);
      pts.push(new THREE.Vector2(cx + Math.cos(a) * r, cy + Math.sin(a) * r));
    }
  };
  const aTop1 = Math.atan2(nTop.y, nTop.x);
  let aBot1 = Math.atan2(nBot.y, nBot.x);
  while (aBot1 > aTop1) aBot1 -= Math.PI * 2;
  arc(c1.x, c1.y, r1, aTop1, aBot1, 48);
  const aBot2 = Math.atan2(nBot.y, nBot.x);
  let aTop2 = Math.atan2(nTop.y, nTop.x);
  while (aTop2 > aBot2) aTop2 -= Math.PI * 2;
  const lineN = 30;
  const b1 = new THREE.Vector2(c1.x + nBot.x * r1, c1.y + nBot.y * r1);
  const b2 = new THREE.Vector2(c2.x + nBot.x * r2, c2.y + nBot.y * r2);
  for (let i = 1; i < lineN; i++) pts.push(b1.clone().lerp(b2, i / lineN));
  arc(c2.x, c2.y, r2, aBot2, aTop2, 24);
  const t2 = new THREE.Vector2(c2.x + nTop.x * r2, c2.y + nTop.y * r2);
  const t1 = new THREE.Vector2(c1.x + nTop.x * r1, c1.y + nTop.y * r1);
  for (let i = 1; i < lineN; i++) pts.push(t2.clone().lerp(t1, i / lineN));
  // arc-length resample
  const cum = [0];
  for (let i = 1; i <= pts.length; i++) cum.push(cum[i - 1] + pts[i % pts.length].distanceTo(pts[i - 1]));
  const total = cum[cum.length - 1];
  const M = 512;
  const out = [];
  let j = 0;
  for (let k = 0; k < M; k++) {
    const target = (k / M) * total;
    while (cum[j + 1] < target) j++;
    const f = (target - cum[j]) / (cum[j + 1] - cum[j]);
    out.push(pts[j].clone().lerp(pts[(j + 1) % pts.length], f));
  }
  return { points: out, length: total };
}

export function createBicycle() {
  const B = BIKE;
  const mats = makeMaterials();
  const group = new THREE.Group();
  group.name = 'bicycle';

  const axisUp = B.headTop.clone().sub(B.headBottom).normalize();
  const axisDown = axisUp.clone().negate();

  // ---------- frame ----------
  const ttEnd = B.headTop.clone().addScaledVector(axisDown, 0.035);
  const dtEnd = B.headBottom.clone().addScaledVector(axisUp, 0.03);
  const frameParts = [
    cylinderBetween(B.seatCluster, ttEnd, 0.0155, 0.0155, 14),
    cylinderBetween(B.bb, dtEnd, 0.0175, 0.0175, 14),
    cylinderBetween(B.bb, B.seatCluster.clone().addScaledVector(B.seatCluster.clone().sub(B.bb).normalize(), 0.02), 0.0165, 0.0165, 14),
    cylinderBetween(B.headBottom.clone().addScaledVector(axisDown, 0.012), B.headTop.clone().addScaledVector(axisUp, 0.006), 0.0205, 0.0205, 16),
  ];
  for (const s of [-1, 1]) {
    frameParts.push(cylinderBetween(V(B.bb.x - 0.015, B.bb.y, 0.028 * s), V(B.rearAxle.x + 0.01, B.rearAxle.y, 0.063 * s), 0.0095, 0.007, 10));
    frameParts.push(cylinderBetween(V(B.seatCluster.x - 0.004, B.seatCluster.y - 0.025, 0.02 * s), V(B.rearAxle.x + 0.012, B.rearAxle.y + 0.012, 0.063 * s), 0.0085, 0.0065, 10));
    const drop = new THREE.CylinderGeometry(0.016, 0.016, 0.006, 12);
    drop.rotateX(Math.PI / 2);
    drop.translate(B.rearAxle.x, B.rearAxle.y, 0.066 * s);
    frameParts.push(drop);
  }
  const bbShell = new THREE.CylinderGeometry(0.022, 0.022, 0.074, 18);
  bbShell.rotateX(Math.PI / 2);
  bbShell.translate(B.bb.x, B.bb.y, 0);
  frameParts.push(bbShell);
  for (const p of [B.seatCluster, ttEnd, dtEnd]) {
    const lug = new THREE.SphereGeometry(0.021, 12, 10);
    lug.translate(p.x, p.y, p.z);
    frameParts.push(lug);
  }
  const frame = new THREE.Mesh(mergeGeometries(frameParts.map((g) => (g.index ? g.toNonIndexed() : g))), mats.frame);
  frame.castShadow = true;
  frame.receiveShadow = true;
  group.add(frame);

  // decals on the down tube (both sides, text upright)
  {
    const d = dtEnd.clone().sub(B.bb);
    const len = d.length();
    d.normalize();
    const mid = B.bb.clone().addScaledVector(d, len * 0.52);
    for (const s of [1, -1]) {
      const plane = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.028), mats.decal);
      const x = d.clone().multiplyScalar(s);
      const z = V(0, 0, s);
      const y = z.clone().cross(x);
      plane.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
      plane.position.copy(mid).add(V(0, 0, 0.0182 * s));
      group.add(plane);
    }
  }

  // seat post + saddle
  const postDir = B.seatCluster.clone().sub(B.bb).normalize();
  const postTop = B.seatCluster.clone().addScaledVector(postDir, 0.085);
  group.add(new THREE.Mesh(cylinderBetween(B.seatCluster, postTop, 0.0125, 0.0125, 12), mats.chrome));
  {
    const s = new THREE.Shape();
    s.moveTo(0.15, 0);
    s.bezierCurveTo(0.15, 0.03, 0.06, 0.034, 0.0, 0.05);
    s.bezierCurveTo(-0.05, 0.075, -0.115, 0.105, -0.128, 0.07);
    s.bezierCurveTo(-0.142, 0.03, -0.142, -0.03, -0.128, -0.07);
    s.bezierCurveTo(-0.115, -0.105, -0.05, -0.075, 0.0, -0.05);
    s.bezierCurveTo(0.06, -0.034, 0.15, -0.03, 0.15, 0);
    const g = new THREE.ExtrudeGeometry(s, { depth: 0.028, bevelEnabled: true, bevelThickness: 0.018, bevelSize: 0.014, bevelSegments: 5, curveSegments: 24 });
    g.rotateX(-Math.PI / 2);
    g.translate(B.saddleTop.x + 0.015, B.saddleTop.y - 0.046, 0);
    const saddle = new THREE.Mesh(g, mats.leather);
    saddle.castShadow = true;
    group.add(saddle);
    const springParts = [];
    for (const z of [-0.055, 0.055]) {
      const helix = new THREE.TubeGeometry(new HelixCurve(0.012, 0.05, 5), 60, 0.0026, 5, false);
      helix.translate(B.saddleTop.x - 0.08, B.saddleTop.y - 0.118, z);
      springParts.push(helix);
    }
    const rail = tubeThrough([V(postTop.x + 0.07, postTop.y + 0.012, 0), V(postTop.x + 0.02, postTop.y + 0.005, -0.03), V(B.saddleTop.x - 0.08, B.saddleTop.y - 0.12, -0.055), V(B.saddleTop.x - 0.1, B.saddleTop.y - 0.125, 0), V(B.saddleTop.x - 0.08, B.saddleTop.y - 0.12, 0.055), V(postTop.x + 0.02, postTop.y + 0.005, 0.03), V(postTop.x + 0.07, postTop.y + 0.012, 0)], 0.0035, 48, 5, true);
    springParts.push(rail);
    group.add(new THREE.Mesh(mergeGeometries(springParts.map((g2) => (g2.index ? g2.toNonIndexed() : g2))), mats.chrome));
  }

  // ---------- wheels ----------
  const rear = makeWheel(mats);
  rear.spin.position.copy(B.rearAxle);
  group.add(rear.spin);
  group.add(fender(B.rearAxle, 25, 190, mats));
  // tail light on the rear fender
  const tailLight = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.022, 0.05), mats.tail);
  {
    const a = THREE.MathUtils.degToRad(160);
    tailLight.position.set(B.rearAxle.x + Math.cos(a) * (B.wheelR + 0.04), B.rearAxle.y + Math.sin(a) * (B.wheelR + 0.04), 0);
    tailLight.rotation.z = a - Math.PI / 2;
    group.add(tailLight);
  }

  // ---------- drivetrain ----------
  const crank = new THREE.Group();
  crank.position.copy(B.bb);
  group.add(crank);
  {
    const ring = new THREE.ExtrudeGeometry(gearShape(42, B.chainringR - 0.0035, B.chainringR + 0.004, 0.058), { depth: 0.003, bevelEnabled: false, curveSegments: 4 });
    ring.translate(0, 0, B.chainZ - 0.0015);
    const parts = [ring];
    for (let i = 0; i < 5; i++) {
      const arm = new THREE.BoxGeometry(0.062, 0.012, 0.005);
      arm.translate(0.031, 0, 0);
      arm.rotateZ((i / 5) * Math.PI * 2 + 0.3);
      arm.translate(0, 0, B.chainZ + 0.002);
      parts.push(arm);
    }
    const armR = new THREE.BoxGeometry(B.crankLen, 0.02, 0.011);
    armR.translate(B.crankLen / 2, 0, 0.066);
    const armL = new THREE.BoxGeometry(B.crankLen, 0.02, 0.011);
    armL.translate(-B.crankLen / 2, 0, -0.066);
    const spindle = new THREE.CylinderGeometry(0.009, 0.009, 0.15, 10);
    spindle.rotateX(Math.PI / 2);
    for (const [x, z] of [[B.crankLen, 0.085], [-B.crankLen, -0.085]]) {
      const pin = new THREE.CylinderGeometry(0.006, 0.006, 0.04, 8);
      pin.rotateX(Math.PI / 2);
      pin.translate(x, 0, z);
      parts.push(pin);
    }
    parts.push(armR, armL, spindle);
    const m = new THREE.Mesh(mergeGeometries(parts.map((g) => (g.index ? g.toNonIndexed() : g))), mats.chrome);
    m.castShadow = true;
    crank.add(m);
  }
  const cog = new THREE.Mesh(new THREE.ExtrudeGeometry(gearShape(16, B.cogR - 0.003, B.cogR + 0.0035, 0.012), { depth: 0.004, bevelEnabled: false, curveSegments: 3 }), mats.chrome);
  cog.geometry.translate(0, 0, B.chainZ - 0.002);
  cog.position.copy(B.rearAxle);
  group.add(cog);

  const pedalGeo = (() => {
    const body = new THREE.BoxGeometry(0.1, 0.016, 0.075);
    const parts = [body];
    for (const x of [-0.05, 0.05]) {
      const cage = new THREE.BoxGeometry(0.008, 0.024, 0.08);
      cage.translate(x, 0, 0);
      parts.push(cage);
    }
    return mergeGeometries(parts);
  })();
  const pedalR = new THREE.Mesh(pedalGeo, mats.darkMetal);
  const pedalL = new THREE.Mesh(pedalGeo, mats.darkMetal);
  pedalR.castShadow = pedalL.castShadow = true;
  group.add(pedalR, pedalL);
  const reflectorMat = new THREE.MeshStandardMaterial({ color: 0xff8a1f, emissive: 0xff6a00, emissiveIntensity: 0.1, roughness: 0.3 });
  for (const p of [pedalR, pedalL]) {
    const r = new THREE.Mesh(new THREE.BoxGeometry(0.004, 0.01, 0.05), reflectorMat);
    r.position.set(-0.052, 0, 0);
    p.add(r);
  }

  const chainPath = buildChainPath();
  const pitch = 0.0127;
  const linkCount = Math.round(chainPath.length / pitch);
  const linkStep = chainPath.length / linkCount;
  const chain = new THREE.InstancedMesh(new THREE.BoxGeometry(linkStep * 1.02, 0.0065, 0.0075), mats.darkMetal, linkCount);
  chain.frustumCulled = false;
  group.add(chain);

  // ---------- steering assembly ----------
  const steerPivot = new THREE.Group();
  steerPivot.position.copy(B.headTop);
  steerPivot.quaternion.setFromUnitVectors(V(0, 1, 0), axisUp);
  steerPivot.updateMatrix();
  const steerRot = new THREE.Group();
  const steerContent = new THREE.Group();
  steerContent.matrixAutoUpdate = false;
  steerContent.matrix.copy(steerPivot.matrix).invert();
  steerPivot.add(steerRot);
  steerRot.add(steerContent);
  group.add(steerPivot);

  const front = makeWheel(mats);
  front.spin.position.copy(B.frontAxle);
  steerContent.add(front.spin);
  steerContent.add(fender(B.frontAxle, 30, 165, mats));

  {
    const crownY = B.headBottom.clone().addScaledVector(axisDown, 0.03);
    const parts = [];
    const crown = new THREE.BoxGeometry(0.03, 0.022, 0.11);
    crown.translate(crownY.x, crownY.y, 0);
    parts.push(crown);
    for (const s of [-1, 1]) {
      const start = V(crownY.x, crownY.y, 0.047 * s);
      const ctrl = start.clone().addScaledVector(axisDown, 0.3);
      const end = V(B.frontAxle.x, B.frontAxle.y, 0.05 * s);
      const curve = new THREE.QuadraticBezierCurve3(start, ctrl, end);
      parts.push(new THREE.TubeGeometry(curve, 16, 0.0115, 10, false));
      const drop = new THREE.CylinderGeometry(0.014, 0.014, 0.006, 12);
      drop.rotateX(Math.PI / 2);
      drop.translate(B.frontAxle.x, B.frontAxle.y, 0.052 * s);
      parts.push(drop);
    }
    const fork = new THREE.Mesh(mergeGeometries(parts.map((g) => (g.index ? g.toNonIndexed() : g))), mats.frame);
    fork.castShadow = true;
    steerContent.add(fork);
  }

  // stem & handlebar
  const stemTop = B.headTop.clone().addScaledVector(axisUp, 0.075);
  const clamp = V(0.388, 0.912, 0);
  {
    const parts = [cylinderBetween(B.headTop.clone().addScaledVector(axisDown, 0.01), stemTop, 0.012, 0.012, 12), cylinderBetween(stemTop, clamp, 0.011, 0.011, 10)];
    const barPts = [
      V(0.158, 0.94, -0.308),
      V(0.24, 0.94, -0.274),
      V(0.325, 0.925, -0.2),
      V(0.378, 0.914, -0.09),
      V(0.388, 0.912, 0),
      V(0.378, 0.914, 0.09),
      V(0.325, 0.925, 0.2),
      V(0.24, 0.94, 0.274),
      V(0.158, 0.94, 0.308),
    ];
    parts.push(tubeThrough(barPts, 0.0105, 96, 10));
    const bar = new THREE.Mesh(mergeGeometries(parts.map((g) => (g.index ? g.toNonIndexed() : g))), mats.chrome);
    bar.castShadow = true;
    steerContent.add(bar);
    const gripParts = [];
    for (const s of [-1, 1]) {
      gripParts.push(cylinderBetween(V(0.248, 0.94, 0.271 * s), V(0.152, 0.94, 0.311 * s), 0.0165, 0.0175, 14));
      const cap = new THREE.SphereGeometry(0.0175, 12, 8);
      cap.translate(0.152, 0.94, 0.311 * s);
      gripParts.push(cap);
    }
    const grips = new THREE.Mesh(mergeGeometries(gripParts.map((g) => (g.index ? g.toNonIndexed() : g))), mats.leather);
    steerContent.add(grips);
    // bell
    const bell = new THREE.Group();
    bell.position.copy(B.bell);
    const dome = new THREE.Mesh(new THREE.SphereGeometry(0.024, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2), mats.chrome);
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.024, 0.006, 20), mats.chrome);
    base.position.y = -0.002;
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.005, 8, 6), mats.chrome);
    knob.position.y = 0.025;
    bell.add(dome, base, knob);
    const lever = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.004, 0.008), mats.darkMetal);
    lever.geometry.translate(-0.015, 0, 0);
    lever.position.set(-0.02, 0.002, 0.012);
    bell.add(lever);
    bell.userData.lever = lever;
    steerContent.add(bell);
    steerContent.userData.bell = bell;
  }

  // basket with fish
  const basketGroup = new THREE.Group();
  basketGroup.position.copy(B.basket);
  steerContent.add(basketGroup);
  const fishInBasket = [];
  {
    const w = 0.28;
    const h = 0.2;
    const d = 0.34;
    const walls = [];
    const front = new THREE.PlaneGeometry(d, h);
    front.rotateY(Math.PI / 2);
    front.translate(w / 2, 0, 0);
    const back = front.clone();
    back.translate(-w, 0, 0);
    const left = new THREE.PlaneGeometry(w, h);
    left.translate(0, 0, -d / 2);
    const right = left.clone();
    right.translate(0, 0, d);
    const bottom = new THREE.PlaneGeometry(w, d);
    bottom.rotateX(-Math.PI / 2);
    bottom.translate(0, -h / 2, 0);
    walls.push(front, back, left, right, bottom);
    const basket = new THREE.Mesh(mergeGeometries(walls), mats.wicker);
    basket.castShadow = true;
    basketGroup.add(basket);
    const rimPts = [V(w / 2, h / 2, -d / 2), V(w / 2, h / 2, d / 2), V(-w / 2, h / 2, d / 2), V(-w / 2, h / 2, -d / 2)];
    const rim = new THREE.Mesh(tubeThrough(rimPts, 0.009, 80, 6, true, 'catmullrom', 0.05), mats.wickerRim);
    basketGroup.add(rim);
    const fishGeo = createFishGeometry();
    const fm = fishMaterial();
    const placements = [
      [V(0.02, 0.1, -0.08), new THREE.Euler(0.3, 0.4, 1.25)],
      [V(-0.05, 0.08, 0.06), new THREE.Euler(-0.4, -0.3, 1.1)],
      [V(0.06, 0.06, 0.1), new THREE.Euler(0.2, 2.6, 1.35)],
      [V(-0.02, 0.05, -0.02), new THREE.Euler(0.1, 1.6, 1.4)],
    ];
    for (const [pos, rot] of placements) {
      const f = new THREE.Mesh(fishGeo, fm);
      f.scale.setScalar(0.19);
      f.position.copy(pos);
      f.rotation.copy(rot);
      f.castShadow = true;
      basketGroup.add(f);
      fishInBasket.push(f);
    }
    // struts to the front axle
    const struts = [];
    for (const s of [-1, 1]) {
      struts.push(cylinderBetween(V(B.basket.x + w * 0.35, B.basket.y - h / 2, 0.1 * s), V(B.frontAxle.x + 0.005, B.frontAxle.y + 0.01, 0.058 * s), 0.004, 0.004, 6));
    }
    struts.push(cylinderBetween(V(B.basket.x - w / 2, B.basket.y + 0.02, 0), clamp.clone().add(V(0.01, -0.01, 0)), 0.006, 0.006, 6));
    struts.push(cylinderBetween(V(B.basket.x - w / 2, B.basket.y - h / 2 + 0.02, 0), B.headBottom.clone().addScaledVector(axisDown, 0.02), 0.006, 0.006, 6));
    steerContent.add(new THREE.Mesh(mergeGeometries(struts), mats.chrome));
  }

  // headlight
  const headlight = new THREE.Group();
  headlight.position.set(B.basket.x + 0.155, B.basket.y - 0.03, 0);
  {
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.024, 0.055, 18), mats.chrome);
    body.rotation.z = -Math.PI / 2;
    const lens = new THREE.Mesh(new THREE.CircleGeometry(0.027, 20), mats.lens);
    lens.rotation.y = Math.PI / 2;
    lens.position.x = 0.0285;
    headlight.add(body, lens);
  }
  steerContent.add(headlight);
  const spot = new THREE.SpotLight(0xffe9c4, 0, 38, 0.48, 0.55, 1.4);
  spot.position.set(0.04, 0, 0);
  spot.castShadow = false;
  const spotTarget = new THREE.Object3D();
  spotTarget.position.set(7, -0.9, 0);
  headlight.add(spot, spotTarget);
  spot.target = spotTarget;

  // ---------- state & update ----------
  const steerMat = new THREE.Matrix4();
  const tmpM = new THREE.Matrix4();
  const gripBaseR = B.grip.clone();
  const gripBaseL = B.grip.clone().setZ(-B.grip.z);
  const api = {
    group,
    mats,
    headlightSpot: spot,
    fishInBasket,
    pedalR: new THREE.Vector3(),
    pedalL: new THREE.Vector3(),
    gripR: new THREE.Vector3(),
    gripL: new THREE.Vector3(),
    bellPos: new THREE.Vector3(),
    basketPos: new THREE.Vector3(),
    crankAngle: 0,
    /** Transforms a point given in (un-steered) bike space by the current steering rotation. */
    steerPoint(p, out) {
      return out.copy(p).applyMatrix4(steerMat);
    },
    update({ wheelAngle, crankAngle, steer, speed, night, time, ankleR = 0, ankleL = 0, bellT = 1 }) {
      rear.spin.rotation.z = -wheelAngle;
      front.spin.rotation.z = -wheelAngle;
      crank.rotation.z = crankAngle;
      cog.rotation.z = crankAngle * B.ratio;
      api.crankAngle = crankAngle;

      const cr = Math.cos(crankAngle) * B.crankLen;
      const sr = Math.sin(crankAngle) * B.crankLen;
      api.pedalR.set(B.bb.x + cr, B.bb.y + sr, B.pedalZ);
      api.pedalL.set(B.bb.x - cr, B.bb.y - sr, -B.pedalZ);
      pedalR.position.copy(api.pedalR);
      pedalL.position.copy(api.pedalL);
      pedalR.rotation.z = ankleR;
      pedalL.rotation.z = ankleL;

      // chain: travels crankAngle * r1 along the loop (top run moves forward when pedalling forward)
      const travel = -crankAngle * B.chainringR;
      const pts = chainPath.points;
      const M = pts.length;
      for (let i = 0; i < linkCount; i++) {
        let s = (i * linkStep + travel) / chainPath.length;
        s -= Math.floor(s);
        const f = s * M;
        const i0 = Math.floor(f) % M;
        const i1 = (i0 + 1) % M;
        const t = f - Math.floor(f);
        const x = pts[i0].x + (pts[i1].x - pts[i0].x) * t;
        const y = pts[i0].y + (pts[i1].y - pts[i0].y) * t;
        const i2 = (i0 + 3) % M;
        const ang = Math.atan2(pts[i2].y - pts[i0].y, pts[i2].x - pts[i0].x);
        tmpM.makeRotationZ(ang).setPosition(x, y, B.chainZ + (i % 2 ? 0.0015 : -0.0015));
        chain.setMatrixAt(i, tmpM);
      }
      chain.instanceMatrix.needsUpdate = true;

      steerRot.rotation.y = steer;
      steerRot.updateMatrix();
      steerMat.multiplyMatrices(steerPivot.matrix, steerRot.matrix).multiply(steerContent.matrix);
      api.gripR.copy(gripBaseR).applyMatrix4(steerMat);
      api.gripL.copy(gripBaseL).applyMatrix4(steerMat);
      api.bellPos.copy(B.bell).applyMatrix4(steerMat);
      api.basketPos.copy(B.basket).applyMatrix4(steerMat);

      const omega = Math.abs(speed) / B.wheelR;
      const blur = THREE.MathUtils.smoothstep(omega, 9, 26);
      mats.blur.opacity = blur * 0.38;
      mats.blur.visible = blur > 0.01;
      front.spokeMesh.visible = rear.spokeMesh.visible = blur < 0.97;

      const lever = steerContent.userData.bell.userData.lever;
      lever.rotation.y = bellT < 1 ? Math.sin(bellT * Math.PI * 4) * 0.6 : 0;

      spot.intensity = night * 22;
      mats.lens.emissiveIntensity = 0.25 + night * 5;
      const blink = Math.sin(time * 6) > 0 ? 1 : 0.15;
      mats.tail.emissiveIntensity = 0.15 + night * 4 * blink;
    },
  };
  api.update({ wheelAngle: 0, crankAngle: 0, steer: 0, speed: 0, night: 0, time: 0 });
  return api;
}

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Loft, loftAlongCurve, orientSegment, solveTwoBone, paint, cylinderBetween } from '../lib/geometry.js';
import { keyed, smoothstep, lerp, clamp } from '../lib/math.js';
import { featherNormalMap } from '../lib/textures.js';
import { BIKE } from './bicycle.js';

const V = (x, y, z = 0) => new THREE.Vector3(x, y, z);

const COL = {
  white: new THREE.Color(0xf8f5f0),
  blush: new THREE.Color(0xf6d9c7),
  grey: new THREE.Color(0xd9d6d2),
  black: new THREE.Color(0x16161b),
  billBase: new THREE.Color(0xd9a193),
  bill: new THREE.Color(0xf2b24c),
  billTip: new THREE.Color(0xee9536),
  nail: new THREE.Color(0xd23f2a),
  pouchSkin: new THREE.Color(0xf3c9a2),
  pouch: new THREE.Color(0xf7b943),
  face: new THREE.Color(0xf5c49d),
};

// Attach points in body space (origin = saddle contact point).
const SHOULDER = V(0.2, 0.36, 0.118);
const HIP = V(0.02, 0.07, 0.095);
const NECK_BASE = V(0.3, 0.42, 0);
const HEAD_BASE = V(0.37, 0.845, 0);
const WING = { upper: 0.235, fore: 0.24 };
const LEG = { thigh: 0.43, shin: 0.4 };

function makeMaterials() {
  const fn = featherNormalMap();
  fn.repeat.set(9, 7);
  const featherBase = { roughness: 0.8, sheen: 0.7, sheenRoughness: 0.45, sheenColor: new THREE.Color(0xffffff), normalMap: fn, normalScale: new THREE.Vector2(0.26, 0.26) };
  return {
    featherVC: new THREE.MeshPhysicalMaterial({ ...featherBase, vertexColors: true }),
    feather: new THREE.MeshPhysicalMaterial({ ...featherBase, color: COL.white }),
    vane: new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.78, sheen: 0.5, sheenRoughness: 0.5, side: THREE.DoubleSide }),
    primary: new THREE.MeshPhysicalMaterial({ color: COL.black, roughness: 0.55, sheen: 0.6, sheenColor: new THREE.Color(0x5a6070), side: THREE.DoubleSide }),
    bill: new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.36, clearcoat: 0.45, clearcoatRoughness: 0.3 }),
    pouch: new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.46, sheen: 0.5, sheenColor: new THREE.Color(0xffc27a), emissive: new THREE.Color(0x7a3300), emissiveIntensity: 0.14, side: THREE.DoubleSide }),
    leg: new THREE.MeshStandardMaterial({ color: 0xee8243, roughness: 0.55, side: THREE.DoubleSide }),
    claw: new THREE.MeshStandardMaterial({ color: 0x3a2a22, roughness: 0.4 }),
    eye: new THREE.MeshPhysicalMaterial({ color: 0x8c4a1c, roughness: 0.08, clearcoat: 1, clearcoatRoughness: 0.02 }),
    pupil: new THREE.MeshStandardMaterial({ color: 0x040404, roughness: 0.15 }),
    glint: new THREE.MeshBasicMaterial({ color: new THREE.Color(0.82, 0.82, 0.8) }),
    ring: new THREE.MeshStandardMaterial({ color: 0xf2cf62, roughness: 0.5 }),
    helmet: new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.28, clearcoat: 1, clearcoatRoughness: 0.06 }),
    visor: new THREE.MeshStandardMaterial({ color: 0x1c1f24, roughness: 0.35 }),
    lens: new THREE.MeshPhysicalMaterial({ color: 0x0c0f14, roughness: 0.04, metalness: 0.4, clearcoat: 1, clearcoatRoughness: 0.02 }),
    glassFrame: new THREE.MeshStandardMaterial({ color: 0xf2b134, roughness: 0.3, metalness: 0.6 }),
  };
}

function vaneGeometry(length, width, n, whiteFrac, taper = 0.25) {
  const along = n * 6;
  const across = 6;
  const pos = [];
  const col = [];
  const uv = [];
  const idx = [];
  const c = new THREE.Color();
  for (let i = 0; i <= along; i++) {
    const t = i / along;
    const frac = (t * n) % 1;
    const w = width * (0.76 + 0.24 * Math.sin(Math.PI * frac)) * (1 - taper * t);
    for (let j = 0; j <= across; j++) {
      const u = j / across;
      pos.push(u * w, t * length, 0.012 * Math.sin(Math.PI * u) * (1 - 0.4 * u));
      c.copy(COL.white).lerp(COL.black, smoothstep(whiteFrac - 0.08, whiteFrac + 0.08, u));
      col.push(c.r, c.g, c.b);
      uv.push(u, t);
    }
  }
  const rv = across + 1;
  for (let i = 0; i < along; i++) {
    for (let j = 0; j < across; j++) {
      const a = i * rv + j;
      const b = a + rv;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function sleeveGeometry(length, r0, r1, depth0, depth1) {
  return loftAlongCurve(new THREE.LineCurve3(V(0, 0, 0), V(0, length, 0)), 10, 14, (t) => {
    const ry = lerp(depth0, depth1, t) * (0.85 + 0.15 * Math.sin(Math.PI * t));
    return { rx: lerp(r0, r1, t), ry, oy: -ry * 0.45 };
  }, { side: V(0, 0, 1) });
}

function makeWing(mats, side) {
  const upper = new THREE.Group();
  const fore = new THREE.Group();
  const hand = new THREE.Group();

  const upperSleeve = new THREE.Mesh(sleeveGeometry(WING.upper, 0.036, 0.026, 0.06, 0.045), mats.feather);
  const upperVaneG = new THREE.Group();
  upperVaneG.add(new THREE.Mesh(vaneGeometry(WING.upper * 0.95, 0.11, 4, 0.72, 0.1), mats.vane));
  upper.add(upperSleeve, upperVaneG);

  const foreSleeve = new THREE.Mesh(sleeveGeometry(WING.fore, 0.026, 0.02, 0.045, 0.035), mats.feather);
  const foreVaneG = new THREE.Group();
  foreVaneG.add(new THREE.Mesh(vaneGeometry(WING.fore, 0.17, 7, 0.32, 0.18), mats.vane));
  fore.add(foreSleeve, foreVaneG);

  const wristBall = new THREE.Mesh(new THREE.SphereGeometry(0.026, 12, 10), mats.feather);
  hand.add(wristBall);
  const featherG = new THREE.SphereGeometry(1, 10, 6);
  featherG.scale(0.019, 0.095, 0.006);
  featherG.translate(0, 0.095, 0);
  const primaries = [];
  for (let i = 0; i < 5; i++) {
    const f = new THREE.Mesh(featherG, mats.primary);
    f.castShadow = true;
    hand.add(f);
    primaries.push(f);
  }
  for (const m of [upperSleeve, foreSleeve, wristBall, ...upperVaneG.children, ...foreVaneG.children]) m.castShadow = true;
  return { side, upper, fore, hand, upperVaneG, foreVaneG, primaries, shoulder: new THREE.Vector3(), elbow: new THREE.Vector3(), wrist: new THREE.Vector3(), target: new THREE.Vector3(), handTarget: new THREE.Vector3() };
}

function makeFoot(mats, side) {
  const foot = new THREE.Group();
  const base = V(0.0, -0.036, 0);
  const inner = -side;
  const tips = [V(0.12, -0.046, -0.052), V(0.142, -0.046, 0), V(0.12, -0.046, 0.052), V(0.075, -0.046, 0.062 * inner)];
  const parts = [];
  for (const tip of tips) {
    parts.push(cylinderBetween(base, tip, 0.012, 0.0065, 7));
    const k = new THREE.SphereGeometry(0.0075, 8, 6);
    k.translate(tip.x, tip.y, tip.z);
    parts.push(k);
  }
  const ankle = new THREE.SphereGeometry(0.02, 10, 8);
  parts.push(ankle);
  parts.push(cylinderBetween(V(0, 0, 0), base, 0.02, 0.016, 8));
  const toes = new THREE.Mesh(mergeGeometries(parts), mats.leg);
  toes.castShadow = true;
  // shape y maps to foot z after rotateX(π/2); the hallux web sits on the inner side
  const web = new THREE.Shape();
  web.moveTo(0.0, 0.0);
  web.lineTo(0.118, -0.05);
  web.quadraticCurveTo(0.112, -0.022, 0.14, 0.0);
  web.quadraticCurveTo(0.112, 0.022, 0.118, 0.05);
  web.lineTo(0.0, 0.0);
  const innerWeb = new THREE.Shape();
  innerWeb.moveTo(0, 0);
  innerWeb.lineTo(0.118, 0.05 * inner);
  innerWeb.quadraticCurveTo(0.088, 0.048 * inner, 0.074, 0.06 * inner);
  innerWeb.lineTo(0, 0);
  const webG = mergeGeometries([new THREE.ShapeGeometry(web, 6).toNonIndexed(), new THREE.ShapeGeometry(innerWeb, 6).toNonIndexed()]);
  webG.rotateX(Math.PI / 2);
  webG.translate(0, -0.044, 0);
  const webM = new THREE.Mesh(webG, mats.leg);
  webM.castShadow = true;
  const claws = [];
  for (const tip of tips) {
    const cl = new THREE.ConeGeometry(0.005, 0.016, 6);
    cl.rotateZ(-Math.PI / 2);
    const dir = tip.clone().sub(base).normalize();
    cl.translate(tip.x + dir.x * 0.008, tip.y - 0.002, tip.z + dir.z * 0.008);
    claws.push(cl);
  }
  const clawM = new THREE.Mesh(mergeGeometries(claws), mats.claw);
  foot.add(toes, webM, clawM);
  return foot;
}

function makeLeg(mats, side) {
  // feathered "trousers" on the upper half, bare orange skin below (tibiotarsus)
  const legSkin = new THREE.Color(0xee8243);
  const thighG = loftAlongCurve(new THREE.LineCurve3(V(0, 0, 0), V(0, LEG.thigh, 0)), 16, 14, (t) => {
    const r = keyed([[0, 0.07], [0.3, 0.06], [0.5, 0.045], [0.6, 0.03], [1, 0.025]], t);
    return { rx: r, ry: r * 1.08 };
  }, { side: V(0, 0, 1), colorFn: (t, c) => c.copy(COL.white).lerp(legSkin, smoothstep(0.5, 0.58, t)) });
  const thigh = new THREE.Mesh(thighG, mats.featherVC);
  const knee = new THREE.Mesh(new THREE.SphereGeometry(0.027, 12, 10), mats.leg);
  const shinG = loftAlongCurve(new THREE.LineCurve3(V(0, 0, 0), V(0, LEG.shin, 0)), 8, 10, (t) => {
    const r = keyed([[0, 0.024], [0.2, 0.021], [1, 0.018]], t);
    return { rx: r, ry: r * 1.15 };
  }, { side: V(0, 0, 1) });
  const shin = new THREE.Mesh(shinG, mats.leg);
  const kneeCap = new THREE.Mesh(new THREE.SphereGeometry(0.026, 10, 8), mats.leg);
  const foot = makeFoot(mats, side);
  for (const m of [thigh, knee, shin, kneeCap]) m.castShadow = true;
  return { side, thigh, knee, kneeCap, shin, foot, hip: new THREE.Vector3(), kneeP: new THREE.Vector3(), ankle: new THREE.Vector3(), target: new THREE.Vector3() };
}

export function createPelican() {
  const mats = makeMaterials();
  const group = new THREE.Group();
  group.name = 'pelican';
  const S = BIKE.saddleTop.clone();

  // ---------------- body ----------------
  const bodyG = new THREE.Group();
  bodyG.position.copy(S);
  group.add(bodyG);
  const bodyCurve = new THREE.CatmullRomCurve3([V(-0.4, 0.25), V(-0.25, 0.2), V(-0.02, 0.18), V(0.17, 0.25), V(0.29, 0.37), V(0.32, 0.45)]);
  const ry = [[0, 0.055], [0.1, 0.1], [0.28, 0.158], [0.5, 0.186], [0.7, 0.174], [0.86, 0.14], [1, 0.085]];
  const rx = [[0, 0.05], [0.1, 0.094], [0.28, 0.15], [0.5, 0.172], [0.7, 0.16], [0.86, 0.13], [1, 0.082]];
  const bodyGeo = loftAlongCurve(bodyCurve, 44, 30, (t) => ({ rx: keyed(rx, t), ry: keyed(ry, t) }), {
    colorFn: (t, c) => c.copy(COL.white).lerp(COL.blush, smoothstep(0.62, 0.98, t) * 0.75),
  });
  const body = new THREE.Mesh(bodyGeo, mats.featherVC);
  body.castShadow = true;
  body.receiveShadow = true;
  bodyG.add(body);

  // tail fan
  {
    const parts = [];
    for (let i = 0; i < 7; i++) {
      const a = (i - 3) / 3;
      const f = new THREE.SphereGeometry(1, 10, 6);
      f.scale(0.1, 0.026, 0.046);
      f.translate(0.075, 0, 0);
      f.rotateZ(0.05 * Math.abs(a));
      f.rotateY(Math.PI + a * 0.55);
      const ff = f.toNonIndexed();
      const p = ff.attributes.position;
      const colArr = new Float32Array(p.count * 3);
      const c = new THREE.Color();
      for (let k = 0; k < p.count; k++) {
        const d = Math.hypot(p.getX(k), p.getZ(k));
        c.copy(COL.white).lerp(COL.grey, smoothstep(0.12, 0.23, d));
        colArr.set([c.r, c.g, c.b], k * 3);
      }
      ff.setAttribute('color', new THREE.BufferAttribute(colArr, 3));
      parts.push(ff);
    }
    const tail = new THREE.Mesh(mergeGeometries(parts), mats.featherVC);
    tail.position.set(-0.36, 0.25, 0);
    tail.rotation.z = -0.38;
    tail.castShadow = true;
    bodyG.add(tail);
    bodyG.userData.tail = tail;
  }
  for (const s of [-1, 1]) {
    const puff = new THREE.Mesh(new THREE.SphereGeometry(0.06, 16, 12), mats.feather);
    puff.scale.set(1.35, 1.1, 0.85);
    puff.position.copy(SHOULDER).setZ(SHOULDER.z * s * 0.8);
    puff.castShadow = true;
    bodyG.add(puff);
  }

  // scarf ring around the neck base
  const scarfRing = new THREE.Group();
  bodyG.add(scarfRing);

  // ---------------- neck ----------------
  const neckLoft = new Loft(22, 16, { capStart: false, capEnd: true });
  const neck = new THREE.Mesh(neckLoft.geometry, mats.feather);
  neck.castShadow = true;
  bodyG.add(neck);
  const neckCurve = new THREE.CatmullRomCurve3([V(0, 0, 0), V(0, 0, 0), V(0, 0, 0), V(0, 0, 0)], false, 'centripetal');
  const neckR = [[0, 0.096], [0.22, 0.076], [0.6, 0.065], [1, 0.06]];

  // ---------------- head ----------------
  const headG = new THREE.Group();
  headG.rotation.order = 'YZX';
  headG.scale.setScalar(1.12);
  bodyG.add(headG);
  {
    const skull = new THREE.SphereGeometry(1, 32, 22);
    const p = skull.attributes.position;
    const colArr = new Float32Array(p.count * 3);
    const c = new THREE.Color();
    for (let k = 0; k < p.count; k++) {
      let x = p.getX(k);
      let y = p.getY(k);
      let z = p.getZ(k);
      if (y > 0.3) y = 0.3 + (y - 0.3) * 0.8;
      x *= 0.088;
      y *= 0.07;
      z *= 0.064;
      if (x > 0) y -= x * x * 1.2;
      p.setXYZ(k, x + 0.015, y + 0.035, z);
      const face = smoothstep(0.0, 0.05, x) * smoothstep(0.015, 0.05, Math.abs(z)) * (1 - smoothstep(0.035, 0.06, Math.abs(y + 0.035 - 0.05)));
      c.copy(COL.white).lerp(COL.face, face * 0.9);
      colArr.set([c.r, c.g, c.b], k * 3);
    }
    skull.setAttribute('color', new THREE.BufferAttribute(colArr, 3));
    skull.computeVertexNormals();
    const skullM = new THREE.Mesh(skull, mats.featherVC);
    skullM.castShadow = true;
    headG.add(skullM);

    const crestParts = [];
    for (let i = 0; i < 6; i++) {
      const f = new THREE.SphereGeometry(1, 8, 5);
      f.scale(0.05, 0.008, 0.012);
      f.translate(-0.04, 0, 0);
      f.rotateZ(-0.35 - i * 0.07);
      f.rotateY((i - 2.5) * 0.18);
      f.translate(-0.045, 0.085 - i * 0.004, 0);
      crestParts.push(f);
    }
    const crest = new THREE.Mesh(mergeGeometries(crestParts), mats.feather);
    headG.add(crest);
    headG.userData.crest = crest;
  }

  // eyes
  const eyes = [];
  for (const s of [-1, 1]) {
    const eg = new THREE.Group();
    eg.position.set(0.05, 0.043, 0.052 * s);
    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.0152, 16, 12), mats.eye);
    const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.0082, 12, 8), mats.pupil);
    pupil.position.set(0.0015, 0.0005, 0.0088 * s);
    const glint = new THREE.Mesh(new THREE.SphereGeometry(0.0028, 8, 6), mats.glint);
    glint.position.set(0.0055, 0.006, 0.0135 * s);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.016, 0.0038, 8, 22), mats.ring);
    ring.position.z = 0.0055 * s;
    eg.add(ball, pupil, glint, ring);
    headG.add(eg);
    eyes.push(eg);
  }

  // upper bill
  {
    const curve = new THREE.CatmullRomCurve3([V(0.07, 0.018), V(0.2, 0.011), V(0.34, -0.002), V(0.45, -0.02), V(0.495, -0.034), V(0.505, -0.05)]);
    const rxK = [[0, 0.033], [0.15, 0.028], [0.45, 0.024], [0.8, 0.027], [0.93, 0.019], [1, 0.007]];
    const ryK = [[0, 0.024], [0.12, 0.017], [0.35, 0.011], [0.78, 0.009], [0.9, 0.012], [1, 0.005]];
    const g = loftAlongCurve(curve, 40, 16, (t) => ({ rx: keyed(rxK, t), ry: keyed(ryK, t) }), {
      colorFn: (t, c) => {
        if (t < 0.3) c.copy(COL.billBase).lerp(COL.bill, smoothstep(0.04, 0.3, t));
        else if (t < 0.9) c.copy(COL.bill).lerp(COL.billTip, smoothstep(0.5, 0.9, t));
        else c.copy(COL.billTip).lerp(COL.nail, smoothstep(0.9, 0.95, t));
      },
    });
    const m = new THREE.Mesh(g, mats.bill);
    m.castShadow = true;
    headG.add(m);
  }

  // lower jaw + pouch
  const JAW_PIVOT = V(0.07, -0.004, 0);
  const jawG = new THREE.Group();
  jawG.position.copy(JAW_PIVOT);
  headG.add(jawG);
  {
    const a = V(0.005, -0.004);
    const b = V(0.42, -0.036);
    const g = loftAlongCurve(new THREE.LineCurve3(a, b), 30, 12, (t) => ({ rx: keyed([[0, 0.03], [0.4, 0.025], [0.85, 0.024], [1, 0.012]], t), ry: 0.007 - t * 0.002 }), {
      colorFn: (t, c) => c.copy(COL.bill).lerp(COL.billTip, smoothstep(0.5, 1, t)),
    });
    const m = new THREE.Mesh(g, mats.bill);
    m.castShadow = true;
    jawG.add(m);
  }
  const pouchLoft = new Loft(28, 18, { capStart: true, capEnd: true, colors: true });
  const pouch = new THREE.Mesh(pouchLoft.geometry, mats.pouch);
  pouch.castShadow = true;
  jawG.add(pouch);
  const POUCH_A = V(-0.065, -0.014);
  const POUCH_B = V(0.4, -0.032);
  const pouchDir = POUCH_B.clone().sub(POUCH_A).normalize();
  let pouchKey = '';
  function updatePouch(depth, bulge, flutter) {
    const key = `${depth.toFixed(4)}|${bulge.toFixed(3)}|${flutter.toFixed(4)}`;
    if (key === pouchKey) return;
    pouchKey = key;
    pouchLoft.update((t, s) => {
      s.center.copy(POUCH_A).lerp(POUCH_B, t);
      s.tangent.copy(pouchDir);
      s.side.set(0, 0, 1);
      const d = depth * Math.pow(Math.sin(Math.PI * Math.pow(t, 0.7)), 0.9) * (1 - 0.2 * t) + bulge * Math.exp(-(((t - 0.36) / 0.2) ** 2)) + flutter * Math.sin(Math.PI * t);
      s.rx = 0.022 * (1 - 0.25 * t) + 0.004 + bulge * 0.35 * Math.exp(-(((t - 0.36) / 0.22) ** 2));
      s.ry = d * 0.5 + 0.004;
      s.oy = -d * 0.5 + 0.002;
      s.color.copy(COL.pouchSkin).lerp(COL.pouch, smoothstep(0.02, 0.22, t));
    }, { dynamic: true });
  }
  updatePouch(0.075, 0, 0);

  // helmet
  const helmet = new THREE.Group();
  {
    const g = new THREE.SphereGeometry(1, 30, 14, 0, Math.PI * 2, 0, Math.PI * 0.5);
    const p = g.attributes.position;
    const colArr = new Float32Array(p.count * 3);
    const red = new THREE.Color(0xe2412e);
    const white = new THREE.Color(0xfbf6ee);
    const dark = new THREE.Color(0x2a2c31);
    const c = new THREE.Color();
    for (let k = 0; k < p.count; k++) {
      const x = p.getX(k);
      const y = p.getY(k);
      const z = p.getZ(k);
      const stripe = Math.abs(z) < 0.12 ? 1 : 0;
      const vent = Math.abs(Math.abs(z) - 0.42) < 0.07 && y > 0.45 && x > -0.6 ? 1 : 0;
      c.copy(red);
      if (stripe) c.copy(white);
      if (vent) c.copy(dark);
      if (y < 0.08) c.copy(dark);
      colArr.set([c.r, c.g, c.b], k * 3);
      p.setXYZ(k, x * 0.1, y * 0.07, z * 0.083);
    }
    g.setAttribute('color', new THREE.BufferAttribute(colArr, 3));
    g.computeVertexNormals();
    const shell = new THREE.Mesh(g, mats.helmet);
    shell.castShadow = true;
    // phi centred on π faces +X (forward, over the bill)
    const visor = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 6, Math.PI * 0.7, Math.PI * 0.6, Math.PI * 0.4, Math.PI * 0.12), mats.visor);
    visor.scale.set(0.118, 0.07, 0.092);
    visor.material.side = THREE.DoubleSide;
    helmet.add(shell, visor);
    helmet.position.set(0.0, 0.058, 0);
    helmet.rotation.z = 0.12;
    headG.add(helmet);
  }

  // sunglasses (lenses sit over the lateral eyes)
  const glasses = new THREE.Group();
  {
    for (const s of [-1, 1]) {
      const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.023, 0.023, 0.003, 20), mats.lens);
      lens.rotation.x = Math.PI / 2;
      lens.position.set(0.052, 0.043, 0.074 * s);
      const rim = new THREE.Mesh(new THREE.TorusGeometry(0.023, 0.0028, 6, 24), mats.glassFrame);
      rim.position.copy(lens.position);
      glasses.add(lens, rim);
      const arm = new THREE.Mesh(cylinderBetween(V(0.032, 0.048, 0.073 * s), V(-0.06, 0.055, 0.06 * s), 0.0018), mats.glassFrame);
      glasses.add(arm);
    }
    const bridge = new THREE.Mesh(tubeBridge(), mats.glassFrame);
    glasses.add(bridge);
    glasses.visible = false;
    headG.add(glasses);
  }
  function tubeBridge() {
    const curve = new THREE.CatmullRomCurve3([V(0.062, 0.05, -0.07), V(0.088, 0.068, -0.032), V(0.094, 0.073, 0), V(0.088, 0.068, 0.032), V(0.062, 0.05, 0.07)]);
    return new THREE.TubeGeometry(curve, 20, 0.0022, 5, false);
  }

  // ---------------- limbs ----------------
  const wings = [makeWing(mats, 1), makeWing(mats, -1)];
  for (const w of wings) group.add(w.upper, w.fore, w.hand);
  const legs = [makeLeg(mats, 1), makeLeg(mats, -1)];
  for (const l of legs) group.add(l.thigh, l.knee, l.shin, l.kneeCap, l.foot);

  // ---------------- per-frame pose ----------------
  const tmpV = new THREE.Vector3();
  const tmpV2 = new THREE.Vector3();
  const tmpQ = new THREE.Quaternion();
  const invBody = new THREE.Matrix4();
  const headRig = new THREE.Vector3();
  const headLocal = new THREE.Vector3();
  const desiredHeadQ = new THREE.Quaternion();
  const bodyQ = new THREE.Quaternion();
  const euler = new THREE.Euler(0, 0, 0, 'YZX');
  const poleArm = new THREE.Vector3();
  const poleLeg = new THREE.Vector3();
  const hint = new THREE.Vector3();
  const spreadTarget = new THREE.Vector3();
  const neckPts = neckCurve.points;
  const neckS = { bulge: 0, pos: 1 };

  function updateNeck(base, head, bulgeAmt, bulgePos) {
    const ax = tmpV.subVectors(head, base);
    const perp = tmpV2.set(ax.y, -ax.x, 0).normalize();
    neckPts[0].copy(base);
    neckPts[1].copy(base).addScaledVector(ax, 0.3).addScaledVector(perp, 0.07);
    neckPts[2].copy(base).addScaledVector(ax, 0.68).addScaledVector(perp, -0.045);
    neckPts[3].copy(head);
    neckPts[1].z = base.z + (head.z - base.z) * 0.2;
    neckPts[2].z = base.z + (head.z - base.z) * 0.7;
    neckCurve.updateArcLengths();
    neckLoft.update((t, s) => {
      neckCurve.getPointAt(t, s.center);
      neckCurve.getTangentAt(t, s.tangent);
      s.side.set(0, 0, 1);
      const r = keyed(neckR, t) + bulgeAmt * Math.exp(-(((t - bulgePos) / 0.09) ** 2));
      s.rx = r;
      s.ry = r * 1.04;
    }, { dynamic: true });
  }

  const api = {
    group,
    bodyG,
    headG,
    jawG,
    mats,
    eyes,
    scarfRing,
    helmet,
    glasses,
    setAccessories({ helmet: h = true, glasses: g = false }) {
      helmet.userData.wanted = h;
      glasses.userData.wanted = g;
      helmet.visible = h && !api.pov;
      glasses.visible = g && !api.pov;
    },
    pov: false,
    /** First-person camera sits inside the head: hide everything around the eyes. */
    setPOV(on) {
      api.pov = on;
      helmet.visible = (helmet.userData.wanted ?? true) && !on;
      glasses.visible = (glasses.userData.wanted ?? false) && !on;
      for (const e of eyes) e.visible = !on;
      headG.userData.crest.visible = !on;
    },
    /** Scarf anchor points (world space) at the back of the neck. */
    lateral: new THREE.Vector3(0, 0, 1),
    scarfAnchors(outA, outB) {
      outA.set(0.255, 0.54, -0.012);
      outB.set(0.255, 0.47, 0.012);
      bodyG.localToWorld(outA);
      bodyG.localToWorld(outB);
      api.lateral.set(0, 0, 1).transformDirection(bodyG.matrixWorld);
    },
    mouthWorld(out) {
      out.set(0.22, -0.02, 0);
      return headG.localToWorld(out);
    },
    headWorld(out) {
      out.set(0.02, 0.04, 0);
      return headG.localToWorld(out);
    },
    /**
     * pose: { bob, sway, roll, pitch, squash, headYaw, headPitch, headRoll, headLift, jawOpen,
     *         pouchDepth, pouchBulge, flutter, neckBulge, neckBulgePos, blink,
     *         pedalR, pedalL, ankleR, ankleL, gripR, gripL, spreadL, spreadR, waveR, waveT, standUp, tailWag }
     */
    update(pose) {
      // body
      bodyG.position.set(S.x + (pose.lean || 0) * 0.02, S.y + pose.bob + pose.standUp * 0.09, S.z + pose.sway);
      bodyG.rotation.set(pose.roll, 0, pose.pitch - pose.standUp * 0.12);
      const sq = pose.squash;
      bodyG.scale.set(1 + sq * 0.45, 1 - sq, 1 + sq * 0.45);
      bodyG.updateMatrix();
      bodyG.userData.tail.rotation.y = pose.tailWag;

      // head: stabilised in rig space, then converted into body space
      headRig.set(S.x + HEAD_BASE.x, S.y + HEAD_BASE.y + pose.headLift + pose.standUp * 0.06, 0);
      headRig.x += Math.sin(pose.headYaw) * 0.03 + pose.headForward;
      headRig.z += Math.sin(pose.headYaw) * 0.05;
      invBody.copy(bodyG.matrix).invert();
      headLocal.copy(headRig).applyMatrix4(invBody);
      headG.position.copy(headLocal);
      euler.set(pose.headRoll, pose.headYaw, pose.headPitch, 'YZX');
      desiredHeadQ.setFromEuler(euler);
      bodyQ.copy(bodyG.quaternion).invert();
      headG.quaternion.copy(bodyQ).multiply(desiredHeadQ);
      jawG.rotation.z = -pose.jawOpen;
      updatePouch(pose.pouchDepth, pose.pouchBulge, pose.flutter);
      for (const e of eyes) e.scale.y = pose.blink;
      updateNeck(NECK_BASE, headLocal, pose.neckBulge, pose.neckBulgePos);

      // wings
      for (const w of wings) {
        const s = w.side;
        w.shoulder.copy(SHOULDER).setZ(SHOULDER.z * s).applyMatrix4(bodyG.matrix);
        const grip = s > 0 ? pose.gripR : pose.gripL;
        let spread = s > 0 ? pose.spreadR : pose.spreadL;
        w.target.copy(grip).add(tmpV.set(0.0, 0.042, -0.02 * s));
        w.handTarget.copy(grip).add(tmpV.set(0.025, -0.04, 0.03 * s));
        const flap = Math.sin((pose.flapT || 0) * 13) * 0.1;
        spreadTarget.copy(w.shoulder).add(tmpV.set(-0.07, 0.24 + flap, 0.36 * s));
        if (s > 0 && pose.waveR > 0) {
          const k = pose.waveR;
          const wig = Math.sin(pose.waveT * 11) * 0.09;
          tmpV2.copy(w.shoulder).add(tmpV.set(0.14, 0.33, 0.2 + wig));
          w.target.lerp(tmpV2, k);
          w.handTarget.lerp(tmpV2.add(tmpV.set(0.02 + wig * 0.3, 0.24, 0.06 + wig * 1.4)), k);
          spread = Math.max(spread, k * 0.35);
        }
        if (spread > 0) {
          w.target.lerp(spreadTarget, spread);
          tmpV2.copy(spreadTarget).add(tmpV.set(-0.07, 0.16 + flap * 1.6, 0.26 * s));
          w.handTarget.lerp(tmpV2, spread);
        }
        poleArm.set(-0.35 - spread * 0.3, -0.25 + spread * 0.6, 1 * s).normalize();
        solveTwoBone(w.shoulder, w.target, WING.upper, WING.fore, poleArm, w.elbow, w.wrist);
        hint.set(-0.45 - spread * 0.6, -1 + spread * 1.0, 0).normalize();
        orientSegment(w.upper, w.shoulder, w.elbow, hint);
        orientSegment(w.fore, w.elbow, w.wrist, hint);
        const handHint = tmpV2.set(-spread, 0, s * (1 - spread)).normalize();
        orientSegment(w.hand, w.wrist, w.handTarget, handHint);
        const vs = 1 + spread * 1.1;
        w.foreVaneG.scale.set(vs, 1, 1);
        w.upperVaneG.scale.set(1 + spread * 0.6, 1, 1);
        const fan = lerp(0.2, 0.3, spread);
        const len = lerp(0.85, 1.9, spread);
        for (let i = 0; i < w.primaries.length; i++) {
          const f = w.primaries[i];
          f.rotation.set(0, 0, (i - 2) * fan * (s > 0 ? 1 : 1));
          f.scale.set(1, len * (1 - Math.abs(i - 1.5) * 0.07), 1);
        }
      }

      // legs
      for (const l of legs) {
        const s = l.side;
        l.hip.copy(HIP).setZ(HIP.z * s).applyMatrix4(bodyG.matrix);
        const pedal = s > 0 ? pose.pedalR : pose.pedalL;
        const ankleRot = s > 0 ? pose.ankleR : pose.ankleL;
        l.target.copy(pedal).add(tmpV.set(-0.018, 0.052, 0.004 * s));
        poleLeg.set(1, 0.05, 0.22 * s).normalize();
        solveTwoBone(l.hip, l.target, LEG.thigh, LEG.shin, poleLeg, l.kneeP, l.ankle);
        hint.set(1, 0, 0);
        orientSegment(l.thigh, l.hip, l.kneeP, hint);
        orientSegment(l.shin, l.kneeP, l.ankle, hint);
        l.knee.position.copy(l.kneeP);
        l.kneeCap.position.copy(l.kneeP);
        l.foot.position.copy(l.ankle);
        l.foot.rotation.set(0, -0.12 * s, ankleRot);
      }
    },
  };
  return api;
}

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { damp, dampFactor, easeInOutCubic, clamp } from './lib/math.js';

const V = () => new THREE.Vector3();
const SHOTS = ['sideTrack', 'frontLow', 'faceClose', 'drone', 'wheel', 'flyby', 'wide', 'overhead', 'rearLow'];
export const SHOT_LABELS = {
  sideTrack: '侧面跟拍',
  frontLow: '正面低机位',
  faceClose: '面部特写',
  drone: '无人机环绕',
  wheel: '传动特写',
  flyby: '路边掠过',
  wide: '远景长焦',
  overhead: '俯视',
  rearLow: '尾随低角度',
};

export function createCameraDirector(camera, dom, rider, island) {
  const controls = new OrbitControls(camera, dom);
  controls.enabled = false;
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minDistance = 1.6;
  controls.maxDistance = 45;
  controls.maxPolarAngle = Math.PI * 0.495;
  controls.enablePan = false;

  let mode = 'chase';
  const cur = { pos: V(), look: V(), fov: 50 };
  const want = { pos: V(), look: V(), fov: 50 };
  const blend = { t: 1, dur: 1.1, pos: V(), look: V() };
  const intro = { active: false, t: 0, dur: 6.5, from: V(), fromLook: V() };
  const shot = { name: 'sideTrack', t: 0, dur: 7, fixed: V(), bag: [], onChange: null };
  const fS = V().set(1, 0, 0);
  const fH = V();
  const rH = V();
  const up = new THREE.Vector3(0, 1, 0);
  const p = V();
  const head = V();
  const headDir = V();
  const lastRig = V();
  const orbitOffset = new THREE.Vector3(0, 1, 0);
  const tmp = V();
  const outPos = V();
  const outLook = V();
  const m4 = new THREE.Matrix4();
  let shake = 0;
  let reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

  function frame(dt) {
    p.copy(rider.rig.position);
    fH.copy(rider.forward).setY(0).normalize();
    fS.lerp(fH, dampFactor(2.2, dt)).normalize();
    rH.set(-fS.z, 0, fS.x);
    rider.pelican.headWorld(head);
    m4.extractRotation(rider.pelican.headG.matrixWorld);
    headDir.set(1, 0, 0).applyMatrix4(m4).normalize();
  }

  function nextShot() {
    if (!shot.bag.length) {
      shot.bag = SHOTS.slice().sort(() => Math.random() - 0.5);
      if (shot.bag[shot.bag.length - 1] === shot.name) shot.bag.unshift(shot.bag.pop());
    }
    shot.name = shot.bag.pop();
    shot.t = 0;
    shot.dur = shot.name === 'flyby' ? 6 : shot.name === 'faceClose' || shot.name === 'wheel' ? 5.5 : 7;
    const speed = Math.max(rider.state.speed, 2);
    if (shot.name === 'flyby') {
      const lead = clamp(speed * 3.2, 12, 30);
      shot.fixed.copy(p).addScaledVector(fH, lead).addScaledVector(rH, -4.2);
      shot.fixed.y = island.heightAt(shot.fixed.x, shot.fixed.z) + 1.4;
    } else if (shot.name === 'wide') {
      shot.fixed.copy(p).addScaledVector(fH, speed * 3).addScaledVector(rH, 42).add(tmp.set(0, 13, 0));
    }
    shot.onChange?.(shot.name);
  }

  function computeShot(dt) {
    shot.t += dt;
    if (shot.t > shot.dur) nextShot();
    const k = shot.t / shot.dur;
    switch (shot.name) {
      case 'sideTrack':
        want.pos.copy(p).addScaledVector(rH, 3.3).addScaledVector(fS, -0.9 + 1.8 * k).addScaledVector(up, 0.95);
        want.look.copy(p).addScaledVector(up, 1.0).addScaledVector(fS, 0.25);
        want.fov = 44;
        break;
      case 'frontLow':
        want.pos.copy(p).addScaledVector(fS, 4.4 - k * 0.8).addScaledVector(rH, 0.7).addScaledVector(up, 0.42);
        want.look.copy(p).addScaledVector(up, 1.2);
        want.fov = 42;
        break;
      case 'faceClose':
        want.pos.copy(head).addScaledVector(fS, 1.05).addScaledVector(rH, 0.7 - k * 0.3).addScaledVector(up, 0.08);
        want.look.copy(head).addScaledVector(fS, 0.22).addScaledVector(up, -0.04);
        want.fov = 30;
        break;
      case 'drone': {
        const a = shot.t * 0.35;
        tmp.copy(fS).applyAxisAngle(up, a);
        want.pos.copy(p).addScaledVector(tmp, 16 - k * 5).addScaledVector(up, 19 - k * 7);
        want.look.copy(p).addScaledVector(up, 0.8);
        want.fov = 48;
        break;
      }
      case 'wheel':
        want.pos.copy(p).addScaledVector(rH, 1.15).addScaledVector(up, 0.38).addScaledVector(fS, -0.35 + k * 0.3);
        want.look.copy(p).addScaledVector(up, 0.36).addScaledVector(fS, -0.05);
        want.fov = 40;
        break;
      case 'flyby':
        want.pos.copy(shot.fixed);
        want.look.copy(p).addScaledVector(up, 1.0);
        want.fov = 38;
        break;
      case 'wide':
        want.pos.copy(shot.fixed).addScaledVector(fS, rider.state.speed * shot.t * 0.6);
        want.look.copy(p).addScaledVector(up, 1.0);
        want.fov = 22;
        break;
      case 'overhead':
        want.pos.copy(p).addScaledVector(up, 8 - k * 2).addScaledVector(fS, 0.6).addScaledVector(rH, 0.4);
        want.look.copy(p).addScaledVector(up, 0.6).addScaledVector(fS, 0.4);
        want.fov = 50;
        break;
      case 'rearLow':
        want.pos.copy(p).addScaledVector(fS, -2.7).addScaledVector(up, 0.55).addScaledVector(rH, 0.35);
        want.look.copy(p).addScaledVector(up, 1.05).addScaledVector(fS, 3);
        want.fov = 56;
        break;
    }
  }

  function computeMode(dt) {
    if (mode === 'chase') {
      const lagP = 1 / 3.2;
      const lagL = 1 / 7;
      want.pos.copy(p).addScaledVector(fS, -4.3).addScaledVector(up, 1.9).addScaledVector(rH, 0.95).addScaledVector(rider.velocity, lagP);
      want.look.copy(p).addScaledVector(up, 1.15).addScaledVector(fS, 1.7).addScaledVector(rider.velocity, lagL);
      want.fov = reduced ? 52 : 50 + rider.state.speed * 0.9;
      cur.pos.lerp(want.pos, dampFactor(3.2, dt));
      cur.look.lerp(want.look, dampFactor(7, dt));
    } else if (mode === 'cinematic') {
      computeShot(dt);
      cur.pos.copy(want.pos);
      cur.look.copy(want.look);
    } else if (mode === 'pov') {
      want.pos.copy(head).addScaledVector(up, 0.06).addScaledVector(headDir, -0.01);
      tmp.copy(headDir).lerp(rider.forward, 0.55).normalize();
      want.look.copy(want.pos).addScaledVector(tmp, 6).addScaledVector(up, -0.6);
      want.fov = 74;
      cur.pos.copy(want.pos);
      cur.look.lerp(want.look, dampFactor(10, dt));
    }
    cur.fov = damp(cur.fov, want.fov, mode === 'cinematic' ? 30 : 3, dt);
  }

  function clampAboveGround(v) {
    const g = Math.max(island.heightAt(v.x, v.z), 0) + 0.35;
    if (v.y < g) v.y = g;
  }

  const api = {
    controls,
    get mode() {
      return mode;
    },
    get shotName() {
      return shot.name;
    },
    set onShotChange(fn) {
      shot.onChange = fn;
    },
    setReducedMotion(v) {
      reduced = v;
    },
    setMode(m) {
      if (m === mode) return;
      blend.pos.copy(camera.position);
      tmp.set(0, 0, -1).applyQuaternion(camera.quaternion);
      blend.look.copy(camera.position).addScaledVector(tmp, 5);
      blend.t = 0;
      blend.dur = m === 'pov' || mode === 'pov' ? 0.8 : 1.1;
      if (mode === 'orbit') controls.enabled = false;
      mode = m;
      rider.pelican.setPOV(m === 'pov');
      if (m === 'orbit') {
        orbitOffset.set(0, 1, 0);
        controls.target.copy(p).add(orbitOffset);
        controls.enabled = true;
        blend.t = 1;
      }
      if (m === 'cinematic') {
        shot.bag = [];
        nextShot();
      }
      if (m === 'chase') {
        cur.pos.copy(camera.position);
        cur.look.copy(blend.look);
      }
    },
    startIntro() {
      frame(0);
      fS.copy(fH);
      rH.set(-fS.z, 0, fS.x);
      intro.active = true;
      intro.t = 0;
      intro.from.copy(p).addScaledVector(rH, 70).addScaledVector(fH, 60).add(tmp.set(0, 48, 0));
      intro.fromLook.set(0, 12, 0);
      camera.position.copy(intro.from);
      camera.lookAt(intro.fromLook);
    },
    get introActive() {
      return intro.active;
    },
    skipIntro() {
      intro.t = intro.dur;
    },
    kick(amount) {
      shake = Math.max(shake, reduced ? 0 : amount);
    },
    /** Orbit mode: keep looking at a point given relative to the rider position. */
    setOrbitTarget(worldPoint) {
      orbitOffset.subVectors(worldPoint, p);
      controls.target.copy(worldPoint);
    },
    update(dt, time) {
      frame(dt);
      if (intro.active) {
        intro.t += dt;
        const k = easeInOutCubic(clamp(intro.t / intro.dur, 0, 1));
        computeModeForIntro();
        outPos.copy(intro.from).lerp(want.pos, k);
        outPos.y += Math.sin(k * Math.PI) * 6;
        outLook.copy(intro.fromLook).lerp(want.look, easeInOutCubic(clamp(intro.t / (intro.dur * 0.7), 0, 1)));
        clampAboveGround(outPos);
        camera.position.copy(outPos);
        camera.lookAt(outLook);
        camera.fov = 50;
        if (intro.t >= intro.dur) {
          intro.active = false;
          cur.pos.copy(outPos);
          cur.look.copy(outLook);
        }
      } else if (mode === 'orbit') {
        tmp.subVectors(p, lastRig);
        camera.position.add(tmp);
        controls.target.copy(p).add(orbitOffset);
        controls.update();
        clampAboveGround(camera.position);
        camera.fov = damp(camera.fov, 50, 3, dt);
      } else {
        computeMode(dt);
        outPos.copy(cur.pos);
        outLook.copy(cur.look);
        if (blend.t < 1) {
          blend.t = Math.min(1, blend.t + dt / blend.dur);
          const k = easeInOutCubic(blend.t);
          outPos.lerpVectors(blend.pos, cur.pos, k);
          outLook.lerpVectors(blend.look, cur.look, k);
        }
        if (mode !== 'pov') clampAboveGround(outPos);
        camera.position.copy(outPos);
        camera.lookAt(outLook);
        camera.fov = cur.fov;
      }
      if (shake > 0.0005) {
        camera.position.x += (Math.random() - 0.5) * shake;
        camera.position.y += (Math.random() - 0.5) * shake;
        shake *= Math.exp(-dt * 9);
      }
      const near = mode === 'pov' && !intro.active ? 0.02 : 0.1;
      if (camera.near !== near) camera.near = near;
      camera.updateProjectionMatrix();
      lastRig.copy(p);
    },
  };

  function computeModeForIntro() {
    want.pos.copy(p).addScaledVector(fS, -4.3).addScaledVector(up, 1.9).addScaledVector(rH, 0.95);
    want.look.copy(p).addScaledVector(up, 1.15).addScaledVector(fS, 1.7);
  }

  return api;
}

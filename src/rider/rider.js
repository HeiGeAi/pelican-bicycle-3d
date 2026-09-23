import * as THREE from 'three';
import { createBicycle, BIKE } from './bicycle.js';
import { createPelican } from './pelican.js';
import { createScarf } from './scarf.js';
import { createFishGeometry, fishMaterial } from '../lib/models.js';
import { clamp, damp, lerp, smoothstep, bump, TAU, wrapAngle } from '../lib/math.js';

export const LANE_OFFSET = 1.25;
const FLY_T = 0.78;
const G = 9.81;

export function createRider(scene, road) {
  const rig = new THREE.Group();
  rig.name = 'rider';
  scene.add(rig);
  const bike = createBicycle();
  rig.add(bike.group);
  const pelican = createPelican();
  rig.add(pelican.group);
  const scarf = createScarf();
  scene.add(scarf.group);
  scarf.attach(pelican.bodyG);

  const flyFish = new THREE.Mesh(createFishGeometry(), fishMaterial());
  flyFish.scale.setScalar(0.19);
  flyFish.visible = false;
  flyFish.castShadow = true;
  rig.add(flyFish);

  const listeners = {};
  const emit = (type, detail) => (listeners[type] || []).forEach((fn) => fn(detail));

  const st = {
    s: 40,
    speed: 0,
    targetSpeed: 5,
    wheelAngle: 0,
    crank: 0,
    crankOmega: 0,
    pedaling: true,
    lean: 0,
    steer: 0,
    hopY: 0,
    hopV: 0,
    airborne: false,
    squash: 0,
    squashV: 0,
    wheelie: 0,
    spread: 0,
    standUp: 0,
    laps: 0,
    distance: 0,
    fishEaten: 0,
    basketLeft: bike.fishInBasket.length,
    refillT: -1,
    feedT: -1,
    caught: false,
    gulped: false,
    clapped: false,
    waveT: -1,
    bellT: 1,
    blinkT: 1,
    nextBlink: 2.5,
    look: { yaw: 0, pitch: 0, ty: 0, tp: -0.08, timer: 3, mode: 'road' },
    effort: 0.5,
    flutterPhase: 0,
    pantT: 0,
    time: 0,
  };

  const sample = { pos: new THREE.Vector3(), tangent: new THREE.Vector3(), right: new THREE.Vector3(), curvature: 0, slope: 0 };
  const fwd = new THREE.Vector3();
  const up = new THREE.Vector3();
  const right = new THREE.Vector3();
  const up0 = new THREE.Vector3(0, 1, 0);
  const basis = new THREE.Matrix4();
  const baseQ = new THREE.Quaternion();
  const pitchQ = new THREE.Quaternion();
  const zAxis = new THREE.Vector3(0, 0, 1);
  const tmp = new THREE.Vector3();
  const tmp2 = new THREE.Vector3();
  const camLocal = new THREE.Vector3();
  const velocity = new THREE.Vector3();
  const ambientWind = new THREE.Vector3(1.4, 0, 0.8);
  const wind = new THREE.Vector3();
  const fishStart = new THREE.Vector3();
  const mouth = new THREE.Vector3();

  const pose = {
    bob: 0, sway: 0, roll: 0, pitch: 0, squash: 0, lean: 0,
    headYaw: 0, headPitch: -0.1, headRoll: 0, headLift: 0, headForward: 0,
    jawOpen: 0, pouchDepth: 0.075, pouchBulge: 0, flutter: 0, neckBulge: 0, neckBulgePos: 1, blink: 1,
    pedalR: bike.pedalR, pedalL: bike.pedalL, ankleR: 0, ankleL: 0,
    gripR: bike.gripR, gripL: bike.gripL,
    spreadL: 0, spreadR: 0, waveR: 0, waveT: 0, standUp: 0, tailWag: 0,
  };

  function pickLook(cameraLocal) {
    const r = Math.random();
    const L = st.look;
    if (r < 0.42) {
      L.mode = 'road';
      L.ty = (Math.random() - 0.5) * 0.2;
      L.tp = -0.1;
      L.timer = 2.5 + Math.random() * 3.5;
    } else if (r < 0.64) {
      L.mode = 'camera';
      L.timer = 1.4 + Math.random() * 1.6;
    } else if (r < 0.8) {
      L.mode = 'sea';
      L.ty = -0.75 - Math.random() * 0.25;
      L.tp = -0.05 + Math.random() * 0.1;
      L.timer = 1.8 + Math.random() * 2;
    } else if (r < 0.92) {
      L.mode = 'island';
      L.ty = 0.6 + Math.random() * 0.3;
      L.tp = 0.05;
      L.timer = 1.5 + Math.random() * 2;
    } else {
      L.mode = 'sky';
      L.ty = (Math.random() - 0.5) * 0.6;
      L.tp = 0.45;
      L.timer = 1.5 + Math.random() * 1.5;
    }
    if (L.mode === 'camera') aimAt(cameraLocal);
  }

  function aimAt(local) {
    const hx = local.x - 0.1;
    const hy = local.y - 1.75;
    const hz = local.z;
    st.look.ty = clamp(Math.atan2(-hz, Math.max(0.2, hx) + Math.abs(hz) * 0.15), -1.15, 1.15);
    st.look.tp = clamp(Math.atan2(hy, Math.hypot(hx, hz)), -0.35, 0.5);
  }

  const api = {
    rig,
    bike,
    pelican,
    scarf,
    state: st,
    forward: fwd,
    up,
    right,
    velocity,
    on(type, fn) {
      (listeners[type] ||= []).push(fn);
    },
    setTargetSpeed(ms) {
      st.targetSpeed = clamp(ms, 0, 12);
    },
    hop() {
      if (st.airborne || st.hopY > 0) return false;
      st.hopV = 3.1;
      st.airborne = true;
      st.wheelie = 0.1;
      emit('hop');
      return true;
    },
    feed() {
      if (st.feedT >= 0 || st.basketLeft <= 0) return false;
      st.feedT = 0;
      st.caught = st.gulped = st.clapped = false;
      st.basketLeft--;
      bike.fishInBasket[st.basketLeft].visible = false;
      fishStart.copy(bike.basketPos).add(tmp.set(0.02, 0.12, 0));
      emit('feed');
      if (st.basketLeft === 0) st.refillT = 7;
      return true;
    },
    wave() {
      if (st.waveT >= 0) return false;
      st.waveT = 0;
      emit('wave');
      return true;
    },
    ringBell() {
      st.bellT = 0;
      emit('bell');
    },
    teleport(s) {
      st.s = s;
      scarf.reset();
    },
    update(dt, time, { cameraPos, heat = 0 }) {
      st.time = time;
      // ---- speed & drivetrain ----
      const coasting = st.targetSpeed < st.speed - 0.25 || st.airborne || st.feedT > 0.1 && st.feedT < 0.9;
      const accel = st.targetSpeed > st.speed ? 1.3 : 2.4;
      st.speed = st.speed + clamp(st.targetSpeed - st.speed, -accel * dt, accel * dt);
      if (st.speed < 0.001) st.speed = 0;
      const ds = st.speed * dt;
      const prevS = st.s;
      st.s += ds;
      st.distance += ds;
      if (Math.floor(st.s / road.length) > Math.floor(prevS / road.length)) {
        st.laps++;
        emit('lap', st.laps);
      }
      st.wheelAngle += ds / BIKE.wheelR;
      const matched = st.speed / BIKE.wheelR / BIKE.ratio;
      st.pedaling = !coasting && st.speed > 0.05;
      if (st.pedaling) {
        st.crankOmega = damp(st.crankOmega, matched, 8, dt);
      } else {
        st.crankOmega = damp(st.crankOmega, 0, 6, dt);
        if (st.airborne || st.crankOmega < 0.4) {
          // level the pedals while not pedalling
          const target = Math.round(st.crank / Math.PI) * Math.PI;
          st.crank = damp(st.crank, target, 6, dt);
        }
      }
      st.crank -= st.crankOmega * dt;
      st.effort = damp(st.effort, st.pedaling ? clamp(0.35 + (st.targetSpeed - st.speed) * 0.5 + st.speed * 0.06 + Math.max(0, sample.slope) * 6, 0.2, 1.4) : 0.1, 3, dt);

      // ---- road following ----
      road.sample(st.s, sample);
      const v = st.speed;
      const wob = (0.035 * Math.sin(time * 2.1) + 0.02 * Math.sin(time * 3.7 + 1)) / (1 + v * 0.8);
      const targetLean = clamp(Math.atan((v * v * sample.curvature) / G) * 1.7, -0.5, 0.5) + wob * 0.6;
      st.lean = damp(st.lean, targetLean, 4, dt);
      const targetSteer = clamp(-1.06 * sample.curvature * 1.4 - wob * 1.4, -0.45, 0.45);
      st.steer = damp(st.steer, targetSteer, 6, dt);

      fwd.copy(sample.tangent);
      right.crossVectors(fwd, up0).normalize();
      up.crossVectors(right, fwd).normalize();
      const cl = Math.cos(st.lean);
      const sl = Math.sin(st.lean);
      tmp.copy(up).multiplyScalar(cl).addScaledVector(right, sl);
      tmp2.copy(right).multiplyScalar(cl).addScaledVector(up, -sl);
      up.copy(tmp);
      right.copy(tmp2);
      basis.makeBasis(fwd, up, right);
      baseQ.setFromRotationMatrix(basis);

      // ---- hop physics ----
      if (st.airborne) {
        st.hopV -= G * dt;
        st.hopY += st.hopV * dt;
        if (st.hopY <= 0) {
          const impact = Math.abs(st.hopV);
          st.hopY = 0;
          st.hopV = 0;
          st.airborne = false;
          st.squashV -= impact * 0.9;
          emit('land', impact);
        }
      }
      st.wheelie = damp(st.wheelie, st.airborne ? -0.04 : 0, 3.5, dt);
      const spring = -170 * st.squash - 13 * st.squashV;
      st.squashV += spring * dt;
      st.squash += st.squashV * dt;
      st.squash = clamp(st.squash, -0.12, 0.12);
      pitchQ.setFromAxisAngle(zAxis, st.wheelie);
      rig.quaternion.copy(baseQ).multiply(pitchQ);
      rig.position.copy(sample.pos).addScaledVector(sample.right, LANE_OFFSET).addScaledVector(up0, st.hopY);
      velocity.copy(fwd).multiplyScalar(v).addScaledVector(up0, st.hopV);

      st.spread = damp(st.spread, st.airborne ? 1 : 0, st.airborne ? 12 : 6, dt);
      st.standUp = damp(st.standUp, st.airborne ? 1 : 0, 10, dt);

      // camera in rig space
      rig.updateMatrixWorld();
      camLocal.copy(cameraPos);
      rig.worldToLocal(camLocal);

      // ---- head / look ----
      const L = st.look;
      L.timer -= dt;
      if (L.timer <= 0) pickLook(camLocal);
      if (L.mode === 'camera') aimAt(camLocal);
      let yawT = L.ty;
      let pitchT = L.tp;
      if (st.waveT >= 0) {
        aimAt(camLocal);
        yawT = L.ty;
        pitchT = L.tp;
      }

      // ---- actions ----
      let jaw = 0;
      let pouchBulge = 0;
      let neckBulge = 0;
      let neckPos = 1;
      let headLiftAdd = 0;
      if (st.feedT >= 0) {
        st.feedT += dt;
        const t = st.feedT;
        const up1 = smoothstep(0.0, 0.4, t) * (1 - smoothstep(1.1, 1.6, t));
        pitchT = lerp(pitchT, 0.62, up1);
        yawT = lerp(yawT, 0, up1);
        headLiftAdd = up1 * 0.03;
        if (t < FLY_T) jaw = smoothstep(0.05, 0.45, t) * 0.66;
        else if (t < FLY_T + 0.1) jaw = lerp(0.66, 0, (t - FLY_T) / 0.1);
        if (t >= FLY_T && !st.caught) {
          st.caught = true;
          emit('catch');
        }
        if (t >= FLY_T && t < 1.9) pouchBulge = 0.05 * (1 + 0.35 * Math.sin((t - FLY_T) * 22) * Math.exp(-(t - FLY_T) * 3.2)) * (1 - smoothstep(1.6, 1.9, t));
        if (t >= 1.6 && t < 2.5) {
          const k = (t - 1.6) / 0.9;
          neckBulge = 0.03 * Math.sin(Math.PI * Math.min(1, k * 1.15));
          neckPos = 1 - k;
          if (!st.gulped) {
            st.gulped = true;
            emit('gulp');
          }
        }
        if (t >= 2.5 && t < 3.15) {
          jaw = 0.24 * Math.abs(Math.sin((t - 2.5) * Math.PI * 4.6));
          if (!st.clapped) {
            st.clapped = true;
            st.fishEaten++;
            emit('clap', st.fishEaten);
          }
        }
        if (t > 3.3) st.feedT = -1;
      }
      if (st.refillT > 0) {
        st.refillT -= dt;
        if (st.refillT <= 0) {
          st.basketLeft = bike.fishInBasket.length;
          for (const f of bike.fishInBasket) f.visible = true;
          emit('refill');
        }
      }
      let waveR = 0;
      if (st.waveT >= 0) {
        st.waveT += dt;
        waveR = smoothstep(0, 0.35, st.waveT) * (1 - smoothstep(2.1, 2.5, st.waveT));
        if (st.waveT > 2.5) st.waveT = -1;
      }
      if (st.bellT < 1) {
        st.bellT = Math.min(1, st.bellT + dt / 0.7);
        pitchT += bump(0, 1, st.bellT) * 0.12;
      }
      L.yaw = damp(L.yaw, yawT, st.feedT >= 0 ? 9 : 4.5, dt);
      L.pitch = damp(L.pitch, pitchT, st.feedT >= 0 ? 9 : 4.5, dt);

      // blink
      st.nextBlink -= dt;
      if (st.nextBlink <= 0) {
        st.blinkT = 0;
        st.nextBlink = Math.random() < 0.2 ? 0.3 : 2.2 + Math.random() * 3.5;
      }
      st.blinkT += dt / 0.16;
      const blink = 1 - 0.92 * bump(0, 1, Math.min(st.blinkT, 1));

      // gular flutter when hot or after hard effort
      st.pantT = damp(st.pantT, heat > 0.75 || st.speed > 8.5 ? 1 : 0, 0.5, dt);
      st.flutterPhase += dt * 30;
      const flutter = st.pantT * 0.006 * Math.sin(st.flutterPhase) * (st.feedT >= 0 ? 0 : 1);

      // ---- pose ----
      const th = st.crank;
      const e = st.effort;
      pose.bob = (0.006 * Math.cos(2 * th) - 0.004) * e;
      pose.sway = 0.007 * Math.cos(th) * e;
      pose.roll = 0.04 * Math.cos(th) * e;
      pose.pitch = -0.03 - clamp(v / 12, 0, 1) * 0.07;
      pose.squash = st.squash;
      pose.lean = st.lean;
      pose.headYaw = L.yaw;
      pose.headPitch = L.pitch - 0.1;
      pose.headRoll = -st.lean * 0.85;
      pose.headLift = headLiftAdd + 0.004 * Math.sin(time * 1.3);
      pose.headForward = 0.012 * Math.sin(time * 0.9) + clamp(v / 12, 0, 1) * 0.02;
      pose.jawOpen = jaw;
      pose.pouchDepth = 0.075 + jaw * 0.03;
      pose.pouchBulge = pouchBulge;
      pose.flutter = flutter;
      pose.neckBulge = neckBulge;
      pose.neckBulgePos = neckPos;
      pose.blink = blink;
      pose.ankleR = 0.1 * Math.sin(th) - 0.12;
      pose.ankleL = 0.1 * Math.sin(th + Math.PI) - 0.12;
      pose.spreadL = st.spread;
      pose.spreadR = st.spread;
      pose.waveR = waveR;
      pose.waveT = st.waveT;
      pose.standUp = st.standUp;
      pose.flapT = time;
      pose.tailWag = 0.08 * Math.sin(time * 2.3) + 0.05 * Math.sin(th);

      bike.update({ wheelAngle: st.wheelAngle, crankAngle: st.crank, steer: st.steer, speed: v, night: api.night || 0, time, ankleR: pose.ankleR, ankleL: pose.ankleL, bellT: st.bellT });
      pelican.update(pose);
      rig.updateMatrixWorld(true);

      // flying fish
      if (st.feedT >= 0 && st.feedT < FLY_T) {
        const k = st.feedT / FLY_T;
        pelican.mouthWorld(mouth);
        rig.worldToLocal(mouth);
        flyFish.visible = true;
        flyFish.position.copy(fishStart).lerp(mouth, k);
        flyFish.position.y += 0.55 * 4 * k * (1 - k);
        flyFish.rotation.set(k * 2.4, 0, 1.2 - k * 6.5);
      } else {
        flyFish.visible = false;
      }

      // scarf
      wind.copy(ambientWind).sub(velocity);
      scarf.update(dt, pelican, wind, v);

      st.cadenceRPM = (st.crankOmega * 60) / TAU;
    },
    night: 0,
  };
  return api;
}

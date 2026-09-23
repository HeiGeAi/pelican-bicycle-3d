import * as THREE from 'three';
import { mulberry32 } from './math.js';

function canvas(w, h = w) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function finish(c, { srgb = true, repeat = false, aniso = 8 } = {}) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = aniso;
  t.needsUpdate = true;
  return t;
}

function heightToNormal(src, strength = 2.5) {
  const w = src.width;
  const h = src.height;
  const sctx = src.getContext('2d');
  const hd = sctx.getImageData(0, 0, w, h).data;
  const out = canvas(w, h);
  const octx = out.getContext('2d');
  const img = octx.createImageData(w, h);
  const d = img.data;
  const H = (x, y) => hd[(((y + h) % h) * w + ((x + w) % w)) * 4] / 255;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = (H(x + 1, y) - H(x - 1, y)) * strength;
      const dy = (H(x, y + 1) - H(x, y - 1)) * strength;
      let nx = -dx;
      let ny = dy;
      let nz = 1;
      const len = Math.hypot(nx, ny, nz);
      nx /= len;
      ny /= len;
      nz /= len;
      const k = (y * w + x) * 4;
      d[k] = (nx * 0.5 + 0.5) * 255;
      d[k + 1] = (ny * 0.5 + 0.5) * 255;
      d[k + 2] = (nz * 0.5 + 0.5) * 255;
      d[k + 3] = 255;
    }
  }
  octx.putImageData(img, 0, 0);
  return out;
}

/** Overlapping feather scales → tangent-space normal map (tileable). */
export function featherNormalMap(size = 512) {
  const c = canvas(size);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, size, size);
  const rows = 9;
  const cols = 7;
  const cw = size / cols;
  const rh = size / rows;
  const rand = mulberry32(7);
  const drawFeather = (x, y, sx, sy) => {
    const g = ctx.createRadialGradient(x, y + sy * 0.55, sy * 0.05, x, y, sy * 1.15);
    g.addColorStop(0, 'rgb(235,235,235)');
    g.addColorStop(0.55, 'rgb(170,170,170)');
    g.addColorStop(0.9, 'rgb(70,70,70)');
    g.addColorStop(1, 'rgb(20,20,20)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(x, y, sx, sy, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.22)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, y - sy * 0.9);
    ctx.lineTo(x, y + sy * 0.9);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(0,0,0,0.12)';
    for (let k = -4; k <= 4; k++) {
      ctx.beginPath();
      ctx.moveTo(x, y + k * sy * 0.18);
      ctx.lineTo(x + sx * 0.9, y + k * sy * 0.18 + sy * 0.3);
      ctx.moveTo(x, y + k * sy * 0.18);
      ctx.lineTo(x - sx * 0.9, y + k * sy * 0.18 + sy * 0.3);
      ctx.stroke();
    }
  };
  for (let r = -1; r <= rows; r++) {
    for (let col = -1; col <= cols; col++) {
      const x = (col + (r & 1) * 0.5) * cw + (rand() - 0.5) * cw * 0.15;
      const y = r * rh;
      const sx = cw * (0.62 + rand() * 0.08);
      const sy = rh * (1.05 + rand() * 0.15);
      for (const ox of [-size, 0, size]) {
        for (const oy of [-size, 0, size]) {
          if (x + ox < -cw * 1.5 || x + ox > size + cw * 1.5 || y + oy < -rh * 1.5 || y + oy > size + rh * 1.5) continue;
          drawFeather(x + ox, y + oy, sx, sy);
        }
      }
    }
  }
  return finish(heightToNormal(c, 3.0), { srgb: false, repeat: true });
}

/** Road: asphalt + lane markings. u across the road, v along it (tile = 8 m). */
export function roadTexture() {
  const w = 256;
  const h = 1024;
  const c = canvas(w, h);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#4a4c50';
  ctx.fillRect(0, 0, w, h);
  const rand = mulberry32(11);
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  for (let i = 0; i < w * h; i++) {
    const n = (rand() - 0.5) * 38 + (rand() < 0.02 ? 40 : 0);
    d[i * 4] += n;
    d[i * 4 + 1] += n;
    d[i * 4 + 2] += n * 1.05;
  }
  ctx.putImageData(img, 0, 0);
  // tyre polish in each lane
  for (const u of [0.28, 0.72]) {
    const g = ctx.createLinearGradient((u - 0.12) * w, 0, (u + 0.12) * w, 0);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(0.5, 'rgba(0,0,0,0.16)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect((u - 0.12) * w, 0, 0.24 * w, h);
  }
  // patches
  for (let i = 0; i < 6; i++) {
    ctx.fillStyle = `rgba(${rand() < 0.5 ? '20,20,24' : '90,92,96'},0.18)`;
    ctx.fillRect(rand() * w * 0.8, rand() * h, 20 + rand() * 60, 30 + rand() * 120);
  }
  ctx.fillStyle = '#f3efe4';
  ctx.fillRect(w * 0.055, 0, 6, h);
  ctx.fillRect(w * 0.945 - 6, 0, 6, h);
  ctx.fillStyle = '#f5c542';
  ctx.fillRect(w * 0.5 - 7, 0, 5, h * 0.5);
  ctx.fillRect(w * 0.5 + 2, 0, 5, h * 0.5);
  return finish(c, { repeat: true, aniso: 16 });
}

/** Basket weave (tileable). */
export function wickerTexture() {
  const s = 256;
  const c = canvas(s);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#5a3a1c';
  ctx.fillRect(0, 0, s, s);
  const rows = 12;
  const cols = 8;
  const rh = s / rows;
  const cw = s / cols;
  for (let r = 0; r < rows; r++) {
    for (let k = 0; k < cols; k++) {
      const over = (r + k) % 2 === 0;
      const x = k * cw;
      const y = r * rh;
      const g = ctx.createLinearGradient(0, y, 0, y + rh);
      const base = over ? [214, 170, 106] : [176, 132, 74];
      g.addColorStop(0, `rgb(${base[0] - 40},${base[1] - 40},${base[2] - 30})`);
      g.addColorStop(0.5, `rgb(${base[0]},${base[1]},${base[2]})`);
      g.addColorStop(1, `rgb(${base[0] - 50},${base[1] - 50},${base[2] - 35})`);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.roundRect(x + 1, y + 1, cw - 2, rh - 2, rh * 0.45);
      ctx.fill();
    }
  }
  ctx.fillStyle = 'rgba(60,35,12,0.55)';
  for (let k = 0; k < cols; k++) ctx.fillRect(k * cw - 2, 0, 4, s);
  return finish(c, { repeat: true });
}

/** Knitted scarf: red with cream stripes. */
export function knitTexture() {
  const w = 128;
  const h = 256;
  const c = canvas(w, h);
  const ctx = c.getContext('2d');
  const stripe = (y0, y1, col) => {
    ctx.fillStyle = col;
    ctx.fillRect(0, y0, w, y1 - y0);
  };
  stripe(0, h, '#c8262c');
  for (const y of [40, 64, 150, 174]) stripe(y, y + 12, '#f4ead7');
  ctx.strokeStyle = 'rgba(0,0,0,0.18)';
  ctx.lineWidth = 1.5;
  for (let y = 0; y < h; y += 8) {
    for (let x = 0; x < w; x += 10) {
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + 5, y + 7);
      ctx.lineTo(x + 10, y);
      ctx.stroke();
    }
  }
  return finish(c, { repeat: true });
}

/** Soft radial sprite. */
export function glowTexture(size = 128, inner = 'rgba(255,255,255,1)', mid = 'rgba(255,255,255,0.35)') {
  const c = canvas(size);
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, inner);
  g.addColorStop(0.25, mid);
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return finish(c, { srgb: false });
}

/** Tileable value-noise detail map (values ≈ 0.72 – 1.0), linear. */
export function detailNoiseTexture(size = 256, seed = 3) {
  const rand = mulberry32(seed);
  const c = canvas(size);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  const acc = new Float32Array(size * size);
  let amp = 1;
  let norm = 0;
  for (let cells = 8; cells <= 128; cells *= 2) {
    const grid = new Float32Array(cells * cells).map(() => rand());
    const step = size / cells;
    for (let y = 0; y < size; y++) {
      const gy = y / step;
      const y0 = Math.floor(gy) % cells;
      const y1 = (y0 + 1) % cells;
      let fy = gy - Math.floor(gy);
      fy = fy * fy * (3 - 2 * fy);
      for (let x = 0; x < size; x++) {
        const gx = x / step;
        const x0 = Math.floor(gx) % cells;
        const x1 = (x0 + 1) % cells;
        let fx = gx - Math.floor(gx);
        fx = fx * fx * (3 - 2 * fx);
        const a = grid[y0 * cells + x0];
        const b = grid[y0 * cells + x1];
        const cc = grid[y1 * cells + x0];
        const dd = grid[y1 * cells + x1];
        acc[y * size + x] += amp * ((a * (1 - fx) + b * fx) * (1 - fy) + (cc * (1 - fx) + dd * fx) * fy);
      }
    }
    norm += amp;
    amp *= 0.55;
  }
  for (let i = 0; i < size * size; i++) {
    const v = 0.72 + 0.28 * (acc[i] / norm);
    const b = Math.round(v * 255);
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = b;
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return finish(c, { srgb: false, repeat: true });
}

/** Down-tube decal, text left → right along u. */
export function decalTexture(text = 'PELICAN', sub = '鹈鹕号') {
  const w = 1024;
  const h = 96;
  const c = canvas(w, h);
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, w, h);
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.fillStyle = '#fff8e7';
  ctx.font = 'italic 900 76px "Arial Black", "Segoe UI", sans-serif';
  ctx.fillText(text, 40, h / 2 + 4);
  const tw = ctx.measureText(text).width;
  ctx.fillStyle = '#ffcf85';
  ctx.font = '800 58px "PingFang SC", "Microsoft YaHei", sans-serif';
  ctx.fillText(sub, 40 + tw + 34, h / 2 + 3);
  return finish(c);
}

/** Wooden sign with text. */
export function signTexture(lines = ['鹈鹕岛', 'PELICAN ISLE'], bg = '#8a5a33') {
  const w = 512;
  const h = 256;
  const c = canvas(w, h);
  const ctx = c.getContext('2d');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);
  const rand = mulberry32(5);
  for (let i = 0; i < 40; i++) {
    ctx.strokeStyle = `rgba(40,20,5,${0.1 + rand() * 0.15})`;
    ctx.lineWidth = 1 + rand() * 2;
    const y = rand() * h;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.bezierCurveTo(w * 0.3, y + (rand() - 0.5) * 20, w * 0.6, y + (rand() - 0.5) * 20, w, y + (rand() - 0.5) * 10);
    ctx.stroke();
  }
  ctx.strokeStyle = '#f7e7c6';
  ctx.lineWidth = 8;
  ctx.strokeRect(14, 14, w - 28, h - 28);
  ctx.fillStyle = '#fff4dc';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = '900 96px "PingFang SC", "Microsoft YaHei", sans-serif';
  ctx.fillText(lines[0], w / 2, h * 0.42);
  ctx.font = '700 40px "Segoe UI", Arial, sans-serif';
  ctx.fillStyle = '#ffd08a';
  ctx.fillText(lines[1], w / 2, h * 0.76);
  return finish(c);
}

/**
 * Procedural backgrounds, one per scene theme. Everything is drawn with canvas
 * paths: no images, no network. `t` is seconds since the scene appeared and is
 * frozen at 0 under reduced motion.
 */
import type { Scene, SceneTheme } from '@/core/schemas';
import { seededRandom } from '../shuffle';
import { cloudPath, roundedRectPath, starPath } from './shapes';

type Ctx = CanvasRenderingContext2D;

/** Top and bottom colours of each theme's base gradient. */
export const THEME_GRADIENTS: Record<SceneTheme, [string, string]> = {
  space: ['#0b1033', '#2d1b69'],
  ocean: ['#8fdcf7', '#0b5fa5'],
  forest: ['#bfe9ff', '#e4f7d6'],
  lab: ['#f2f6fc', '#dbe6f4'],
  city: ['#ffd9a8', '#ff9f8a'],
  farm: ['#9fdcff', '#e3f6ff'],
  sky: ['#62b8ff', '#d4eeff'],
  desert: ['#ffe5ad', '#ffbf73'],
  arctic: ['#bfe6ff', '#f3fbff'],
  workshop: ['#f8e8cc', '#efd3a7'],
  jungle: ['#0f6b4a', '#7fd08a'],
  castle: ['#c9b8ff', '#ffe1ec'],
  kitchen: ['#fff3dd', '#ffe2b8'],
  playground: ['#8fd3ff', '#e2f5ff'],
  plain: ['#fbfaff', '#e9e4ff'],
};

/** Whether the theme is dark, so captions and outlines can adapt. */
export function themeIsDark(theme: SceneTheme): boolean {
  return theme === 'space' || theme === 'jungle';
}

function fillGradient(ctx: Ctx, w: number, h: number, top: string, bottom: string): void {
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, top);
  g.addColorStop(1, bottom);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
}

/** A band of rolling hills from `baseY` to the bottom. */
function hills(ctx: Ctx, w: number, h: number, baseY: number, amp: number, color: string, seed: number, shift = 0): void {
  const rand = seededRandom(seed);
  const f1 = 1.2 + rand() * 1.5;
  const f2 = 2.5 + rand() * 2;
  const o1 = rand() * 6;
  const o2 = rand() * 6;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(0, h);
  for (let x = 0; x <= w; x += Math.max(4, w / 60)) {
    const k = x / w;
    const y = baseY - Math.sin(k * Math.PI * f1 + o1 + shift) * amp - Math.sin(k * Math.PI * f2 + o2) * amp * 0.35;
    ctx.lineTo(x, y);
  }
  ctx.lineTo(w, h);
  ctx.closePath();
  ctx.fill();
}

function ground(ctx: Ctx, w: number, h: number, topY: number, color: string): void {
  ctx.fillStyle = color;
  ctx.fillRect(0, topY, w, h - topY);
}

function sun(ctx: Ctx, x: number, y: number, r: number, t: number, color = '#ffd54a'): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(t * 0.15);
  ctx.strokeStyle = 'rgba(255, 213, 74, 0.55)';
  ctx.lineWidth = Math.max(2, r * 0.16);
  ctx.lineCap = 'round';
  for (let i = 0; i < 10; i += 1) {
    const a = (i * Math.PI * 2) / 10;
    ctx.beginPath();
    ctx.moveTo(Math.cos(a) * r * 1.3, Math.sin(a) * r * 1.3);
    ctx.lineTo(Math.cos(a) * r * 1.7, Math.sin(a) * r * 1.7);
    ctx.stroke();
  }
  ctx.restore();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

function cloud(ctx: Ctx, x: number, y: number, width: number, alpha = 0.9): void {
  ctx.fillStyle = `rgba(255, 255, 255, ${alpha})`;
  cloudPath(ctx, x, y, width, width * 0.5);
  ctx.fill();
}

/** Clouds that drift to the right and wrap around. */
function driftingClouds(ctx: Ctx, w: number, h: number, t: number, count: number, seed: number, band = 0.45): void {
  const rand = seededRandom(seed);
  for (let i = 0; i < count; i += 1) {
    const width = w * (0.16 + rand() * 0.14);
    const speed = w * (0.008 + rand() * 0.012);
    const span = w + width * 2;
    const x = ((rand() * span + t * speed) % span) - width;
    const y = h * (0.08 + rand() * band);
    cloud(ctx, x, y, width, 0.75 + rand() * 0.2);
  }
}

function pine(ctx: Ctx, x: number, baseY: number, height: number, color: string): void {
  ctx.fillStyle = '#7a5230';
  ctx.fillRect(x - height * 0.05, baseY - height * 0.2, height * 0.1, height * 0.2);
  ctx.fillStyle = color;
  for (let i = 0; i < 3; i += 1) {
    const top = baseY - height + i * height * 0.24;
    const half = height * (0.2 + i * 0.07);
    ctx.beginPath();
    ctx.moveTo(x, top);
    ctx.lineTo(x + half, top + height * 0.4);
    ctx.lineTo(x - half, top + height * 0.4);
    ctx.closePath();
    ctx.fill();
  }
}

function roundTree(ctx: Ctx, x: number, baseY: number, height: number, color: string): void {
  ctx.fillStyle = '#7a5230';
  ctx.fillRect(x - height * 0.06, baseY - height * 0.45, height * 0.12, height * 0.45);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, baseY - height * 0.62, height * 0.34, 0, Math.PI * 2);
  ctx.arc(x - height * 0.22, baseY - height * 0.48, height * 0.24, 0, Math.PI * 2);
  ctx.arc(x + height * 0.22, baseY - height * 0.48, height * 0.24, 0, Math.PI * 2);
  ctx.fill();
}

function drawSpace(ctx: Ctx, w: number, h: number, t: number): void {
  const rand = seededRandom(11);
  for (let i = 0; i < 70; i += 1) {
    const x = rand() * w;
    const y = rand() * h;
    const r = 0.6 + rand() * 1.6;
    const twinkle = 0.45 + 0.55 * Math.abs(Math.sin(t * (0.6 + rand() * 1.6) + rand() * 6));
    ctx.fillStyle = `rgba(255, 255, 255, ${twinkle.toFixed(3)})`;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  // A few bigger sparkle stars.
  for (let i = 0; i < 5; i += 1) {
    const x = rand() * w;
    const y = rand() * h * 0.7;
    const pulse = 0.6 + 0.4 * Math.sin(t * 1.3 + i * 1.7);
    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = `rgba(255, 240, 180, ${(0.5 + 0.5 * pulse).toFixed(3)})`;
    starPath(ctx, 3 + 3 * pulse, 4, 0.3);
    ctx.fill();
    ctx.restore();
  }
  // Ringed planet.
  const px = w * 0.84;
  const py = h * 0.2;
  const pr = Math.min(w, h) * 0.09;
  const planet = ctx.createRadialGradient(px - pr * 0.3, py - pr * 0.3, pr * 0.1, px, py, pr);
  planet.addColorStop(0, '#ffcf8a');
  planet.addColorStop(1, '#e0703d');
  ctx.fillStyle = planet;
  ctx.beginPath();
  ctx.arc(px, py, pr, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255, 230, 190, 0.8)';
  ctx.lineWidth = Math.max(2, pr * 0.14);
  ctx.beginPath();
  ctx.ellipse(px, py, pr * 1.7, pr * 0.45, -0.35, 0, Math.PI * 2);
  ctx.stroke();
  // Small moon.
  ctx.fillStyle = '#d9dcf5';
  ctx.beginPath();
  ctx.arc(w * 0.12, h * 0.16, Math.min(w, h) * 0.035, 0, Math.PI * 2);
  ctx.fill();
}

function drawOcean(ctx: Ctx, w: number, h: number, t: number): void {
  // Light rays from the surface.
  ctx.save();
  ctx.globalAlpha = 0.12;
  ctx.fillStyle = '#ffffff';
  for (let i = 0; i < 5; i += 1) {
    const x = w * (0.1 + i * 0.2) + Math.sin(t * 0.3 + i) * w * 0.02;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x + w * 0.06, 0);
    ctx.lineTo(x + w * 0.16, h);
    ctx.lineTo(x + w * 0.02, h);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
  // Rolling waves at the surface.
  for (let layer = 0; layer < 3; layer += 1) {
    ctx.fillStyle = `rgba(255, 255, 255, ${0.28 - layer * 0.07})`;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    const baseY = h * (0.05 + layer * 0.035);
    for (let x = 0; x <= w; x += Math.max(4, w / 50)) {
      const y = baseY + Math.sin((x / w) * Math.PI * (4 + layer) + t * (1.1 - layer * 0.25) + layer * 2) * h * 0.014;
      ctx.lineTo(x, y);
    }
    ctx.lineTo(w, 0);
    ctx.closePath();
    ctx.fill();
  }
  // Sand and seaweed.
  hills(ctx, w, h, h * 0.9, h * 0.02, '#f2d9a0', 21);
  const rand = seededRandom(22);
  ctx.strokeStyle = '#2e9e6b';
  ctx.lineCap = 'round';
  for (let i = 0; i < 7; i += 1) {
    const x = rand() * w;
    const height = h * (0.08 + rand() * 0.1);
    const sway = Math.sin(t * 1.2 + i) * w * 0.012;
    ctx.lineWidth = Math.max(2, w * 0.008);
    ctx.beginPath();
    ctx.moveTo(x, h * 0.93);
    ctx.quadraticCurveTo(x + sway * 2, h * 0.93 - height * 0.5, x + sway, h * 0.93 - height);
    ctx.stroke();
  }
  // Rising bubbles.
  for (let i = 0; i < 14; i += 1) {
    const x = rand() * w + Math.sin(t * 1.5 + i) * w * 0.01;
    const speed = 0.04 + rand() * 0.06;
    const y = h - (((rand() + t * speed) % 1) * h * 1.05);
    const r = 2 + rand() * Math.min(w, h) * 0.012;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.7)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.stroke();
  }
}

function drawForest(ctx: Ctx, w: number, h: number, t: number): void {
  driftingClouds(ctx, w, h, t, 3, 31, 0.2);
  hills(ctx, w, h, h * 0.62, h * 0.07, '#a8dba0', 32);
  const rand = seededRandom(33);
  for (let i = 0; i < 9; i += 1) {
    const x = (i + 0.3 + rand() * 0.5) * (w / 9);
    pine(ctx, x, h * (0.66 + rand() * 0.05), h * (0.2 + rand() * 0.12), i % 2 ? '#2f8f5b' : '#3aa56a');
  }
  hills(ctx, w, h, h * 0.8, h * 0.04, '#6cc27a', 34);
  ground(ctx, w, h, h * 0.9, '#57ad66');
}

function drawLab(ctx: Ctx, w: number, h: number, t: number): void {
  // Wall tiles.
  ctx.strokeStyle = 'rgba(120, 150, 190, 0.18)';
  ctx.lineWidth = 1;
  const step = Math.max(24, w / 12);
  for (let x = step; x < w; x += step) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h * 0.78);
    ctx.stroke();
  }
  for (let y = step; y < h * 0.78; y += step) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }
  // Shelf with flasks.
  const shelfY = h * 0.22;
  ctx.fillStyle = '#b9c7dc';
  ctx.fillRect(w * 0.06, shelfY, w * 0.36, h * 0.018);
  const colors = ['#ff8a7a', '#4cc38a', '#5b9bff', '#ffd54a'];
  colors.forEach((color, i) => {
    const x = w * (0.1 + i * 0.085);
    const fh = h * 0.09;
    const bubble = Math.sin(t * 2 + i * 1.4) * 0.5 + 0.5;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.75)';
    ctx.beginPath();
    ctx.moveTo(x - fh * 0.12, shelfY - fh);
    ctx.lineTo(x + fh * 0.12, shelfY - fh);
    ctx.lineTo(x + fh * 0.12, shelfY - fh * 0.6);
    ctx.lineTo(x + fh * 0.36, shelfY);
    ctx.lineTo(x - fh * 0.36, shelfY);
    ctx.lineTo(x - fh * 0.12, shelfY - fh * 0.6);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(x - fh * 0.24, shelfY - fh * 0.32);
    ctx.lineTo(x + fh * 0.24, shelfY - fh * 0.32);
    ctx.lineTo(x + fh * 0.36, shelfY);
    ctx.lineTo(x - fh * 0.36, shelfY);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
    ctx.beginPath();
    ctx.arc(x, shelfY - fh * (0.4 + bubble * 0.5), fh * 0.045, 0, Math.PI * 2);
    ctx.fill();
  });
  // Bench.
  ground(ctx, w, h, h * 0.8, '#c3d1e6');
  ctx.fillStyle = '#9fb2cf';
  ctx.fillRect(0, h * 0.78, w, h * 0.03);
}

function drawCity(ctx: Ctx, w: number, h: number, t: number): void {
  sun(ctx, w * 0.5, h * 0.42, Math.min(w, h) * 0.1, 0, '#fff0b8');
  const far = seededRandom(41);
  ctx.fillStyle = '#b08fc9';
  for (let x = 0; x < w; ) {
    const bw = w * (0.05 + far() * 0.06);
    const bh = h * (0.18 + far() * 0.22);
    ctx.fillRect(x, h * 0.82 - bh, bw + 1, bh);
    x += bw;
  }
  const near = seededRandom(42);
  for (let x = -w * 0.02; x < w; ) {
    const bw = w * (0.08 + near() * 0.07);
    const bh = h * (0.2 + near() * 0.34);
    const top = h * 0.86 - bh;
    ctx.fillStyle = '#4a3f7a';
    ctx.fillRect(x, top, bw, bh);
    const cols = Math.max(2, Math.floor(bw / (w * 0.028)));
    const rows = Math.max(2, Math.floor(bh / (h * 0.06)));
    for (let r = 0; r < rows; r += 1) {
      for (let c = 0; c < cols; c += 1) {
        const lit = near() > 0.4;
        const flicker = lit && near() > 0.85 ? 0.6 + 0.4 * Math.sin(t * 2 + r + c) : 1;
        ctx.fillStyle = lit ? `rgba(255, 224, 130, ${(0.9 * flicker).toFixed(3)})` : 'rgba(255, 255, 255, 0.12)';
        const cw = bw / cols;
        const ch = bh / rows;
        ctx.fillRect(x + c * cw + cw * 0.25, top + r * ch + ch * 0.25, cw * 0.5, ch * 0.5);
      }
    }
    x += bw + w * 0.012;
  }
  ground(ctx, w, h, h * 0.86, '#5c5770');
  ctx.fillStyle = '#ffe38a';
  for (let x = w * 0.04; x < w; x += w * 0.14) ctx.fillRect(x, h * 0.925, w * 0.07, h * 0.012);
}

function drawFarm(ctx: Ctx, w: number, h: number, t: number): void {
  sun(ctx, w * 0.12, h * 0.16, Math.min(w, h) * 0.07, t);
  driftingClouds(ctx, w, h, t, 3, 51, 0.18);
  hills(ctx, w, h, h * 0.62, h * 0.05, '#9bd97a', 52);
  // Barn.
  const bx = w * 0.72;
  const by = h * 0.62;
  const bw = w * 0.16;
  const bh = h * 0.16;
  ctx.fillStyle = '#d9483a';
  ctx.fillRect(bx, by - bh, bw, bh);
  ctx.beginPath();
  ctx.moveTo(bx - bw * 0.06, by - bh);
  ctx.lineTo(bx + bw * 0.5, by - bh * 1.5);
  ctx.lineTo(bx + bw * 1.06, by - bh);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#fff3dd';
  ctx.fillRect(bx + bw * 0.36, by - bh * 0.55, bw * 0.28, bh * 0.55);
  hills(ctx, w, h, h * 0.74, h * 0.035, '#7cc65e', 53);
  ground(ctx, w, h, h * 0.86, '#69b74f');
  // Fence.
  ctx.fillStyle = '#f6efe0';
  ctx.fillRect(0, h * 0.8, w, h * 0.012);
  ctx.fillRect(0, h * 0.84, w, h * 0.012);
  for (let x = w * 0.03; x < w; x += w * 0.08) ctx.fillRect(x, h * 0.77, w * 0.014, h * 0.11);
}

function drawSky(ctx: Ctx, w: number, h: number, t: number): void {
  sun(ctx, w * 0.85, h * 0.18, Math.min(w, h) * 0.08, t);
  driftingClouds(ctx, w, h, t, 6, 61, 0.75);
}

function drawDesert(ctx: Ctx, w: number, h: number, t: number): void {
  sun(ctx, w * 0.8, h * 0.2, Math.min(w, h) * 0.09, t, '#fff3c4');
  hills(ctx, w, h, h * 0.62, h * 0.06, '#f4b56a', 71);
  hills(ctx, w, h, h * 0.74, h * 0.05, '#eda355', 72);
  hills(ctx, w, h, h * 0.86, h * 0.035, '#e39446', 73);
  // Cacti.
  const rand = seededRandom(74);
  ctx.strokeStyle = '#3f9d63';
  ctx.lineCap = 'round';
  for (let i = 0; i < 3; i += 1) {
    const x = w * (0.12 + i * 0.36 + rand() * 0.08);
    const base = h * (0.8 + rand() * 0.06);
    const height = h * (0.12 + rand() * 0.06);
    ctx.lineWidth = Math.max(4, height * 0.2);
    ctx.beginPath();
    ctx.moveTo(x, base);
    ctx.lineTo(x, base - height);
    ctx.stroke();
    ctx.lineWidth = Math.max(3, height * 0.14);
    ctx.beginPath();
    ctx.moveTo(x, base - height * 0.4);
    ctx.lineTo(x - height * 0.28, base - height * 0.4);
    ctx.lineTo(x - height * 0.28, base - height * 0.7);
    ctx.moveTo(x, base - height * 0.55);
    ctx.lineTo(x + height * 0.26, base - height * 0.55);
    ctx.lineTo(x + height * 0.26, base - height * 0.82);
    ctx.stroke();
  }
}

function drawArctic(ctx: Ctx, w: number, h: number, t: number): void {
  // Soft aurora ribbons.
  for (let band = 0; band < 3; band += 1) {
    ctx.strokeStyle = ['rgba(120, 255, 200, 0.28)', 'rgba(140, 200, 255, 0.26)', 'rgba(200, 160, 255, 0.22)'][band] as string;
    ctx.lineWidth = h * 0.05;
    ctx.lineCap = 'round';
    ctx.beginPath();
    for (let x = 0; x <= w; x += Math.max(6, w / 40)) {
      const y = h * (0.14 + band * 0.06) + Math.sin((x / w) * Math.PI * 3 + t * 0.4 + band * 1.3) * h * 0.035;
      if (x === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  // Icebergs.
  const rand = seededRandom(81);
  for (let i = 0; i < 4; i += 1) {
    const x = w * (0.08 + i * 0.26 + rand() * 0.06);
    const bw = w * (0.12 + rand() * 0.08);
    const bh = h * (0.16 + rand() * 0.14);
    const base = h * 0.72;
    ctx.fillStyle = '#e8f6ff';
    ctx.beginPath();
    ctx.moveTo(x - bw / 2, base);
    ctx.lineTo(x - bw * 0.15, base - bh);
    ctx.lineTo(x + bw * 0.1, base - bh * 0.75);
    ctx.lineTo(x + bw / 2, base);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#c4e3f7';
    ctx.beginPath();
    ctx.moveTo(x + bw * 0.1, base - bh * 0.75);
    ctx.lineTo(x + bw / 2, base);
    ctx.lineTo(x + bw * 0.05, base);
    ctx.closePath();
    ctx.fill();
  }
  hills(ctx, w, h, h * 0.76, h * 0.03, '#ffffff', 82);
  ground(ctx, w, h, h * 0.88, '#f4fbff');
  // Falling snow.
  for (let i = 0; i < 40; i += 1) {
    const speed = 0.03 + rand() * 0.05;
    const x = rand() * w + Math.sin(t * 0.8 + i) * w * 0.012;
    const y = ((rand() + t * speed) % 1) * h;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.beginPath();
    ctx.arc(x, y, 1.2 + rand() * 1.8, 0, Math.PI * 2);
    ctx.fill();
  }
}

function gear(ctx: Ctx, x: number, y: number, r: number, angle: number, color: string): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.fillStyle = color;
  const teeth = 9;
  ctx.beginPath();
  for (let i = 0; i < teeth * 2; i += 1) {
    const radius = i % 2 === 0 ? r : r * 0.78;
    const a = (i * Math.PI) / teeth;
    const a2 = ((i + 0.6) * Math.PI) / teeth;
    ctx.lineTo(Math.cos(a) * radius, Math.sin(a) * radius);
    ctx.lineTo(Math.cos(a2) * radius, Math.sin(a2) * radius);
  }
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = 'rgba(255, 255, 255, 0.55)';
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.3, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawWorkshop(ctx: Ctx, w: number, h: number, t: number): void {
  // Pegboard.
  ctx.fillStyle = 'rgba(140, 100, 50, 0.22)';
  const step = Math.max(18, w / 22);
  for (let y = step; y < h * 0.7; y += step) {
    for (let x = step; x < w; x += step) {
      ctx.beginPath();
      ctx.arc(x, y, 1.6, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  const r = Math.min(w, h) * 0.07;
  gear(ctx, w * 0.86, h * 0.18, r, t * 0.5, '#c9a66b');
  gear(ctx, w * 0.86 - r * 1.55, h * 0.18 + r * 0.75, r * 0.7, -t * 0.72 + 0.3, '#b98f55');
  gear(ctx, w * 0.1, h * 0.14, r * 0.8, -t * 0.4, '#d3b27c');
  // Workbench.
  ctx.fillStyle = '#a8763e';
  ctx.fillRect(0, h * 0.78, w, h * 0.05);
  ground(ctx, w, h, h * 0.83, '#8a5d2d');
  ctx.strokeStyle = 'rgba(60, 35, 10, 0.25)';
  ctx.lineWidth = 2;
  for (let x = w * 0.12; x < w; x += w * 0.2) {
    ctx.beginPath();
    ctx.moveTo(x, h * 0.83);
    ctx.lineTo(x, h);
    ctx.stroke();
  }
}

function leaf(ctx: Ctx, x: number, y: number, length: number, angle: number, color: string): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.quadraticCurveTo(length * 0.5, -length * 0.32, length, 0);
  ctx.quadraticCurveTo(length * 0.5, length * 0.32, 0, 0);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawJungle(ctx: Ctx, w: number, h: number, t: number): void {
  // Sun glow through the canopy.
  const glow = ctx.createRadialGradient(w * 0.5, h * 0.1, 0, w * 0.5, h * 0.1, h * 0.7);
  glow.addColorStop(0, 'rgba(255, 245, 170, 0.5)');
  glow.addColorStop(1, 'rgba(255, 245, 170, 0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, w, h);
  hills(ctx, w, h, h * 0.7, h * 0.05, '#2e9a5f', 91);
  // Vines.
  const rand = seededRandom(92);
  for (let i = 0; i < 6; i += 1) {
    const x = w * (0.06 + i * 0.18 + rand() * 0.05);
    const length = h * (0.22 + rand() * 0.25);
    const sway = Math.sin(t * 0.9 + i * 1.3) * w * 0.012;
    ctx.strokeStyle = '#1d7a47';
    ctx.lineWidth = Math.max(2, w * 0.006);
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.quadraticCurveTo(x + sway * 2, length * 0.5, x + sway, length);
    ctx.stroke();
    for (let k = 1; k <= 3; k += 1) {
      leaf(ctx, x + sway * (k / 3), (length * k) / 3.2, w * 0.035, k % 2 ? 0.5 : Math.PI - 0.5, '#35b36b');
    }
  }
  // Big leaves in the corners.
  const big = Math.min(w, h) * 0.34;
  const breathe = Math.sin(t * 0.7) * 0.04;
  leaf(ctx, 0, h, big, -0.9 + breathe, '#1f8a50');
  leaf(ctx, 0, h, big * 0.9, -0.35 + breathe, '#27a05d');
  leaf(ctx, w, h, big, Math.PI + 0.9 - breathe, '#1f8a50');
  leaf(ctx, w, h, big * 0.9, Math.PI + 0.35 - breathe, '#27a05d');
  ground(ctx, w, h, h * 0.9, '#3d8f4f');
}

function drawCastle(ctx: Ctx, w: number, h: number, t: number): void {
  driftingClouds(ctx, w, h, t, 3, 101, 0.2);
  hills(ctx, w, h, h * 0.72, h * 0.05, '#b9e3a8', 102);
  const cx = w * 0.5;
  const base = h * 0.74;
  const cw = w * 0.34;
  const ch = h * 0.24;
  ctx.fillStyle = '#b9b3cf';
  ctx.fillRect(cx - cw / 2, base - ch, cw, ch);
  // Battlements.
  const teeth = 7;
  for (let i = 0; i < teeth; i += 2) ctx.fillRect(cx - cw / 2 + (i * cw) / teeth, base - ch - h * 0.025, cw / teeth, h * 0.03);
  // Towers with flags.
  [-1, 1].forEach((side, index) => {
    const tx = cx + side * cw * 0.5;
    const tw = cw * 0.2;
    const th = ch * 1.5;
    ctx.fillStyle = '#a7a0c2';
    ctx.fillRect(tx - tw / 2, base - th, tw, th);
    ctx.fillStyle = '#7d5fc4';
    ctx.beginPath();
    ctx.moveTo(tx - tw * 0.7, base - th);
    ctx.lineTo(tx, base - th - h * 0.1);
    ctx.lineTo(tx + tw * 0.7, base - th);
    ctx.closePath();
    ctx.fill();
    const top = base - th - h * 0.1;
    ctx.strokeStyle = '#5d5873';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(tx, top);
    ctx.lineTo(tx, top - h * 0.06);
    ctx.stroke();
    const wave = Math.sin(t * 3 + index) * h * 0.008;
    ctx.fillStyle = '#ff8a7a';
    ctx.beginPath();
    ctx.moveTo(tx, top - h * 0.06);
    ctx.lineTo(tx + w * 0.045, top - h * 0.045 + wave);
    ctx.lineTo(tx, top - h * 0.03);
    ctx.closePath();
    ctx.fill();
  });
  // Gate.
  ctx.fillStyle = '#6b5a8f';
  ctx.beginPath();
  ctx.moveTo(cx - cw * 0.1, base);
  ctx.lineTo(cx - cw * 0.1, base - ch * 0.35);
  ctx.arc(cx, base - ch * 0.35, cw * 0.1, Math.PI, 0);
  ctx.lineTo(cx + cw * 0.1, base);
  ctx.closePath();
  ctx.fill();
  hills(ctx, w, h, h * 0.84, h * 0.03, '#9ad58c', 103);
  ground(ctx, w, h, h * 0.92, '#86c878');
}

function drawKitchen(ctx: Ctx, w: number, h: number, t: number): void {
  // Checker tiles on the wall.
  const tile = Math.max(22, w / 14);
  for (let row = 0; row * tile < h * 0.72; row += 1) {
    for (let col = 0; col * tile < w; col += 1) {
      if ((row + col) % 2 === 0) {
        ctx.fillStyle = 'rgba(255, 190, 110, 0.2)';
        ctx.fillRect(col * tile, row * tile, tile, Math.min(tile, h * 0.72 - row * tile));
      }
    }
  }
  // Window with a little sky.
  const wx = w * 0.62;
  const wy = h * 0.1;
  const ww = w * 0.26;
  const wh = h * 0.28;
  ctx.fillStyle = '#ffffff';
  roundedRectPath(ctx, wx - 5, wy - 5, ww + 10, wh + 10, 10);
  ctx.fill();
  ctx.fillStyle = '#a9defa';
  roundedRectPath(ctx, wx, wy, ww, wh, 6);
  ctx.fill();
  ctx.save();
  roundedRectPath(ctx, wx, wy, ww, wh, 6);
  ctx.clip();
  const drift = ((t * ww * 0.03) % (ww * 1.6)) - ww * 0.3;
  cloud(ctx, wx + drift, wy + wh * 0.35, ww * 0.45, 0.9);
  ctx.restore();
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(wx + ww / 2 - 2, wy, 4, wh);
  ctx.fillRect(wx, wy + wh / 2 - 2, ww, 4);
  // Counter.
  ctx.fillStyle = '#f7f1e6';
  ctx.fillRect(0, h * 0.72, w, h * 0.04);
  ground(ctx, w, h, h * 0.76, '#e9a56b');
  ctx.strokeStyle = 'rgba(120, 70, 30, 0.25)';
  ctx.lineWidth = 2;
  for (let x = w * 0.2; x < w; x += w * 0.2) {
    ctx.beginPath();
    ctx.moveTo(x, h * 0.78);
    ctx.lineTo(x, h);
    ctx.stroke();
  }
  // Steam curls.
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.7)';
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  for (let i = 0; i < 2; i += 1) {
    const x = w * (0.16 + i * 0.05);
    const rise = (t * 0.25 + i * 0.5) % 1;
    ctx.globalAlpha = 1 - rise;
    ctx.beginPath();
    ctx.moveTo(x, h * 0.7 - rise * h * 0.12);
    ctx.quadraticCurveTo(x + w * 0.015, h * 0.67 - rise * h * 0.12, x, h * 0.64 - rise * h * 0.12);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

function drawPlayground(ctx: Ctx, w: number, h: number, t: number): void {
  sun(ctx, w * 0.14, h * 0.16, Math.min(w, h) * 0.07, t);
  driftingClouds(ctx, w, h, t, 3, 111, 0.2);
  hills(ctx, w, h, h * 0.7, h * 0.04, '#a5e08c', 112);
  roundTree(ctx, w * 0.9, h * 0.74, h * 0.26, '#4cb86a');
  // Swing set.
  const sx = w * 0.3;
  const top = h * 0.4;
  const base = h * 0.78;
  ctx.strokeStyle = '#d9483a';
  ctx.lineWidth = Math.max(4, w * 0.012);
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(sx - w * 0.14, base);
  ctx.lineTo(sx - w * 0.1, top);
  ctx.lineTo(sx + w * 0.1, top);
  ctx.lineTo(sx + w * 0.14, base);
  ctx.stroke();
  const swing = Math.sin(t * 1.6) * 0.32;
  const length = h * 0.24;
  ctx.strokeStyle = '#6b668f';
  ctx.lineWidth = 2;
  const seatX = sx + Math.sin(swing) * length;
  const seatY = top + Math.cos(swing) * length;
  ctx.beginPath();
  ctx.moveTo(sx - w * 0.025, top);
  ctx.lineTo(seatX - w * 0.025, seatY);
  ctx.moveTo(sx + w * 0.025, top);
  ctx.lineTo(seatX + w * 0.025, seatY);
  ctx.stroke();
  ctx.fillStyle = '#ffd54a';
  ctx.fillRect(seatX - w * 0.035, seatY - 3, w * 0.07, 6);
  // Slide.
  const lx = w * 0.62;
  ctx.strokeStyle = '#5b9bff';
  ctx.lineWidth = Math.max(5, w * 0.016);
  ctx.beginPath();
  ctx.moveTo(lx, h * 0.5);
  ctx.quadraticCurveTo(lx + w * 0.08, h * 0.74, lx + w * 0.18, h * 0.77);
  ctx.stroke();
  ctx.strokeStyle = '#8a6fd8';
  ctx.lineWidth = Math.max(3, w * 0.008);
  ctx.beginPath();
  ctx.moveTo(lx - w * 0.01, h * 0.5);
  ctx.lineTo(lx - w * 0.01, base);
  ctx.moveTo(lx - w * 0.05, h * 0.5);
  ctx.lineTo(lx - w * 0.05, base);
  ctx.stroke();
  ground(ctx, w, h, h * 0.8, '#8fd277');
}

function drawPlain(ctx: Ctx, w: number, h: number, t: number): void {
  // Soft floating dots so the stage never feels empty.
  const rand = seededRandom(121);
  for (let i = 0; i < 16; i += 1) {
    const x = rand() * w;
    const y = rand() * h + Math.sin(t * 0.5 + i) * h * 0.012;
    const r = Math.min(w, h) * (0.012 + rand() * 0.03);
    ctx.fillStyle = ['rgba(169, 156, 245, 0.16)', 'rgba(255, 213, 74, 0.16)', 'rgba(76, 195, 138, 0.14)'][i % 3] as string;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
}

const PAINTERS: Record<SceneTheme, (ctx: Ctx, w: number, h: number, t: number) => void> = {
  space: drawSpace,
  ocean: drawOcean,
  forest: drawForest,
  lab: drawLab,
  city: drawCity,
  farm: drawFarm,
  sky: drawSky,
  desert: drawDesert,
  arctic: drawArctic,
  workshop: drawWorkshop,
  jungle: drawJungle,
  castle: drawCastle,
  kitchen: drawKitchen,
  playground: drawPlayground,
  plain: drawPlain,
};

/**
 * Paints the whole background. A scene's own `gradient` replaces the theme's
 * base colours; the theme's scenery is still drawn on top of it.
 */
export function drawBackground(ctx: Ctx, scene: Pick<Scene, 'theme' | 'gradient'>, w: number, h: number, t: number): void {
  const theme: SceneTheme = scene.theme in PAINTERS ? scene.theme : 'plain';
  const [top, bottom] = scene.gradient ?? THEME_GRADIENTS[theme];
  ctx.save();
  fillGradient(ctx, w, h, top, bottom);
  try {
    PAINTERS[theme](ctx, w, h, t);
  } finally {
    ctx.restore();
  }
}

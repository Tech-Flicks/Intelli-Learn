/** Celebration particles: confetti and stars. The simulation is pure; drawing is separate. */
import { seededRandom } from '../shuffle';
import { starPath } from './shapes';

export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  rotation: number;
  spin: number;
  size: number;
  color: string;
  shape: 'confetti' | 'star' | 'dot';
  /** Seconds lived and seconds to live. */
  age: number;
  life: number;
}

export const PARTY_COLORS = ['#ff8a7a', '#ffd54a', '#4cc38a', '#5b9bff', '#a99cf5', '#ff9ecb', '#ffa94d'] as const;

const GRAVITY = 520; // px / s^2 at a 400 px tall stage; scaled with the stage

/** A burst from the lower middle plus a shower from the top. */
export function spawnCelebration(width: number, height: number, seed: number, count = 90): Particle[] {
  const rand = seededRandom(seed);
  const scale = Math.max(0.5, Math.min(width, height) / 400);
  const out: Particle[] = [];
  for (let i = 0; i < count; i += 1) {
    const fromFountain = i % 3 !== 0;
    const angle = fromFountain ? -Math.PI / 2 + (rand() - 0.5) * 1.5 : Math.PI / 2 + (rand() - 0.5) * 0.6;
    const speed = (fromFountain ? 320 + rand() * 300 : 40 + rand() * 80) * scale;
    const shapeRoll = rand();
    out.push({
      x: fromFountain ? width * (0.35 + rand() * 0.3) : rand() * width,
      y: fromFountain ? height * 0.92 : -10 - rand() * height * 0.2,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      rotation: rand() * Math.PI * 2,
      spin: (rand() - 0.5) * 12,
      size: (6 + rand() * 8) * scale,
      color: PARTY_COLORS[Math.floor(rand() * PARTY_COLORS.length)] as string,
      shape: shapeRoll < 0.55 ? 'confetti' : shapeRoll < 0.85 ? 'star' : 'dot',
      age: 0,
      life: 1.6 + rand() * 1.4,
    });
  }
  return out;
}

/** Advances the particles by `dt` seconds and drops the ones that are done. */
export function stepParticles(particles: Particle[], dt: number, width: number, height: number): Particle[] {
  const step = Math.max(0, Math.min(dt, 0.05));
  const gravity = GRAVITY * Math.max(0.5, Math.min(width, height) / 400);
  const alive: Particle[] = [];
  for (const p of particles) {
    const age = p.age + step;
    if (age >= p.life || p.y > height + 40) continue;
    const drag = p.shape === 'confetti' ? 0.985 : 0.992;
    alive.push({
      ...p,
      age,
      vx: p.vx * drag,
      vy: p.vy * drag + gravity * step,
      x: p.x + p.vx * step,
      y: p.y + p.vy * step,
      rotation: p.rotation + p.spin * step,
    });
  }
  return alive;
}

export function drawParticles(ctx: CanvasRenderingContext2D, particles: readonly Particle[]): void {
  for (const p of particles) {
    const fade = Math.min(1, (p.life - p.age) / 0.5);
    ctx.save();
    ctx.globalAlpha = Math.max(0, fade);
    ctx.translate(p.x, p.y);
    ctx.rotate(p.rotation);
    ctx.fillStyle = p.color;
    if (p.shape === 'confetti') {
      // Flutter: the paper strip turns edge-on as it spins.
      const flutter = Math.abs(Math.cos(p.rotation * 1.7)) * 0.8 + 0.2;
      ctx.fillRect(-p.size / 2, (-p.size * 0.3 * flutter) / 1, p.size, p.size * 0.6 * flutter);
    } else if (p.shape === 'star') {
      starPath(ctx, p.size * 0.7);
      ctx.fill();
    } else {
      ctx.beginPath();
      ctx.arc(0, 0, p.size * 0.35, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
}

/** A still ring of stars: the calm celebration shown under reduced motion. */
export function drawStaticBurst(ctx: CanvasRenderingContext2D, width: number, height: number): void {
  const cx = width / 2;
  const cy = height * 0.42;
  const radius = Math.min(width, height) * 0.3;
  const count = 10;
  for (let i = 0; i < count; i += 1) {
    const a = -Math.PI / 2 + (i * Math.PI * 2) / count;
    ctx.save();
    ctx.translate(cx + Math.cos(a) * radius, cy + Math.sin(a) * radius * 0.8);
    ctx.fillStyle = PARTY_COLORS[i % PARTY_COLORS.length] as string;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.lineWidth = 2;
    starPath(ctx, Math.min(width, height) * (i % 2 ? 0.035 : 0.05));
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }
}

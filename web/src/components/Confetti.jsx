import React, { useEffect, useRef } from 'react';

const GOLD = ['#FFD76A', '#FFC94D', '#FF9F1C', '#FFF1C4', '#FF7A2F'];
const COOL = ['#8367FF', '#38BDF8', '#1EE0B0', '#F472B6', '#FFD76A'];

/**
 * 礼花粒子系统：中心爆点 + 左右两枚礼炮 + 飘落的彩带。
 * 纯 canvas 绘制，不引入任何库。
 */
export default function Confetti({ active, tone = 'win', duration = 4600, continuous = false }) {
  const canvasRef = useRef(null);
  const rafRef = useRef(0);

  useEffect(() => {
    if (!active) return undefined;
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const ctx = canvas.getContext('2d');

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const resize = () => {
      canvas.width = window.innerWidth * dpr;
      canvas.height = window.innerHeight * dpr;
      canvas.style.width = `${window.innerWidth}px`;
      canvas.style.height = `${window.innerHeight}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener('resize', resize);

    const W = () => window.innerWidth;
    const H = () => window.innerHeight;
    const palette = tone === 'win' ? GOLD : COOL;
    const rand = (a, b) => a + Math.random() * (b - a);

    /** @type {Array<any>} */
    const parts = [];

    const spawnBurst = (x, y, count, power, spread = Math.PI * 2, angle = -Math.PI / 2) => {
      for (let i = 0; i < count; i++) {
        const a = angle + rand(-spread / 2, spread / 2);
        const sp = rand(power * 0.35, power);
        const type = Math.random();
        parts.push({
          x, y,
          vx: Math.cos(a) * sp,
          vy: Math.sin(a) * sp,
          g: rand(0.16, 0.28),
          drag: rand(0.982, 0.994),
          size: type > 0.72 ? rand(2, 3.6) : rand(3.5, 8),
          color: palette[(Math.random() * palette.length) | 0],
          rot: rand(0, Math.PI * 2),
          vr: rand(-0.24, 0.24),
          shape: type > 0.85 ? 'spark' : type > 0.62 ? 'ribbon' : 'paper',
          life: 1,
          decay: rand(0.004, 0.009),
          wobble: rand(0, Math.PI * 2),
        });
      }
    };

    // 开场：中心冲击 + 两侧礼炮
    spawnBurst(W() / 2, H() * 0.44, tone === 'win' ? 150 : 46, tone === 'win' ? 15 : 8);
    setTimeout(() => spawnBurst(0, H() * 0.85, 90, 19, Math.PI * 0.5, -Math.PI / 3.1), 130);
    setTimeout(() => spawnBurst(W(), H() * 0.85, 90, 19, Math.PI * 0.5, -Math.PI + Math.PI / 3.1), 220);
    setTimeout(() => spawnBurst(W() * 0.5, H() * 0.3, 60, 11), 700);

    const start = performance.now();
    let last = start, lastSpawn = start;

    const tick = (now) => {
      const dt = Math.min(3, (now - last) / 16.67);
      last = now;
      const elapsed = now - start;
      if (continuous && now - lastSpawn > 200 && parts.length < 350) { spawnBurst(rand(0,W()), -20, 9, 3, Math.PI, Math.PI / 2); lastSpawn = now; }

      ctx.clearRect(0, 0, W(), H());
      ctx.globalCompositeOperation = 'lighter';

      for (let i = parts.length - 1; i >= 0; i--) {
        const p = parts[i];
        p.vx *= Math.pow(p.drag, dt);
        p.vy = p.vy * Math.pow(p.drag, dt) + p.g * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.rot += p.vr * dt;
        p.wobble += 0.12 * dt;
        p.life -= p.decay * dt;

        if (p.life <= 0 || p.y > H() + 60) { parts.splice(i, 1); continue; }

        const alpha = Math.min(1, p.life * 1.5);
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillStyle = p.color;

        if (p.shape === 'paper') {
          ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
        } else if (p.shape === 'ribbon') {
          ctx.fillRect(-p.size / 6, -p.size * 1.6, p.size / 3, p.size * 3.2);
        } else {
          ctx.shadowColor = p.color;
          ctx.shadowBlur = 14;
          const r = p.size * 0.55;
          ctx.beginPath();
          ctx.arc(0, 0, r, 0, Math.PI * 2);
          ctx.fill();
          // 十字星
          ctx.globalAlpha = alpha * 0.75;
          ctx.fillRect(-r * 3.2, -0.7, r * 6.4, 1.4);
          ctx.fillRect(-0.7, -r * 3.2, 1.4, r * 6.4);
        }
        ctx.restore();
      }
      ctx.globalCompositeOperation = 'source-over';

      if (continuous || elapsed < duration || parts.length) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        ctx.clearRect(0, 0, W(), H());
      }
    };
    rafRef.current = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(rafRef.current);
      window.removeEventListener('resize', resize);
    };
  }, [active, tone, duration, continuous]);

  if (!active) return null;

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: 'fixed', inset: 0, zIndex: 125,
        pointerEvents: 'none',
      }}
    />
  );
}


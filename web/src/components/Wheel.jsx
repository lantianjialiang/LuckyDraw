import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { sfx } from '../lib/sound.js';

const PALETTE = ['#FF3D71', '#FF9F1C', '#FFD84D', '#4ADE80', '#38BDF8', '#A78BFA', '#F472B6', '#34D399', '#FBBF24', '#60A5FA'];

const hexToRgb = (hex) => {
  const h = (hex || '').replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  if (full.length !== 6) return { r: 255, g: 159, b: 28 };
  return {
    r: parseInt(full.slice(0, 2), 16),
    g: parseInt(full.slice(2, 4), 16),
    b: parseInt(full.slice(4, 6), 16),
  };
};
const rgba = ({ r, g, b }, a = 1) => `rgba(${r},${g},${b},${a})`;
const mix = (c1, c2, t) => ({ r: c1.r + (c2.r - c1.r) * t, g: c1.g + (c2.g - c1.g) * t, b: c1.b + (c2.b - c1.b) * t });
const luminance = ({ r, g, b }) => (0.299 * r + 0.587 * g + 0.114 * b) / 255;

/**
 * 扇区角度按 remainingCount 分配（视觉即概率），并给极小扇区一个下限，
 * 否则 1/90 的奖品会窄成一条线看不见。
 */
function buildSectors(prizes) {
  if (!prizes.length) return [];
  // 用 0.7 次幂压缩极端比例：既保留"剩余多的扇区更大"的直觉，
  // 又不会让 1/90 的奖品窄成一条看不见的线
  const weights = prizes.map((p) => Math.pow(Math.max(Number(p.remainingCount) || 0, 1), 0.7));
  const total = weights.reduce((a, b) => a + b, 0);
  let shares = weights.map((w) => w / total);

  const MIN = prizes.length > 9 ? 0.028 : prizes.length > 6 ? 0.045 : 0.06;
  for (let guard = 0; guard < 8; guard++) {
    const small = [];
    let deficit = 0;
    shares.forEach((s, i) => { if (s < MIN - 1e-6) { deficit += MIN - s; small.push(i); } });
    if (!deficit || !small.length) break;
    const donors = shares.map((s, i) => (s > MIN + 1e-6 && !small.includes(i) ? i : -1)).filter((i) => i >= 0);
    const pool = donors.reduce((a, i) => a + shares[i], 0);
    if (pool <= 0) break;
    small.forEach((i) => { shares[i] = MIN; });
    donors.forEach((i) => { shares[i] -= deficit * (shares[i] / pool); });
  }
  const sum = shares.reduce((a, b) => a + b, 0) || 1;
  shares = shares.map((s) => s / sum);

  let acc = -Math.PI / 2;
  return prizes.map((p, i) => {
    const span = shares[i] * Math.PI * 2;
    const sector = { prize: p, start: acc, end: acc + span, span, mid: acc + span / 2, index: i };
    acc += span;
    return sector;
  });
}

const normalize = (a) => ((a % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);

const Wheel = forwardRef(function Wheel({ prizes, onSpin, disabled, buttonLabel, buttonSub, className = '' }, ref) {
  const shellRef = useRef(null);
  const canvasRef = useRef(null);
  const pointerRef = useRef(null);

  const stateRef = useRef({
    rotation: 0,
    speed: 0,
    spinning: false,
    lastTickIndex: -1,
    settleUntil: 0,
    size: 0,
    dpr: 1,
  });
  const sectorsRef = useRef([]);
  const resolveRef = useRef(null);

  const sectors = useMemo(() => buildSectors(prizes || []), [prizes]);
  sectorsRef.current = sectors;
  const [busy, setBusy] = useState(false);

  /* ---------------- 绘制 ---------------- */

  const drawWheel = useCallback((ctx, S, R, rotation, alpha, timeMs, speed) => {
    const wheelR = R * 0.855;
    const secs = sectorsRef.current;
    ctx.save();
    ctx.globalAlpha = alpha;

    // 托盘光环（外圈）
    ctx.beginPath();
    ctx.arc(0, 0, R * 0.985, 0, Math.PI * 2);
    ctx.fillStyle = '#0a0a11';
    ctx.fill();

    const ringGrad = ctx.createLinearGradient(-R, -R, R, R);
    ringGrad.addColorStop(0, '#2a2b38');
    ringGrad.addColorStop(0.35, '#14151d');
    ringGrad.addColorStop(0.62, '#33343f');
    ringGrad.addColorStop(1, '#0e0f15');
    ctx.beginPath();
    ctx.arc(0, 0, R * 0.975, 0, Math.PI * 2);
    ctx.fillStyle = ringGrad;
    ctx.fill();

    // 外圈霓虹描边
    ctx.beginPath();
    ctx.arc(0, 0, R * 0.985, 0, Math.PI * 2);
    ctx.lineWidth = Math.max(1, S * 0.004);
    ctx.strokeStyle = `rgba(255,201,77,${0.22 + 0.14 * Math.sin(timeMs / 700)})`;
    ctx.stroke();

    // 灯泡（固定在轮框上，不随盘面旋转）
    const bulbCount = 28;
    for (let i = 0; i < bulbCount; i++) {
      const ang = (i / bulbCount) * Math.PI * 2;
      const x = Math.cos(ang) * R * 0.915;
      const y = Math.sin(ang) * R * 0.915;
      const phase = (i + Math.floor(timeMs / (speed > 3 ? 55 : 180))) % 4;
      const on = phase < 2;
      const rad = S * (on ? 0.0072 : 0.0055);
      ctx.beginPath();
      ctx.arc(x, y, rad, 0, Math.PI * 2);
      ctx.fillStyle = on ? 'rgba(255,225,150,1)' : 'rgba(120,110,95,0.55)';
      if (on) {
        ctx.shadowColor = 'rgba(255,201,77,0.9)';
        ctx.shadowBlur = S * 0.028;
      }
      ctx.fill();
      ctx.shadowBlur = 0;
    }

    // —— 盘面整体旋转 ——
    ctx.save();
    ctx.rotate(rotation);

    // 扇区
    secs.forEach((s, i) => {
      const base = hexToRgb(s.prize.color || PALETTE[i % PALETTE.length]);
      const isNone = s.prize.type === 'none';
      const inner = isNone ? mix(base, { r: 60, g: 64, b: 78 }, 0.72) : mix(base, { r: 255, g: 255, b: 255 }, 0.3);
      const outer = isNone ? mix(base, { r: 18, g: 20, b: 28 }, 0.55) : mix(base, { r: 0, g: 0, b: 0 }, 0.16);

      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.arc(0, 0, wheelR, s.start, s.end);
      ctx.closePath();

      const g = ctx.createRadialGradient(0, 0, wheelR * 0.06, 0, 0, wheelR);
      g.addColorStop(0, rgba(inner));
      g.addColorStop(0.55, rgba(base));
      g.addColorStop(1, rgba(outer));
      ctx.fillStyle = g;
      ctx.fill();

      // 扇区分隔线
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(Math.cos(s.start) * wheelR, Math.sin(s.start) * wheelR);
      ctx.strokeStyle = 'rgba(255,255,255,0.22)';
      ctx.lineWidth = Math.max(1, S * 0.0022);
      ctx.stroke();
    });

    // 边缘暗角
    const vig = ctx.createRadialGradient(0, 0, wheelR * 0.55, 0, 0, wheelR);
    vig.addColorStop(0, 'rgba(0,0,0,0)');
    vig.addColorStop(1, 'rgba(0,0,0,0.34)');
    ctx.beginPath();
    ctx.arc(0, 0, wheelR, 0, Math.PI * 2);
    ctx.fillStyle = vig;
    ctx.fill();

    // 扇区文字（径向排版）
    secs.forEach((s, i) => {
      const base = hexToRgb(s.prize.color || PALETTE[i % PALETTE.length]);
      const isNone = s.prize.type === 'none';
      const bgForText = isNone ? mix(base, { r: 58, g: 60, b: 82 }, 0.62) : base;
      const dark = luminance(bgForText) > 0.66;
      const textColor = dark ? 'rgba(28,18,4,0.94)' : 'rgba(255,255,255,0.97)';
      const subColor = dark ? 'rgba(28,18,4,0.58)' : 'rgba(255,255,255,0.66)';

      // 扇区太窄就不写字，避免糊成一团
      const arcWidth = s.span * wheelR;
      if (arcWidth < 30) return;
      const nameSize = Math.min(R * 0.076, arcWidth * 0.38);
      if (nameSize < 8.5) return;

      ctx.save();
      ctx.rotate(s.mid);
      const flip = Math.cos(s.mid + rotation) < 0;
      if (flip) {
        ctx.rotate(Math.PI);
        ctx.textAlign = 'left';
      } else {
        ctx.textAlign = 'right';
      }
      const dir = flip ? -1 : 1;
      const x = dir * (wheelR - S * 0.05);

      ctx.textBaseline = 'middle';
      ctx.shadowColor = 'rgba(0,0,0,0.35)';
      ctx.shadowBlur = nameSize * 0.35;
      ctx.fillStyle = textColor;

      // 文字自适应：先按扇区弧宽定字号，再按可用半径缩到刚好放得下
      const name = s.prize.name || '';
      const avail = Math.abs(x) - wheelR * 0.45;
      let fs = nameSize;
      ctx.font = `800 ${fs}px -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif`;
      let textW = ctx.measureText(name).width;
      if (textW > avail && avail > 14) {
        fs = Math.max(8, fs * (avail / textW));
        ctx.font = `800 ${fs}px -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif`;
        textW = ctx.measureText(name).width;
      }
      ctx.fillText(name, x, 0);

      // 副标题：只有扇区在该半径处足够宽（能容下两行而不压边）才画
      if (s.prize.level) {
        const lvlFs = fs * 0.58;
        const halfArc = (s.span * (Math.abs(x) - textW / 2)) / 2;
        if (halfArc > fs * 3) {
          ctx.shadowBlur = 0;
          ctx.fillStyle = subColor;
          ctx.font = `700 ${lvlFs}px -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif`;
          ctx.fillText(s.prize.level, x - dir * 2, fs * 0.92);
        }
      }
      ctx.restore();
    });

    // 中心凹陷
    const hubR = wheelR * 0.235;
    const hubGrad = ctx.createRadialGradient(0, -hubR * 0.3, 0, 0, 0, hubR);
    hubGrad.addColorStop(0, '#22232e');
    hubGrad.addColorStop(1, '#05050a');
    ctx.beginPath();
    ctx.arc(0, 0, hubR, 0, Math.PI * 2);
    ctx.fillStyle = hubGrad;
    ctx.fill();
    ctx.restore(); // 结束盘面旋转

    ctx.restore();
  }, []);

  /* ---------------- 主循环 ---------------- */

  useEffect(() => {
    const canvas = canvasRef.current;
    const shell = shellRef.current;
    if (!canvas || !shell) return undefined;

    const ctx = canvas.getContext('2d');
    let raf = 0;
    let last = performance.now();

    const resize = () => {
      // 布局尺寸完全由 CSS 决定（width: min(100%, 540px)），这里只按实际渲染尺寸设置画布像素
      const S = Math.round(shell.clientWidth || 0);
      if (!S) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
      const px = Math.round(S * dpr);
      if (canvas.width !== px || canvas.height !== px) {
        canvas.width = px;
        canvas.height = px;
      }
      stateRef.current.size = S;
      stateRef.current.dpr = dpr;
    };

    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(shell);

    const frame = (now) => {
      const dt = Math.min(50, now - last);
      last = now;
      const st = stateRef.current;
      const S = st.size;
      if (!S) { raf = requestAnimationFrame(frame); return; }
      const R = S / 2;

      // 惯性衰减 / 静止
      if (!st.spinning) {
        if (Math.abs(st.speed) > 0.00005) {
          st.rotation += st.speed * dt;
          st.speed *= Math.pow(0.86, dt / 16.67);
          if (st.speed < 0) st.speed = 0;
        } else {
          st.speed = 0;
        }
      }

      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.setTransform(st.dpr, 0, 0, st.dpr, 0, 0);
      ctx.translate(R, R);

      const speed = Math.abs(st.speed) * 1000; // rad/s
      // 速度越高越模糊，但上限压住，保证高速时仍能看清盘面结构
      const step = speed / 60;
      const blurPx = step > 0.04 ? Math.min(3.2, step * 9) : 0;
      if (Math.abs(blurPx - (st.blurPx || 0)) > 0.2) {
        st.blurPx = blurPx;
        canvas.style.filter = blurPx > 0.2 ? `blur(${blurPx.toFixed(1)}px)` : 'none';
      }

      drawWheel(ctx, S, R, st.rotation, 1, now, speed);

      // 指针经过分隔线的判定（只在实际旋转时发声）
      if (Math.abs(st.speed) > 0.0008) {
        const local = normalize(-Math.PI / 2 - st.rotation);
        const secs = sectorsRef.current;
        let idx = -1;
        for (let i = 0; i < secs.length; i++) {
          const s = secs[i];
          if (normalize(s.start) <= local && local < normalize(s.start) + s.span) { idx = i; break; }
        }
        if (idx !== st.lastTickIndex) {
          if (st.lastTickIndex !== -1 && speed > 1.2) {
            sfx.tick(Math.min(1, speed / 22));
            const p = pointerRef.current;
            if (p && speed < 11) {
              p.classList.remove('kick');
              void p.offsetWidth;
              p.classList.add('kick');
            }
          }
          st.lastTickIndex = idx;
        }
      }

      raf = requestAnimationFrame(frame);
    };

    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [drawWheel]);

  /* ---------------- 对外：转到指定奖品 ---------------- */

  const spinTo = useCallback((prizeId, { duration = 6200, turns = 4 } = {}) => new Promise((resolve) => {
    const secs = sectorsRef.current;
    const st = stateRef.current;
    const target = secs.find((s) => s.prize.id === prizeId);
    if (!target) { resolve(false); return; }

    // 落点：扇区中心 ± 40% 内的随机偏移，避免每次都停在正中
    const jitter = (Math.random() - 0.5) * target.span * 0.7;
    const wanted = normalize(-Math.PI / 2 - (target.mid + jitter));
    const current = st.rotation;
    let goal = wanted;
    while (goal < current + Math.PI * 2 * turns) goal += Math.PI * 2;

    const from = current;
    const delta = goal - from;
    const ease = (t) => 1 - Math.pow(1 - t, 4.15);
    const start = performance.now();
    st.spinning = true;
    st.speed = 0;
    setBusy(true);

    const step = (now) => {
      const t = Math.min(1, (now - start) / duration);
      st.rotation = from + delta * ease(t);
      // 真实角速度（rad/ms）：对 easeOutQuart 求导
      st.speed = (delta * 4.15 * Math.pow(1 - t, 3.15)) / duration;
      if (t < 1) {
        requestAnimationFrame(step);
      } else {
        // 落定：轻微回弹，模拟真实转盘的机械停位
        const settleStart = performance.now();
        const amp = 0.016;
        const settle = (n) => {
          const p = Math.min(1, (n - settleStart) / 620);
          st.rotation = goal + Math.sin(p * Math.PI * 2.2) * amp * (1 - p) ** 2;
          if (p < 1) requestAnimationFrame(settle);
          else {
            st.rotation = goal;
            st.speed = 0;
            st.spinning = false;
            st.lastTickIndex = -1;
            setBusy(false);
            resolve(true);
          }
        };
        requestAnimationFrame(settle);
      }
    };
    requestAnimationFrame(step);
  }), []);

  useImperativeHandle(ref, () => ({ spinTo }), [spinTo]);

  // 调试/校验钩子：用于自动化验证"指针最终确实停在目标扇区"
  useEffect(() => {
    window.__wheel = {
      rotation: () => stateRef.current.rotation,
      sectors: () => sectorsRef.current.map((s) => ({ id: s.prize.id, name: s.prize.name, start: s.start, span: s.span })),
    };
    return () => { delete window.__wheel; };
  }, []);

  const handleClick = () => {
    if (disabled) return;
    sfx.click();
    onSpin?.();
  };

  return (
    <div className={`wheel-stage ${className}`}>
      <div className="wheel-shell" ref={shellRef}>
        <div className={`wheel-glow ${busy ? 'spinning' : ''}`} />
        <canvas ref={canvasRef} className="wheel-canvas" />
        <div className="pointer" ref={pointerRef}>
          <svg viewBox="0 0 46 62" fill="none" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <linearGradient id="pg" x1="23" y1="0" x2="23" y2="62" gradientUnits="userSpaceOnUse">
                <stop stopColor="#FFF6DA" />
                <stop offset="0.45" stopColor="#FFC94D" />
                <stop offset="1" stopColor="#E8700C" />
              </linearGradient>
            </defs>
            <path d="M23 58 L9 16 A14 14 0 1 1 37 16 Z" fill="url(#pg)" stroke="#3a2405" strokeWidth="1.5" />
            <circle cx="23" cy="15" r="4.6" fill="#FFF8E4" opacity="0.95" />
          </svg>
        </div>
        <button
          type="button"
          className={`spin-btn ${disabled && !busy ? '' : 'pulsing'} ${busy ? 'is-spinning' : ''}`}
          onClick={handleClick}
          disabled={disabled}
        >
          <span>
            {buttonLabel || '开始抽奖'}
            {buttonSub ? <small>{buttonSub}</small> : null}
          </span>
        </button>
      </div>
    </div>
  );
});

export default Wheel;

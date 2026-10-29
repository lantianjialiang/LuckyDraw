/**
 * 纯 WebAudio 合成音效 —— 不依赖任何音频文件，首屏更轻。
 * 必须在用户手势中创建 AudioContext（浏览器自动播放策略）。
 */
class SoundEngine {
  constructor() {
    this.ctx = null;
    this.enabled = localStorage.getItem('ld_sound') !== 'off';
  }

  ensure() {
    if (!this.enabled) return null;
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      this.ctx = new AC();
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    return this.ctx;
  }

  setEnabled(on) {
    this.enabled = on;
    localStorage.setItem('ld_sound', on ? 'on' : 'off');
    if (on) this.ensure();
  }

  tone({ freq = 440, dur = 0.1, type = 'sine', gain = 0.08, delay = 0, sweep = null }) {
    const ctx = this.ensure();
    if (!ctx) return;
    const t0 = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (sweep) osc.frequency.exponentialRampToValueAtTime(Math.max(20, sweep), t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g).connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  }

  noise({ dur = 0.3, gain = 0.05, delay = 0, from = 4000, to = 400 }) {
    const ctx = this.ensure();
    if (!ctx) return;
    const t0 = ctx.currentTime + delay;
    const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(from, t0);
    filter.frequency.exponentialRampToValueAtTime(to, t0 + dur);
    filter.Q.value = 1.6;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(filter).connect(g).connect(ctx.destination);
    src.start(t0);
  }

  /** 转盘经过分区的滴答 */
  tick(speed = 1) {
    this.tone({ freq: 1450 * (0.9 + Math.random() * 0.2), dur: 0.035, type: 'square', gain: 0.022 * Math.min(1, speed) });
  }

  click() {
    this.tone({ freq: 620, dur: 0.05, type: 'triangle', gain: 0.05 });
  }

  /** 起转：低频下扫 + 风声 */
  whoosh() {
    this.noise({ dur: 0.7, gain: 0.06, from: 2600, to: 260 });
    this.tone({ freq: 180, dur: 0.55, type: 'sawtooth', gain: 0.045, sweep: 620 });
  }

  /** 中奖：大三和弦琶音 + 星光 */
  win() {
    const notes = [523.25, 659.25, 783.99, 1046.5, 1318.5];
    notes.forEach((f, i) => {
      this.tone({ freq: f, dur: 0.5, type: 'triangle', gain: 0.075, delay: i * 0.08 });
      this.tone({ freq: f * 2, dur: 0.32, type: 'sine', gain: 0.028, delay: i * 0.08 });
    });
    this.noise({ dur: 1.1, gain: 0.035, delay: 0.12, from: 9000, to: 3000 });
  }

  /** 未中奖：柔和的下降 */
  lose() {
    [392, 329.63, 261.63].forEach((f, i) => {
      this.tone({ freq: f, dur: 0.4, type: 'sine', gain: 0.06, delay: i * 0.12 });
    });
  }
}

export const sfx = new SoundEngine();

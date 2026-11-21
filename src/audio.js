/**
 * 使用 WebAudio 实时合成的音效，不依赖任何音频文件。
 */
export class Sound {
  constructor(enabled = true) {
    this.enabled = enabled;
    this.ctx = null;
    this.master = null;
    this.noiseBuffer = null;
  }

  ensure() {
    if (!this.enabled) return false;
    if (!this.ctx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return false;
      this.ctx = new Ctx();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.55;
      this.master.connect(this.ctx.destination);

      const length = Math.floor(this.ctx.sampleRate * 0.4);
      const buffer = this.ctx.createBuffer(1, length, this.ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
      this.noiseBuffer = buffer;
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    return true;
  }

  tone({ freq = 440, endFreq = null, type = 'sine', dur = 0.12, vol = 0.15, delay = 0 }) {
    if (!this.ensure()) return;
    const ctx = this.ctx;
    const t0 = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (endFreq) osc.frequency.exponentialRampToValueAtTime(Math.max(20, endFreq), t0 + dur);
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(vol, t0 + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(gain).connect(this.master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  }

  noise({ dur = 0.12, vol = 0.15, freq = 800, q = 1, delay = 0, type = 'lowpass' }) {
    if (!this.ensure()) return;
    const ctx = this.ctx;
    const t0 = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = freq;
    filter.Q.value = q;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(vol, t0);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(filter).connect(gain).connect(this.master);
    src.start(t0);
    src.stop(t0 + dur + 0.02);
  }

  select() {
    this.tone({ freq: 720, endFreq: 960, type: 'sine', dur: 0.07, vol: 0.05 });
  }

  move() {
    this.tone({ freq: 190, endFreq: 95, type: 'triangle', dur: 0.14, vol: 0.12 });
    this.noise({ dur: 0.05, vol: 0.05, freq: 1400 });
  }

  /** 走子时棋子划过棋盘的气声（吃子前奏） */
  slide() {
    this.noise({ dur: 0.13, vol: 0.055, freq: 1900, type: 'bandpass', q: 0.8 });
  }

  /**
   * 吃子命中：低频下潜 + 中频碎裂 + 高频脆响 + 碎片落桌的二次撞击。
   * 分层叠加 + 长尾是打击感的主要来源。
   */
  impact(power = 1) {
    // 低频冲击：给"重量"，尾巴拉长一点更像爆开
    this.tone({ freq: 74, endFreq: 26, type: 'sine', dur: 0.4, vol: 0.34 * power });
    this.tone({ freq: 168, endFreq: 72, type: 'triangle', dur: 0.18, vol: 0.16 * power });
    // 碎裂主体
    this.noise({ dur: 0.36, vol: 0.18 * power, freq: 1100 });
    // 脆响与硬边
    this.noise({ dur: 0.12, vol: 0.26 * power, freq: 3200, type: 'bandpass', q: 0.7 });
    this.noise({ dur: 0.045, vol: 0.2 * power, freq: 5400, type: 'bandpass', q: 0.9, delay: 0.012 });
    // 碎片落地
    this.noise({ dur: 0.06, vol: 0.12 * power, freq: 2500, delay: 0.2, type: 'bandpass', q: 1.1 });
    this.noise({ dur: 0.09, vol: 0.08 * power, freq: 1200, delay: 0.26 });
  }

  capture(power = 1) {
    this.impact(power);
  }

  castle() {
    this.tone({ freq: 200, endFreq: 100, type: 'triangle', dur: 0.12, vol: 0.11 });
    this.tone({ freq: 200, endFreq: 100, type: 'triangle', dur: 0.14, vol: 0.1, delay: 0.14 });
  }

  check() {
    this.tone({ freq: 880, type: 'sine', dur: 0.12, vol: 0.09 });
    this.tone({ freq: 1320, type: 'sine', dur: 0.18, vol: 0.07, delay: 0.1 });
  }

  promote() {
    [523, 659, 784, 1046].forEach((f, i) =>
      this.tone({ freq: f, type: 'sine', dur: 0.16, vol: 0.07, delay: i * 0.07 })
    );
  }

  start() {
    this.tone({ freq: 260, endFreq: 520, type: 'sine', dur: 0.4, vol: 0.07 });
    this.noise({ dur: 0.3, vol: 0.04, freq: 600 });
  }

  end(result) {
    if (result === 'win') {
      [523, 659, 784, 1046].forEach((f, i) =>
        this.tone({ freq: f, type: 'triangle', dur: 0.5, vol: 0.08, delay: i * 0.12 })
      );
    } else if (result === 'lose') {
      [392, 330, 262].forEach((f, i) =>
        this.tone({ freq: f, type: 'sine', dur: 0.6, vol: 0.08, delay: i * 0.15 })
      );
    } else {
      [523, 415].forEach((f, i) =>
        this.tone({ freq: f, type: 'sine', dur: 0.5, vol: 0.07, delay: i * 0.16 })
      );
    }
  }
}

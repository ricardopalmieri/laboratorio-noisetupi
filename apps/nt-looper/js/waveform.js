// waveform.js

class NSWaveformView {
  constructor(canvas, options = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.fullPeaks = null;
    this.livePeaks = [];
    this.mode = 'idle';
    this.playhead = 0;
    this.recRatio = 0;
    this.fixedPeakCount = 0;
    this.trimStart = 0;
    this.trimEnd = 1;
    this.showTrim = !!options.showTrim;
    this.deferLiveRender = false;
    this._colorCache = new Map();
    this._resize = this._resize.bind(this);
    this._observer = new ResizeObserver(this._resize);
    this._observer.observe(canvas.parentElement);
    this._resize();
  }

  color(name, fallback) {
    if (!this._colorCache.has(name)) {
      this._colorCache.set(name, getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback);
    }
    return this._colorCache.get(name);
  }

  _resize() {
    const rect = this.canvas.parentElement.getBoundingClientRect();
    const ratio = document.documentElement.classList.contains('ipad-compat')
      ? 1
      : Math.min(2, window.devicePixelRatio || 1);
    this.canvas.width = Math.max(1, Math.round(rect.width * ratio));
    this.canvas.height = Math.max(1, Math.round(rect.height * ratio));
    this.render();
  }

  setLive() {
    this.mode = 'live';
    this.livePeaks = [];
    this.fullPeaks = null;
    this.recRatio = 0;
    this.fixedPeakCount = 0;
    this.render();
  }
  setLiveFixed(targetSec) {
    this.setLive();
    this.mode = 'live-fixed';
    this.fixedPeakCount = Math.max(1, Math.ceil(Math.max(0, Number(targetSec) || 0) / 0.02));
  }
  setRecProgress(ratio) { this.recRatio = Math.max(0, Math.min(1, Number(ratio) || 0)); }
  pushLivePeak(value) {
    if (this.mode.startsWith('live')) {
      this.livePeaks.push(value);
      if (!this.deferLiveRender) this.render();
    }
  }
  setFull(peaks) {
    this.fullPeaks = peaks && peaks.length ? peaks : null;
    this.mode = this.fullPeaks ? 'full' : 'idle';
    this.render();
  }
  setPlayhead(ratio) { this.playhead = ratio || 0; }
  setTrim(start, end) { this.trimStart = start; this.trimEnd = end; this.render(); }
  clear() { this.fullPeaks = null; this.livePeaks = []; this.mode = 'idle'; this.playhead = 0; this.fixedPeakCount = 0; this.render(); }

  render() {
    const ctx = this.ctx;
    const width = this.canvas.width;
    const height = this.canvas.height;
    const middle = height * 0.5;
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = this.color('--display', '#070807');
    ctx.fillRect(0, 0, width, height);

    ctx.strokeStyle = this.color('--line', '#2d302e');
    ctx.lineWidth = 1;
    for (let i = 1; i < 4; i++) {
      const x = width * i / 4;
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, height); ctx.stroke();
    }
    ctx.beginPath(); ctx.moveTo(0, middle); ctx.lineTo(width, middle); ctx.stroke();

    const peaks = this.mode === 'full' ? this.fullPeaks : this.livePeaks;
    if (peaks && peaks.length) {
      const count = peaks.length;
      const step = Math.max(1, Math.ceil(count / width));
      ctx.save();
      ctx.strokeStyle = this.color('--wave', '#e7ddd0');
      ctx.shadowColor = this.color('--red-soft', '#ef4b52');
      ctx.shadowBlur = document.documentElement.classList.contains('ipad-compat') ? 0 : 4;
      ctx.lineWidth = Math.max(1, width / Math.max(1, count) * 0.7);
      ctx.beginPath();
      for (let i = 0; i < count; i += step) {
        const denominator = this.mode === 'live-fixed'
          ? Math.max(1, this.fixedPeakCount - 1)
          : Math.max(1, count - 1);
        const x = Math.min(width, (i / denominator) * width);
        const amplitude = Math.min(1, peaks[i]) * height * 0.44;
        ctx.moveTo(x, middle - amplitude);
        ctx.lineTo(x, middle + amplitude);
      }
      ctx.stroke();
      ctx.restore();
    }

    if (this.showTrim && this.mode === 'full') {
      ctx.fillStyle = 'rgba(0,0,0,.62)';
      ctx.fillRect(0, 0, this.trimStart * width, height);
      ctx.fillRect(this.trimEnd * width, 0, (1 - this.trimEnd) * width, height);
      ctx.strokeStyle = this.color('--amber', '#e6a94f');
      ctx.lineWidth = 2;
      ctx.strokeRect(this.trimStart * width, 1, Math.max(1, (this.trimEnd - this.trimStart) * width), height - 2);
    }

    if (this.mode === 'full') {
      const x = this.playhead * width;
      ctx.fillStyle = this.color('--green', '#77d98c');
      ctx.fillRect(x, 0, Math.max(1, width / 600), height);
    }
  }
}

class NSRadialWaveformView {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.peaks = null;
    this.progress = 0;
    this.state = 'EMPTY';
    this._observer = new ResizeObserver(() => this.resize());
    this._observer.observe(canvas.parentElement);
    this.resize();
  }

  resize() {
    const rect = this.canvas.parentElement.getBoundingClientRect();
    const ratio = document.documentElement.classList.contains('ipad-compat')
      ? 1
      : Math.min(2, window.devicePixelRatio || 1);
    this.canvas.width = Math.max(1, Math.round(rect.width * ratio));
    this.canvas.height = Math.max(1, Math.round(rect.height * ratio));
    this.render();
  }

  setPeaks(peaks) { this.peaks = peaks && peaks.length ? peaks : null; this.render(); }
  setProgress(value) { this.progress = value || 0; }
  setState(state) { this.state = state; this.render(); }
  clear() { this.peaks = null; this.progress = 0; this.state = 'EMPTY'; this.render(); }

  render() {
    const ctx = this.ctx;
    const width = this.canvas.width;
    const height = this.canvas.height;
    const cx = width * 0.5;
    const cy = height * 0.5;
    const base = Math.min(width, height) * 0.34;
    ctx.clearRect(0, 0, width, height);
    if (!this.peaks || !this.peaks.length) return;
    const count = Math.min(180, this.peaks.length);
    const color = this.state === 'RECORDING' ? '#ef3d47'
      : this.state === 'OVERDUBBING' ? '#e6a94f'
      : this.state === 'PLAYING' ? '#77d98c' : '#9b9d98';
    ctx.save();
    ctx.lineWidth = Math.max(1, width / 180);
    ctx.shadowColor = color;
    ctx.shadowBlur = document.documentElement.classList.contains('ipad-compat') ? 0 : 4;
    for (let i = 0; i < count; i++) {
      const sourceIndex = Math.floor(i / count * this.peaks.length);
      const amplitude = Math.min(1, this.peaks[sourceIndex]);
      const angle = -Math.PI / 2 + i / count * Math.PI * 2;
      const inner = base;
      const outer = base + Math.max(3, amplitude * width * 0.13);
      ctx.strokeStyle = i / count <= this.progress ? color : 'rgba(155,157,152,.32)';
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(angle) * inner, cy + Math.sin(angle) * inner);
      ctx.lineTo(cx + Math.cos(angle) * outer, cy + Math.sin(angle) * outer);
      ctx.stroke();
    }
    ctx.restore();
  }
}

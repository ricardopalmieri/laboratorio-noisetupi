// Banco de 16 pads locais, sincronizado ao BPM mestre.

const NS_SAMPLER_PAD_COUNT = 16;

function ns_samplerPeaks(buffer, count = 512) {
  const peaks = new Float32Array(count);
  const channels = Math.min(2, buffer.numberOfChannels);
  const step = Math.max(1, Math.floor(buffer.length / count));
  for (let index = 0; index < count; index++) {
    const start = index * step;
    const end = Math.min(buffer.length, start + step);
    let peak = 0;
    for (let channel = 0; channel < channels; channel++) {
      const data = buffer.getChannelData(channel);
      for (let sample = start; sample < end; sample++) peak = Math.max(peak, Math.abs(data[sample]));
    }
    peaks[index] = peak;
  }
  return peaks;
}

class NSSamplerBank {
  constructor(ctx, destination, getMasterBpm) {
    this.ctx = ctx;
    this.getMasterBpm = getMasterBpm;
    this.output = ctx.createGain();
    this.masterGain = 0.9;
    this.output.gain.value = this.masterGain;
    this.output.connect(destination);
    this.onStateChange = null;
    this.pads = Array.from({ length: NS_SAMPLER_PAD_COUNT }, (_, index) => ({
      index,
      name: `PAD ${index + 1}`,
      originalBuffer: null,
      renderedBuffer: null,
      peaks: null,
      bpm: 120,
      trimStart: 0,
      trimEnd: 1,
      direction: 'NORMAL',
      trigger: 'PLAY',
      volume: 1,
      voice: null,
      active: false,
    }));
  }

  pad(index) { return this.pads[Math.max(0, Math.min(NS_SAMPLER_PAD_COUNT - 1, Number(index)))]; }

  notify(index) {
    if (this.onStateChange) this.onStateChange(index, this.pad(index));
  }

  rateFor(pad) {
    const sourceBpm = Math.max(20, Math.min(400, Number(pad.bpm) || 120));
    return Math.max(0.2, Math.min(4, Number(this.getMasterBpm()) / sourceBpm));
  }

  async loadFile(index, file) {
    const bytes = await file.arrayBuffer();
    return this.loadBytes(index, bytes, file.name || `pad-${Number(index) + 1}`);
  }

  async loadBytes(index, bytes, name) {
    const pad = this.pad(index);
    this.stop(index);
    const arrayBuffer = bytes instanceof ArrayBuffer
      ? bytes.slice(0)
      : bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    const decoded = await this.ctx.decodeAudioData(arrayBuffer);
    pad.originalBuffer = decoded;
    pad.name = String(name || `PAD ${pad.index + 1}`).replace(/\.[^.]+$/, '').slice(0, 28);
    pad.trimStart = 0;
    pad.trimEnd = 1;
    pad.peaks = ns_samplerPeaks(decoded);
    this.rebuild(pad);
    this.notify(pad.index);
    return pad;
  }

  rebuild(pad) {
    if (!pad.originalBuffer) { pad.renderedBuffer = null; return; }
    const source = pad.originalBuffer;
    const start = Math.max(0, Math.min(source.length - 1, Math.floor(pad.trimStart * source.length)));
    const end = Math.max(start + 1, Math.min(source.length, Math.ceil(pad.trimEnd * source.length)));
    const span = end - start;
    const pingpong = pad.direction === 'PINGPONG';
    const outputLength = pingpong ? span * 2 : span;
    const output = this.ctx.createBuffer(Math.min(2, source.numberOfChannels), outputLength, source.sampleRate);
    for (let channel = 0; channel < output.numberOfChannels; channel++) {
      const input = source.getChannelData(channel);
      const data = output.getChannelData(channel);
      for (let sample = 0; sample < span; sample++) {
        const sourceIndex = pad.direction === 'REVERSE' ? end - 1 - sample : start + sample;
        data[sample] = input[sourceIndex];
      }
      if (pingpong) {
        for (let sample = 0; sample < span; sample++) data[span + sample] = input[end - 1 - sample];
      }
    }
    pad.renderedBuffer = output;
  }

  setTrim(index, start, end) {
    const pad = this.pad(index);
    pad.trimStart = Math.max(0, Math.min(0.999, Number(start) || 0));
    pad.trimEnd = Math.max(pad.trimStart + 0.001, Math.min(1, Number(end) || 1));
    this.stop(index);
    this.rebuild(pad);
    this.notify(pad.index);
  }

  setBpm(index, bpm) {
    const pad = this.pad(index);
    pad.bpm = Math.max(20, Math.min(400, Number(bpm) || 120));
    if (pad.voice) pad.voice.source.playbackRate.setTargetAtTime(this.rateFor(pad), this.ctx.currentTime, 0.01);
    this.notify(pad.index);
  }

  setDirection(index, direction) {
    const pad = this.pad(index);
    pad.direction = ['NORMAL', 'REVERSE', 'PINGPONG'].includes(direction) ? direction : 'NORMAL';
    this.stop(index);
    this.rebuild(pad);
    this.notify(pad.index);
  }

  setTrigger(index, trigger) {
    const pad = this.pad(index);
    pad.trigger = ['GATE', 'TOGGLE', 'PLAY'].includes(trigger) ? trigger : 'PLAY';
    this.stop(index);
    this.notify(pad.index);
  }

  setVolume(index, value) {
    const pad = this.pad(index);
    pad.volume = Math.max(0, Math.min(1.5, Number(value) || 0));
    if (pad.voice) pad.voice.gain.gain.setTargetAtTime(pad.volume, this.ctx.currentTime, 0.02);
    this.notify(pad.index);
  }

  setMasterGain(value) {
    this.masterGain = Math.max(0, Math.min(1.5, Number(value) || 0));
    this.output.gain.setTargetAtTime(this.masterGain, this.ctx.currentTime, 0.02);
  }

  start(index, loop) {
    const pad = this.pad(index);
    if (!pad.renderedBuffer) return false;
    this.stop(index, false);
    const source = this.ctx.createBufferSource();
    const gain = this.ctx.createGain();
    source.buffer = pad.renderedBuffer;
    source.loop = !!loop;
    source.playbackRate.value = this.rateFor(pad);
    gain.gain.value = pad.volume;
    source.connect(gain).connect(this.output);
    const voice = { source, gain };
    pad.voice = voice;
    pad.active = true;
    source.onended = () => {
      if (pad.voice !== voice) return;
      pad.voice = null;
      pad.active = false;
      this.notify(pad.index);
    };
    source.start(0);
    this.notify(pad.index);
    return true;
  }

  stop(index, notify = true, atTime = null) {
    const pad = this.pad(index);
    const voice = pad.voice;
    if (!voice) return;
    pad.voice = null;
    pad.active = false;
    const now = Math.max(this.ctx.currentTime, Number(atTime) || 0);
    try {
      voice.gain.gain.cancelScheduledValues(now);
      voice.gain.gain.setValueAtTime(Math.max(0, voice.gain.gain.value), now);
      voice.gain.gain.linearRampToValueAtTime(0, now + 0.03);
      voice.source.stop(now + 0.035);
    } catch (error) {}
    if (notify) this.notify(pad.index);
  }

  trigger(index) {
    const pad = this.pad(index);
    if (pad.trigger === 'GATE') return this.start(index, true);
    if (pad.trigger === 'TOGGLE') {
      if (pad.active) { this.stop(index); return false; }
      return this.start(index, true);
    }
    return this.start(index, false);
  }

  release(index) {
    const pad = this.pad(index);
    if (pad.trigger === 'GATE') this.stop(index);
  }

  syncBpm() {
    this.pads.forEach((pad) => {
      if (pad.voice) pad.voice.source.playbackRate.setTargetAtTime(this.rateFor(pad), this.ctx.currentTime, 0.012);
    });
  }

  clear(index) {
    const pad = this.pad(index);
    this.stop(index, false);
    pad.name = `PAD ${pad.index + 1}`;
    pad.originalBuffer = null;
    pad.renderedBuffer = null;
    pad.peaks = null;
    pad.trimStart = 0;
    pad.trimEnd = 1;
    this.notify(pad.index);
  }

  clearAll() { this.pads.forEach((pad) => this.clear(pad.index)); }

  stopAll(atTime = null) { this.pads.forEach((pad) => this.stop(pad.index, true, atTime)); }

  serialize() {
    return { masterGain: this.masterGain, pads: this.pads.map((pad) => ({
      name: pad.name,
      bpm: pad.bpm,
      trimStart: pad.trimStart,
      trimEnd: pad.trimEnd,
      direction: pad.direction,
      trigger: pad.trigger,
      volume: pad.volume,
    })) };
  }

  restore(saved) {
    const configs = Array.isArray(saved) ? saved : (saved && saved.pads) || [];
    if (!Array.isArray(saved) && saved) this.setMasterGain(saved.masterGain ?? 0.9);
    (configs || []).slice(0, NS_SAMPLER_PAD_COUNT).forEach((config, index) => {
      const pad = this.pad(index);
      pad.name = String(config.name || pad.name).slice(0, 28);
      pad.bpm = Math.max(20, Math.min(400, Number(config.bpm) || 120));
      pad.trimStart = Math.max(0, Math.min(0.999, Number(config.trimStart) || 0));
      pad.trimEnd = Math.max(pad.trimStart + 0.001, Math.min(1, Number(config.trimEnd) || 1));
      pad.direction = ['NORMAL', 'REVERSE', 'PINGPONG'].includes(config.direction) ? config.direction : 'NORMAL';
      pad.trigger = ['GATE', 'TOGGLE', 'PLAY'].includes(config.trigger) ? config.trigger : 'PLAY';
      pad.volume = Math.max(0, Math.min(1.5, Number(config.volume ?? 1)));
      this.rebuild(pad);
    });
  }

  exportOriginalWav(index) {
    const pad = this.pad(index);
    if (!pad.originalBuffer) return null;
    const left = pad.originalBuffer.getChannelData(0);
    const right = pad.originalBuffer.numberOfChannels > 1 ? pad.originalBuffer.getChannelData(1) : left;
    return ns_encodeStereoWav(left, right, pad.originalBuffer.sampleRate);
  }
}

// Relógio sample-accurate compartilhado pelo click e pelo quantize.

class NSTransportProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.enabled = false;
    this.originFrame = 0;
    this.beatSamples = Math.round(sampleRate * 0.5);
    this.beatsPerBar = 4;
    this.nextBeatFrame = 0;
    this.beatIndex = 0;
    this.phase = 0;
    this.envelope = 0;
    this.frequency = 880;
    this.port.onmessage = (event) => this.configure(event.data || {});
  }

  configure(message) {
    if (message.type === 'stop') {
      this.enabled = false;
      this.envelope = 0;
      return;
    }
    if (message.type !== 'configure') return;
    this.enabled = !!message.enabled;
    this.originFrame = Math.round(Number(message.originFrame) || 0);
    this.beatSamples = Math.max(1, Math.round(message.beatSamples || sampleRate * 0.5));
    this.beatsPerBar = Math.max(1, Math.round(message.beatsPerBar || 4));
    const elapsed = Math.max(0, currentFrame - this.originFrame);
    this.beatIndex = Math.floor(elapsed / this.beatSamples);
    this.nextBeatFrame = this.originFrame + this.beatIndex * this.beatSamples;
    if (this.nextBeatFrame < currentFrame) {
      this.beatIndex++;
      this.nextBeatFrame += this.beatSamples;
    }
    this.phase = 0;
    this.envelope = 0;
  }

  process(inputs, outputs) {
    const output = outputs[0] || [];
    const outL = output[0] || null;
    const outR = output[1] || output[0] || null;
    if (!outL) return true;
    const decay = Math.exp(-1 / (sampleRate * 0.018));

    for (let i = 0; i < outL.length; i++) {
      const frame = currentFrame + i;
      if (this.enabled && frame >= this.nextBeatFrame) {
        const accent = this.beatIndex % this.beatsPerBar === 0;
        this.frequency = accent ? 1320 : 880;
        this.phase = 0;
        this.envelope = accent ? 1 : 0.72;
        this.beatIndex++;
        this.nextBeatFrame += this.beatSamples;
      }
      const sample = this.enabled ? Math.sin(this.phase) * this.envelope : 0;
      outL[i] = sample;
      if (outR && outR !== outL) outR[i] = sample;
      this.phase += 2 * Math.PI * this.frequency / sampleRate;
      if (this.phase >= Math.PI * 2) this.phase -= Math.PI * 2;
      this.envelope *= decay;
      if (this.envelope < 0.00001) this.envelope = 0;
    }
    return true;
  }
}

registerProcessor('ns-transport', NSTransportProcessor);

// Processadores DSP rítmicos e de transformação, sem alocação no loop de áudio.
class NSControlPitchTracker {
  constructor(lowLatency = false) {
    this.sourceLength = lowLatency ? 1792 : 2304;
    this.analysisLength = this.sourceLength >> 1;
    this.lowLatency = !!lowLatency;
    this.ring = new Float32Array(this.sourceLength);
    this.analysis = new Float32Array(this.analysisLength);
    this.yin = new Float32Array(768);
    this.write = 0;
    this.filled = 0;
    this.counter = 0;
    this.interval = lowLatency ? 512 : 896;
    this.active = false;
    this.lag = 1;
    this.minLag = Math.max(2, Math.floor((sampleRate * 0.5) / 900));
    this.maxLag = Math.min(766, Math.ceil((sampleRate * 0.5) / 45));
    this.frequency = 0;
    this.confidence = 0;
    this.updated = false;
    this.age = sampleRate;
    this.history = new Float32Array(3);
    this.historyCount = 0;
    this.historyIndex = 0;
    this.pendingOctaveFrequency = 0;
    this.pendingOctaveCount = 0;
  }

  push(value) {
    this.ring[this.write] = Number.isFinite(value) ? value : 0;
    this.write = (this.write + 1) % this.sourceLength;
    this.filled = Math.min(this.sourceLength, this.filled + 1);
    this.counter++;
    this.age++;
    if (!this.active && this.filled >= this.sourceLength && this.counter >= this.interval) this.begin();
  }

  begin() {
    this.counter = 0;
    let mean = 0;
    let energy = 0;
    for (let i = 0; i < this.analysisLength; i++) {
      const a = (this.write + i * 2) % this.sourceLength;
      const value = (this.ring[a] + this.ring[(a + 1) % this.sourceLength]) * 0.5;
      this.analysis[i] = value;
      mean += value;
    }
    mean /= this.analysisLength;
    for (let i = 0; i < this.analysisLength; i++) {
      const value = this.analysis[i] - mean;
      this.analysis[i] = value;
      energy += value * value;
    }
    if (Math.sqrt(energy / this.analysisLength) < 0.004) return;
    this.yin.fill(0, 0, this.maxLag + 1);
    this.lag = 1;
    this.active = true;
  }

  advance(budget = 48) {
    this.updated = false;
    if (!this.active) return;
    const end = Math.min(this.maxLag, this.lag + budget - 1);
    const stride = this.lowLatency ? 4 : 2;
    for (let lag = this.lag; lag <= end; lag++) {
      let difference = 0;
      for (let i = 0; i < this.analysisLength - lag; i += stride) {
        const delta = this.analysis[i] - this.analysis[i + lag];
        difference += delta * delta;
      }
      this.yin[lag] = difference;
    }
    this.lag = end + 1;
    if (this.lag <= this.maxLag) return;
    let running = 0;
    for (let lag = 1; lag <= this.maxLag; lag++) {
      running += this.yin[lag];
      this.yin[lag] = running > 0 ? this.yin[lag] * lag / running : 1;
    }
    let bestLag = 0;
    let bestValue = 1;
    for (let lag = this.minLag; lag < this.maxLag; lag++) {
      const value = this.yin[lag];
      if (value < bestValue) { bestValue = value; bestLag = lag; }
      if (value < 0.17 && value <= this.yin[lag + 1]) { bestValue = value; bestLag = lag; break; }
    }
    this.active = false;
    if (!bestLag || bestValue > 0.3) return;
    const previous = this.yin[Math.max(1, bestLag - 1)];
    const center = this.yin[bestLag];
    const next = this.yin[Math.min(this.maxLag, bestLag + 1)];
    const denominator = 2 * (2 * center - previous - next);
    const refined = denominator ? bestLag + (next - previous) / denominator : bestLag;
    let frequency = (sampleRate * 0.5) / Math.max(1, refined);
    if (!(frequency >= 45 && frequency <= 900)) return;
    const confidence = Math.max(0, Math.min(1, 1 - bestValue));
    // Não dobre automaticamente a leitura para ficar perto da nota anterior.
    // Esse truque impedia uma oitava realmente cantada de subir no G2B. Um salto
    // próximo de 2:1 agora precisa apenas de duas leituras coerentes, suficiente
    // para rejeitar um erro isolado sem prender a voz na oitava de baixo.
    let acceptedOctaveJump = false;
    if (this.frequency > 0 && this.age < sampleRate * 0.2) {
      const ratio = frequency / this.frequency;
      const octaveJump = (ratio > 1.82 && ratio < 2.18) || (ratio > 0.46 && ratio < 0.55);
      if (octaveJump && confidence < 0.985) {
        const coherent = this.pendingOctaveFrequency > 0
          && Math.abs(Math.log2(frequency / this.pendingOctaveFrequency)) < 0.075;
        this.pendingOctaveFrequency = frequency;
        this.pendingOctaveCount = coherent ? this.pendingOctaveCount + 1 : 1;
        if (this.pendingOctaveCount < 2) return;
        acceptedOctaveJump = true;
      } else {
        this.pendingOctaveFrequency = 0;
        this.pendingOctaveCount = 0;
      }
    }
    if (acceptedOctaveJump) {
      this.historyCount = 0;
      this.historyIndex = 0;
      this.pendingOctaveFrequency = 0;
      this.pendingOctaveCount = 0;
    }
    this.history[this.historyIndex] = Math.log2(frequency);
    this.historyIndex = (this.historyIndex + 1) % this.history.length;
    this.historyCount = Math.min(this.history.length, this.historyCount + 1);
    if (this.historyCount === 3) {
      const a = this.history[0], b = this.history[1], c = this.history[2];
      frequency = Math.pow(2, Math.max(Math.min(a, b), Math.min(Math.max(a, b), c)));
    }
    this.frequency = acceptedOctaveJump || this.frequency <= 0
      ? frequency
      : this.frequency + (frequency - this.frequency) * (0.35 + confidence * 0.5);
    this.confidence = confidence;
    this.age = 0;
    this.updated = true;
  }

  get voicedFrequency() {
    return this.age < sampleRate * 0.14 && this.confidence >= 0.66 ? this.frequency : 0;
  }
}

class NSAdvancedFxProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.mode = options.processorOptions.mode;
    const lowLatency = !!options.processorOptions.lowLatency;
    this.params = Object.assign({ bpm: 120, transportOriginFrame: 0, division: 4, direction: 0, feedback: 0.45, intensity: 0.7, pattern: 0, seed: 1337, amount: 1, rate: 4, depth: 0.8, duty: 0.5, attack: 0.02, sustain: 0.7, release: 0.12, gesture: 0, inertia: 0.7, friction: 0.3, returnSpeed: 0.4, frequency: 110, resonance: 0.5, tracking: 0.7, octave1: 1, octave2: 0, direct: 0, drive: 0.3, noise: 0.08 } , options.processorOptions.defaults || {});
    // Buffers enormes por instância pressionam memória e garbage collection no
    // WebKit. O main thread escolhe 4 s no iPad e 7 s no desktop.
    const maxBufferSeconds = Math.max(2, Math.min(8, Number(options.processorOptions.maxBufferSeconds) || 7));
    this.size = Math.ceil(sampleRate * maxBufferSeconds);
    this.left = new Float32Array(this.size);
    this.right = new Float32Array(this.size);
    this.write = 0;
    this.read = 0;
    this.phase = 0;
    this.oscPhase = 0;
    this.generatedFrequency = Math.max(30, this.params.frequency || 110);
    this.pitchTracker = (this.mode === 'synth' || this.mode === 'g2b' || this.mode === 'octave') ? new NSControlPitchTracker(lowLatency) : null;
    this.env = 0;
    this.holdL = 0;
    this.holdR = 0;
    this.filterL = 0;
    this.filterR = 0;
    this.highpassL = 0;
    this.highpassR = 0;
    this.highpassInputL = 0;
    this.highpassInputR = 0;
    this.repeatSlice = -1;
    this.repeatAnchor = 0;
    this.scatterStep = -1;
    this.scatterJitter = 0;
    this.scatterChoice = 0;
    this.scatterDirection = false;
    this.freezeAnchor = 0;
    this.vinylRead = 0;
    this.vinylSpeed = 1;
    this.vinylReady = false;
    this.oscPhase2 = 0;
    this.totalSamples = 0;
    this.rng = this.params.seed >>> 0;
    this.port.onmessage = (event) => {
      const message = event.data || {};
      if (message.type === 'param') {
        this.params[message.id] = Number(message.value);
        if (message.id === 'seed') this.rng = Number(message.value) >>> 0;
      }
    };
  }

  random() {
    let x = this.rng || 1;
    x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
    this.rng = x >>> 0;
    return this.rng / 4294967295;
  }

  at(buffer, index) {
    let position = index % this.size;
    if (position < 0) position += this.size;
    const a = Math.floor(position), b = (a + 1) % this.size, mix = position - a;
    return buffer[a] + (buffer[b] - buffer[a]) * mix;
  }

  safe(value) { return Math.tanh(value * 0.88) / 0.706419; }

  process(inputs, outputs) {
    const input = inputs[0] || [];
    const output = outputs[0];
    if (!output || !output[0]) return true;
    const inL = input[0] || output[0];
    const inR = input[1] || inL;
    const outL = output[0], outR = output[1] || output[0];
    const beat = sampleRate * 60 / Math.max(30, this.params.bpm);
    const division = Math.max(1, Math.round(this.params.division));
    const slice = Math.max(24, Math.round(beat * 4 / division));
    const bar = Math.max(slice, Math.min(this.size - 4, Math.round(beat * 4)));
    const pitchTrackingActive = this.pitchTracker && Number(this.params.tracking) > 0.01;
    if (pitchTrackingActive) this.pitchTracker.advance(48);
    for (let i = 0; i < outL.length; i++) {
      const l = inL[i] || 0, r = inR[i] || 0;
      if (pitchTrackingActive) this.pitchTracker.push((l + r) * 0.5);
      this.left[this.write] = l;
      this.right[this.write] = r;
      let wetL = l, wetR = r;
      const origin = Math.round(Number(this.params.transportOriginFrame) || 0);
      const transportOptional = this.mode === 'beat-repeat' || this.mode === 'beat-shift';
      const useTransport = origin !== 0 && (!transportOptional || this.params.quantize > 0.5);
      const musicalPhase = useTransport ? Math.max(0, currentFrame + i - origin) : this.phase;
      const phaseInSlice = musicalPhase % slice;
      if (this.mode === 'beat-repeat' || this.mode === 'roll') {
        const sliceIndex = Math.floor(musicalPhase / slice);
        if (sliceIndex !== this.repeatSlice) {
          this.repeatSlice = sliceIndex;
          this.repeatAnchor = this.write - slice;
        }
        const direction = Math.round(this.params.direction);
        const reverse = direction === 1 || (direction === 2 && (sliceIndex & 1));
        const pos = this.repeatAnchor + (reverse ? slice - 1 - phaseInSlice : phaseInSlice);
        const gate = Math.max(0.02, Math.min(1, Number(this.params.gate ?? 1)));
        const gateOpen = phaseInSlice / slice <= gate;
        wetL = gateOpen ? this.at(this.left, pos) : 0;
        wetR = gateOpen ? this.at(this.right, pos) : 0;
        const feedback = Math.max(0, Math.min(0.92, Number(this.params.feedback) || 0));
        this.left[this.write] = this.safe(l + wetL * feedback * 0.32);
        this.right[this.write] = this.safe(r + wetR * feedback * 0.32);
      } else if (this.mode === 'beat-scatter') {
        const pattern = Math.round(this.params.pattern) % 8;
        const stepSamples = Math.max(16, Math.round(slice / 4));
        const step = Math.floor(musicalPhase / stepSamples);
        if (step !== this.scatterStep) {
          this.scatterStep = step;
          if (this.params.retrigger > 0.5 && musicalPhase % bar < stepSamples) this.rng = (Number(this.params.seed) || 1337) >>> 0;
          const table = [0, 2, 1, 3, 3, 1, 0, 2];
          this.scatterChoice = table[(step + pattern) % table.length];
          this.scatterJitter = Math.floor(Math.max(0, Math.min(1, this.params.intensity)) * this.random() * stepSamples * 0.8);
          this.scatterDirection = this.params.direction > 0.5 || ((pattern + step) % 3 === 0);
        }
        const local = musicalPhase % stepSamples;
        const pos = this.write - this.scatterChoice * stepSamples - this.scatterJitter
          - (this.scatterDirection ? stepSamples - 1 - local : local);
        wetL = this.at(this.left, pos); wetR = this.at(this.right, pos);
      } else if (this.mode === 'beat-shift') {
        const offset = Math.max(1, Math.min(bar - 1, Math.round(beat * this.params.amount)));
        if (this.params.direction > 0.5) {
          // FUTURE usa o próximo trecho do compasso anterior já capturado. Isso
          // entrega o gesto musical sem tentar ler amostras que ainda não existem.
          const phaseInBar = musicalPhase % bar;
          const pos = this.write - phaseInBar - bar + ((phaseInBar + offset) % bar);
          wetL = this.at(this.left, pos); wetR = this.at(this.right, pos);
        } else {
          wetL = this.at(this.left, this.write - offset); wetR = this.at(this.right, this.write - offset);
        }
      } else if (this.mode === 'vinyl-flick') {
        if (!this.vinylReady && this.totalSamples > slice) {
          this.vinylRead = this.write - slice;
          this.vinylReady = true;
        }
        const gesture = Math.max(-1, Math.min(1, Number(this.params.gesture) || 0));
        const requested = Math.abs(gesture) > 0.01 ? gesture * 2.5 : 1;
        const inertia = Math.max(0, Math.min(1, Number(this.params.inertia) || 0));
        const friction = Math.max(0, Math.min(1, Number(this.params.friction) || 0));
        const returnSpeed = Math.max(0, Math.min(1, Number(this.params.returnSpeed) || 0));
        const response = 0.0005 + (1 - inertia) * 0.014;
        const target = Math.abs(gesture) > 0.01 ? requested * (1 - friction * 0.35) : 1;
        this.vinylSpeed += (target - this.vinylSpeed) * (Math.abs(gesture) > 0.01 ? response : 0.0004 + returnSpeed * 0.012);
        this.vinylRead += this.vinylSpeed;
        if (this.vinylRead > this.write - 2) this.vinylRead = this.write - 2;
        if (this.write - this.vinylRead > bar * 2) this.vinylRead = this.write - bar;
        wetL = this.at(this.left, this.vinylRead); wetR = this.at(this.right, this.vinylRead);
      } else if (this.mode === 'pattern-slicer' || this.mode === 'step-slicer') {
        const steps = this.mode === 'step-slicer' ? 16 : 20;
        const stepSamples = Math.max(1, Math.round(beat / Math.max(1, this.params.rate)));
        const step = Math.floor(musicalPhase / stepSamples) % steps;
        let level = 1;
        if (this.mode === 'step-slicer') level = this.params[`step${step}`] ?? ((step & 1) ? 0.2 : 1);
        else level = (((Math.round(this.params.pattern) * 13 + step * 7) % 11) < 6) ? 1 : 0;
        const edge = musicalPhase % stepSamples;
        const duty = this.mode === 'pattern-slicer' ? Math.max(0.05, Math.min(0.95, this.params.duty)) : 1;
        if (edge > stepSamples * duty) level = 0;
        const attack = Math.min(1, edge / Math.max(1, stepSamples * Math.max(0.002, this.params.attack)));
        const release = Math.min(1, (stepSamples - edge) / Math.max(1, stepSamples * 0.04));
        const shaped = level * Math.min(attack, release);
        wetL = l * (1 - this.params.depth + shaped * this.params.depth);
        wetR = r * (1 - this.params.depth + shaped * this.params.depth);
      } else if (this.mode === 'freeze') {
        if (phaseInSlice === 0) this.freezeAnchor = this.write - slice;
        const pos = this.freezeAnchor + phaseInSlice;
        const attackSamples = Math.max(1, sampleRate * Math.max(0, this.params.attack));
        const releaseSamples = Math.max(1, sampleRate * Math.max(0, this.params.release));
        const envelope = Math.min(1, phaseInSlice / attackSamples, (slice - phaseInSlice) / releaseSamples);
        const sustain = Math.max(0, Math.min(1, this.params.sustain));
        wetL = this.at(this.left, pos) * (sustain + (1 - sustain) * envelope);
        wetR = this.at(this.right, pos) * (sustain + (1 - sustain) * envelope);
      } else if (this.mode === 'warp' || this.mode === 'twist') {
        const rotation = Math.sin(musicalPhase * 2 * Math.PI / Math.max(1, beat * this.params.rate));
        const offset = (0.002 + Math.abs(rotation) * this.params.amount * 0.08) * sampleRate;
        const stereo = Math.max(0, Math.min(1, Number(this.params.stereo) || 0));
        const spread = this.mode === 'twist' ? 0.34 : 0.16;
        wetL = this.at(this.left, this.write - offset * (1 - spread * stereo));
        wetR = this.at(this.right, this.write - offset * (1 + spread * stereo));
        const feedback = Math.max(0, Math.min(0.88, Number(this.params.feedback) || 0));
        this.left[this.write] = this.safe(l + wetR * feedback * 0.55);
        this.right[this.write] = this.safe(r + wetL * feedback * 0.55);
      } else if (this.mode === 'reverse-delay') {
        const pos = this.write - slice + (slice - phaseInSlice);
        wetL = this.at(this.left, pos); wetR = this.at(this.right, pos);
        const cutoff = Math.max(1000, Math.min(16000, this.params.highCut || 9000));
        const alpha = 1 - Math.exp(-2 * Math.PI * cutoff / sampleRate);
        this.filterL += (wetL - this.filterL) * alpha;
        this.filterR += (wetR - this.filterR) * alpha;
        const lowCut = Math.max(20, Math.min(4000, Number(this.params.lowCut) || 20));
        const hpAlpha = Math.exp(-2 * Math.PI * lowCut / sampleRate);
        const hpL = hpAlpha * (this.highpassL + this.filterL - this.highpassInputL);
        const hpR = hpAlpha * (this.highpassR + this.filterR - this.highpassInputR);
        this.highpassInputL = this.filterL; this.highpassInputR = this.filterR;
        this.highpassL = hpL; this.highpassR = hpR;
        wetL = hpL; wetR = hpR;
        const feedback = Math.max(0, Math.min(0.88, this.params.feedback || 0));
        this.left[this.write] = this.safe(l + wetL * feedback);
        this.right[this.write] = this.safe(r + wetR * feedback);
      } else if (this.mode === 'synth' || this.mode === 'g2b' || this.mode === 'octave') {
        const amplitude = Math.max(Math.abs(l), Math.abs(r));
        this.env += (amplitude - this.env) * (amplitude > this.env ? 0.025 : 0.0015);
        const fixed = Math.max(30, this.params.frequency);
        const detected = this.pitchTracker?.voicedFrequency || fixed;
        const tracking = this.pitchTracker ? Math.max(0, Math.min(1, this.params.tracking)) : 0;
        // A curva concentra a região útil perto de tracking máximo. Em 75%, a
        // nota detectada já domina 93,75%, evitando que BASE puxe agudos para baixo.
        const trackingWeight = 1 - (1 - tracking) * (1 - tracking);
        const targetFrequency = (fixed + (detected - fixed) * trackingWeight) * (this.mode === 'g2b' ? 0.5 : 1);
        this.generatedFrequency += (targetFrequency - this.generatedFrequency) * 0.0025;
        this.oscPhase += (this.mode === 'octave' ? Math.max(30, detected * 0.5) : this.generatedFrequency) / sampleRate;
        if (this.oscPhase >= 1) this.oscPhase -= 1;
        this.oscPhase2 += Math.max(20, detected * 0.25) / sampleRate;
        if (this.oscPhase2 >= 1) this.oscPhase2 -= 1;
        const osc = Math.tanh(Math.sin(this.oscPhase * Math.PI * 2) * (1 + this.params.resonance * 3));
        if (this.mode === 'octave') {
          const sub2 = Math.tanh(Math.sin(this.oscPhase2 * Math.PI * 2) * 1.8);
          const generated = (osc * Math.max(0, this.params.octave1) + sub2 * Math.max(0, this.params.octave2)) * this.env * 1.25;
          wetL = generated + Math.max(0, this.params.direct) * l;
          wetR = generated + Math.max(0, this.params.direct) * r;
        } else {
          let generated = osc * this.env * 1.7;
          if (this.mode === 'g2b') {
            const tone = Math.max(0, Math.min(1, Number(this.params.tone) || 0));
            const alpha = 1 - Math.exp(-2 * Math.PI * (350 + tone * 5200) / sampleRate);
            this.filterL += (generated - this.filterL) * alpha;
            generated = this.filterL;
          }
          wetL = wetR = generated;
        }
      } else if (this.mode === 'sustainer') {
        const amplitude = Math.max(Math.abs(l), Math.abs(r));
        const seconds = amplitude > this.env ? Math.max(0.001, this.params.attack) : Math.max(0.02, this.params.release);
        const coeff = 1 - Math.exp(-1 / (sampleRate * seconds));
        this.env += (amplitude - this.env) * coeff;
        const target = Math.max(0.05, this.params.sustain || 0.7);
        const gain = Math.min(4, Math.max(1, target / Math.max(0.04, this.env))) * Math.max(0.1, this.params.level || 1);
        wetL = l * gain; wetR = r * gain;
      } else if (this.mode === 'slow-gear') {
        const amplitude = Math.max(Math.abs(l), Math.abs(r));
        if (amplitude > this.params.sensitivity && this.env < 0.03) this.env = 0.001;
        this.env += (1 - this.env) / Math.max(1, sampleRate * this.params.attack);
        if (amplitude < 0.003) this.env *= 0.999;
        const level = Math.max(0.1, this.params.level || 1);
        wetL = l * this.env * level; wetR = r * this.env * level;
      }
      outL[i] = this.safe(wetL);
      outR[i] = this.safe(wetR);
      this.write = (this.write + 1) % this.size;
      this.phase++;
      this.totalSamples++;
    }
    return true;
  }
}

['beat-scatter','beat-repeat','beat-shift','vinyl-flick','pattern-slicer','step-slicer','roll','freeze','warp','twist','reverse-delay','synth','g2b','sustainer','slow-gear','octave'].forEach((mode) => {
  registerProcessor(`ns-${mode}`, class extends NSAdvancedFxProcessor {
    constructor(options) { super(Object.assign({}, options, { processorOptions: Object.assign({}, options.processorOptions, { mode }) })); }
  });
});

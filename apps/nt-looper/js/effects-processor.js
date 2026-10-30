// effects-processor.js
// DSP dedicado para os efeitos que não possuem equivalente nativo de boa qualidade.

const NS_DSP_WINDOW_SIZE = 2048;
const NS_DSP_WINDOW = new Float32Array(NS_DSP_WINDOW_SIZE);
for (let i = 0; i < NS_DSP_WINDOW_SIZE; i++) {
  const sine = Math.sin(Math.PI * i / (NS_DSP_WINDOW_SIZE - 1));
  NS_DSP_WINDOW[i] = sine * sine;
}

function ns_dspWindow(phase) {
  return NS_DSP_WINDOW[Math.max(0, Math.min(NS_DSP_WINDOW_SIZE - 1, (phase * (NS_DSP_WINDOW_SIZE - 1)) | 0))];
}

const NS_TUNER_SCALES = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
  [0, 2, 4, 5, 7, 9, 11],
  [0, 2, 3, 5, 7, 8, 10],
  [0, 2, 3, 5, 7, 8, 11],
  [0, 3, 5, 7, 10],
];

// YIN em meia taxa, calculado aos poucos entre render quanta. A janela cobre
// duas ou mais ondas de vozes graves sem concentrar milhares de operações em
// um único bloco de áudio, o que é especialmente importante no WebKit/iPad.
class NSMonophonicPitchTracker {
  constructor(lowLatency = false) {
    this.lowLatency = !!lowLatency;
    this.sourceLength = this.lowLatency ? 1536 : 2048;
    this.analysisLength = this.sourceLength >> 1;
    this.ring = new Float32Array(this.sourceLength);
    this.analysis = new Float32Array(this.analysisLength);
    this.yin = new Float32Array(512);
    this.write = 0;
    this.filled = 0;
    this.samplesSinceAnalysis = 0;
    this.analysisInterval = this.lowLatency ? 768 : 1280;
    this.active = false;
    this.lag = 1;
    this.minLag = Math.max(2, Math.floor((sampleRate * 0.5) / 900));
    this.maxLag = Math.min(this.yin.length - 2, Math.ceil((sampleRate * 0.5) / 65));
    this.frequency = 0;
    this.confidence = 0;
    this.updated = false;
    this.ageSamples = sampleRate;
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
    this.samplesSinceAnalysis++;
    this.ageSamples++;
    if (!this.active && this.filled >= this.sourceLength && this.samplesSinceAnalysis >= this.analysisInterval) this.begin();
  }

  begin() {
    this.samplesSinceAnalysis = 0;
    let mean = 0;
    let energy = 0;
    for (let i = 0; i < this.analysisLength; i++) {
      const a = (this.write + i * 2) % this.sourceLength;
      const b = (a + 1) % this.sourceLength;
      const value = (this.ring[a] + this.ring[b]) * 0.5;
      this.analysis[i] = value;
      mean += value;
    }
    mean /= this.analysisLength;
    for (let i = 0; i < this.analysisLength; i++) {
      const value = this.analysis[i] - mean;
      this.analysis[i] = value;
      energy += value * value;
    }
    if (Math.sqrt(energy / this.analysisLength) < 0.004) {
      this.active = false;
      return;
    }
    this.yin.fill(0, 0, this.maxLag + 1);
    this.lag = 1;
    this.active = true;
  }

  advance(lagBudget = 48) {
    this.updated = false;
    if (!this.active) return;
    const endLag = Math.min(this.maxLag, this.lag + lagBudget - 1);
    const stride = this.lowLatency ? 4 : 2;
    for (let lag = this.lag; lag <= endLag; lag++) {
      let difference = 0;
      for (let i = 0; i < this.analysisLength - lag; i += stride) {
        const delta = this.analysis[i] - this.analysis[i + lag];
        difference += delta * delta;
      }
      this.yin[lag] = difference;
    }
    this.lag = endLag + 1;
    if (this.lag <= this.maxLag) return;

    let running = 0;
    this.yin[0] = 1;
    for (let lag = 1; lag <= this.maxLag; lag++) {
      running += this.yin[lag];
      this.yin[lag] = running > 0 ? this.yin[lag] * lag / running : 1;
    }
    let bestLag = 0;
    let bestValue = 1;
    for (let lag = this.minLag; lag < this.maxLag; lag++) {
      const value = this.yin[lag];
      if (value < bestValue) { bestValue = value; bestLag = lag; }
      if (value < 0.17 && value <= this.yin[lag + 1]) { bestLag = lag; bestValue = value; break; }
    }
    this.active = false;
    if (!bestLag || bestValue > 0.3) return;
    const previous = this.yin[bestLag - 1];
    const center = this.yin[bestLag];
    const next = this.yin[bestLag + 1];
    const denominator = 2 * (2 * center - previous - next);
    const refined = denominator ? bestLag + (next - previous) / denominator : bestLag;
    let frequency = (sampleRate * 0.5) / Math.max(1, refined);
    if (!(frequency >= 65 && frequency <= 900)) return;

    const confidence = Math.max(0, Math.min(1, 1 - bestValue));
    let acceptedOctaveJump = false;
    if (this.frequency > 0 && this.ageSamples < sampleRate * 0.2) {
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
    const blend = 0.35 + confidence * 0.5;
    this.frequency = acceptedOctaveJump || this.frequency <= 0
      ? frequency
      : this.frequency + (frequency - this.frequency) * blend;
    this.confidence = confidence;
    this.ageSamples = 0;
    this.updated = true;
  }

  get voicedFrequency() {
    return this.ageSamples < sampleRate * 0.16 && this.confidence >= 0.7 ? this.frequency : 0;
  }
}

class NSGranularPitchProcessor extends AudioWorkletProcessor {
  constructor(options = {}) {
    super();
    const lowLatency = !!options?.processorOptions?.lowLatency;
    this.bufferSize = Math.ceil(sampleRate * 0.35);
    this.left = new Float32Array(this.bufferSize);
    this.right = new Float32Array(this.bufferSize);
    this.writeIndex = 0;
    this.phaseA = 0;
    this.phaseB = 0;
    this.params = {
      voice1: 7,
      voice2: 12,
      balance: 0.28,
      window: 70,
      tone: 9000,
      harmonyMode: 0,
      root: 0,
      scale: 1,
      degree1: 2,
      degree2: 4,
      tracking: 0.75,
    };
    this.pitchTracker = new NSMonophonicPitchTracker(lowLatency);
    this.currentVoice1 = this.params.voice1;
    this.currentVoice2 = this.params.voice2;
    this.targetVoice1 = this.params.voice1;
    this.targetVoice2 = this.params.voice2;
    this.toneL = 0;
    this.toneR = 0;
    this.outL = 0;
    this.outR = 0;
    this.port.onmessage = (event) => {
      const msg = event.data || {};
      if (msg.type === 'param' && Object.prototype.hasOwnProperty.call(this.params, msg.id)) {
        this.params[msg.id] = Number(msg.value);
      }
    };
  }

  read(buffer, position) {
    while (position < 0) position += this.bufferSize;
    while (position >= this.bufferSize) position -= this.bufferSize;
    const a = Math.floor(position);
    const b = (a + 1) % this.bufferSize;
    const frac = position - a;
    return buffer[a] + (buffer[b] - buffer[a]) * frac;
  }

  shifted(buffer, delayA, delayB, winA, winB) {
    return this.read(buffer, this.writeIndex - delayA) * winA
      + this.read(buffer, this.writeIndex - delayB) * winB;
  }

  harmonyShift(frequency, degree) {
    const midi = 69 + 12 * Math.log2(frequency / 440);
    const root = ((Math.round(this.params.root) % 12) + 12) % 12;
    const scale = NS_TUNER_SCALES[Math.max(0, Math.min(NS_TUNER_SCALES.length - 1, Math.round(this.params.scale)))] || NS_TUNER_SCALES[0];
    const notes = [];
    for (let note = Math.floor(midi) - 24; note <= Math.ceil(midi) + 36; note++) {
      const pitchClass = ((note - root) % 12 + 12) % 12;
      if (scale.includes(pitchClass)) notes.push(note);
    }
    if (!notes.length) return 0;
    let baseIndex = 0;
    for (let i = 1; i < notes.length; i++) if (Math.abs(notes[i] - midi) < Math.abs(notes[baseIndex] - midi)) baseIndex = i;
    const targetIndex = Math.max(0, Math.min(notes.length - 1, baseIndex + Math.round(degree)));
    return Math.max(-24, Math.min(24, notes[targetIndex] - midi));
  }

  updateHarmony() {
    if (Math.round(this.params.harmonyMode) !== 1) {
      this.targetVoice1 = this.params.voice1;
      this.targetVoice2 = this.params.voice2;
      return;
    }
    const frequency = this.pitchTracker.voicedFrequency;
    if (frequency <= 0) return;
    this.targetVoice1 = this.harmonyShift(frequency, this.params.degree1);
    this.targetVoice2 = this.harmonyShift(frequency, this.params.degree2);
  }

  process(inputs, outputs) {
    const input = inputs[0] || [];
    const output = outputs[0];
    const inL = input[0] || null;
    const inR = input[1] || input[0] || null;
    const outL = output[0];
    const outR = output[1] || output[0];
    if (!inL) return true;
    if (Math.round(this.params.harmonyMode) === 1) {
      this.pitchTracker.advance(48);
      if (this.pitchTracker.updated) this.updateHarmony();
    } else {
      this.targetVoice1 = this.params.voice1;
      this.targetVoice2 = this.params.voice2;
    }
    const tracking = Math.max(0, Math.min(1, this.params.tracking));
    const voiceBlend = 0.08 + tracking * 0.45;
    this.currentVoice1 += (this.targetVoice1 - this.currentVoice1) * voiceBlend;
    this.currentVoice2 += (this.targetVoice2 - this.currentVoice2) * voiceBlend;
    const span = Math.max(768, Math.min(this.bufferSize * 0.72, sampleRate * this.params.window / 1000));
    const factorA = Math.pow(2, this.currentVoice1 / 12);
    const factorB = Math.pow(2, this.currentVoice2 / 12);
    const phaseIncA = Math.max(0.0000001, Math.abs(1 - factorA) / span);
    const phaseIncB = Math.max(0.0000001, Math.abs(1 - factorB) / span);
    const balance = Math.max(0, Math.min(1, this.params.balance));
    const cutoff = Math.max(1200, Math.min(sampleRate * 0.45, this.params.tone));
    const alpha = 1 - Math.exp(-2 * Math.PI * cutoff / sampleRate);

    for (let i = 0; i < outL.length; i++) {
      const left = inL ? inL[i] : 0;
      const right = inR ? inR[i] : left;
      if (Math.round(this.params.harmonyMode) === 1) this.pitchTracker.push((left + right) * 0.5);
      this.left[this.writeIndex] = left;
      this.right[this.writeIndex] = right;

      const aHeadB = this.phaseA < 0.5 ? this.phaseA + 0.5 : this.phaseA - 0.5;
      const aDelayA = Math.abs(factorA - 1) < 0.0001 ? 3 : 16 + (factorA > 1 ? (1 - this.phaseA) * span : this.phaseA * span);
      const aDelayB = Math.abs(factorA - 1) < 0.0001 ? 3 : 16 + (factorA > 1 ? (1 - aHeadB) * span : aHeadB * span);
      const aWinA = Math.abs(factorA - 1) < 0.0001 ? 1 : ns_dspWindow(this.phaseA);
      const aWinB = Math.abs(factorA - 1) < 0.0001 ? 0 : ns_dspWindow(aHeadB);
      const bHeadB = this.phaseB < 0.5 ? this.phaseB + 0.5 : this.phaseB - 0.5;
      const bDelayA = Math.abs(factorB - 1) < 0.0001 ? 3 : 16 + (factorB > 1 ? (1 - this.phaseB) * span : this.phaseB * span);
      const bDelayB = Math.abs(factorB - 1) < 0.0001 ? 3 : 16 + (factorB > 1 ? (1 - bHeadB) * span : bHeadB * span);
      const bWinA = Math.abs(factorB - 1) < 0.0001 ? 1 : ns_dspWindow(this.phaseB);
      const bWinB = Math.abs(factorB - 1) < 0.0001 ? 0 : ns_dspWindow(bHeadB);
      const aL = this.shifted(this.left, aDelayA, aDelayB, aWinA, aWinB);
      const aR = this.shifted(this.right, aDelayA, aDelayB, aWinA, aWinB);
      const bL = this.shifted(this.left, bDelayA, bDelayB, bWinA, bWinB);
      const bR = this.shifted(this.right, bDelayA, bDelayB, bWinA, bWinB);
      const wetL = aL * (1 - balance) + bL * balance;
      const wetR = aR * (1 - balance) + bR * balance;

      this.toneL += alpha * (wetL - this.toneL);
      this.toneR += alpha * (wetR - this.toneR);
      const maxStep = 0.1;
      this.outL += Math.max(-maxStep, Math.min(maxStep, this.toneL - this.outL));
      this.outR += Math.max(-maxStep, Math.min(maxStep, this.toneR - this.outR));
      outL[i] = this.outL;
      if (outR !== outL) outR[i] = this.outR;

      this.phaseA += phaseIncA;
      this.phaseB += phaseIncB;
      if (this.phaseA >= 1) this.phaseA -= 1;
      if (this.phaseB >= 1) this.phaseB -= 1;
      this.writeIndex++;
      if (this.writeIndex >= this.bufferSize) this.writeIndex = 0;
    }
    return true;
  }
}

class NSBitCrusherProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.params = { bits: 10, reduction: 3, jitter: 0 };
    this.holdL = 0;
    this.holdR = 0;
    this.counter = 0;
    this.port.onmessage = (event) => {
      const msg = event.data || {};
      if (msg.type === 'param' && Object.prototype.hasOwnProperty.call(this.params, msg.id)) {
        this.params[msg.id] = Number(msg.value);
      }
    };
  }

  process(inputs, outputs) {
    const input = inputs[0] || [];
    const output = outputs[0];
    const inL = input[0] || null;
    const inR = input[1] || input[0] || null;
    const outL = output[0];
    const outR = output[1] || output[0];
    const levels = Math.pow(2, Math.max(2, Math.min(16, Math.round(this.params.bits))) - 1);
    const reduction = Math.max(1, Math.round(this.params.reduction));

    for (let i = 0; i < outL.length; i++) {
      if (this.counter <= 0) {
        const jitter = this.params.jitter > 0 ? Math.floor(Math.random() * this.params.jitter) : 0;
        this.counter = reduction + jitter;
        const left = inL ? inL[i] : 0;
        const right = inR ? inR[i] : left;
        this.holdL = Math.round(left * levels) / levels;
        this.holdR = Math.round(right * levels) / levels;
      }
      this.counter--;
      outL[i] = this.holdL;
      if (outR !== outL) outR[i] = this.holdR;
    }
    return true;
  }
}

class NSOscBotProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.params = {
      wave: 0, tone: 0, attack: 50, note: 36, sens: 0, balance: 0.7, dryInput: 1,
      seqOn: 1, seqSync: 1, seqRate: 2, seqSteps: 16, seqGate: 0.68, bpm: 120, transportOriginFrame: 0,
    };
    const pattern = [0, 0, 7, 0, 3, 0, 10, 7, 0, 12, 7, 3, 0, -5, 3, 7];
    pattern.forEach((value, index) => { this.params[`step${index}`] = value; });
    this.phaseA = 0;
    this.phaseB = 0;
    this.envelope = 0;
    this.toneL = 0;
    this.toneR = 0;
    this.currentStep = 0;
    this.currentMidi = this.params.note;
    this.lastMidi = -1;
    this.incrementA = 0;
    this.incrementB = 0;
    this.port.onmessage = (event) => {
      const msg = event.data || {};
      if (msg.type === 'param' && Object.prototype.hasOwnProperty.call(this.params, msg.id)) this.params[msg.id] = Number(msg.value);
    };
  }

  oscillator(phase, wave) {
    const saw = phase * 2 - 1;
    if (wave === 1) return saw * (1.72 - 0.72 * Math.abs(saw)) * 0.88;
    if (wave === 3) return phase < 0.5 ? 1 : -1;
    if (wave === 4) return phase < 0.25 ? 1 : -1;
    return saw;
  }

  process(inputs, outputs) {
    const input = inputs[0] || [];
    const output = outputs[0];
    const inL = input[0] || null;
    const inR = input[1] || input[0] || null;
    const outL = output[0];
    const outR = output[1] || output[0];
    const wave = Math.round(this.params.wave);
    const sensitivity = Math.pow(10, this.params.sens / 40);
    const attackSeconds = 0.002 + Math.pow(this.params.attack / 100, 2) * 0.22;
    const attackAlpha = 1 - Math.exp(-1 / Math.max(1, sampleRate * attackSeconds));
    const releaseAlpha = 1 - Math.exp(-1 / (sampleRate * 0.12));
    const cutoff = Math.max(650, Math.min(sampleRate * 0.44, 5200 * Math.pow(2, this.params.tone / 50)));
    const toneAlpha = 1 - Math.exp(-2 * Math.PI * cutoff / sampleRate);
    const balance = Math.max(0, Math.min(1, this.params.balance));
    const dryInput = this.params.dryInput >= 0.5 ? 1 : 0;
    const steps = Math.max(1, Math.min(16, Math.round(this.params.seqSteps)));
    const rateBeats = [1, 0.5, 0.25, 0.125][Math.max(0, Math.min(3, Math.round(this.params.seqRate)))] || 0.25;
    const stepFrames = this.params.seqSync
      ? Math.max(1, sampleRate * 60 / Math.max(40, Math.min(240, this.params.bpm)) * rateBeats)
      : Math.max(1, sampleRate * rateBeats);

    for (let i = 0; i < outL.length; i++) {
      const origin = Math.round(Number(this.params.transportOriginFrame) || 0);
      const stepPosition = Math.max(0, currentFrame + i - origin) / stepFrames;
      this.currentStep = this.params.seqOn ? Math.floor(stepPosition) % steps : 0;
      const offset = this.params.seqOn ? Number(this.params[`step${this.currentStep}`]) || 0 : 0;
      this.currentMidi = Math.max(24, Math.min(127, Number(this.params.note) + offset));
      if (this.currentMidi !== this.lastMidi) {
        const frequency = 440 * Math.pow(2, (this.currentMidi - 69) / 12);
        this.incrementA = frequency / sampleRate;
        this.incrementB = frequency * 1.007 / sampleRate;
        this.lastMidi = this.currentMidi;
      }
      const left = inL ? inL[i] : 0;
      const right = inR ? inR[i] : left;
      const gatePhase = stepPosition - Math.floor(stepPosition);
      const gate = !this.params.seqOn || gatePhase <= Math.max(0.05, Math.min(1, this.params.seqGate));
      const follower = Math.max(Math.abs(left), Math.abs(right)) * sensitivity * 4;
      const target = gate ? Math.min(1, follower) : 0;
      this.envelope += (target - this.envelope) * (target > this.envelope ? attackAlpha : releaseAlpha);
      let osc = this.oscillator(this.phaseA, wave);
      if (wave === 2) osc = (osc + this.oscillator(this.phaseB, 0)) * 0.5;
      const synth = osc * this.envelope * 0.88;
      const wetL = left * (1 - balance) * dryInput + synth * balance;
      const wetR = right * (1 - balance) * dryInput + synth * balance;
      this.toneL += toneAlpha * (wetL - this.toneL);
      this.toneR += toneAlpha * (wetR - this.toneR);
      outL[i] = this.toneL;
      if (outR !== outL) outR[i] = this.toneR;
      this.phaseA += this.incrementA;
      this.phaseB += this.incrementB;
      if (this.phaseA >= 1) this.phaseA -= 1;
      if (this.phaseB >= 1) this.phaseB -= 1;
    }
    return true;
  }
}

class NSVocalTunerProcessor extends AudioWorkletProcessor {
  constructor(options = {}) {
    super();
    const lowLatency = !!options?.processorOptions?.lowLatency;
    this.params = { shift: 0, formant: 0, speed: 9, stability: 0, mode: 0, root: 0, scale: 1, robotNote: 0, amount: 1 };
    this.bufferSize = Math.ceil(sampleRate * 0.3);
    this.left = new Float32Array(this.bufferSize);
    this.right = new Float32Array(this.bufferSize);
    this.pitchTracker = new NSMonophonicPitchTracker(lowLatency);
    this.writeIndex = 0;
    this.phase = 0;
    this.currentShift = 0;
    this.targetShift = 0;
    this.pitchSpanSeconds = lowLatency ? 0.038 : 0.05;
    this.formantL = 0;
    this.formantR = 0;
    this.outSmoothL = 0;
    this.outSmoothR = 0;
    this.port.onmessage = (event) => {
      const msg = event.data || {};
      if (msg.type === 'param' && Object.prototype.hasOwnProperty.call(this.params, msg.id)) this.params[msg.id] = Number(msg.value);
    };
  }

  read(buffer, position) {
    while (position < 0) position += this.bufferSize;
    while (position >= this.bufferSize) position -= this.bufferSize;
    const a = Math.floor(position);
    const b = (a + 1) % this.bufferSize;
    const frac = position - a;
    return buffer[a] + (buffer[b] - buffer[a]) * frac;
  }

  quantizeMidi(midi) {
    if (Math.round(this.params.mode) === 1) {
      const pitchClass = ((Math.round(this.params.robotNote) % 12) + 12) % 12;
      const octave = Math.round((midi - pitchClass) / 12);
      return octave * 12 + pitchClass;
    }
    const root = ((Math.round(this.params.root) % 12) + 12) % 12;
    const scale = NS_TUNER_SCALES[Math.max(0, Math.min(NS_TUNER_SCALES.length - 1, Math.round(this.params.scale)))] || NS_TUNER_SCALES[0];
    let best = Math.round(midi);
    let distance = 99;
    for (let candidate = Math.floor(midi) - 12; candidate <= Math.ceil(midi) + 12; candidate++) {
      const pitchClass = ((candidate - root) % 12 + 12) % 12;
      if (!scale.includes(pitchClass)) continue;
      const nextDistance = Math.abs(candidate - midi);
      if (nextDistance < distance) { distance = nextDistance; best = candidate; }
    }
    return best;
  }

  beginPitchAnalysis() {
    // Mantido por compatibilidade com testes antigos. O tracker inicia sozinho.
  }

  advancePitchAnalysis(lagBudget = 48) {
    this.pitchTracker.advance(lagBudget);
    if (this.pitchTracker.updated && this.pitchTracker.voicedFrequency > 0) this.acceptFrequency(this.pitchTracker.voicedFrequency);
  }

  acceptFrequency(frequency) {
    if (!(frequency > 0)) return;
    const midi = 69 + 12 * Math.log2(frequency / 440);
    let wanted = (Number(this.params.shift) || 0)
      + (this.quantizeMidi(midi) - midi) * Math.max(0, Math.min(1, this.params.amount));
    wanted = Math.max(-24, Math.min(24, wanted));
    const stability = Math.max(-10, Math.min(10, this.params.stability));
    const stableMix = Math.pow(0.88, Math.max(0, stability));
    this.targetShift += (wanted - this.targetShift) * Math.max(0.08, stableMix);
  }

  shifted(buffer, delayA, delayB, winA, winB) {
    return this.read(buffer, this.writeIndex - delayA) * winA + this.read(buffer, this.writeIndex - delayB) * winB;
  }

  process(inputs, outputs) {
    const input = inputs[0] || [];
    const output = outputs[0];
    const inL = input[0] || null;
    const inR = input[1] || input[0] || null;
    const outL = output[0];
    const outR = output[1] || output[0];
    if (!inL) return true;

    this.advancePitchAnalysis(48);

    const speed = Math.max(0, Math.min(10, this.params.speed));
    const correctionSeconds = Math.max(0.012, 0.18 - speed * 0.0165);
    const shiftAlpha = 1 - Math.exp(-outL.length / Math.max(1, sampleRate * correctionSeconds));
    this.currentShift += (this.targetShift - this.currentShift) * shiftAlpha;
    const factor = Math.pow(2, this.currentShift / 12);
    const span = Math.max(768, Math.min(this.bufferSize * 0.65, sampleRate * this.pitchSpanSeconds));
    const cutoff = Math.max(1800, Math.min(sampleRate * 0.44, 7200 * Math.pow(2, this.params.formant / 70)));
    const alpha = 1 - Math.exp(-2 * Math.PI * cutoff / sampleRate);
    const phaseInc = Math.max(0.0000001, Math.abs(1 - factor) / span);
    const unityPosition = Math.max(0, Math.min(1, (Math.abs(this.currentShift) - 0.025) / 0.3));
    const pitchBlend = unityPosition * unityPosition * (3 - 2 * unityPosition);

    for (let i = 0; i < outL.length; i++) {
      const left = inL ? inL[i] : 0;
      const right = inR ? inR[i] : left;
      this.pitchTracker.push((left + right) * 0.5);
      this.left[this.writeIndex] = left;
      this.right[this.writeIndex] = right;
      this.writeIndex = (this.writeIndex + 1) % this.bufferSize;
      const headB = this.phase < 0.5 ? this.phase + 0.5 : this.phase - 0.5;
      const delayA = 32 + (factor > 1 ? (1 - this.phase) * span : this.phase * span);
      const delayB = 32 + (factor > 1 ? (1 - headB) * span : headB * span);
      const winA = ns_dspWindow(this.phase);
      const winB = ns_dspWindow(headB);
      const granularL = this.shifted(this.left, delayA, delayB, winA, winB);
      const granularR = this.shifted(this.right, delayA, delayB, winA, winB);
      const directL = this.read(this.left, this.writeIndex - 48);
      const directR = this.read(this.right, this.writeIndex - 48);
      const shiftedL = directL + (granularL - directL) * pitchBlend;
      const shiftedR = directR + (granularR - directR) * pitchBlend;
      this.formantL += alpha * (shiftedL - this.formantL);
      this.formantR += alpha * (shiftedR - this.formantR);
      const maxStep = 0.09;
      const limitedL = Math.tanh(this.formantL * 1.08) / Math.tanh(1.08);
      const limitedR = Math.tanh(this.formantR * 1.08) / Math.tanh(1.08);
      this.outSmoothL += Math.max(-maxStep, Math.min(maxStep, limitedL - this.outSmoothL));
      this.outSmoothR += Math.max(-maxStep, Math.min(maxStep, limitedR - this.outSmoothR));
      outL[i] = this.outSmoothL;
      if (outR !== outL) outR[i] = this.outSmoothR;
      this.phase += phaseInc;
      if (this.phase >= 1) this.phase -= 1;
    }
    return true;
  }
}

registerProcessor('ns-granular-pitch', NSGranularPitchProcessor);
registerProcessor('ns-bitcrusher', NSBitCrusherProcessor);
registerProcessor('ns-osc-bot', NSOscBotProcessor);
registerProcessor('ns-vocal-tuner', NSVocalTunerProcessor);

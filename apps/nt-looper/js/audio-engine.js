// audio-engine.js
// Grafo de áudio isolado por track, otimizado para Chrome e dispositivos touch.

const NS_TRACK_COUNT = 5;
const NS_MAX_FX_PER_RACK = 4;

class NSMasterTimeline {
  constructor(ctx, options = {}) {
    this.ctx = ctx;
    this.bpm = Math.max(40, Math.min(240, Number(options.bpm) || 120));
    this.beatsPerBar = Math.max(1, Math.round(Number(options.beatsPerBar) || 4));
    this.originFrame = Math.round(Number(options.originFrame) || 0);
  }

  get beatSamples() { return Math.max(1, Math.round(this.ctx.sampleRate * 60 / this.bpm)); }
  get barSamples() { return this.beatSamples * this.beatsPerBar; }
  get currentFrame() { return Math.round(this.ctx.currentTime * this.ctx.sampleRate); }

  setTempo(bpm) {
    const nextBpm = Math.max(40, Math.min(240, Number(bpm) || 120));
    if (nextBpm === this.bpm) return;
    const frame = this.currentFrame;
    const oldBeat = this.beatSamples;
    const oldBar = oldBeat * this.beatsPerBar;
    const elapsed = frame - this.originFrame;
    const phase = elapsed >= 0 ? ((elapsed % oldBar) + oldBar) % oldBar : 0;
    const beatPhase = phase / oldBeat;
    this.bpm = nextBpm;
    // Uma origem negativa é válida e necessária quando o BPM muda logo após o
    // boot. Limitá-la a zero deslocava a fase do compasso nesse caso.
    this.originFrame = Math.round(frame - beatPhase * this.beatSamples);
  }

  gridSamples(mode) {
    if (mode === 'BEAT') return this.beatSamples;
    if (mode === 'MEASURE') return this.barSamples;
    return 0;
  }

  nextLaunchFrame(mode) {
    const grid = this.gridSamples(mode);
    if (!grid) return 0;
    // Dois render quanta dão tempo para a mensagem atravessar o main thread sem
    // perder a fronteira. A ação sempre entra numa linha futura da timeline.
    const lead = Math.max(256, Math.ceil(this.ctx.sampleRate * 0.006));
    const earliest = this.currentFrame + lead;
    if (earliest <= this.originFrame) return this.originFrame;
    return this.originFrame + Math.ceil((earliest - this.originFrame) / grid) * grid;
  }
}

class NSFxRack {
  constructor(ctx, options = {}) {
    this.ctx = ctx;
    this.input = ctx.createGain();
    this.output = ctx.createGain();
    this.dry = ctx.createGain();
    this.dryDelay = ctx.createDelay(1);
    this.wet = ctx.createGain();
    this.chain = [];
    this.enabled = options.enabled !== false;
    this.renderActive = options.renderActive !== false;
    this.intensity = options.intensity ?? 1;
    this.maxEffects = options.maxEffects || NS_MAX_FX_PER_RACK;
    this.compensateLatency = options.compensateLatency === true;
    this.onLatencyChange = options.onLatencyChange || null;
    this.rewire();
  }

  applyMix() {
    const hasEffects = this.chain.some((fx) => !fx.bypassed);
    const amount = this.enabled && this.renderActive && hasEffects ? Math.max(0, Math.min(1, this.intensity)) : 0;
    const forceWetOnly = amount > 0 && this.chain.some((fx) => !fx.bypassed && fx._dryInputScale === 0);
    ns_smooth(this.dry.gain, forceWetOnly ? 0 : Math.cos(amount * Math.PI * 0.5), this.ctx);
    ns_smooth(this.wet.gain, Math.sin(amount * Math.PI * 0.5), this.ctx);
  }

  rewire() {
    try { this.input.disconnect(); } catch (error) {}
    try { this.dry.disconnect(); } catch (error) {}
    try { this.dryDelay.disconnect(); } catch (error) {}
    try { this.wet.disconnect(); } catch (error) {}
    this.chain.forEach((fx) => { try { fx.output.disconnect(); } catch (error) {} });

    if (this.compensateLatency) this.input.connect(this.dryDelay).connect(this.dry).connect(this.output);
    else this.input.connect(this.dry).connect(this.output);
    const activeChain = this.enabled && this.renderActive && this.intensity > 0
      ? this.chain.filter((fx) => !fx.bypassed)
      : [];
    if (activeChain.length) {
      let previous = this.input;
      activeChain.forEach((fx) => { previous.connect(fx.input); previous = fx.output; });
      previous.connect(this.wet);
    }
    this.wet.connect(this.output);
    this.applyMix();
    this.updateLatency();
  }

  getLatencySamples() {
    if (!this.enabled || !this.renderActive || this.intensity <= 0) return 0;
    return this.chain.reduce((total, fx) => total + (!fx.bypassed ? Math.max(0, Number(fx.latencySamples) || 0) : 0), 0);
  }

  updateLatency() {
    const samples = this.getLatencySamples();
    const seconds = samples / this.ctx.sampleRate;
    if (this.compensateLatency && this.dryDelay?.delayTime) ns_smooth(this.dryDelay.delayTime, seconds, this.ctx, 0.012);
    if (this.onLatencyChange) this.onLatencyChange(samples);
  }

  bindFx(fx) {
    fx.onBypassChange = () => this.rewire();
    fx.onRoutingChange = () => this.applyMix();
    fx.onLatencyChange = () => this.updateLatency();
    return fx;
  }

  add(id) {
    if (this.chain.length >= this.maxEffects) return null;
    const fx = ns_createEffect(this.ctx, id);
    this.bindFx(fx);
    this.chain.push(fx);
    this.rewire();
    return fx;
  }

  remove(fx) {
    const index = this.chain.indexOf(fx);
    if (index < 0) return;
    this.chain.splice(index, 1);
    if (fx.dispose) fx.dispose();
    this.rewire();
  }

  replace(fx, id) {
    const index = this.chain.indexOf(fx);
    if (index < 0) return null;
    const next = ns_createEffect(this.ctx, id);
    this.bindFx(next);
    this.chain[index] = next;
    if (fx.dispose) fx.dispose();
    this.rewire();
    return next;
  }

  clear() {
    this.chain.forEach((fx) => { if (fx.dispose) fx.dispose(); });
    this.chain = [];
    this.rewire();
  }

  setEnabled(value) {
    this.enabled = !!value;
    this.rewire();
  }

  setRenderActive(value) {
    const active = !!value;
    if (active === this.renderActive) return;
    this.renderActive = active;
    this.rewire();
  }

  move(fx, delta) {
    const from = this.chain.indexOf(fx);
    const to = Math.max(0, Math.min(this.chain.length - 1, from + Number(delta)));
    if (from < 0 || from === to) return false;
    this.chain.splice(from, 1);
    this.chain.splice(to, 0, fx);
    this.rewire();
    return true;
  }

  setIntensity(value) {
    const previousActive = this.intensity > 0;
    this.intensity = Math.max(0, Math.min(1, Number(value)));
    if (previousActive !== (this.intensity > 0)) this.rewire();
    else this.applyMix();
  }

  serialize() {
    return {
      enabled: this.enabled,
      intensity: this.intensity,
      effects: this.chain.map((fx) => ({ id: fx.id, bypassed: fx.bypassed, params: Object.assign({}, fx.params) })),
    };
  }

  restore(data) {
    this.clear();
    if (!data) return;
    this.enabled = data.enabled !== false;
    this.intensity = Number.isFinite(data.intensity) ? data.intensity : 1;
    (data.effects || []).slice(0, this.maxEffects).forEach((saved) => {
      const fx = this.add(saved.id);
      if (!fx) return;
      const params = Object.assign({}, saved.params || {});
      if (saved.id === 'vocaltuner' && Number(params.scale) > 4) {
        params.root = Math.max(0, Math.min(11, Math.round(Number(params.scale) - 1)));
        params.scale = 1;
        params.mode = 0;
      }
      Object.entries(params).forEach(([id, value]) => fx.setParam(id, value));
      fx.setBypass(!!saved.bypassed);
    });
    this.rewire();
  }
}

function ns_encodeStereoWav(left, right, sampleRate) {
  const length = Math.min(left.length, right.length);
  const bytes = new ArrayBuffer(44 + length * 4);
  const view = new DataView(bytes);
  const text = (offset, value) => {
    for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i));
  };
  text(0, 'RIFF'); view.setUint32(4, 36 + length * 4, true); text(8, 'WAVE');
  text(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true);
  view.setUint16(22, 2, true); view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 4, true); view.setUint16(32, 4, true); view.setUint16(34, 16, true);
  text(36, 'data'); view.setUint32(40, length * 4, true);
  let offset = 44;
  for (let i = 0; i < length; i++) {
    const l = Math.max(-1, Math.min(1, left[i]));
    const r = Math.max(-1, Math.min(1, right[i]));
    view.setInt16(offset, l < 0 ? l * 32768 : l * 32767, true);
    view.setInt16(offset + 2, r < 0 ? r * 32768 : r * 32767, true);
    offset += 4;
  }
  return new Blob([view], { type: 'audio/wav' });
}

function ns_floatToInt16(channel) {
  const output = new Int16Array(channel.length);
  for (let i = 0; i < channel.length; i++) {
    const value = Math.max(-1, Math.min(1, channel[i]));
    output[i] = Math.round(value * (value < 0 ? 32768 : 32767));
  }
  return output;
}

function ns_resampleChannel(source, sourceRate, targetRate, maxLength) {
  const length = Math.min(maxLength, Math.max(1, Math.floor(source.length * targetRate / sourceRate)));
  const output = new Float32Array(length);
  const ratio = sourceRate / targetRate;
  for (let i = 0; i < length; i++) {
    const position = i * ratio;
    const a = Math.min(source.length - 1, Math.floor(position));
    const b = Math.min(source.length - 1, a + 1);
    const fraction = position - a;
    output[i] = source[a] + (source[b] - source[a]) * fraction;
  }
  return output;
}

class NSTrack {
  constructor(engine, index) {
    this.engine = engine;
    this.ctx = engine.ctx;
    this.index = index;
    this.name = `TRACK ${index + 1}`;
    this.state = 'EMPTY';
    this.pending = null;
    this.layerCount = 0;
    this.loopLength = 0;
    this.sourceLength = 0;
    this.durationSec = 0;
    this.sourceDurationSec = 0;
    this.originalBpm = 0;
    this.playbackRate = 1;
    this.trimStart = 0;
    this.trimEnd = 1;
    this.canUndo = false;
    this.canRedo = false;
    this.muted = false;
    this.soloed = false;
    this.reverse = false;
    this.monitorEnabled = false;
    this._userGain = 0.82;
    this._exportRequests = new Map();
    this._exportSequence = 0;
    this.inputPathConnected = true;
    this.outputPathConnected = true;
    this._inputSuspendTimer = 0;
    this._tailQuietFrames = 0;
    this._tailSleepFrames = ns_isIPadWebKit() ? 140 : 210;

    this.input = this.ctx.createGain();
    this.inputGain = this.ctx.createGain();
    this.inputGain.gain.value = 1;
    this.inEqLow = this.ctx.createBiquadFilter();
    this.inEqMid = this.ctx.createBiquadFilter();
    this.inEqHigh = this.ctx.createBiquadFilter();
    this.inEqLow.type = 'lowshelf'; this.inEqLow.frequency.value = 180;
    this.inEqMid.type = 'peaking'; this.inEqMid.frequency.value = 1200; this.inEqMid.Q.value = 0.85;
    this.inEqHigh.type = 'highshelf'; this.inEqHigh.frequency.value = 6200;
    this.inputFxRack = new NSFxRack(this.ctx, { enabled: true });
    this.inputFxRack.onLatencyChange = () => this.engine.applyQuantize();
    this.inputAnalyser = this.ctx.createAnalyser();
    this.inputAnalyser.fftSize = 256;
    this._inputMeterBuffer = new Float32Array(this.inputAnalyser.fftSize);

    this.looperNode = new AudioWorkletNode(this.ctx, 'looper-processor', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [2],
      channelCount: 2,
      channelCountMode: 'explicit',
      channelInterpretation: 'speakers',
      processorOptions: { maxSeconds: 180, maxLayers: 3 },
    });

    this.outputFxRack = new NSFxRack(this.ctx, { enabled: true, compensateLatency: true, renderActive: false });
    this.outputFxRack.onLatencyChange = (samples) => this.send('setPlaybackCompensation', { samples });
    this.monitorGain = this.ctx.createGain();
    this.monitorGain.gain.value = 0;
    this.monitorTrackGain = this.ctx.createGain();
    this.monitorTrackGain.gain.value = this._userGain;
    this.monitorPanner = this.ctx.createStereoPanner();
    this.trackGain = this.ctx.createGain();
    this.trackGain.gain.value = this._userGain;
    this.panner = this.ctx.createStereoPanner();
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 256;
    this._meterBuffer = new Float32Array(this.analyser.fftSize);

    this.input.connect(this.inputGain)
      .connect(this.inEqLow)
      .connect(this.inEqMid)
      .connect(this.inEqHigh)
      .connect(this.inputFxRack.input);
    this.inputFxRack.output.connect(this.looperNode);
    this.inputFxRack.output.connect(this.inputAnalyser);
    this.inputFxRack.output.connect(this.monitorGain).connect(this.monitorTrackGain).connect(this.monitorPanner).connect(engine.liveMonitorBus);
    // Grafo imutável de canal: o transporte muda somente o conteúdo produzido
    // pelo looper. Nenhum GainNode, rack ou conexão é alterado durante STOP.
    this.looperNode.connect(this.outputFxRack.input);
    this.outputFxRack.output.connect(this.trackGain);
    this.trackGain.connect(this.panner).connect(this.analyser);
    this.panner.connect(engine.masterBus);
    this.setInputPathActive(false);

    this.looperNode.port.onmessage = (event) => this.handleMessage(event.data || {});
    this.setTempo(engine.bpm);
    this.onStateChange = null;
    this.onWaveform = null;
    this.onLivePeak = null;
    this.onPosition = null;
    this.onRecTarget = null;
    this.onRecProgress = null;
    this.onInfo = null;
  }

  handleMessage(message) {
    if (message.type === 'state') {
      this.state = message.state;
      this.pending = null;
      this.layerCount = message.layerCount;
      this.loopLength = message.loopLength;
      this.sourceLength = message.sourceLength;
      this.durationSec = message.durationSec;
      this.sourceDurationSec = message.sourceDurationSec;
      this.originalBpm = Number(message.originalBpm) || 0;
      this.playbackRate = Number(message.playbackRate) || 1;
      this.trimStart = message.trimStart;
      this.trimEnd = message.trimEnd;
      this.canUndo = !!message.canUndo;
      this.canRedo = !!message.canRedo;
      const needsInput = this.monitorEnabled || this.state === 'RECORDING' || this.state === 'OVERDUBBING';
      clearTimeout(this._inputSuspendTimer);
      if (needsInput) this.setInputPathActive(true);
      else this._inputSuspendTimer = setTimeout(() => this.setInputPathActive(false), 28);
      // Não desligue o rack ao receber STOP. Reverbs, delays e processadores com
      // memória precisam continuar recebendo silêncio até a cauda terminar.
      if (this.state === 'PLAYING' || this.state === 'OVERDUBBING') this._tailQuietFrames = 0;
      if (this.onStateChange) this.onStateChange(this);
    } else if (message.type === 'pending') {
      this.pending = message.pending;
      if (this.onStateChange) this.onStateChange(this);
    } else if (message.type === 'livePeak' && this.onLivePeak) {
      this.onLivePeak(message.value);
    } else if (message.type === 'waveform' && this.onWaveform) {
      this.onWaveform(message.peaks, message.durationSec, message.sourcePeaks || message.peaks);
    } else if (message.type === 'position' && this.onPosition) {
      this.onPosition(message.ratio);
    } else if (message.type === 'recTarget' && this.onRecTarget) {
      this.onRecTarget(message.targetSec);
    } else if (message.type === 'recProgress' && this.onRecProgress) {
      this.onRecProgress(message.ratio);
    } else if (message.type === 'info' && this.onInfo) {
      this.onInfo(message.code);
    } else if (message.type === 'export') {
      const request = this._exportRequests.get(message.requestId);
      if (request) {
        this._exportRequests.delete(message.requestId);
        clearTimeout(request.timer);
        request.resolve(message);
      }
    }
  }

  send(type, extra = {}) {
    this.looperNode.port.postMessage(Object.assign({ type }, extra));
  }

  press(targetFrame) {
    clearTimeout(this._inputSuspendTimer);
    this.outputFxRack.setRenderActive(true);
    this.outputPathConnected = true;
    this._tailQuietFrames = 0;
    let next = 'PLAYING';
    if (this.state === 'EMPTY' || (this.state === 'STOPPED' && this.loopLength === 0)) next = 'RECORDING';
    else if (this.state === 'RECORDING') next = this.engine.recMode === 'REC_OVER_PLAY' ? 'OVERDUBBING' : 'PLAYING';
    else if (this.state === 'PLAYING') next = 'OVERDUBBING';
    else if (this.state === 'OVERDUBBING') next = 'PLAYING';
    const launchFrame = Number.isFinite(targetFrame) ? targetFrame : this.engine.getLaunchTargetFrame();
    const waitsForGrid = launchFrame > 0
      && ((this.state === 'EMPTY' && next === 'RECORDING')
        || (this.state === 'RECORDING' && (next === 'PLAYING' || next === 'OVERDUBBING')));
    if (waitsForGrid) {
      this.setInputPathActive(true);
    } else {
      this.setInputPathActive(this.monitorEnabled || next === 'RECORDING' || next === 'OVERDUBBING');
    }
    this.send('setState', { state: next, targetFrame: launchFrame });
  }

  stop(targetFrame = 0) {
    // O botão altera apenas o transporte do worklet. O grafo e todos os FX
    // continuam conectados, exatamente como um canal de DAW recebendo silêncio.
    this.send('setState', { state: 'STOPPED', targetFrame });
    this._inputSuspendTimer = setTimeout(() => this.setInputPathActive(this.monitorEnabled), 18);
  }
  play(targetFrame) {
    if (this.loopLength <= 0) return;
    clearTimeout(this._inputSuspendTimer);
    this.outputFxRack.setRenderActive(true);
    this.outputPathConnected = true;
    this._tailQuietFrames = 0;
    this.setInputPathActive(this.monitorEnabled);
    const launchFrame = Number.isFinite(targetFrame) ? targetFrame : this.engine.getLaunchTargetFrame();
    this.send('setState', { state: 'PLAYING', targetFrame: launchFrame });
  }
  clear() { this.send('clear'); }
  undo() { this.send('undo'); }
  redo() { this.send('redo'); }
  setTrim(startRatio, endRatio) { this.send('setTrim', { startRatio, endRatio }); }
  resetTrim() { this.send('resetTrim'); }
  setQuantizeSamples(samples, originFrame = 0, graceSamples = 0) {
    this.send('setQuantize', { samples, originFrame, graceSamples });
  }
  setRecordLatencySamples(samples) { this.send('setRecordLatency', { samples }); }
  setFixedLengthSamples(samples) { this.send('setFixedLength', { samples }); }
  setRecMode(mode) { this.send('setRecMode', { mode }); }
  setReverse(value) { this.reverse = !!value; this.send('setReverse', { value: this.reverse }); }
  setTempo(bpm) { this.send('setTempo', { bpm, originalBpm: this.originalBpm || undefined }); }

  setInputGain(value) { ns_smooth(this.inputGain.gain, value, this.ctx); }
  setInputEQ(band, value) {
    const node = { low: this.inEqLow, mid: this.inEqMid, high: this.inEqHigh }[band];
    if (node) ns_smooth(node.gain, value, this.ctx);
  }
  setGain(value) { this._userGain = Number(value); this.engine.updateSoloMute(); }
  setMute(value) { this.muted = !!value; this.engine.updateSoloMute(); }
  setSolo(value) { this.soloed = !!value; this.engine.updateSoloMute(); }
  setPan(value) { ns_smooth(this.panner.pan, value, this.ctx); ns_smooth(this.monitorPanner.pan, value, this.ctx); }
  setMonitor(value) {
    this.monitorEnabled = !!value;
    clearTimeout(this._inputSuspendTimer);
    this.setInputPathActive(this.monitorEnabled || this.state === 'RECORDING' || this.state === 'OVERDUBBING');
    ns_smooth(this.monitorGain.gain, this.monitorEnabled ? 1 : 0, this.ctx, 0.012);
  }
  setInputPathActive(value) {
    const active = !!value;
    if (active === this.inputPathConnected) return;
    try { this.input.disconnect(); } catch (error) {}
    if (active) {
      this.inputFxRack.setRenderActive(true);
      this.input.connect(this.inputGain);
    } else {
      this.inputFxRack.setRenderActive(false);
    }
    this.inputPathConnected = active;
  }
  applyAudibility(anySolo) {
    const audible = !this.muted && (!anySolo || this.soloed);
    ns_smooth(this.trackGain.gain, audible ? this._userGain : 0, this.ctx, 0.012);
    ns_smooth(this.monitorTrackGain.gain, audible ? this._userGain : 0, this.ctx, 0.012);
  }

  addInputEffect(id) { return this.inputFxRack.add(id); }
  removeInputEffect(fx) { this.inputFxRack.remove(fx); }
  setInputFxEnabled(value) { this.inputFxRack.setEnabled(value); }
  addOutputEffect(id) { return this.outputFxRack.add(id); }
  removeOutputEffect(fx) { this.outputFxRack.remove(fx); }
  setOutputFxEnabled(value) { this.outputFxRack.setEnabled(value); }
  copyFxChain(from, to) {
    const source = from === 'input' ? this.inputFxRack : this.outputFxRack;
    const target = to === 'input' ? this.inputFxRack : this.outputFxRack;
    if (source === target) return false;
    target.restore(source.serialize());
    this.engine.syncEffectTempo();
    return true;
  }

  requestExport() {
    return new Promise((resolve, reject) => {
      const requestId = `${this.index}-${++this._exportSequence}`;
      const timer = setTimeout(() => {
        this._exportRequests.delete(requestId);
        reject(new Error('EXPORT_TIMEOUT'));
      }, 12000);
      this._exportRequests.set(requestId, { resolve, reject, timer });
      this.send('requestExport', { requestId });
    });
  }

  async exportWav() {
    const rendered = await this.requestExport();
    return ns_encodeStereoWav(rendered.left, rendered.right, rendered.sampleRate);
  }

  loadPcm16(left, right, originalBpm = this.engine.bpm) {
    const leftData = left instanceof Int16Array ? left : new Int16Array(left);
    const rightData = right instanceof Int16Array ? right : new Int16Array(right || left);
    this.looperNode.port.postMessage({ type: 'loadPCM', left: leftData, right: rightData, originalBpm }, [leftData.buffer, rightData.buffer]);
  }

  async importAudioFile(file) {
    if (this.state === 'PLAYING' || this.state === 'OVERDUBBING') {
      // Importar troca o buffer da track no worklet sem fade (loadPCM corta na hora).
      // Se a track ainda estiver audível, para com fade e espera acomodar antes de
      // trocar o conteúdo, senão o import solta um clique/corte abrupto.
      this.stop();
      await new Promise((resolve) => setTimeout(resolve, 90));
    }
    const bytes = await file.arrayBuffer();
    const decoded = await this.ctx.decodeAudioData(bytes.slice(0));
    const maxLength = Math.floor(this.ctx.sampleRate * 180);
    const sourceLeft = decoded.getChannelData(0);
    const sourceRight = decoded.numberOfChannels > 1 ? decoded.getChannelData(1) : sourceLeft;
    const left = decoded.sampleRate === this.ctx.sampleRate
      ? sourceLeft.slice(0, maxLength)
      : ns_resampleChannel(sourceLeft, decoded.sampleRate, this.ctx.sampleRate, maxLength);
    const right = decoded.sampleRate === this.ctx.sampleRate
      ? sourceRight.slice(0, maxLength)
      : ns_resampleChannel(sourceRight, decoded.sampleRate, this.ctx.sampleRate, maxLength);
    const pcmLeft = ns_floatToInt16(left);
    const pcmRight = ns_floatToInt16(right);
    this.looperNode.port.postMessage({ type: 'loadPCM', left: pcmLeft, right: pcmRight, originalBpm: this.originalBpm || this.engine.bpm }, [pcmLeft.buffer, pcmRight.buffer]);
    return Math.min(left.length, right.length) / this.ctx.sampleRate;
  }

  getMeterLevel() {
    this.analyser.getFloatTimeDomainData(this._meterBuffer);
    let peak = 0;
    for (let i = 0; i < this._meterBuffer.length; i++) peak = Math.max(peak, Math.abs(this._meterBuffer[i]));
    // Tail-aware sleep: economiza DSP somente depois que a saída real do canal
    // ficou abaixo de -90 dB por cerca de sete segundos. Esse intervalo também
    // protege delays longos que possuem silêncio entre as repetições.
    if ((this.state === 'STOPPED' || this.state === 'EMPTY') && this.outputFxRack.renderActive) {
      if (peak < 0.000032) this._tailQuietFrames++;
      else this._tailQuietFrames = 0;
      if (this._tailQuietFrames >= this._tailSleepFrames) {
        this.outputFxRack.setRenderActive(false);
        this.outputPathConnected = false;
        this._tailQuietFrames = 0;
      }
    } else if (this.state === 'PLAYING' || this.state === 'OVERDUBBING') {
      this._tailQuietFrames = 0;
    }
    return peak;
  }

  getInputLevel() {
    if (!this.inputPathConnected) return 0;
    this.inputAnalyser.getFloatTimeDomainData(this._inputMeterBuffer);
    let peak = 0;
    for (let i = 0; i < this._inputMeterBuffer.length; i++) peak = Math.max(peak, Math.abs(this._inputMeterBuffer[i]));
    return peak;
  }

  serialize() {
    return {
      inputGain: this.inputGain.gain.value,
      inputEQ: { low: this.inEqLow.gain.value, mid: this.inEqMid.gain.value, high: this.inEqHigh.gain.value },
      gain: this._userGain,
      pan: this.panner.pan.value,
      reverse: this.reverse,
      originalBpm: this.originalBpm,
      inputFx: this.inputFxRack.serialize(),
      outputFx: this.outputFxRack.serialize(),
    };
  }

  restore(data) {
    if (!data) return;
    this.setInputGain(data.inputGain ?? 1);
    Object.entries(data.inputEQ || {}).forEach(([band, value]) => this.setInputEQ(band, value));
    this.setGain(data.gain ?? 0.82);
    this.setPan(data.pan ?? 0);
    this.setReverse(!!data.reverse);
    this.originalBpm = Number(data.originalBpm) || 0;
    this.setTempo(this.engine.bpm);
    this.inputFxRack.restore(data.inputFx);
    this.outputFxRack.restore(data.outputFx);
  }
}

class NSAudioEngine {
  constructor() {
    this.ctx = null;
    this.tracks = [];
    this.recMode = 'REC_PLAY_OVER';
    this.quantizeMode = 'OFF';
    this.recLengthMode = 'FREE';
    this.recBars = 0;
    this.bpm = 120;
    this.timeSigNum = 4;
    this.mediaStream = null;
    this.sourceNode = null;
    this.inputDeviceId = '';
    this.outputDeviceId = localStorage.getItem('nt-looper-output-device') || '';
    this.recordIsolation = false;
    this.metroOn = false;
    this.metroLevel = 0.35;
    this.transportOriginFrame = 0;
    this.timeline = null;
    this.tailReverbEnabled = true;
    this.tailReverbDuration = 2.2;
    this.masterRecording = false;
    this.masterRecLeft = [];
    this.masterRecRight = [];
    this.masterRecSamples = 0;
    this._masterRecStop = null;
    const savedBufferMode = localStorage.getItem('nt-looper-audio-buffer');
    this.audioBufferMode = ['LOW', 'BALANCED', 'SAFE'].includes(savedBufferMode) ? savedBufferMode : 'LOW';
    const savedSampleRate = localStorage.getItem('nt-looper-sample-rate');
    this.sampleRateMode = ['AUTO', '44100', '48000'].includes(savedSampleRate) ? savedSampleRate : 'AUTO';
  }

  async init() {
    const latencyHint = { LOW: 0.005, BALANCED: 'interactive', SAFE: 'balanced' }[this.audioBufferMode] || 'interactive';
    const Context = window.AudioContext || window.webkitAudioContext;
    const contextOptions = { latencyHint };
    if (this.sampleRateMode !== 'AUTO') contextOptions.sampleRate = Number(this.sampleRateMode);
    if (this.outputDeviceId) contextOptions.sinkId = this.outputDeviceId;
    try {
      this.ctx = new Context(contextOptions);
    } catch (error) {
      // Alguns navegadores (inclusive Safari/iPadOS) rejeitam sinkId no construtor
      // ou uma sampleRate que o hardware não aceita. Tenta de novo sem essas opções
      // em vez de deixar o boot falhar.
      delete contextOptions.sinkId;
      delete contextOptions.sampleRate;
      this.outputDeviceId = '';
      this.ctx = new Context(contextOptions);
    }
    this.transportOriginFrame = Math.round((this.ctx.currentTime + 0.08) * this.ctx.sampleRate);
    this.timeline = new NSMasterTimeline(this.ctx, {
      bpm: this.bpm,
      beatsPerBar: this.timeSigNum,
      originFrame: this.transportOriginFrame,
    });
    await this.ctx.audioWorklet.addModule('js/looper-processor.js');
    await this.ctx.audioWorklet.addModule('js/effects-processor.js');
    await this.ctx.audioWorklet.addModule('js/advanced-fx-processor.js');
    await this.ctx.audioWorklet.addModule('js/master-recorder-processor.js');
    await this.ctx.audioWorklet.addModule('js/transport-processor.js');

    this.masterBus = this.ctx.createGain();
    this.sampler = new NSSamplerBank(this.ctx, this.masterBus, () => this.bpm);
    this.masterFxRack = new NSFxRack(this.ctx, { enabled: true });
    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.value = 0.86;
    this.masterAnalyser = this.ctx.createAnalyser();
    this.masterAnalyser.fftSize = 512;
    this._masterMeterBuffer = new Float32Array(this.masterAnalyser.fftSize);

    this.masterBus.connect(this.masterFxRack.input);
    this.masterFxRack.output.connect(this.masterGain);
    // O retorno ao vivo evita o look-ahead dos compressores/limiters do master.
    // Isso reduz o round trip sem alterar o processamento das tracks gravadas.
    this.liveMonitorBus = this.ctx.createGain();
    this.liveMonitorBus.connect(this.masterGain);
    this.masterGain.connect(this.masterAnalyser);
    this.masterGain.connect(this.ctx.destination);

    this.tailSend = this.ctx.createGain();
    this.tailConvolver = this.ctx.createConvolver();
    this.tailReturn = this.ctx.createGain();
    this.tailSend.gain.value = this.tailReverbEnabled ? 0.2 : 0;
    this.tailReturn.gain.value = 0.5;
    this.tailConvolver.buffer = ns_makeStudioImpulse(this.ctx, this.tailReverbDuration, 3.2, 0.52);
    // Auxiliar global contínuo, como um send de DAW. STOP nunca altera seu ganho
    // ou suas conexões; ao receber silêncio ele produz apenas a cauda natural.
    this.masterBus.connect(this.tailSend);
    this.tailSend.connect(this.tailConvolver).connect(this.tailReturn).connect(this.masterGain);

    this.masterRecorderNode = new AudioWorkletNode(this.ctx, 'ns-master-recorder', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [2],
      channelCount: 2,
      channelCountMode: 'explicit',
    });
    this.masterRecorderSink = this.ctx.createGain();
    this.masterRecorderSink.gain.value = 1e-9;
    this.masterGain.connect(this.masterRecorderNode).connect(this.masterRecorderSink).connect(this.ctx.destination);
    this.masterRecorderNode.port.onmessage = (event) => this.handleMasterRecorderMessage(event.data || {});

    this.metroGain = this.ctx.createGain();
    this.metroGain.gain.value = this.metroLevel;
    this.transportNode = new AudioWorkletNode(this.ctx, 'ns-transport', {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [2],
    });
    this.transportNode.connect(this.metroGain).connect(this.ctx.destination);
    this.configureTransport();

    this.inTrim = this.ctx.createGain();
    this.inTrim.gain.value = Math.pow(10, 12 / 20);
    this.inLowCut = this.ctx.createBiquadFilter();
    this.inLowCut.type = 'highpass'; this.inLowCut.frequency.value = 55; this.inLowCut.Q.value = 0.7;
    this.inPresence = this.ctx.createBiquadFilter();
    this.inPresence.type = 'peaking'; this.inPresence.frequency.value = 2600; this.inPresence.Q.value = 0.85;
    this.inAir = this.ctx.createBiquadFilter();
    this.inAir.type = 'highshelf'; this.inAir.frequency.value = 9000;
    this.inputFxRack = new NSFxRack(this.ctx, { enabled: true });
    this.inputFxRack.onLatencyChange = () => this.applyQuantize();
    this.inputRecordBus = this.ctx.createGain();
    this.inTrim.connect(this.inLowCut).connect(this.inPresence).connect(this.inAir).connect(this.inputFxRack.input);
    this.inputFxRack.output.connect(this.inputRecordBus);
    this.inputAnalyser = this.ctx.createAnalyser();
    this.inputAnalyser.fftSize = 256;
    this._inputMeterBuffer = new Float32Array(this.inputAnalyser.fftSize);
    this.inputRecordBus.connect(this.inputAnalyser);
    this.inputMeterSink = this.ctx.createGain();
    this.inputMeterSink.gain.value = 0;
    this.inputAnalyser.connect(this.inputMeterSink).connect(this.ctx.destination);

    for (let i = 0; i < NS_TRACK_COUNT; i++) {
      const track = new NSTrack(this, i);
      this.tracks.push(track);
      this.inputRecordBus.connect(track.input);
    }
  }

  async connectInputDevice(deviceId = '') {
    if (this.mediaStream) this.mediaStream.getTracks().forEach((track) => track.stop());
    this.inputDeviceId = deviceId || '';
    const audio = {
      echoCancellation: this.recordIsolation,
      noiseSuppression: false,
      autoGainControl: false,
      channelCount: { ideal: 2 },
      latency: { ideal: 0 },
    };
    if (deviceId) audio.deviceId = { exact: deviceId };
    this.mediaStream = await navigator.mediaDevices.getUserMedia({ audio });
    if (this.sourceNode) { try { this.sourceNode.disconnect(); } catch (error) {} }
    this.sourceNode = this.ctx.createMediaStreamSource(this.mediaStream);
    this.sourceNode.connect(this.inTrim);
    const sourceTrack = this.mediaStream.getAudioTracks()[0];
    const inputLatency = Number(sourceTrack?.getSettings?.().latency);
    this.inputLatencySeconds = Number.isFinite(inputLatency) && inputLatency > 0 ? inputLatency : 0;
    this.applyQuantize();
    return this.sourceNode;
  }

  async setOutputDevice(deviceId = '') {
    this.outputDeviceId = deviceId || '';
    localStorage.setItem('nt-looper-output-device', this.outputDeviceId);
    if (!this.supportsOutputDeviceSelection()) return false;
    await this.ctx.setSinkId(deviceId || '');
    return true;
  }

  // Safari/WebKit (todo navegador em iPadOS/iOS, inclusive "Chrome" e "Firefox" ali,
  // que são o motor WebKit por baixo) não implementa AudioContext.setSinkId. Nesses
  // navegadores a saída de áudio segue a rota do sistema (Central de Controle/AirPlay),
  // não o que é escolhido aqui dentro do app.
  supportsOutputDeviceSelection() {
    return !!this.ctx && typeof this.ctx.setSinkId === 'function';
  }

  async setRecordIsolation(enabled) {
    this.recordIsolation = !!enabled;
    if (this.mediaStream) await this.connectInputDevice(this.inputDeviceId);
  }

  setInputTrimDb(db) { ns_smooth(this.inTrim.gain, Math.pow(10, Number(db) / 20), this.ctx); }
  setInputLowCut(hz) { ns_smooth(this.inLowCut.frequency, hz, this.ctx); }
  setBrightness(db) {
    ns_smooth(this.inPresence.gain, db * 0.55, this.ctx);
    ns_smooth(this.inAir.gain, db, this.ctx);
  }

  setInputFxEnabled(value) { this.inputFxRack.setEnabled(value); }
  addInputEffect(id) { return this.inputFxRack.add(id); }
  removeInputEffect(fx) { this.inputFxRack.remove(fx); }
  setAllTrackFxEnabled(value) { this.tracks.forEach((track) => track.setOutputFxEnabled(value)); }
  setAllInputTrackFxEnabled(value) { this.tracks.forEach((track) => track.setInputFxEnabled(value)); }

  addMasterEffect(id) { return this.masterFxRack.add(id); }
  removeMasterEffect(fx) { this.masterFxRack.remove(fx); }
  setMasterGain(value) { ns_smooth(this.masterGain.gain, value, this.ctx); }

  setAudioBufferMode(mode) {
    this.audioBufferMode = ['LOW', 'BALANCED', 'SAFE'].includes(mode) ? mode : 'LOW';
    localStorage.setItem('nt-looper-audio-buffer', this.audioBufferMode);
  }

  setSampleRateMode(mode) {
    this.sampleRateMode = ['AUTO', '44100', '48000'].includes(String(mode)) ? String(mode) : 'AUTO';
    localStorage.setItem('nt-looper-sample-rate', this.sampleRateMode);
  }

  getFxLoad() {
    const racks = [this.inputFxRack, this.masterFxRack];
    this.tracks.forEach((track) => racks.push(track.inputFxRack, track.outputFxRack));
    const score = racks.reduce((total, rack) => {
      if (!rack.enabled || !rack.renderActive || rack.intensity <= 0) return total;
      return total + rack.chain.reduce((rackTotal, fx) => {
        if (fx.bypassed) return rackTotal;
        return rackTotal + (NS_FX_CPU_COST[fx.id] || 1);
      }, 0);
    }, 0);
    return { score, label: score >= 28 ? 'HIGH' : score >= 15 ? 'MEDIUM' : 'LIGHT' };
  }

  getAudioDiagnostics() {
    const latency = ((this.ctx.baseLatency || 0) + (this.ctx.outputLatency || 0)) * 1000;
    const load = this.getFxLoad();
    return `${Math.round(this.ctx.sampleRate / 1000)} kHz · ${latency ? latency.toFixed(1) : '?'} ms · DSP ${load.label} ${load.score}`;
  }

  updateSoloMute() {
    const anySolo = this.tracks.some((track) => track.soloed);
    this.tracks.forEach((track) => track.applyAudibility(anySolo));
  }

  playAll() {
    const targetFrame = this.getLaunchTargetFrame();
    this.tracks.forEach((track) => track.play(targetFrame));
  }
  stopAll() {
    // Um único frame para todas as fontes evita que a quinta track caia em um
    // render quantum diferente das anteriores. Nada é automatizado no master.
    const quantum = 128;
    const leadFrames = Math.max(quantum * 2, Math.ceil(this.ctx.sampleRate * 0.008));
    const targetFrame = Math.ceil((this.ctx.currentTime * this.ctx.sampleRate + leadFrames) / quantum) * quantum;
    const targetTime = targetFrame / this.ctx.sampleRate;
    this.tracks.forEach((track) => track.stop(targetFrame));
    if (this.sampler) this.sampler.stopAll(targetTime);
  }
  clearAll() { this.tracks.forEach((track) => track.clear()); }

  setBpm(value) {
    this.bpm = Math.max(40, Math.min(240, Number(value)));
    if (this.sampler) this.sampler.syncBpm();
    if (this.timeline) {
      this.timeline.setTempo(this.bpm);
      this.transportOriginFrame = this.timeline.originFrame;
    }
    this.configureTransport();
    this.applyQuantize();
    this.applyFixedLength();
    this.tracks.forEach((track) => track.setTempo(this.bpm));
    this.syncEffectTempo();
  }
  syncEffectTempo() {
    if (!this.ctx) return;
    const racks = [this.inputFxRack, this.masterFxRack];
    this.tracks.forEach((track) => racks.push(track.inputFxRack, track.outputFxRack));
    racks.filter(Boolean).forEach((rack) => rack.chain.forEach((fx) => {
      if (Object.prototype.hasOwnProperty.call(fx.params || {}, 'bpm')) fx.setParam('bpm', this.bpm);
      if (Object.prototype.hasOwnProperty.call(fx.params || {}, 'transportOriginFrame')) fx.setParam('transportOriginFrame', this.transportOriginFrame);
    }));
  }
  setQuantizeMode(mode) { this.quantizeMode = mode; this.applyQuantize(); }
  getLaunchTargetFrame(mode = this.quantizeMode) {
    return this.timeline ? this.timeline.nextLaunchFrame(mode) : 0;
  }
  applyQuantize() {
    const samples = this.timeline ? this.timeline.gridSamples(this.quantizeMode) : 0;
    const originFrame = this.timeline ? this.timeline.originFrame : Math.max(0, this.transportOriginFrame || Math.round(this.ctx.currentTime * this.ctx.sampleRate));
    const ioLatency = (this.ctx.baseLatency || 0) + (this.ctx.outputLatency || 0);
    // Alinha overdubs ao pulso que chegou ao ouvido. A primeira camada mantém
    // offset zero porque ela própria define o início absoluto do loop.
    const recordLatencySeconds = Math.min(0.25, Math.max(0, ioLatency + (this.inputLatencySeconds || 0)));
    const ioRecordLatencySamples = Math.round(recordLatencySeconds * this.ctx.sampleRate);
    const globalFxLatencySamples = this.inputFxRack ? this.inputFxRack.getLatencySamples() : 0;
    this.tracks.forEach((track) => {
      // A timeline mestre agenda somente fronteiras futuras. A tolerância
      // retroativa das versões anteriores fica desativada para impedir que
      // metrônomo e REC escolham pulsos diferentes.
      track.setQuantizeSamples(samples, originFrame, 0);
      const trackFxLatencySamples = track.inputFxRack ? track.inputFxRack.getLatencySamples() : 0;
      track.setRecordLatencySamples(ioRecordLatencySamples + globalFxLatencySamples + trackFxLatencySamples);
    });
  }
  setRecLength(mode) {
    if (mode === 'FREE') { this.recLengthMode = 'FREE'; this.recBars = 0; }
    else { this.recLengthMode = 'BARS'; this.recBars = Number(mode); }
    this.applyFixedLength();
  }
  applyFixedLength() {
    let samples = 0;
    if (this.recLengthMode === 'BARS' && this.recBars > 0) {
      samples = Math.round((60 / this.bpm) * this.timeSigNum * this.recBars * this.ctx.sampleRate);
    }
    this.tracks.forEach((track) => track.setFixedLengthSamples(samples));
  }
  setRecMode(mode) {
    this.recMode = mode;
    this.tracks.forEach((track) => track.setRecMode(mode));
  }

  setMetroEnabled(value) {
    this.metroOn = !!value;
    this.configureTransport();
  }
  setMetroLevel(value) {
    this.metroLevel = Math.max(0, Math.min(1, Number(value)));
    if (this.metroGain) ns_smooth(this.metroGain.gain, this.metroLevel, this.ctx, 0.01);
  }
  startMetro() {
    this.metroOn = true;
    this.configureTransport();
  }
  preserveTransportPhase(previousBpm) {
    if (!this.timeline || !previousBpm) return;
    this.timeline.setTempo(this.bpm);
    this.transportOriginFrame = this.timeline.originFrame;
  }
  configureTransport() {
    if (!this.transportNode || !this.ctx) return;
    if (this.timeline) this.transportOriginFrame = this.timeline.originFrame;
    const beatSamples = this.timeline ? this.timeline.beatSamples : Math.round(this.ctx.sampleRate * 60 / this.bpm);
    this.transportNode.port.postMessage({
      type: 'configure',
      enabled: this.metroOn,
      originFrame: this.transportOriginFrame,
      beatSamples,
      beatsPerBar: this.timeSigNum,
    });
  }
  stopMetro() {
    this.metroOn = false;
    this.configureTransport();
  }

  setTailReverb(enabled, duration = this.tailReverbDuration) {
    this.tailReverbEnabled = !!enabled;
    this.tailReverbDuration = Math.max(0, Number(duration));
    this.tailConvolver.buffer = ns_makeStudioImpulse(this.ctx, Math.max(0.2, this.tailReverbDuration), 3.2, 0.52);
    ns_smooth(this.tailSend.gain, this.tailReverbEnabled && this.tailReverbDuration > 0 ? 0.2 : 0, this.ctx, 0.02);
    ns_smooth(this.tailReturn.gain, 0.5, this.ctx, 0.02);
  }
  startMasterRecording() {
    if (this.masterRecording) return false;
    this.masterRecLeft = [];
    this.masterRecRight = [];
    this.masterRecSamples = 0;
    this.masterRecording = true;
    this.masterRecorderNode.port.postMessage({ type: 'start' });
    return true;
  }

  handleMasterRecorderMessage(message) {
    if (message.type === 'chunk') {
      this.masterRecLeft.push(message.left);
      this.masterRecRight.push(message.right);
      this.masterRecSamples += Math.min(message.left.length, message.right.length);
      return;
    }
    if (message.type !== 'stopped' || !this._masterRecStop) return;
    const request = this._masterRecStop;
    this._masterRecStop = null;
    clearTimeout(request.timer);
    const left = new Float32Array(this.masterRecSamples);
    const right = new Float32Array(this.masterRecSamples);
    let offset = 0;
    for (let i = 0; i < this.masterRecLeft.length; i++) {
      left.set(this.masterRecLeft[i], offset);
      right.set(this.masterRecRight[i], offset);
      offset += Math.min(this.masterRecLeft[i].length, this.masterRecRight[i].length);
    }
    this.masterRecLeft = [];
    this.masterRecRight = [];
    this.masterRecSamples = 0;
    request.resolve(left.length ? ns_encodeStereoWav(left, right, message.sampleRate || this.ctx.sampleRate) : null);
  }

  stopMasterRecording() {
    return new Promise((resolve, reject) => {
      if (!this.masterRecording) { resolve(null); return; }
      this.masterRecording = false;
      const timer = setTimeout(() => {
        this._masterRecStop = null;
        reject(new Error('RECORDER_STOP_TIMEOUT'));
      }, 5000);
      this._masterRecStop = { resolve, reject, timer };
      this.masterRecorderNode.port.postMessage({ type: 'stop' });
    });
  }

  getMasterLevel() {
    this.masterAnalyser.getFloatTimeDomainData(this._masterMeterBuffer);
    let peak = 0;
    for (let i = 0; i < this._masterMeterBuffer.length; i++) peak = Math.max(peak, Math.abs(this._masterMeterBuffer[i]));
    return peak;
  }

  getInputLevel() {
    if (!this.inputAnalyser) return 0;
    this.inputAnalyser.getFloatTimeDomainData(this._inputMeterBuffer);
    let peak = 0;
    for (let i = 0; i < this._inputMeterBuffer.length; i++) peak = Math.max(peak, Math.abs(this._inputMeterBuffer[i]));
    return peak;
  }

  copyTrackSetup(sourceIndex, targetIndex) {
    const source = this.tracks[Number(sourceIndex)];
    const target = this.tracks[Number(targetIndex)];
    if (!source || !target || source === target) return false;
    target.restore(source.serialize());
    this.syncEffectTempo();
    return true;
  }

  serializeSetup() {
    return {
      version: 17,
      bpm: this.bpm,
      quantizeMode: this.quantizeMode,
      recLengthMode: this.recLengthMode,
      recBars: this.recBars,
      recMode: this.recMode,
      metroLevel: this.metroLevel,
      tailReverbEnabled: this.tailReverbEnabled,
      tailReverbDuration: this.tailReverbDuration,
      inputTrimDb: 20 * Math.log10(Math.max(0.0001, this.inTrim.gain.value)),
      inputLowCut: this.inLowCut.frequency.value,
      brightness: this.inAir.gain.value,
      masterGain: this.masterGain.gain.value,
      globalInputFx: this.inputFxRack.serialize(),
      masterFx: this.masterFxRack.serialize(),
      sampler: this.sampler ? this.sampler.serialize() : [],
      tracks: this.tracks.map((track) => track.serialize()),
    };
  }

  saveSetup() {
    localStorage.setItem('nt-looper-setup-v17', JSON.stringify(this.serializeSetup()));
  }

  loadSetup() {
    try {
      const raw = localStorage.getItem('nt-looper-setup-v17')
        || localStorage.getItem('nt-looper-setup-v16')
        || localStorage.getItem('nt-looper-setup-v15')
        || localStorage.getItem('nt-looper-setup-v14')
        || localStorage.getItem('nt-looper-setup-v13')
        || localStorage.getItem('nt-looper-setup-v12')
        || localStorage.getItem('nt-looper-setup-v11')
        || localStorage.getItem('nt-looper-setup-v10')
        || localStorage.getItem('nt-looper-setup-v9')
        || localStorage.getItem('nt-looper-setup-v8')
        || localStorage.getItem('nt-looper-setup-v7')
        || localStorage.getItem('nt-looper-setup-v6')
        || localStorage.getItem('nt-looper-setup-v5');
      if (!raw) return null;
      const data = JSON.parse(raw);
      if ((data.version || 0) < 6) {
        data.inputTrimDb = Math.max(12, Number(data.inputTrimDb) || 0);
      }
      data.version = 17;
      this.applySetup(data);
      return data;
    } catch (error) {
      return null;
    }
  }

  loadFactoryDefaults() {
    const setup = typeof ns_factorySetup === 'function' ? ns_factorySetup() : null;
    if (setup) this.applySetup(setup);
    return setup;
  }

  ensureDefaultChains() {
    const addPreset = (rack, preset) => {
      const fx = rack.add(preset.id);
      if (!fx) return;
      Object.entries(preset.params || {}).forEach(([id, value]) => fx.setParam(id, value));
      fx.setBypass(!!preset.bypassed);
    };
    this.tracks.forEach((track) => {
      const inputDefaults = typeof NS_DEFAULT_INPUT_CHAIN !== 'undefined' ? NS_DEFAULT_INPUT_CHAIN : [];
      const outputDefaults = typeof NS_DEFAULT_TRACK_CHAIN !== 'undefined' ? NS_DEFAULT_TRACK_CHAIN : [];
      for (const preset of inputDefaults) {
        if (track.inputFxRack.chain.length >= NS_MAX_FX_PER_RACK) break;
        if (!track.inputFxRack.chain.some((fx) => fx.id === preset.id)) addPreset(track.inputFxRack, preset);
      }
      for (const preset of outputDefaults) {
        if (track.outputFxRack.chain.length >= NS_MAX_FX_PER_RACK) break;
        if (!track.outputFxRack.chain.some((fx) => fx.id === preset.id)) addPreset(track.outputFxRack, preset);
      }
    });
    if (!this.masterFxRack.chain.some((fx) => fx.id === 'compressor')) addPreset(this.masterFxRack, ns_fxPreset('compressor', { threshold: -18, ratio: 3, attack: 12, release: 220, makeup: 1.12 }));
    if (!this.masterFxRack.chain.some((fx) => fx.id === 'limiter')) addPreset(this.masterFxRack, ns_fxPreset('limiter', { ceiling: -1, release: 80, input: 1 }));
    this.masterFxRack.setEnabled(true);
    this.syncEffectTempo();
  }

  async exportAllWavZip() {
    const files = [];
    for (let index = 0; index < this.tracks.length; index++) {
      const track = this.tracks[index];
      if (!track.loopLength) continue;
      files.push({ name: `track-${index + 1}.wav`, data: await track.exportWav() });
    }
    if (this.sampler) this.sampler.pads.forEach((pad, index) => {
      const data = this.sampler.exportOriginalWav(index);
      if (data) files.push({ name: `sampler-pad-${index + 1}.wav`, data });
    });
    if (!files.length) return null;
    return ns_buildStoreZip(files);
  }

  async saveProjectBlob() {
    const trackFiles = [];
    for (let index = 0; index < this.tracks.length; index++) {
      const track = this.tracks[index];
      if (!track.loopLength) continue;
      trackFiles.push({ track: index, name: `track-${index + 1}.wav`, data: await track.exportWav() });
    }
    if (this.sampler) {
      this.sampler.pads.forEach((pad, index) => {
        const data = this.sampler.exportOriginalWav(index);
        if (data) trackFiles.push({ kind: 'pad', pad: index, name: `pad-${index + 1}.wav`, data });
      });
    }
    return ns_packProject(this.serializeSetup(), trackFiles);
  }

  async loadProjectFile(file) {
    const project = await ns_unpackProject(file);
    this.stopAll();
    if (this.sampler) this.sampler.clearAll();
    this.applySetup(project.manifest.setup || {});
    const populated = new Set();
    for (const entry of project.files) {
      if (entry.kind === 'pad') {
        if (this.sampler && Number.isInteger(entry.pad)) await this.sampler.loadBytes(entry.pad, entry.data, entry.name);
        continue;
      }
      const track = this.tracks[entry.track];
      if (!track) continue;
      await track.importAudioFile(new Blob([entry.data], { type: 'audio/wav' }));
      populated.add(entry.track);
    }
    if (this.sampler && project.manifest.setup?.sampler) this.sampler.restore(project.manifest.setup.sampler);
    this.tracks.forEach((track, index) => { if (!populated.has(index)) track.clear(); });
    return project.manifest;
  }

  applySetup(data) {
    if (!data) return;
    this.setBpm(data.bpm ?? 120);
    this.setQuantizeMode(data.quantizeMode || 'OFF');
    this.setRecLength(data.recLengthMode === 'BARS' ? (data.recBars || 1) : 'FREE');
    this.setRecMode(data.recMode || 'REC_PLAY_OVER');
    this.setMetroLevel(data.metroLevel ?? 0.35);
    this.setTailReverb(data.tailReverbEnabled !== false, data.tailReverbDuration ?? 2.2);
    this.setInputTrimDb(data.inputTrimDb ?? 0);
    this.setInputLowCut(data.inputLowCut ?? 55);
    this.setBrightness(data.brightness ?? 0);
    this.setMasterGain(data.masterGain ?? 0.86);
    this.inputFxRack.restore(data.globalInputFx);
    this.masterFxRack.restore(data.masterFx);
    if (this.sampler && data.sampler) this.sampler.restore(data.sampler);
    (data.tracks || []).forEach((track, index) => { if (this.tracks[index]) this.tracks[index].restore(track); });
    this.syncEffectTempo();
  }
}

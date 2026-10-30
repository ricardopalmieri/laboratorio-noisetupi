// looper-processor.js
// Motor de loop por track. Cada AudioWorkletNode possui buffers, trim e histórico próprios.

const NS_CHUNK_SIZE = 65536;
const NS_PCM_SCALE = 32767;
const NS_MIN_LOOP_SAMPLES = 128;

class LooperProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const opt = (options && options.processorOptions) || {};
    this.maxSeconds = opt.maxSeconds || 180;
    this.maxLayers = opt.maxLayers || 3;
    this.sr = sampleRate;
    this.maxSamples = Math.floor(this.maxSeconds * this.sr);

    this.layers = [];
    this.redoLayers = [];
    this.activeLayer = -1;
    this.sourceLength = 0;
    this.loopStart = 0;
    this.loopEnd = 0;
    this.loopLength = 0;
    this.writeHead = 0;
    this.playHead = 0;
    this.currentBpm = 120;
    this.originalBpm = 0;
    this.playbackRate = 1;
    this.playbackCompensation = 0;
    this.playbackCompensationTarget = 0;

    this.state = 'EMPTY';
    this.reverse = false;
    this.playbackLevel = 1;
    this.quantizeSamples = 0;
    this.quantizeOriginFrame = 0;
    this.quantizeGraceSamples = 0;
    this.recordLatencySamples = 0;
    this.recordingStartGridOffset = 0;
    // Ajustes usados apenas ao FECHAR a primeira gravação. O motor antigo
    // preenchia o começo do buffer com silêncio quando REC chegava logo após
    // a grade, o que fazia o primeiro PLAY soar atrasado.
    this.recordingEndTrimSamples = 0;
    this.playbackCatchupSamples = 0;
    this.pendingAction = null;
    this.pendingFrame = 0;
    this.pendingPlayHead = null;
    this.fixedLengthSamples = 0;
    this.recMode = 'REC_PLAY_OVER';
    // De-click local curto. O transporte nunca toca em ganho master ou outra track.
    // Doze milissegundos evitam clique sem criar a sensação de gate antes da cauda.
    this.stopFadeTotal = Math.max(128, Math.round(this.sr * 0.012));
    this.stopFadeRemaining = 0;

    this.peakWindow = 0;
    this.peakMax = 0;
    this.peakSamples = Math.max(128, Math.floor(this.sr * 0.02));
    this.posCounter = 0;
    this.mixLeftValue = 0;
    this.mixRightValue = 0;

    this.port.onmessage = (event) => this.handleMessage(event.data || {});
  }

  makeLayer(recorded = false) {
    return { left: [], right: [], written: 0, offset: recorded ? this.recordLatencySamples : 0 };
  }

  ensureChunk(layer, channel, chunkIndex) {
    const list = channel === 0 ? layer.left : layer.right;
    if (!list[chunkIndex]) list[chunkIndex] = new Int16Array(NS_CHUNK_SIZE);
    return list[chunkIndex];
  }

  writeSample(layer, position, left, right) {
    if (!layer || position < 0 || position >= this.maxSamples) return;
    const chunkIndex = Math.floor(position / NS_CHUNK_SIZE);
    const offset = position - chunkIndex * NS_CHUNK_SIZE;
    const l = this.ensureChunk(layer, 0, chunkIndex);
    const r = this.ensureChunk(layer, 1, chunkIndex);
    l[offset] = Math.round(Math.max(-1, Math.min(1, left)) * NS_PCM_SCALE);
    r[offset] = Math.round(Math.max(-1, Math.min(1, right)) * NS_PCM_SCALE);
    if (position + 1 > layer.written) layer.written = position + 1;
  }

  readSample(layer, position, channel) {
    if (!layer || position < 0 || position >= layer.written) return 0;
    const chunkIndex = Math.floor(position / NS_CHUNK_SIZE);
    const offset = position - chunkIndex * NS_CHUNK_SIZE;
    const list = channel === 0 ? layer.left : layer.right;
    const chunk = list[chunkIndex];
    return chunk ? chunk[offset] / 32768 : 0;
  }

  mixAt(position, skipActive) {
    let left = 0;
    let right = 0;
    for (let i = 0; i < this.layers.length; i++) {
      if (skipActive && i === this.activeLayer) continue;
      const layer = this.layers[i];
      let adjusted = position;
      if (this.loopLength > 0 && layer.offset) {
        let relative = position - this.loopStart + layer.offset;
        relative %= this.loopLength;
        if (relative < 0) relative += this.loopLength;
        adjusted = this.loopStart + relative;
      }
      left += this.readSample(layer, adjusted, 0);
      right += this.readSample(layer, adjusted, 1);
    }
    this.mixLeftValue = left;
    this.mixRightValue = right;
  }

  mixAtFractional(relative, skipActive) {
    if (this.loopLength <= 0) { this.mixLeftValue = 0; this.mixRightValue = 0; return; }
    let wrapped = relative % this.loopLength;
    if (wrapped < 0) wrapped += this.loopLength;
    const a = Math.floor(wrapped);
    const b = (a + 1) % this.loopLength;
    const fraction = wrapped - a;
    let left = 0;
    let right = 0;
    for (let i = 0; i < this.layers.length; i++) {
      if (skipActive && i === this.activeLayer) continue;
      const layer = this.layers[i];
      const offset = layer.offset || 0;
      const layerA = this.loopStart + ((a + offset) % this.loopLength);
      const layerB = this.loopStart + ((b + offset) % this.loopLength);
      const la = this.readSample(layer, layerA, 0);
      const lb = this.readSample(layer, layerB, 0);
      const ra = this.readSample(layer, layerA, 1);
      const rb = this.readSample(layer, layerB, 1);
      left += la + (lb - la) * fraction;
      right += ra + (rb - ra) * fraction;
    }
    this.mixLeftValue = left;
    this.mixRightValue = right;
  }

  updatePlaybackRate() {
    this.playbackRate = this.originalBpm > 0
      ? Math.max(0.25, Math.min(4, this.currentBpm / this.originalBpm))
      : 1;
  }

  post(type, extra, transfer) {
    this.port.postMessage(Object.assign({ type }, extra), transfer || []);
  }

  notifyState() {
    this.post('state', {
      state: this.state,
      layerCount: this.layers.length,
      loopLength: this.loopLength,
      sourceLength: this.sourceLength,
      durationSec: this.loopLength / (this.sr * this.playbackRate),
      sourceDurationSec: this.sourceLength / this.sr,
      originalBpm: this.originalBpm,
      currentBpm: this.currentBpm,
      playbackRate: this.playbackRate,
      trimStart: this.sourceLength ? this.loopStart / this.sourceLength : 0,
      trimEnd: this.sourceLength ? this.loopEnd / this.sourceLength : 1,
      canUndo: this.layers.length > 1 && this.state !== 'RECORDING' && this.state !== 'OVERDUBBING',
      canRedo: this.redoLayers.length > 0 && this.state !== 'RECORDING' && this.state !== 'OVERDUBBING',
    });
  }

  handleMessage(msg) {
    switch (msg.type) {
      case 'setState': this.requestState(msg.state, msg.targetFrame); break;
      case 'setQuantize':
        this.quantizeSamples = Math.max(0, msg.samples || 0);
        this.quantizeOriginFrame = Math.round(Number(msg.originFrame) || 0);
        this.quantizeGraceSamples = Math.max(0, Math.round(msg.graceSamples || 0));
        break;
      case 'setRecordLatency':
        this.recordLatencySamples = Math.max(0, Math.min(Math.round(this.sr * 0.25), Math.round(msg.samples || 0)));
        break;
      case 'setFixedLength': this.fixedLengthSamples = Math.max(0, msg.samples || 0); break;
      case 'setRecMode': this.recMode = msg.mode || 'REC_PLAY_OVER'; break;
      case 'setReverse': this.reverse = !!msg.value; break;
      case 'setPlaybackLevel': this.playbackLevel = Math.max(0, msg.value || 0); break;
      case 'setPlaybackCompensation': this.playbackCompensationTarget = Math.max(0, Math.min(this.sr, Number(msg.samples) || 0)); break;
      case 'setTempo':
        this.currentBpm = Math.max(20, Math.min(400, Number(msg.bpm) || 120));
        if (Number(msg.originalBpm) > 0) this.originalBpm = Number(msg.originalBpm);
        this.updatePlaybackRate();
        this.notifyState();
        break;
      case 'setTrim': this.setTrim(msg.startRatio, msg.endRatio); break;
      case 'resetTrim': this.setTrim(0, 1); break;
      case 'clear': this.doClear(); break;
      case 'undo': this.doUndo(); break;
      case 'redo': this.doRedo(); break;
      case 'requestWaveform': this.sendFullWaveform(); break;
      case 'requestExport': this.sendExport(msg.requestId); break;
      case 'loadPCM': this.loadPCM(msg.left, msg.right, msg.originalBpm); break;
      default: break;
    }
  }

  loadPCM(left, right, originalBpm) {
    if (!left || !left.length || this.state === 'RECORDING' || this.state === 'OVERDUBBING') return;
    // Reseta qualquer fade de STOP pendente: sem isso, um loadPCM que chega durante
    // o fade (stopFadeRemaining > 0) deixava esse valor residual, e a PRÓXIMA
    // reprodução (do sample recém-importado) nascia com o fade antigo em andamento
    // e se autointerrompia poucos ms depois de apertar PLAY.
    this.stopFadeRemaining = 0;
    const length = Math.min(this.maxSamples, left.length, right && right.length ? right.length : left.length);
    const layer = this.makeLayer();
    layer.written = length;
    for (let offset = 0; offset < length; offset += NS_CHUNK_SIZE) {
      const end = Math.min(length, offset + NS_CHUNK_SIZE);
      const leftChunk = new Int16Array(NS_CHUNK_SIZE);
      const rightChunk = new Int16Array(NS_CHUNK_SIZE);
      leftChunk.set(left.subarray(offset, end));
      rightChunk.set((right && right.length ? right : left).subarray(offset, end));
      layer.left.push(leftChunk);
      layer.right.push(rightChunk);
    }
    this.layers = [layer];
    this.redoLayers = [];
    this.activeLayer = -1;
    this.sourceLength = length;
    this.loopStart = 0;
    this.loopEnd = length;
    this.loopLength = length;
    this.writeHead = length;
    this.playHead = 0;
    this.originalBpm = Math.max(20, Math.min(400, Number(originalBpm) || this.currentBpm));
    this.updatePlaybackRate();
    this.pendingAction = null;
    this.pendingPlayHead = null;
    this.state = 'STOPPED';
    this.sendFullWaveform();
    this.notifyState();
  }

  shouldQuantize(next) {
    if (this.quantizeSamples <= 0) return false;
    if (next === 'RECORDING' && (this.state === 'EMPTY' || this.loopLength === 0)) return true;
    if (this.state === 'RECORDING' && (next === 'PLAYING' || next === 'OVERDUBBING')) return true;
    if (this.state === 'STOPPED' && next === 'PLAYING' && this.loopLength > 0) return true;
    return false;
  }

  beginStop() {
    if ((this.state === 'PLAYING' || this.state === 'OVERDUBBING') && this.loopLength > 0) {
      this.stopFadeRemaining = this.stopFadeTotal;
      this.post('pending', { pending: 'STOPPED' });
      return;
    }
    this.applyState('STOPPED');
  }

  requestState(next, targetFrame = 0) {
    if (next === 'STOPPED') {
      this.pendingAction = null;
      this.pendingPlayHead = null;
      const scheduledFrame = Math.max(0, Math.round(Number(targetFrame) || 0));
      if (scheduledFrame > currentFrame) {
        this.pendingAction = 'BEGIN_STOP';
        this.pendingFrame = scheduledFrame;
        this.post('pending', { pending: 'STOPPED' });
        return;
      }
      this.beginStop();
      return;
    }
    const masterFrame = Math.max(0, Math.round(Number(targetFrame) || 0));
    if (masterFrame > 0) {
      let launchFrame = masterFrame;
      // Se a mensagem atrasar além da fronteira, nunca entra fora da grade:
      // avança para a próxima linha da mesma master timeline.
      if (launchFrame <= currentFrame && this.quantizeSamples > 0) {
        const relative = currentFrame - this.quantizeOriginFrame;
        launchFrame = relative < 0
          ? this.quantizeOriginFrame
          : this.quantizeOriginFrame + Math.ceil((relative + 1) / this.quantizeSamples) * this.quantizeSamples;
      }
      if (launchFrame > currentFrame) {
        this.pendingAction = next;
        this.pendingFrame = launchFrame;
        if (this.state === 'STOPPED' && next === 'PLAYING' && this.loopLength > 0) this.pendingPlayHead = 0;
        this.post('pending', { pending: next, targetFrame: launchFrame });
        return;
      }
    }
    if (this.shouldQuantize(next)) {
      const grid = this.quantizeSamples;
      const origin = this.quantizeOriginFrame;
      const relative = currentFrame - origin;
      this.recordingEndTrimSamples = 0;
      this.playbackCatchupSamples = 0;
      this.pendingAction = next;
      this.pendingFrame = relative < 0
        ? origin
        : origin + Math.ceil((relative + 1) / grid) * grid;
      if (this.state === 'STOPPED' && next === 'PLAYING' && this.loopLength > 0) {
        this.pendingPlayHead = 0;
      }
      this.post('pending', { pending: next });
      return;
    }
    this.applyState(next);
  }

  startFirstRecording() {
    // A primeira camada define o sample zero do próprio loop. Aplicar aqui a
    // compensação de round trip fazia PLAY e waveform começarem alguns ms à
    // frente, cortando o ataque inicial. O offset de captura pertence somente
    // às overdubs, que precisam se alinhar contra uma camada já tocando.
    const layer = this.makeLayer(false);
    this.layers = [layer];
    this.redoLayers = [];
    this.activeLayer = 0;
    this.sourceLength = 0;
    this.loopStart = 0;
    this.loopEnd = 0;
    this.loopLength = 0;
    this.writeHead = 0;
    this.recordingEndTrimSamples = 0;
    this.playbackCatchupSamples = 0;
    this.playHead = 0;
    this.originalBpm = this.currentBpm;
    this.updatePlaybackRate();
    this.peakMax = 0;
    this.peakWindow = 0;
    this.state = 'RECORDING';
    this.post('recTarget', {
      targetSamples: this.fixedLengthSamples,
      targetSec: this.fixedLengthSamples / this.sr,
    });
  }

  finalizeFirstRecording() {
    const trim = Math.min(
      Math.max(0, this.recordingEndTrimSamples || 0),
      Math.max(0, this.writeHead - NS_MIN_LOOP_SAMPLES),
    );
    if (trim > 0) {
      this.writeHead -= trim;
      const firstLayer = this.layers[0];
      if (firstLayer) firstLayer.written = Math.min(firstLayer.written, this.writeHead);
    }
    this.recordingEndTrimSamples = 0;
    if (this.writeHead < NS_MIN_LOOP_SAMPLES) {
      this.doClear(false);
      return false;
    }
    // Se o músico armou REC na pequena janela pós-click, recompomos os samples
    // anteriores à captura como tempo de grade, sem copiar nem deslocar o PCM.
    this.sourceLength = Math.min(this.maxSamples, this.writeHead + this.recordingStartGridOffset);
    this.loopStart = 0;
    this.loopEnd = this.sourceLength;
    this.loopLength = this.sourceLength;
    this.activeLayer = -1;
    this.playHead = this.playbackCatchupSamples > 0
      ? this.playbackCatchupSamples % this.loopLength
      : 0;
    this.playbackCatchupSamples = 0;
    this.recordingStartGridOffset = 0;
    this.sendFullWaveform();
    return true;
  }

  beginOverdub() {
    if (this.loopLength <= 0) return;
    if (this.layers.length >= this.maxLayers) {
      this.state = 'PLAYING';
      this.activeLayer = -1;
      this.post('info', { code: 'MAX_LAYERS' });
      return;
    }
    this.redoLayers = [];
    this.layers.push(this.makeLayer(true));
    this.activeLayer = this.layers.length - 1;
    this.state = 'OVERDUBBING';
  }

  finishOverdub() {
    this.activeLayer = -1;
    this.sendFullWaveform();
  }

  applyState(next) {
    const was = this.state;
    if (next === 'RECORDING') {
      if (this.loopLength <= 0) this.startFirstRecording();
      else this.beginOverdub();
    } else if (next === 'OVERDUBBING') {
      if (was === 'RECORDING') {
        if (this.finalizeFirstRecording()) this.beginOverdub();
      } else if (this.loopLength > 0 && was !== 'OVERDUBBING') {
        this.beginOverdub();
      }
    } else if (next === 'PLAYING') {
      if (was === 'RECORDING' && !this.finalizeFirstRecording()) {
        this.pendingAction = null;
        this.notifyState();
        return;
      }
      if (was === 'OVERDUBBING') this.finishOverdub();
      if (this.loopLength > 0) {
        // PLAY depois de STOP tem semântica de retrigger, como num looper de mesa:
        // a grade decide QUANDO entra, mas nunca de qual ponto do loop ele parte.
        if (was === 'STOPPED') this.playHead = 0;
        else if (this.pendingPlayHead !== null) this.playHead = this.pendingPlayHead;
        this.state = 'PLAYING';
      }
    } else if (next === 'STOPPED') {
      if (was === 'RECORDING') this.finalizeFirstRecording();
      if (was === 'OVERDUBBING') this.finishOverdub();
      this.state = this.loopLength > 0 ? 'STOPPED' : 'EMPTY';
      this.playHead = 0;
      this.activeLayer = -1;
      this.sendFullWaveform();
    }
    this.pendingAction = null;
    this.pendingPlayHead = null;
    this.recordingEndTrimSamples = 0;
    this.playbackCatchupSamples = 0;
    if (this.state !== 'RECORDING') this.recordingStartGridOffset = 0;
    this.notifyState();
  }

  doUndo() {
    if (this.layers.length <= 1 || this.state === 'RECORDING' || this.state === 'OVERDUBBING') return;
    this.redoLayers.push(this.layers.pop());
    this.activeLayer = -1;
    this.sendFullWaveform();
    this.notifyState();
  }

  doRedo() {
    if (!this.redoLayers.length || this.layers.length >= this.maxLayers) return;
    this.layers.push(this.redoLayers.pop());
    this.sendFullWaveform();
    this.notifyState();
  }

  doClear(notify = true) {
    this.stopFadeRemaining = 0;
    this.layers = [];
    this.redoLayers = [];
    this.activeLayer = -1;
    this.sourceLength = 0;
    this.loopStart = 0;
    this.loopEnd = 0;
    this.loopLength = 0;
    this.writeHead = 0;
    this.playHead = 0;
    this.originalBpm = 0;
    this.updatePlaybackRate();
    this.pendingAction = null;
    this.pendingPlayHead = null;
    this.state = 'EMPTY';
    this.recordingStartGridOffset = 0;
    this.post('waveform', { peaks: new Float32Array(0), durationSec: 0 });
    if (notify) this.notifyState();
  }

  setTrim(startRatio, endRatio) {
    if (!this.sourceLength || this.state === 'RECORDING' || this.state === 'OVERDUBBING') return;
    let start = Math.max(0, Math.min(0.995, Number(startRatio) || 0));
    let end = Math.max(0.005, Math.min(1, Number(endRatio) || 1));
    const minGap = Math.min(1, Math.max(0.002, NS_MIN_LOOP_SAMPLES / this.sourceLength));
    if (end - start < minGap) end = Math.min(1, start + minGap);
    if (end - start < minGap) start = Math.max(0, end - minGap);
    this.loopStart = Math.floor(start * this.sourceLength);
    this.loopEnd = Math.max(this.loopStart + NS_MIN_LOOP_SAMPLES, Math.floor(end * this.sourceLength));
    this.loopEnd = Math.min(this.sourceLength, this.loopEnd);
    this.loopLength = Math.max(0, this.loopEnd - this.loopStart);
    this.playHead = 0;
    this.sendFullWaveform();
    this.notifyState();
  }

  sendFullWaveform() {
    if (this.loopLength <= 0) {
      this.post('waveform', { peaks: new Float32Array(0), sourcePeaks: new Float32Array(0), durationSec: 0 });
      return;
    }
    const makePeaks = (rangeStart, rangeEnd) => {
      const rangeLength = Math.max(0, rangeEnd - rangeStart);
      const target = 640;
      const step = Math.max(1, Math.floor(rangeLength / target));
      const count = Math.ceil(rangeLength / step);
      const result = new Float32Array(count);
      for (let p = 0; p < count; p++) {
        const from = rangeStart + p * step;
        const to = Math.min(rangeEnd, from + step);
        let peak = 0;
        for (let i = from; i < to; i++) {
          this.mixAt(i, false);
          const value = Math.max(Math.abs(this.mixLeftValue), Math.abs(this.mixRightValue));
          if (value > peak) peak = value;
        }
        result[p] = Math.min(1, peak);
      }
      return result;
    };
    const peaks = makePeaks(this.loopStart, this.loopEnd);
    const sourcePeaks = makePeaks(0, this.sourceLength);
    this.post('waveform', { peaks, sourcePeaks, durationSec: this.loopLength / this.sr }, [peaks.buffer, sourcePeaks.buffer]);
  }

  sendExport(requestId) {
    if (this.loopLength <= 0) {
      this.post('export', { requestId, left: new Float32Array(0), right: new Float32Array(0), sampleRate: this.sr });
      return;
    }
    const left = new Float32Array(this.loopLength);
    const right = new Float32Array(this.loopLength);
    for (let i = 0; i < this.loopLength; i++) {
      this.mixAt(this.loopStart + i, false);
      left[i] = Math.max(-1, Math.min(1, this.mixLeftValue));
      right[i] = Math.max(-1, Math.min(1, this.mixRightValue));
    }
    this.post('export', { requestId, left, right, sampleRate: this.sr }, [left.buffer, right.buffer]);
  }

  accumulatePeak(value) {
    if (value > this.peakMax) this.peakMax = value;
    this.peakWindow++;
    if (this.peakWindow >= this.peakSamples) {
      this.post('livePeak', { value: this.peakMax });
      this.peakMax = 0;
      this.peakWindow = 0;
    }
  }

  process(inputs, outputs) {
    const input = inputs[0] || [];
    const output = outputs[0];
    const outL = output[0];
    const outR = output[1] || output[0];
    const inL = input[0] || null;
    const inR = input[1] || input[0] || null;

    for (let i = 0; i < outL.length; i++) {
      let finishStopAfterSample = false;
      if (this.pendingAction && currentFrame + i >= this.pendingFrame) {
        const action = this.pendingAction;
        this.pendingAction = null;
        if (action === 'BEGIN_STOP') this.beginStop();
        else this.applyState(action);
      }

      const dryL = inL ? inL[i] : 0;
      const dryR = inR ? inR[i] : dryL;
      let outputLeft = 0;
      let outputRight = 0;

      if (this.state === 'RECORDING') {
        const limit = this.fixedLengthSamples > 0
          ? Math.min(Math.max(NS_MIN_LOOP_SAMPLES, this.fixedLengthSamples - this.recordingStartGridOffset), this.maxSamples)
          : this.maxSamples;
        if (this.writeHead < limit) {
          this.writeSample(this.layers[0], this.writeHead, dryL, dryR);
          this.writeHead++;
          this.accumulatePeak(Math.max(Math.abs(dryL), Math.abs(dryR)));
        }
        if (this.writeHead >= limit) {
          const ok = this.finalizeFirstRecording();
          if (ok && this.recMode === 'REC_OVER_PLAY') this.beginOverdub();
          else if (ok) this.state = 'PLAYING';
          this.notifyState();
        }
      } else if ((this.state === 'PLAYING' || this.state === 'OVERDUBBING') && this.loopLength > 0) {
        const compensationDelta = this.playbackCompensationTarget - this.playbackCompensation;
        this.playbackCompensation += Math.max(-0.5, Math.min(0.5, compensationDelta));
        const compensatedHead = this.playHead + this.playbackCompensation;
        const relative = this.reverse ? this.loopLength - 1 - compensatedHead : compensatedHead;
        const position = this.loopStart + Math.round(this.reverse ? this.loopLength - 1 - this.playHead : this.playHead);
        this.mixAtFractional(relative, this.state === 'OVERDUBBING');
        outputLeft = this.mixLeftValue * this.playbackLevel;
        outputRight = this.mixRightValue * this.playbackLevel;

        if (this.stopFadeRemaining > 0) {
          const ratio = this.stopFadeRemaining / this.stopFadeTotal;
          const fade = Math.sin(ratio * Math.PI * 0.5);
          outputLeft *= fade;
          outputRight *= fade;
          this.stopFadeRemaining--;
          finishStopAfterSample = this.stopFadeRemaining === 0;
        }

        if (this.state === 'OVERDUBBING' && this.activeLayer >= 0) {
          this.writeSample(this.layers[this.activeLayer], position, dryL, dryR);
        }

        this.playHead += this.playbackRate;
        while (this.playHead >= this.loopLength) this.playHead -= this.loopLength;
      }

      outL[i] = outputLeft;
      if (outR !== outL) outR[i] = outputRight;
      if (finishStopAfterSample) this.applyState('STOPPED');
    }

    this.posCounter += outL.length;
    if (this.posCounter >= this.sr / 30) {
      this.posCounter = 0;
      if (this.loopLength > 0 && (this.state === 'PLAYING' || this.state === 'OVERDUBBING')) {
        this.post('position', { ratio: this.playHead / this.loopLength });
      } else if (this.state === 'RECORDING') {
        const target = this.fixedLengthSamples > 0 ? this.fixedLengthSamples : this.maxSamples;
        this.post('recProgress', { ratio: Math.min(1, this.writeHead / target) });
      }
    }

    return true;
  }
}

registerProcessor('looper-processor', LooperProcessor);

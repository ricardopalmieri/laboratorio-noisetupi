// ui.js

const NS_UI = {
  engine: null,
  midi: null,
  keyboard: null,
  waveforms: [],
  radialWaveforms: [],
  sourceWaveforms: [],
  activeTrack: 0,
  activeRack: null,
  activeFx: null,
  trimWave: null,
  samplerWave: null,
  samplerSettings: false,
  activeSamplerPad: 0,
  tapTimes: [],
  allOutputFxEnabled: true,
  _saveTimer: 0,
  _clearArmed: new Map(),
  _lastUiFrame: 0,
  _lastWaveFrame: 0,
  _lastDiagnostic: 0,
  _trackTrimDragging: null,
  _samplerTrimDragging: null,
  learnMode: null,
  learnRemoveMode: false,
  learnArmedElement: null,
  learnTargets: new Map(),
  _learnPointerElement: null,
  _learnPointerTime: 0,
  isIPad: false,

  init(engine, midi, keyboard) {
    this.engine = engine;
    this.midi = midi;
    this.keyboard = keyboard;
    this.isIPad = /iPad|iPhone|iPod/.test(navigator.userAgent)
      || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    document.documentElement.classList.toggle('ipad-compat', this.isIPad);
    this.buildChannels();
    this.bindFullscreen();
    this.bindTransport();
    this.bindSampler();
    this.bindSettings();
    this.bindTrackModal();
    this.bindRackModal();
    this.bindFxModal();
    this.bindMidi();
    this.populateTemplates();
    this.trimWave = new NSWaveformView(this.el('trim-wave-canvas'), { showTrim: true });
    this.samplerWave = new NSWaveformView(this.el('sampler-wave-canvas'), { showTrim: true });
    this.syncAllControls();
    this.loop();
  },

  el(id) { return document.getElementById(id); },
  open(id) { this.el(id).hidden = false; },
  close(id) { this.el(id).hidden = true; },

  bindFullscreen() {
    const button = this.el('btn-fullscreen');
    if (!button) return;
    const target = document.documentElement;
    const fsElement = () => document.fullscreenElement || document.webkitFullscreenElement || null;
    const canFullscreen = !!(target.requestFullscreen || target.webkitRequestFullscreen);
    if (!canFullscreen) {
      button.addEventListener('click', () => this.flash('USE ADD TO HOME SCREEN'));
      return;
    }
    const sync = () => button.classList.toggle('active', !!fsElement());
    button.addEventListener('click', async () => {
      try {
        if (fsElement()) {
          if (document.exitFullscreen) await document.exitFullscreen();
          else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
        } else if (target.requestFullscreen) {
          await target.requestFullscreen();
        } else if (target.webkitRequestFullscreen) {
          target.webkitRequestFullscreen();
        }
      } catch (error) {
        this.flash('FULLSCREEN ERROR');
      }
    });
    document.addEventListener('fullscreenchange', sync);
    document.addEventListener('webkitfullscreenchange', sync);
  },

  buildChannels() {
    const container = this.el('channels-container');
    container.innerHTML = '';
    this.engine.tracks.forEach((track, index) => {
      const channel = document.createElement('section');
      channel.className = 'channel';
      channel.id = `channel-${index}`;
      channel.innerHTML = `
        <header class="channel-head">
          <span class="channel-name">TRACK ${index + 1}</span>
          <div class="layer-status"><span>LAYERS</span><div class="layer-dots" aria-label="Camadas"><i class="layer-dot" id="layer-${index}-0"></i><i class="layer-dot" id="layer-${index}-1"></i><i class="layer-dot" id="layer-${index}-2"></i></div></div>
          <span class="channel-time" id="ch-time-${index}">0:00.000</span>
          <button class="track-edit" id="edit-${index}">TRACK</button>
        </header>
        <div class="quick-fx-surface">
          <div class="quick-fx-row"><button class="fx-bank-key" id="infx-${index}">IN</button><div class="fx-slot-group" id="quick-in-${index}"></div></div>
          <div class="quick-fx-row"><button class="fx-bank-key" id="outfx-${index}">OUT</button><div class="fx-slot-group" id="quick-out-${index}"></div></div>
        </div>
        <div class="main-input-meter"><span>IN</span><div class="meter horizontal"><div class="meter-fill" id="input-meter-${index}"></div></div></div>
        <div class="channel-wave"><canvas id="wave-${index}"></canvas></div>
        <div class="transport-zone">
          <div class="rec-ring">
            <canvas class="radial-wave" id="radial-${index}"></canvas>
            <svg class="progress-ring" viewBox="0 0 108 108" aria-hidden="true">
              <circle class="ring-bg" cx="54" cy="54" r="50"></circle>
              <circle class="ring-fg" id="ring-${index}" cx="54" cy="54" r="50"></circle>
            </svg>
            <button class="rec-btn state-empty" id="rec-${index}">REC</button>
          </div>
          <button class="stop-btn" id="stop-${index}" aria-label="Stop track ${index + 1}">■ STOP</button>
        </div>
        <div class="mixer-zone">
          <div class="fader-module">
            <div class="fader-scale" aria-hidden="true"><span>+6</span><span>0</span><span>-6</span><span>-12</span><span>-24</span><span>∞</span></div>
            <div class="track-fader-shell" id="fader-shell-${index}">
              <div class="fader-rail" aria-hidden="true"></div>
              <span class="fader-thumb" id="fader-thumb-${index}" aria-hidden="true"></span>
              <input class="track-fader" id="fader-${index}" type="range" min="0" max="1000" step="1" value="760" aria-label="Volume track ${index + 1}">
            </div>
            <div class="meter track-meter"><div class="meter-fill" id="meter-fill-${index}"></div></div>
            <output class="fader-db" id="fader-db-${index}">-2.0 dB</output>
          </div>
          <div class="track-actions">
            <button id="mute-${index}">MUTE</button>
            <button id="solo-${index}">SOLO</button>
            <button id="monitor-${index}">MON</button>
            <button id="sample-${index}">SAMPLE</button>
            <button id="undo-${index}">UNDO</button>
            <button id="redo-${index}">REDO</button>
            <button class="clear-btn" id="clear-${index}">CLEAR</button>
          </div>
        </div>`;
      container.appendChild(channel);

      const waveform = new NSWaveformView(this.el(`wave-${index}`));
      waveform.deferLiveRender = this.isIPad;
      const radial = new NSRadialWaveformView(this.el(`radial-${index}`));
      this.waveforms[index] = waveform;
      this.radialWaveforms[index] = radial;

      track.onStateChange = () => this.renderTrackState(index);
      track.onLivePeak = (value) => waveform.pushLivePeak(value);
      track.onWaveform = (peaks, duration, sourcePeaks) => {
        waveform.setFull(peaks);
        radial.setPeaks(peaks);
        this.sourceWaveforms[index] = sourcePeaks;
        if (this.activeTrack === index && !this.el('modal-track').hidden && !this._trackTrimDragging) this.syncTrimEditor();
      };
      track.onPosition = (ratio) => waveform.setPlayhead(ratio);
      track.onRecTarget = (targetSec) => {
        if (targetSec > 0) waveform.setLiveFixed(targetSec);
        else waveform.setLive();
      };
      track.onRecProgress = (ratio) => waveform.setRecProgress(ratio);
      track.onInfo = (code) => {
        if (code === 'MAX_LAYERS') this.flash(`TRACK ${index + 1} · MAX 3 LAYERS`);
      };

      this.el(`rec-${index}`).addEventListener('click', () => {
        if (track.state === 'EMPTY' || track.loopLength === 0) waveform.setLive();
        track.press();
      });
      this.el(`stop-${index}`).addEventListener('click', () => track.stop());
      this.bindTrackFader(index, track, this.el(`fader-${index}`));
      this.el(`mute-${index}`).addEventListener('click', () => {
        track.setMute(!track.muted);
        this.renderTrackState(index);
      });
      this.el(`solo-${index}`).addEventListener('click', () => {
        track.setSolo(!track.soloed);
        this.renderTrackState(index);
      });
      this.el(`monitor-${index}`).addEventListener('click', () => {
        track.setMonitor(!track.monitorEnabled);
        this.renderTrackState(index);
      });
      this.el(`undo-${index}`).addEventListener('click', () => { if (track.canUndo) track.undo(); });
      this.el(`redo-${index}`).addEventListener('click', () => { if (track.canRedo) track.redo(); });
      this.el(`sample-${index}`).addEventListener('click', () => this.openTrack(index, 'sample'));
      this.el(`clear-${index}`).addEventListener('click', () => this.armClear(index));
      this.el(`edit-${index}`).addEventListener('click', () => this.openTrack(index, 'config'));
      this.el(`infx-${index}`).addEventListener('click', () => {
        track.setInputFxEnabled(!track.inputFxRack.enabled);
        this.renderTrackState(index); this.saveSoon();
      });
      this.el(`outfx-${index}`).addEventListener('click', () => {
        track.setOutputFxEnabled(!track.outputFxRack.enabled);
        this.renderTrackState(index); this.saveSoon();
      });
      this.bindQuickFx(index, 'input', track.inputFxRack);
      this.bindQuickFx(index, 'output', track.outputFxRack);
      this.renderTrackState(index);
    });
  },

  bindTrackFader(index, track, input) {
    const shell = this.el(`fader-shell-${index}`);
    const apply = (rawValue) => {
      const value = Math.max(0, Math.min(1000, Number(rawValue)));
      input.value = value;
      this.renderFaderPosition(index, value);
      const gain = this.faderToGain(value);
      track.setGain(gain);
      this.el(`fader-db-${index}`).textContent = this.linearToDb(gain);
      this.saveSoon();
    };
    this.renderFaderPosition(index, input.value);

    // Toda interação de ponteiro usa o mesmo curso virtual. O range transparente
    // conserva teclado e acessibilidade, mas Safari e Chromium não desenham nem
    // posicionam o cap: a geometria visível é nossa e permanece idêntica.
    input.tabIndex = -1;
    input.setAttribute('aria-hidden', 'true');
    shell.tabIndex = 0;
    shell.setAttribute('role', 'slider');
    shell.setAttribute('aria-label', `Volume track ${index + 1}`);
    shell.setAttribute('aria-valuemin', '0');
    shell.setAttribute('aria-valuemax', '1000');
    let drag = null;
    shell.addEventListener('pointerdown', (event) => {
      drag = { id: event.pointerId, y: event.clientY, value: Number(input.value) };
      try { shell.focus({ preventScroll: true }); } catch (error) { shell.focus(); }
      try { shell.setPointerCapture(event.pointerId); } catch (error) {}
      event.preventDefault();
    });
    shell.addEventListener('pointermove', (event) => {
      if (!drag || drag.id !== event.pointerId) return;
      const virtualTravel = this.isIPad ? 420 : 320;
      apply(drag.value - (event.clientY - drag.y) / virtualTravel * 1000);
      event.preventDefault();
    });
    const finish = (event) => {
      if (!drag || drag.id !== event.pointerId) return;
      try { shell.releasePointerCapture(event.pointerId); } catch (error) {}
      drag = null;
    };
    shell.addEventListener('pointerup', finish);
    shell.addEventListener('pointercancel', finish);
    shell.addEventListener('keydown', (event) => {
      const increments = { ArrowUp: 10, ArrowRight: 10, ArrowDown: -10, ArrowLeft: -10, PageUp: 50, PageDown: -50 };
      if (event.key === 'Home') apply(0);
      else if (event.key === 'End') apply(1000);
      else if (increments[event.key]) apply(Number(input.value) + increments[event.key]);
      else return;
      event.preventDefault();
    });
  },

  renderFaderPosition(index, rawValue) {
    const thumb = this.el(`fader-thumb-${index}`);
    if (!thumb) return;
    const normalized = Math.max(0, Math.min(1, Number(rawValue) / 1000));
    // Reserva 8% nas extremidades para o cap nunca sair da moldura.
    thumb.style.bottom = `${8 + normalized * 84}%`;
    const shell = this.el(`fader-shell-${index}`);
    if (shell) shell.setAttribute('aria-valuenow', String(Math.round(Number(rawValue))));
  },

  bindQuickFx(index, kind, rack) {
    const container = this.el(`quick-${kind === 'input' ? 'in' : 'out'}-${index}`);
    container.innerHTML = '';
    ['A', 'B', 'C', 'D'].forEach((letter, slot) => {
      const button = document.createElement('button');
      button.className = 'quick-fx-btn';
      button.dataset.letter = letter;
      button.innerHTML = `<b>${letter}</b><small>EMPTY</small>`;
      let timer = 0;
      let held = false;
      let armed = false;
      let moved = false;
      let originX = 0;
      let originY = 0;
      let suppressClickUntil = 0;
      // Alternar o bypass acontece direto no pointerup (não esperando o 'click'
      // sintético). Em iOS/Safari um toque que o sistema interpreta como possível
      // gesto de scroll/carrossel pode virar 'pointercancel' em vez de gerar 'click' —
      // nesse caso o botão nunca reagia e o efeito parecia simplesmente "não ligar".
      // O listener de 'click' continua existindo só como caminho de acessibilidade
      // (teclado/leitor de tela), guardado por _fxTapHandledAt para não duplicar.
      let _fxTapHandledAt = 0;
      button.addEventListener('pointerdown', (event) => {
        held = false;
        armed = true;
        moved = false;
        originX = event.clientX;
        originY = event.clientY;
        try { button.setPointerCapture(event.pointerId); } catch (error) {}
        if (this.midi.learnMode || this.keyboard.learnMode) {
          held = true;
          armed = false;
          const actionId = `fx_${index}_${kind}_${slot}`;
          const label = `T${index + 1} ${kind === 'input' ? 'IN' : 'OUT'} FX ${letter}`;
          if (this.midi.learnMode) { this.midi.armLearn(actionId, label); this.el('midi-learn-status').textContent = `LEARN · ${label}`; }
          if (this.keyboard.learnMode) { this.keyboard.armLearn(actionId, label); this.el('keyboard-learn-status').textContent = `LEARN · ${label}`; }
          return;
        }
        timer = setTimeout(() => {
          held = true;
          armed = false;
          const fx = rack.chain[slot];
          if (fx) { this.activeRack = rack; this.openFxParams(fx); }
          else this.openRack(`TRACK ${index + 1} · ${kind === 'input' ? 'INPUT' : 'TRACK'} FX`, rack);
        }, 650);
        if (event.pointerType !== 'mouse') { try { event.preventDefault(); } catch (error) {} }
      });
      button.addEventListener('pointermove', (event) => {
        if (!armed || event.pointerId == null) return;
        if (Math.hypot(event.clientX - originX, event.clientY - originY) > 10) {
          moved = true;
          armed = false;
          suppressClickUntil = performance.now() + 600;
          clearTimeout(timer);
        }
      });
      const tap = () => {
        const fx = rack.chain[slot];
        if (!fx) {
          this.openRack(`TRACK ${index + 1} · ${kind === 'input' ? 'INPUT' : 'TRACK'} FX`, rack);
          return;
        }
        // Na superfície principal todo toque é latch ON/OFF. MOMENTARY permanece
        // disponível para MIDI/keyboard learn, onde existem eventos press/release.
        fx.setBypass(!fx.bypassed);
        this.renderQuickFx(index);
        this.saveSoon();
      };
      button.addEventListener('pointerup', (event) => {
        clearTimeout(timer);
        if (armed && !held && !moved) { _fxTapHandledAt = performance.now(); tap(); }
        armed = false;
        try { button.releasePointerCapture(event.pointerId); } catch (error) {}
      });
      button.addEventListener('pointercancel', () => {
        clearTimeout(timer);
        armed = false;
        moved = false;
        suppressClickUntil = performance.now() + 600;
      });
      button.addEventListener('click', () => {
        if (held) { held = false; return; }
        if (performance.now() < suppressClickUntil) return;
        if (performance.now() - _fxTapHandledAt < 400) return;
        tap();
      });
      this.registerLearnTarget(button, `fx_${index}_${kind}_${slot}`, `T${index + 1} ${kind === 'input' ? 'IN' : 'OUT'} FX ${letter}`);
      container.appendChild(button);
    });
    this.renderQuickFx(index);
  },

  renderQuickFx(index) {
    const track = this.engine.tracks[index];
    [['in', track.inputFxRack], ['out', track.outputFxRack]].forEach(([kind, rack]) => {
      const buttons = this.el(`quick-${kind}-${index}`)?.querySelectorAll('.quick-fx-btn') || [];
      buttons.forEach((button, slot) => {
        const fx = rack.chain[slot];
        const catalog = fx && NS_FX_CATALOG.find((item) => item.id === fx.id);
        button.classList.toggle('loaded', !!fx);
        button.classList.toggle('active', !!fx && rack.enabled && !fx.bypassed);
        button.classList.remove('status-stable', 'status-beta', 'status-broken');
        if (catalog) button.classList.add(`status-${catalog.status}`);
        button.innerHTML = `<b>${button.dataset.letter}</b><small>${catalog ? catalog.name : 'EMPTY'}</small>`;
        button.title = catalog ? catalog.name : 'EMPTY';
        button.setAttribute('aria-label', catalog ? `${button.dataset.letter} ${catalog.name}` : `${button.dataset.letter} EMPTY`);
      });
    });
  },

  armClear(index) {
    const button = this.el(`clear-${index}`);
    const armed = this._clearArmed.get(index);
    if (armed && performance.now() - armed < 1600) {
      this.engine.tracks[index].clear();
      this.waveforms[index].clear();
      this.radialWaveforms[index].clear();
      this._clearArmed.delete(index);
      button.textContent = 'CLEAR';
      return;
    }
    this._clearArmed.set(index, performance.now());
    button.textContent = 'AGAIN';
    setTimeout(() => {
      if (this._clearArmed.has(index)) {
        this._clearArmed.delete(index);
        button.textContent = 'CLEAR';
      }
    }, 1650);
  },

  renderTrackState(index) {
    const track = this.engine.tracks[index];
    const channel = this.el(`channel-${index}`);
    const rec = this.el(`rec-${index}`);
    const labels = { EMPTY: 'REC', RECORDING: 'REC', PLAYING: 'PLAY', OVERDUBBING: 'DUB', STOPPED: 'PLAY' };
    const classes = { EMPTY: 'state-empty', RECORDING: 'state-rec', PLAYING: 'state-play', OVERDUBBING: 'state-overdub', STOPPED: 'state-stopped' };
    rec.className = `rec-btn ${classes[track.state] || 'state-empty'}`;
    rec.textContent = labels[track.state] || 'REC';
    if (track.pending) rec.classList.add('pending');
    channel.classList.toggle('is-rec', track.state === 'RECORDING');
    channel.classList.toggle('is-play', track.state === 'PLAYING');
    channel.classList.toggle('is-overdub', track.state === 'OVERDUBBING');
    this.el(`mute-${index}`).classList.toggle('muted', track.muted);
    this.el(`solo-${index}`).classList.toggle('soloed', track.soloed);
    this.el(`monitor-${index}`).classList.toggle('active', track.monitorEnabled);
    this.el(`undo-${index}`).classList.toggle('undo-ready', track.canUndo);
    this.el(`redo-${index}`).classList.toggle('undo-ready', track.canRedo);
    this.el(`infx-${index}`).classList.toggle('active', track.inputFxRack.enabled);
    this.el(`outfx-${index}`).classList.toggle('active', track.outputFxRack.enabled);
    this.renderQuickFx(index);
    for (let layer = 0; layer < 3; layer++) this.el(`layer-${index}-${layer}`).classList.toggle('on', layer < track.layerCount);
    this.radialWaveforms[index].setState(track.state);
    const colors = { RECORDING: 'var(--red-soft)', PLAYING: 'var(--green)', OVERDUBBING: 'var(--amber)', STOPPED: 'var(--quiet)', EMPTY: 'var(--line)' };
    this.el(`ring-${index}`).style.stroke = colors[track.state] || 'var(--line)';
  },

  bindTransport() {
    const bpm = this.el('bpm-input');
    const applyBpm = (value) => {
      const next = Math.max(40, Math.min(240, Math.round(Number(value) || 120)));
      bpm.value = next;
      this.engine.setBpm(next);
      this.saveSoon();
    };
    bpm.addEventListener('change', () => applyBpm(bpm.value));
    document.querySelectorAll('[data-bpm-step]').forEach((button) => button.addEventListener('click', () => applyBpm(Number(bpm.value) + Number(button.dataset.bpmStep))));
    this.el('btn-tap').addEventListener('click', () => {
      const now = performance.now();
      this.tapTimes = this.tapTimes.filter((time) => now - time < 2500);
      this.tapTimes.push(now);
      if (this.tapTimes.length > 1) {
        const intervals = this.tapTimes.slice(1).map((time, index) => time - this.tapTimes[index]);
        applyBpm(60000 / (intervals.reduce((sum, value) => sum + value, 0) / intervals.length));
      }
    });
    this.segmented('quantize-select', 'quantize', (value) => { this.engine.setQuantizeMode(value); this.saveSoon(); });
    this.segmented('reclen-select', 'reclen', (value) => { this.engine.setRecLength(value === 'FREE' ? 'FREE' : Number(value)); this.saveSoon(); });
    this.el('btn-play-all').addEventListener('click', () => this.engine.playAll());
    this.el('btn-stop-all').addEventListener('click', () => this.engine.stopAll());
    this.el('btn-metro').addEventListener('click', (event) => {
      this.engine.setMetroEnabled(!this.engine.metroOn);
      event.currentTarget.classList.toggle('active', this.engine.metroOn);
    });
    this.el('metro-level').addEventListener('input', (event) => { this.engine.setMetroLevel(event.target.value); this.saveSoon(); });
    this.el('master-gain').addEventListener('input', (event) => { this.engine.setMasterGain(Number(event.target.value)); this.saveSoon(); });
    this.el('sampler-master-gain').addEventListener('input', (event) => { this.engine.sampler.setMasterGain(Number(event.target.value)); this.saveSoon(); });

    this.el('btn-global-infx-toggle').addEventListener('click', () => {
      this.engine.setInputFxEnabled(!this.engine.inputFxRack.enabled);
      this.el('btn-global-infx-toggle').classList.toggle('active', this.engine.inputFxRack.enabled);
      this.saveSoon();
    });
    this.el('btn-global-infx-edit').addEventListener('click', () => this.openRack('INPUT FX', this.engine.inputFxRack));
    this.el('btn-all-outfx-toggle').addEventListener('click', () => {
      this.allOutputFxEnabled = !this.allOutputFxEnabled;
      this.engine.setAllTrackFxEnabled(this.allOutputFxEnabled);
      this.el('btn-all-outfx-toggle').classList.toggle('active', this.allOutputFxEnabled);
      this.engine.tracks.forEach((track, index) => this.renderTrackState(index));
      this.saveSoon();
    });
    this.el('btn-master-fx-edit').addEventListener('click', () => this.openRack('MASTER FX', this.engine.masterFxRack));
    this.el('btn-open-sampler').addEventListener('click', () => {
      this.open('modal-sampler');
      this.renderSamplerPads();
      if (this.samplerSettings) this.openSamplerPad(this.activeSamplerPad);
    });

    let recordingMix = false;
    this.el('btn-master-rec').addEventListener('click', async (event) => {
      const button = event.currentTarget;
      if (!recordingMix) {
        try {
          if (!this.engine.startMasterRecording()) throw new Error('MIX_REC_BUSY');
          recordingMix = true;
          button.textContent = 'STOP MIX';
          button.classList.add('active');
          this.flash('MIX RECORDING');
        } catch (error) {
          recordingMix = false;
          button.textContent = 'REC MIX';
          button.classList.remove('active');
          this.flash('MIX REC ERROR');
        }
      } else {
        button.disabled = true;
        button.textContent = 'SAVING';
        try {
          const blob = await this.engine.stopMasterRecording();
          if (!blob || !blob.size) throw new Error('EMPTY_MIX');
          this.downloadBlob(blob, `nt-looper-mix-${Date.now()}.wav`);
          this.flash('MIX SAVED');
        } catch (error) {
          this.flash('MIX SAVE ERROR');
        } finally {
          recordingMix = false;
          button.disabled = false;
          button.textContent = 'REC MIX';
          button.classList.remove('active');
        }
      }
    });
    this.el('btn-open-settings').addEventListener('click', () => {
      if (this.learnMode) this.stopLearnMode();
      this.open('modal-settings');
    });
  },

  bindSampler() {
    const grid = this.el('sampler-pad-grid');
    grid.innerHTML = '';
    this.engine.sampler.onStateChange = (index) => {
      this.renderSamplerPad(index);
      if (this.samplerSettings && index === this.activeSamplerPad && !this._samplerTrimDragging) this.syncSamplerEditor();
    };
    this.engine.sampler.pads.forEach((pad, index) => {
      const button = document.createElement('button');
      button.className = 'sampler-pad';
      button.id = `sampler-pad-${index}`;
      button.type = 'button';
      button.addEventListener('pointerdown', (event) => {
        event.preventDefault();
        if (this.midi.learnMode || this.keyboard.learnMode) return;
        if (this.samplerSettings) { this.openSamplerPad(index); return; }
        try { button.setPointerCapture(event.pointerId); } catch (error) {}
        if (!this.engine.sampler.trigger(index)) this.flash(`PAD ${index + 1} EMPTY`);
      });
      const release = (event) => {
        if (!this.samplerSettings) this.engine.sampler.release(index);
        try { button.releasePointerCapture(event.pointerId); } catch (error) {}
      };
      button.addEventListener('pointerup', release);
      button.addEventListener('pointercancel', release);
      button.addEventListener('keydown', (event) => {
        if (!['Enter', ' '].includes(event.key) || event.repeat) return;
        event.preventDefault();
        if (this.samplerSettings) this.openSamplerPad(index);
        else this.engine.sampler.trigger(index);
      });
      button.addEventListener('keyup', (event) => {
        if (['Enter', ' '].includes(event.key) && !this.samplerSettings) this.engine.sampler.release(index);
      });
      this.registerLearnTarget(button, `sampler_${index}`, `PAD ${index + 1}`);
      grid.appendChild(button);
    });

    this.el('btn-sampler-settings').addEventListener('click', (event) => {
      this.samplerSettings = !this.samplerSettings;
      event.currentTarget.classList.toggle('active', this.samplerSettings);
      this.el('sampler-editor').hidden = !this.samplerSettings;
      this.renderSamplerPads();
      if (this.samplerSettings) this.openSamplerPad(this.activeSamplerPad);
    });
    this.el('btn-sampler-import').addEventListener('click', () => this.el('file-import-pad').click());
    this.el('file-import-pad').addEventListener('change', async (event) => {
      const file = event.target.files[0];
      event.target.value = '';
      if (!file) return;
      try {
        await this.engine.sampler.loadFile(this.activeSamplerPad, file);
        this.syncSamplerEditor();
        this.flash(`PAD ${this.activeSamplerPad + 1} LOADED`);
      } catch (error) { this.flash('PAD IMPORT ERROR'); }
    });
    this.el('btn-sampler-clear').addEventListener('click', () => {
      this.engine.sampler.clear(this.activeSamplerPad);
      this.syncSamplerEditor();
    });
    this.el('sampler-pad-bpm').addEventListener('change', (event) => {
      this.engine.sampler.setBpm(this.activeSamplerPad, event.target.value);
      this.saveSoon();
    });
    this.el('sampler-pad-volume').addEventListener('input', (event) => {
      const value = Number(event.target.value);
      this.engine.sampler.setVolume(this.activeSamplerPad, value);
      this.el('sampler-pad-volume-value').textContent = value <= 0 ? '-∞ dB' : `${(20 * Math.log10(value)).toFixed(1)} dB`;
      this.saveSoon();
    });
    const previewTrim = (changedId) => {
      const pad = this.engine.sampler.pad(this.activeSamplerPad);
      const inputEl = this.el('sampler-trim-in');
      const outputEl = this.el('sampler-trim-out');
      let start = Number(inputEl.value);
      let end = Number(outputEl.value);
      if (changedId === 'sampler-trim-in' && start >= end) {
        start = Math.max(0, end - 0.001);
        inputEl.value = start;
      } else if (changedId === 'sampler-trim-out' && end <= start) {
        end = Math.min(1, start + 0.001);
        outputEl.value = end;
      }
      // Mesma correção do trim de track: nunca reatribuir .value do slider ativo
      // (isso perde o arraste no iPad/Safari); só restringe o min/max do par.
      this.constrainTrimRange(inputEl, outputEl, 0.001);
      this.samplerWave.setTrim(start, end);
      const duration = pad.originalBuffer ? pad.originalBuffer.duration : 0;
      this.el('sampler-trim-in-value').textContent = this.formatTimeMs(start * duration);
      this.el('sampler-trim-out-value').textContent = this.formatTimeMs(end * duration);
    };
    ['sampler-trim-in', 'sampler-trim-out'].forEach((id) => {
      const slider = this.el(id);
      slider.addEventListener('pointerdown', (event) => {
        this._samplerTrimDragging = id;
        try { slider.setPointerCapture(event.pointerId); } catch (error) {}
      });
      slider.addEventListener('input', () => {
        this._samplerTrimDragging = id;
        previewTrim(id);
      });
      const commit = (event) => {
        if (!this._samplerTrimDragging) return;
        this.engine.sampler.setTrim(this.activeSamplerPad, this.el('sampler-trim-in').value, this.el('sampler-trim-out').value);
        this._samplerTrimDragging = null;
        if (event && Number.isFinite(event.pointerId)) {
          try { slider.releasePointerCapture(event.pointerId); } catch (error) {}
        }
        requestAnimationFrame(() => this.syncSamplerEditor());
        this.saveSoon();
      };
      slider.addEventListener('pointerup', commit);
      slider.addEventListener('pointercancel', commit);
      slider.addEventListener('change', commit);
    });
    this.segmented('sampler-direction-select', 'direction', (value) => {
      this.engine.sampler.setDirection(this.activeSamplerPad, value);
      this.saveSoon();
    });
    this.segmented('sampler-trigger-select', 'trigger', (value) => {
      this.engine.sampler.setTrigger(this.activeSamplerPad, value);
      this.saveSoon();
    });
    this.renderSamplerPads();
  },

  openSamplerPad(index) {
    this.activeSamplerPad = index;
    this.el('sampler-editor').hidden = false;
    this.renderSamplerPads();
    this.syncSamplerEditor();
  },

  renderSamplerPad(index) {
    const pad = this.engine.sampler.pad(index);
    const button = this.el(`sampler-pad-${index}`);
    if (!button) return;
    button.classList.toggle('loaded', !!pad.originalBuffer);
    button.classList.toggle('active', pad.active);
    button.classList.toggle('selected', this.samplerSettings && this.activeSamplerPad === index);
    button.dataset.trigger = pad.trigger;
    button.innerHTML = `<b>${String(index + 1).padStart(2, '0')}</b><small>${pad.originalBuffer ? pad.name : 'EMPTY'}</small>`;
    button.setAttribute('aria-label', `Pad ${index + 1} ${pad.name} ${pad.trigger}`);
  },

  renderSamplerPads() {
    this.engine.sampler.pads.forEach((pad, index) => this.renderSamplerPad(index));
  },

  syncSamplerEditor() {
    if (this._samplerTrimDragging) return;
    const pad = this.engine.sampler.pad(this.activeSamplerPad);
    this.el('sampler-pad-title').textContent = `PAD ${this.activeSamplerPad + 1}`;
    this.el('sampler-pad-file').textContent = pad.originalBuffer ? pad.name : 'EMPTY';
    this.el('sampler-pad-bpm').value = pad.bpm;
    this.el('sampler-pad-volume').value = pad.volume;
    this.el('sampler-pad-volume-value').textContent = pad.volume <= 0 ? '-∞ dB' : `${(20 * Math.log10(pad.volume)).toFixed(1)} dB`;
    const samplerTrimIn = this.el('sampler-trim-in');
    const samplerTrimOut = this.el('sampler-trim-out');
    samplerTrimIn.min = 0; samplerTrimIn.max = 1;
    samplerTrimOut.min = 0; samplerTrimOut.max = 1;
    samplerTrimIn.value = pad.trimStart;
    samplerTrimOut.value = pad.trimEnd;
    this.constrainTrimRange(samplerTrimIn, samplerTrimOut, 0.001);
    const duration = pad.originalBuffer ? pad.originalBuffer.duration : 0;
    this.el('sampler-trim-in-value').textContent = this.formatTimeMs(pad.trimStart * duration);
    this.el('sampler-trim-out-value').textContent = this.formatTimeMs(pad.trimEnd * duration);
    this.setSegment('sampler-direction-select', 'direction', pad.direction);
    this.setSegment('sampler-trigger-select', 'trigger', pad.trigger);
    if (pad.peaks) this.samplerWave.setFull(pad.peaks); else this.samplerWave.clear();
    this.samplerWave.setTrim(pad.trimStart, pad.trimEnd);
  },

  segmented(id, dataKey, callback) {
    document.querySelectorAll(`#${id} .seg-opt`).forEach((button) => button.addEventListener('click', () => {
      document.querySelectorAll(`#${id} .seg-opt`).forEach((item) => item.classList.remove('active'));
      button.classList.add('active');
      callback(button.dataset[dataKey]);
    }));
  },

  bindSettings() {
    document.querySelectorAll('[data-close]').forEach((button) => button.addEventListener('click', (event) => {
      event.currentTarget.closest('.modal-overlay').hidden = true;
    }));
    document.querySelectorAll('.modal-overlay').forEach((overlay) => overlay.addEventListener('click', (event) => {
      if (event.target === overlay) overlay.hidden = true;
    }));
    document.querySelectorAll('#modal-settings [data-tab]').forEach((button) => button.addEventListener('click', () => {
      document.querySelectorAll('#modal-settings [data-tab]').forEach((item) => item.classList.remove('active'));
      document.querySelectorAll('#modal-settings .tab-panel').forEach((panel) => panel.classList.remove('active'));
      button.classList.add('active'); this.el(button.dataset.tab).classList.add('active');
    }));

    this.el('btn-refresh-devices').addEventListener('click', () => this.refreshDevices());
    this.el('btn-arm-input').addEventListener('click', () => this.armInput());
    this.el('select-audio-input').addEventListener('change', () => this.armInput());
    this.el('select-audio-output').addEventListener('change', async (event) => {
      try {
        const changed = await this.engine.setOutputDevice(event.target.value);
        this.flash(changed ? 'AUDIO OUTPUT CONNECTED' : 'SYSTEM AUDIO OUTPUT');
      } catch (error) { this.flash('OUTPUT ERROR'); }
    });
    this.segmented('isolation-select', 'isolation', async (value) => {
      try { await this.engine.setRecordIsolation(value === 'AEC'); this.flash(value === 'AEC' ? 'REC ISOLATION AEC' : 'REC ISOLATION DIRECT'); }
      catch (error) { this.flash('INPUT RECONNECT ERROR'); }
    });
    this.segmented('audio-buffer-select', 'buffer', (value) => {
      const changed = value !== this.engine.audioBufferMode;
      this.engine.setAudioBufferMode(value);
      this.updateAudioDiagnostics();
      if (changed) this.flash('RELOAD APP FOR AUDIO BUFFER');
    });
    this.segmented('audio-samplerate-select', 'samplerate', (value) => {
      const changed = value !== this.engine.sampleRateMode;
      this.engine.setSampleRateMode(value);
      if (changed) this.flash('RELOAD APP FOR SAMPLE RATE');
    });
    this.updateOutputDeviceHint();

    this.el('in-trim-db').addEventListener('input', (event) => {
      const value = Number(event.target.value); this.engine.setInputTrimDb(value); this.el('in-trim-value').textContent = `${value > 0 ? '+' : ''}${value} dB`; this.saveSoon();
    });
    this.el('in-lowcut').addEventListener('input', (event) => {
      const value = Number(event.target.value); this.engine.setInputLowCut(value); this.el('in-lowcut-value').textContent = `${value} Hz`; this.saveSoon();
    });
    this.el('in-bright').addEventListener('input', (event) => {
      const value = Number(event.target.value); this.engine.setBrightness(value); this.el('in-bright-value').textContent = `${value > 0 ? '+' : ''}${value} dB`; this.saveSoon();
    });

    this.segmented('mode-select', 'mode', (value) => { this.engine.setRecMode(value); this.saveSoon(); });
    this.el('tail-duration').addEventListener('input', (event) => {
      const value = Number(event.target.value); this.el('tail-duration-value').textContent = `${value.toFixed(1)} s`; this.engine.setTailReverb(this.engine.tailReverbEnabled, value); this.saveSoon();
    });
    this.el('btn-tail-toggle').addEventListener('click', (event) => {
      this.engine.setTailReverb(!this.engine.tailReverbEnabled, this.engine.tailReverbDuration);
      event.currentTarget.textContent = this.engine.tailReverbEnabled ? 'TAIL ON' : 'TAIL OFF';
      event.currentTarget.classList.toggle('active', this.engine.tailReverbEnabled);
      this.saveSoon();
    });
    this.el('btn-save-setup').addEventListener('click', () => { this.engine.saveSetup(); this.flash('SETUP SAVED'); });
    this.el('btn-load-setup').addEventListener('click', () => {
      const loaded = this.engine.loadSetup();
      if (loaded) { this.syncAllControls(); this.flash('SETUP LOADED'); }
      else this.flash('NO SAVED SETUP');
    });
    this.el('btn-apply-template').addEventListener('click', () => {
      const template = NS_BUILTIN_TEMPLATES.find((item) => item.id === this.el('template-select').value);
      if (!template) return;
      this.engine.applySetup(template.create());
      this.engine.saveSetup();
      this.syncAllControls();
      this.flash('TEMPLATE APPLIED');
    });
    this.el('btn-export-preset').addEventListener('click', () => {
      const data = JSON.stringify({ format: 'NT LOOPER PRESET', version: 17, setup: this.engine.serializeSetup() }, null, 2);
      this.downloadBlob(new Blob([data], { type: 'application/json' }), `nt-looper-preset-${Date.now()}.json`);
      this.flash('PRESET EXPORTED');
    });
    this.el('btn-import-preset').addEventListener('click', () => this.el('file-import-preset').click());
    this.el('file-import-preset').addEventListener('change', async (event) => {
      const file = event.target.files[0];
      event.target.value = '';
      if (!file) return;
      try {
        const parsed = JSON.parse(await file.text());
        const setup = parsed.setup || parsed;
        if (!setup || !Array.isArray(setup.tracks)) throw new Error('INVALID_PRESET');
        this.engine.applySetup(setup);
        this.engine.saveSetup();
        this.syncAllControls();
        this.flash('PRESET IMPORTED');
      } catch (error) { this.flash('INVALID PRESET'); }
    });
    this.el('btn-save-project').addEventListener('click', async (event) => {
      const button = event.currentTarget;
      button.disabled = true; button.textContent = 'SAVING';
      try {
        const blob = await this.engine.saveProjectBlob();
        this.downloadBlob(blob, `nt-looper-project-${Date.now()}.ntloop`);
        this.flash('PROJECT SAVED');
      } catch (error) { this.flash('PROJECT SAVE ERROR'); }
      finally { button.disabled = false; button.textContent = 'SAVE PROJECT'; }
    });
    this.el('btn-open-project').addEventListener('click', () => this.el('file-open-project').click());
    this.el('file-open-project').addEventListener('change', async (event) => {
      const file = event.target.files[0];
      event.target.value = '';
      if (!file) return;
      const button = this.el('btn-open-project');
      button.disabled = true; button.textContent = 'OPENING';
      try {
        await this.engine.loadProjectFile(file);
        this.engine.saveSetup();
        this.syncAllControls();
        this.flash('PROJECT OPENED');
      } catch (error) { this.flash('INVALID PROJECT'); }
      finally { button.disabled = false; button.textContent = 'OPEN PROJECT'; }
    });
    this.el('btn-export-all').addEventListener('click', async (event) => {
      const button = event.currentTarget;
      button.disabled = true; button.textContent = 'RENDERING';
      try {
        const blob = await this.engine.exportAllWavZip();
        if (!blob) this.flash('EMPTY SESSION');
        else { this.downloadBlob(blob, `nt-looper-session-${Date.now()}.zip`); this.flash('ALL WAV EXPORTED'); }
      } catch (error) { this.flash('WAV EXPORT ERROR'); }
      finally { button.disabled = false; button.textContent = 'EXPORT ALL WAV'; }
    });

    this.el('select-midi-input').addEventListener('change', (event) => this.midi.selectInput(event.target.value));
    this.el('btn-midi-learn-toggle').addEventListener('click', () => {
      if (this.learnMode === 'midi') this.stopLearnMode();
      else this.startLearnMode('midi');
    });
    this.el('btn-midi-clear').addEventListener('click', () => this.midi.clearMappings());
    this.midi.onMappingsChanged = () => { this.renderMidiMappings(); this.syncLearnTargets(); };
    this.el('btn-keyboard-learn-toggle').addEventListener('click', () => {
      if (this.learnMode === 'keyboard') this.stopLearnMode();
      else this.startLearnMode('keyboard');
    });
    this.el('btn-keyboard-clear').addEventListener('click', () => this.keyboard.clearMappings());
    this.keyboard.onMappingsChanged = () => { this.renderKeyboardMappings(); this.syncLearnTargets(); };
  },

  populateTemplates() {
    const select = this.el('template-select');
    select.innerHTML = '';
    NS_BUILTIN_TEMPLATES.forEach((template) => select.add(new Option(template.name, template.id)));
  },

  async armInput() {
    try {
      await this.engine.connectInputDevice(this.el('select-audio-input').value || '');
      this.el('audio-status-dot').classList.add('live');
      this.flash('AUDIO INPUT CONNECTED');
      await this.refreshDevices(false);
    } catch (error) {
      this.flash('AUDIO INPUT ERROR');
    }
  },

  async refreshDevices(requestPermission = true) {
    if (requestPermission && !this.engine.mediaStream) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach((track) => track.stop());
      } catch (error) {}
    }
    const devices = await navigator.mediaDevices.enumerateDevices();
    const audioIn = this.el('select-audio-input');
    const audioOut = this.el('select-audio-output');
    const currentIn = this.engine.inputDeviceId || audioIn.value;
    const currentOut = this.engine.outputDeviceId || audioOut.value;
    audioIn.innerHTML = '';
    audioOut.innerHTML = '';
    devices.filter((device) => device.kind === 'audioinput').forEach((device, index) => {
      audioIn.add(new Option(device.label || `INPUT ${index + 1}`, device.deviceId));
    });
    devices.filter((device) => device.kind === 'audiooutput').forEach((device, index) => {
      audioOut.add(new Option(device.label || `OUTPUT ${index + 1}`, device.deviceId));
    });
    if (currentIn) audioIn.value = currentIn;
    if (currentOut) audioOut.value = currentOut;
    this.updateOutputDeviceHint();
    const midiSelect = this.el('select-midi-input');
    midiSelect.innerHTML = '';
    const midiInputs = this.midi.listInputs();
    midiInputs.forEach((input) => midiSelect.add(new Option(input.name, input.id)));
    if (midiInputs.length) {
      const preferred = midiInputs.find((input) => input.id === (this.midi.input?.id || this.midi.preferredInputId)) || midiInputs[0];
      midiSelect.value = preferred.id;
      this.midi.selectInput(preferred.id);
    }
    this.renderMidiMappings();
  },

  renderMidiMappings() {
    const list = this.el('midi-map-list');
    list.innerHTML = '';
    Object.entries(this.midi.mappings).forEach(([message, mapping]) => {
      const row = document.createElement('div');
      row.className = 'midi-map-row';
      const source = document.createElement('span'); source.textContent = message.toUpperCase();
      const label = document.createElement('span'); label.textContent = mapping.label;
      const remove = document.createElement('button'); remove.className = 'map-remove'; remove.type = 'button'; remove.textContent = '×'; remove.title = 'REMOVE';
      remove.addEventListener('click', () => this.midi.removeMapping(message));
      row.append(source, label, remove);
      list.appendChild(row);
    });
  },

  renderKeyboardMappings() {
    const list = this.el('keyboard-map-list');
    list.innerHTML = '';
    Object.entries(this.keyboard.mappings).forEach(([key, mapping]) => {
      const row = document.createElement('div');
      row.className = 'midi-map-row';
      const source = document.createElement('span'); source.textContent = key.replace(/^Key/, '').replace(/^Digit/, '');
      const label = document.createElement('span'); label.textContent = mapping.label;
      const remove = document.createElement('button'); remove.className = 'map-remove'; remove.type = 'button'; remove.textContent = '×'; remove.title = 'REMOVE';
      remove.addEventListener('click', () => this.keyboard.removeMapping(key));
      row.append(source, label, remove);
      list.appendChild(row);
    });
  },

  bindTrackModal() {
    document.querySelectorAll('#modal-track [data-track-tab]').forEach((button) => button.addEventListener('click', () => this.selectTrackTab(button.dataset.trackTab)));
    this.el('track-input-gain').addEventListener('input', (event) => {
      const track = this.engine.tracks[this.activeTrack];
      const db = Number(event.target.value);
      track.setInputGain(Math.pow(10, db / 20));
      this.el('track-input-gain-value').textContent = `${db > 0 ? '+' : ''}${db.toFixed(1)} dB`;
      this.saveSoon();
    });
    ['low', 'mid', 'high'].forEach((band) => this.el(`eq-${band}`).addEventListener('input', (event) => {
      const value = Number(event.target.value);
      this.engine.tracks[this.activeTrack].setInputEQ(band, value);
      this.el(`eq-${band}-value`).textContent = `${value > 0 ? '+' : ''}${value}`;
      this.saveSoon();
    }));
    this.el('track-pan').addEventListener('input', (event) => {
      const value = Number(event.target.value); this.engine.tracks[this.activeTrack].setPan(value); this.el('track-pan-value').textContent = this.panLabel(value); this.saveSoon();
    });
    this.el('btn-track-reverse').addEventListener('click', (event) => {
      const track = this.engine.tracks[this.activeTrack]; track.setReverse(!track.reverse);
      event.currentTarget.textContent = track.reverse ? 'REVERSE ON' : 'REVERSE OFF'; event.currentTarget.classList.toggle('active', track.reverse); this.saveSoon();
    });
    this.el('btn-edit-track-input-fx').addEventListener('click', () => {
      const track = this.engine.tracks[this.activeTrack]; this.openRack(`TRACK ${this.activeTrack + 1} · INPUT FX`, track.inputFxRack);
    });
    this.el('btn-edit-track-output-fx').addEventListener('click', () => {
      const track = this.engine.tracks[this.activeTrack]; this.openRack(`TRACK ${this.activeTrack + 1} · TRACK FX`, track.outputFxRack);
    });
    this.el('btn-copy-in-to-out').addEventListener('click', () => {
      this.engine.tracks[this.activeTrack].copyFxChain('input', 'output');
      this.renderQuickFx(this.activeTrack); this.flash('INPUT FX COPIED TO TRACK FX'); this.saveSoon();
    });
    this.el('btn-copy-out-to-in').addEventListener('click', () => {
      this.engine.tracks[this.activeTrack].copyFxChain('output', 'input');
      this.renderQuickFx(this.activeTrack); this.flash('TRACK FX COPIED TO INPUT FX'); this.saveSoon();
    });
    this.el('btn-copy-track').addEventListener('click', () => {
      const target = Number(this.el('copy-track-target').value);
      if (this.engine.copyTrackSetup(this.activeTrack, target)) {
        this.syncAllControls();
        this.flash(`TRACK ${this.activeTrack + 1} COPIED TO TRACK ${target + 1}`);
        this.saveSoon();
      }
    });

    const trimIn = this.el('trim-in');
    const trimOut = this.el('trim-out');
    const previewTrim = (changedId) => {
      let start = Number(trimIn.value), end = Number(trimOut.value);
      if (changedId === 'trim-in' && start >= end) {
        start = Math.max(0, end - 0.002);
        trimIn.value = start;
      } else if (changedId === 'trim-out' && end <= start) {
        end = Math.min(1, start + 0.002);
        trimOut.value = end;
      }
      // Não reatribuir .value do slider que está sendo arrastado: em iOS/Safari (e às
      // vezes no desktop) isso interrompe o gesto de arraste no meio do caminho. Em
      // vez de clampar o valor manualmente, restringe min/max do OUTRO slider para que
      // o próprio input nativo impeça o cruzamento — sem nunca escrever .value do
      // elemento ativo.
      this.constrainTrimRange(trimIn, trimOut, 0.002);
      this.trimWave.setTrim(start, end);
      this.updateTrimLabels(start, end);
    };
    [trimIn, trimOut].forEach((slider) => {
      slider.addEventListener('pointerdown', (event) => {
        this._trackTrimDragging = slider.id;
        try { slider.setPointerCapture(event.pointerId); } catch (error) {}
      });
      slider.addEventListener('input', () => {
        this._trackTrimDragging = slider.id;
        previewTrim(slider.id);
      });
      const commit = (event) => {
        if (!this._trackTrimDragging) return;
        this.applyTrim();
        this._trackTrimDragging = null;
        if (event && Number.isFinite(event.pointerId)) {
          try { slider.releasePointerCapture(event.pointerId); } catch (error) {}
        }
      };
      slider.addEventListener('pointerup', commit);
      slider.addEventListener('pointercancel', commit);
      slider.addEventListener('change', commit);
    });
    this.el('btn-reset-trim').addEventListener('click', () => {
      this.engine.tracks[this.activeTrack].resetTrim();
      trimIn.min = 0; trimIn.max = 1;
      trimOut.min = 0; trimOut.max = 1;
      trimIn.value = 0; trimOut.value = 1;
      previewTrim('trim-out');
    });
    this.el('btn-import-track').addEventListener('click', () => this.el('file-import-track').click());
    this.el('file-import-track').addEventListener('change', async (event) => {
      const file = event.target.files[0];
      event.target.value = '';
      if (!file) return;
      const track = this.engine.tracks[this.activeTrack];
      if (track.state === 'RECORDING' || track.state === 'OVERDUBBING') { this.flash('STOP TRACK FIRST'); return; }
      const button = this.el('btn-import-track');
      button.disabled = true; button.textContent = 'IMPORTING';
      try {
        await track.importAudioFile(file);
        this.flash('SAMPLE IMPORTED');
      } catch (error) {
        this.flash('FORMAT NOT SUPPORTED');
      } finally {
        button.disabled = false; button.textContent = 'IMPORT AUDIO';
      }
    });
    this.el('btn-download-track').addEventListener('click', async (event) => {
      const track = this.engine.tracks[this.activeTrack];
      if (!track.loopLength) { this.flash('EMPTY TRACK'); return; }
      event.currentTarget.disabled = true; event.currentTarget.textContent = 'RENDERING';
      try {
        const blob = await track.exportWav();
        this.downloadBlob(blob, `nt-looper-track-${this.activeTrack + 1}.wav`);
      } finally {
        event.currentTarget.disabled = false; event.currentTarget.textContent = 'DOWNLOAD WAV';
      }
    });
  },

  openTrack(index, tab) {
    this.activeTrack = index;
    const track = this.engine.tracks[index];
    this.el('track-modal-title').textContent = `TRACK ${index + 1}`;
    const inputDb = 20 * Math.log10(Math.max(0.0001, track.inputGain.gain.value));
    this.el('track-input-gain').value = inputDb;
    this.el('track-input-gain-value').textContent = this.linearToDb(track.inputGain.gain.value);
    ['low', 'mid', 'high'].forEach((band) => {
      const value = { low: track.inEqLow, mid: track.inEqMid, high: track.inEqHigh }[band].gain.value;
      this.el(`eq-${band}`).value = value; this.el(`eq-${band}-value`).textContent = `${value > 0 ? '+' : ''}${Math.round(value * 10) / 10}`;
    });
    this.el('track-pan').value = track.panner.pan.value;
    this.el('track-pan-value').textContent = this.panLabel(track.panner.pan.value);
    this.el('btn-track-reverse').textContent = track.reverse ? 'REVERSE ON' : 'REVERSE OFF';
    this.el('btn-track-reverse').classList.toggle('active', track.reverse);
    const copyTarget = this.el('copy-track-target');
    copyTarget.innerHTML = '';
    this.engine.tracks.forEach((item, target) => {
      if (target !== index) copyTarget.add(new Option(`TRACK ${target + 1}`, String(target)));
    });
    this.open('modal-track');
    this.selectTrackTab(tab === 'sample' ? 'track-tab-sample' : 'track-tab-config');
    this.syncTrimEditor();
  },

  selectTrackTab(panelId) {
    document.querySelectorAll('#modal-track [data-track-tab]').forEach((button) => button.classList.toggle('active', button.dataset.trackTab === panelId));
    document.querySelectorAll('#modal-track .tab-panel').forEach((panel) => panel.classList.toggle('active', panel.id === panelId));
    if (panelId === 'track-tab-sample') setTimeout(() => this.syncTrimEditor(), 0);
  },

  syncTrimEditor() {
    if (!this.trimWave || this._trackTrimDragging) return;
    const track = this.engine.tracks[this.activeTrack];
    const peaks = this.sourceWaveforms[this.activeTrack] || this.waveforms[this.activeTrack]?.fullPeaks;
    this.trimWave.setFull(peaks);
    const start = track.trimStart || 0;
    const end = Number.isFinite(track.trimEnd) ? track.trimEnd : 1;
    this.trimWave.setTrim(start, end);
    const trimIn = this.el('trim-in');
    const trimOut = this.el('trim-out');
    // Reabre para 0..1 antes de setar o valor: se o min/max ficou restrito de uma
    // sessão de trim anterior, atribuir .value fora do intervalo atual seria clampado
    // pelo próprio input nativo e o valor carregado não bateria com o da track.
    trimIn.min = 0; trimIn.max = 1;
    trimOut.min = 0; trimOut.max = 1;
    trimIn.value = start;
    trimOut.value = end;
    this.constrainTrimRange(trimIn, trimOut, 0.002);
    this.updateTrimLabels(start, end);
  },

  // Mantém dois <input type=range> ligados (IN/OUT de um trim) sem nunca reatribuir
  // .value do slider que o usuário pode estar arrastando — só ajusta min/max do par,
  // que o navegador já respeita nativamente durante o arraste.
  constrainTrimRange(fromEl, toEl, gap) {
    const start = Number(fromEl.value);
    const end = Number(toEl.value);
    fromEl.max = String(Math.max(Number(fromEl.min) || 0, end - gap));
    toEl.min = String(Math.min(Number(toEl.max) || 1, start + gap));
  },

  applyTrim() {
    const start = Number(this.el('trim-in').value);
    const end = Number(this.el('trim-out').value);
    this.engine.tracks[this.activeTrack].setTrim(start, end);
  },

  updateTrimLabels(start, end) {
    const sourceDuration = this.engine.tracks[this.activeTrack].sourceDurationSec || 0;
    this.el('trim-in-value').textContent = this.formatTimeMs(sourceDuration * start);
    this.el('trim-out-value').textContent = this.formatTimeMs(sourceDuration * end);
    this.el('trim-length').textContent = this.formatTimeMs(sourceDuration * Math.max(0, end - start));
  },

  bindRackModal() {
    this.el('rack-enable').addEventListener('click', (event) => {
      this.activeRack.setEnabled(!this.activeRack.enabled);
      event.currentTarget.textContent = this.activeRack.enabled ? 'FX ON' : 'FX OFF';
      event.currentTarget.classList.toggle('active', this.activeRack.enabled);
      this.syncRackSurface(); this.saveSoon();
    });
    this.el('rack-intensity').addEventListener('input', (event) => {
      const value = Number(event.target.value); this.activeRack.setIntensity(value); this.el('rack-intensity-value').textContent = `${Math.round(value * 100)}%`; this.saveSoon();
    });
    this.el('btn-add-fx').addEventListener('click', () => {
      const picker = this.el('fx-add-picker'); picker.hidden = !picker.hidden;
      if (picker.hidden) return;
      picker.innerHTML = '';
      NS_FX_CATALOG.forEach((item) => {
        const button = document.createElement('button');
        button.className = `fx-pick-btn status-${item.status}${item.favorite ? ' favorite' : ''}`;
        button.textContent = item.name;
        button.addEventListener('click', () => {
          const fx = this.activeRack.add(item.id);
          if (!fx) this.flash('MAX 4 FX PER RACK');
          else this.engine.syncEffectTempo();
          picker.hidden = true; this.renderFxChain(); this.syncRackSurface(); this.saveSoon();
        });
        picker.appendChild(button);
      });
    });
  },

  openRack(title, rack) {
    this.activeRack = rack;
    this.el('rack-title').textContent = title;
    this.el('rack-enable').textContent = rack.enabled ? 'FX ON' : 'FX OFF';
    this.el('rack-enable').classList.toggle('active', rack.enabled);
    this.el('rack-intensity').value = rack.intensity;
    this.el('rack-intensity-value').textContent = `${Math.round(rack.intensity * 100)}%`;
    this.el('fx-add-picker').hidden = true;
    this.renderFxChain();
    this.open('modal-rack');
  },

  renderFxChain() {
    const list = this.el('fx-chain-list');
    list.innerHTML = '';
    if (!this.activeRack || !this.activeRack.chain.length) {
      const empty = document.createElement('div'); empty.className = 'fx-empty'; empty.textContent = 'EMPTY RACK'; list.appendChild(empty); return;
    }
    this.activeRack.chain.forEach((fx, index) => {
      const catalog = NS_FX_CATALOG.find((item) => item.id === fx.id);
      const row = document.createElement('div');
      row.className = `fx-chain-item status-${catalog?.status || 'broken'}${fx.bypassed ? ' bypassed' : ''}`;
      row.innerHTML = `<span class="fx-index">${String(index + 1).padStart(2, '0')}</span><span class="fx-name">${catalog ? catalog.name : fx.id}</span><span class="fx-order"><button class="fx-move fx-up" aria-label="Move effect up">↑</button><button class="fx-move fx-down" aria-label="Move effect down">↓</button></span><button class="fx-open" aria-label="Edit effect">›</button>`;
      const up = row.querySelector('.fx-up');
      const down = row.querySelector('.fx-down');
      up.disabled = index === 0;
      down.disabled = index === this.activeRack.chain.length - 1;
      up.addEventListener('click', () => { this.activeRack.move(fx, -1); this.renderFxChain(); this.syncRackSurface(); this.saveSoon(); });
      down.addEventListener('click', () => { this.activeRack.move(fx, 1); this.renderFxChain(); this.syncRackSurface(); this.saveSoon(); });
      row.querySelector('.fx-open').addEventListener('click', () => this.openFxParams(fx));
      list.appendChild(row);
    });
  },

  bindFxModal() {
    this.el('btn-fx-bypass').addEventListener('click', (event) => {
      this.activeFx.setBypass(!this.activeFx.bypassed);
      event.currentTarget.textContent = this.activeFx.bypassed ? 'FX OFF' : 'FX ON';
      event.currentTarget.classList.toggle('active', !this.activeFx.bypassed);
      this.renderFxChain(); this.syncRackSurface(); this.saveSoon();
    });
    this.el('btn-replace-fx').addEventListener('click', () => {
      const picker = this.el('fx-replace-picker');
      picker.hidden = !picker.hidden;
      if (picker.hidden) return;
      picker.innerHTML = '';
      NS_FX_CATALOG.forEach((item) => {
        const button = document.createElement('button');
        button.className = `fx-pick-btn status-${item.status}${item.favorite ? ' favorite' : ''}`;
        button.textContent = item.name;
        button.addEventListener('click', () => {
          const next = this.activeRack.replace(this.activeFx, item.id);
          if (next) this.activeFx = next;
          this.engine.syncEffectTempo();
          picker.hidden = true;
          this.close('modal-fx-params');
          this.renderFxChain(); this.syncRackSurface(); this.saveSoon();
        });
        picker.appendChild(button);
      });
    });
    this.el('btn-remove-fx').addEventListener('click', () => {
      this.activeRack.remove(this.activeFx);
      this.close('modal-fx-params');
      this.renderFxChain(); this.syncRackSurface(); this.saveSoon();
    });
  },

  openFxParams(fx) {
    this.activeFx = fx;
    const catalog = NS_FX_CATALOG.find((item) => item.id === fx.id);
    this.el('fx-params-title').textContent = catalog ? catalog.name : fx.id;
    this.el('btn-fx-bypass').textContent = fx.bypassed ? 'FX OFF' : 'FX ON';
    this.el('btn-fx-bypass').classList.toggle('active', !fx.bypassed);
    this.el('fx-replace-picker').hidden = true;
    const body = this.el('fx-params-body'); body.innerHTML = '';
    body.className = 'fx-param-grid';
    (NS_FX_PARAM_SCHEMA[fx.id] || []).forEach((schema) => {
      const control = document.createElement('div');
      const isBinary = Array.isArray(schema.values)
        && schema.values.length === 2
        && Number(schema.min) === 0
        && Number(schema.max) === 1;
      control.className = `fx-param-control${isBinary ? ' binary' : ''}`;
      if (isBinary) {
        let value = Number(fx.params[schema.id]) >= 0.5 ? 1 : 0;
        control.innerHTML = `<div class="fx-param-head"><label>${schema.label}</label></div><button type="button" class="fx-binary-toggle" aria-label="${schema.label}" aria-pressed="${value ? 'true' : 'false'}">${this.formatParam(value, schema)}</button>`;
        const button = control.querySelector('.fx-binary-toggle');
        button.classList.toggle('active', value === 1);
        button.addEventListener('click', () => {
          value = value ? 0 : 1;
          fx.setParam(schema.id, value);
          button.textContent = this.formatParam(value, schema);
          button.setAttribute('aria-pressed', value ? 'true' : 'false');
          button.classList.toggle('active', value === 1);
          this.saveSoon();
        });
      } else {
        control.innerHTML = `<div class="fx-param-head"><label>${schema.label}</label><output>${this.formatParam(fx.params[schema.id], schema)}</output></div><input type="range" min="${schema.min}" max="${schema.max}" step="${schema.step}" value="${fx.params[schema.id]}" aria-label="${schema.label}">`;
        const input = control.querySelector('input');
        const output = control.querySelector('output');
        input.addEventListener('input', (event) => {
          const value = Number(event.target.value); fx.setParam(schema.id, value); output.textContent = this.formatParam(value, schema); this.saveSoon();
        });
      }
      body.appendChild(control);
    });
    if (fx.id === 'osc-bot') this.renderOscSequencer(body, fx);
    this.open('modal-fx-params');
  },

  renderOscSequencer(body, fx) {
    const section = document.createElement('section');
    section.className = 'osc-sequencer';
    section.innerHTML = '<header><span>16 STEP SEQUENCER</span><div><button data-pattern="flat">FLAT</button><button data-pattern="up">UP</button><button data-pattern="trap">TRAP</button></div></header><div class="osc-steps"></div>';
    const steps = section.querySelector('.osc-steps');
    for (let index = 0; index < 16; index++) {
      const item = document.createElement('label');
      const value = Number(fx.params[`step${index}`]) || 0;
      item.innerHTML = `<output>${value > 0 ? '+' : ''}${value}</output><input type="range" min="-24" max="24" step="1" value="${value}" aria-label="Step ${index + 1}"><span>${index + 1}</span>`;
      const input = item.querySelector('input');
      const output = item.querySelector('output');
      input.addEventListener('input', () => {
        const next = Number(input.value);
        fx.setParam(`step${index}`, next);
        output.textContent = `${next > 0 ? '+' : ''}${next}`;
        this.saveSoon();
      });
      steps.appendChild(item);
    }
    const patterns = {
      flat: Array(16).fill(0),
      up: [0, 2, 4, 5, 7, 9, 11, 12, 12, 11, 9, 7, 5, 4, 2, 0],
      trap: [0, 0, 7, 0, 3, 0, 10, 7, 0, 12, 7, 3, 0, -5, 3, 7],
    };
    section.querySelectorAll('[data-pattern]').forEach((button) => button.addEventListener('click', () => {
      patterns[button.dataset.pattern].forEach((value, index) => fx.setParam(`step${index}`, value));
      this.openFxParams(fx);
      this.saveSoon();
    }));
    body.appendChild(section);
  },

  syncRackSurface() {
    this.el('btn-global-infx-toggle').classList.toggle('active', this.engine.inputFxRack.enabled);
    this.engine.tracks.forEach((track, index) => this.renderTrackState(index));
  },

  bindMidi() {
    const dispatch = (actionId, value) => this.executeAction(actionId, value);
    this.midi.onMidiMessage = dispatch;
    this.keyboard.onAction = dispatch;
    this.midi.onInputsChanged = () => this.refreshDevices(false);
    this.midi.onLearnComplete = (mapping) => this.finishLearnAssignment(mapping);
    this.keyboard.onLearnComplete = (mapping) => this.finishLearnAssignment(mapping);
    this.keyboard.onLearnCancelled = () => this.setLearnStatus('SELECT CONTROL');

    this.engine.tracks.forEach((track, index) => {
      this.registerLearnTarget(this.el(`rec-${index}`), `track_${index}_press`, `T${index + 1} REC/PLAY`);
      this.registerLearnTarget(this.el(`stop-${index}`), `track_${index}_stop`, `T${index + 1} STOP`);
      this.registerLearnTarget(this.el(`fader-shell-${index}`), `track_${index}_gain`, `T${index + 1} VOLUME`);
      this.registerLearnTarget(this.el(`mute-${index}`), `track_${index}_mute`, `T${index + 1} MUTE`);
      this.registerLearnTarget(this.el(`solo-${index}`), `track_${index}_solo`, `T${index + 1} SOLO`);
      this.registerLearnTarget(this.el(`monitor-${index}`), `track_${index}_monitor`, `T${index + 1} MONITOR`);
      this.registerLearnTarget(this.el(`undo-${index}`), `track_${index}_undo`, `T${index + 1} UNDO`);
      this.registerLearnTarget(this.el(`redo-${index}`), `track_${index}_redo`, `T${index + 1} REDO`);
    });
    this.registerLearnTarget(this.el('master-gain'), 'master_gain', 'MASTER VOLUME');
    this.registerLearnTarget(this.el('sampler-master-gain'), 'sampler_gain', 'SAMPLER VOLUME');
    this.registerLearnTarget(this.el('btn-play-all'), 'play_all', 'PLAY ALL');
    this.registerLearnTarget(this.el('btn-stop-all'), 'stop_all', 'STOP ALL');
    this.registerLearnTarget(this.el('btn-metro'), 'metro', 'CLICK');
    this.registerLearnTarget(this.el('btn-global-infx-toggle'), 'input_fx', 'INPUT FX');
    this.registerLearnTarget(this.el('btn-all-outfx-toggle'), 'track_fx', 'TRACK FX');

    this.el('btn-learn-pads').addEventListener('click', () => {
      this.samplerSettings = false;
      this.el('btn-sampler-settings').classList.remove('active');
      this.el('sampler-editor').hidden = true;
      this.open('modal-sampler');
      this.renderSamplerPads();
    });
    this.el('btn-learn-remove').addEventListener('click', () => {
      this.learnRemoveMode = !this.learnRemoveMode;
      document.documentElement.classList.toggle('learn-remove', this.learnRemoveMode);
      this.el('btn-learn-remove').classList.toggle('active', this.learnRemoveMode);
      this.clearLearnArmed();
      this.setLearnStatus(this.learnRemoveMode ? 'SELECT MAPPING TO REMOVE' : 'SELECT CONTROL');
    });
    this.el('btn-learn-done').addEventListener('click', () => this.stopLearnMode());
  },

  executeAction(actionId, value) {
      if (actionId.startsWith('fx_')) {
        const [, indexText, kind, slotText] = actionId.split('_');
        const track = this.engine.tracks[Number(indexText)];
        const rack = track && (kind === 'input' ? track.inputFxRack : track.outputFxRack);
        const fx = rack && rack.chain[Number(slotText)];
        if (!fx) return;
        if (Number(fx.params.triggerMode) === 1) fx.setBypass(value <= 0.5);
        else if (value > 0.5) fx.setBypass(!fx.bypassed);
        this.renderQuickFx(Number(indexText));
      } else if (actionId.startsWith('track_')) {
        const [, indexText, action] = actionId.split('_');
        const index = Number(indexText); const track = this.engine.tracks[index]; if (!track) return;
        if (action === 'gain') {
          const fader = value * 1000;
          const gain = this.faderToGain(fader);
          track.setGain(gain);
          this.el(`fader-${index}`).value = fader;
          this.renderFaderPosition(index, fader);
          this.el(`fader-db-${index}`).textContent = this.linearToDb(gain);
        }
        else if (value > 0.5 && action === 'press') track.press();
        else if (value > 0.5 && action === 'stop') track.stop();
        else if (value > 0.5 && action === 'undo') track.undo();
        else if (value > 0.5 && action === 'redo') track.redo();
        else if (value > 0.5 && action === 'mute') { track.setMute(!track.muted); this.renderTrackState(index); }
        else if (value > 0.5 && action === 'solo') { track.setSolo(!track.soloed); this.renderTrackState(index); }
        else if (value > 0.5 && action === 'monitor') { track.setMonitor(!track.monitorEnabled); this.renderTrackState(index); }
      } else if (actionId.startsWith('sampler_') && actionId !== 'sampler_gain') {
        const index = Number(actionId.split('_')[1]);
        if (Number.isInteger(index)) {
          if (value > 0.5) this.engine.sampler.trigger(index);
          else this.engine.sampler.release(index);
        }
      } else if (actionId === 'master_gain') {
        const gain = value * 1.5; this.engine.setMasterGain(gain); this.el('master-gain').value = gain;
      } else if (actionId === 'sampler_gain') {
        const gain = value * 1.5; this.engine.sampler.setMasterGain(gain); this.el('sampler-master-gain').value = gain;
      } else if (value > 0.5 && actionId === 'play_all') this.engine.playAll();
      else if (value > 0.5 && actionId === 'stop_all') this.engine.stopAll();
      else if (value > 0.5 && actionId === 'metro') this.el('btn-metro').click();
      else if (value > 0.5 && actionId === 'input_fx') this.el('btn-global-infx-toggle').click();
      else if (value > 0.5 && actionId === 'track_fx') this.el('btn-all-outfx-toggle').click();
  },

  registerLearnTarget(element, actionId, label) {
    if (!element || this.learnTargets.has(element)) return;
    this.learnTargets.set(element, { actionId, label });
    element.dataset.learnAction = actionId;
    element.dataset.learnLabel = label;
    element.classList.add('learn-target');

    element.addEventListener('pointerdown', (event) => {
      if (!this.learnMode) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      this._learnPointerElement = element;
      this._learnPointerTime = performance.now();
      this.selectLearnTarget(element);
    }, true);
    element.addEventListener('click', (event) => {
      if (!this.learnMode) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      const handledByPointer = this._learnPointerElement === element && performance.now() - this._learnPointerTime < 700;
      if (!handledByPointer) this.selectLearnTarget(element);
    }, true);
  },

  startLearnMode(mode) {
    this.learnMode = mode === 'keyboard' ? 'keyboard' : 'midi';
    this.learnRemoveMode = false;
    this.midi.learnMode = this.learnMode === 'midi';
    this.keyboard.learnMode = this.learnMode === 'keyboard';
    this.midi.cancelLearn();
    this.keyboard.cancelLearn();
    this.close('modal-settings');
    this.el('learn-toolbar').hidden = false;
    this.el('learn-mode-label').textContent = this.learnMode === 'midi' ? 'MIDI LEARN' : 'KEYBOARD LEARN';
    this.el('btn-learn-remove').classList.remove('active');
    document.documentElement.classList.add('learn-active');
    document.documentElement.classList.remove('learn-remove');
    this.el('btn-midi-learn-toggle').classList.toggle('active', this.learnMode === 'midi');
    this.el('btn-keyboard-learn-toggle').classList.toggle('active', this.learnMode === 'keyboard');
    this.el('midi-learn-status').textContent = this.learnMode === 'midi' ? 'ACTIVE' : 'OFF';
    this.el('keyboard-learn-status').textContent = this.learnMode === 'keyboard' ? 'ACTIVE' : 'OFF';
    this.setLearnStatus(this.learnMode === 'midi' && !this.midi.input ? 'NO MIDI INPUT' : 'SELECT CONTROL');
    this.syncLearnTargets();
  },

  stopLearnMode() {
    this.learnMode = null;
    this.learnRemoveMode = false;
    this.midi.learnMode = false;
    this.keyboard.learnMode = false;
    this.midi.cancelLearn();
    this.keyboard.cancelLearn();
    this.clearLearnArmed();
    this.el('learn-toolbar').hidden = true;
    this.el('btn-midi-learn-toggle').classList.remove('active');
    this.el('btn-keyboard-learn-toggle').classList.remove('active');
    this.el('midi-learn-status').textContent = 'OFF';
    this.el('keyboard-learn-status').textContent = 'OFF';
    document.documentElement.classList.remove('learn-active', 'learn-remove');
  },

  selectLearnTarget(element) {
    const target = this.learnTargets.get(element);
    if (!target || !this.learnMode) return;
    if (this.learnRemoveMode) {
      const manager = this.learnMode === 'midi' ? this.midi : this.keyboard;
      const removed = manager.removeAction(target.actionId);
      this.setLearnStatus(removed ? `${target.label} · REMOVED` : `${target.label} · NO MAP`);
      this.syncLearnTargets();
      return;
    }
    this.clearLearnArmed();
    this.learnArmedElement = element;
    element.classList.add('learn-armed');
    if (this.learnMode === 'midi') this.midi.armLearn(target.actionId, target.label);
    else this.keyboard.armLearn(target.actionId, target.label);
    this.setLearnStatus(`${target.label} · ${this.learnMode === 'midi' ? 'MOVE MIDI' : 'PRESS KEY'}`);
  },

  finishLearnAssignment(mapping) {
    this.clearLearnArmed();
    this.setLearnStatus(`${mapping.label} · ${String(mapping.key).toUpperCase()}`);
    this.syncLearnTargets();
  },

  clearLearnArmed() {
    if (this.learnArmedElement) this.learnArmedElement.classList.remove('learn-armed');
    this.learnArmedElement = null;
    this.midi.cancelLearn();
    this.keyboard.cancelLearn();
  },

  setLearnStatus(message) {
    const status = this.el('learn-target-status');
    if (status) status.textContent = message;
  },

  syncLearnTargets() {
    const manager = this.learnMode === 'keyboard' ? this.keyboard : this.midi;
    this.learnTargets.forEach((target, element) => {
      element.classList.toggle('learn-mapped', !!manager && manager.hasAction(target.actionId));
    });
  },

  syncAllControls() {
    this.allOutputFxEnabled = this.engine.tracks.every((track) => track.outputFxRack.enabled);
    this.el('bpm-input').value = this.engine.bpm;
    this.el('metro-level').value = this.engine.metroLevel;
    this.el('master-gain').value = this.engine.masterGain.gain.value;
    this.el('sampler-master-gain').value = this.engine.sampler.masterGain;
    this.el('in-trim-db').value = Math.round(20 * Math.log10(Math.max(0.0001, this.engine.inTrim.gain.value)) * 10) / 10;
    this.el('in-trim-value').textContent = `${this.el('in-trim-db').value} dB`;
    this.el('in-lowcut').value = this.engine.inLowCut.frequency.value;
    this.el('in-lowcut-value').textContent = `${Math.round(this.engine.inLowCut.frequency.value)} Hz`;
    this.el('in-bright').value = this.engine.inAir.gain.value;
    this.el('in-bright-value').textContent = `${this.engine.inAir.gain.value} dB`;
    this.el('tail-duration').value = this.engine.tailReverbDuration;
    this.el('tail-duration-value').textContent = `${this.engine.tailReverbDuration.toFixed(1)} s`;
    this.el('btn-tail-toggle').textContent = this.engine.tailReverbEnabled ? 'TAIL ON' : 'TAIL OFF';
    this.el('btn-tail-toggle').classList.toggle('active', this.engine.tailReverbEnabled);
    this.el('btn-global-infx-toggle').classList.toggle('active', this.engine.inputFxRack.enabled);
    this.el('btn-all-outfx-toggle').classList.toggle('active', this.allOutputFxEnabled);
    this.setSegment('quantize-select', 'quantize', this.engine.quantizeMode);
    this.setSegment('reclen-select', 'reclen', this.engine.recLengthMode === 'BARS' ? String(this.engine.recBars) : 'FREE');
    this.setSegment('mode-select', 'mode', this.engine.recMode);
    this.setSegment('audio-buffer-select', 'buffer', this.engine.audioBufferMode);
    this.setSegment('audio-samplerate-select', 'samplerate', this.engine.sampleRateMode);
    this.updateAudioDiagnostics();
    this.updateOutputDeviceHint();
    this.engine.tracks.forEach((track, index) => {
      this.el(`fader-${index}`).value = this.gainToFader(track._userGain);
      this.renderFaderPosition(index, this.el(`fader-${index}`).value);
      this.el(`fader-db-${index}`).textContent = this.linearToDb(track._userGain);
      this.renderTrackState(index);
    });
    this.renderSamplerPads();
    this.renderMidiMappings();
    this.renderKeyboardMappings();
    if (this.samplerSettings) this.syncSamplerEditor();
  },

  setSegment(id, key, value) {
    document.querySelectorAll(`#${id} .seg-opt`).forEach((button) => button.classList.toggle('active', button.dataset[key] === value));
  },

  updateAudioDiagnostics() {
    const value = this.el('audio-diagnostics');
    if (value && this.engine && this.engine.ctx) value.textContent = this.engine.getAudioDiagnostics();
  },

  updateOutputDeviceHint() {
    const hint = this.el('audio-output-hint');
    const select = this.el('select-audio-output');
    if (!hint || !select || !this.engine) return;
    const supported = this.engine.supportsOutputDeviceSelection();
    hint.hidden = supported;
    select.disabled = !supported;
  },

  saveSoon() {
    clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => {
      try { this.engine.saveSetup(); } catch (error) {}
    }, 350);
  },

  loop() {
    const circumference = 2 * Math.PI * 50;
    const frame = (timestamp) => {
      const interval = this.isIPad ? 50 : (this.engine && this.engine.audioBufferMode === 'SAFE' ? 50 : 33);
      if (timestamp - this._lastUiFrame < interval) {
        requestAnimationFrame(frame);
        return;
      }
      this._lastUiFrame = timestamp;
      const drawWaveforms = timestamp - this._lastWaveFrame >= (this.isIPad ? 66 : 33);
      if (drawWaveforms) this._lastWaveFrame = timestamp;
      if (this.engine && this.engine.ctx) {
        this.el('master-meter-fill').style.setProperty('--level', `${this.levelToPercent(this.engine.getMasterLevel())}%`);
        this.engine.tracks.forEach((track, index) => {
          this.el(`meter-fill-${index}`).style.setProperty('--level', `${this.levelToPercent(track.getMeterLevel())}%`);
          const inputLevel = track.inputPathConnected ? track.getInputLevel() : 0;
          this.el(`input-meter-${index}`).style.setProperty('--level', `${this.levelToPercent(inputLevel)}%`);
          this.el(`ch-time-${index}`).textContent = track.durationSec > 0 ? this.formatTimeMs(track.durationSec) : '0:00.000';
          let progress = 0;
          if (track.state === 'PLAYING' || track.state === 'OVERDUBBING') progress = this.waveforms[index].playhead || 0;
          else if (track.state === 'RECORDING') progress = this.waveforms[index].recRatio || 0;
          this.el(`ring-${index}`).style.strokeDasharray = progress > 0 ? `${Math.max(1, progress * circumference)} ${circumference}` : `1 ${circumference}`;
          this.radialWaveforms[index].setProgress(progress);
          if (drawWaveforms) {
            this.radialWaveforms[index].render();
            if (this.waveforms[index].mode !== 'idle') this.waveforms[index].render();
          }
        });
        if (!this.el('modal-track').hidden) {
          const track = this.engine.tracks[this.activeTrack];
          const level = track.inputPathConnected ? track.getInputLevel() : 0;
          this.el('track-modal-input-fill').style.setProperty('--level', `${this.levelToPercent(level)}%`);
          this.el('track-modal-input-value').textContent = level > 0.00001 ? `${(20 * Math.log10(level)).toFixed(1)} dB` : '-∞ dB';
        }
        if (this.trimWave && !this.el('modal-track').hidden && this.el('track-tab-sample').classList.contains('active')) {
          const track = this.engine.tracks[this.activeTrack];
          const playhead = track.trimStart + this.waveforms[this.activeTrack].playhead * Math.max(0, track.trimEnd - track.trimStart);
          this.trimWave.setPlayhead(playhead);
          if (drawWaveforms) this.trimWave.render();
        }
        if (timestamp - this._lastDiagnostic > 1000) {
          this._lastDiagnostic = timestamp;
          this.updateAudioDiagnostics();
        }
      }
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  },

  linearToDb(value) {
    if (value <= 0.0001) return '−∞ dB';
    const db = 20 * Math.log10(value);
    return `${db >= 0 ? '+' : ''}${db.toFixed(1)} dB`;
  },
  faderToGain(value) {
    const normalized = Math.max(0, Math.min(1, Number(value) / 1000));
    if (normalized <= 0.002) return 0;
    const db = normalized <= 0.75
      ? -60 + (normalized / 0.75) * 60
      : ((normalized - 0.75) / 0.25) * 6;
    return Math.pow(10, db / 20);
  },
  gainToFader(gain) {
    if (gain <= 0.001) return 0;
    const db = Math.max(-60, Math.min(6, 20 * Math.log10(gain)));
    return db <= 0 ? ((db + 60) / 60) * 750 : 750 + (db / 6) * 250;
  },
  levelToPercent(level) {
    if (level <= 0.00001) return 0;
    const db = Math.max(-60, Math.min(0, 20 * Math.log10(level)));
    return Math.max(0, Math.min(100, (db + 60) / 60 * 100));
  },
  panLabel(value) { if (Math.abs(value) < 0.02) return 'C'; return value < 0 ? `L${Math.round(-value * 100)}` : `R${Math.round(value * 100)}`; },
  formatTimeMs(seconds) {
    const minutes = Math.floor(seconds / 60);
    const whole = Math.floor(seconds % 60);
    const ms = Math.floor((seconds - Math.floor(seconds)) * 1000);
    return `${minutes}:${String(whole).padStart(2, '0')}.${String(ms).padStart(3, '0')}`;
  },
  formatParam(value, schema) {
    if (schema.values) return schema.values[Math.max(0, Math.min(schema.values.length - 1, Math.round(value)))] || String(value);
    if (schema.unit === 'note') {
      const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
      const midi = Math.round(value);
      return `${names[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`;
    }
    if (schema.unit === '%' && schema.max <= 1.5) return `${Math.round(value * 100)}%`;
    if (schema.unit === 'Hz') return value >= 1000 ? `${(value / 1000).toFixed(value >= 10000 ? 0 : 1)}k` : `${Math.round(value)} Hz`;
    if (schema.unit === 'ms') return `${Math.round(value * 10) / 10} ms`;
    if (schema.unit === 's') return `${Math.round(value * 1000) / 1000} s`;
    if (schema.unit === 'dB') return `${value > 0 ? '+' : ''}${value} dB`;
    if (schema.unit === 'st') return `${value > 0 ? '+' : ''}${value} st`;
    return String(Math.round(value * 100) / 100);
  },
  downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url; link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  },
  flash(message) { this.el('footer-msg').textContent = message; },
};

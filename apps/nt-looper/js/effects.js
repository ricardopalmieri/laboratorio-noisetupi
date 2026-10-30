// effects.js
// Racks de efeitos baseados em Web Audio API e AudioWorklet.

const NS_FX_CATALOG = [
  { id: 'eq', name: '4-BAND EQ' },
  { id: 'autopan', name: 'AUTO PAN' },
  { id: 'beatrepeat', name: 'BEAT REPEAT', favorite: true },
  { id: 'beat-scatter', name: 'BEAT SCATTER', favorite: true },
  { id: 'beat-shift', name: 'BEAT SHIFT', favorite: true },
  { id: 'chorus', name: 'CHORUS', favorite: true },
  { id: 'compressor', name: 'COMPRESSOR', favorite: true },
  { id: 'delay', name: 'DELAY', favorite: true },
  { id: 'distortion', name: 'DRIVE' },
  { id: 'filter', name: 'FILTER', favorite: true },
  { id: 'flanger', name: 'FLANGER' },
  { id: 'freeze', name: 'FREEZE' },
  { id: 'g2b', name: 'G2B' },
  { id: 'gatereverb', name: 'GATE REVERB' },
  { id: 'harmonizer', name: 'HARMONIZER', favorite: true },
  { id: 'isolator', name: 'ISOLATOR' },
  { id: 'limiter', name: 'LIMITER', favorite: true },
  { id: 'lofi', name: 'LO-FI' },
  { id: 'moddelay', name: 'MOD DELAY' },
  { id: 'octave', name: 'OCTAVE' },
  { id: 'osc-bot', name: 'OSC BOT', favorite: true },
  { id: 'pandelay', name: 'PAN DELAY' },
  { id: 'pattern-slicer', name: 'PATTERN SLICER', favorite: true },
  { id: 'phaser', name: 'PHASER' },
  { id: 'pitchshifter', name: 'PITCH SHIFTER', favorite: true },
  { id: 'preamp', name: 'PREAMP' },
  { id: 'radio', name: 'RADIO' },
  { id: 'reverse-delay', name: 'REVERSE DELAY' },
  { id: 'ringmod', name: 'RING MOD' },
  { id: 'roll', name: 'ROLL' },
  { id: 'slicer', name: 'SLICER' },
  { id: 'slow-gear', name: 'SLOW GEAR' },
  { id: 'step-slicer', name: 'STEP SLICER', favorite: true },
  { id: 'reverb', name: 'STUDIO REVERB', favorite: true },
  { id: 'sustainer', name: 'SUSTAINER' },
  { id: 'synth', name: 'SYNTH' },
  { id: 'tapeecho', name: 'TAPE ECHO', favorite: true },
  { id: 'tremolo', name: 'TREMOLO' },
  { id: 'twist', name: 'TWIST' },
  { id: 'vinyl-flick', name: 'VINYL FLICK', favorite: true },
  { id: 'vocaltuner', name: 'VOCAL TUNER', favorite: true },
  { id: 'warp', name: 'WARP' },
];

const NS_FX_STATUS = Object.freeze({
  stable: new Set(NS_FX_CATALOG.map((item) => item.id)),
  beta: new Set(),
});
NS_FX_CATALOG.forEach((item) => {
  item.status = NS_FX_STATUS.stable.has(item.id) ? 'stable' : NS_FX_STATUS.beta.has(item.id) ? 'beta' : 'broken';
});

const NS_FX_CPU_COST = {
  harmonizer: 5,
  pitchshifter: 5,
  vocaltuner: 5,
  'osc-bot': 3,
  lofi: 2,
  reverb: 2,
  gatereverb: 2,
  tapeecho: 2,
  beatrepeat: 2,
  'beat-scatter': 3, 'beat-shift': 3, 'vinyl-flick': 3, 'pattern-slicer': 2,
  'step-slicer': 2, roll: 2, freeze: 3, warp: 3, twist: 3, synth: 3, g2b: 4, octave: 4,
};

function ns_clamp(value, min, max) {
  return Math.max(min, Math.min(max, Number(value)));
}

function ns_isIPadWebKit() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

function ns_guardWorklet(node, send, wetReturn, fx) {
  let failed = false;
  node.onprocessorerror = () => {
    if (failed) return;
    failed = true;
    fx.processorFailed = true;
    // Um processor rejeitado pelo WebKit não pode silenciar a chain inteira.
    // Mantemos passthrough no caminho wet para que o rack continue utilizável.
    try { send.connect(wetReturn); } catch (error) {}
  };
}

function ns_smooth(param, value, ctx, seconds = 0.018) {
  param.cancelScheduledValues(ctx.currentTime);
  param.setTargetAtTime(value, ctx.currentTime, seconds);
}

function ns_makeStudioImpulse(ctx, duration, decay, tone = 0.58, gated = false) {
  const length = Math.max(128, Math.floor(ctx.sampleRate * duration));
  const impulse = ctx.createBuffer(2, length, ctx.sampleRate);
  let seed = 0x4e545550;
  const random = () => {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    return ((seed >>> 0) / 4294967295) * 2 - 1;
  };
  for (let channel = 0; channel < 2; channel++) {
    const data = impulse.getChannelData(channel);
    let filtered = 0;
    for (let i = 0; i < length; i++) {
      const t = i / length;
      const noise = random();
      filtered += (noise - filtered) * (0.08 + tone * 0.55);
      const shape = gated
        ? (t < 0.82 ? Math.pow(1 - t * 0.55, 0.7) : Math.pow((1 - t) / 0.18, 2.5))
        : Math.pow(1 - t, decay);
      const attack = Math.min(1, i / Math.max(1, ctx.sampleRate * 0.008));
      data[i] = (noise * 0.58 + filtered * 0.42) * shape * attack * (channel ? 0.96 : 1);
    }
  }
  return impulse;
}

function ns_makeDriveCurve(amount, type = 2) {
  const size = 65536;
  const curve = new Float32Array(size);
  const mode = Math.max(0, Math.min(5, Math.round(type)));
  const drive = 1 + ns_clamp(amount, 0, 1) * [8, 12, 22, 34, 48, 62][mode];
  for (let i = 0; i < size; i++) {
    const x = i * 2 / (size - 1) - 1;
    let value;
    if (mode === 0) value = Math.tanh((x + 0.035 * x * x) * drive) / Math.tanh(drive);
    else if (mode === 1) value = Math.tanh(x * drive * 0.55) / Math.tanh(drive * 0.55);
    else if (mode === 2) value = Math.atan((x + 0.085 * x * x) * drive) / Math.atan(drive);
    else if (mode === 3) value = Math.max(-1, Math.min(1, x * drive * 0.42));
    else if (mode === 4) value = Math.tanh(Math.max(-1.2, Math.min(1.2, x * drive * 0.7)) * 2.4);
    else value = Math.tanh((x + 0.12) * drive * 1.35) - Math.tanh(0.12 * drive * 1.35);
    curve[i] = Math.max(-1, Math.min(1, value));
  }
  return curve;
}

function ns_createFxShell(ctx, id, mix) {
  const input = ctx.createGain();
  const output = ctx.createGain();
  const dry = ctx.createGain();
  const send = ctx.createGain();
  const wet = ctx.createGain();
  const wetReturn = ctx.createGain();
  input.connect(dry).connect(output);
  input.connect(send);
  wetReturn.connect(wet).connect(output);

  const fx = {
    id,
    input,
    output,
    params: { mix },
    bypassed: false,
    _nodes: { dry, send, wet, wetReturn },
    _sources: [],
    _mix: mix,
    _dryInputScale: 1,
    onBypassChange: null,
    onRoutingChange: null,
    onLatencyChange: null,
    latencySamples: 0,
  };

  fx.applyMix = () => {
    const amount = fx.bypassed ? 0 : ns_clamp(fx._mix, 0, 1);
    const dryScale = fx.bypassed ? 1 : fx._dryInputScale;
    ns_smooth(dry.gain, Math.cos(amount * Math.PI * 0.5) * dryScale, ctx);
    ns_smooth(wet.gain, Math.sin(amount * Math.PI * 0.5), ctx);
  };
  fx.setMix = (value) => {
    fx._mix = ns_clamp(value, 0, 1);
    fx.params.mix = fx._mix;
    fx.applyMix();
  };
  fx.setBypass = (value) => {
    const changed = fx.bypassed !== !!value;
    fx.bypassed = !!value;
    fx.applyMix();
    if (changed && fx.onBypassChange) fx.onBypassChange(fx.bypassed);
  };
  fx.dispose = () => {
    fx._sources.forEach((source) => { try { source.stop(); } catch (error) {} });
    Object.values(fx._nodes).flat().forEach((node) => { try { if (node && node.disconnect) node.disconnect(); } catch (error) {} });
    try { input.disconnect(); } catch (error) {}
    try { output.disconnect(); } catch (error) {}
  };
  fx.applyMix();
  return fx;
}

function ns_createEffect(ctx, typeId) {
  const defaultMix = {
    reverb: 0.28, gatereverb: 0.32, delay: 0.3, pandelay: 0.32, tapeecho: 0.3,
    chorus: 0.34, flanger: 0.4, phaser: 0.48, harmonizer: 0.36,
    distortion: 0.45, ringmod: 0.4, lofi: 0.55, beatrepeat: 0.5,
    'osc-bot': 0.5, vocaltuner: 0.72,
  }[typeId] ?? 1;
  const fx = ns_createFxShell(ctx, typeId, defaultMix);
  const send = fx._nodes.send;
  const wetReturn = fx._nodes.wetReturn;
  const remember = (nodes) => Object.assign(fx._nodes, nodes);
  const source = (node) => { fx._sources.push(node); return node; };

  switch (typeId) {
    case 'reverb': {
      const predelay = ctx.createDelay(0.2);
      const earlyA = ctx.createDelay(0.2);
      const earlyB = ctx.createDelay(0.2);
      const earlyPanA = ctx.createStereoPanner();
      const earlyPanB = ctx.createStereoPanner();
      const earlyGain = ctx.createGain();
      const convolver = ctx.createConvolver();
      const tone = ctx.createBiquadFilter();
      predelay.delayTime.value = 0.018;
      earlyA.delayTime.value = 0.029;
      earlyB.delayTime.value = 0.043;
      earlyPanA.pan.value = -0.55;
      earlyPanB.pan.value = 0.55;
      earlyGain.gain.value = 0.22;
      tone.type = 'lowpass'; tone.frequency.value = 9200; tone.Q.value = 0.3;
      convolver.buffer = ns_makeStudioImpulse(ctx, 2.4, 3.2, 0.58);
      send.connect(predelay);
      predelay.connect(convolver).connect(tone).connect(wetReturn);
      predelay.connect(earlyA).connect(earlyPanA).connect(earlyGain).connect(wetReturn);
      predelay.connect(earlyB).connect(earlyPanB).connect(earlyGain);
      fx.params = { mix: defaultMix, size: 2.4, decay: 3.2, predelay: 18, tone: 9200 };
      let rebuildTimer = 0;
      const rebuild = () => {
        clearTimeout(rebuildTimer);
        rebuildTimer = setTimeout(() => {
          convolver.buffer = ns_makeStudioImpulse(ctx, fx.params.size, fx.params.decay, fx.params.tone / 16000);
        }, 90);
      };
      fx.setParam = (id, value) => {
        if (id === 'mix') fx.setMix(value);
        if (id === 'size') { fx.params.size = ns_clamp(value, 0.35, 7); rebuild(); }
        if (id === 'decay') { fx.params.decay = ns_clamp(value, 0.8, 7); rebuild(); }
        if (id === 'predelay') { fx.params.predelay = value; ns_smooth(predelay.delayTime, value / 1000, ctx); }
        if (id === 'tone') { fx.params.tone = value; ns_smooth(tone.frequency, value, ctx); rebuild(); }
      };
      remember({ predelay, earlyA, earlyB, earlyPanA, earlyPanB, earlyGain, convolver, tone });
      break;
    }

    case 'gatereverb': {
      const convolver = ctx.createConvolver();
      const tone = ctx.createBiquadFilter();
      tone.type = 'lowpass'; tone.frequency.value = 6800;
      convolver.buffer = ns_makeStudioImpulse(ctx, 0.55, 0.9, 0.5, true);
      send.connect(convolver).connect(tone).connect(wetReturn);
      fx.params = { mix: defaultMix, time: 0.55, tone: 6800 };
      let timer = 0;
      const rebuild = () => {
        clearTimeout(timer);
        timer = setTimeout(() => { convolver.buffer = ns_makeStudioImpulse(ctx, fx.params.time, 0.9, fx.params.tone / 14000, true); }, 80);
      };
      fx.setParam = (id, value) => {
        if (id === 'mix') fx.setMix(value);
        if (id === 'time') { fx.params.time = value; rebuild(); }
        if (id === 'tone') { fx.params.tone = value; ns_smooth(tone.frequency, value, ctx); rebuild(); }
      };
      remember({ convolver, tone });
      break;
    }

    case 'delay':
    case 'tapeecho': {
      const delay = ctx.createDelay(2.5);
      const feedback = ctx.createGain();
      const highpass = ctx.createBiquadFilter();
      const tone = ctx.createBiquadFilter();
      const saturation = ctx.createWaveShaper();
      delay.delayTime.value = typeId === 'tapeecho' ? 0.32 : 0.375;
      feedback.gain.value = typeId === 'tapeecho' ? 0.42 : 0.34;
      highpass.type = 'highpass'; highpass.frequency.value = 90;
      tone.type = 'lowpass'; tone.frequency.value = typeId === 'tapeecho' ? 3600 : 7800;
      saturation.curve = ns_makeDriveCurve(typeId === 'tapeecho' ? 0.1 : 0.02, 0.03);
      saturation.oversample = '2x';
      send.connect(delay);
      delay.connect(highpass).connect(tone).connect(saturation).connect(feedback).connect(delay);
      delay.connect(wetReturn);
      let wow = null;
      let wowDepth = null;
      if (typeId === 'tapeecho') {
        wow = source(ctx.createOscillator());
        wowDepth = ctx.createGain();
        wow.frequency.value = 0.72; wowDepth.gain.value = 0.0022;
        wow.connect(wowDepth).connect(delay.delayTime); wow.start();
      }
      fx.params = typeId === 'tapeecho'
        ? { mix: defaultMix, time: 0.32, bpm: 120, sync: 0, division: 4, feedback: 0.42, lowCut: 90, highCut: 3600, wow: 2.2, flutter: 0.6, drive: 0.1 }
        : { mix: defaultMix, time: 0.375, bpm: 120, sync: 0, division: 4, feedback: 0.34, lowCut: 90, highCut: 7800 };
      const syncDelay = () => { if (fx.params.sync) ns_smooth(delay.delayTime, 60 / Math.max(30, fx.params.bpm) * 4 / Math.max(1, fx.params.division), ctx, 0.03); };
      fx.setParam = (id, value) => {
        if (id === 'mix') fx.setMix(value);
        if (id === 'time') { fx.params.time = value; if (!fx.params.sync) ns_smooth(delay.delayTime, value, ctx, 0.03); }
        if (id === 'bpm' || id === 'division' || id === 'sync') { fx.params[id] = value; syncDelay(); }
        if (id === 'feedback') { fx.params.feedback = value; ns_smooth(feedback.gain, Math.min(0.92, value), ctx); }
        if (id === 'lowCut') { fx.params.lowCut = value; ns_smooth(highpass.frequency, value, ctx); }
        if (id === 'highCut') { fx.params.highCut = value; ns_smooth(tone.frequency, value, ctx); }
        if (id === 'wow' && wowDepth) { fx.params.wow = value; ns_smooth(wowDepth.gain, value / 1000, ctx); }
        if (id === 'drive') { fx.params.drive = value; saturation.curve = ns_makeDriveCurve(value, 0.05); }
      };
      remember({ delay, feedback, highpass, tone, saturation, wow, wowDepth });
      break;
    }

    case 'pandelay': {
      const delayL = ctx.createDelay(2);
      const delayR = ctx.createDelay(2);
      const panL = ctx.createStereoPanner();
      const panR = ctx.createStereoPanner();
      const feedbackL = ctx.createGain();
      const feedbackR = ctx.createGain();
      const toneL = ctx.createBiquadFilter();
      const toneR = ctx.createBiquadFilter();
      delayL.delayTime.value = 0.25; delayR.delayTime.value = 0.375;
      panL.pan.value = -0.86; panR.pan.value = 0.86;
      feedbackL.gain.value = 0.32; feedbackR.gain.value = 0.32;
      toneL.type = toneR.type = 'lowpass'; toneL.frequency.value = toneR.frequency.value = 6200;
      send.connect(delayL); send.connect(delayR);
      delayL.connect(panL).connect(wetReturn); delayR.connect(panR).connect(wetReturn);
      delayL.connect(toneL).connect(feedbackL).connect(delayR);
      delayR.connect(toneR).connect(feedbackR).connect(delayL);
      fx.params = { mix: defaultMix, time: 0.25, spread: 1.5, feedback: 0.32, tone: 6200 };
      fx.setParam = (id, value) => {
        if (id === 'mix') fx.setMix(value);
        if (id === 'time') { fx.params.time = value; ns_smooth(delayL.delayTime, value, ctx); ns_smooth(delayR.delayTime, value * fx.params.spread, ctx); }
        if (id === 'spread') { fx.params.spread = value; ns_smooth(delayR.delayTime, fx.params.time * value, ctx); }
        if (id === 'feedback') { fx.params.feedback = value; ns_smooth(feedbackL.gain, value, ctx); ns_smooth(feedbackR.gain, value, ctx); }
        if (id === 'tone') { fx.params.tone = value; ns_smooth(toneL.frequency, value, ctx); ns_smooth(toneR.frequency, value, ctx); }
      };
      remember({ delayL, delayR, panL, panR, feedbackL, feedbackR, toneL, toneR });
      break;
    }

    case 'chorus': {
      const delayL = ctx.createDelay(0.08);
      const delayR = ctx.createDelay(0.08);
      const panL = ctx.createStereoPanner();
      const panR = ctx.createStereoPanner();
      const lfo = source(ctx.createOscillator());
      const depthL = ctx.createGain();
      const depthR = ctx.createGain();
      delayL.delayTime.value = delayR.delayTime.value = 0.018;
      panL.pan.value = -0.72; panR.pan.value = 0.72;
      lfo.frequency.value = 0.72;
      depthL.gain.value = 0.005; depthR.gain.value = -0.005;
      lfo.connect(depthL).connect(delayL.delayTime);
      lfo.connect(depthR).connect(delayR.delayTime);
      send.connect(delayL).connect(panL).connect(wetReturn);
      send.connect(delayR).connect(panR).connect(wetReturn);
      lfo.start();
      fx.params = { mix: defaultMix, rate: 0.72, depth: 5, width: 0.72 };
      fx.setParam = (id, value) => {
        if (id === 'mix') fx.setMix(value);
        if (id === 'rate') { fx.params.rate = value; ns_smooth(lfo.frequency, value, ctx); }
        if (id === 'depth') { fx.params.depth = value; ns_smooth(depthL.gain, value / 1000, ctx); ns_smooth(depthR.gain, -value / 1000, ctx); }
        if (id === 'width') { fx.params.width = value; ns_smooth(panL.pan, -value, ctx); ns_smooth(panR.pan, value, ctx); }
      };
      remember({ delayL, delayR, panL, panR, lfo, depthL, depthR });
      break;
    }

    case 'flanger': {
      const delay = ctx.createDelay(0.03);
      const feedback = ctx.createGain();
      const lfo = source(ctx.createOscillator());
      const depth = ctx.createGain();
      delay.delayTime.value = 0.004; feedback.gain.value = 0.45;
      lfo.frequency.value = 0.28; depth.gain.value = 0.0028;
      lfo.connect(depth).connect(delay.delayTime);
      send.connect(delay).connect(wetReturn);
      delay.connect(feedback).connect(delay);
      lfo.start();
      fx.params = { mix: defaultMix, rate: 0.28, depth: 2.8, feedback: 0.45 };
      fx.setParam = (id, value) => {
        if (id === 'mix') fx.setMix(value);
        if (id === 'rate') { fx.params.rate = value; ns_smooth(lfo.frequency, value, ctx); }
        if (id === 'depth') { fx.params.depth = value; ns_smooth(depth.gain, value / 1000, ctx); }
        if (id === 'feedback') { fx.params.feedback = value; ns_smooth(feedback.gain, value, ctx); }
      };
      remember({ delay, feedback, lfo, depth });
      break;
    }

    case 'phaser': {
      const stages = [];
      let previous = send;
      for (let i = 0; i < 6; i++) {
        const stage = ctx.createBiquadFilter();
        stage.type = 'allpass'; stage.frequency.value = 650 + i * 120; stage.Q.value = 0.72;
        previous.connect(stage); previous = stage; stages.push(stage);
      }
      const lfo = source(ctx.createOscillator());
      const depth = ctx.createGain();
      lfo.frequency.value = 0.34; depth.gain.value = 760;
      lfo.connect(depth); stages.forEach((stage) => depth.connect(stage.frequency));
      previous.connect(wetReturn); lfo.start();
      fx.params = { mix: defaultMix, rate: 0.34, depth: 760, resonance: 0.72 };
      fx.setParam = (id, value) => {
        if (id === 'mix') fx.setMix(value);
        if (id === 'rate') { fx.params.rate = value; ns_smooth(lfo.frequency, value, ctx); }
        if (id === 'depth') { fx.params.depth = value; ns_smooth(depth.gain, value, ctx); }
        if (id === 'resonance') { fx.params.resonance = value; stages.forEach((stage) => ns_smooth(stage.Q, value, ctx)); }
      };
      remember({ stages, lfo, depth });
      break;
    }

    case 'tremolo': {
      const amp = ctx.createGain();
      const lfo = source(ctx.createOscillator());
      const depth = ctx.createGain();
      const offset = source(ctx.createConstantSource());
      lfo.frequency.value = 4.5; depth.gain.value = 0.42; offset.offset.value = 0.58;
      lfo.connect(depth).connect(amp.gain); offset.connect(amp.gain);
      send.connect(amp).connect(wetReturn); lfo.start(); offset.start();
      fx.params = { mix: 1, rate: 4.5, depth: 0.84 };
      fx.setParam = (id, value) => {
        if (id === 'rate') { fx.params.rate = value; ns_smooth(lfo.frequency, value, ctx); }
        if (id === 'depth') { fx.params.depth = value; ns_smooth(depth.gain, value * 0.5, ctx); ns_smooth(offset.offset, 1 - value * 0.5, ctx); }
      };
      remember({ amp, lfo, depth, offset });
      break;
    }

    case 'autopan': {
      const pan = ctx.createStereoPanner();
      const lfo = source(ctx.createOscillator());
      const depth = ctx.createGain();
      lfo.frequency.value = 0.8; depth.gain.value = 0.82;
      lfo.connect(depth).connect(pan.pan);
      send.connect(pan).connect(wetReturn); lfo.start();
      fx.params = { mix: 1, rate: 0.8, depth: 0.82 };
      fx.setParam = (id, value) => {
        if (id === 'rate') { fx.params.rate = value; ns_smooth(lfo.frequency, value, ctx); }
        if (id === 'depth') { fx.params.depth = value; ns_smooth(depth.gain, value, ctx); }
      };
      remember({ pan, lfo, depth });
      break;
    }

    case 'harmonizer': {
      const lowLatency = ns_isIPadWebKit();
      const harmonyWindow = lowLatency ? 46 : 64;
      const pitch = new AudioWorkletNode(ctx, 'ns-granular-pitch', {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [2],
        channelCount: 2,
        channelCountMode: 'explicit',
        channelInterpretation: 'speakers',
        processorOptions: { lowLatency },
      });
      wetReturn.gain.value = 1.15;
      send.connect(pitch).connect(wetReturn);
      ns_guardWorklet(pitch, send, wetReturn, fx);
      fx.params = { mix: defaultMix, dryInput: 1, level: 1.15, voice1: 7, voice2: 12, balance: 0.28, window: harmonyWindow, tone: 9000, harmonyMode: 1, root: 0, scale: 1, degree1: 2, degree2: 4, tracking: 0.75 };
      fx.latencySamples = Math.round(ctx.sampleRate * harmonyWindow / 2000) + 16;
      Object.entries(fx.params).forEach(([id, value]) => { if (!['mix', 'dryInput', 'level'].includes(id)) pitch.port.postMessage({ type: 'param', id, value }); });
      fx.setParam = (id, value) => {
        if (id === 'mix') fx.setMix(value);
        else if (id === 'dryInput') { fx.params.dryInput = value; fx._dryInputScale = value >= 0.5 ? 1 : 0; fx.applyMix(); }
        else if (id === 'level') { fx.params.level = value; ns_smooth(wetReturn.gain, value, ctx); }
        else if (Object.prototype.hasOwnProperty.call(fx.params, id)) {
          fx.params[id] = value;
          pitch.port.postMessage({ type: 'param', id, value });
          if (id === 'window') { fx.latencySamples = Math.round(ctx.sampleRate * value / 2000) + 16; if (fx.onLatencyChange) fx.onLatencyChange(); }
        }
      };
      remember({ pitch });
      break;
    }

    case 'pitchshifter': {
      const lowLatency = ns_isIPadWebKit();
      const pitchWindow = lowLatency ? 46 : 64;
      const pitch = new AudioWorkletNode(ctx, 'ns-granular-pitch', {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [2],
        channelCount: 2,
        channelCountMode: 'explicit',
        channelInterpretation: 'speakers',
        processorOptions: { lowLatency },
      });
      send.connect(pitch).connect(wetReturn);
      ns_guardWorklet(pitch, send, wetReturn, fx);
      fx.params = { mix: 1, dryInput: 1, level: 1, shift: 0, quality: pitchWindow, tone: 11000 };
      fx.latencySamples = Math.round(ctx.sampleRate * pitchWindow / 2000) + 16;
      pitch.port.postMessage({ type: 'param', id: 'voice1', value: 0 });
      pitch.port.postMessage({ type: 'param', id: 'voice2', value: 0 });
      pitch.port.postMessage({ type: 'param', id: 'balance', value: 0 });
      pitch.port.postMessage({ type: 'param', id: 'window', value: pitchWindow });
      pitch.port.postMessage({ type: 'param', id: 'tone', value: 11000 });
      fx.setParam = (id, value) => {
        if (id === 'mix') fx.setMix(value);
        else if (id === 'dryInput') { fx.params.dryInput = value; fx._dryInputScale = value >= 0.5 ? 1 : 0; fx.applyMix(); }
        else if (id === 'level') { fx.params.level = value; ns_smooth(wetReturn.gain, value, ctx); }
        else if (id === 'shift') {
          fx.params.shift = value;
          pitch.port.postMessage({ type: 'param', id: 'voice1', value });
          pitch.port.postMessage({ type: 'param', id: 'voice2', value });
        } else if (id === 'quality') {
          fx.params.quality = value;
          pitch.port.postMessage({ type: 'param', id: 'window', value });
          fx.latencySamples = Math.round(ctx.sampleRate * value / 2000) + 16;
          if (fx.onLatencyChange) fx.onLatencyChange();
        } else if (id === 'tone') {
          fx.params.tone = value;
          pitch.port.postMessage({ type: 'param', id: 'tone', value });
        }
      };
      remember({ pitch });
      break;
    }

    case 'osc-bot': {
      const bot = new AudioWorkletNode(ctx, 'ns-osc-bot', {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [2],
        channelCount: 2,
        channelCountMode: 'explicit',
        channelInterpretation: 'speakers',
      });
      send.connect(bot).connect(wetReturn);
      ns_guardWorklet(bot, send, wetReturn, fx);
      fx.params = {
        mix: defaultMix, dryInput: 1, wave: 0, tone: 0, attack: 50, note: 36, sens: 0, balance: 0.7,
        seqOn: 1, seqSync: 1, seqRate: 2, seqSteps: 16, seqGate: 0.68, bpm: 120, transportOriginFrame: 0,
        step0: 0, step1: 0, step2: 7, step3: 0, step4: 3, step5: 0, step6: 10, step7: 7,
        step8: 0, step9: 12, step10: 7, step11: 3, step12: 0, step13: -5, step14: 3, step15: 7,
      };
      fx.setParam = (id, value) => {
        if (id === 'mix') fx.setMix(value);
        else if (Object.prototype.hasOwnProperty.call(fx.params, id)) {
          fx.params[id] = value;
          if (id === 'dryInput') {
            fx._dryInputScale = value >= 0.5 ? 1 : 0;
            fx.applyMix();
            if (fx.onRoutingChange) fx.onRoutingChange();
          }
          bot.port.postMessage({ type: 'param', id, value });
        }
      };
      remember({ bot });
      break;
    }

    case 'vocaltuner': {
      const lowLatency = ns_isIPadWebKit();
      const tuner = new AudioWorkletNode(ctx, 'ns-vocal-tuner', {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [2],
        channelCount: 2,
        channelCountMode: 'explicit',
        channelInterpretation: 'speakers',
        processorOptions: { lowLatency },
      });
      send.connect(tuner).connect(wetReturn);
      ns_guardWorklet(tuner, send, wetReturn, fx);
      fx.params = { mix: defaultMix, dryInput: 1, shift: 0, formant: 0, speed: 9, stability: 0, mode: 0, root: 0, scale: 1, robotNote: 0, amount: 1 };
      fx.latencySamples = Math.round(ctx.sampleRate * (lowLatency ? 0.019 : 0.025)) + 32;
      fx.setParam = (id, value) => {
        if (id === 'mix') fx.setMix(value);
        else if (id === 'dryInput') { fx.params.dryInput = value; fx._dryInputScale = value >= 0.5 ? 1 : 0; fx.applyMix(); }
        else if (Object.prototype.hasOwnProperty.call(fx.params, id)) {
          fx.params[id] = value;
          tuner.port.postMessage({ type: 'param', id, value });
        }
      };
      remember({ tuner });
      break;
    }

    case 'filter': {
      const drive = ctx.createWaveShaper();
      const filter = ctx.createBiquadFilter();
      drive.curve = ns_makeDriveCurve(0.04); drive.oversample = '2x';
      filter.type = 'lowpass'; filter.frequency.value = 4200; filter.Q.value = 1.2;
      send.connect(drive).connect(filter).connect(wetReturn);
      fx.params = { mix: 1, cutoff: 4200, resonance: 1.2, drive: 0.04 };
      fx.setParam = (id, value) => {
        if (id === 'cutoff') { fx.params.cutoff = value; ns_smooth(filter.frequency, value, ctx); }
        if (id === 'resonance') { fx.params.resonance = value; ns_smooth(filter.Q, value, ctx); }
        if (id === 'drive') { fx.params.drive = value; drive.curve = ns_makeDriveCurve(value); }
      };
      remember({ drive, filter });
      break;
    }

    case 'eq': {
      const low = ctx.createBiquadFilter();
      const lowMid = ctx.createBiquadFilter();
      const highMid = ctx.createBiquadFilter();
      const high = ctx.createBiquadFilter();
      low.type = 'lowshelf'; low.frequency.value = 120;
      lowMid.type = 'peaking'; lowMid.frequency.value = 480; lowMid.Q.value = 0.85;
      highMid.type = 'peaking'; highMid.frequency.value = 2600; highMid.Q.value = 0.85;
      high.type = 'highshelf'; high.frequency.value = 7200;
      send.connect(low).connect(lowMid).connect(highMid).connect(high).connect(wetReturn);
      fx.params = { mix: 1, low: 0, lowmid: 0, highmid: 0, high: 0 };
      fx.setParam = (id, value) => {
        const map = { low, lowmid: lowMid, highmid: highMid, high };
        if (map[id]) { fx.params[id] = value; ns_smooth(map[id].gain, value, ctx); }
      };
      remember({ low, lowMid, highMid, high });
      break;
    }

    case 'isolator': {
      const low = ctx.createBiquadFilter();
      const midHigh = ctx.createBiquadFilter();
      const midLow = ctx.createBiquadFilter();
      const high = ctx.createBiquadFilter();
      const gainLow = ctx.createGain();
      const gainMid = ctx.createGain();
      const gainHigh = ctx.createGain();
      low.type = 'lowpass'; low.frequency.value = 220; low.Q.value = 0.7;
      midHigh.type = 'highpass'; midHigh.frequency.value = 180; midHigh.Q.value = 0.7;
      midLow.type = 'lowpass'; midLow.frequency.value = 4200; midLow.Q.value = 0.7;
      high.type = 'highpass'; high.frequency.value = 3600; high.Q.value = 0.7;
      send.connect(low).connect(gainLow).connect(wetReturn);
      send.connect(midHigh).connect(midLow).connect(gainMid).connect(wetReturn);
      send.connect(high).connect(gainHigh).connect(wetReturn);
      fx.params = { mix: 1, low: 1, mid: 1, high: 1 };
      fx.setParam = (id, value) => {
        const map = { low: gainLow, mid: gainMid, high: gainHigh };
        if (map[id]) { fx.params[id] = value; ns_smooth(map[id].gain, value, ctx); }
      };
      remember({ low, midHigh, midLow, high, gainLow, gainMid, gainHigh });
      break;
    }

    case 'compressor': {
      const compressor = ctx.createDynamicsCompressor();
      const makeup = ctx.createGain();
      compressor.threshold.value = -20; compressor.knee.value = 9; compressor.ratio.value = 4;
      compressor.attack.value = 0.008; compressor.release.value = 0.16; makeup.gain.value = 1.25;
      send.connect(compressor).connect(makeup).connect(wetReturn);
      fx.params = { mix: 1, threshold: -20, ratio: 4, attack: 8, release: 160, makeup: 1.25 };
      fx.setParam = (id, value) => {
        if (id === 'threshold') { fx.params.threshold = value; ns_smooth(compressor.threshold, value, ctx); }
        if (id === 'ratio') { fx.params.ratio = value; ns_smooth(compressor.ratio, value, ctx); }
        if (id === 'attack') { fx.params.attack = value; ns_smooth(compressor.attack, value / 1000, ctx); }
        if (id === 'release') { fx.params.release = value; ns_smooth(compressor.release, value / 1000, ctx); }
        if (id === 'makeup') { fx.params.makeup = value; ns_smooth(makeup.gain, value, ctx); }
      };
      remember({ compressor, makeup });
      break;
    }

    case 'limiter': {
      const inputGain = ctx.createGain();
      const limiter = ctx.createDynamicsCompressor();
      limiter.threshold.value = -1;
      limiter.knee.value = 0;
      limiter.ratio.value = 20;
      limiter.attack.value = 0.001;
      limiter.release.value = 0.08;
      send.connect(inputGain).connect(limiter).connect(wetReturn);
      fx.params = { mix: 1, ceiling: -1, release: 80, input: 1 };
      fx.setParam = (id, value) => {
        if (id === 'ceiling') { fx.params.ceiling = value; ns_smooth(limiter.threshold, value, ctx); }
        if (id === 'release') { fx.params.release = value; ns_smooth(limiter.release, value / 1000, ctx); }
        if (id === 'input') { fx.params.input = value; ns_smooth(inputGain.gain, value, ctx); }
      };
      remember({ inputGain, limiter });
      break;
    }

    case 'distortion': {
      const preGain = ctx.createGain();
      const highpass = ctx.createBiquadFilter();
      const shaper = ctx.createWaveShaper();
      const tone = ctx.createBiquadFilter();
      const safety = ctx.createWaveShaper();
      const trim = ctx.createGain();
      highpass.type = 'highpass'; highpass.frequency.value = 45;
      shaper.curve = ns_makeDriveCurve(0.24, 2); shaper.oversample = '4x';
      tone.type = 'lowpass'; tone.frequency.value = 6200;
      trim.gain.value = 0.62;
      safety.curve = ns_makeDriveCurve(0.05, 0); safety.oversample = '2x';
      send.connect(preGain).connect(highpass).connect(shaper).connect(tone).connect(safety).connect(trim).connect(wetReturn);
      fx.params = { mix: defaultMix, type: 2, drive: 0.24, tone: 6200, level: 0.62 };
      const updateDrive = () => {
        const type = Math.max(0, Math.min(5, Math.round(fx.params.type)));
        const drive = ns_clamp(fx.params.drive, 0, 1);
        shaper.curve = ns_makeDriveCurve(drive, type);
        preGain.gain.setTargetAtTime(1 + drive * [0.7, 1.2, 2.2, 3.2, 4.2, 5.2][type], ctx.currentTime, 0.012);
        highpass.frequency.setTargetAtTime([70, 35, 55, 75, 95, 120][type], ctx.currentTime, 0.018);
      };
      fx.setParam = (id, value) => {
        if (id === 'mix') fx.setMix(value);
        if (id === 'type') { fx.params.type = value; updateDrive(); }
        if (id === 'drive') { fx.params.drive = value; updateDrive(); }
        if (id === 'tone') { fx.params.tone = value; ns_smooth(tone.frequency, value, ctx); }
        if (id === 'level') { fx.params.level = value; ns_smooth(trim.gain, value, ctx); }
      };
      updateDrive();
      remember({ preGain, highpass, shaper, tone, safety, trim });
      break;
    }

    case 'ringmod': {
      const ring = ctx.createGain();
      const oscillator = source(ctx.createOscillator());
      oscillator.frequency.value = 220; ring.gain.value = 0;
      oscillator.connect(ring.gain); send.connect(ring).connect(wetReturn); oscillator.start();
      fx.params = { mix: defaultMix, freq: 220, bpm: 120, sync: 0, division: 4 };
      const syncRing = () => { if (fx.params.sync) ns_smooth(oscillator.frequency, Math.max(0.1, fx.params.bpm / 60 * fx.params.division / 4), ctx); };
      fx.setParam = (id, value) => {
        if (id === 'mix') fx.setMix(value);
        if (id === 'freq') { fx.params.freq = value; if (!fx.params.sync) ns_smooth(oscillator.frequency, value, ctx); }
        if (id === 'bpm' || id === 'sync' || id === 'division') { fx.params[id] = value; syncRing(); }
      };
      remember({ ring, oscillator });
      break;
    }

    case 'lofi': {
      const crusher = new AudioWorkletNode(ctx, 'ns-bitcrusher', {
        numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2], channelCount: 2,
        channelCountMode: 'explicit', channelInterpretation: 'speakers',
      });
      const tone = ctx.createBiquadFilter();
      tone.type = 'lowpass'; tone.frequency.value = 5200; tone.Q.value = 0.5;
      send.connect(crusher).connect(tone).connect(wetReturn);
      ns_guardWorklet(crusher, send, wetReturn, fx);
      fx.params = { mix: defaultMix, bits: 10, reduction: 3, jitter: 0, tone: 5200 };
      fx.setParam = (id, value) => {
        if (id === 'mix') fx.setMix(value);
        else if (id === 'tone') { fx.params.tone = value; ns_smooth(tone.frequency, value, ctx); }
        else { fx.params[id] = value; crusher.port.postMessage({ type: 'param', id, value }); }
      };
      remember({ crusher, tone });
      break;
    }

    case 'slicer': {
      const gate = ctx.createGain();
      const lfo = source(ctx.createOscillator());
      const depth = ctx.createGain();
      const offset = source(ctx.createConstantSource());
      lfo.type = 'square'; lfo.frequency.value = 8;
      depth.gain.value = 0.48; offset.offset.value = 0.52;
      lfo.connect(depth).connect(gate.gain); offset.connect(gate.gain);
      send.connect(gate).connect(wetReturn); lfo.start(); offset.start();
      fx.params = { mix: 1, rate: 8, depth: 0.96 };
      fx.setParam = (id, value) => {
        if (id === 'rate') { fx.params.rate = value; ns_smooth(lfo.frequency, value, ctx); }
        if (id === 'depth') { fx.params.depth = value; ns_smooth(depth.gain, value * 0.5, ctx); ns_smooth(offset.offset, 1 - value * 0.5, ctx); }
      };
      remember({ gate, lfo, depth, offset });
      break;
    }

    case 'beatrepeat': {
      const processor = new AudioWorkletNode(ctx, 'ns-beat-repeat', {
        numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2],
        channelCount: 2, channelCountMode: 'explicit', channelInterpretation: 'speakers',
        processorOptions: { defaults: { bpm: 120, division: 16 }, maxBufferSeconds: ns_isIPadWebKit() ? 4 : 7 },
      });
      send.connect(processor).connect(wetReturn);
      ns_guardWorklet(processor, send, wetReturn, fx);
      fx.params = { mix: defaultMix, bpm: 120, transportOriginFrame: 0, division: 16, direction: 0, quantize: 1, gate: 1, feedback: 0.45, triggerMode: 0 };
      fx.setParam = (id, value) => {
        if (id === 'mix') fx.setMix(value);
        else { fx.params[id] = value; processor.port.postMessage({ type: 'param', id, value }); }
      };
      remember({ processor });
      break;
    }

    case 'beat-scatter': case 'beat-shift': case 'vinyl-flick': case 'pattern-slicer': case 'step-slicer':
    case 'roll': case 'freeze': case 'warp': case 'twist': case 'reverse-delay':
    case 'synth': case 'g2b': case 'sustainer': case 'slow-gear': case 'octave': {
      const processor = new AudioWorkletNode(ctx, `ns-${typeId}`, {
        numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2],
        channelCount: 2, channelCountMode: 'explicit', channelInterpretation: 'speakers',
        processorOptions: { mode: typeId, defaults: { bpm: 120 }, lowLatency: ns_isIPadWebKit(), maxBufferSeconds: ns_isIPadWebKit() ? 4 : 7 },
      });
      send.connect(processor).connect(wetReturn);
      ns_guardWorklet(processor, send, wetReturn, fx);
      const generator = ['synth', 'g2b', 'octave'].includes(typeId);
      fx.params = Object.assign({ mix: 0.65, bpm: 120, transportOriginFrame: 0, intensity: 0.7 }, generator ? { dryInput: 1, frequency: 110, resonance: 0.5, tracking: 0.75 } : {});
      fx.setMix(0.65);
      if (typeId === 'beat-scatter') Object.assign(fx.params, { pattern: 0, division: 8, seed: 1337, direction: 0, retrigger: 1, triggerMode: 0 });
      if (typeId === 'beat-shift') Object.assign(fx.params, { direction: 0, amount: 1, quantize: 1, returnMode: 0 });
      if (typeId === 'vinyl-flick') Object.assign(fx.params, { gesture: 0, inertia: 0.7, friction: 0.3, returnSpeed: 0.4, triggerMode: 0 });
      if (typeId === 'pattern-slicer') Object.assign(fx.params, { pattern: 0, rate: 4, duty: 0.5, attack: 0.02, depth: 0.85 });
      if (typeId === 'step-slicer') { Object.assign(fx.params, { rate: 4, depth: 0.85 }); for (let step = 0; step < 16; step++) fx.params[`step${step}`] = step % 2 ? 0.2 : 1; }
      if (typeId === 'roll') Object.assign(fx.params, { division: 16, direction: 0, feedback: 0.35, triggerMode: 0 });
      if (typeId === 'freeze') Object.assign(fx.params, { division: 8, attack: 0.03, release: 0.15, sustain: 0.85 });
      if (['warp', 'twist'].includes(typeId)) Object.assign(fx.params, { amount: 0.55, feedback: 0.35, rate: 2, stereo: 0.7 });
      if (typeId === 'reverse-delay') Object.assign(fx.params, { division: 4, feedback: 0.35, lowCut: 100, highCut: 9000 });
      if (typeId === 'g2b') Object.assign(fx.params, { tracking: 1, tone: 0.5 });
      if (typeId === 'octave') Object.assign(fx.params, { octave1: 1, octave2: 0.35, direct: 0 });
      if (typeId === 'sustainer') Object.assign(fx.params, { attack: 0.02, release: 0.35, sustain: 0.7, level: 0.8 });
      if (typeId === 'slow-gear') Object.assign(fx.params, { sensitivity: 0.08, attack: 0.35, level: 1 });
      Object.entries(fx.params).forEach(([id, value]) => { if (id !== 'mix' && id !== 'dryInput') processor.port.postMessage({ type: 'param', id, value }); });
      fx.setParam = (id, value) => {
        if (id === 'mix') fx.setMix(value);
        else if (id === 'dryInput') { fx.params.dryInput = value; fx._dryInputScale = value >= 0.5 ? 1 : 0; fx.applyMix(); }
        else { fx.params[id] = value; processor.port.postMessage({ type: 'param', id, value }); }
      };
      remember({ processor });
      break;
    }

    case 'radio': case 'preamp': {
      const highpass = ctx.createBiquadFilter(); const lowpass = ctx.createBiquadFilter(); const shaper = ctx.createWaveShaper(); const trim = ctx.createGain();
      const noiseGain = ctx.createGain();
      highpass.type = 'highpass'; lowpass.type = 'lowpass'; highpass.frequency.value = typeId === 'radio' ? 280 : 55; lowpass.frequency.value = typeId === 'radio' ? 4200 : 9800;
      shaper.curve = ns_makeDriveCurve(typeId === 'radio' ? 0.18 : 0.24); shaper.oversample = '4x'; trim.gain.value = 0.72;
      send.connect(highpass).connect(lowpass).connect(shaper).connect(trim).connect(wetReturn);
      let noiseSource = null;
      if (typeId === 'radio') {
        const noiseBuffer = ctx.createBuffer(1, Math.max(128, Math.round(ctx.sampleRate * 2)), ctx.sampleRate);
        const data = noiseBuffer.getChannelData(0);
        let seed = 0x52414449;
        let pink = 0;
        for (let i = 0; i < data.length; i++) {
          seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
          const white = ((seed >>> 0) / 4294967295) * 2 - 1;
          pink += (white - pink) * 0.075;
          data[i] = pink * 1.8;
        }
        noiseSource = source(ctx.createBufferSource());
        noiseSource.buffer = noiseBuffer; noiseSource.loop = true;
        noiseGain.gain.value = 0.08;
        noiseSource.connect(noiseGain).connect(shaper);
        noiseSource.start();
      } else noiseGain.gain.value = 0;
      fx.params = { mix: 0.65, type: 0, bandwidth: 0.6, noise: typeId === 'radio' ? 0.08 : 0, drive: 0.24, tone: 0.6, level: 0.72 };
      fx.setMix(0.65);
      const updateModel = () => {
        if (typeId === 'preamp') {
          const model = Math.max(0, Math.min(3, Math.round(fx.params.type)));
          const gain = Math.max(0, Math.min(1, fx.params.drive));
          shaper.curve = ns_makeDriveCurve(gain * [0.28, 0.55, 0.78, 1][model], [0, 1, 2, 4][model]);
          ns_smooth(highpass.frequency, [45, 60, 78, 95][model], ctx);
          ns_smooth(lowpass.frequency, [12500, 9500, 7600, 6100][model] * (0.72 + fx.params.tone * 0.42), ctx);
        } else shaper.curve = ns_makeDriveCurve(fx.params.drive, 0);
      };
      fx.setParam = (id, value) => {
        if (id === 'mix') fx.setMix(value);
        else {
          fx.params[id] = value;
          if (id === 'drive' || id === 'type') updateModel();
          if (id === 'noise') ns_smooth(noiseGain.gain, value, ctx);
          if (id === 'tone') { if (typeId === 'preamp') updateModel(); else ns_smooth(lowpass.frequency, 1800 + value * 12500, ctx); }
          if (id === 'level') ns_smooth(trim.gain, value, ctx);
          if (id === 'bandwidth') { ns_smooth(highpass.frequency, 80 + (1 - value) * 900, ctx); ns_smooth(lowpass.frequency, 1800 + value * 9000, ctx); }
        }
      };
      updateModel();
      remember({ highpass, lowpass, shaper, trim, noiseGain, noiseSource });
      break;
    }

    case 'moddelay': {
      const delay = ctx.createDelay(2); const feedback = ctx.createGain(); const lfo = source(ctx.createOscillator()); const depth = ctx.createGain(); const lowpass = ctx.createBiquadFilter();
      delay.delayTime.value = 0.28; feedback.gain.value = 0.38; lfo.frequency.value = 0.5; depth.gain.value = 0.004; lowpass.type = 'lowpass'; lowpass.frequency.value = 8000;
      send.connect(delay).connect(wetReturn); delay.connect(lowpass).connect(feedback).connect(delay); lfo.connect(depth).connect(delay.delayTime); lfo.start();
      fx.params = { mix: 0.35, time: 0.28, feedback: 0.38, depth: 4, rate: 0.5, lowCut: 80, highCut: 8000 };
      fx.setMix(0.35);
      fx.setParam = (id, value) => { if (id === 'mix') fx.setMix(value); else { fx.params[id] = value; if (id === 'time') ns_smooth(delay.delayTime, value, ctx); if (id === 'feedback') ns_smooth(feedback.gain, Math.min(0.9, value), ctx); if (id === 'depth') ns_smooth(depth.gain, value / 1000, ctx); if (id === 'rate') ns_smooth(lfo.frequency, value, ctx); if (id === 'highCut') ns_smooth(lowpass.frequency, value, ctx); } };
      remember({ delay, feedback, lfo, depth, lowpass });
      break;
    }

    default:
      send.connect(wetReturn);
      fx.setParam = (id, value) => { if (id === 'mix') fx.setMix(value); };
  }

  return fx;
}

const NS_FX_PARAM_SCHEMA = {
  reverb: [
    { id: 'mix', label: 'MIX', min: 0, max: 1, step: 0.01, unit: '%' },
    { id: 'size', label: 'SIZE', min: 0.35, max: 7, step: 0.05, unit: 's' },
    { id: 'decay', label: 'DECAY', min: 0.8, max: 7, step: 0.1 },
    { id: 'predelay', label: 'PRE DELAY', min: 0, max: 120, step: 1, unit: 'ms' },
    { id: 'tone', label: 'TONE', min: 1800, max: 16000, step: 100, unit: 'Hz' },
  ],
  gatereverb: [
    { id: 'mix', label: 'MIX', min: 0, max: 1, step: 0.01, unit: '%' },
    { id: 'time', label: 'TIME', min: 0.12, max: 1.6, step: 0.02, unit: 's' },
    { id: 'tone', label: 'TONE', min: 1200, max: 14000, step: 100, unit: 'Hz' },
  ],
  delay: [
    { id: 'mix', label: 'MIX', min: 0, max: 1, step: 0.01, unit: '%' },
    { id: 'time', label: 'TIME', min: 0.025, max: 1.5, step: 0.005, unit: 's' },
    { id: 'sync', label: 'SYNC', min: 0, max: 1, step: 1, values: ['FREE', 'BPM'] },
    { id: 'division', label: 'DIVISION', min: 1, max: 32, step: 1 },
    { id: 'feedback', label: 'FEEDBACK', min: 0, max: 0.92, step: 0.01, unit: '%' },
    { id: 'lowCut', label: 'LOW CUT', min: 20, max: 2000, step: 10, unit: 'Hz' },
    { id: 'highCut', label: 'HIGH CUT', min: 1000, max: 16000, step: 100, unit: 'Hz' },
  ],
  pandelay: [
    { id: 'mix', label: 'MIX', min: 0, max: 1, step: 0.01, unit: '%' },
    { id: 'time', label: 'TIME', min: 0.04, max: 1, step: 0.005, unit: 's' },
    { id: 'spread', label: 'SPREAD', min: 1, max: 2, step: 0.05 },
    { id: 'feedback', label: 'FEEDBACK', min: 0, max: 0.86, step: 0.01, unit: '%' },
    { id: 'tone', label: 'TONE', min: 900, max: 12000, step: 100, unit: 'Hz' },
  ],
  tapeecho: [
    { id: 'mix', label: 'MIX', min: 0, max: 1, step: 0.01, unit: '%' },
    { id: 'time', label: 'TIME', min: 0.05, max: 1.2, step: 0.005, unit: 's' },
    { id: 'sync', label: 'SYNC', min: 0, max: 1, step: 1, values: ['FREE', 'BPM'] },
    { id: 'division', label: 'DIVISION', min: 1, max: 32, step: 1 },
    { id: 'feedback', label: 'FEEDBACK', min: 0, max: 0.9, step: 0.01, unit: '%' },
    { id: 'lowCut', label: 'LOW CUT', min: 20, max: 2000, step: 10, unit: 'Hz' },
    { id: 'highCut', label: 'HIGH CUT', min: 700, max: 12000, step: 100, unit: 'Hz' },
    { id: 'wow', label: 'WOW', min: 0, max: 8, step: 0.1, unit: 'ms' },
    { id: 'flutter', label: 'FLUTTER', min: 0, max: 1, step: 0.01, unit: '%' },
    { id: 'drive', label: 'DRIVE', min: 0, max: 0.7, step: 0.01, unit: '%' },
  ],
  chorus: [
    { id: 'mix', label: 'MIX', min: 0, max: 1, step: 0.01, unit: '%' },
    { id: 'rate', label: 'RATE', min: 0.08, max: 5, step: 0.02, unit: 'Hz' },
    { id: 'depth', label: 'DEPTH', min: 0.5, max: 16, step: 0.1, unit: 'ms' },
    { id: 'width', label: 'WIDTH', min: 0, max: 1, step: 0.01, unit: '%' },
  ],
  flanger: [
    { id: 'mix', label: 'MIX', min: 0, max: 1, step: 0.01, unit: '%' },
    { id: 'rate', label: 'RATE', min: 0.03, max: 4, step: 0.02, unit: 'Hz' },
    { id: 'depth', label: 'DEPTH', min: 0.2, max: 8, step: 0.1, unit: 'ms' },
    { id: 'feedback', label: 'FEEDBACK', min: -0.85, max: 0.85, step: 0.01, unit: '%' },
  ],
  phaser: [
    { id: 'mix', label: 'MIX', min: 0, max: 1, step: 0.01, unit: '%' },
    { id: 'rate', label: 'RATE', min: 0.03, max: 5, step: 0.02, unit: 'Hz' },
    { id: 'depth', label: 'DEPTH', min: 80, max: 1800, step: 10, unit: 'Hz' },
    { id: 'resonance', label: 'RESONANCE', min: 0.1, max: 6, step: 0.05 },
  ],
  tremolo: [
    { id: 'rate', label: 'RATE', min: 0.2, max: 16, step: 0.1, unit: 'Hz' },
    { id: 'depth', label: 'DEPTH', min: 0, max: 1, step: 0.01, unit: '%' },
  ],
  autopan: [
    { id: 'rate', label: 'RATE', min: 0.05, max: 10, step: 0.05, unit: 'Hz' },
    { id: 'depth', label: 'DEPTH', min: 0, max: 1, step: 0.01, unit: '%' },
  ],
  harmonizer: [
    { id: 'mix', label: 'MIX', min: 0, max: 1, step: 0.01, unit: '%' },
    { id: 'dryInput', label: 'ORIGINAL', min: 0, max: 1, step: 1, values: ['MUTE', 'THRU'] },
    { id: 'level', label: 'HARMONY LEVEL', min: 0.5, max: 2, step: 0.01 },
    { id: 'voice1', label: 'VOICE 1', min: -12, max: 12, step: 1, unit: 'st' },
    { id: 'voice2', label: 'VOICE 2', min: -12, max: 12, step: 1, unit: 'st' },
    { id: 'balance', label: 'VOICE 2 BAL', min: 0, max: 1, step: 0.01, unit: '%' },
    { id: 'window', label: 'QUALITY', min: 42, max: 110, step: 1, unit: 'ms' },
    { id: 'tone', label: 'TONE', min: 2500, max: 15000, step: 100, unit: 'Hz' },
    { id: 'harmonyMode', label: 'HARMONY', min: 0, max: 1, step: 1, values: ['FIXED', 'DIATONIC'] },
    { id: 'root', label: 'ROOT', min: 0, max: 11, step: 1, values: ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] },
    { id: 'scale', label: 'SCALE', min: 0, max: 4, step: 1, values: ['CHROMATIC', 'MAJOR', 'MINOR', 'HARMONIC MINOR', 'MINOR PENTATONIC'] },
    { id: 'degree1', label: 'VOICE 1 DEGREE', min: -7, max: 7, step: 1 },
    { id: 'degree2', label: 'VOICE 2 DEGREE', min: -7, max: 7, step: 1 },
    { id: 'tracking', label: 'TRACKING', min: 0, max: 1, step: 0.01, unit: '%' },
  ],
  pitchshifter: [
    { id: 'mix', label: 'MIX', min: 0, max: 1, step: 0.01, unit: '%' },
    { id: 'dryInput', label: 'ORIGINAL', min: 0, max: 1, step: 1, values: ['MUTE', 'THRU'] },
    { id: 'level', label: 'LEVEL', min: 0.25, max: 2, step: 0.01 },
    { id: 'shift', label: 'SHIFT', min: -24, max: 24, step: 1, unit: 'st' },
    { id: 'quality', label: 'QUALITY', min: 42, max: 120, step: 1, unit: 'ms' },
    { id: 'tone', label: 'TONE', min: 2500, max: 16000, step: 100, unit: 'Hz' },
  ],
  'osc-bot': [
    { id: 'mix', label: 'MIX', min: 0, max: 1, step: 0.01, unit: '%' },
    { id: 'dryInput', label: 'DRY INPUT', min: 0, max: 1, step: 1, values: ['MUTE', 'THRU'] },
    { id: 'wave', label: 'OSC', min: 0, max: 4, step: 1, values: ['SAW', 'VINTAGE SAW', 'DETUNE SAW', 'SQUARE', 'RECT'] },
    { id: 'tone', label: 'TONE', min: -50, max: 50, step: 1 },
    { id: 'attack', label: 'ATTACK', min: 0, max: 100, step: 1 },
    { id: 'note', label: 'NOTE', min: 24, max: 127, step: 1, unit: 'note' },
    { id: 'sens', label: 'MOD SENS', min: -50, max: 50, step: 1 },
    { id: 'balance', label: 'BALANCE', min: 0, max: 1, step: 0.01, unit: '%' },
    { id: 'seqOn', label: 'SEQUENCER', min: 0, max: 1, step: 1, values: ['OFF', 'ON'] },
    { id: 'seqSync', label: 'SYNC', min: 0, max: 1, step: 1, values: ['FREE', 'BPM'] },
    { id: 'seqRate', label: 'STEP RATE', min: 0, max: 3, step: 1, values: ['1/4', '1/8', '1/16', '1/32'] },
    { id: 'seqSteps', label: 'STEPS', min: 1, max: 16, step: 1 },
    { id: 'seqGate', label: 'GATE', min: 0.05, max: 1, step: 0.01, unit: '%' },
  ],
  vocaltuner: [
    { id: 'mix', label: 'MIX', min: 0, max: 1, step: 0.01, unit: '%' },
    { id: 'dryInput', label: 'ORIGINAL', min: 0, max: 1, step: 1, values: ['MUTE', 'THRU'] },
    { id: 'shift', label: 'SHIFT', min: -12, max: 12, step: 1, unit: 'st' },
    { id: 'formant', label: 'FORMANT', min: -50, max: 50, step: 1 },
    { id: 'speed', label: 'SPEED', min: 0, max: 10, step: 1 },
    { id: 'stability', label: 'STABILITY', min: -10, max: 10, step: 1 },
    { id: 'mode', label: 'MODE', min: 0, max: 1, step: 1, values: ['ELECTRIC', 'ROBOT'] },
    { id: 'root', label: 'ROOT', min: 0, max: 11, step: 1, values: ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] },
    { id: 'scale', label: 'SCALE', min: 0, max: 4, step: 1, values: ['CHROMATIC', 'MAJOR', 'MINOR', 'HARMONIC MINOR', 'MINOR PENTATONIC'] },
    { id: 'robotNote', label: 'ROBOT NOTE', min: 0, max: 11, step: 1, values: ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] },
    { id: 'amount', label: 'CORRECTION', min: 0, max: 1, step: 0.01, unit: '%' },
  ],
  filter: [
    { id: 'cutoff', label: 'CUTOFF', min: 70, max: 16000, step: 10, unit: 'Hz' },
    { id: 'resonance', label: 'RESONANCE', min: 0.1, max: 18, step: 0.1 },
    { id: 'drive', label: 'DRIVE', min: 0, max: 0.8, step: 0.01, unit: '%' },
  ],
  eq: [
    { id: 'low', label: 'LOW', min: -18, max: 18, step: 0.5, unit: 'dB' },
    { id: 'lowmid', label: 'LOW MID', min: -18, max: 18, step: 0.5, unit: 'dB' },
    { id: 'highmid', label: 'HIGH MID', min: -18, max: 18, step: 0.5, unit: 'dB' },
    { id: 'high', label: 'HIGH', min: -18, max: 18, step: 0.5, unit: 'dB' },
  ],
  isolator: [
    { id: 'low', label: 'LOW', min: 0, max: 1.5, step: 0.01, unit: '%' },
    { id: 'mid', label: 'MID', min: 0, max: 1.5, step: 0.01, unit: '%' },
    { id: 'high', label: 'HIGH', min: 0, max: 1.5, step: 0.01, unit: '%' },
  ],
  compressor: [
    { id: 'threshold', label: 'THRESHOLD', min: -60, max: -2, step: 1, unit: 'dB' },
    { id: 'ratio', label: 'RATIO', min: 1, max: 20, step: 0.5 },
    { id: 'attack', label: 'ATTACK', min: 1, max: 100, step: 1, unit: 'ms' },
    { id: 'release', label: 'RELEASE', min: 40, max: 800, step: 5, unit: 'ms' },
    { id: 'makeup', label: 'MAKEUP', min: 0.5, max: 3, step: 0.05 },
  ],
  limiter: [
    { id: 'ceiling', label: 'CEILING', min: -12, max: -0.1, step: 0.1, unit: 'dB' },
    { id: 'release', label: 'RELEASE', min: 20, max: 500, step: 5, unit: 'ms' },
    { id: 'input', label: 'INPUT', min: 0.5, max: 2, step: 0.01 },
  ],
  distortion: [
    { id: 'mix', label: 'MIX', min: 0, max: 1, step: 0.01, unit: '%' },
    { id: 'type', label: 'TYPE', min: 0, max: 5, step: 1, values: ['VOCAL', 'BOOST', 'OD', 'DS', 'METAL', 'FUZZ'] },
    { id: 'drive', label: 'DRIVE', min: 0, max: 1, step: 0.01, unit: '%' },
    { id: 'tone', label: 'TONE', min: 900, max: 14000, step: 100, unit: 'Hz' },
    { id: 'level', label: 'LEVEL', min: 0.1, max: 1.5, step: 0.01 },
  ],
  ringmod: [
    { id: 'mix', label: 'MIX', min: 0, max: 1, step: 0.01, unit: '%' },
    { id: 'freq', label: 'FREQUENCY', min: 20, max: 2400, step: 1, unit: 'Hz' },
    { id: 'sync', label: 'SYNC', min: 0, max: 1, step: 1, values: ['FREE', 'BPM'] },
    { id: 'division', label: 'DIVISION', min: 1, max: 32, step: 1 },
  ],
  lofi: [
    { id: 'mix', label: 'MIX', min: 0, max: 1, step: 0.01, unit: '%' },
    { id: 'bits', label: 'BITS', min: 3, max: 16, step: 1 },
    { id: 'reduction', label: 'RATE REDUCE', min: 1, max: 24, step: 1 },
    { id: 'jitter', label: 'JITTER', min: 0, max: 8, step: 1 },
    { id: 'tone', label: 'TONE', min: 500, max: 12000, step: 100, unit: 'Hz' },
  ],
  slicer: [
    { id: 'rate', label: 'RATE', min: 0.5, max: 20, step: 0.5, unit: 'Hz' },
    { id: 'depth', label: 'DEPTH', min: 0, max: 1, step: 0.01, unit: '%' },
  ],
  beatrepeat: [
    { id: 'mix', label: 'MIX', min: 0, max: 1, step: 0.01, unit: '%' },
    { id: 'division', label: 'DIVISION', min: 1, max: 64, step: 1, unit: '/64' },
    { id: 'direction', label: 'DIRECTION', min: 0, max: 2, step: 1, values: ['FORWARD', 'REVERSE', 'ALTERNATE'] },
    { id: 'quantize', label: 'QUANTIZE', min: 0, max: 1, step: 1, values: ['OFF', 'ON'] },
    { id: 'gate', label: 'GATE', min: 0, max: 1, step: 0.01, unit: '%' },
    { id: 'feedback', label: 'FEEDBACK', min: 0, max: 0.94, step: 0.01, unit: '%' },
    { id: 'triggerMode', label: 'TRIGGER', min: 0, max: 1, step: 1, values: ['TOGGLE', 'MOMENTARY'] },
  ],
  'beat-scatter': [
    { id: 'mix', label: 'MIX', min: 0, max: 1, step: 0.01, unit: '%' }, { id: 'pattern', label: 'PATTERN', min: 0, max: 7, step: 1 },
    { id: 'division', label: 'LENGTH', min: 1, max: 64, step: 1 }, { id: 'seed', label: 'SEED', min: 1, max: 9999, step: 1 },
    { id: 'direction', label: 'DIRECTION', min: 0, max: 1, step: 1, values: ['NORMAL', 'REVERSE'] }, { id: 'intensity', label: 'INTENSITY', min: 0, max: 1, step: 0.01, unit: '%' },
    { id: 'retrigger', label: 'BAR RETRIGGER', min: 0, max: 1, step: 1, values: ['OFF', 'ON'] }, { id: 'triggerMode', label: 'TRIGGER', min: 0, max: 1, step: 1, values: ['TOGGLE', 'MOMENTARY'] },
  ],
  'beat-shift': [
    { id: 'mix', label: 'MIX', min: 0, max: 1, step: 0.01, unit: '%' }, { id: 'direction', label: 'DIRECTION', min: 0, max: 1, step: 1, values: ['PAST', 'FUTURE'] },
    { id: 'amount', label: 'BEATS', min: 0.5, max: 16, step: 0.5 }, { id: 'quantize', label: 'QUANTIZE', min: 0, max: 1, step: 1, values: ['OFF', 'ON'] },
    { id: 'returnMode', label: 'RELEASE', min: 0, max: 1, step: 1, values: ['RETURN', 'STAY'] },
  ],
  'vinyl-flick': [
    { id: 'mix', label: 'MIX', min: 0, max: 1, step: 0.01, unit: '%' }, { id: 'gesture', label: 'GESTURE', min: -1, max: 1, step: 0.01 },
    { id: 'inertia', label: 'INERTIA', min: 0, max: 1, step: 0.01, unit: '%' }, { id: 'friction', label: 'FRICTION', min: 0, max: 1, step: 0.01, unit: '%' },
    { id: 'returnSpeed', label: 'RETURN', min: 0, max: 1, step: 0.01, unit: '%' }, { id: 'triggerMode', label: 'TRIGGER', min: 0, max: 1, step: 1, values: ['TOGGLE', 'MOMENTARY'] },
  ],
  'pattern-slicer': [
    { id: 'mix', label: 'MIX', min: 0, max: 1, step: 0.01, unit: '%' }, { id: 'pattern', label: 'PATTERN', min: 0, max: 19, step: 1 },
    { id: 'rate', label: 'RATE', min: 1, max: 16, step: 1 }, { id: 'duty', label: 'DUTY', min: 0.05, max: 0.95, step: 0.01, unit: '%' },
    { id: 'attack', label: 'ATTACK', min: 0, max: 0.5, step: 0.01, unit: '%' }, { id: 'depth', label: 'DEPTH', min: 0, max: 1, step: 0.01, unit: '%' },
  ],
  roll: [
    { id: 'mix', label: 'MIX', min: 0, max: 1, step: 0.01, unit: '%' }, { id: 'division', label: 'DIVISION', min: 1, max: 64, step: 1 },
    { id: 'direction', label: 'DIRECTION', min: 0, max: 2, step: 1, values: ['FORWARD', 'REVERSE', 'ALTERNATE'] }, { id: 'feedback', label: 'FEEDBACK', min: 0, max: 0.92, step: 0.01, unit: '%' },
    { id: 'triggerMode', label: 'TRIGGER', min: 0, max: 1, step: 1, values: ['TOGGLE', 'MOMENTARY'] },
  ],
  freeze: [{ id: 'mix', label: 'MIX', min: 0, max: 1, step: 0.01, unit: '%' }, { id: 'division', label: 'LENGTH', min: 1, max: 64, step: 1 }, { id: 'attack', label: 'ATTACK', min: 0, max: 1, step: 0.01 }, { id: 'release', label: 'RELEASE', min: 0, max: 2, step: 0.01 }, { id: 'sustain', label: 'SUSTAIN', min: 0, max: 1, step: 0.01 }],
  warp: [{ id: 'mix', label: 'MIX', min: 0, max: 1, step: 0.01, unit: '%' }, { id: 'amount', label: 'AMOUNT', min: 0, max: 1, step: 0.01 }, { id: 'feedback', label: 'FEEDBACK', min: 0, max: 0.9, step: 0.01 }, { id: 'rate', label: 'RATE', min: 0.25, max: 8, step: 0.25 }, { id: 'stereo', label: 'STEREO', min: 0, max: 1, step: 0.01 }],
  twist: [{ id: 'mix', label: 'MIX', min: 0, max: 1, step: 0.01, unit: '%' }, { id: 'amount', label: 'ROTATION', min: 0, max: 1, step: 0.01 }, { id: 'rate', label: 'RISE / FALL', min: 0.25, max: 8, step: 0.25 }, { id: 'feedback', label: 'FEEDBACK', min: 0, max: 0.9, step: 0.01 }, { id: 'stereo', label: 'STEREO', min: 0, max: 1, step: 0.01 }],
  'reverse-delay': [{ id: 'mix', label: 'MIX', min: 0, max: 1, step: 0.01, unit: '%' }, { id: 'division', label: 'TIME', min: 1, max: 64, step: 1 }, { id: 'feedback', label: 'FEEDBACK', min: 0, max: 0.9, step: 0.01 }, { id: 'lowCut', label: 'LOW CUT', min: 20, max: 1200, step: 10, unit: 'Hz' }, { id: 'highCut', label: 'HIGH CUT', min: 1000, max: 16000, step: 100, unit: 'Hz' }],
  moddelay: [{ id: 'mix', label: 'MIX', min: 0, max: 1, step: 0.01, unit: '%' }, { id: 'time', label: 'TIME', min: 0.02, max: 1.5, step: 0.005, unit: 's' }, { id: 'feedback', label: 'FEEDBACK', min: 0, max: 0.9, step: 0.01 }, { id: 'depth', label: 'MOD DEPTH', min: 0, max: 20, step: 0.1, unit: 'ms' }, { id: 'rate', label: 'MOD RATE', min: 0.05, max: 8, step: 0.05, unit: 'Hz' }, { id: 'highCut', label: 'HIGH CUT', min: 1000, max: 16000, step: 100, unit: 'Hz' }],
  radio: [{ id: 'mix', label: 'MIX', min: 0, max: 1, step: 0.01, unit: '%' }, { id: 'bandwidth', label: 'BANDWIDTH', min: 0, max: 1, step: 0.01 }, { id: 'noise', label: 'NOISE', min: 0, max: 0.5, step: 0.01 }, { id: 'drive', label: 'DRIVE', min: 0, max: 1, step: 0.01 }, { id: 'tone', label: 'TONE', min: 0, max: 1, step: 0.01 }, { id: 'level', label: 'LEVEL', min: 0.1, max: 1.5, step: 0.01 }],
  preamp: [{ id: 'mix', label: 'MIX', min: 0, max: 1, step: 0.01, unit: '%' }, { id: 'type', label: 'TYPE', min: 0, max: 3, step: 1, values: ['CLEAN', 'CRUNCH', 'STACK', 'HIGH GAIN'] }, { id: 'drive', label: 'GAIN', min: 0, max: 1, step: 0.01 }, { id: 'tone', label: 'TONE', min: 0, max: 1, step: 0.01 }, { id: 'level', label: 'LEVEL', min: 0.1, max: 1.5, step: 0.01 }],
  synth: [{ id: 'mix', label: 'MIX', min: 0, max: 1, step: 0.01 }, { id: 'dryInput', label: 'ORIGINAL', min: 0, max: 1, step: 1, values: ['MUTE', 'THRU'] }, { id: 'frequency', label: 'FREQUENCY', min: 30, max: 880, step: 1, unit: 'Hz' }, { id: 'resonance', label: 'RESONANCE', min: 0, max: 1, step: 0.01 }, { id: 'tracking', label: 'TRACKING', min: 0, max: 1, step: 0.01 }],
  g2b: [{ id: 'mix', label: 'MIX', min: 0, max: 1, step: 0.01 }, { id: 'dryInput', label: 'ORIGINAL', min: 0, max: 1, step: 1, values: ['MUTE', 'THRU'] }, { id: 'frequency', label: 'BASE', min: 30, max: 440, step: 1, unit: 'Hz' }, { id: 'tracking', label: 'TRACKING', min: 0, max: 1, step: 0.01 }, { id: 'tone', label: 'TONE', min: 0, max: 1, step: 0.01 }],
  octave: [{ id: 'mix', label: 'MIX', min: 0, max: 1, step: 0.01 }, { id: 'dryInput', label: 'ORIGINAL', min: 0, max: 1, step: 1, values: ['MUTE', 'THRU'] }, { id: 'octave1', label: '-1 OCT', min: 0, max: 1, step: 0.01 }, { id: 'octave2', label: '-2 OCT', min: 0, max: 1, step: 0.01 }, { id: 'direct', label: 'DIRECT', min: 0, max: 1, step: 0.01 }],
  sustainer: [{ id: 'mix', label: 'MIX', min: 0, max: 1, step: 0.01 }, { id: 'attack', label: 'ATTACK', min: 0.001, max: 0.5, step: 0.001 }, { id: 'release', label: 'RELEASE', min: 0.02, max: 2, step: 0.01 }, { id: 'sustain', label: 'SUSTAIN', min: 0.1, max: 1, step: 0.01 }, { id: 'level', label: 'LEVEL', min: 0.1, max: 1.5, step: 0.01 }],
  'slow-gear': [{ id: 'mix', label: 'MIX', min: 0, max: 1, step: 0.01 }, { id: 'sensitivity', label: 'SENSITIVITY', min: 0.01, max: 0.8, step: 0.01 }, { id: 'attack', label: 'RISE TIME', min: 0.02, max: 2, step: 0.01 }, { id: 'level', label: 'LEVEL', min: 0.1, max: 1.5, step: 0.01 }],
};

NS_FX_PARAM_SCHEMA['step-slicer'] = [
  { id: 'mix', label: 'MIX', min: 0, max: 1, step: 0.01, unit: '%' },
  { id: 'rate', label: 'RATE', min: 1, max: 16, step: 1 },
  { id: 'depth', label: 'DEPTH', min: 0, max: 1, step: 0.01, unit: '%' },
  ...Array.from({ length: 16 }, (_, index) => ({ id: `step${index}`, label: `STEP ${index + 1}`, min: 0, max: 1, step: 0.01, unit: '%' })),
];

// templates.js
// Memorias locais inspiradas no fluxo de bancos A-D de loop stations de mesa.

function ns_fxPreset(id, params = {}, bypassed = false) {
  return { id, params, bypassed };
}

function ns_rackPreset(effects, enabled = false, intensity = 1) {
  return { enabled, intensity, effects };
}

function ns_trackPreset(inputEffects, outputEffects, options = {}) {
  return {
    inputGain: options.inputGain ?? 1.25,
    inputEQ: options.inputEQ || { low: 0, mid: 0, high: 0 },
    gain: options.gain ?? 1,
    pan: options.pan ?? 0,
    reverse: false,
    inputFx: ns_rackPreset(inputEffects, options.inputEnabled ?? false, options.inputIntensity ?? 0.72),
    outputFx: ns_rackPreset(outputEffects, options.outputEnabled ?? false, options.outputIntensity ?? 0.72),
  };
}

const NS_DEFAULT_INPUT_CHAIN = [
  ns_fxPreset('compressor', { threshold: -24, ratio: 3, attack: 10, release: 180, makeup: 1.3 }),
  ns_fxPreset('eq', { low: 0, lowmid: -1, highmid: 1.5, high: 1 }),
  ns_fxPreset('reverb', { mix: 0.2, size: 1.8, decay: 2.6, predelay: 18, tone: 9200 }, true),
  ns_fxPreset('vocaltuner', { mix: 0.72, shift: 0, formant: 0, speed: 9, stability: 0, mode: 0, root: 0, scale: 1, robotNote: 0, amount: 1 }, true),
];

const NS_DEFAULT_TRACK_CHAIN = [
  ns_fxPreset('beatrepeat', { mix: 0.42, time: 0.125, feedback: 0.76, tone: 7600 }, true),
  ns_fxPreset('chorus', { mix: 0.28, rate: 0.65, depth: 4.5, width: 0.78 }, true),
  ns_fxPreset('filter', { cutoff: 5200, resonance: 1.1, drive: 0.03 }, true),
  ns_fxPreset('delay', { mix: 0.26, time: 0.375, feedback: 0.3, tone: 7800 }, true),
];

function ns_factorySetup() {
  return {
    version: 17,
    bpm: 100,
    quantizeMode: 'OFF',
    recLengthMode: 'FREE',
    recBars: 0,
    recMode: 'REC_PLAY_OVER',
    metroLevel: 0.35,
    tailReverbEnabled: true,
    tailReverbDuration: 2.2,
    inputTrimDb: 12,
    inputLowCut: 55,
    brightness: 1.5,
    masterGain: 0.86,
    globalInputFx: ns_rackPreset([
      ns_fxPreset('compressor', { threshold: -22, ratio: 2.5, attack: 8, release: 160, makeup: 1.25 }),
      ns_fxPreset('eq', { low: 0, lowmid: -1, highmid: 1, high: 1.5 }),
      ns_fxPreset('reverb', { mix: 0.18, size: 1.6, decay: 2.4, predelay: 14, tone: 9600 }, true),
      ns_fxPreset('vocaltuner', { mix: 0.7, shift: 0, formant: 0, speed: 9, stability: 0, mode: 0, root: 0, scale: 1, robotNote: 0, amount: 1 }, true),
    ], false, 0.72),
    masterFx: ns_rackPreset([
      ns_fxPreset('compressor', { threshold: -18, ratio: 3, attack: 12, release: 220, makeup: 1.12 }),
      ns_fxPreset('limiter', { ceiling: -1, release: 80, input: 1 }),
    ], true, 1),
    tracks: Array.from({ length: 5 }, () => ns_trackPreset(
      JSON.parse(JSON.stringify(NS_DEFAULT_INPUT_CHAIN)),
      JSON.parse(JSON.stringify(NS_DEFAULT_TRACK_CHAIN)),
    )),
  };
}

function ns_templateFromChains(inputChain, outputChain, options = {}) {
  const setup = ns_factorySetup();
  setup.bpm = options.bpm || setup.bpm;
  setup.inputTrimDb = options.inputTrimDb ?? setup.inputTrimDb;
  setup.tailReverbDuration = options.tail ?? setup.tailReverbDuration;
  setup.tracks = Array.from({ length: 5 }, () => ns_trackPreset(
    JSON.parse(JSON.stringify(inputChain)),
    JSON.parse(JSON.stringify(outputChain)),
    options.track || {},
  ));
  return setup;
}

const NS_BUILTIN_TEMPLATES = [
  {
    id: 'clean-master', name: 'CLEAN · MASTER ONLY', create: () => {
      const setup = ns_factorySetup();
      setup.globalInputFx = ns_rackPreset([], false, 1);
      setup.tracks = Array.from({ length: 5 }, () => ns_trackPreset([], [], {
        inputGain: 1, gain: 0.82, inputEnabled: false, outputEnabled: false,
      }));
      return setup;
    },
  },
  { id: 'factory', name: 'BOSS STYLE · FACTORY', create: () => ns_factorySetup() },
  {
    id: 'ambient', name: 'BOSS STYLE · AMBIENT', create: () => ns_templateFromChains(
      [ns_fxPreset('compressor'), ns_fxPreset('eq'), ns_fxPreset('chorus'), ns_fxPreset('reverb')],
      [ns_fxPreset('reverb'), ns_fxPreset('tapeecho'), ns_fxPreset('chorus'), ns_fxPreset('filter')],
      { bpm: 82, tail: 4.8, track: { inputEnabled: true, outputEnabled: true, inputIntensity: 0.42, outputIntensity: 0.48 } },
    ),
  },
  {
    id: 'beatbox', name: 'BOSS STYLE · BEATBOX', create: () => ns_templateFromChains(
      [ns_fxPreset('compressor'), ns_fxPreset('eq'), ns_fxPreset('filter'), ns_fxPreset('distortion', {}, true)],
      [ns_fxPreset('beatrepeat'), ns_fxPreset('slicer'), ns_fxPreset('isolator'), ns_fxPreset('delay')],
      { bpm: 96, track: { inputEnabled: true, outputEnabled: false, inputIntensity: 0.82 } },
    ),
  },
  {
    id: 'glitch', name: 'BOSS STYLE · GLITCH', create: () => ns_templateFromChains(
      [ns_fxPreset('compressor'), ns_fxPreset('ringmod', {}, true), ns_fxPreset('lofi', {}, true), ns_fxPreset('osc-bot', { seqOn: 1, seqSync: 1, seqRate: 2, seqSteps: 16, seqGate: 0.68 }, true)],
      [ns_fxPreset('beatrepeat'), ns_fxPreset('slicer'), ns_fxPreset('lofi'), ns_fxPreset('filter')],
      { bpm: 118, track: { outputEnabled: true, outputIntensity: 0.4 } },
    ),
  },
  {
    id: 'vocal', name: 'BOSS STYLE · VOCAL LAB', create: () => ns_templateFromChains(
      [ns_fxPreset('compressor'), ns_fxPreset('eq'), ns_fxPreset('vocaltuner', { mode: 0, root: 9, scale: 2, speed: 10, amount: 1 }), ns_fxPreset('harmonizer', {}, true)],
      [ns_fxPreset('chorus'), ns_fxPreset('delay'), ns_fxPreset('reverb'), ns_fxPreset('filter', {}, true)],
      { bpm: 92, tail: 3.2, track: { inputEnabled: true, outputEnabled: true, inputIntensity: 0.58, outputIntensity: 0.34 } },
    ),
  },
];

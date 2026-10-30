const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

function loadWorklet(file) {
  const registry = new Map();
  const context = {
    console,
    Float32Array,
    Int16Array,
    Math,
    sampleRate: 48000,
    currentFrame: 0,
    AudioWorkletProcessor: class {
      constructor() {
        this.port = { onmessage: null, messages: [], postMessage: (message) => this.port.messages.push(message) };
      }
    },
    registerProcessor: (name, Processor) => registry.set(name, Processor),
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(file, 'utf8'), context, { filename: file });
  return { context, registry };
}

function stereoBlock(length, value = 0.25) {
  return [[new Float32Array(length).fill(value), new Float32Array(length).fill(value)]];
}

function outputs(length) {
  return [[new Float32Array(length), new Float32Array(length)]];
}

function testMasterScheduledRecordAndClose() {
  const { context, registry } = loadWorklet('js/looper-processor.js');
  const Processor = registry.get('looper-processor');
  const looper = new Processor({ processorOptions: { maxSeconds: 3, maxLayers: 3 } });
  looper.handleMessage({ type: 'setQuantize', samples: 1000, originFrame: 0, graceSamples: 0 });

  context.currentFrame = 900;
  looper.requestState('RECORDING', 1000);
  assert.equal(looper.pendingFrame, 1000, 'REC deve usar o frame entregue pela master timeline');
  looper.process(stereoBlock(100), outputs(100));
  assert.equal(looper.state, 'EMPTY', 'REC não pode abrir antes da linha mestre');
  context.currentFrame = 1000;
  looper.process(stereoBlock(800), outputs(800));
  assert.equal(looper.writeHead, 800);
  context.currentFrame = 1800;
  looper.requestState('PLAYING', 2000);
  assert.equal(looper.pendingFrame, 2000);
  looper.process(stereoBlock(200), outputs(200));
  context.currentFrame = 2000;
  looper.process(stereoBlock(1), outputs(1));
  assert.equal(looper.state, 'PLAYING');
  assert.equal(looper.loopLength, 1000, 'o excesso depois da grade deve ser removido');
  assert.equal(looper.playHead, 1, 'PLAY deve começar no sample zero da grade');
  assert(Math.abs(looper.readSample(looper.layers[0], 0, 0)) > 0.2, 'o loop não pode começar com silêncio artificial');
}

function testFirstLayerKeepsTrueSampleZero() {
  const { context, registry } = loadWorklet('js/looper-processor.js');
  const Processor = registry.get('looper-processor');
  const looper = new Processor({ processorOptions: { maxSeconds: 3, maxLayers: 3 } });
  looper.handleMessage({ type: 'setRecordLatency', samples: 384 });
  looper.startFirstRecording();
  assert.equal(looper.layers[0].offset, 0, 'a primeira camada não pode avançar dentro do próprio buffer');

  for (let i = 0; i < 256; i++) looper.writeSample(looper.layers[0], i, i === 0 ? 0.8 : 0.2, i === 0 ? 0.8 : 0.2);
  looper.writeHead = 256;
  assert(looper.finalizeFirstRecording());
  looper.state = 'PLAYING';
  looper.playHead = 0;
  context.currentFrame = 0;
  const out = outputs(1);
  looper.process([[]], out);
  assert(out[0][0][0] > 0.75, 'o primeiro PLAY precisa reproduzir o ataque guardado no sample zero');

  looper.beginOverdub();
  assert.equal(looper.layers[1].offset, 384, 'overdub deve preservar a compensação de captura');
}

function testMissedMasterFrameMovesToNextGrid() {
  const { context, registry } = loadWorklet('js/looper-processor.js');
  const Processor = registry.get('looper-processor');
  const looper = new Processor({ processorOptions: { maxSeconds: 3, maxLayers: 3 } });
  looper.handleMessage({ type: 'setQuantize', samples: 1000, originFrame: 0, graceSamples: 0 });
  context.currentFrame = 1050;
  looper.requestState('RECORDING', 1000);
  assert.equal(looper.pendingFrame, 2000, 'mensagem atrasada deve ser reenfileirada na próxima linha, nunca entrar fora da grade');
  assert.equal(looper.state, 'EMPTY');
}

function testStoppedTrackJoinsSharedGrid() {
  const { context, registry } = loadWorklet('js/looper-processor.js');
  const Processor = registry.get('looper-processor');
  const looper = new Processor({ processorOptions: { maxSeconds: 3, maxLayers: 3 } });
  const pcm = new Int16Array(2000).fill(9000);
  looper.handleMessage({ type: 'setTempo', bpm: 120 });
  looper.handleMessage({ type: 'loadPCM', left: pcm, right: pcm, originalBpm: 120 });
  looper.handleMessage({ type: 'setQuantize', samples: 1000, originFrame: 0, graceSamples: 100 });
  context.currentFrame = 1350;
  looper.requestState('PLAYING', 2000);
  assert.equal(looper.pendingFrame, 2000, 'PLAY de pista parada deve entrar na próxima grade compartilhada');
  assert.equal(looper.pendingPlayHead, 0, 'PLAY deve aguardar a grade, mas sempre recomeçar no início');
  context.currentFrame = 2000;
  looper.process([[]], outputs(1));
  assert.equal(looper.state, 'PLAYING');
  assert.equal(looper.playHead, 1, 'primeiro frame reproduz a amostra zero e avança somente uma amostra');
}

function testStoppedTrackRestartsWithoutQuantize() {
  const { context, registry } = loadWorklet('js/looper-processor.js');
  const Processor = registry.get('looper-processor');
  const looper = new Processor({ processorOptions: { maxSeconds: 3, maxLayers: 3 } });
  const pcm = new Int16Array(2000).fill(9000);
  looper.handleMessage({ type: 'loadPCM', left: pcm, right: pcm, originalBpm: 120 });
  looper.playHead = 1379;
  looper.state = 'STOPPED';
  looper.requestState('PLAYING');
  assert.equal(looper.state, 'PLAYING');
  assert.equal(looper.playHead, 0, 'PLAY sem quantize também deve reiniciar no começo');
}

function testIndividualStopDoesNotGateAnotherTrack() {
  const { context, registry } = loadWorklet('js/looper-processor.js');
  const Processor = registry.get('looper-processor');
  const loopers = Array.from({ length: 5 }, () => new Processor({ processorOptions: { maxSeconds: 3, maxLayers: 3 } }));
  const stopped = loopers[4];
  const continuing = loopers.slice(0, 4);
  const pcm = new Int16Array(4096).fill(12000);
  for (const looper of loopers) {
    looper.handleMessage({ type: 'loadPCM', left: pcm, right: pcm, originalBpm: 120 });
    looper.requestState('PLAYING');
  }
  stopped.requestState('STOPPED');
  for (let block = 0; block < 18; block++) {
    context.currentFrame = block * 128;
    stopped.process([[]], outputs(128));
    for (const looper of continuing) {
      const output = outputs(128);
      looper.process([[]], output);
      assert(output[0][0].every((sample) => sample > 0.3), 'STOP da track 5 não pode reduzir a saída de outra track');
    }
  }
  assert.equal(stopped.state, 'STOPPED');
  continuing.forEach((looper) => assert.equal(looper.state, 'PLAYING'));
}

function testStopDeClickIsContinuous() {
  const { context, registry } = loadWorklet('js/looper-processor.js');
  const Processor = registry.get('looper-processor');
  const looper = new Processor({ processorOptions: { maxSeconds: 3, maxLayers: 3 } });
  const pcm = new Int16Array(4096).fill(14000);
  looper.handleMessage({ type: 'loadPCM', left: pcm, right: pcm, originalBpm: 120 });
  looper.requestState('PLAYING');
  looper.requestState('STOPPED');
  const rendered = [];
  for (let block = 0; block < 8; block++) {
    context.currentFrame = block * 128;
    const output = outputs(128);
    looper.process([[]], output);
    rendered.push(...output[0][0]);
  }
  const audible = rendered.filter((sample) => sample > 0);
  assert(audible.length >= looper.stopFadeTotal - 1, 'de-click não pode criar silêncio antes do fim da rampa');
  for (let i = 1; i < audible.length; i++) {
    assert(audible[i] <= audible[i - 1] + 1e-7, 'de-click precisa ser uma rampa contínua e monotônica');
  }
  assert.equal(looper.state, 'STOPPED');
}

function testStopAllCanShareExactFrame() {
  const { context, registry } = loadWorklet('js/looper-processor.js');
  const Processor = registry.get('looper-processor');
  const loopers = Array.from({ length: 5 }, () => new Processor({ processorOptions: { maxSeconds: 3, maxLayers: 3 } }));
  const pcm = new Int16Array(4096).fill(14000);
  loopers.forEach((looper) => {
    looper.handleMessage({ type: 'loadPCM', left: pcm, right: pcm, originalBpm: 120 });
    looper.requestState('PLAYING');
  });
  context.currentFrame = 1000;
  loopers.forEach((looper) => looper.requestState('STOPPED', 1280));
  loopers.forEach((looper) => assert.equal(looper.pendingFrame, 1280));
  const firstFadeSample = [];
  for (const looper of loopers) {
    context.currentFrame = 1024;
    const output = outputs(512);
    looper.process([[]], output);
    const first = output[0][0].findIndex((sample, index, data) => index > 0 && sample < data[0] - 1e-7);
    firstFadeSample.push(first);
  }
  assert.equal(new Set(firstFadeSample).size, 1, 'todas as tracks devem iniciar o fade no mesmo frame');
  assert(firstFadeSample[0] >= 256, 'fade não pode começar antes do frame compartilhado');
}

function testFxProcessors() {
  const effects = loadWorklet('js/effects-processor.js');
  for (const name of ['ns-granular-pitch', 'ns-bitcrusher', 'ns-osc-bot', 'ns-vocal-tuner']) {
    assert(effects.registry.has(name), `${name} precisa estar registrado`);
    const processor = new (effects.registry.get(name))({ processorOptions: {} });
    let energy = 0;
    for (let block = 0; block < 120; block++) {
      effects.context.currentFrame = block * 128;
      const input = [[new Float32Array(128), new Float32Array(128)]];
      for (let i = 0; i < 128; i++) {
        const sample = Math.sin(2 * Math.PI * 220 * (block * 128 + i) / 48000) * 0.35;
        input[0][0][i] = sample;
        input[0][1][i] = sample;
      }
      const output = outputs(128);
      processor.process(input, output);
      for (const sample of output[0][0]) {
        assert(Number.isFinite(sample), `${name} gerou valor inválido`);
        energy += sample * sample;
      }
    }
    assert(energy > 0.0001, `${name} não pode silenciar um sinal válido`);
  }
}

function feedSine(processor, context, frequency, blocks = 220) {
  for (let block = 0; block < blocks; block++) {
    context.currentFrame = block * 128;
    const input = [[new Float32Array(128), new Float32Array(128)]];
    for (let i = 0; i < 128; i++) {
      const sample = Math.sin(2 * Math.PI * frequency * (block * 128 + i) / 48000) * 0.42;
      input[0][0][i] = sample;
      input[0][1][i] = sample;
    }
    processor.process(input, outputs(128));
  }
}

function testLowVoicePitchAcquisition() {
  const effects = loadWorklet('js/effects-processor.js');
  const Vocal = effects.registry.get('ns-vocal-tuner');
  const vocal = new Vocal({ processorOptions: { lowLatency: true } });
  feedSine(vocal, effects.context, 82.41);
  assert(Math.abs(vocal.pitchTracker.frequency - 82.41) < 2, `Vocal Tuner deveria reconhecer E2, recebeu ${vocal.pitchTracker.frequency}`);

  const Harmonizer = effects.registry.get('ns-granular-pitch');
  const harmonizer = new Harmonizer({ processorOptions: { lowLatency: true } });
  harmonizer.port.onmessage({ data: { type: 'param', id: 'harmonyMode', value: 1 } });
  harmonizer.port.onmessage({ data: { type: 'param', id: 'root', value: 0 } });
  harmonizer.port.onmessage({ data: { type: 'param', id: 'scale', value: 1 } });
  feedSine(harmonizer, effects.context, 130.81);
  assert(Math.abs(harmonizer.pitchTracker.frequency - 130.81) < 3, 'Harmonizer deve adquirir a fundamental antes de calcular graus diatônicos');

  const advanced = loadWorklet('js/advanced-fx-processor.js');
  const Synth = advanced.registry.get('ns-synth');
  const synth = new Synth({ processorOptions: { defaults: { tracking: 1, frequency: 110 }, lowLatency: true, maxBufferSeconds: 2 } });
  feedSine(synth, advanced.context, 196);
  assert(Math.abs(synth.pitchTracker.frequency - 196) < 4, `Synth deveria seguir G3, recebeu ${synth.pitchTracker.frequency}`);
  const synthLow = new Synth({ processorOptions: { defaults: { tracking: 1, frequency: 55 }, lowLatency: true, maxBufferSeconds: 2 } });
  feedSine(synthLow, advanced.context, 55, 260);
  assert(Math.abs(synthLow.pitchTracker.frequency - 55) < 3, `Synth deveria responder a A1, recebeu ${synthLow.pitchTracker.frequency}`);

  const G2B = advanced.registry.get('ns-g2b');
  const g2b = new G2B({ processorOptions: { defaults: { tracking: 1, frequency: 110 }, lowLatency: true, maxBufferSeconds: 2 } });
  feedSine(g2b, advanced.context, 220, 150);
  feedSine(g2b, advanced.context, 440, 180);
  assert(Math.abs(g2b.pitchTracker.frequency - 440) < 8, `G2B não pode dobrar A4 de volta para A3, recebeu ${g2b.pitchTracker.frequency}`);
  feedSine(g2b, advanced.context, 659.25, 180);
  assert(Math.abs(g2b.pitchTracker.frequency - 659.25) < 12, `G2B deve acompanhar E5, recebeu ${g2b.pitchTracker.frequency}`);

  const Octave = advanced.registry.get('ns-octave');
  const octave = new Octave({ processorOptions: { defaults: { tracking: 1, octave1: 1, octave2: 0.4 }, lowLatency: true, maxBufferSeconds: 2 } });
  feedSine(octave, advanced.context, 220, 180);
  assert(octave.pitchTracker, 'Octave precisa usar aquisição tonal');
  assert(Math.abs(octave.pitchTracker.frequency - 220) < 5, `Octave deveria reconhecer A3, recebeu ${octave.pitchTracker.frequency}`);
}

function testStopKeepsAudioGraphImmutable() {
  const code = fs.readFileSync('js/audio-engine.js', 'utf8');
  assert(!code.includes('outputGate'), 'transporte não pode usar gate depois do looper');
  assert(!code.includes('setOutputPathActive'), 'STOP não pode automatizar ganhos do caminho de saída');
  assert(!code.includes('captureStopTail'), 'STOP não pode disparar um reverb artificial');
  assert(code.includes('this.looperNode.connect(this.outputFxRack.input)'), 'looper e rack precisam permanecer conectados diretamente');
  assert(code.includes('this.masterBus.connect(this.tailSend)'), 'reverb geral precisa ser um auxiliar contínuo');
  const stopBody = code.match(/stop\(targetFrame = 0\) \{([\s\S]*?)\n  \}\n  play\([^)]*\)/)?.[1] || '';
  assert(stopBody.includes("this.send('setState', { state: 'STOPPED', targetFrame })"), 'STOP precisa atuar somente no transporte');
  assert(!stopBody.includes('setRenderActive'), 'STOP não pode desligar o rack de FX');
  assert(!stopBody.includes('_outputSuspendTimer'), 'STOP não pode estimar tail-time de saída com timer');
  assert(!stopBody.includes('outputFxRack.setRenderActive'), 'STOP não pode alterar o estado do rack de saída');
  const stopAllBody = code.match(/stopAll\(\) \{([\s\S]*?)\n  \}/)?.[1] || '';
  assert(stopAllBody.includes('this.tracks.forEach((track) => track.stop(targetFrame))'), 'STOP ALL deve delegar o mesmo frame a cada track');
  assert(!/masterGain|masterFxRack|tailSend|tailReturn/.test(stopAllBody), 'STOP ALL não pode alterar o master ou a cauda');
}

function testAdvancedFxFinite() {
  const advanced = loadWorklet('js/advanced-fx-processor.js');
  for (const [name, Processor] of advanced.registry) {
    const processor = new Processor({ processorOptions: { defaults: { bpm: 120 }, maxBufferSeconds: 2 } });
    let energy = 0;
    // Os efeitos rítmicos precisam primeiro encher ao menos uma janela de beat.
    for (let block = 0; block < 450; block++) {
      advanced.context.currentFrame = block * 128;
      const output = outputs(128);
      processor.process(stereoBlock(128, 0.25), output);
      for (const sample of output[0][0]) {
        assert(Number.isFinite(sample), `${name} gerou valor inválido`);
        energy += sample * sample;
      }
    }
    assert(energy > 0.000001, `${name} não pode zerar a cadeia inteira`);
  }
}

function testTransportOriginIsPersistent() {
  const code = `${fs.readFileSync('js/audio-engine.js', 'utf8')}\n;globalThis.__Engine = NSAudioEngine;globalThis.__Timeline = NSMasterTimeline;`;
  const sent = [];
  const context = {
    console,
    window: {},
    navigator: {},
    localStorage: { getItem: () => null, setItem: () => {} },
    setTimeout,
    clearTimeout,
  };
  vm.createContext(context);
  vm.runInContext(code, context, { filename: 'js/audio-engine.js' });
  const engine = new context.__Engine();
  engine.ctx = { sampleRate: 48000, currentTime: 10, baseLatency: 0.01, outputLatency: 0.02 };
  engine.transportOriginFrame = 123456;
  engine.transportNode = { port: { postMessage: (message) => sent.push(message) } };
  engine.setMetroEnabled(true);
  engine.setMetroEnabled(false);
  assert.equal(engine.transportOriginFrame, 123456, 'ligar/desligar click não pode mover a grade');
  assert.equal(sent.length, 2);
  assert.equal(sent[0].originFrame, sent[1].originFrame);
  assert.equal(sent[0].enabled, true);
  assert.equal(sent[1].enabled, false);

  const timelineContext = { sampleRate: 48000, currentTime: 1 };
  const timeline = new context.__Timeline(timelineContext, { bpm: 120, beatsPerBar: 4, originFrame: 0 });
  assert.equal(timeline.nextLaunchFrame('BEAT'), 72000, 'BEAT deve escolher uma única linha futura');
  assert.equal(timeline.nextLaunchFrame('MEASURE'), 96000, 'BAR deve escolher a próxima cabeça do compasso');
  assert.equal(timeline.nextLaunchFrame('OFF'), 0, 'FREE não agenda lançamento');
  timelineContext.currentTime = 1.5;
  assert.equal(timeline.nextLaunchFrame('BEAT'), 96000, 'ação na linha atual precisa ir para a próxima linha com margem de thread');

  // Alterar o BPM cedo na sessão pode exigir uma origem anterior ao frame zero.
  // A origem assinada preserva tanto o beat quanto a cabeça do compasso.
  timelineContext.currentTime = 1;
  const earlyTimeline = new context.__Timeline(timelineContext, { bpm: 120, beatsPerBar: 4, originFrame: 0 });
  earlyTimeline.setTempo(60);
  assert.equal(earlyTimeline.originFrame, -48000, 'mudança precoce de BPM não pode zerar e deslocar a origem');
  assert.equal(earlyTimeline.nextLaunchFrame('BEAT'), 96000, 'beat deve manter a fase após mudança precoce de BPM');
  assert.equal(earlyTimeline.nextLaunchFrame('MEASURE'), 144000, 'compasso deve manter a fase após mudança precoce de BPM');
}

function testMidiLearnGateAndRemoval() {
  const code = `${fs.readFileSync('js/midi.js', 'utf8')}\n;globalThis.__MidiManager = NSMidiManager;`;
  const store = new Map();
  const context = {
    console,
    navigator: {},
    localStorage: {
      getItem: (key) => store.get(key) || null,
      setItem: (key, value) => store.set(key, String(value)),
    },
  };
  vm.createContext(context);
  vm.runInContext(code, context, { filename: 'js/midi.js' });
  const midi = new context.__MidiManager();
  midi.learnMode = true;
  midi.armLearn('sampler_0', 'PAD 1');
  midi.handleMessage({ data: [0x90, 60, 110] });
  assert.equal(midi.mappings.note_60.actionId, 'sampler_0', 'Note On deve criar o vínculo do pad');

  const events = [];
  midi.onMidiMessage = (actionId, value) => events.push({ actionId, value });
  midi.handleMessage({ data: [0x80, 60, 0] });
  assert.equal(events.length, 0, 'learn ativo não pode disparar ações já mapeadas');
  midi.learnMode = false;
  midi.handleMessage({ data: [0x90, 60, 127] });
  midi.handleMessage({ data: [0x80, 60, 0] });
  assert.equal(events[0].value, 1);
  assert.equal(events[1].value, 0, 'Note Off deve liberar o mesmo vínculo usado pelo Note On');
  assert.equal(midi.removeAction('sampler_0'), 1, 'remoção visual deve apagar os vínculos da ação');
  assert.equal(midi.hasAction('sampler_0'), false);
}

function testTempoResamplingPreservesSource() {
  const { context, registry } = loadWorklet('js/looper-processor.js');
  const Processor = registry.get('looper-processor');
  const looper = new Processor({ processorOptions: { maxSeconds: 3, maxLayers: 3 } });
  const source = new Int16Array(2048);
  for (let i = 0; i < source.length; i++) source[i] = Math.round(Math.sin(i * 0.07) * 12000);
  looper.handleMessage({ type: 'setTempo', bpm: 120 });
  looper.handleMessage({ type: 'loadPCM', left: source, right: source, originalBpm: 120 });
  const original = looper.readSample(looper.layers[0], 317, 0);
  looper.handleMessage({ type: 'setTempo', bpm: 180 });
  looper.requestState('PLAYING');
  context.currentFrame = 0;
  looper.process([[]], outputs(100));
  assert.equal(looper.playHead, 150, 'BPM 180 sobre gravação 120 deve tocar a 1.5x');
  assert.equal(looper.playbackRate, 1.5);
  assert.equal(looper.readSample(looper.layers[0], 317, 0), original, 'mudança de BPM não pode reescrever o PCM original');
}

function testRhythmicFxShareTransportOrigin() {
  const { context, registry } = loadWorklet('js/advanced-fx-processor.js');
  const Processor = registry.get('ns-step-slicer');
  const a = new Processor({ processorOptions: { defaults: { bpm: 120 }, maxBufferSeconds: 2 } });
  const b = new Processor({ processorOptions: { defaults: { bpm: 120 }, maxBufferSeconds: 2 } });
  for (const processor of [a, b]) {
    processor.port.onmessage({ data: { type: 'param', id: 'transportOriginFrame', value: 1000 } });
    processor.port.onmessage({ data: { type: 'param', id: 'rate', value: 4 } });
    for (let step = 0; step < 16; step++) processor.port.onmessage({ data: { type: 'param', id: `step${step}`, value: step & 1 ? 0.1 : 1 } });
  }
  for (let block = 0; block < 9; block++) {
    context.currentFrame = block * 128;
    a.process(stereoBlock(128, 0.3), outputs(128));
  }
  context.currentFrame = 7000;
  const outA = outputs(128), outB = outputs(128);
  a.process(stereoBlock(128, 0.3), outA);
  b.process(stereoBlock(128, 0.3), outB);
  assert.deepEqual(Array.from(outA[0][0]), Array.from(outB[0][0]), 'instâncias rítmicas devem derivar fase do mesmo transporte');
}

function testDriveCurvesAndStatus() {
  const code = `${fs.readFileSync('js/effects.js', 'utf8')}\n;globalThis.__catalog=NS_FX_CATALOG;globalThis.__drive=ns_makeDriveCurve;`;
  const context = { console, navigator: { userAgent: '', platform: '', maxTouchPoints: 0 }, Float32Array, Set, Object, Math };
  vm.createContext(context);
  vm.runInContext(code, context, { filename: 'js/effects.js' });
  const statuses = new Set(context.__catalog.map((item) => item.status));
  assert.deepEqual([...statuses], ['stable'], 'efeitos publicados precisam ter todos os parâmetros ligados ao DSP');
  const signatures = [];
  for (let type = 0; type < 6; type++) {
    const curve = context.__drive(0.65, type);
    assert(curve.every(Number.isFinite), `DRIVE tipo ${type} gerou valor inválido`);
    assert(curve.every((value) => Math.abs(value) <= 1.00001), `DRIVE tipo ${type} excedeu o estágio de segurança`);
    signatures.push([curve[8192], curve[24576], curve[40960], curve[57344]].map((value) => value.toFixed(5)).join(','));
  }
  assert.equal(new Set(signatures).size, 6, 'os seis modos de DRIVE precisam ter curvas distintas');
}

function testAdvancedFxParametersAreAudible() {
  const pairs = [
    ['ns-beat-scatter', 'pattern', 0, 5],
    ['ns-pattern-slicer', 'duty', 0.15, 0.9],
    ['ns-vinyl-flick', 'gesture', -0.8, 0.8],
    ['ns-warp', 'stereo', 0, 1],
    ['ns-reverse-delay', 'lowCut', 20, 1200],
    ['ns-octave', 'octave2', 0, 1],
  ];
  for (const [name, parameter, first, second] of pairs) {
    const advanced = loadWorklet('js/advanced-fx-processor.js');
    const Processor = advanced.registry.get(name);
    const a = new Processor({ processorOptions: { defaults: { bpm: 120, tracking: 1 }, lowLatency: true, maxBufferSeconds: 2 } });
    const b = new Processor({ processorOptions: { defaults: { bpm: 120, tracking: 1 }, lowLatency: true, maxBufferSeconds: 2 } });
    a.port.onmessage({ data: { type: 'param', id: parameter, value: first } });
    b.port.onmessage({ data: { type: 'param', id: parameter, value: second } });
    let difference = 0;
    for (let block = 0; block < 260; block++) {
      advanced.context.currentFrame = block * 128;
      const input = [[new Float32Array(128), new Float32Array(128)]];
      for (let i = 0; i < 128; i++) {
        const frame = block * 128 + i;
        const value = (Math.sin(frame * 0.019) + Math.sin(frame * 0.047) * 0.35) * 0.24;
        input[0][0][i] = value;
        input[0][1][i] = value * 0.87;
      }
      const outA = outputs(128), outB = outputs(128);
      a.process(input, outA); b.process(input, outB);
      if (block > 120) for (let i = 0; i < 128; i++) difference += Math.abs(outA[0][0][i] - outB[0][0][i]);
    }
    assert(difference > 0.01, `${name}: ${parameter} precisa alterar o sinal processado`);
  }
}

function testV210SurfaceContract() {
  const html = fs.readFileSync('index.html', 'utf8');
  const css = fs.readFileSync('css/style.css', 'utf8');
  const engine = fs.readFileSync('js/audio-engine.js', 'utf8');
  const ui = fs.readFileSync('js/ui.js', 'utf8');
  const waveform = fs.readFileSync('js/waveform.js', 'utf8');
  const midi = fs.readFileSync('js/midi.js', 'utf8');
  assert(html.includes('id="boot-start-btn">INICIAR</button>'));
  assert(!html.includes('TOQUE PARA INICIAR'));
  assert(html.includes('V2.10 · CHROME'));
  assert(html.includes('data-quantize="OFF">FREE</button>'), 'modo sem quantize deve aparecer como FREE');
  assert(css.includes('grid-template-columns:70px minmax(0,109px)'), 'módulo inferior deve ter largura física fixa');
  assert(css.includes('grid-template-columns:18px 36px 8px'), 'escala, fader e meter devem ocupar colunas independentes');
  assert(css.includes('grid-template-columns:repeat(2,52px)'), 'botões inferiores devem permanecer compactos e alinhados');
  assert(engine.includes('globalFxLatencySamples') && engine.includes('trackFxLatencySamples'), 'compensação de REC deve incluir Input FX global e por track');
  assert(engine.includes('class NSMasterTimeline') && engine.includes('getLaunchTargetFrame'), 'metrônomo e lançamentos precisam compartilhar a master timeline');
  assert(ui.includes('fx-binary-toggle'), 'parâmetros binários devem usar botões compactos');
  assert(waveform.includes('fixedPeakCount') && !waveform.includes('visibleRatio'), 'waveform fixa não pode reposicionar picos durante REC');
  assert(html.includes('id="learn-toolbar"') && html.includes('id="btn-learn-pads"'), 'learn deve permanecer visível sobre a mesa e abrir os pads');
  assert(ui.includes('registerLearnTarget') && ui.includes('sampler_${index}'), 'tracks e pads precisam usar o mesmo fluxo visual de learn');
  assert(midi.includes("key = `note_${d1}`; value = 0"), 'Note Off precisa liberar pads GATE pelo mesmo mapeamento');
}

testMasterScheduledRecordAndClose();
testFirstLayerKeepsTrueSampleZero();
testMissedMasterFrameMovesToNextGrid();
testStoppedTrackJoinsSharedGrid();
testStoppedTrackRestartsWithoutQuantize();
testIndividualStopDoesNotGateAnotherTrack();
testStopDeClickIsContinuous();
testStopAllCanShareExactFrame();
testFxProcessors();
testLowVoicePitchAcquisition();
testStopKeepsAudioGraphImmutable();
testAdvancedFxFinite();
testTransportOriginIsPersistent();
testMidiLearnGateAndRemoval();
testTempoResamplingPreservesSource();
testRhythmicFxShareTransportOrigin();
testDriveCurvesAndStatus();
testAdvancedFxParametersAreAudible();
testV210SurfaceContract();
console.log('OK - quantize ouvido, transporte, parâmetros de FX e 20 AudioWorklets verificados');

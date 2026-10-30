// midi.js
// Acesso Web MIDI, listagem de dispositivos (Minilab 3, UMC404HD como interface de áudio
// não aparece aqui pois é só áudio), sistema de aprendizado (MIDI Learn) e roteamento
// de mensagens para ações da UI.

class NSMidiManager {
  constructor() {
    this.access = null;
    this.input = null;
    this.preferredInputId = localStorage.getItem('ns-looper-midi-input') || '';
    this.learnMode = false;
    this.pendingLearnTarget = null; // { actionId, label }
    this.mappings = this.loadMappings(); // { 'note_60': {actionId}, 'cc_1_20': {actionId} }
    this.onMidiMessage = null; // callback(actionId, value)
    this.onMappingsChanged = null;
    this.onLearnComplete = null;
    this.onInputsChanged = null;
  }

  async init() {
    if (!navigator.requestMIDIAccess) return false;
    try {
      this.access = await navigator.requestMIDIAccess({ sysex: false });
      this.access.onstatechange = () => {
        if (this.onInputsChanged) this.onInputsChanged();
      };
      return true;
    } catch (e) {
      return false;
    }
  }

  listInputs() {
    if (!this.access) return [];
    return Array.from(this.access.inputs.values());
  }

  selectInput(id) {
    if (this.input && this.input.id === id) return this.input;
    if (this.input) this.input.onmidimessage = null;
    const inputs = this.listInputs();
    this.input = inputs.find(i => i.id === id) || null;
    if (this.input) this.input.onmidimessage = (msg) => this.handleMessage(msg);
    this.preferredInputId = this.input ? this.input.id : '';
    try { localStorage.setItem('ns-looper-midi-input', this.preferredInputId); } catch (error) {}
    return this.input;
  }

  handleMessage(msg) {
    const [status, d1, d2] = msg.data;
    const type = status & 0xf0;
    let key = null;
    let value = d2 !== undefined ? d2 / 127 : 1;

    if (type === 0xb0) key = `cc_${d1}`;
    else if (type === 0x90 && d2 > 0) key = `note_${d1}`;
    // Note On e Note Off compartilham o mesmo vínculo. O valor zero libera
    // pads GATE e efeitos MOMENTARY sem exigir um segundo mapeamento.
    else if (type === 0x80 || (type === 0x90 && d2 === 0)) { key = `note_${d1}`; value = 0; }
    if (!key) return;

    if (this.learnMode) {
      if (this.pendingLearnTarget && (type === 0xb0 || (type === 0x90 && d2 > 0))) {
        const target = this.pendingLearnTarget;
        this.mappings[key] = { actionId: target.actionId, label: target.label };
        this.saveMappings();
        this.pendingLearnTarget = null;
        if (this.onMappingsChanged) this.onMappingsChanged({ type: 'learn', key, target });
        if (this.onLearnComplete) this.onLearnComplete({ key, actionId: target.actionId, label: target.label });
      }
      return;
    }

    const mapping = this.mappings[key];
    if (mapping && this.onMidiMessage) {
      this.onMidiMessage(mapping.actionId, value);
    }
  }

  armLearn(actionId, label) {
    this.pendingLearnTarget = { actionId, label };
  }

  cancelLearn() { this.pendingLearnTarget = null; }

  removeMapping(key) {
    if (!Object.prototype.hasOwnProperty.call(this.mappings, key)) return false;
    delete this.mappings[key];
    this.saveMappings();
    if (this.onMappingsChanged) this.onMappingsChanged({ type: 'remove', key });
    return true;
  }

  removeAction(actionId) {
    const keys = Object.keys(this.mappings).filter((key) => this.mappings[key]?.actionId === actionId);
    keys.forEach((key) => delete this.mappings[key]);
    if (!keys.length) return 0;
    this.saveMappings();
    if (this.onMappingsChanged) this.onMappingsChanged({ type: 'remove-action', actionId, keys });
    return keys.length;
  }

  hasAction(actionId) {
    return Object.values(this.mappings).some((mapping) => mapping?.actionId === actionId);
  }

  clearMappings() {
    this.mappings = {};
    this.pendingLearnTarget = null;
    this.saveMappings();
    if (this.onMappingsChanged) this.onMappingsChanged();
  }

  saveMappings() {
    try { localStorage.setItem('ns-looper-midi-map', JSON.stringify(this.mappings)); } catch (e) {}
  }

  loadMappings() {
    try {
      const raw = localStorage.getItem('ns-looper-midi-map');
      return raw ? JSON.parse(raw) : {};
    } catch (e) { return {}; }
  }
}

// Keyboard Learn persistente para controles de performance no computador.
class NSKeyboardManager {
  constructor() {
    this.learnMode = false;
    this.pendingLearnTarget = null;
    this.mappings = this.loadMappings();
    this.onAction = null;
    this.onMappingsChanged = null;
    this.onLearnComplete = null;
    this.onLearnCancelled = null;
    this._down = new Set();
    document.addEventListener('keydown', (event) => this.handleDown(event));
    document.addEventListener('keyup', (event) => this.handleUp(event));
  }

  editableTarget(target) {
    return target && (target.matches('input,select,textarea') || target.isContentEditable);
  }

  keyId(event) { return event.code || event.key; }

  handleDown(event) {
    if (this.editableTarget(event.target) || event.repeat) return;
    const key = this.keyId(event);
    if (this.learnMode) {
      if (key === 'Escape') {
        event.preventDefault();
        this.pendingLearnTarget = null;
        if (this.onLearnCancelled) this.onLearnCancelled();
        return;
      }
      if (this.pendingLearnTarget) {
        event.preventDefault();
        const target = this.pendingLearnTarget;
        this.mappings[key] = { actionId: target.actionId, label: target.label };
        this.pendingLearnTarget = null;
        this.saveMappings();
        if (this.onMappingsChanged) this.onMappingsChanged({ type: 'learn', key, target });
        if (this.onLearnComplete) this.onLearnComplete({ key, actionId: target.actionId, label: target.label });
      }
      return;
    }
    const mapping = this.mappings[key];
    if (!mapping || !this.onAction) return;
    event.preventDefault();
    this._down.add(key);
    this.onAction(mapping.actionId, 1);
  }

  handleUp(event) {
    const key = this.keyId(event);
    if (this.learnMode) { this._down.delete(key); return; }
    if (!this._down.has(key)) return;
    this._down.delete(key);
    const mapping = this.mappings[key];
    if (mapping && this.onAction) this.onAction(mapping.actionId, 0);
  }

  armLearn(actionId, label) { this.pendingLearnTarget = { actionId, label }; }
  cancelLearn() { this.pendingLearnTarget = null; }
  removeMapping(key) {
    if (!Object.prototype.hasOwnProperty.call(this.mappings, key)) return false;
    delete this.mappings[key]; this.saveMappings();
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
  hasAction(actionId) { return Object.values(this.mappings).some((mapping) => mapping?.actionId === actionId); }
  clearMappings() { this.mappings = {}; this.pendingLearnTarget = null; this.saveMappings(); if (this.onMappingsChanged) this.onMappingsChanged({ type: 'clear' }); }
  saveMappings() { try { localStorage.setItem('ns-looper-keyboard-map', JSON.stringify(this.mappings)); } catch (error) {} }
  loadMappings() { try { return JSON.parse(localStorage.getItem('ns-looper-keyboard-map') || '{}'); } catch (error) { return {}; } }
}
